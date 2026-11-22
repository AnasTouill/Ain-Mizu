"""Statistics page of an onboarded farm: stress history and forecast per sub-zone, monthly water
demand vs. a uniform baseline, weather, pumping energy and solar share. All figures are modeled."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .data_provider import DataProvider
from .farm_local import farm_plan_local
from .onboarding import CROP_BY_ID, SOIL_BY_ID, centroid, point_in_polygon
from .util import days_in_month, haversine_m, month_add, month_range

KWH_PER_M3 = 0.357


def _sub_weights(sub: dict, sat: list[dict]) -> list[tuple[str, float]]:
    poly = sub["polygon"]
    out = []
    for f in sat:
        p = f["properties"]
        ring = f["geometry"]["coordinates"][0]
        if point_in_polygon(p["centroid_lon"], p["centroid_lat"], poly) or any(point_in_polygon(x, y, poly) for x, y in ring[::3]):
            out.append((p["field_id"], float(p["area_ha"])))
    if not out and sat:  # nearest satellite field of the farm
        lon, lat = centroid(poly)
        best = min(sat, key=lambda f: haversine_m(lon, lat, f["properties"]["centroid_lon"], f["properties"]["centroid_lat"]))
        out.append((best["properties"]["field_id"], 1.0))
    return out


def farm_stats(provider: DataProvider, farm: dict, months_back: int = 24) -> dict:
    cfg = provider.config()
    labels, weights = cfg["class_labels"], cfg["demand_weights"]
    zone = farm["zone"]
    last = cfg["months"]["last_observed"]
    fc_key = (cfg.get("pipeline") or {}).get("forecast_month_key") or month_add(last, 1)
    months = month_range(month_add(last, -(months_back - 1)), last)
    sat = [f for f in provider.fields_geojson(zone)["features"] if f["properties"]["field_id"] in set(farm["field_ids"])]
    preds = provider.predictions()
    preds = preds[(preds["zone"] == zone) & (preds["field_id"].isin(farm["field_ids"]))]
    cur = preds[preds["status_type"] == "current"].set_index(["field_id", "month"])["stress_class"]
    fut = preds[preds["status_type"] == "forecast"].set_index(["field_id", "month"])["stress_class"]
    wx = provider.weather_monthly()
    wx = wx[wx["zone"] == zone].set_index("month")

    def sub_class(ws, month, table):
        vals = [(table.get((fid, month)), w) for fid, w in ws]
        vals = [(float(c), w) for c, w in vals if c is not None and not pd.isna(c)]
        if not vals:
            return None
        return int(round(sum(c * w for c, w in vals) / sum(w for _, w in vals)))

    subs = []
    for sz in farm["sub_zones"]:
        crop = CROP_BY_ID.get(sz["crop"], {"need_mm": 500})
        kc = 0.0 if crop["need_mm"] == 0 else min(1.25, max(0.35, crop["need_mm"] / 900.0))
        subs.append({"sz": sz, "ws": _sub_weights(sz, sat), "kc": kc, "soil": SOIL_BY_ID.get(sz["soil"], {"factor": 1.0})["factor"]})

    history, demand = [], []
    area_total = sum(s["sz"]["area_ha"] for s in subs) or 1.0
    for month in months + [fc_key]:
        is_fc = month == fc_key
        share = {lab: 0.0 for lab in labels}
        need, base = 0.0, 0.0
        et0 = float(wx.loc[month, "et0_mm"]) if month in wx.index else 0.0
        for s in subs:
            c = sub_class(s["ws"], month, fut if is_fc else cur)
            if c is not None:
                share[labels[c]] += s["sz"]["area_ha"] / area_total
            w = float(weights.get(labels[c], 0.0)) if c is not None else 0.0
            full = s["sz"]["area_ha"] * et0 * 10.0 * s["kc"] * s["soil"]
            need += full * w
            base += full
        history.append({"month": month, "forecast": is_fc, "share_by_class": {k: round(v, 3) for k, v in share.items()}})
        if not is_fc:
            solar_day = float(wx.loc[month, "solar_kwh_m2_day"]) if month in wx.index else 5.0
            energy = (cfg.get("energy") or {})
            pv_kwh = float(energy.get("pv_kwp", 24.0)) * solar_day * float(energy.get("pv_performance_ratio", 0.8)) * days_in_month(month)
            pump_kwh = need * KWH_PER_M3
            demand.append({"month": month, "need_m3": round(need), "baseline_m3": round(base),
                           "saved_pct": round(100 * (1 - need / base), 1) if base > 0 else 0.0,
                           "rain_mm": float(wx.loc[month, "rain_mm"]) if month in wx.index else None,
                           "et0_mm": et0, "pump_kwh": round(pump_kwh), "pv_kwh": round(pv_kwh),
                           "solar_share_pct": round(100 * min(1.0, pv_kwh / pump_kwh), 1) if pump_kwh > 0 else 100.0})

    plan_now = farm_plan_local(provider, farm, last, "current")
    plan_next = farm_plan_local(provider, farm, fc_key, "forecast")
    nxt = {f["properties"]["field_id"]: f["properties"] for f in plan_next["fields"]["features"]}
    table = []
    for f in plan_now["fields"]["features"]:
        p = f["properties"]
        q = nxt.get(p["field_id"], {})
        hist = [sub_class(next(s["ws"] for s in subs if s["sz"]["sub_zone_id"] == p["field_id"]), m, cur) for m in months[-12:]]
        table.append({"sub_zone_id": p["field_id"], "name": p.get("name"), "crop": p.get("crop"), "soil": p.get("soil"),
                      "area_ha": p["area_ha"], "class_now": p["stress_class"], "class_next": q.get("stress_class"),
                      "need_m3_day": p["need_m3_day"], "need_next_m3_day": q.get("need_m3_day"),
                      "history_12m": hist})
    last12 = demand[-12:]
    tot_need, tot_base = sum(d["need_m3"] for d in last12), sum(d["baseline_m3"] for d in last12)
    tot_pump, tot_pv = sum(d["pump_kwh"] for d in last12), sum(min(d["pv_kwh"], d["pump_kwh"]) for d in last12)
    return {
        "farm_id": farm["farm_id"],
        "zone": zone,
        "months": months,
        "forecast_key": fc_key,
        "kpis": {
            "area_ha": farm["area_ha"],
            "sub_zones": len(subs),
            "need_today_m3": plan_now["summary"]["total_need_m3_day"],
            "need_next_week_m3_day": plan_next["summary"]["total_need_m3_day"],
            "water_12m_m3": tot_need,
            "baseline_12m_m3": tot_base,
            "water_saved_pct": round(100 * (1 - tot_need / tot_base), 1) if tot_base else 0.0,
            "pump_kwh_12m": tot_pump,
            "solar_share_pct": round(100 * tot_pv / tot_pump, 1) if tot_pump else 100.0,
            "worsening_next": sum(1 for r in table if r["class_now"] is not None and r["class_next"] is not None and r["class_next"] > r["class_now"]),
            "improving_next": sum(1 for r in table if r["class_now"] is not None and r["class_next"] is not None and r["class_next"] < r["class_now"]),
        },
        "class_history": history,
        "demand": demand,
        "sub_zones": table,
        "notes": "Modeled: need = area x ET0 x crop coefficient x soil factor x stress-class weight; "
                 "baseline = the same area watered at full need regardless of stress. Solar = 24 kWp PV x irradiance x 0.8.",
    }
