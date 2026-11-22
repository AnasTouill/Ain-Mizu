"""Dashboard counters (ARCHITECTURE.md section 13.8)."""
from __future__ import annotations

from typing import TYPE_CHECKING, Iterable

import numpy as np
import pandas as pd

if TYPE_CHECKING:  # pragma: no cover
    from .data_provider import DataProvider
    from .energy import EnergyService
    from .network_service import NetworkService
    from .scenario_store import ScenarioStore

CLASS_KEYS = ("green", "yellow", "orange", "red")
HELD_OUT_FROM = "2025-01"  # time split: train 2018-2024, test 2025-2026 (section 3, M2)


def class_breakdown(stress_classes: Iterable, areas_ha: Iterable[float]) -> tuple[dict, dict]:
    """Field counts and hectares per class. Unclassified (rainfed / non-crop) rows are skipped."""
    counts = {k: 0 for k in CLASS_KEYS}
    hectares = {k: 0.0 for k in CLASS_KEYS}
    for cls, area in zip(stress_classes, areas_ha):
        if cls is None or pd.isna(cls):
            continue
        key = CLASS_KEYS[int(cls)]
        counts[key] += 1
        hectares[key] += float(area)
    return counts, {k: round(v, 1) for k, v in hectares.items()}


def forecast_mae(obs: Iterable, pred: Iterable) -> float | None:
    """Mean absolute error of NDMI predictions where an observation exists."""
    o = pd.to_numeric(pd.Series(list(obs), dtype="float64"), errors="coerce").to_numpy()
    p = pd.to_numeric(pd.Series(list(pred), dtype="float64"), errors="coerce").to_numpy()
    ok = np.isfinite(o) & np.isfinite(p)
    if not ok.any():
        return None
    return round(float(np.mean(np.abs(o[ok] - p[ok]))), 4)


def held_out_mae(zone_predictions: pd.DataFrame) -> float | None:
    """MAE over the held-out period (2025-01 onward) of a zone's current rows."""
    df = zone_predictions
    test = df[(df["status_type"] == "current") & (df["month"] >= HELD_OUT_FROM)]
    return forecast_mae(test["ndmi_obs"], test["ndmi_pred"])


def build_kpis(
    zone: str,
    month: str,
    fields_by_class: dict,
    hectares_by_class: dict,
    water_saved_pct: float,
    solar_share_pct: float,
    forecast_mae_ndmi: float | None,
) -> dict:
    return {
        "zone": zone,
        "month": month,
        "fields_by_class": fields_by_class,
        "hectares_by_class": hectares_by_class,
        "water_saved_pct_vs_equal_split": water_saved_pct,
        "solar_share_pct": solar_share_pct,
        "forecast_mae_ndmi": forecast_mae_ndmi,
    }


class KpiService:
    """Reads kpis_{zone}_{month}.json (or computes it), and reflects a live what-if
    scenario (blocked canals / custom parameters) in the water-saved counter."""

    def __init__(
        self,
        provider: "DataProvider",
        network: "NetworkService",
        energy: "EnergyService",
        store: "ScenarioStore",
    ):
        self.provider = provider
        self.network = network
        self.energy = energy
        self.store = store
        self._cache: dict[tuple[str, str], dict] = {}

    def get(self, zone: str, month: str) -> dict:
        stored = self.provider.kpis(zone, month)
        kpis = dict(stored) if stored is not None else self.compute(zone, month)
        scenario = self.store.get(zone, month)
        if scenario is not None and scenario.result is not None:
            kpis["water_saved_pct_vs_equal_split"] = self.network.water_saved(zone, scenario.result["network"])
        return kpis

    def compute(self, zone: str, month: str) -> dict:
        key = (zone, month)
        if key in self._cache:
            return dict(self._cache[key])
        status = self.network.status_for(zone, month)
        rows = self.provider.predictions_slice(zone, month, status)
        area, _ = self.network.field_maps(zone)
        counts, hectares = class_breakdown(rows["stress_class"], [area.get(f, 0.0) for f in rows["field_id"]])
        saved = self.network.water_saved(zone, self.network.base(zone, month)["network"])
        solar = float(self.energy.day(zone, f"{month}-15")["summary"]["solar_share_pct"])
        if status == "current":
            mae = forecast_mae(rows["ndmi_obs"], rows["ndmi_pred"])
        else:
            preds = self.provider.predictions()
            mae = held_out_mae(preds[preds["zone"] == zone])
        kpis = build_kpis(zone, month, counts, hectares, saved, solar, mae)
        self._cache[key] = kpis
        return dict(kpis)
