from typing import Annotated

from fastapi import APIRouter, Query

from ..deps import Month, Provider, Zone
from ..schemas import PredictionRow, StatusType
from ..services.util import records

router = APIRouter(prefix="/api", tags=["predictions"])

COLUMNS = (
    "zone", "field_id", "month", "ndmi_obs", "ndmi_pred", "horizon", "residual", "anomaly_z", "trend",
    "ndvi_anomaly_z", "stress_class", "stress_score", "demand_score", "status_type",
)


@router.get("/predictions", response_model=list[PredictionRow], summary="Rows of predictions.parquet")
def get_predictions(
    zone: Zone,
    month: Month,
    provider: Provider,
    status_type: StatusType = "current",
    stress_class: Annotated[int | None, Query(ge=0, le=3)] = None,
) -> list[dict]:
    rows = provider.predictions_slice(zone, month, status_type)
    if stress_class is not None:
        rows = rows[(rows["stress_class"] == stress_class).fillna(False).astype(bool)]
    return records(rows, COLUMNS)
