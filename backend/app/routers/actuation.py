from typing import Annotated

from fastapi import APIRouter, Query

from ..config import DATE_PATTERN
from ..deps import Energy, Month, Network, Zone
from ..schemas import Actuation
from ..services.actuation import actuation_state

router = APIRouter(prefix="/api", tags=["actuation"])


@router.get("/actuation", response_model=Actuation, summary="Virtual valve and pump states")
def get_actuation(
    zone: Zone,
    month: Month,
    network: Network,
    energy: Energy,
    hour: Annotated[int | None, Query(ge=0, le=23, description="hour of the schedule (default 12)")] = None,
    date: Annotated[str | None, Query(pattern=DATE_PATTERN, description="day (default: the 15th of the month)")] = None,
) -> dict:
    return actuation_state(network, energy, zone, month, hour, date)
