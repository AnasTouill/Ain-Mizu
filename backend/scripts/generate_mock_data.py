#!/usr/bin/env python
"""
Physarum-Grid mock data generator (ARCHITECTURE.md section 17).

Writes every file of section 13 for the three zones, deterministically (seeded):

    config.json                       (kept; class thresholds + data_source filled in)
    fields_{zone}.geojson             80-120 irregular fields per zone, ~70 % irrigated
    field_monthly.parquet             2018-01 .. last observed month
    weather_monthly.parquet           observed + forecast months
    predictions.parquet               current rows + 3 forecast months
    graph_nodes_{zone}.json           sources, junctions, fields
    graph_edges_{zone}.json           k-nearest-neighbour edges (k = 5)
    network_{zone}_{month}.json       computed with the REAL app/services/physarum.py
    energy_{zone}_{YYYY-MM}-15.json   computed with app/services/energy.py (LP)
    kpis_{zone}_{month}.json          computed with app/services/kpis.py

THE DATA IS SYNTHETIC. It stands in for the real pipeline output (same schemas, same
file names) so the platform runs before the pipeline exists.

Usage (from the repository root):
    python backend/scripts/generate_mock_data.py
    python backend/scripts/generate_mock_data.py --seed 7 --data-dir some/other/folder
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
from scipy.spatial import Delaunay, cKDTree

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import DEFAULT_CONFIG, REPO_DIR, deep_merge  # noqa: E402
from app.services import energy as energy_svc  # noqa: E402
from app.services import kpis as kpi_svc  # noqa: E402
from app.services import physarum  # noqa: E402
from app.services.util import (  # noqa: E402
    month_add,
    month_range,
    polygon_area_m2,
    polygon_centroid,
    to_lonlat,
)

if hasattr(sys.stdout, "reconfigure"):  # never crash on non-ASCII paths in a cp1252 console
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# --------------------------------------------------------------------------- zone profiles

ZONE_PROFILES: dict[str, dict] = {
    "kairouan": {
        "prefix": "kai",
        "n_fields": (100, 116),
        "base_elev": 68.0,
        "clusters": 3,
        "cluster_sigma": (850.0, 1300.0),
        "n_sources": 2,
        "ndvi_irr": (0.40, 0.62),
        "ndvi_rain": (0.24, 0.38),
        "rain_amp": (0.10, 0.17),
        "climate": {"rain_annual": 290.0, "t_mean": (19.3, 9.4), "t_spread": (6.8, 2.2), "et0": (118.0, 82.0), "solar": (5.35, 2.45)},
        "drought_mult": 1.0,
    },
    "sidi_bouzid": {
        "prefix": "sib",
        "n_fields": (88, 104),
        "base_elev": 352.0,
        "clusters": 3,
        "cluster_sigma": (900.0, 1400.0),
        "n_sources": 2,
        "ndvi_irr": (0.42, 0.63),
        "ndvi_rain": (0.22, 0.36),
        "rain_amp": (0.10, 0.16),
        "climate": {"rain_annual": 230.0, "t_mean": (19.0, 9.6), "t_spread": (7.5, 2.5), "et0": (124.0, 88.0), "solar": (5.45, 2.40)},
        "drought_mult": 1.1,
    },
    "kebili": {
        "prefix": "keb",
        "n_fields": (92, 108),
        "base_elev": 34.0,
        "clusters": 2,
        "cluster_sigma": (520.0, 820.0),
        "n_sources": 1,
        "ndvi_irr": (0.52, 0.70),
        "ndvi_rain": (0.09, 0.17),
        "rain_amp": (0.02, 0.05),
        "climate": {"rain_annual": 95.0, "t_mean": (21.8, 11.0), "t_spread": (8.0, 3.2), "et0": (160.0, 122.0), "solar": (5.85, 2.30)},
        "drought_mult": 0.85,
    },
}
RAIN_DISTRIBUTION = [0.11, 0.09, 0.11, 0.09, 0.06, 0.03, 0.01, 0.03, 0.10, 0.12, 0.12, 0.13]

# Synthetic droughts: (start, peak start, peak end, end, severity). The last one develops at the
# end of the record and carries into the forecast window (a business-as-usual outlook).
DROUGHTS = [
    ("2020-02", "2020-04", "2020-06", "2020-09", 0.45),
    ("2022-09", "2023-01", "2023-06", "2023-10", 1.00),
    ("2026-05", "2026-12", "2027-01", "2027-03", 0.95),
]
N_JUNCTIONS = 4
GRID_SPACING_M = 320.0


def month_idx(month: str) -> int:
    return int(month[:4]) * 12 + int(month[5:7]) - 1


def drought_index(month: str, mult: float) -> float:
    t, value = month_idx(month), 0.0
    for start, peak0, peak1, end, severity in DROUGHTS:
        s, a, b, e = map(month_idx, (start, peak0, peak1, end))
        if t <= s or t >= e:
            v = 0.0
        elif t < a:
            v = (t - s) / (a - s)
        elif t <= b:
            v = 1.0
        else:
            v = (e - t) / (e - b)
        value = max(value, severity * v)
    return float(min(1.0, value * mult))


# --------------------------------------------------------------------------- terrain


class Dem:
    """Synthetic DEM: a gentle plane sloping away from the main source plus a few hills."""

    def __init__(self, base: float, origin: tuple[float, float], downhill: np.ndarray, grad_m_per_km: float, hills: list):
        self.base, self.origin, self.dir, self.grad, self.hills = base, origin, downhill, grad_m_per_km / 1000.0, hills

    def z(self, x: float, y: float) -> float:
        along = (x - self.origin[0]) * self.dir[0] + (y - self.origin[1]) * self.dir[1]
        h = sum(a * math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * s * s)) for hx, hy, a, s in self.hills)
        return self.base - self.grad * along + h

    def slope_deg(self, x: float, y: float) -> float:
        gx, gy = -self.grad * self.dir[0], -self.grad * self.dir[1]
        for hx, hy, a, s in self.hills:
            e = a * math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / (2 * s * s))
            gx += e * -(x - hx) / (s * s)
            gy += e * -(y - hy) / (s * s)
        return math.degrees(math.atan(math.hypot(gx, gy)))


# --------------------------------------------------------------------------- layout


def field_polygon(cx: float, cy: float, rng: np.random.Generator) -> list[tuple[float, float]]:
    """Irregular field: jittered, slightly rotated rectangle with 0-4 extra vertices."""
    target = float(np.clip(rng.lognormal(math.log(2.6), 0.6), 0.5, 8.0)) * 10_000.0
    ratio = rng.uniform(0.6, 1.7)
    w = min(math.sqrt(target * ratio), 285.0)
    h = min(target / w, 285.0)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    pts: list[tuple[float, float]] = []
    for i in range(4):
        (x0, y0), (x1, y1) = corners[i], corners[(i + 1) % 4]
        pts.append((x0, y0))
        if rng.random() < 0.45:
            t = rng.uniform(0.3, 0.7)
            mx, my = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
            nx_, ny_ = (y1 - y0), -(x1 - x0)
            norm = math.hypot(nx_, ny_) or 1.0
            k = rng.uniform(-0.06, 0.08) * min(w, h)
            pts.append((mx + nx_ / norm * k, my + ny_ / norm * k))
    jit = 0.05 * min(w, h)
    pts = [(x + rng.uniform(-jit, jit), y + rng.uniform(-jit, jit)) for x, y in pts]
    th = math.radians(rng.uniform(-14.0, 14.0))
    c, s = math.cos(th), math.sin(th)
    pts = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]
    area = polygon_area_m2(pts)
    if area < 5_000 or area > 80_000:  # keep 0.5 .. 8 ha
        f = math.sqrt(min(max(area, 5_000), 80_000) / area)
        pts = [(cx + (x - cx) * f, cy + (y - cy) * f) for x, y in pts]
    return pts


def make_layout(zone: str, center: list[float], prof: dict, rng: np.random.Generator) -> dict:
    lon0, lat0 = float(center[0]), float(center[1])
    n_fields = int(rng.integers(prof["n_fields"][0], prof["n_fields"][1] + 1))
    clusters = []
    for _ in range(prof["clusters"]):
        r, th = rng.uniform(250.0, 1700.0), rng.uniform(0.0, 2 * math.pi)
        clusters.append((r * math.cos(th), r * math.sin(th), rng.uniform(*prof["cluster_sigma"])))

    grid = np.arange(-3200.0, 3200.0 + 1.0, GRID_SPACING_M)
    gx, gy = np.meshgrid(grid, grid)
    cells = np.column_stack([gx.ravel(), gy.ravel()]) + rng.uniform(-35.0, 35.0, size=(gx.size, 2))
    weight = np.full(len(cells), 0.012)
    for cx, cy, s in clusters:
        weight += np.exp(-((cells[:, 0] - cx) ** 2 + (cells[:, 1] - cy) ** 2) / (2 * s * s))
    field_cells = rng.choice(len(cells), size=n_fields, replace=False, p=weight / weight.sum())
    taken = set(int(c) for c in field_cells)

    sources = []
    for i in range(prof["n_sources"]):
        cx, cy, _ = clusters[i % len(clusters)]
        off, th = rng.uniform(150.0, 450.0), rng.uniform(0.0, 2 * math.pi)
        tx, ty = cx + off * math.cos(th), cy + off * math.sin(th)
        free = np.array([c for c in range(len(cells)) if c not in taken])
        best = int(free[np.argmin((cells[free, 0] - tx) ** 2 + (cells[free, 1] - ty) ** 2)])
        taken.add(best)
        cap = float(round(rng.uniform(700.0, 1400.0), -1))
        sources.append((f"src_basin_{i + 1:02d}", float(cells[best, 0]), float(cells[best, 1]), cap))

    free = np.array([c for c in range(len(cells)) if c not in taken])
    pj = weight[free] / weight[free].sum()
    junction_cells = rng.choice(free, size=N_JUNCTIONS, replace=False, p=pj)
    junctions = [(f"jct_{i + 1:02d}", float(cells[c, 0]), float(cells[c, 1])) for i, c in enumerate(junction_cells)]

    # terrain: slopes away from the main source towards the fields
    fx, fy = cells[field_cells, 0].mean(), cells[field_cells, 1].mean()
    direction = np.array([fx - sources[0][1], fy - sources[0][2]])
    direction = direction / (np.linalg.norm(direction) or 1.0)
    hills = [
        (rng.uniform(-2500, 2500), rng.uniform(-2500, 2500), rng.choice([-1, 1]) * rng.uniform(3.0, 9.0), rng.uniform(600, 1400))
        for _ in range(3)
    ]
    dem = Dem(prof["base_elev"], (sources[0][1], sources[0][2]), direction, rng.uniform(2.5, 5.0), hills)

    # fields, numbered from the north-west corner
    order = sorted(field_cells, key=lambda c: (-round(cells[c, 1] / GRID_SPACING_M), cells[c, 0]))
    fields = []
    for k, c in enumerate(order, start=1):
        pts = field_polygon(float(cells[c, 0]), float(cells[c, 1]), rng)
        cx, cy = polygon_centroid(pts)
        d_src = min(math.hypot(cx - s[1], cy - s[2]) for s in sources)
        p_irr = 0.5 + 0.38 * math.exp(-(d_src**2) / (2 * 1500.0**2))
        ring = [to_lonlat(x, y, lon0, lat0) for x, y in pts]
        ring.append(ring[0])
        clon, clat = to_lonlat(cx, cy, lon0, lat0)
        fields.append(
            {
                "field_id": f"{prof['prefix']}_{k:04d}",
                "x": cx,
                "y": cy,
                "ring": [[round(lon, 6), round(lat, 6)] for lon, lat in ring],
                "area_ha": round(polygon_area_m2(pts) / 10_000.0, 2),
                "centroid_lon": round(clon, 6),
                "centroid_lat": round(clat, 6),
                "is_irrigated": bool(rng.random() < p_irr),
                "mean_slope_deg": round(dem.slope_deg(cx, cy) + rng.uniform(0.0, 0.5), 1),
                "elevation_m": round(dem.z(cx, cy), 1),
            }
        )
    return {"zone": zone, "center": (lon0, lat0), "fields": fields, "sources": sources, "junctions": junctions, "dem": dem}


def fields_geojson(zone: str, layout: dict) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [f["ring"]]},
                "properties": {
                    "field_id": f["field_id"],
                    "zone": zone,
                    "area_ha": f["area_ha"],
                    "centroid_lon": f["centroid_lon"],
                    "centroid_lat": f["centroid_lat"],
                    "is_irrigated": f["is_irrigated"],
                    "mean_slope_deg": f["mean_slope_deg"],
                    "elevation_m": f["elevation_m"],
                },
            }
            for f in layout["fields"]
        ],
    }


# --------------------------------------------------------------------------- graph


FIRST_NAMES = ["Mohamed", "Fatma", "Ahmed", "Amel", "Ali", "Leila", "Salah", "Nadia", "Hedi", "Rim", "Khaled",
               "Sonia", "Sami", "Imen", "Habib", "Samia", "Youssef", "Mouna", "Karim", "Hela", "Walid", "Olfa"]


def make_farmers(zone: str, prefix: str, layout: dict, rng: np.random.Generator) -> list[dict]:
    """Group neighbouring fields into farms of 2-7 parcels (fictional owners, synthetic data)."""
    fields = layout["fields"]
    pos = {f["field_id"]: (f["x"], f["y"]) for f in fields}
    unassigned = [f["field_id"] for f in fields]
    farmers, k = [], 0
    while unassigned:
        seed_id = unassigned[0]
        sx, sy = pos[seed_id]
        size = int(rng.integers(2, 8))
        near = sorted(unassigned, key=lambda fid: math.hypot(pos[fid][0] - sx, pos[fid][1] - sy))
        group = [fid for fid in near[:size] if math.hypot(pos[fid][0] - sx, pos[fid][1] - sy) < 900] or [seed_id]
        for fid in group:
            unassigned.remove(fid)
        k += 1
        name = f"{FIRST_NAMES[int(rng.integers(0, len(FIRST_NAMES)))]} {chr(65 + int(rng.integers(0, 26)))}."
        farmers.append({"farmer_id": f"{prefix}_farm_{k:02d}", "name": name, "zone": zone, "field_ids": group})
    return farmers


def make_graph(zone: str, layout: dict, cost: physarum.EdgeCostParams, rng: np.random.Generator):
    lon0, lat0 = layout["center"]
    dem: Dem = layout["dem"]
    nodes, pts = [], []
    for nid, x, y, cap in layout["sources"]:
        lon, lat = to_lonlat(x, y, lon0, lat0)
        nodes.append({"node_id": nid, "zone": zone, "type": "source", "lon": round(lon, 6), "lat": round(lat, 6),
                      "elevation_m": round(dem.z(x, y), 1), "capacity_m3_day": cap})
        pts.append((x, y))
    for nid, x, y in layout["junctions"]:
        lon, lat = to_lonlat(x, y, lon0, lat0)
        nodes.append({"node_id": nid, "zone": zone, "type": "junction", "lon": round(lon, 6), "lat": round(lat, 6),
                      "elevation_m": round(dem.z(x, y), 1)})
        pts.append((x, y))
    for f in layout["fields"]:
        nodes.append({"node_id": f["field_id"], "zone": zone, "type": "field", "lon": f["centroid_lon"],
                      "lat": f["centroid_lat"], "elevation_m": f["elevation_m"], "area_ha": f["area_ha"]})
        pts.append((f["x"], f["y"]))

    P = np.array(pts)
    n = len(P)
    _, idx = cKDTree(P).query(P, k=min(6, n))  # self + 5 nearest neighbours
    knn = {(min(i, int(j)), max(i, int(j))) for i in range(n) for j in idx[i][1:]}
    delaunay = set()
    for simplex in Delaunay(P).simplices:
        for a, b in ((0, 1), (1, 2), (0, 2)):
            i, j = int(simplex[a]), int(simplex[b])
            delaunay.add((min(i, j), max(i, j)))
    # kNN edges that are also Delaunay edges: same locality, but no crossing canals on the map
    pairs = knn & delaunay

    def length(e):
        return float(np.hypot(*(P[e[0]] - P[e[1]])))

    G = nx.Graph()
    G.add_nodes_from(range(n))
    G.add_edges_from(pairs)
    if not nx.is_connected(G):
        for e in sorted(delaunay - pairs, key=length):
            if not nx.has_path(G, *e):
                G.add_edge(*e)
                pairs.add(e)
                if nx.is_connected(G):
                    break
    for e in pairs:
        G.edges[e]["w"] = length(e)
    mst = {(min(a, b), max(a, b)) for a, b in nx.minimum_spanning_edges(G, weight="w", data=False)}

    src_xy = P[: len(layout["sources"])]
    d_src = np.min(np.linalg.norm(P[:, None, :] - src_xy[None, :, :], axis=2), axis=1)
    edges = []
    for k, (i, j) in enumerate(sorted(pairs), start=1):
        a, b = (i, j) if d_src[i] <= d_src[j] else (j, i)  # from = closer to a source
        length_m = round(length((i, j)), 1)
        uphill = round(max(0.0, (nodes[b]["elevation_m"] - nodes[a]["elevation_m"]) / max(length_m, 1.0)), 4)
        existing = bool(rng.random() < (0.42 if (i, j) in mst else 0.18))
        loss = round(rng.uniform(0.02, 0.05) if existing else rng.uniform(0.05, 0.10), 3)
        edges.append(
            {
                "edge_id": f"e_{k:04d}",
                "zone": zone,
                "from": nodes[a]["node_id"],
                "to": nodes[b]["node_id"],
                "length_m": length_m,
                "uphill_slope": uphill,
                "loss_rate": loss,
                "effective_length": round(physarum.effective_length(length_m, uphill, loss, existing, cost), 1),
                "is_existing_canal": existing,
                "blocked": False,
            }
        )
    return nodes, edges


# --------------------------------------------------------------------------- weather


def make_weather(zone: str, prof: dict, months: list[str], last_obs: str, dindex: dict, rng) -> pd.DataFrame:
    clim = prof["climate"]
    rows = []
    for month in months:
        m, d, forecast = int(month[5:7]), dindex[month], month > last_obs
        season_t = math.cos(2 * math.pi * (m - 7.4) / 12)
        rain = clim["rain_annual"] * RAIN_DISTRIBUTION[m - 1] * (1 - 0.8 * d) * (1.0 if forecast else rng.lognormal(0.0, 0.45))
        t_mean = clim["t_mean"][0] + clim["t_mean"][1] * season_t + 1.4 * d + (0.0 if forecast else rng.normal(0, 0.7))
        t_max = t_mean + clim["t_spread"][0] + clim["t_spread"][1] * season_t + (0.0 if forecast else rng.normal(0, 0.6))
        et0 = (clim["et0"][0] + clim["et0"][1] * math.cos(2 * math.pi * (m - 7) / 12)) * (1 + 0.07 * d)
        solar = (clim["solar"][0] + clim["solar"][1] * math.cos(2 * math.pi * (m - 6.5) / 12)) * (1 + 0.03 * d)
        if not forecast:
            et0 *= rng.normal(1.0, 0.04)
            solar *= rng.normal(1.0, 0.03)
        rows.append({"zone": zone, "month": month, "rain_mm": round(max(rain, 0.0), 1), "temp_mean_c": round(t_mean, 1),
                     "temp_max_c": round(t_max, 1), "et0_mm": round(et0, 1), "solar_kwh_m2_day": round(solar, 2)})
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- time series


def make_series(prof: dict, fields: list[dict], months: list[str], dindex: dict, weather: pd.DataFrame, rng):
    """True NDVI/NDMI per field (F x T observed months) + clouds and gap flags."""
    F, T = len(fields), len(months)
    cal = np.array([int(m[5:7]) for m in months])
    d = np.array([dindex[m] for m in months])
    irr = np.array([f["is_irrigated"] for f in fields])

    base_ndvi = np.where(irr, rng.uniform(*prof["ndvi_irr"], F), rng.uniform(*prof["ndvi_rain"], F))
    amp_ndvi = np.where(irr, rng.uniform(0.03, 0.08, F), rng.uniform(*prof["rain_amp"], F))
    peak = np.where(irr, rng.uniform(3.5, 4.8, F), rng.uniform(2.8, 3.8, F))
    base_ndmi = 0.55 * base_ndvi - 0.08 + rng.normal(0.0, 0.02, F)
    amp_ndmi = amp_ndvi * rng.uniform(0.8, 1.2, F)
    sens = np.where(irr, rng.uniform(0.5, 1.2, F), rng.uniform(1.0, 1.6, F))

    season = np.cos(2 * np.pi * (cal[None, :] - peak[:, None]) / 12.0)
    ndvi = base_ndvi[:, None] + amp_ndvi[:, None] * season
    ndmi = base_ndmi[:, None] + amp_ndmi[:, None] * season
    ndmi -= 0.012 * np.isin(cal, [7, 8])[None, :] * irr[:, None]  # summer heat on irrigated crops

    d_lag = np.concatenate([[0.0], d[:-1]])
    ndmi -= d[None, :] * sens[:, None] * 0.075 * np.where(irr, 0.8, 1.0)[:, None]
    ndvi -= d_lag[None, :] * sens[:, None] * 0.06

    # field-level stress episodes (pump failure, quota cut...) on irrigated fields
    episode = np.zeros((F, T))
    for i in np.flatnonzero(irr):
        t = 0
        while t < T:
            if rng.random() < 0.012:
                duration, depth = int(rng.integers(2, 5)), rng.uniform(0.06, 0.14)
                for k in range(duration):
                    if t + k < T:
                        episode[i, t + k] = depth * (k + 1) / duration
                if t + duration < T:
                    episode[i, t + duration] = depth * 0.4
                t += duration + 1
            else:
                t += 1
    ndmi -= episode
    ndvi -= np.concatenate([np.zeros((F, 1)), episode[:, :-1]], axis=1) * 0.7

    # rain anomalies matter for rainfed fields
    rain = weather.set_index("month").loc[months, "rain_mm"].to_numpy()
    clim_rain = np.array([prof["climate"]["rain_annual"] * RAIN_DISTRIBUTION[m - 1] for m in cal])
    ndmi += 0.01 * ((rain - clim_rain) / 50.0)[None, :] * (~irr)[:, None]

    e_ndmi, e_ndvi = np.zeros(F), np.zeros(F)
    for t in range(T):
        shock = rng.normal(0.0, 0.018, F)
        e_ndmi = 0.6 * e_ndmi + shock
        e_ndvi = 0.7 * e_ndvi + rng.normal(0.0, 0.011, F) + 0.25 * shock
        ndmi[:, t] += e_ndmi
        ndvi[:, t] += e_ndvi
    ndvi = np.clip(ndvi, 0.02, 0.92)
    ndmi = np.clip(ndmi, -0.35, 0.60)

    cloud = np.clip(rng.beta(0.7, 7.0, (F, T)) * np.where(np.isin(cal, [11, 12, 1, 2]), 1.9, 1.0)[None, :], 0.0, 1.0)
    gap = cloud > 0.55
    gap[:, 0] = gap[:, -1] = False
    for i, t in zip(*np.nonzero(gap)):  # linear gap filling
        ndvi[i, t] = 0.5 * (ndvi[i, t - 1] + ndvi[i, t + 1])
        ndmi[i, t] = 0.5 * (ndmi[i, t - 1] + ndmi[i, t + 1])
    return ndvi, ndmi, cloud, gap


def climatology(X: np.ndarray, cal: np.ndarray, floor: float = 0.02):
    """Per field and calendar month: leave-one-year-out mean/std for observed months, and
    all-years mean/std for forecast months ("field's normal for that month")."""
    F, T = X.shape
    mean, std = np.zeros((F, T)), np.zeros((F, T))
    all_mean, all_std = {}, {}
    for m in range(1, 13):
        idx = np.flatnonzero(cal == m)
        n = len(idx)
        if n == 0:
            continue
        S, SS = X[:, idx].sum(axis=1), (X[:, idx] ** 2).sum(axis=1)
        for j in idx:
            if n > 1:
                mu = (S - X[:, j]) / (n - 1)
                var = (SS - X[:, j] ** 2) / (n - 1) - mu**2
            else:
                mu, var = X[:, j], np.zeros(F)
            mean[:, j], std[:, j] = mu, np.sqrt(np.maximum(var, 0.0))
        all_mean[m] = S / n
        all_std[m] = np.maximum(np.sqrt(np.maximum(SS / n - (S / n) ** 2, 0.0)), floor)
    return mean, np.maximum(std, floor), all_mean, all_std


def stress_score(z: np.ndarray, zv: np.ndarray, trend: np.ndarray) -> np.ndarray:
    """Continuous 0..1 stress score: low NDMI vs normal, falling trend, low NDVI vs normal."""
    raw = 0.55 * (-z) + 0.25 * (-zv) + 0.20 * (-trend / 0.03)
    return 1.0 / (1.0 + np.exp(-1.1 * (raw - 0.9)))


def classify(score: np.ndarray, trend: np.ndarray, zv: np.ndarray, cuts) -> np.ndarray:
    """4 classes; red needs persistence (2 falling months or already orange) AND an NDVI drop."""
    c1, c2, c3 = cuts
    cls = np.digitize(score, [c1, c2, c3])
    prev_score = np.concatenate([score[:, :1], score[:, :-1]], axis=1)
    prev_trend = np.concatenate([np.zeros((score.shape[0], 1)), trend[:, :-1]], axis=1)
    persistent = ((trend < 0) & (prev_trend < 0)) | (prev_score >= c2)
    return np.where((cls == 3) & ~(persistent & (zv < -0.5)), 2, cls)


# --------------------------------------------------------------------------- IO


def write_json(path: Path, obj, pretty: bool = False) -> None:
    text = json.dumps(obj, indent=2 if pretty else None, separators=None if pretty else (",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")


def write_parquet(path: Path, df: pd.DataFrame) -> None:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False)
    path.write_bytes(buf.getvalue())


GENERATED_PATTERNS = ("farmers.json", "fields_*.geojson", "graph_nodes_*.json", "graph_edges_*.json", "network_*_*.json",
                      "energy_*_*.json", "kpis_*_*.json", "field_monthly.parquet", "weather_monthly.parquet",
                      "predictions.parquet")


def clean_generated(data_dir: Path) -> int:
    removed = 0
    for pattern in GENERATED_PATTERNS:
        for p in data_dir.glob(pattern):
            p.unlink()
            removed += 1
    return removed


# --------------------------------------------------------------------------- main


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default=str(REPO_DIR / "data"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--force", action="store_true", help="overwrite even if config.json says data_source != synthetic")
    args = parser.parse_args()

    t_start = time.perf_counter()
    data_dir = Path(args.data_dir).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = data_dir / "config.json"
    user_cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    if user_cfg.get("data_source", "synthetic") != "synthetic" and not args.force:
        sys.exit("config.json declares real pipeline data (data_source != 'synthetic'); refusing to overwrite. Use --force.")
    cfg = deep_merge(DEFAULT_CONFIG, user_cfg)

    months_obs = month_range(cfg["months"]["first_observed"], cfg["months"]["last_observed"])
    horizon = int(cfg["months"]["forecast_horizon"])
    months_fc = [month_add(months_obs[-1], h) for h in range(1, horizon + 1)]
    all_months = months_obs + months_fc
    labels = cfg["class_labels"]
    weights = np.array([float(cfg["demand_weights"][lab]) for lab in labels])
    cost = physarum.EdgeCostParams.from_dict(cfg["edge_cost"])
    params = physarum.PhysarumParams.from_dict(cfg["physarum"])
    station = energy_svc.StationParams.from_config(cfg)

    removed = clean_generated(data_dir)
    print(f"Physarum-Grid mock data | seed {args.seed} | {len(months_obs)} observed + {horizon} forecast months")
    print(f"  output folder: {data_dir}  (removed {removed} old generated files)")

    zones: dict[str, dict] = {}
    farmers: list[dict] = []
    weather_frames, monthly_frames = [], []
    for zi, zcfg in enumerate(cfg["zones"]):
        zone = zcfg["id"]
        prof = ZONE_PROFILES.get(zone) or {**ZONE_PROFILES["kairouan"], "prefix": zone[:3]}
        rng = np.random.default_rng([args.seed, zi])
        dindex = {m: drought_index(m, prof["drought_mult"]) for m in all_months}

        layout = make_layout(zone, zcfg["center"], prof, rng)
        write_json(data_dir / f"fields_{zone}.geojson", fields_geojson(zone, layout))
        nodes, edges = make_graph(zone, layout, cost, rng)
        write_json(data_dir / f"graph_nodes_{zone}.json", nodes, pretty=True)
        write_json(data_dir / f"graph_edges_{zone}.json", edges, pretty=True)
        # separate generator: adding farmers never changes the other synthetic outputs
        farmers.extend(make_farmers(zone, prof["prefix"], layout, np.random.default_rng([args.seed, zi, 7])))

        weather = make_weather(zone, prof, all_months, months_obs[-1], dindex, rng)
        weather_frames.append(weather)
        ndvi, ndmi, cloud, gap = make_series(prof, layout["fields"], months_obs, dindex, weather, rng)
        F, T = ndmi.shape
        fids = [f["field_id"] for f in layout["fields"]]

        monthly_frames.append(pd.DataFrame({
            "zone": zone,
            "field_id": np.repeat(fids, T),
            "month": np.tile(months_obs, F),
            "ndvi": np.round(ndvi.ravel(), 3),
            "ndmi": np.round(ndmi.ravel(), 3),
            "mndwi": np.round(np.clip(-0.45 - 0.3 * ndvi + rng.normal(0, 0.02, ndvi.shape), -1, 1).ravel(), 3),
            "bsi": np.round(np.clip(0.12 - 0.45 * ndvi + rng.normal(0, 0.02, ndvi.shape), -1, 1).ravel(), 3),
            "evi": np.round(np.clip(0.85 * ndvi - 0.02 + rng.normal(0, 0.015, ndvi.shape), 0, 1).ravel(), 3),
            "str": np.round(np.clip(0.5 + 2.2 * (ndmi + 0.15) + rng.normal(0, 0.08, ndmi.shape), 0.2, 4.0).ravel(), 2),
            "cloud_frac": np.round(cloud.ravel(), 2),
            "is_gap_filled": gap.ravel(),
        }))

        # anomalies vs each field's own normal, trend, NDVI anomaly; forecast = anomaly persistence + damped trend
        cal_obs = np.array([int(m[5:7]) for m in months_obs])
        mu, sd, mu_all, sd_all = climatology(ndmi, cal_obs)
        mu_v, sd_v, mu_v_all, sd_v_all = climatology(ndvi, cal_obs)
        z_obs, zv_obs = (ndmi - mu) / sd, (ndvi - mu_v) / sd_v
        slope_z = (z_obs[:, -1] - z_obs[:, -3]) / 2.0
        slope_zv = (zv_obs[:, -1] - zv_obs[:, -3]) / 2.0
        pred_fc, ndvi_fc, z_fc, zv_fc = [], [], [], []
        for h, month in enumerate(months_fc, start=1):
            m = int(month[5:7])
            damp = sum(0.75**k for k in range(1, h + 1))
            zh = z_obs[:, -1] + slope_z * damp
            zvh = zv_obs[:, -1] + slope_zv * damp
            p = np.clip(mu_all[m] + zh * sd_all[m] + rng.normal(0, 0.008, F), -0.35, 0.6)
            v = np.clip(mu_v_all[m] + zvh * sd_v_all[m], 0.02, 0.92)
            pred_fc.append(p)
            ndvi_fc.append(v)
            z_fc.append((p - mu_all[m]) / sd_all[m])
            zv_fc.append((v - mu_v_all[m]) / sd_v_all[m])
        pred_fc_arr = np.column_stack(pred_fc) if pred_fc else np.zeros((F, 0))
        ndmi_used = np.concatenate([ndmi, pred_fc_arr], axis=1)
        trend = np.concatenate([np.zeros((F, 1)), np.diff(ndmi_used, axis=1)], axis=1)
        z_all = np.concatenate([z_obs, np.column_stack(z_fc) if z_fc else np.zeros((F, 0))], axis=1)
        zv_all = np.concatenate([zv_obs, np.column_stack(zv_fc) if zv_fc else np.zeros((F, 0))], axis=1)
        ndmi_pred = np.concatenate([np.clip(ndmi + rng.normal(0, 0.03, ndmi.shape), -0.35, 0.6), pred_fc_arr], axis=1)
        ndmi_obs = np.concatenate([ndmi, np.full((F, horizon), np.nan)], axis=1)

        et0 = weather.set_index("month").loc[all_months, "et0_mm"].to_numpy()
        zones[zone] = {
            "layout": layout, "nodes": nodes, "edges": edges, "fids": fids, "dindex": dindex,
            "irr": np.array([f["is_irrigated"] for f in layout["fields"]]),
            "area": {f["field_id"]: f["area_ha"] for f in layout["fields"]},
            "z": z_all, "zv": zv_all, "trend": trend, "ndmi_pred": ndmi_pred, "ndmi_obs": ndmi_obs,
            "score": stress_score(z_all, zv_all, trend), "et0_norm": et0 / et0.max(), "weather": weather,
        }
        print(f"  {zone:<12} {F:>3} fields ({int(zones[zone]['irr'].sum())} irrigated), "
              f"{len(nodes)} graph nodes, {len(edges)} edges")

    # ---- class thresholds: quantiles of the stress score in normal months (irrigated fields)
    T_obs = len(months_obs)
    normal_scores, normal_masks = [], []
    for zone, zd in zones.items():
        normal_month = np.array([zd["dindex"][m] < 0.05 for m in months_obs])
        mask = zd["irr"][:, None] & normal_month[None, :]
        normal_scores.append(zd["score"][:, :T_obs][mask])
        normal_masks.append(mask)
    pooled = np.concatenate(normal_scores)
    c1, c2 = np.quantile(pooled, [0.55, 0.80])
    c3 = float(np.quantile(pooled, 0.95))
    for q in np.arange(0.95, 0.85, -0.005):  # lower the red cut until ~5 % red survives the guard
        c3 = float(np.quantile(pooled, q))
        red = [classify(zd["score"][:, :T_obs], zd["trend"][:, :T_obs], zd["zv"][:, :T_obs], (c1, c2, c3))[m] == 3
               for zd, m in zip(zones.values(), normal_masks)]
        if np.concatenate(red).mean() >= 0.045:
            break
    cuts = (float(c1), float(c2), float(c3))

    pred_frames = []
    for zone, zd in zones.items():
        F = len(zd["fids"])
        cls = classify(zd["score"], zd["trend"], zd["zv"], cuts)
        drop = np.clip(-zd["trend"] / 0.1, 0.0, 1.0)
        demand = np.where(cls > 0, np.clip(weights[cls] * (0.8 + 0.4 * zd["et0_norm"][None, :]) * (0.9 + 0.2 * drop), 0, 1), 0.0)
        irr2 = np.repeat(zd["irr"][:, None], len(all_months), axis=1)
        demand = np.where(irr2, demand, 0.0)
        zd["cls"] = np.where(irr2, cls, -1)
        status = np.array(["current"] * T_obs + ["forecast"] * horizon)
        hz = np.array([0] * T_obs + list(range(1, horizon + 1)))
        df = pd.DataFrame({
            "zone": zone,
            "field_id": np.repeat(zd["fids"], len(all_months)),
            "month": np.tile(all_months, F),
            "ndmi_obs": np.round(zd["ndmi_obs"].ravel(), 3),
            "ndmi_pred": np.round(zd["ndmi_pred"].ravel(), 3),
            "horizon": np.tile(hz, F),
            "residual": np.round((zd["ndmi_obs"] - zd["ndmi_pred"]).ravel(), 3),
            "anomaly_z": np.round(zd["z"].ravel(), 2),
            "trend": np.round(zd["trend"].ravel(), 3),
            "ndvi_anomaly_z": np.round(zd["zv"].ravel(), 2),
            "stress_class": pd.array(np.where(irr2, cls, -1).ravel(), dtype="Int64"),
            "stress_score": np.round(np.where(irr2, zd["score"], np.nan).ravel(), 3),
            "demand_score": np.round(demand.ravel(), 3),
            "status_type": np.tile(status, F),
        })
        df.loc[df["stress_class"] < 0, "stress_class"] = pd.NA
        pred_frames.append(df)

    predictions = pd.concat(pred_frames, ignore_index=True)
    write_parquet(data_dir / "field_monthly.parquet", pd.concat(monthly_frames, ignore_index=True))
    write_parquet(data_dir / "weather_monthly.parquet", pd.concat(weather_frames, ignore_index=True))
    write_parquet(data_dir / "predictions.parquet", predictions)
    write_json(data_dir / "farmers.json", farmers, pretty=True)
    print(f"  {len(farmers)} farms (fields grouped by neighbourhood, fictional owners)")

    # ---- class sanity check (drought months vs normal months)
    shares = {"normal": np.zeros(4), "drought": np.zeros(4)}
    for zone, zd in zones.items():
        for t, m in enumerate(months_obs):
            key = "drought" if zd["dindex"][m] >= 0.3 else ("normal" if zd["dindex"][m] < 0.05 else None)
            if key:
                c = zd["cls"][:, t]
                shares[key] += np.bincount(c[c >= 0], minlength=4)
    for key, counts in shares.items():
        pct = 100 * counts / max(counts.sum(), 1)
        print(f"  classes in {key:<7} months: green {pct[0]:4.1f}%  yellow {pct[1]:4.1f}%  orange {pct[2]:4.1f}%  red {pct[3]:4.1f}%")

    # ---- Physarum networks, energy schedules and KPIs for every zone x month
    stats = []
    for zone, zd in zones.items():
        t0 = time.perf_counter()
        lon0, lat0 = zd["layout"]["center"]
        irr_map = {f: bool(i) for f, i in zip(zd["fids"], zd["irr"])}
        zone_preds = predictions[predictions["zone"] == zone]
        held_out = kpi_svc.held_out_mae(zone_preds)
        wx = zd["weather"].set_index("month")
        for t, month in enumerate(all_months):
            cls_t = zd["cls"][:, t]
            demand_w = {fid: (float(weights[c]) if c >= 0 else 0.0) for fid, c in zip(zd["fids"], cls_t)}
            result = physarum.compute_network(zone=zone, month=month, nodes=zd["nodes"], edges=zd["edges"],
                                              demand_weights=demand_w, params=params, cost=cost, irrigated=irr_map)
            network = result["network"]
            write_json(data_dir / f"network_{zone}_{month}.json", network)

            total_demand = sum(zd["area"][f] * w for f, w in demand_w.items())
            date = f"{month}-15"
            day = energy_svc.build_energy_day(
                zone, date, lat=lat0, lon=lon0, ghi_kwh_m2_day=float(wx.loc[month, "solar_kwh_m2_day"]),
                et0_mm_month=float(wx.loc[month, "et0_mm"]), total_demand_ha_eq=total_demand, station=station)
            write_json(data_dir / f"energy_{zone}_{date}.json", day, pretty=True)

            saved = physarum.water_saved_from_network(network, zd["area"], irr_map)
            counts, hectares = kpi_svc.class_breakdown([None if c < 0 else int(c) for c in cls_t],
                                                       [zd["area"][f] for f in zd["fids"]])
            if t < T_obs:
                mae = kpi_svc.forecast_mae(zd["ndmi_obs"][:, t], zd["ndmi_pred"][:, t])
            else:
                mae = held_out
            write_json(data_dir / f"kpis_{zone}_{month}.json",
                       kpi_svc.build_kpis(zone, month, counts, hectares, saved, day["summary"]["solar_share_pct"], mae),
                       pretty=True)
            m, sp = network["metrics"], network["baselines"]["shortest_path"]
            stats.append((m["total_length_m"], sp["total_length_m"], m["weighted_loss"], sp["weighted_loss"],
                          m["resilience_score"], sp["resilience_score"], saved, day["summary"]["solar_share_pct"],
                          result["compute_ms"], result["iterations_used"]))
        print(f"  {zone:<12} {len(all_months)} networks + energy + KPIs in {time.perf_counter() - t0:5.1f} s")

    s = np.array(stats, dtype=float)
    print(f"  Physarum vs shortest path (mean): length {s[:, 0].mean():.0f} m vs {s[:, 1].mean():.0f} m | "
          f"loss {s[:, 2].mean():.3f} vs {s[:, 3].mean():.3f} | resilience {s[:, 4].mean():.2f} vs {s[:, 5].mean():.2f}")
    print(f"  water saved vs equal split {s[:, 6].mean():.1f}% | solar share {s[:, 7].mean():.1f}% | "
          f"Physarum {s[:, 8].mean():.0f} ms/run, {s[:, 9].mean():.0f} iterations")

    out_cfg = deep_merge(DEFAULT_CONFIG, user_cfg) if not user_cfg else dict(user_cfg)
    out_cfg["class_thresholds"] = {
        "note": "Mock data: cuts on the 0-1 stress score at the 55/80/~95th percentiles of normal months "
                "(the real pipeline sets them with k-means k=4 on [anomaly_z, trend, ndvi_anomaly_z]); adjust by hand.",
        "stress_score_cuts": [round(c, 4) for c in cuts],
        "red_guard": "red also needs 2 falling months (or orange the month before) and ndvi_anomaly_z < -0.5",
    }
    out_cfg["data_source"] = "synthetic"
    write_json(cfg_path, out_cfg, pretty=True)
    print(f"Done in {time.perf_counter() - t_start:.1f} s.")


if __name__ == "__main__":
    main()
