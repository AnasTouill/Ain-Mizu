from fastapi import APIRouter

from ..deps import Month, Network, Provider, Zone, ensure_zone
from ..schemas import BlockEdgeIn, BlockEdgeOut, CompareOut, NetworkOut, RecomputeIn, RecomputeOut

router = APIRouter(prefix="/api", tags=["network"])


@router.get("/network", response_model=NetworkOut, summary="Physarum network as GeoJSON lines + sources")
def get_network(zone: Zone, month: Month, network: Network) -> dict:
    return network.get_api(zone, month)


@router.post("/network/recompute", response_model=RecomputeOut, summary="Re-run Physarum (custom params / demands)")
def recompute(body: RecomputeIn, network: Network, provider: Provider) -> dict:
    ensure_zone(provider, body.zone)
    params = body.params.model_dump(exclude_none=True) if body.params else None
    return network.recompute(body.zone, body.month, params, body.demand_overrides, body.reset)


@router.post("/network/block-edge", response_model=BlockEdgeOut, summary="Block / unblock a canal (warm start)")
def block_edge(body: BlockEdgeIn, network: Network, provider: Provider) -> dict:
    ensure_zone(provider, body.zone)
    return network.block_edge(body.zone, body.month, body.edge_id, body.blocked)


@router.get("/compare", response_model=CompareOut, summary="Physarum vs shortest path vs equal split")
def compare(zone: Zone, month: Month, network: Network) -> dict:
    return network.compare(zone, month)
