"""Farmer view: one farm's fields, the water routes that reach them, and a plain irrigation plan.

A farmer only sees their own parcels. Each parcel that needs water gets a route: the path the
Physarum network uses to bring water from the source to it (strongest canals first). The farmer
can switch a parcel's route off (its demand is set to 0 and Physarum recomputes the zone network)
or close / reopen individual canals (block-edge, warm-started reroute).
"""
from __future__ import annotations

import networkx as nx
import pandas as pd

from ..errors import NotFound
from .data_provider import DataProvider
from .fields import field_collection
from .network_service import NetworkService
from .util import days_in_month, month_add


def get_farmer(provider: DataProvider, farmer_id: str) -> dict:
    for f in provider.farmers():
        if f["farmer_id"] == farmer_id:
            return f
    raise NotFound(f"Unknown farmer '{farmer_id}'")


def list_farmers(provider: DataProvider) -> list[dict]:
    """All farms with size and how many parcels need water in the last observed month."""
    last = provider.config()["months"]["last_observed"]
    out = []
    for zone in provider.zone_ids():
        area = {f["properties"]["field_id"]: float(f["properties"]["area_ha"]) for f in provider.fields_geojson(zone)["features"]}
        rows = provider.predictions_slice(zone, last, "current")
        needs = {fid for fid, c in zip(rows["field_id"], rows["stress_class"]) if not pd.isna(c) and int(c) >= 1}
        for f in provider.farmers():
            if f["zone"] != zone:
                continue
            out.append(
                {
                    "farmer_id": f["farmer_id"],
                    "name": f["name"],
                    "zone": zone,
                    "field_count": len(f["field_ids"]),
                    "area_ha": round(sum(area.get(i, 0.0) for i in f["field_ids"]), 1),
                    "fields_need_water": sum(1 for i in f["field_ids"] if i in needs),
                }
            )
    return out


def _et0_day(provider: DataProvider, zone: str, month: str) -> float:
    w = provider.weather_monthly()
    row = w[(w["zone"] == zone) & (w["month"] == month)]
    return float(row.iloc[0]["et0_mm"]) / days_in_month(month) if not row.empty else 5.0


def farm_plan(provider: DataProvider, network: NetworkService, farmer_id: str, month: str, status_type: str) -> dict:
    from . import farm_local  # farms created by onboarding get a plan limited to their own outline

    own = farm_local.onboarded_farm(farmer_id)
    if own is not None:
        return farm_local.farm_plan_local(provider, own, month, status_type)
    farmer = get_farmer(provider, farmer_id)
    zone, ids = farmer["zone"], list(farmer["field_ids"])
    order = {fid: i for i, fid in enumerate(ids)}
    cfg = provider.config()
    labels, weights = cfg["class_labels"], cfg["demand_weights"]
    hours = list((cfg.get("energy") or {}).get("irrigation_hours") or [5, 6, 7, 18, 19, 20, 21])

    fc = field_collection(provider, zone, month, status_type)
    features = sorted((f for f in fc["features"] if f["properties"]["field_id"] in order), key=lambda f: order[f["properties"]["field_id"]])

    scenario = network.store.get(zone, month)
    overrides = dict(scenario.demand_overrides) if scenario else {}
    result = network.current(zone, month)
    api = network.to_api(zone, month, result)
    blocked = network.blocked_edges(zone, month)
    nodes, edges = network.graph(zone)
    ends = {e["edge_id"]: (e["from"], e["to"]) for e in edges}
    sources = [n["node_id"] for n in nodes if n.get("type") == "source"]

    # usable canals: kept by Physarum and not closed; strong (high conductivity) canals are "short"
    G = nx.Graph()
    for feat in api["edges"]["features"]:
        p = feat["properties"]
        if p["kept"] and not p["blocked"] and p["edge_id"] in ends:
            a, b = ends[p["edge_id"]]
            G.add_edge(a, b, w=p["length_m"] / max(p["conductivity"], 1e-4), id=p["edge_id"])
    srcs = {s for s in sources if s in G}

    # class one month later (observed if available, else forecast) for the "next month" hint
    nxt = month_add(month, 1)
    nxt_rows = provider.predictions_slice(zone, nxt, "current")
    if nxt_rows.empty:
        nxt_rows = provider.predictions_slice(zone, nxt, "forecast")
    next_class = {fid: (None if pd.isna(c) else int(c)) for fid, c in zip(nxt_rows["field_id"], nxt_rows["stress_class"])}

    et0_day = _et0_day(provider, zone, month)
    serves: dict[str, list[str]] = {}
    out_features = []
    for i, feat in enumerate(features, start=1):
        p = dict(feat["properties"])
        fid = p["field_id"]
        cls = p["stress_class"] if p["is_irrigated"] else None
        w = float(weights.get(labels[cls], 0.0)) if cls is not None else 0.0
        needs = w > 0
        active = not (fid in overrides and float(overrides[fid]) == 0.0)
        reachable = False
        if needs and active and srcs and fid in G:
            try:
                _, path = nx.multi_source_dijkstra(G, srcs, target=fid, weight="w")
                reachable = True
                for a, b in zip(path[:-1], path[1:]):
                    serves.setdefault(G[a][b]["id"], []).append(fid)
            except nx.NetworkXNoPath:
                reachable = False
        p.update(
            {
                "label": i,
                "needs_water": needs,
                "route_active": active,
                "reachable": reachable,
                # daily need: area x class weight x ET0 (mm/day) x 10 m3 per mm.ha  (modeled)
                "need_m3_day": round(float(p["area_ha"]) * w * et0_day * 10.0) if needs else 0,
                "next_class": next_class.get(fid) if p["is_irrigated"] else None,
            }
        )
        out_features.append({"type": "Feature", "geometry": feat["geometry"], "properties": p})

    route_features = []
    for feat in api["edges"]["features"]:
        eid = feat["properties"]["edge_id"]
        if eid in serves or eid in blocked:
            route_features.append({**feat, "properties": {**feat["properties"], "serves": serves.get(eid, [])}})

    coords = [c for f in out_features for ring in f["geometry"]["coordinates"] for c in (ring if f["geometry"]["type"] == "Polygon" else [])]
    coords += [c for f in route_features if f["properties"]["serves"] for c in f["geometry"]["coordinates"]]
    lons, lats = [c[0] for c in coords], [c[1] for c in coords]
    props = [f["properties"] for f in out_features]
    return {
        "farmer": {**farmer, "area_ha": round(sum(float(p["area_ha"]) for p in props), 1)},
        "month": month,
        "status_type": status_type,
        "fields": {"type": "FeatureCollection", "features": out_features},
        "routes": {"type": "FeatureCollection", "features": route_features},
        "sources": api["sources"],
        "summary": {
            "fields_total": len(props),
            "fields_need_water": sum(1 for p in props if p["needs_water"]),
            "fields_watered": sum(1 for p in props if p["needs_water"] and p["route_active"] and p["reachable"]),
            "total_need_m3_day": sum(p["need_m3_day"] for p in props if p["route_active"] and p["reachable"]),
            "irrigation_hours": hours,
            "et0_mm_day": round(et0_day, 1),
        },
        "bbox": [min(lons), min(lats), max(lons), max(lats)] if coords else [],
    }


def set_route(provider: DataProvider, network: NetworkService, farmer_id: str, month: str, status_type: str, field_id: str, active: bool) -> dict:
    """Switch the water route of one parcel on (default demand) or off (demand 0), then recompute."""
    from . import farm_local

    own = farm_local.onboarded_farm(farmer_id)
    if own is not None:
        return farm_local.set_route_local(provider, own, month, status_type, field_id, active)
    farmer = get_farmer(provider, farmer_id)
    if field_id not in farmer["field_ids"]:
        raise NotFound(f"Field '{field_id}' does not belong to farmer '{farmer_id}'")
    network.recompute(farmer["zone"], month, None, {field_id: None if active else 0.0})
    return farm_plan(provider, network, farmer_id, month, status_type)
