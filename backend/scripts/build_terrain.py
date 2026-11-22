#!/usr/bin/env python
"""
Download and cache, once, the terrain and obstacle layers used by the farm Physarum routing
(run with the pipeline Python, which has rasterio + planetary-computer; needs internet only here):

    python backend/scripts/build_terrain.py            # 3 zones
    python backend/scripts/build_terrain.py --zone kebili --force

For each zone (extent of its detected fields + 2 km margin) it writes data/terrain/:
    dem_{zone}.npz          Copernicus DEM GLO-30 (m), lon/lat grid  -> slope / uphill penalties
    builtup_{zone}.geojson  ESA WorldCover 2021 class 50 (built-up), vectorised -> blocked for canals
    water_{zone}.geojson    ESA WorldCover class 80 (permanent water) -> blocked (cannot lay a canal in a lake)
    osm_{zone}.geojson      OpenStreetMap roads (costly to cross) and waterways/canals (cheap to follow)

Sources: Microsoft Planetary Computer (cop-dem-glo-30, esa-worldcover), Overpass API (OSM, ODbL).
After this, the platform works offline.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
OUT = DATA / "terrain"
ZONES = ["kairouan", "sidi_bouzid", "kebili"]
PAD = 0.02  # degrees (~2 km)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def zone_bbox(zone: str) -> tuple[float, float, float, float]:
    fc = json.loads((DATA / f"fields_{zone}.geojson").read_text(encoding="utf-8"))
    xs = [c[0] for f in fc["features"] for c in f["geometry"]["coordinates"][0]]
    ys = [c[1] for f in fc["features"] for c in f["geometry"]["coordinates"][0]]
    return min(xs) - PAD, min(ys) - PAD, max(xs) + PAD, max(ys) + PAD


def stac_mosaic(collection: str, asset: str, bbox, query=None):
    import planetary_computer
    import pystac_client
    import rasterio
    from rasterio.merge import merge

    cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=planetary_computer.sign_inplace)
    items = list(cat.search(collections=[collection], bbox=bbox, query=query).items())
    if not items:
        raise RuntimeError(f"no {collection} item over {bbox}")
    srcs = [rasterio.open(it.assets[asset].href) for it in items]
    arr, transform = merge(srcs, bounds=bbox)
    for s in srcs:
        s.close()
    return arr[0], transform, items


def build_dem(zone: str, bbox) -> None:
    arr, tf, items = stac_mosaic("cop-dem-glo-30", "data", bbox)
    arr = arr.astype(np.float32)
    arr[arr <= 0] = np.nan  # merge fills gaps with 0
    np.savez_compressed(OUT / f"dem_{zone}.npz", z=arr, x0=tf.c, dx=tf.a, y0=tf.f, dy=tf.e)
    print(f"  DEM {arr.shape}, {np.nanmin(arr):.0f}..{np.nanmax(arr):.0f} m ({len(items)} tiles)")


def vectorise(mask: np.ndarray, tf, min_px: int, simplify: float) -> list:
    from rasterio.features import shapes
    from shapely.geometry import shape

    out = []
    for geom, v in shapes(mask.astype(np.uint8), mask=mask, transform=tf):
        g = shape(geom)
        if g.area / (abs(tf.a * tf.e)) < min_px:
            continue
        g = g.simplify(simplify, preserve_topology=True)
        if g.is_empty:
            continue
        out.append({"type": "Feature", "properties": {}, "geometry": json.loads(json.dumps(g.__geo_interface__))})
    return out


def build_worldcover(zone: str, bbox) -> None:
    arr, tf, _ = stac_mosaic("esa-worldcover", "map", bbox, query={"esa_worldcover:product_version": {"eq": "2.0.0"}})
    built = arr == 50
    water = arr == 80
    # ~10 m pixels: keep blocks of >= 6 px (600 m²), simplify ~8 m
    b = vectorise(built, tf, 6, 0.00008)
    w = vectorise(water, tf, 10, 0.00008)
    for name, feats in (("builtup", b), ("water", w)):
        (OUT / f"{name}_{zone}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print(f"  WorldCover: {built.mean() * 100:.1f}% built-up ({len(b)} polygons), {water.mean() * 100:.2f}% water ({len(w)})")


def build_osm(zone: str, bbox) -> None:
    import requests

    w, s, e, n = bbox
    q = f"""[out:json][timeout:120];
(
  way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service"]({s},{w},{n},{e});
  way["waterway"~"canal|ditch|drain|river|stream"]({s},{w},{n},{e});
  way["man_made"="pipeline"]["substance"="water"]({s},{w},{n},{e});
);
out geom;"""
    for url in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"):
        try:
            r = requests.post(url, data={"data": q}, timeout=180, headers={"User-Agent": "physarum-grid-hackathon/1.0"})
            r.raise_for_status()
            els = r.json()["elements"]
            break
        except Exception as ex:  # try the mirror
            print(f"  Overpass {url} failed: {ex}")
            els = None
    if els is None:
        raise RuntimeError("Overpass unavailable")
    feats = []
    for el in els:
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        tags = el.get("tags", {})
        kind = "road" if "highway" in tags else "canal"
        feats.append({"type": "Feature", "properties": {"kind": kind, "class": tags.get("highway") or tags.get("waterway") or "pipeline",
                                                         "name": tags.get("name")},
                      "geometry": {"type": "LineString", "coordinates": [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]}})
    (OUT / f"osm_{zone}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    print(f"  OSM: {sum(f['properties']['kind'] == 'road' for f in feats)} roads, {sum(f['properties']['kind'] == 'canal' for f in feats)} waterways")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zone", choices=ZONES)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for zone in [a.zone] if a.zone else ZONES:
        bbox = zone_bbox(zone)
        print(f"{zone}: bbox {tuple(round(v, 4) for v in bbox)}")
        for name, fn in (("dem", build_dem), ("builtup", build_worldcover), ("osm", build_osm)):
            target = OUT / f"{name}_{zone}.{'npz' if name == 'dem' else 'geojson'}"
            if target.exists() and not a.force:
                print(f"  {target.name} cached")
                continue
            t0 = time.time()
            fn(zone, bbox)
            print(f"    ({time.time() - t0:.0f}s)")
        time.sleep(2)  # be polite with Overpass


if __name__ == "__main__":
    main()
