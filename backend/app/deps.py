"""FastAPI dependencies: service singletons and shared query parameters."""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Query

from .config import DATA_DIR, MONTH_PATTERN
from .errors import NotFound
from .services.data_provider import DataProvider, FileDataProvider
from .services.energy import EnergyService
from .services.kpis import KpiService
from .services.network_service import NetworkService
from .services.scenario_store import ScenarioStore


@lru_cache(maxsize=1)
def get_provider() -> DataProvider:
    return FileDataProvider(DATA_DIR)


@lru_cache(maxsize=1)
def get_store() -> ScenarioStore:
    return ScenarioStore()


@lru_cache(maxsize=1)
def get_network_service() -> NetworkService:
    return NetworkService(get_provider(), get_store())


@lru_cache(maxsize=1)
def get_energy_service() -> EnergyService:
    return EnergyService(get_provider(), get_network_service())


@lru_cache(maxsize=1)
def get_kpi_service() -> KpiService:
    return KpiService(get_provider(), get_network_service(), get_energy_service(), get_store())


def ensure_zone(provider: DataProvider, zone: str) -> str:
    if zone not in provider.zone_ids():
        raise NotFound(f"Unknown zone '{zone}'. Valid zones: {', '.join(provider.zone_ids())}")
    return zone


def zone_query(
    zone: Annotated[str, Query(description="kairouan | sidi_bouzid | kebili", examples=["kebili"])],
    provider: Annotated[DataProvider, Depends(get_provider)],
) -> str:
    return ensure_zone(provider, zone)


Zone = Annotated[str, Depends(zone_query)]
Month = Annotated[str, Query(pattern=MONTH_PATTERN, description="YYYY-MM", examples=["2026-08"])]
Provider = Annotated[DataProvider, Depends(get_provider)]
Network = Annotated[NetworkService, Depends(get_network_service)]
Energy = Annotated[EnergyService, Depends(get_energy_service)]
KpiSvc = Annotated[KpiService, Depends(get_kpi_service)]
