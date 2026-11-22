"""Farmer onboarding: the farm outline, its sub-zones (crop + soil), its water sources, saved to
data/farms.json (ARCHITECTURE.md 13.11, extended with ``boundary``, ``sub_zones`` and
``water_sources``).

Also suggests where to install a water source when the farmer has none, from the data we have:
sub-zone areas, crop water needs, soil retention and the current satellite stress class of the
detected fields under each sub-zone.
"""
from __future__ import annotations

import json
import math
import threading
import time
from typing import Any

import numpy as np
from fastapi import HTTPException

from ..config import DATA_DIR
from .auth import write_json_atomic
from .data_provider import DataProvider
from .util import native, polygon_area_m2, polygon_centroid, to_local, to_lonlat

FARMS_FILE = DATA_DIR / "farms.json"
_lock = threading.RLock()
PREFIX = {"kairouan": "kai", "sidi_bouzid": "sib", "kebili": "keb"}

# Indicative yearly irrigation need in Tunisian arid/semi-arid conditions (mm = 10 m³/ha).
CROPS: list[dict] = [
    {"id": "olivier", "category": "arbre", "fr": "Olivier", "en": "Olive tree", "ar": "زيتون", "need_mm": 450},
    {"id": "palmier", "category": "arbre", "fr": "Palmier dattier", "en": "Date palm", "ar": "نخيل", "need_mm": 1800},
    {"id": "amandier", "category": "arbre", "fr": "Amandier", "en": "Almond", "ar": "لوز", "need_mm": 600},
    {"id": "pistachier", "category": "arbre", "fr": "Pistachier", "en": "Pistachio", "ar": "فستق", "need_mm": 400},
    {"id": "figuier", "category": "arbre", "fr": "Figuier", "en": "Fig tree", "ar": "تين", "need_mm": 600},
    {"id": "grenadier", "category": "fruit", "fr": "Grenadier", "en": "Pomegranate", "ar": "رمان", "need_mm": 800},
    {"id": "agrumes", "category": "fruit", "fr": "Agrumes", "en": "Citrus", "ar": "قوارص", "need_mm": 1000},
    {"id": "pommier", "category": "fruit", "fr": "Pommier", "en": "Apple", "ar": "تفاح", "need_mm": 900},
    {"id": "pecher", "category": "fruit", "fr": "Pêcher", "en": "Peach", "ar": "خوخ", "need_mm": 850},
    {"id": "abricotier", "category": "fruit", "fr": "Abricotier", "en": "Apricot", "ar": "مشمش", "need_mm": 800},
    {"id": "vigne", "category": "fruit", "fr": "Vigne", "en": "Grapevine", "ar": "عنب", "need_mm": 600},
    {"id": "pasteque", "category": "fruit", "fr": "Pastèque / melon", "en": "Watermelon / melon", "ar": "دلاع / بطيخ", "need_mm": 500},
    {"id": "tomate", "category": "legume", "fr": "Tomate", "en": "Tomato", "ar": "طماطم", "need_mm": 600},
    {"id": "piment", "category": "legume", "fr": "Piment", "en": "Pepper", "ar": "فلفل", "need_mm": 650},
    {"id": "pomme_de_terre", "category": "legume", "fr": "Pomme de terre", "en": "Potato", "ar": "بطاطا", "need_mm": 500},
    {"id": "oignon", "category": "legume", "fr": "Oignon", "en": "Onion", "ar": "بصل", "need_mm": 450},
    {"id": "carotte", "category": "legume", "fr": "Carotte", "en": "Carrot", "ar": "جزر", "need_mm": 450},
    {"id": "artichaut", "category": "legume", "fr": "Artichaut", "en": "Artichoke", "ar": "قنارية", "need_mm": 700},
    {"id": "feve", "category": "legume", "fr": "Fève / petits pois", "en": "Broad bean / peas", "ar": "فول / جلبانة", "need_mm": 350},
    {"id": "ble", "category": "cereale", "fr": "Blé", "en": "Wheat", "ar": "قمح", "need_mm": 450},
    {"id": "orge", "category": "cereale", "fr": "Orge", "en": "Barley", "ar": "شعير", "need_mm": 350},
    {"id": "luzerne", "category": "fourrage", "fr": "Luzerne", "en": "Alfalfa", "ar": "فصة", "need_mm": 1500},
    {"id": "sorgho", "category": "fourrage", "fr": "Sorgho fourrager", "en": "Forage sorghum", "ar": "سرغوم علفي", "need_mm": 600},
    {"id": "jachere", "category": "autre", "fr": "Jachère / non cultivé", "en": "Fallow / not cultivated", "ar": "بور", "need_mm": 0},
]
CATEGORIES = {"arbre": ("Arbres", "Trees", "أشجار"), "fruit": ("Fruits", "Fruits", "غلال"),
              "legume": ("Légumes", "Vegetables", "خضر"), "cereale": ("Céréales", "Cereals", "حبوب"),
              "fourrage": ("Fourrage", "Forage", "أعلاف"), "autre": ("Autre", "Other", "أخرى")}
# factor > 1: water drains faster, more (and more frequent) irrigation
SOILS: list[dict] = [
    {"id": "sableux", "fr": "Sableux", "en": "Sandy", "ar": "رملية", "factor": 1.25},
    {"id": "sablo_limoneux", "fr": "Sablo-limoneux", "en": "Sandy loam", "ar": "رملية طميية", "factor": 1.10},
    {"id": "limoneux", "fr": "Limoneux", "en": "Loam", "ar": "طميية", "factor": 1.00},
    {"id": "argilo_limoneux", "fr": "Argilo-limoneux", "en": "Clay loam", "ar": "طينية طميية", "factor": 0.95},
    {"id": "argileux", "fr": "Argileux", "en": "Clay", "ar": "طينية", "factor": 0.90},
    {"id": "calcaire", "fr": "Calcaire", "en": "Calcareous", "ar": "كلسية", "factor": 1.05},
    {"id": "gypseux_salin", "fr": "Gypseux / salé", "en": "Gypsum / saline", "ar": "جبسية / مالحة", "factor": 1.15},
]
SOURCE_TYPES = [
    {"id": "puits", "fr": "Puits", "en": "Well", "ar": "بئر"},
    {"id": "forage", "fr": "Forage", "en": "Borehole", "ar": "بئر عميقة"},
    {"id": "bassin", "fr": "Bassin / réservoir", "en": "Basin / reservoir", "ar": "حوض / خزان"},
    {"id": "oued", "fr": "Oued / canal", "en": "Wadi / canal", "ar": "واد / قناة"},
    {"id": "reseau_gda", "fr": "Borne du GDA", "en": "GDA network outlet", "ar": "حنفية المجمع المائي"},
]
CROP_BY_ID = {c["id"]: c for c in CROPS}
SOIL_BY_ID = {s["id"]: s for s in SOILS}
SOURCE_IDS = {s["id"] for s in SOURCE_TYPES}


def options(provider: DataProvider) -> dict:
    zones = []
    for z in provider.config()["zones"]:
        feats = provider.fields_geojson(z["id"])["features"]
        lons = [c[0] for f in feats for c in f["geometry"]["coordinates"][0]]
        lats = [c[1] for f in feats for c in f["geometry"]["coordinates"][0]]
        pad = 0.01
        zones.append({"id": z["id"], "name": z["name"], "center": z["center"],
                      "bbox": [min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad]})
    return {"zones": zones, "crops": CROPS, "categories": [{"id": k, "fr": v[0], "en": v[1], "ar": v[2]} for k, v in CATEGORIES.items()],
            "soils": SOILS, "source_types": SOURCE_TYPES}


# --------------------------------------------------------------------------- geometry


def _ring(poly: list) -> list[tuple[float, float]]:
    pts = [(float(p[0]), float(p[1])) for p in poly]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def point_in_polygon(lon: float, lat: float, poly: list) -> bool:
    inside, pts = False, _ring(poly)
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def area_ha(poly: list) -> float:
    pts = _ring(poly)
    lon0, lat0 = pts[0]
    return polygon_area_m2([to_local(x, y, lon0, lat0) for x, y in pts]) / 10_000.0


def centroid(poly: list) -> tuple[float, float]:
    pts = _ring(poly)
    lon0, lat0 = pts[0]
    cx, cy = polygon_centroid([to_local(x, y, lon0, lat0) for x, y in pts])
    return to_lonlat(cx, cy, lon0, lat0)


def _validate_polygon(poly: Any, what: str) -> list[list[float]]:
    if not isinstance(poly, list) or len(_ring(poly)) < 3:
        raise HTTPException(422, f"{what} : il faut au moins 3 points")
    ring = [[round(float(p[0]), 6), round(float(p[1]), 6)] for p in _ring(poly)]
    for lon, lat in ring:
        if not (7.0 < lon < 12.0 and 30.0 < lat < 38.0):
            raise HTTPException(422, f"{what} : point hors de la Tunisie")
    return ring + [ring[0]]


def _shape(ring: list):
    from shapely.geometry import Polygon

    poly = Polygon(_ring(ring))
    return poly if poly.is_valid else poly.buffer(0)


def _fields_in(provider: DataProvider, zone: str, boundary: list, min_share: float = 0.05) -> list[dict]:
    """Detected (satellite) fields that really overlap the outline (at least ``min_share`` of the field)."""
    b = _shape(boundary)
    out = []
    for f in provider.fields_geojson(zone)["features"]:
        g = _shape(f["geometry"]["coordinates"][0])
        if not g.intersects(b) or g.area == 0:
            continue
        if g.intersection(b).area / g.area >= min_share:
            out.append(f)
    return out


def _clip(ring: list, boundary: list) -> tuple[list[list[float]], float] | None:
    """Part of a field polygon inside the outline (largest piece) and its area in ha."""
    from shapely.geometry import MultiPolygon, Polygon

    inter = _shape(ring).intersection(_shape(boundary))
    if inter.is_empty:
        return None
    parts = [inter] if isinstance(inter, Polygon) else [g for g in getattr(inter, "geoms", []) if isinstance(g, (Polygon, MultiPolygon))]
    polys = []
    for p in parts:
        polys.extend(p.geoms if isinstance(p, MultiPolygon) else [p])
    if not polys:
        return None
    best = max(polys, key=lambda g: g.area)
    coords = [[round(x, 6), round(y, 6)] for x, y in best.exterior.coords]
    return coords, area_ha(coords)


def _current_classes(provider: DataProvider, zone: str) -> dict[str, int]:
    last = provider.config()["months"]["last_observed"]
    rows = provider.predictions_slice(zone, last, "current")
    return {fid: int(c) for fid, c in zip(rows["field_id"], rows["stress_class"]) if native(c) is not None}


def detect_zone(provider: DataProvider, boundary: list) -> str:
    lon, lat = centroid(boundary)
    best, dist = None, 1e18
    for z in options(provider)["zones"]:
        w, s, e, n = z["bbox"]
        if w <= lon <= e and s <= lat <= n:
            return z["id"]
        d = (lon - z["center"][0]) ** 2 + (lat - z["center"][1]) ** 2
        if d < dist:
            best, dist = z["id"], d
    if dist > 0.15 ** 2:
        raise HTTPException(422, "Cette parcelle est hors des zones couvertes (Kairouan, Sidi Bouzid, Kébili)")
    return best


# --------------------------------------------------------------------------- segmentation + suggestion


def auto_segments(provider: DataProvider, zone: str, boundary: list) -> dict:
    """Satellite fields inside the outline, clipped to it (nothing outside the farm is returned)."""
    boundary = _validate_polygon(boundary, "Contour de la ferme")
    cls = _current_classes(provider, zone)
    segs = []
    for f in _fields_in(provider, zone, boundary, min_share=0.0):
        clipped = _clip(f["geometry"]["coordinates"][0], boundary)
        if clipped is None:
            continue
        coords, ha = clipped
        if ha < 0.1:  # slivers along the outline
            continue
        segs.append({"field_id": f["properties"]["field_id"], "polygon": coords, "area_ha": round(ha, 2),
                     "share_inside": round(ha / max(float(f["properties"]["area_ha"]), 1e-6), 2),
                     "stress_class": cls.get(f["properties"]["field_id"])})
    return {"segments": segs}


def suggest_source(provider: DataProvider, zone: str, boundary: list, sub_zones: list[dict]) -> dict:
    boundary = _validate_polygon(boundary, "Contour de la ferme")
    lon0, lat0 = centroid(boundary)
    cls = _current_classes(provider, zone)
    fields = _fields_in(provider, zone, boundary)
    pts, w, details = [], [], []
    for sz in sub_zones or [{"polygon": boundary, "crop": None, "soil": None, "name": "Ferme"}]:
        poly = sz["polygon"]
        c_lon, c_lat = centroid(poly)
        a = area_ha(poly)
        crop = CROP_BY_ID.get(sz.get("crop") or "", {"need_mm": 500})
        soil = SOIL_BY_ID.get(sz.get("soil") or "", {"factor": 1.0})
        under = [cls[f["properties"]["field_id"]] for f in fields
                 if f["properties"]["field_id"] in cls and point_in_polygon(f["properties"]["centroid_lon"], f["properties"]["centroid_lat"], poly)]
        stress = float(np.mean(under)) if under else 0.0
        need_m3 = a * crop["need_mm"] * 10 * soil["factor"]
        weight = need_m3 * (1 + 0.25 * stress)
        pts.append(to_local(c_lon, c_lat, lon0, lat0))
        w.append(max(weight, 1e-6))
        details.append({"name": sz.get("name"), "need_m3_year": round(need_m3), "stress_class_mean": round(stress, 2) if under else None})
    P, W = np.array(pts), np.array(w)
    # weighted geometric median (Weiszfeld): minimises sum(weight x pipe length)
    x = (P * W[:, None]).sum(0) / W.sum()
    for _ in range(200):
        d = np.maximum(np.hypot(*(P - x).T), 1.0)
        nx_ = (P * (W / d)[:, None]).sum(0) / (W / d).sum()
        if np.hypot(*(nx_ - x)) < 0.05:
            x = nx_
            break
        x = nx_
    lon, lat = to_lonlat(float(x[0]), float(x[1]), lon0, lat0)
    if not point_in_polygon(lon, lat, boundary):  # keep it on the farm: pull towards the outline centroid
        for t in np.linspace(0.1, 1.0, 10):
            lo, la = to_lonlat(float(x[0]) * (1 - t), float(x[1]) * (1 - t), lon0, lat0)
            if point_in_polygon(lo, la, boundary):
                lon, lat = lo, la
                break
        else:
            lon, lat = lon0, lat0
    sx, sy = to_local(lon, lat, lon0, lat0)
    dist = np.hypot(P[:, 0] - sx, P[:, 1] - sy)
    dist_c = np.hypot(P[:, 0], P[:, 1])
    pipe, pipe_c = float(dist.sum()), float(dist_c.sum())
    wmean, wmean_c = float((W * dist).sum() / W.sum()), float((W * dist_c).sum() / W.sum())
    kind = "forage" if zone == "kebili" else "puits"
    return {
        "lon": round(lon, 6), "lat": round(lat, 6), "type": kind,
        "need_m3_year": int(sum(d["need_m3_year"] for d in details)),
        "pipe_length_m": round(pipe), "pipe_length_center_m": round(pipe_c),
        "mean_distance_m": round(wmean), "mean_distance_center_m": round(wmean_c),
        "saving_vs_center_pct": round(100 * (wmean_c - wmean) / wmean_c, 1) if wmean_c > 0 else 0.0,
        "max_distance_m": round(float(dist.max())) if len(dist) else 0,
        "sub_zones": details,
        "method": "Médiane géométrique pondérée des sous-zones (poids = surface × besoin de la culture × facteur sol × stress satellite actuel)",
    }


# --------------------------------------------------------------------------- farms store


def load_farms() -> list[dict]:
    with _lock:
        if not FARMS_FILE.exists():
            return []
        return json.loads(FARMS_FILE.read_text(encoding="utf-8"))


def get_farm(farm_id: str, user: dict) -> dict:
    farm = next((f for f in load_farms() if f["farm_id"] == farm_id), None)
    if farm is None:
        raise HTTPException(404, f"Ferme inconnue '{farm_id}'")
    if user.get("role") != "admin" and farm["owner_user_id"] != user["user_id"]:
        raise HTTPException(403, "Cette ferme ne vous appartient pas")
    return farm


def create_farm(provider: DataProvider, user: dict, body: dict, replace_id: str | None = None) -> dict:
    boundary = _validate_polygon(body.get("boundary"), "Contour de la ferme")
    zone = body.get("zone") or detect_zone(provider, boundary)
    if zone not in provider.zone_ids():
        raise HTTPException(422, f"Zone inconnue '{zone}'")
    farm_area = area_ha(boundary)
    if farm_area < 0.05 or farm_area > 5000:
        raise HTTPException(422, f"Surface de la ferme invalide ({farm_area:.2f} ha)")

    subs = []
    for i, sz in enumerate(body.get("sub_zones") or [], start=1):
        poly = _validate_polygon(sz.get("polygon"), f"Sous-zone {i}")
        clipped = _clip(poly, boundary)  # keep only the part inside the farm outline
        if clipped is None or clipped[1] < 0.01:
            raise HTTPException(422, f"La sous-zone {i} est en dehors de la ferme")
        poly = clipped[0]
        if sz.get("crop") not in CROP_BY_ID:
            raise HTTPException(422, f"Sous-zone {i} : choisissez une culture")
        if sz.get("soil") not in SOIL_BY_ID:
            raise HTTPException(422, f"Sous-zone {i} : choisissez un type de sol")
        crop = CROP_BY_ID[sz["crop"]]
        subs.append({"sub_zone_id": f"sz_{i:02d}", "name": (sz.get("name") or f"Sous-zone {i}").strip()[:60],
                     "polygon": poly, "area_ha": round(area_ha(poly), 2), "category": crop["category"],
                     "crop": crop["id"], "soil": sz["soil"], "need_m3_year": round(area_ha(poly) * crop["need_mm"] * 10 * SOIL_BY_ID[sz["soil"]]["factor"])})
    if not subs:
        raise HTTPException(422, "Ajoutez au moins une sous-zone")

    has_water = bool(body.get("has_water_source"))
    sources = []
    for i, s in enumerate(body.get("water_sources") or [], start=1):
        lon, lat = float(s["lon"]), float(s["lat"])
        if not point_in_polygon(lon, lat, boundary):
            raise HTTPException(422, f"La source {i} doit être placée dans la ferme")
        stype = s.get("type") or "puits"
        if stype not in SOURCE_IDS:
            raise HTTPException(422, f"Type de source inconnu '{stype}'")
        sources.append({"source_id": f"src_{i:02d}", "lon": round(lon, 6), "lat": round(lat, 6), "type": stype,
                        "status": "existing" if has_water else "planned", "suggested": bool(s.get("suggested"))})
    if has_water and not sources:
        raise HTTPException(422, "Placez votre source d'eau sur la carte")
    if not has_water and not sources:
        sug = suggest_source(provider, zone, boundary, subs)
        sources.append({"source_id": "src_01", "lon": sug["lon"], "lat": sug["lat"], "type": sug["type"],
                        "status": "planned", "suggested": True})

    lons = [p[0] for p in boundary]
    lats = [p[1] for p in boundary]
    field_ids = [f["properties"]["field_id"] for f in _fields_in(provider, zone, boundary)]
    with _lock:
        farms = load_farms()
        old = next((f for f in farms if f["farm_id"] == replace_id), None) if replace_id else None
        if replace_id and old is None:
            raise HTTPException(404, f"Ferme inconnue '{replace_id}'")
        if old is not None and old["owner_user_id"] != user["user_id"] and user.get("role") != "admin":
            raise HTTPException(403, "Cette ferme ne vous appartient pas")
        n = sum(1 for f in farms if f["zone"] == zone) + 1
        farm_id = replace_id or f"farm_{PREFIX.get(zone, zone[:3])}_u{user['user_id'][2:]}_{n:02d}"
        farm = {
            "farm_id": farm_id,
            "name": (body.get("name") or f"Ferme {user['name']}").strip()[:80],
            "zone": zone,
            "owner_user_id": user["user_id"],
            "field_ids": field_ids,
            "area_ha": round(farm_area, 2),
            "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
            "boundary": boundary,
            "sub_zones": subs,
            "has_water_source": has_water,
            "water_sources": sources,
            "source_node_ids": [s["source_id"] for s in sources],
            "pump": {"pump_id": "pump_01", "rated_power_kw": 15.0, "flow_m3_h": 42.0, "source_node_id": sources[0]["source_id"]},
            "tank": {"capacity_m3": 500},
            "need_m3_year": int(sum(s["need_m3_year"] for s in subs)),
            "created_at": old["created_at"] if old else time.strftime("%Y-%m-%dT%H:%M:%S"),
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "onboarding_completed": True,
        }
        if old is not None:
            farm["owner_user_id"] = old["owner_user_id"]
            farms = [farm if f["farm_id"] == replace_id else f for f in farms]
        else:
            farms.append(farm)
        write_json_atomic(FARMS_FILE, farms)
    return farm
