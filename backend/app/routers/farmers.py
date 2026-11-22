from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..config import MONTH_PATTERN
from ..deps import Month, Network, Provider
from ..schemas import FarmerSummary, FarmPlan, StatusType
from ..services.farms import farm_plan, list_farmers, set_route

router = APIRouter(prefix="/api", tags=["farmers"])


class RouteToggleIn(BaseModel):
    month: str = Field(pattern=MONTH_PATTERN, examples=["2026-10"])
    status_type: StatusType = "current"
    field_id: str = Field(examples=["keb_0068"])
    active: bool


@router.get("/farmers", response_model=list[FarmerSummary], summary="All farms (owner, size, parcels needing water)")
def get_farmers(provider: Provider) -> list[dict]:
    return list_farmers(provider)


@router.get("/farmers/{farmer_id}/plan", response_model=FarmPlan, summary="One farm: its fields, water routes and plan")
def get_plan(farmer_id: str, month: Month, provider: Provider, network: Network, status_type: StatusType = "current") -> dict:
    return farm_plan(provider, network, farmer_id, month, status_type)


@router.post("/farmers/{farmer_id}/routes", response_model=FarmPlan, summary="Switch a parcel's water route on or off")
def toggle_route(farmer_id: str, body: RouteToggleIn, provider: Provider, network: Network) -> dict:
    return set_route(provider, network, farmer_id, body.month, body.status_type, body.field_id, body.active)


class EdgeToggleIn(BaseModel):
    month: str = Field(pattern=MONTH_PATTERN, examples=["2026-11"])
    status_type: StatusType = "current"
    edge_id: str
    blocked: bool


@router.post("/farmers/{farmer_id}/edges", response_model=FarmPlan, summary="Close or reopen a canal of an onboarded farm")
def toggle_edge(farmer_id: str, body: EdgeToggleIn, provider: Provider) -> dict:
    from ..errors import NotFound
    from ..services import farm_local

    own = farm_local.onboarded_farm(farmer_id)
    if own is None:
        raise NotFound(f"'{farmer_id}' is not an onboarded farm (use /api/network/block-edge)")
    return farm_local.block_edge_local(provider, own, body.month, body.status_type, body.edge_id, body.blocked)
