"""Paths and config.json loading.

The backend never hard-codes data locations: everything lives in ``data/`` (or the
folder given by the ``PHYSARUM_DATA_DIR`` environment variable).
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent
DATA_DIR = Path(os.environ.get("PHYSARUM_DATA_DIR") or (REPO_DIR / "data")).resolve()

# Comma-separated list, "*" allows every origin (dev default; the Vite proxy makes CORS optional anyway).
CORS_ORIGINS = [o.strip() for o in os.environ.get("PHYSARUM_CORS_ORIGINS", "*").split(",") if o.strip()]

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
DATE_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"

# Defaults mirror ARCHITECTURE.md section 13.9. data/config.json overrides any key.
DEFAULT_CONFIG: dict[str, Any] = {
    "zones": [
        {"id": "kairouan", "name": "Kairouan", "center": [10.10, 35.68]},
        {"id": "sidi_bouzid", "name": "Sidi Bouzid", "center": [9.49, 35.04]},
        {"id": "kebili", "name": "Kebili", "center": [8.97, 33.70]},
    ],
    "months": {"first_observed": "2018-01", "last_observed": "2026-10", "forecast_horizon": 3},
    "class_labels": ["green", "yellow", "orange", "red"],
    "class_colors": ["#2e9e4f", "#f2c230", "#f08a24", "#d62f2f"],
    "demand_weights": {"green": 0.0, "yellow": 0.2, "orange": 0.6, "red": 1.0},
    "class_thresholds": {"note": "set by k-means (k=4) on [anomaly_z, trend, ndvi_anomaly_z]; adjust by hand"},
    "physarum": {
        "gamma": 1.4,
        "dt": 0.1,
        "max_iterations": 200,
        "tolerance": 1e-4,
        "prune_threshold": 0.01,
        "initial_conductivity": 1.0,
        "flux_scale": 12.0,
    },
    "edge_cost": {"slope_penalty_a": 5.0, "default_loss_rate": 0.08, "existing_canal_factor": 0.6},
    "energy": {
        "pump_kw": 15.0,
        "kwh_per_m3": 0.357,
        "pv_kwp": 24.0,
        "pv_performance_ratio": 0.8,
        "tank_capacity_m3": 500.0,
        "tank_initial_frac": 0.35,
        "station_share_of_demand": 0.08,
        "irrigation_hours": [5, 6, 7, 18, 19, 20, 21],
    },
    "ui": {"default_zone": "kebili", "default_language": "fr"},
    "data_source": "synthetic",
}


def deep_merge(base: dict, override: dict | None) -> dict:
    """Recursively merge ``override`` into a copy of ``base`` (lists are replaced, not merged)."""
    out = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def load_config(path: Path | None = None) -> dict:
    """Load data/config.json merged over the defaults (a missing file means pure defaults)."""
    path = Path(path) if path else DATA_DIR / "config.json"
    user: dict = {}
    if path.exists():
        user = json.loads(path.read_text(encoding="utf-8"))
    return deep_merge(DEFAULT_CONFIG, user)
