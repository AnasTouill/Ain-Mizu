"""Watering plan scoped to ONE onboarded farm (data/farms.json): only the farmer's outline, his
sub-zones (crop + soil) and his own water sources. Nothing outside the farm is shown or planned.

- Stress class of a sub-zone: area-weighted class of the satellite fields (Sentinel-2 + LightGBM
  forecaster) that fall in it; nearest satellite field of the farm when none does.
- Network: Physarum (same solver as the zone network) on a small graph linking the farm's water
  sources and the sub-zone centroids (Delaunay + every source -> sub-zone link).
- Daily need (modeled): area x ET0 (mm/day) x 10 x crop coefficient x soil factor x class weight.
- Farmer what-if (route off, canal closed) is kept in memory per (farm, month).
"""
from __future__ import annotations

import dataclasses
import math
import threading

import networkx as nx
import numpy as np
import pandas as pd
from scipy.spatial import Delaunay

from ..errors import NotFound
from . import physarum, terrain
from .data_provider import DataProvider
from .onboarding import CROP_BY_ID, SOIL_BY_ID, area_ha, centroid, load_farms, point_in_polygon
from .util import days_in_month, haversine_m, month_add, native

FARM_SLOPE_PENALTY = 25.0  # farm canals: +25 % effective length per 1 % uphill
_state: dict[tuple[str, str], dict] = {}
_lock = threading.Lock()


def onboarded_farm(farm_id: str) -> dict | None:
    return next((f for f in load_farms() if f["farm_id"] == farm_id), None)


def _st(farm_id: str, month: str) -> dict:
    """Farmer choices (routes off, valves closed) come from the persisted control state."""
    from . import control

    c = control.load(farm_id)
    return {"off": set(c["disabled_routes"]), "blocked": set(c["closed_valves"])}


def _et0_day(provider: DataProvider, zone: str, month: str) -> float:
    w = provider.weather_monthly()
    row = w[(w["zone"] == zone) & (w["month"] == month)]
    return float(row.iloc[0]["et0_mm"]) / days_in_month(month) if not row.empty else 5.0


def _classes(provider: DataProvider, zone: str, month: str, status: str) -> dict[str, int | None]:
    rows = provider.predictions_slice(zone, month, status)
    if rows.empty and status == "current":
        rows = provider.predictions_slice(zone, month, "forecast")
    return {fid: native(c) for fid, c in zip(rows["field_id"], rows["stress_class"])}


def _sub_class(sub: dict, sat: list[dict], cls: dict) -> int | None:
    """Area-weighted satellite class of the detected fields inside a sub-zone."""
    poly = sub["polygon"]
    hits = []
    for f in sat:
        p = f["properties"]
        c = cls.get(p["field_id"])
        if c is None:
            continue
        ring = f["geometry"]["coordinates"][0]
        inside = point_in_polygon(p["centroid_lon"], p["centroid_lat"], poly) or any(point_in_polygon(x, y, poly) for x, y in ring[::3])
        if inside:
            hits.append((float(p["area_ha"]), int(c)))
    if not hits:
        lon, lat = centroid(poly)
        best = None
        for f in sat:
            p = f["properties"]
            c = cls.get(p["field_id"])
            if c is None:
                continue
            d = haversine_m(lon, lat, p["centroid_lon"], p["centroid_lat"])
            if best is None or d < best[0]:
                best = (d, int(c))
        return best[1] if best and best[0] < 1500 else None
    a = sum(h[0] for h in hits)
    return int(round(sum(h[0] * h[1] for h in hits) / a))


def _graph(farm: dict, cost: physarum.EdgeCostParams) -> tuple[list[dict], list[dict]]:
    """Routing graph over the WHOLE farm, so Physarum can grow shared trunks and branches.

    Nodes: the water sources, one node per sub-zone (its centroid) and a lattice of junctions
    covering the farm outline. Edges: Delaunay triangulation of all nodes, keeping only short
    edges that stay inside the outline. There is no direct source -> sub-zone link: water has to
    travel along the mesh, and Physarum decides which corridors survive.
    """
    from shapely.geometry import LineString, Point
    from shapely.geometry import Polygon as ShPolygon

    bnd = farm["boundary"]
    lon0, lat0 = centroid(bnd)
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110574.0
    to_xy = lambda lon, lat: ((lon - lon0) * kx, (lat - lat0) * ky)  # noqa: E731
    to_ll = lambda x, y: (lon0 + x / kx, lat0 + y / ky)  # noqa: E731
    outline = ShPolygon([to_xy(x, y) for x, y in bnd]).buffer(0)
    inside = outline.buffer(2.0)
    lons_, lats_ = [p[0] for p in bnd], [p[1] for p in bnd]
    ft = terrain.FarmTerrain(farm["zone"], (min(lons_), min(lats_), max(lons_), max(lats_)), to_xy)         if terrain.available(farm["zone"]) else None

    nodes = []
    for s in farm["water_sources"]:
        nodes.append({"node_id": s["source_id"], "zone": farm["zone"], "type": "source", "lon": s["lon"], "lat": s["lat"],
                      "elevation_m": 0.0, "capacity_m3_day": 2000.0, "planned": s["status"] == "planned"})
    for sz in farm["sub_zones"]:
        lon, lat = centroid(sz["polygon"])
        x, y = to_xy(lon, lat)
        if not outline.contains(Point(x, y)):  # concave sub-zone: use a point that is inside it
            rp = ShPolygon([to_xy(a, b) for a, b in sz["polygon"]]).buffer(0).representative_point()
            lon, lat = to_ll(rp.x, rp.y)
        nodes.append({"node_id": sz["sub_zone_id"], "zone": farm["zone"], "type": "field", "lon": lon, "lat": lat,
                      "elevation_m": 0.0, "area_ha": sz["area_ha"]})

    # junction lattice (triangular grid) inside the outline
    spacing = float(np.clip(math.sqrt(outline.area) / 14.0, 25.0, 220.0))
    minx, miny, maxx, maxy = outline.bounds
    k = 0
    row = 0
    y = miny + spacing / 2
    while y < maxy:
        x = minx + spacing / 2 + (spacing / 2 if row % 2 else 0.0)
        while x < maxx:
            if outline.contains(Point(x, y)) and not (ft and ft.in_builtup(x, y)):
                k += 1
                lon, lat = to_ll(x, y)
                nodes.append({"node_id": f"j_{k:04d}", "zone": farm["zone"], "type": "junction", "lon": lon, "lat": lat, "elevation_m": 0.0})
            x += spacing
        y += spacing * 0.866
        row += 1

    P = np.array([to_xy(nd["lon"], nd["lat"]) for nd in nodes])
    n = len(nodes)
    pairs: set[tuple[int, int]] = set()
    if n >= 3:
        try:
            tri = Delaunay(P)
            for simplex in tri.simplices:
                for a_, b_ in ((0, 1), (1, 2), (0, 2)):
                    i, j = int(simplex[a_]), int(simplex[b_])
                    pairs.add((min(i, j), max(i, j)))
        except Exception:  # degenerate (collinear) layouts
            pairs = {(i, j) for i in range(n) for j in range(i + 1, n)}
    else:
        pairs = {(i, j) for i in range(n) for j in range(i + 1, n)}
    max_len = spacing * 2.2
    keep = set()
    info: dict[tuple[int, int], dict] = {}
    for i, j in pairs:
        d = float(np.hypot(*(P[i] - P[j])))
        if (d <= max_len or n < 6) and inside.contains(LineString([P[i], P[j]])):
            t = ft.edge(tuple(P[i]), tuple(P[j])) if ft else None
            if t and t["blocked"]:
                continue  # no canal through built-up land / water bodies
            keep.add((i, j))
            if t:
                info[(i, j)] = t
    # never leave a node isolated: link it to its nearest neighbour
    G = nx.Graph()
    G.add_nodes_from(range(n))
    G.add_edges_from(keep)
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    main = set(comps[0]) if comps else set()
    for comp in comps[1:]:
        best = None
        for i in comp:
            for j in main:
                d = float(np.hypot(*(P[i] - P[j])))
                if best is None or d < best[0]:
                    best = (d, i, j)
        if best:
            keep.add((min(best[1], best[2]), max(best[1], best[2])))
            main |= set(comp)

    # elevation of every node (Copernicus DEM), orientation away from the nearest source
    for nd in nodes:
        z = terrain.elevation(farm["zone"], nd["lon"], nd["lat"]) if ft else None
        nd["elevation_m"] = round(z, 1) if z is not None else 0.0
    src_xy = np.array([P[i] for i, nd in enumerate(nodes) if nd["type"] == "source"]) if any(nd["type"] == "source" for nd in nodes) else P[:1]
    d_src = np.min(np.linalg.norm(P[:, None, :] - src_xy[None, :, :], axis=2), axis=1)
    slope_cost = dataclasses.replace(cost, slope_penalty_a=FARM_SLOPE_PENALTY)
    edges = []
    for k2, (i, j) in enumerate(sorted(keep), start=1):
        if d_src[j] < d_src[i]:
            i, j = j, i
        a, b = nodes[i], nodes[j]
        length = max(float(np.hypot(*(P[i] - P[j]))), 1.0)
        t = info.get((min(i, j), max(i, j))) or (ft.edge(tuple(P[i]), tuple(P[j])) if ft else None)
        existing = bool(t and t["follows_canal"])
        loss = 0.03 if existing else cost.default_loss_rate
        uphill = max(0.0, (b["elevation_m"] - a["elevation_m"]) / length) if ft else 0.0
        mult = (t["cost_mult"] if t else 1.0) * (5.0 if t and t["blocked"] else 1.0)  # forced link through an obstacle
        edges.append({"edge_id": f"c_{k2:04d}", "zone": farm["zone"], "from": a["node_id"], "to": b["node_id"],
                      "length_m": round(length, 1), "uphill_slope": round(uphill, 4), "loss_rate": loss,
                      "effective_length": round(physarum.effective_length(length, uphill, loss, existing, slope_cost) * mult, 1),
                      "is_existing_canal": existing, "blocked": False, "cost_mult": mult,
                      "road_crossings": t["road_crossings"] if t else 0, "built_frac": t["built_frac"] if t else 0.0})
    return nodes, edges


def farm_plan_local(provider: DataProvider, farm: dict, month: str, status_type: str) -> dict:
    cfg = provider.config()
    labels, weights = cfg["class_labels"], cfg["demand_weights"]
    hours = list((cfg.get("energy") or {}).get("irrigation_hours") or [5, 6, 7, 18, 19, 20, 21])
    zone = farm["zone"]
    sat = [f for f in provider.fields_geojson(zone)["features"] if f["properties"]["field_id"] in set(farm["field_ids"])]
    cls_now = _classes(provider, zone, month, status_type)
    nxt = month_add(month, 1)
    cls_next = _classes(provider, zone, nxt, "current") or _classes(provider, zone, nxt, "forecast")
    if not any(v is not None for v in cls_next.values()):
        cls_next = _classes(provider, zone, nxt, "forecast")
    et0 = _et0_day(provider, zone, month)
    st = _st(farm["farm_id"], month)

    cost = dataclasses.replace(physarum.EdgeCostParams.from_dict(cfg["edge_cost"]), slope_penalty_a=FARM_SLOPE_PENALTY)
    params = physarum.PhysarumParams.from_dict(cfg["physarum"])
    nodes, edges = _graph(farm, cost)
    pos = {nd["node_id"]: [nd["lon"], nd["lat"]] for nd in nodes}

    subs, demand = [], {}
    for i, sz in enumerate(farm["sub_zones"], start=1):
        crop = CROP_BY_ID.get(sz["crop"], {"need_mm": 500, "fr": sz["crop"]})
        kc = 0.0 if crop["need_mm"] == 0 else min(1.25, max(0.35, crop["need_mm"] / 900.0))
        soil = SOIL_BY_ID.get(sz["soil"], {"factor": 1.0})["factor"]
        c = _sub_class(sz, sat, cls_now)
        w = float(weights.get(labels[c], 0.0)) if c is not None else 0.0
        needs = w > 0 and kc > 0
        active = sz["sub_zone_id"] not in st["off"]
        demand[sz["sub_zone_id"]] = w if (needs and active) else 0.0
        subs.append((i, sz, crop, kc, soil, c, w, needs, active, _sub_class(sz, sat, cls_next)))

    res = physarum.compute_network(zone=farm["farm_id"], month=month, nodes=nodes, edges=edges, demand_weights=demand,
                                   params=params, cost=cost, blocked=st["blocked"], irrigated={k: True for k in demand})
    by_id = {e["edge_id"]: e for e in res["network"]["edges"]}
    G = nx.Graph()
    edge_feats = []
    for e in edges:
        r = by_id.get(e["edge_id"], {})
        flow = float(r.get("flow") or 0.0)
        blocked = e["edge_id"] in st["blocked"]
        kept = bool(r.get("kept")) and not blocked
        a, b = pos[e["from"]], pos[e["to"]]
        props = {"edge_id": e["edge_id"], "flow": round(abs(flow), 4), "conductivity": round(float(r.get("conductivity") or 0.0), 4),
                 "road_crossings": e.get("road_crossings", 0), "follows_canal": e.get("is_existing_canal", False),
                 "uphill_slope": e.get("uphill_slope", 0.0),
                 "kept": kept, "blocked": blocked, "length_m": e["length_m"]}
        if kept:
            G.add_edge(e["from"], e["to"], w=e["length_m"] / max(props["conductivity"], 1e-4), id=e["edge_id"])
        edge_feats.append((props, [a, b] if flow >= 0 else [b, a]))
    srcs = [s["source_id"] for s in farm["water_sources"] if s["source_id"] in G]

    serves: dict[str, list[str]] = {}
    features = []
    for i, sz, crop, kc, soil, c, w, needs, active, c_next in subs:
        sid = sz["sub_zone_id"]
        reachable = False
        if needs and active and srcs and sid in G:
            try:
                _, path = nx.multi_source_dijkstra(G, srcs, target=sid, weight="w")
                reachable = True
                for a, b in zip(path[:-1], path[1:]):
                    serves.setdefault(G[a][b]["id"], []).append(sid)
            except nx.NetworkXNoPath:
                pass
        features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [sz["polygon"]]}, "properties": {
            "field_id": sid, "label": i, "name": sz["name"], "crop": sz["crop"], "soil": sz["soil"],
            "area_ha": sz["area_ha"], "is_irrigated": True, "stress_class": c, "stress_score": None,
            "demand_score": w, "ndmi_pred": None, "ndmi_obs": None, "status_type": status_type,
            "horizon": 0 if status_type == "current" else 1,
            "needs_water": needs, "route_active": active, "reachable": reachable,
            "need_m3_day": round(sz["area_ha"] * et0 * 10.0 * kc * soil * w) if needs else 0,
            "next_class": c_next,
        }})

    routes = [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords},
               "properties": {**p, "serves": serves.get(p["edge_id"], [])}}
              for p, coords in edge_feats if p["edge_id"] in serves or p["blocked"]]
    props = [f["properties"] for f in features]
    lons = [p[0] for p in farm["boundary"]]
    lats = [p[1] for p in farm["boundary"]]
    return {
        "farmer": {"farmer_id": farm["farm_id"], "name": farm["name"], "zone": zone,
                   "field_ids": [s["sub_zone_id"] for s in farm["sub_zones"]], "area_ha": round(farm["area_ha"], 1)},
        "month": month,
        "status_type": status_type,
        "fields": {"type": "FeatureCollection", "features": features},
        "routes": {"type": "FeatureCollection", "features": routes},
        "sources": [{"node_id": s["source_id"], "lon": s["lon"], "lat": s["lat"], "capacity_m3_day": None} for s in farm["water_sources"]],
        "summary": {
            "fields_total": len(props),
            "fields_need_water": sum(1 for p in props if p["needs_water"]),
            "fields_watered": sum(1 for p in props if p["needs_water"] and p["route_active"] and p["reachable"]),
            "total_need_m3_day": sum(p["need_m3_day"] for p in props if p["route_active"] and p["reachable"]),
            "irrigation_hours": hours,
            "et0_mm_day": round(et0, 1),
        },
        "bbox": [min(lons), min(lats), max(lons), max(lats)],
        "boundary": farm["boundary"],
        "farm_scoped": True,
        "fields_unserved": [p["field_id"] for p in props if p["needs_water"] and p["route_active"] and not p["reachable"]],
        "terrain": {
            "available": terrain.available(zone),
            "elevation_min_m": min((nd["elevation_m"] for nd in nodes), default=None),
            "elevation_max_m": max((nd["elevation_m"] for nd in nodes), default=None),
            "route_length_m": round(sum(f["properties"]["length_m"] for f in routes)),
            "route_road_crossings": sum(f["properties"]["road_crossings"] for f in routes),
            "route_on_existing_canals_m": round(sum(f["properties"]["length_m"] for f in routes if f["properties"]["follows_canal"])),
            "route_max_uphill_pct": round(100 * max((f["properties"]["uphill_slope"] for f in routes), default=0.0), 1),
            "junctions_removed_builtup": True,
        },
    }


def set_route_local(provider: DataProvider, farm: dict, month: str, status_type: str, sub_id: str, active: bool,
                    user: dict | None = None) -> dict:
    from . import control

    if sub_id not in {s["sub_zone_id"] for s in farm["sub_zones"]}:
        raise NotFound(f"Sub-zone '{sub_id}' is not part of farm '{farm['farm_id']}'")
    with _lock:
        c = control.load(farm["farm_id"])
        off = set(c["disabled_routes"])
        (off.discard if active else off.add)(sub_id)
        c["disabled_routes"] = sorted(off)
        control.adapter_for(c).set_valve(farm["farm_id"], f"rt_{sub_id}", active)
        control.touch(c, user)
        control.save(c)
        control.log(farm["farm_id"], user["user_id"] if user else None, "route_on" if active else "route_off", {"sub_zone_id": sub_id})
    return farm_plan_local(provider, farm, month, status_type)


def block_edge_local(provider: DataProvider, farm: dict, month: str, status_type: str, edge_id: str, blocked: bool,
                     user: dict | None = None) -> dict:
    from . import control

    with _lock:
        c = control.load(farm["farm_id"])
        closed = set(c["closed_valves"])
        (closed.add if blocked else closed.discard)(edge_id)
        c["closed_valves"] = sorted(closed)
        control.adapter_for(c).set_valve(farm["farm_id"], edge_id, not blocked)
        control.touch(c, user)
        control.save(c)
        control.log(farm["farm_id"], user["user_id"] if user else None, "valve_close" if blocked else "valve_open", {"valve_id": edge_id})
    return farm_plan_local(provider, farm, month, status_type)
