"""Small shared helpers: months, local projection, polygon geometry, JSON-safe values."""
from __future__ import annotations

import calendar
import math
from typing import Any, Iterable, Sequence

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- months


def parse_month(month: str) -> tuple[int, int]:
    year, mon = month.split("-")[:2]
    return int(year), int(mon)


def month_add(month: str, k: int) -> str:
    """'2026-10' + 3 -> '2027-01'."""
    year, mon = parse_month(month)
    idx = year * 12 + (mon - 1) + k
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def month_diff(a: str, b: str) -> int:
    """Number of months from a to b (b - a)."""
    ya, ma = parse_month(a)
    yb, mb = parse_month(b)
    return (yb * 12 + mb) - (ya * 12 + ma)


def month_range(first: str, last: str) -> list[str]:
    n = month_diff(first, last)
    return [month_add(first, i) for i in range(n + 1)]


def days_in_month(month: str) -> int:
    year, mon = parse_month(month)
    return calendar.monthrange(year, mon)[1]


# --------------------------------------------------------------------------- local projection
# A local equirectangular projection around the zone centre. Over a 10 km tile the error
# versus UTM 32N is < 0.1 %, and it avoids a pyproj dependency.

M_PER_DEG_LAT = 110_540.0


def m_per_deg_lon(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def to_local(lon: float, lat: float, lon0: float, lat0: float) -> tuple[float, float]:
    return (lon - lon0) * m_per_deg_lon(lat0), (lat - lat0) * M_PER_DEG_LAT


def to_lonlat(x: float, y: float, lon0: float, lat0: float) -> tuple[float, float]:
    return lon0 + x / m_per_deg_lon(lat0), lat0 + y / M_PER_DEG_LAT


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6_371_008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def polygon_area_m2(xy: Sequence[Sequence[float]]) -> float:
    """Shoelace formula on local metric coordinates (ring may or may not be closed)."""
    pts = np.asarray(xy, dtype=float)
    x, y = pts[:, 0], pts[:, 1]
    return float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2.0)


def polygon_centroid(xy: Sequence[Sequence[float]]) -> tuple[float, float]:
    pts = np.asarray(xy, dtype=float)
    x, y = pts[:, 0], pts[:, 1]
    xn, yn = np.roll(x, -1), np.roll(y, -1)
    cross = x * yn - xn * y
    area = cross.sum() / 2.0
    if abs(area) < 1e-9:
        return float(x.mean()), float(y.mean())
    cx = ((x + xn) * cross).sum() / (6 * area)
    cy = ((y + yn) * cross).sum() / (6 * area)
    return float(cx), float(cy)


# --------------------------------------------------------------------------- JSON-safe values


def native(value: Any) -> Any:
    """Convert numpy/pandas scalars (and NaN / NA) to plain Python values, recursively."""
    if value is None:
        return None
    if isinstance(value, dict):
        return {k: native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [native(v) for v in value]
    if isinstance(value, np.ndarray):
        return [native(v) for v in value.tolist()]
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def records(df: pd.DataFrame, columns: Iterable[str] | None = None) -> list[dict]:
    """DataFrame -> list of JSON-safe dicts."""
    if columns is not None:
        df = df.loc[:, list(columns)]
    cols = list(df.columns)
    return [{c: native(v) for c, v in zip(cols, row)} for row in df.itertuples(index=False, name=None)]
