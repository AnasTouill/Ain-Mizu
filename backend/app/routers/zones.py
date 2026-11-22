from fastapi import APIRouter

from ..deps import Provider
from ..schemas import ZoneInfo
from ..services.zones import list_zones

router = APIRouter(prefix="/api", tags=["zones"])


@router.get("/zones", response_model=list[ZoneInfo], summary="Zones with centre, field count and month range")
def get_zones(provider: Provider) -> list[dict]:
    return list_zones(provider)
