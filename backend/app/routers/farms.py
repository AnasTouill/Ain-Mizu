"""Farmer onboarding and farms (outline, sub-zones with crop and soil, water sources)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..deps import Provider
from ..services import auth, onboarding

router = APIRouter(prefix="/api", tags=["onboarding"])


class SubZoneIn(BaseModel):
    name: str | None = None
    polygon: list[list[float]] = Field(description="[[lon, lat], ...]")
    crop: str | None = None
    soil: str | None = None


class SourceIn(BaseModel):
    lon: float
    lat: float
    type: str = "puits"
    suggested: bool = False


class FarmIn(BaseModel):
    name: str | None = None
    zone: str | None = None
    boundary: list[list[float]] = Field(description="farm outline [[lon, lat], ...]")
    sub_zones: list[SubZoneIn] = []
    has_water_source: bool = False
    water_sources: list[SourceIn] = []


class GeomIn(BaseModel):
    zone: str
    boundary: list[list[float]]
    sub_zones: list[SubZoneIn] = []


@router.get("/onboarding/options", summary="Zones (with extent), crops, soils and water-source types")
def get_options(provider: Provider) -> dict:
    return onboarding.options(provider)


@router.post("/onboarding/auto-segment", summary="Satellite-detected fields inside the outline, as candidate sub-zones")
def auto_segment(body: GeomIn, provider: Provider, user: auth.CurrentUser) -> dict:
    return onboarding.auto_segments(provider, body.zone, body.boundary)


@router.post("/onboarding/suggest-source", summary="Where to install a water source (weighted geometric median)")
def suggest(body: GeomIn, provider: Provider, user: auth.CurrentUser) -> dict:
    return onboarding.suggest_source(provider, body.zone, body.boundary, [s.model_dump() for s in body.sub_zones])


@router.post("/farms", status_code=201, summary="Validate onboarding: save the farm and link it to the user")
def create_farm(body: FarmIn, provider: Provider, user: auth.CurrentUser) -> dict[str, Any]:
    farm = onboarding.create_farm(provider, user, body.model_dump())
    updated = auth.update_user(user["user_id"], farm_ids=list(user.get("farm_ids") or []) + [farm["farm_id"]])
    return {"farm": farm, "user": auth.public(updated)}


@router.get("/farms", summary="Farms of the current user")
def my_farms(user: auth.CurrentUser) -> list[dict]:
    return [f for f in onboarding.load_farms() if user.get("role") == "admin" or f["owner_user_id"] == user["user_id"]]


@router.get("/farms/{farm_id}", summary="One farm (403 if it is not yours)")
def get_farm(farm_id: str, user: auth.CurrentUser) -> dict:
    return onboarding.get_farm(farm_id, user)


@router.get("/terrain/{zone}", summary="Obstacle layers (built-up, water, roads, canals) inside a bbox, from the offline cache")
def get_terrain(zone: str, bbox: str, provider: Provider) -> dict:
    from fastapi import HTTPException

    from ..services import terrain

    if zone not in provider.zone_ids():
        raise HTTPException(404, f"Unknown zone '{zone}'")
    try:
        w, s, e, n = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(422, "bbox must be 'west,south,east,north'")
    if e - w > 0.3 or n - s > 0.3:
        raise HTTPException(422, "bbox too large (max 0.3 degree)")
    return terrain.layers_geojson(zone, (w, s, e, n))


# --------------------------------------------------------------------------- edit, statistics, control panel


@router.put("/farms/{farm_id}", summary="Edit a farm (outline, sub-zones, crops, soils, water sources)")
def update_farm(farm_id: str, body: FarmIn, provider: Provider, user: auth.CurrentUser) -> dict[str, Any]:
    from ..services import control

    onboarding.get_farm(farm_id, user)
    farm = onboarding.create_farm(provider, user, body.model_dump(), replace_id=farm_id)
    st = control.load(farm_id)  # pipe ids change with the new layout: reopen everything
    st["closed_valves"], st["disabled_routes"] = [], []
    control.touch(st, user)
    control.save(st)
    control.log(farm_id, user["user_id"], "farm_edited", {"sub_zones": len(farm["sub_zones"])})
    return {"farm": farm, "user": auth.public(user)}


@router.get("/farms/{farm_id}/stats", summary="Statistics: stress history, forecast, water vs baseline, energy")
def farm_stats(farm_id: str, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services.farm_stats import farm_stats as build

    return build(provider, onboarding.get_farm(farm_id, user))


def _control(provider, farm: dict) -> tuple[dict, dict]:
    from ..services import control
    from ..services.farm_local import farm_plan_local

    st = control.tick(control.load(farm["farm_id"]))
    control.save(st)
    plan = farm_plan_local(provider, farm, provider.config()["months"]["last_observed"], "current")
    return st, plan


@router.get("/farms/{farm_id}/control", summary="Control state: pump, routes, valves, schedule, live flow, warnings")
def get_control(farm_id: str, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services import control

    st, plan = _control(provider, onboarding.get_farm(farm_id, user))
    return control.view(st, plan)


class PumpIn(BaseModel):
    on: bool
    auto_off_minutes: int | None = Field(None, ge=5, le=480)


@router.put("/farms/{farm_id}/control/pump", summary="Turn the pump on or off (409 if no open path needs water)")
def put_pump(farm_id: str, body: PumpIn, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services import control

    farm = onboarding.get_farm(farm_id, user)
    st, plan = _control(provider, farm)
    control.set_pump(st, plan, body.on, body.auto_off_minutes, user)
    control.save(st)
    return control.view(st, plan)


class ToggleIn(BaseModel):
    enabled: bool


@router.put("/farms/{farm_id}/control/routes/{sub_zone_id}", summary="Open or close the water route of one sub-zone")
def put_route(farm_id: str, sub_zone_id: str, body: ToggleIn, provider: Provider, user: auth.CurrentUser) -> dict:
    from fastapi import HTTPException

    from ..services import control
    from ..services.farm_local import set_route_local

    farm = onboarding.get_farm(farm_id, user)
    st, plan = _control(provider, farm)
    if not body.enabled and st["pump"]["on"]:
        others = [f for f in plan["fields"]["features"] if f["properties"]["needs_water"] and f["properties"]["reachable"]
                  and f["properties"]["field_id"] not in set(st["disabled_routes"]) | {sub_zone_id}]
        if not others:
            raise HTTPException(409, "C'est le dernier chemin ouvert : arrêtez d'abord la pompe")
    set_route_local(provider, farm, provider.config()["months"]["last_observed"], "current", sub_zone_id, body.enabled, user)
    st, plan = _control(provider, farm)
    return control.view(st, plan)


class ValveIn(BaseModel):
    open: bool


@router.put("/farms/{farm_id}/control/valves/{valve_id}", summary="Open or close one pipe valve (Physarum reroutes)")
def put_valve(farm_id: str, valve_id: str, body: ValveIn, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services import control
    from ..services.farm_local import block_edge_local

    farm = onboarding.get_farm(farm_id, user)
    block_edge_local(provider, farm, provider.config()["months"]["last_observed"], "current", valve_id, not body.open, user)
    st, plan = _control(provider, farm)
    return control.view(st, plan)


class ModeIn(BaseModel):
    mode: str = Field(pattern="^(manual|auto)$")


@router.put("/farms/{farm_id}/control/mode", summary="manual (farmer decides) or auto (pump follows the schedule)")
def put_mode(farm_id: str, body: ModeIn, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services import control

    farm = onboarding.get_farm(farm_id, user)
    st, plan = _control(provider, farm)
    st["mode"] = body.mode
    control.touch(st, user)
    control.log(farm_id, user["user_id"], f"mode_{body.mode}")
    st = control.tick(st)
    control.save(st)
    return control.view(st, plan)


class Slot(BaseModel):
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    minutes: int = Field(ge=5, le=600)


class ScheduleIn(BaseModel):
    slots: list[Slot]


@router.put("/farms/{farm_id}/control/schedule", summary="Pumping schedule used in auto mode")
def put_schedule(farm_id: str, body: ScheduleIn, provider: Provider, user: auth.CurrentUser) -> dict:
    from ..services import control

    farm = onboarding.get_farm(farm_id, user)
    st, plan = _control(provider, farm)
    st["schedule"] = [s.model_dump() for s in sorted(body.slots, key=lambda s: s.start)]
    control.touch(st, user)
    control.log(farm_id, user["user_id"], "schedule", {"slots": st["schedule"]})
    st = control.tick(st)
    control.save(st)
    return control.view(st, plan)


@router.get("/farms/{farm_id}/control/log", summary="Recent control actions")
def get_log(farm_id: str, user: auth.CurrentUser, limit: int = 30) -> list[dict]:
    from ..services import control

    onboarding.get_farm(farm_id, user)
    return control.read_log(farm_id, min(max(limit, 1), 200))
