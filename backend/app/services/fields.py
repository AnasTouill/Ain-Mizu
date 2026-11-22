"""Field layer (GeoJSON with the stress class merged in) and per-field time series."""
from __future__ import annotations

from ..errors import NotFound
from .data_provider import DataProvider
from .util import native, records

PREDICTION_PROPS = ("stress_class", "stress_score", "demand_score", "ndmi_pred", "ndmi_obs", "horizon")


def field_collection(provider: DataProvider, zone: str, month: str, status_type: str) -> dict:
    fc = provider.fields_geojson(zone)
    rows = provider.predictions_slice(zone, month, status_type)
    if rows.empty:
        raise NotFound(
            f"No '{status_type}' predictions for zone '{zone}' and month '{month}'. "
            "Forecast rows exist only for the months after the last observation."
        )
    by_field = {r["field_id"]: r for r in records(rows, ("field_id",) + PREDICTION_PROPS)}
    features = []
    for feature in fc["features"]:
        p = feature["properties"]
        r = by_field.get(p["field_id"], {})
        features.append(
            {
                "type": "Feature",
                "geometry": feature["geometry"],
                "properties": {
                    "field_id": p["field_id"],
                    "area_ha": native(p["area_ha"]),
                    "is_irrigated": bool(p["is_irrigated"]),
                    "stress_class": r.get("stress_class"),
                    "stress_score": r.get("stress_score"),
                    "demand_score": r.get("demand_score"),
                    "ndmi_pred": r.get("ndmi_pred"),
                    "ndmi_obs": r.get("ndmi_obs"),
                    "status_type": status_type,
                    "horizon": int(r["horizon"]) if r.get("horizon") is not None else (0 if status_type == "current" else 1),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def field_timeseries(provider: DataProvider, field_id: str, from_month: str | None, to_month: str | None) -> dict:
    preds = provider.predictions_for_field(field_id)
    if preds.empty:
        raise NotFound(f"Unknown field '{field_id}'")
    monthly = provider.field_monthly_for_field(field_id)
    ndvi = {m: native(v) for m, v in zip(monthly["month"], monthly["ndvi"])}
    points = []
    for r in records(preds.sort_values(["month", "horizon"])):
        month = r["month"]
        if (from_month and month < from_month) or (to_month and month > to_month):
            continue
        points.append(
            {
                "month": month,
                "ndvi": ndvi.get(month) if r["status_type"] == "current" else None,
                "ndmi_obs": r["ndmi_obs"],
                "ndmi_pred": r["ndmi_pred"],
                "stress_class": r["stress_class"],
                "status_type": r["status_type"],
            }
        )
    return {"field_id": field_id, "points": points}
