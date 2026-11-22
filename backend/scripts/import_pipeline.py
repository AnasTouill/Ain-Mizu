#!/usr/bin/env python
"""
Import the REAL Dawra pipeline output into the site's data/ folder (replaces the mock data).

Reads the pipeline folder (default C:/Users/loulo/OneDrive/Bureau/data):
    zones/<zone>/fields.tif + fields.csv   SLIC field polygons (EPSG:32632) and attributes
    zones/field_weekly.parquet             weekly Sentinel-2 table per field (+ weather)
    zones/weather_monthly_all.csv          monthly weather
    zones/<zone>/weather_forecast_daily.csv 16-day forecast
    zones/weekly_plan_<week>.csv           next-week plan (latest file wins)
    models/lgbm_ndmi_week.txt              LightGBM forecaster (NDMI next week)
    models/kmeans_stress.joblib            field normals + k-means stress thresholds
    models/metrics.json, feature_importance.csv, figures/*.png

Writes into data/ (same schemas as ARCHITECTURE.md section 13, so every screen keeps working):
    fields_{zone}.geojson, field_monthly.parquet, weather_monthly.parquet, predictions.parquet,
    graph_nodes_{zone}.json, graph_edges_{zone}.json, farmers.json, config.json
and the weekly model outputs used by /api/model/*:
    model/plan.csv, model/field_weekly.parquet, model/metrics.json, model/feature_importance.csv,
    model/figures/*.png

Months: history = calendar months (class of the last week of the month). The "forecast" slot
(+1, keyed as the month after the last observed one) holds the NEXT-WEEK plan of the model.

Run it with a Python that has rasterio, shapely, pyproj, lightgbm, scikit-learn, joblib, scipy
and networkx (the pipeline's Python), from the repository root:
    python backend/scripts/import_pipeline.py
    python backend/scripts/import_pipeline.py --pipeline "C:/path/to/data"
"""
from __future__ import annotations

import argparse
import warnings
warnings.filterwarnings("ignore")
import io
import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import DEFAULT_CONFIG, REPO_DIR, deep_merge  # noqa: E402
from app.services import energy as energy_svc  # noqa: E402
from app.services import kpis as kpi_svc  # noqa: E402
from app.services import physarum  # noqa: E402
from app.services.util import month_add, to_local  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ZONES = {
    "kairouan": {"prefix": "kai", "name": "Kairouan", "n_sources": 2},
    "sidi_bouzid": {"prefix": "sib", "name": "Sidi Bouzid", "n_sources": 2},
    "kebili": {"prefix": "keb", "name": "Kébili", "n_sources": 1},
}
CLASS_CODE = {"vert": 0, "jaune": 1, "orange": 2, "rouge": 3}
N_JUNCTIONS = 4
FIRST_MONTH = "2022-11"


def fid(zone: str, i: int) -> str:
    return f"{ZONES[zone]['prefix']}_{int(i):04d}"


def write_json(path: Path, obj, pretty: bool = False) -> None:
    path.write_text(json.dumps(obj, indent=2 if pretty else None, ensure_ascii=False, default=str), encoding="utf-8")


def write_parquet(path: Path, df: pd.DataFrame) -> None:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    path.write_bytes(buf.getvalue())


class FlatDem:
    """No DEM in the pipeline: the terrain is taken as flat (no uphill penalty)."""

    def z(self, x: float, y: float) -> float:
        return 0.0


# --------------------------------------------------------------------------- fields


def field_polygons(pipe: Path, zone: str) -> dict[int, list[list[float]]]:
    import rasterio
    from rasterio.features import shapes
    from shapely.geometry import shape
    from shapely.ops import transform as sh_transform
    from pyproj import Transformer

    with rasterio.open(pipe / "zones" / zone / "fields.tif") as r:
        lab = r.read(1)
        tf, crs = r.transform, r.crs
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform
    best: dict[int, object] = {}
    for geom, val in shapes(lab.astype(np.int32), mask=lab > 0, transform=tf):
        v = int(val)
        poly = shape(geom)
        if v not in best or poly.area > best[v].area:
            best[v] = poly
    rings = {}
    for v, poly in best.items():
        p = poly.simplify(8.0, preserve_topology=True).buffer(0)
        if p.geom_type == "MultiPolygon":
            p = max(p.geoms, key=lambda g: g.area)
        p = sh_transform(to_wgs, p)  # noqa
        rings[v] = [[round(x, 6), round(y, 6)] for x, y in p.exterior.coords]
    return rings


def build_layout(zone: str, fields_csv: pd.DataFrame, rings: dict, plan_z: pd.DataFrame) -> dict:
    from sklearn.cluster import KMeans

    lon0, lat0 = float(fields_csv["lon"].mean()), float(fields_csv["lat"].mean())
    fields = []
    for r in fields_csv.itertuples():
        if int(r.field_id) not in rings:
            continue
        x, y = to_local(float(r.lon), float(r.lat), lon0, lat0)
        fields.append({
            "field_id": fid(zone, r.field_id), "raw_id": int(r.field_id), "x": x, "y": y,
            "ring": rings[int(r.field_id)], "area_ha": round(float(r.area_ha), 2),
            "centroid_lon": round(float(r.lon), 6), "centroid_lat": round(float(r.lat), 6),
            "irrigated_summer": bool(r.irrigated), "mean_slope_deg": 0.0, "elevation_m": 0.0,
        })
    P = np.array([[f["x"], f["y"]] for f in fields])
    A = np.array([f["area_ha"] for f in fields])

    # Hypothetical water sources: one per cluster of fields (area-weighted k-means), moved off any field.
    n_src = ZONES[zone]["n_sources"]
    km = KMeans(n_src, n_init=10, random_state=0).fit(P, sample_weight=A)
    weekly_m3 = float(plan_z["besoin_m3"].sum()) if len(plan_z) else 0.0
    sources = []
    for i, c in enumerate(km.cluster_centers_):
        d = np.hypot(*(P - c).T)
        j = int(np.argmin(d))
        if d[j] < 150:
            v = c - P[j]
            v = v / (np.linalg.norm(v) or 1.0) if np.linalg.norm(v) > 1 else np.array([1.0, 0.0])
            c = P[j] + v * 180.0
        share = float(A[km.labels_ == i].sum() / A.sum())
        cap = max(200.0, round(weekly_m3 / 7.0 * share * 1.3, -1))
        sources.append((f"src_{i + 1:02d}", float(c[0]), float(c[1]), cap))
    jk = KMeans(N_JUNCTIONS, n_init=10, random_state=1).fit(P)
    junctions = []
    for i, c in enumerate(jk.cluster_centers_):
        d = np.hypot(*(P - c).T)
        j = int(np.argmin(d))
        if d[j] < 80:
            c = c + np.array([90.0, 90.0])
        junctions.append((f"jct_{i + 1:02d}", float(c[0]), float(c[1])))
    return {"zone": zone, "center": (lon0, lat0), "fields": fields, "sources": sources, "junctions": junctions,
            "dem": FlatDem()}


def fields_geojson(zone: str, layout: dict) -> dict:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [f["ring"]]},
         "properties": {"field_id": f["field_id"], "zone": zone, "area_ha": f["area_ha"],
                        "centroid_lon": f["centroid_lon"], "centroid_lat": f["centroid_lat"],
                        # every pipeline field is a permanently cultivated parcel that the plan waters
                        "is_irrigated": True, "irrigated_summer": f["irrigated_summer"],
                        "mean_slope_deg": 0.0, "elevation_m": 0.0, "source_id": f["raw_id"]}}
        for f in layout["fields"]]}


# --------------------------------------------------------------------------- model on every week


def weekly_with_model(pipe: Path) -> tuple[pd.DataFrame, dict]:
    sys.path.insert(0, str(pipe))
    import joblib
    import lightgbm as lgb
    import train_forecaster as tf  # the pipeline's own feature code and classifier

    w = pd.read_parquet(pipe / "zones" / "field_weekly.parquet")
    w = tf.add_features(w)
    model = lgb.Booster(model_file=str(pipe / "models" / "lgbm_ndmi_week.txt"))
    st = joblib.load(pipe / "models" / "kmeans_stress.joblib")
    nrm, sd, cuts = st["normals"], st["sd"], st["cuts"]

    ok = w["ndmi"].notna()
    w["pred_next"] = np.nan
    w.loc[ok, "pred_next"] = w.loc[ok, "ndmi"] + model.predict(w.loc[ok, tf.FEATURES])
    g = w.groupby(["zone", "field_id"], sort=False)
    w["ndmi_pred"] = g["pred_next"].shift(1)  # prediction made the week before for this week
    z, nva = tf.anomaly(w, "ndmi", nrm, sd)
    w["z"] = np.where(ok, z, np.nan)
    w["ndvi_anom"] = nva
    w["z_prev"] = g["z"].shift(1).fillna(0)
    cls = tf.classify(np.nan_to_num(w["z"].values), w["z_prev"].values, w["ndvi_anom"].values, cuts)
    w["cls"] = np.where(ok, pd.Series(cls).map(CLASS_CODE).values, np.nan)
    d = w.join(nrm, on=["zone", "field_id", "woy"]).join(sd, on=["zone", "field_id"])
    w["normal_ndmi"], w["sd_ndmi"] = d["n_ndmi"].values, d["sd_ndmi"].values
    return w, {"cuts": cuts, "weights": tf.CLASS_WEIGHT}


def stress_score(z):
    return np.clip(1.0 / (1.0 + np.exp(1.4 * (np.asarray(z, float) + 1.0))), 0, 1)


# --------------------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pipeline", default="C:/Users/loulo/OneDrive/Bureau/data")
    ap.add_argument("--data-dir", default=str(REPO_DIR / "data"))
    ap.add_argument("--precompute", type=int, default=60, help="last N months (incl. forecast) to precompute networks for")
    a = ap.parse_args()
    t0 = time.perf_counter()
    pipe, data_dir = Path(a.pipeline), Path(a.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "model" / "figures").mkdir(parents=True, exist_ok=True)

    plans = sorted((pipe / "zones").glob("weekly_plan_*.csv"))
    if not plans:
        sys.exit("no zones/weekly_plan_*.csv in the pipeline folder: run run_all.py first")
    plan = pd.read_csv(plans[-1])
    forecast_week = plans[-1].stem.replace("weekly_plan_", "")
    plan["site_id"] = [fid(z, i) for z, i in zip(plan["zone"], plan["field_id"])]
    print(f"pipeline: {pipe} | plan {plans[-1].name} ({len(plan)} fields)")

    # ---- old generated files out (mock data)
    for pat in ("network_*_*.json", "energy_*_*.json", "kpis_*_*.json", "fields_*.geojson", "graph_*_*.json"):
        for p in data_dir.glob(pat):
            p.unlink()

    w, st = weekly_with_model(pipe)
    weights = {CLASS_CODE[k]: v for k, v in st["weights"].items()}
    state_week = pd.Timestamp(w["week_start"].max())
    last_month = (state_week + pd.Timedelta(days=3)).strftime("%Y-%m")
    fc_month = month_add(last_month, 1)
    print(f"weekly table to {state_week.date()} -> months {FIRST_MONTH}..{last_month}, forecast slot {fc_month} = week {forecast_week}")
    w["site_id"] = [fid(z, i) for z, i in zip(w["zone"], w["field_id"])]
    w["mon"] = (w["week_start"] + pd.Timedelta(days=3)).dt.strftime("%Y-%m")
    w = w[w["mon"] >= FIRST_MONTH]

    # ---- weekly series for /api/model/fields/{id}/weekly
    wk = w[["zone", "site_id", "week_start", "ndmi", "ndvi", "obs", "ndmi_pred", "z", "cls", "normal_ndmi", "sd_ndmi"]]
    write_parquet(data_dir / "model" / "field_weekly.parquet",
                  wk.rename(columns={"site_id": "field_id"}).round(4))

    # ---- monthly aggregates
    grp = w.sort_values("week_start").groupby(["zone", "site_id", "mon"], sort=False)
    obs_w = w[w["obs"] == 1]
    gobs = obs_w.groupby(["site_id", "mon"])
    monthly = grp.agg(ndvi=("ndvi", "mean"), ndmi=("ndmi", "mean"), mndwi=("ndwi", "mean"), bsi=("bsi", "mean"),
                      obs_share=("obs", "mean"), n_obs=("obs", "sum")).reset_index()
    last = grp.tail(1).set_index(["site_id", "mon"])
    lastobs = obs_w.sort_values("week_start").groupby(["site_id", "mon"]).tail(1).set_index(["site_id", "mon"])
    monthly = monthly.join(gobs["ndmi"].mean().rename("ndmi_obs"), on=["site_id", "mon"])
    monthly = monthly.join(gobs["ndmi_pred"].mean().rename("ndmi_pred_obs"), on=["site_id", "mon"])
    monthly = monthly.join(last[["z", "cls", "d_ndmi_4", "ndvi_anom", "ndmi_pred", "sd_ndmi"]], on=["site_id", "mon"])
    monthly = monthly.join(lastobs[["z", "cls"]].add_suffix("_obs"), on=["site_id", "mon"])
    # prefer the class of the last *observed* week of the month
    monthly["cls"] = monthly["cls_obs"].fillna(monthly["cls"])
    monthly["z"] = monthly["z_obs"].fillna(monthly["z"])

    fm = pd.DataFrame({
        "zone": monthly["zone"], "field_id": monthly["site_id"], "month": monthly["mon"],
        "ndvi": monthly["ndvi"].round(3), "ndmi": monthly["ndmi"].round(3), "mndwi": monthly["mndwi"].round(3),
        "bsi": monthly["bsi"].round(3), "evi": np.nan, "str": np.nan,
        "cloud_frac": (1 - monthly["obs_share"]).round(2), "is_gap_filled": monthly["n_obs"] == 0,
    })
    write_parquet(data_dir / "field_monthly.parquet", fm)

    # current state of the latest month = exactly the plan's "classe_actuelle"
    pl = plan.set_index("site_id")
    is_last = monthly["mon"] == last_month
    m_last = monthly.loc[is_last, "site_id"]
    monthly.loc[is_last, "cls"] = m_last.map(pl["classe_actuelle"].map(CLASS_CODE)).values
    monthly.loc[is_last, "z"] = m_last.map(pl["z_actuel"]).values

    cls_int = monthly["cls"].round()
    pred_cur = pd.DataFrame({
        "zone": monthly["zone"], "field_id": monthly["site_id"], "month": monthly["mon"],
        "ndmi_obs": monthly["ndmi_obs"].round(3),
        "ndmi_pred": monthly["ndmi_pred_obs"].fillna(monthly["ndmi_pred"]).round(3),
        "horizon": 0,
        "residual": (monthly["ndmi_obs"] - monthly["ndmi_pred_obs"]).round(3),
        "anomaly_z": monthly["z"].round(2), "trend": monthly["d_ndmi_4"].round(3),
        "ndvi_anomaly_z": (monthly["ndvi_anom"] / monthly["sd_ndmi"]).round(2),
        "stress_class": pd.array(cls_int, dtype="Int64"),
        "stress_score": stress_score(monthly["z"]).round(3),
        "demand_score": cls_int.map(weights).round(3),
        "status_type": "current",
    })
    pred_fc = pd.DataFrame({
        "zone": plan["zone"], "field_id": plan["site_id"], "month": fc_month,
        "ndmi_obs": np.nan, "ndmi_pred": plan["pred_ndmi_next"].round(3), "horizon": 1, "residual": np.nan,
        "anomaly_z": plan["z_prevu"].round(2), "trend": (plan["pred_ndmi_next"] - plan["ndmi"]).round(3),
        "ndvi_anomaly_z": np.nan,
        "stress_class": pd.array(plan["classe_prevue"].map(CLASS_CODE), dtype="Int64"),
        "stress_score": stress_score(plan["z_prevu"]).round(3),
        "demand_score": plan["classe_prevue"].map(st["weights"]).round(3),
        "status_type": "forecast",
    })
    predictions = pd.concat([pred_cur, pred_fc], ignore_index=True)
    write_parquet(data_dir / "predictions.parquet", predictions)

    # ---- weather
    wm = pd.read_csv(pipe / "zones" / "weather_monthly_all.csv")
    wm = wm[wm["month"] >= FIRST_MONTH]
    wrows = pd.DataFrame({"zone": wm["zone"], "month": wm["month"], "rain_mm": wm["rain_sum"].round(1),
                          "temp_mean_c": wm["tmean"].round(1), "temp_max_c": wm["tmax_mean"].round(1),
                          "et0_mm": wm["et0_sum"].round(1),
                          "solar_kwh_m2_day": (wm["radiation_sum_mj"] / wm["days"] / 3.6).round(2)})
    extra = []
    for zone in ZONES:
        fcd = pd.read_csv(pipe / "zones" / zone / "weather_forecast_daily.csv")
        cur = wrows[(wrows.zone == zone) & (wrows.month == last_month)]
        n = max(len(fcd), 1)
        solar = float(cur["solar_kwh_m2_day"].iloc[0]) if len(cur) else 4.0
        if "shortwave_radiation_sum" in fcd:
            solar = round(float(fcd["shortwave_radiation_sum"].mean()) / 3.6, 2)
        extra.append({"zone": zone, "month": fc_month,
                      "rain_mm": round(float(fcd.get("precipitation_sum", pd.Series([0])).sum()) * 30 / n, 1),
                      "temp_mean_c": round(float(fcd.get("temperature_2m_mean", fcd.get("temperature_2m_max", pd.Series([15]))).mean()), 1),
                      "temp_max_c": round(float(fcd.get("temperature_2m_max", pd.Series([20])).mean()), 1),
                      "et0_mm": round(float(fcd.get("et0_fao_evapotranspiration", pd.Series([2])).sum()) * 30 / n, 1),
                      "solar_kwh_m2_day": solar})
    weather = pd.concat([wrows, pd.DataFrame(extra)], ignore_index=True)
    write_parquet(data_dir / "weather_monthly.parquet", weather)

    # ---- fields, graphs, farmers
    sys.path.insert(0, str(BACKEND_DIR / "scripts"))
    from generate_mock_data import make_farmers, make_graph  # reuse the same graph builder

    cfg_path = data_dir / "config.json"
    user_cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    cfg = deep_merge(DEFAULT_CONFIG, user_cfg)
    cfg["demand_weights"] = {"green": 0.0, "yellow": st["weights"]["jaune"], "orange": st["weights"]["orange"], "red": 1.0}
    cost = physarum.EdgeCostParams.from_dict(cfg["edge_cost"])
    params = physarum.PhysarumParams.from_dict(cfg["physarum"])
    station = energy_svc.StationParams.from_config(cfg)
    farmers, zone_cfg, layouts = [], [], {}
    for zi, (zone, zinfo) in enumerate(ZONES.items()):
        fcsv = pd.read_csv(pipe / "zones" / zone / "fields.csv")
        rings = field_polygons(pipe, zone)
        layout = build_layout(zone, fcsv, rings, plan[plan.zone == zone])
        layouts[zone] = layout
        write_json(data_dir / f"fields_{zone}.geojson", fields_geojson(zone, layout))
        nodes, edges = make_graph(zone, layout, cost, np.random.default_rng([7, zi]))
        for n in nodes:
            if n["type"] == "source":
                n["hypothetical"] = True
        write_json(data_dir / f"graph_nodes_{zone}.json", nodes, pretty=True)
        write_json(data_dir / f"graph_edges_{zone}.json", edges, pretty=True)
        farmers.extend(make_farmers(zone, zinfo["prefix"], layout, np.random.default_rng([7, zi, 7])))
        layout["nodes"], layout["edges"] = nodes, edges
        zone_cfg.append({"id": zone, "name": zinfo["name"],
                         "center": [round(layout["center"][0], 4), round(layout["center"][1], 4)]})
        print(f"  {zone:<12} {len(layout['fields'])} fields, {len(nodes)} nodes, {len(edges)} edges")
    write_json(data_dir / "farmers.json", farmers, pretty=True)

    # ---- precompute networks / energy / KPIs for the latest months (others are computed live)
    months_pre = [m for m in (month_add(fc_month, -k) for k in range(a.precompute - 1, -1, -1)) if m >= FIRST_MONTH]
    for zone, layout in layouts.items():
        t1 = time.perf_counter()
        area = {f["field_id"]: f["area_ha"] for f in layout["fields"]}
        irr = {f: True for f in area}
        held_out = kpi_svc.held_out_mae(predictions[predictions.zone == zone])
        wx = weather[weather.zone == zone].set_index("month")
        for month in months_pre:
            st_type = "forecast" if month == fc_month else "current"
            rows = predictions[(predictions.zone == zone) & (predictions.month == month) & (predictions.status_type == st_type)]
            cls_map = dict(zip(rows["field_id"], rows["stress_class"]))
            demand_w = {f: (float(weights[int(c)]) if pd.notna(c) else 0.0) for f, c in ((f, cls_map.get(f)) for f in area)}
            res = physarum.compute_network(zone=zone, month=month, nodes=layout["nodes"], edges=layout["edges"],
                                           demand_weights=demand_w, params=params, cost=cost, irrigated=irr)
            network = res["network"]
            write_json(data_dir / f"network_{zone}_{month}.json", network)
            total_demand = sum(area[f] * wv for f, wv in demand_w.items())
            date = f"{month}-15"
            day = energy_svc.build_energy_day(zone, date, lat=layout["center"][1], lon=layout["center"][0],
                                              ghi_kwh_m2_day=float(wx.loc[month, "solar_kwh_m2_day"]),
                                              et0_mm_month=float(wx.loc[month, "et0_mm"]),
                                              total_demand_ha_eq=total_demand, station=station)
            write_json(data_dir / f"energy_{zone}_{date}.json", day, pretty=True)
            saved = physarum.water_saved_from_network(network, area, irr)
            cls_list = [None if pd.isna(cls_map.get(f)) else int(cls_map.get(f)) for f in area]
            counts, hectares = kpi_svc.class_breakdown(cls_list, list(area.values()))
            if st_type == "current":
                mae = kpi_svc.forecast_mae(rows["ndmi_obs"].to_numpy(float), rows["ndmi_pred"].to_numpy(float))
            else:
                mae = held_out
            write_json(data_dir / f"kpis_{zone}_{month}.json",
                       kpi_svc.build_kpis(zone, month, counts, hectares, saved, day["summary"]["solar_share_pct"], mae), pretty=True)
        print(f"  {zone:<12} networks {len(months_pre)} months in {time.perf_counter() - t1:.1f}s ({res['compute_ms']:.0f} ms/run)")

    # ---- model outputs for /api/model/*
    plan.to_csv(data_dir / "model" / "plan.csv", index=False)
    shutil.copy(pipe / "models" / "metrics.json", data_dir / "model" / "metrics.json")
    shutil.copy(pipe / "models" / "feature_importance.csv", data_dir / "model" / "feature_importance.csv")
    for p in (pipe / "figures").glob("*.png"):
        shutil.copy(p, data_dir / "model" / "figures" / p.name)

    metrics = json.loads((pipe / "models" / "metrics.json").read_text(encoding="utf-8"))
    out = dict(user_cfg)
    out["zones"] = zone_cfg
    out["months"] = {"first_observed": FIRST_MONTH, "last_observed": last_month, "forecast_horizon": 1}
    out["demand_weights"] = cfg["demand_weights"]
    out["class_thresholds"] = {
        "note": "Real pipeline: z = (NDMI - field weekly normal) / field sd; cuts from 1D k-means (k=4) on deficits. "
                "Red also needs a deficit the week before and an NDVI drop > 0.03.",
        "z_cuts": metrics.get("stress_thresholds_z"),
    }
    out["data_source"] = "pipeline"
    out["pipeline"] = {"state_week": str(state_week.date()), "forecast_week": forecast_week,
                       "forecast_month_key": fc_month, "model": "LightGBM (NDMI next week)",
                       "imported_at": time.strftime("%Y-%m-%d %H:%M"), "sources_hypothetical": True}
    out.setdefault("ui", {})["default_zone"] = "kairouan"
    write_json(cfg_path, out, pretty=True)
    print(f"done in {time.perf_counter() - t0:.0f}s -> {data_dir}")


if __name__ == "__main__":
    main()
