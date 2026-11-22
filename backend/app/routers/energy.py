from typing import Annotated

from fastapi import APIRouter, Query

from ..config import DATE_PATTERN
from ..deps import Energy, Zone
from ..schemas import EnergyDay

router = APIRouter(prefix="/api", tags=["energy"])


@router.get("/energy", response_model=EnergyDay, summary="Hourly pumping schedule for one day")
def get_energy(
    zone: Zone,
    energy: Energy,
    date: Annotated[str, Query(pattern=DATE_PATTERN, description="YYYY-MM-DD", examples=["2026-08-15"])],
) -> dict:
    return energy.day(zone, date)
