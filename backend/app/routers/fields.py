from typing import Annotated

from fastapi import APIRouter, Query

from ..config import MONTH_PATTERN
from ..deps import Month, Provider, Zone
from ..schemas import FieldCollection, StatusType, Timeseries
from ..services.fields import field_collection, field_timeseries

router = APIRouter(prefix="/api", tags=["fields"])


@router.get("/fields", response_model=FieldCollection, summary="Fields of a zone with the stress class merged in")
def get_fields(zone: Zone, month: Month, provider: Provider, status_type: StatusType = "current") -> dict:
    return field_collection(provider, zone, month, status_type)


@router.get(
    "/fields/{field_id}/timeseries",
    response_model=Timeseries,
    summary="Monthly history + forecast for one field",
)
def get_timeseries(
    field_id: str,
    provider: Provider,
    from_: Annotated[str | None, Query(alias="from", pattern=MONTH_PATTERN)] = None,
    to: Annotated[str | None, Query(pattern=MONTH_PATTERN)] = None,
) -> dict:
    return field_timeseries(provider, field_id, from_, to)
