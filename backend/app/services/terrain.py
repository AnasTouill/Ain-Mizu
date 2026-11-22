"""Terrain and obstacles for the farm routing graph (cached files in data/terrain/, built once by
backend/scripts/build_terrain.py; everything here works offline).

- Copernicus DEM GLO-30 -> elevation of each node -> uphill slope of each canal (Physarum cost).
- ESA WorldCover built-up / permanent water -> canals cannot be laid there (edge removed).
- OpenStreetMap roads -> each crossing makes a canal more expensive.
- OpenStreetMap canals / ditches / water pipelines -> following them is cheap (existing canal).
"""
from __future__ import annotations

import json
import threading
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..config import DATA_DIR

TERRAIN = DATA_DIR / "terrain"
_lock = threading.Lock()

BLOCK_BUILT_FRAC = 0.35     # an edge running >35 % through built-up land is not allowed
BUILT_COST = 3.0            # cost multiplier per unit built-up fraction below that
ROAD_CROSS_COST = 0.6       # +60 % per road crossed (max 3 counted)
CANAL_BUFFER_M = 18.0       # an edge within this distance of an OSM canal "follows" it
CANAL_FOLLOW_FRAC = 0.6


def available(zone: str) -> bool:
    return (TERRAIN / f"dem_{zone}.npz").exists()


@lru_cache(maxsize=4)
def _dem(zone: str):
    p = TERRAIN / f"dem_{zone}.npz"
    if not p.exists():
        return None
    d = np.load(p)
    return d["z"], float(d["x0"]), float(d["dx"]), float(d["y0"]), float(d["dy"])


def elevation(zone: str, lon: float, lat: float) -> float | None:
    dem = _dem(zone)
    if dem is None:
        return None
    z, x0, dx, y0, dy = dem
    c = (lon - x0) / dx - 0.5
    r = (lat - y0) / dy - 0.5
    i0, j0 = int(np.floor(r)), int(np.floor(c))
    if i0 < 0 or j0 < 0 or i0 + 1 >= z.shape[0] or j0 + 1 >= z.shape[1]:
        return None
    fr, fc = r - i0, c - j0
    w = z[i0:i0 + 2, j0:j0 + 2]
    if np.isnan(w).any():
        v = np.nanmean(w)
        return None if np.isnan(v) else float(v)
    return float(w[0, 0] * (1 - fr) * (1 - fc) + w[0, 1] * (1 - fr) * fc + w[1, 0] * fr * (1 - fc) + w[1, 1] * fr * fc)


@lru_cache(maxsize=12)
def _layer(zone: str, name: str) -> list:
    from shapely.geometry import shape

    p = TERRAIN / f"{name}_{zone}.geojson"
    if not p.exists():
        return []
    feats = json.loads(p.read_text(encoding="utf-8"))["features"]
    return [(shape(f["geometry"]), f["properties"]) for f in feats]


def _clip(zone: str, name: str, bbox, kind: str | None = None):
    from shapely.geometry import box

    b = box(*bbox)
    out = []
    for g, props in _layer(zone, name):
        if kind and props.get("kind") != kind:
            continue
        if g.intersects(b):
            out.append((g.intersection(b), props))
    return out


class FarmTerrain:
    """Obstacles and DEM clipped to one farm, with projected (metre) geometries for fast tests."""

    def __init__(self, zone: str, bbox, to_xy):
        from shapely.geometry import LineString, MultiLineString, Polygon
        from shapely.ops import transform, unary_union
        from shapely.prepared import prep

        self.zone = zone
        proj = lambda g: transform(lambda x, y, z=None: to_xy(x, y), g)  # noqa: E731
        pad = 0.003
        bb = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
        built = [proj(g) for g, _ in _clip(zone, "builtup", bb)] + [proj(g) for g, _ in _clip(zone, "water", bb)]
        self.built = unary_union(built) if built else Polygon()
        self.built_p = prep(self.built)
        roads = [proj(g) for g, _ in _clip(zone, "osm", bb, "road") if isinstance(g, (LineString, MultiLineString))]
        canals = [proj(g) for g, _ in _clip(zone, "osm", bb, "canal") if isinstance(g, (LineString, MultiLineString))]
        self.roads = unary_union(roads) if roads else None
        self.canal_zone = unary_union(canals).buffer(CANAL_BUFFER_M) if canals else None
        self.n_roads, self.n_canals = len(roads), len(canals)

    def in_builtup(self, x: float, y: float) -> bool:
        from shapely.geometry import Point

        return (not self.built.is_empty) and self.built_p.contains(Point(x, y))

    def edge(self, pa, pb) -> dict:
        """Cost factors for a straight canal between two projected points (metres)."""
        from shapely.geometry import LineString

        line = LineString([pa, pb])
        L = max(line.length, 1.0)
        built_frac = 0.0
        if not self.built.is_empty and self.built_p.intersects(line):
            built_frac = line.intersection(self.built).length / L
        crossings = 0
        if self.roads is not None and line.intersects(self.roads):
            inter = line.intersection(self.roads)
            crossings = len(getattr(inter, "geoms", [inter])) if not inter.is_empty else 0
        follows = False
        if self.canal_zone is not None and line.intersects(self.canal_zone):
            follows = line.intersection(self.canal_zone).length / L >= CANAL_FOLLOW_FRAC
        blocked = built_frac > BLOCK_BUILT_FRAC
        mult = (1.0 + BUILT_COST * built_frac) * (1.0 + ROAD_CROSS_COST * min(crossings, 3))
        return {"blocked": blocked, "built_frac": round(built_frac, 3), "road_crossings": crossings,
                "follows_canal": follows, "cost_mult": round(mult, 3)}


def layers_geojson(zone: str, bbox) -> dict:
    """Obstacle layers inside a bbox, for the map."""
    def fc(items):
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {k: v for k, v in (p or {}).items() if v is not None},
             "geometry": json.loads(json.dumps(g.__geo_interface__))}
            for g, p in items if not g.is_empty]}

    pad = 0.003
    bb = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    dem = _dem(zone)
    return {
        "zone": zone,
        "available": available(zone),
        "builtup": fc(_clip(zone, "builtup", bb)),
        "water": fc(_clip(zone, "water", bb)),
        "roads": fc(_clip(zone, "osm", bb, "road")),
        "canals": fc(_clip(zone, "osm", bb, "canal")),
        "sources": "Copernicus DEM GLO-30 · ESA WorldCover 2021 · © OpenStreetMap contributors",
        "dem": bool(dem is not None),
    }
