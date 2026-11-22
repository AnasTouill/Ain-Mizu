"""Real model outputs (weekly LightGBM NDMI forecaster): plan for next week, per-field weekly
forecast, metrics and figures. Files are written by backend/scripts/import_pipeline.py into
data/model/."""
from __future__ import annotations

import io
import json
import threading
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from ..config import DATA_DIR
from ..errors import DataMissing, NotFound

router = APIRouter(prefix="/api/model", tags=["model"])
MODEL_DIR = DATA_DIR / "model"
CLASS_CODE = {"vert": 0, "jaune": 1, "orange": 2, "rouge": 3}
_cache: dict[str, tuple[int, Any]] = {}
_lock = threading.Lock()


def _load(name: str, loader):
    path = MODEL_DIR / name
    try:
        mtime = path.stat().st_mtime_ns
    except FileNotFoundError:
        raise DataMissing(f"'{name}' missing in data/model. Run: python backend/scripts/import_pipeline.py")
    with _lock:
        hit = _cache.get(name)
        if hit and hit[0] == mtime:
            return hit[1]
    value = loader(path)
    with _lock:
        _cache[name] = (mtime, value)
    return value


def _parquet(p: Path) -> pd.DataFrame:
    with open(p, "rb") as fh:
        return pd.read_parquet(io.BytesIO(fh.read()))


def _plan() -> pd.DataFrame:
    return _load("plan.csv", lambda p: pd.read_csv(p))


def _weekly() -> dict[str, pd.DataFrame]:
    return _load("field_weekly.parquet", lambda p: {k: g.sort_values("week_start") for k, g in _parquet(p).groupby("field_id")})


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return v
    return None if not np.isfinite(f) else round(f, 4)


@router.get("/metrics", summary="Test metrics of the forecaster (vs persistence / seasonal), LOZO, thresholds")
def metrics() -> dict:
    m = _load("metrics.json", lambda p: json.loads(p.read_text(encoding="utf-8")))
    fi = _load("feature_importance.csv", lambda p: pd.read_csv(p))
    total = float(fi["gain"].sum()) or 1.0
    top = [{"feature": r.feature, "share": round(float(r.gain) / total, 4)} for r in fi.head(12).itertuples()]
    figures = sorted(p.name for p in (MODEL_DIR / "figures").glob("*.png")) if (MODEL_DIR / "figures").exists() else []
    return {**m, "feature_importance": top, "figures": figures}


@router.get("/plan", summary="Next-week irrigation plan per field (class now / next week, demand m³)")
def plan(zone: str | None = Query(None), limit: int = Query(2000, ge=1, le=5000)) -> dict:
    df = _plan()
    if zone:
        df = df[df["zone"] == zone]
        if df.empty:
            raise NotFound(f"No plan rows for zone '{zone}'")
    rows = []
    for r in df.sort_values("besoin_m3", ascending=False).head(limit).itertuples():
        rows.append({
            "field_id": r.site_id, "zone": r.zone, "area_ha": _num(r.area_ha), "irrigated_summer": bool(r.irrigated),
            "ndmi": _num(r.ndmi), "pred_ndmi_next": _num(r.pred_ndmi_next), "z_now": _num(r.z_actuel),
            "z_next": _num(r.z_prevu), "class_now": CLASS_CODE.get(r.classe_actuelle),
            "class_next": CLASS_CODE.get(r.classe_prevue), "et0_next_mm": _num(r.et0_sum_next),
            "rain_next_mm": _num(r.rain_sum_next), "demand_m3": _num(r.besoin_m3),
            "state_week": str(r.semaine_etat), "days_since_obs": int(r.days_since_obs),
        })
    by_zone = []
    for z, g in df.groupby("zone"):
        by_zone.append({
            "zone": z, "fields": int(len(g)), "demand_m3": round(float(g["besoin_m3"].sum()), 1),
            "area_ha": round(float(g["area_ha"].sum()), 1),
            "class_now": {str(CLASS_CODE[k]): int(v) for k, v in g["classe_actuelle"].value_counts().items()},
            "class_next": {str(CLASS_CODE[k]): int(v) for k, v in g["classe_prevue"].value_counts().items()},
            "worsening": int((g["classe_prevue"].map(CLASS_CODE) > g["classe_actuelle"].map(CLASS_CODE)).sum()),
            "improving": int((g["classe_prevue"].map(CLASS_CODE) < g["classe_actuelle"].map(CLASS_CODE)).sum()),
        })
    week = str(pd.to_datetime(df["semaine_etat"]).max().date() + pd.Timedelta(days=7)) if len(df) else None
    return {"forecast_week": week, "zones": by_zone, "total_demand_m3": round(float(df["besoin_m3"].sum()), 1), "rows": rows}


@router.get("/fields/{field_id}/weekly", summary="Weekly NDMI observed vs model prediction for one field + next week")
def field_weekly(field_id: str, weeks: int = Query(104, ge=4, le=400)) -> dict:
    g = _weekly().get(field_id)
    if g is None:
        raise NotFound(f"Unknown field '{field_id}'")
    g = g.tail(weeks)
    points = [{
        "week": str(pd.Timestamp(r.week_start).date()), "ndmi": _num(r.ndmi) if r.obs == 1 else None,
        "ndmi_interp": _num(r.ndmi), "ndmi_pred": _num(r.ndmi_pred), "ndvi": _num(r.ndvi),
        "normal": _num(r.normal_ndmi), "sd": _num(r.sd_ndmi),
        "cls": None if pd.isna(r.cls) else int(r.cls), "z": _num(r.z), "forecast": False,
    } for r in g.itertuples()]
    p = _plan()
    row = p[p["site_id"] == field_id]
    nxt = None
    if len(row):
        r = row.iloc[0]
        nxt = {"week": str(pd.Timestamp(r["semaine_etat"]).date() + pd.Timedelta(days=7)),
               "pred_ndmi_next": _num(r["pred_ndmi_next"]), "z_next": _num(r["z_prevu"]),
               "class_now": CLASS_CODE.get(r["classe_actuelle"]), "class_next": CLASS_CODE.get(r["classe_prevue"]),
               "demand_m3": _num(r["besoin_m3"]), "et0_next_mm": _num(r["et0_sum_next"]),
               "rain_next_mm": _num(r["rain_sum_next"])}
        last = points[-1] if points else None
        points.append({"week": nxt["week"], "ndmi": None, "ndmi_interp": None, "ndmi_pred": nxt["pred_ndmi_next"],
                       "ndvi": None, "normal": last["normal"] if last else None, "sd": last["sd"] if last else None,
                       "cls": nxt["class_next"], "z": nxt["z_next"], "forecast": True})
    return {"field_id": field_id, "points": points, "next": nxt}


@router.get("/figures/{name}", summary="Evaluation figures (PNG) made by make_figures.py", include_in_schema=True)
def figure(name: str) -> FileResponse:
    path = (MODEL_DIR / "figures" / name).resolve()
    if path.parent != (MODEL_DIR / "figures").resolve() or path.suffix.lower() != ".png" or not path.exists():
        raise NotFound(f"Unknown figure '{name}'")
    return FileResponse(path, media_type="image/png")
