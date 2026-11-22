"""Pydantic v2 response / request models (ARCHITECTURE.md sections 13 and 14)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .config import MONTH_PATTERN

StatusType = Literal["current", "forecast"]


# ----------------------------------------------------------------------------- meta


class Health(BaseModel):
    status: str = Field(examples=["ok"])


class AppConfig(BaseModel):
    """data/config.json (section 13.9). Extra keys are passed through."""

    model_config = ConfigDict(extra="allow")
    zones: list[dict[str, Any]]
    months: dict[str, Any]
    class_labels: list[str]
    class_colors: list[str]
    demand_weights: dict[str, float]
    class_thresholds: dict[str, Any]
    physarum: dict[str, float]
    edge_cost: dict[str, float]


class ZoneInfo(BaseModel):
    id: str
    name: str
    center: list[float] = Field(description="[lon, lat]")
    field_count: int
    irrigated_count: int
    first_month: str
    last_month: str
    forecast_months: list[str]
    bbox: list[float] = Field(description="[min_lon, min_lat, max_lon, max_lat] of the fields")


# ----------------------------------------------------------------------------- fields


class Geometry(BaseModel):
    type: str
    coordinates: Any


class FieldProperties(BaseModel):
    field_id: str
    area_ha: float
    is_irrigated: bool
    stress_class: int | None = Field(description="0 green, 1 yellow, 2 orange, 3 red; null = not classified")
    stress_score: float | None
    demand_score: float | None
    ndmi_pred: float | None
    ndmi_obs: float | None
    status_type: StatusType
    horizon: int


class FieldFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: Geometry
    properties: FieldProperties


class FieldCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[FieldFeature]


class TimeseriesPoint(BaseModel):
    month: str
    ndvi: float | None
    ndmi_obs: float | None
    ndmi_pred: float | None
    stress_class: int | None
    status_type: StatusType


class Timeseries(BaseModel):
    field_id: str
    points: list[TimeseriesPoint]


class PredictionRow(BaseModel):
    zone: str
    field_id: str
    month: str
    ndmi_obs: float | None
    ndmi_pred: float | None
    horizon: int
    residual: float | None
    anomaly_z: float | None
    trend: float | None
    ndvi_anomaly_z: float | None
    stress_class: int | None
    stress_score: float | None
    demand_score: float | None
    status_type: StatusType


# ----------------------------------------------------------------------------- network


class SourceOut(BaseModel):
    node_id: str
    lon: float
    lat: float
    capacity_m3_day: float | None


class EdgeProperties(BaseModel):
    edge_id: str
    flow: float = Field(description="share of the total inflow carried by the canal (geometry points downstream)")
    conductivity: float
    kept: bool
    blocked: bool
    length_m: float


class EdgeFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: Geometry
    properties: EdgeProperties


class EdgeCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[EdgeFeature]


class NetworkMetrics(BaseModel):
    total_length_m: int
    weighted_loss: float
    fields_served: int
    resilience_score: float


class NetworkOut(BaseModel):
    zone: str
    month: str
    sources: list[SourceOut]
    edges: EdgeCollection
    metrics: NetworkMetrics


class RecomputeOut(NetworkOut):
    iterations_used: int


class BlockEdgeOut(NetworkOut):
    rerouted: bool
    iterations_used: int
    fields_unserved: list[str]


class PhysarumParamsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gamma: float | None = Field(None, gt=0.1, le=4.0)
    dt: float | None = Field(None, gt=0.0, le=1.0)
    max_iterations: int | None = Field(None, ge=1, le=2000)
    tolerance: float | None = Field(None, gt=0.0, le=0.1)
    prune_threshold: float | None = Field(None, ge=0.0, lt=1.0)
    initial_conductivity: float | None = Field(None, gt=0.0, le=10.0)
    flux_scale: float | None = Field(None, ge=0.0, le=200.0)


class RecomputeIn(BaseModel):
    zone: str = Field(examples=["kebili"])
    month: str = Field(pattern=MONTH_PATTERN, examples=["2026-08"])
    params: PhysarumParamsIn | None = None
    demand_overrides: dict[str, float | None] | None = Field(
        None, description="field_id -> demand weight in [0, 1] (null removes the override)"
    )
    reset: bool = Field(False, description="drop the what-if scenario and return the stored baseline plan")


class BlockEdgeIn(BaseModel):
    zone: str = Field(examples=["kebili"])
    month: str = Field(pattern=MONTH_PATTERN, examples=["2026-08"])
    edge_id: str = Field(examples=["e_0005"])
    blocked: bool = True


class PlanMetrics(BaseModel):
    total_length_m: int
    weighted_loss: float
    resilience_score: float


class EqualSplitMetrics(BaseModel):
    weighted_loss: float


class CompareOut(BaseModel):
    physarum: PlanMetrics
    shortest_path: PlanMetrics
    equal_split: EqualSplitMetrics
    water_saved_pct_vs_equal_split: float


# ----------------------------------------------------------------------------- farmer view


class FarmerSummary(BaseModel):
    farmer_id: str
    name: str
    zone: str
    field_count: int
    area_ha: float
    fields_need_water: int


class FarmFieldProperties(FieldProperties):
    label: int
    needs_water: bool
    route_active: bool
    reachable: bool
    need_m3_day: int
    next_class: int | None


class FarmFieldFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: Geometry
    properties: FarmFieldProperties


class RouteProperties(EdgeProperties):
    serves: list[str]


class RouteFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: Geometry
    properties: RouteProperties


class FarmSummary(BaseModel):
    fields_total: int
    fields_need_water: int
    fields_watered: int
    total_need_m3_day: int
    irrigation_hours: list[int]
    et0_mm_day: float


class FarmPlan(BaseModel):
    farmer: dict[str, Any]
    month: str
    status_type: StatusType
    fields: dict[str, Any] = Field(description="FeatureCollection of FarmFieldFeature")
    routes: dict[str, Any] = Field(description="FeatureCollection of RouteFeature (canals feeding the farm + closed canals)")
    sources: list[SourceOut]
    summary: FarmSummary
    bbox: list[float]
    boundary: list[list[float]] | None = Field(None, description="Outline of an onboarded farm (map shows only this area)")
    farm_scoped: bool = False
    fields_unserved: list[str] = []
    terrain: dict[str, Any] | None = None


# ----------------------------------------------------------------------------- energy / kpis / actuation


class EnergyHour(BaseModel):
    hour: int
    solar_kw: float
    pump_on: bool
    pump_kw: float
    tank_level_m3: float


class EnergySummary(BaseModel):
    solar_share_pct: float
    grid_kwh: float
    total_pumped_m3: float


class EnergyDay(BaseModel):
    zone: str
    date: str
    tank_capacity_m3: float
    hours: list[EnergyHour]
    summary: EnergySummary


class ClassCounts(BaseModel):
    green: int
    yellow: int
    orange: int
    red: int


class ClassHectares(BaseModel):
    green: float
    yellow: float
    orange: float
    red: float


class Kpis(BaseModel):
    zone: str
    month: str
    fields_by_class: ClassCounts
    hectares_by_class: ClassHectares
    water_saved_pct_vs_equal_split: float
    solar_share_pct: float
    forecast_mae_ndmi: float | None


class PumpState(BaseModel):
    on: bool
    power_kw: float
    flow_m3_h: float


class ValveState(BaseModel):
    edge_id: str
    open: bool
    opening_pct: int


class Actuation(BaseModel):
    pump: PumpState
    valves: list[ValveState]
