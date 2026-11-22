"""Zone summaries for GET /api/zones."""
from __future__ import annotations

from typing import Any, Iterator

from .data_provider import DataProvider


def _positions(coords: Any) -> Iterator[tuple[float, float]]:
    """Yield (lon, lat) pairs from any GeoJSON coordinate nesting (Polygon, MultiPolygon...)."""
    if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (int, float)):
        yield float(coords[0]), float(coords[1])
    elif isinstance(coords, (list, tuple)):
        for c in coords:
            yield from _positions(c)


def list_zones(provider: DataProvider) -> list[dict]:
    preds = provider.predictions()
    out = []
    for z in provider.config()["zones"]:
        zid = z["id"]
        features = provider.fields_geojson(zid)["features"]
        pts = [p for f in features for p in _positions(f["geometry"]["coordinates"])]
        lons, lats = [p[0] for p in pts], [p[1] for p in pts]
        zp = preds[preds["zone"] == zid]
        current = zp.loc[zp["status_type"] == "current", "month"]
        forecast = sorted(zp.loc[zp["status_type"] == "forecast", "month"].unique().tolist())
        out.append(
            {
                "id": zid,
                "name": z.get("name", zid),
                "center": [float(c) for c in z["center"]],
                "field_count": len(features),
                "irrigated_count": sum(1 for f in features if f["properties"].get("is_irrigated")),
                "first_month": str(current.min()) if len(current) else "",
                "last_month": str(current.max()) if len(current) else "",
                "forecast_months": [str(m) for m in forecast],
                "bbox": [min(lons), min(lats), max(lons), max(lats)] if pts else [],
            }
        )
    return out
