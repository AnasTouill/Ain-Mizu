from fastapi import APIRouter

from ..deps import KpiSvc, Month, Zone
from ..schemas import Kpis

router = APIRouter(prefix="/api", tags=["kpis"])


@router.get("/kpis", response_model=Kpis, summary="Dashboard counters")
def get_kpis(zone: Zone, month: Month, kpis: KpiSvc) -> dict:
    return kpis.get(zone, month)
