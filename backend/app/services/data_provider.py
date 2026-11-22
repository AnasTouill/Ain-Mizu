"""
DataProvider: the only door between the API and the data.

Mock files (scripts/generate_mock_data.py) and the real pipeline output share the
same schemas and file names (ARCHITECTURE.md section 13), so replacing the files in
data/ requires no code change. Files are cached in memory and reloaded automatically
when their modification time changes.
"""
from __future__ import annotations

import json
import threading
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from ..config import DATA_DIR, DEFAULT_CONFIG, deep_merge, load_config
from ..errors import DataMissing, NotFound


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _read_parquet(path: Path) -> pd.DataFrame:
    # Read through a Python file handle: robust to non-ASCII Windows paths.
    with open(path, "rb") as fh:
        return pd.read_parquet(fh)


class DataProvider(ABC):
    """Abstract interface. Every service reads data through these methods only."""

    @abstractmethod
    def config(self) -> dict: ...

    @abstractmethod
    def fields_geojson(self, zone: str) -> dict: ...

    @abstractmethod
    def field_monthly(self) -> pd.DataFrame: ...

    @abstractmethod
    def weather_monthly(self) -> pd.DataFrame: ...

    @abstractmethod
    def predictions(self) -> pd.DataFrame: ...

    @abstractmethod
    def graph_nodes(self, zone: str) -> list[dict]: ...

    @abstractmethod
    def graph_edges(self, zone: str) -> list[dict]: ...

    @abstractmethod
    def farmers(self) -> list[dict]:
        """farmers.json: [{farmer_id, name, zone, field_ids}] - who owns which fields."""

    @abstractmethod
    def network(self, zone: str, month: str) -> dict | None:
        """Precomputed Physarum result, or None when no file exists (computed live)."""

    @abstractmethod
    def energy(self, zone: str, date: str) -> dict | None:
        """Stored hourly schedule, or None (computed live by the energy service)."""

    @abstractmethod
    def kpis(self, zone: str, month: str) -> dict | None:
        """Stored counters, or None (computed live by the KPI service)."""

    # ------------------------------------------------------------------ conveniences

    def zone_ids(self) -> list[str]:
        return [z["id"] for z in self.config()["zones"]]

    def zone_center(self, zone: str) -> tuple[float, float]:
        for z in self.config()["zones"]:
            if z["id"] == zone:
                return float(z["center"][0]), float(z["center"][1])
        raise NotFound(f"Unknown zone '{zone}'")

    def predictions_slice(self, zone: str, month: str, status_type: str) -> pd.DataFrame:
        df = self.predictions()
        return df[(df["zone"] == zone) & (df["month"] == month) & (df["status_type"] == status_type)]

    def predictions_for_field(self, field_id: str) -> pd.DataFrame:
        df = self.predictions()
        return df[df["field_id"] == field_id]

    def field_monthly_for_field(self, field_id: str) -> pd.DataFrame:
        df = self.field_monthly()
        return df[df["field_id"] == field_id]


class FileDataProvider(DataProvider):
    """Reads the flat files in data/ (Parquet + JSON/GeoJSON)."""

    def __init__(self, data_dir: Path | str = DATA_DIR):
        self.data_dir = Path(data_dir)
        self._cache: dict[str, tuple[int, Any]] = {}
        self._derived: dict[str, tuple[tuple, Any]] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ caching

    def _mtime(self, name: str) -> int | None:
        try:
            return (self.data_dir / name).stat().st_mtime_ns
        except FileNotFoundError:
            return None

    def _load(self, name: str, loader: Callable[[Path], Any], required: bool = True) -> Any:
        mtime = self._mtime(name)
        if mtime is None:
            if required:
                raise DataMissing(
                    f"Data file '{name}' not found in the data folder. "
                    "Run: python backend/scripts/generate_mock_data.py"
                )
            return None
        with self._lock:
            hit = self._cache.get(name)
            if hit is not None and hit[0] == mtime:
                return hit[1]
        value = loader(self.data_dir / name)
        with self._lock:
            self._cache[name] = (mtime, value)
        return value

    def _derive(self, key: str, sources: tuple[str, ...], builder: Callable[[], Any]) -> Any:
        """Cache a structure derived from source files; rebuilt when any source changes."""
        signature = tuple(self._mtime(s) for s in sources)
        with self._lock:
            hit = self._derived.get(key)
            if hit is not None and hit[0] == signature:
                return hit[1]
        value = builder()
        with self._lock:
            self._derived[key] = (signature, value)
        return value

    # ------------------------------------------------------------------ primitives

    def config(self) -> dict:
        cfg = self._load("config.json", load_config, required=False)
        return cfg if cfg is not None else deep_merge(DEFAULT_CONFIG, {})

    def fields_geojson(self, zone: str) -> dict:
        return self._load(f"fields_{zone}.geojson", _read_json)

    def field_monthly(self) -> pd.DataFrame:
        return self._load("field_monthly.parquet", _read_parquet)

    def weather_monthly(self) -> pd.DataFrame:
        return self._load("weather_monthly.parquet", _read_parquet)

    def predictions(self) -> pd.DataFrame:
        return self._load("predictions.parquet", _read_parquet)

    def graph_nodes(self, zone: str) -> list[dict]:
        return self._load(f"graph_nodes_{zone}.json", _read_json)

    def graph_edges(self, zone: str) -> list[dict]:
        return self._load(f"graph_edges_{zone}.json", _read_json)

    def farmers(self) -> list[dict]:
        base = self._load("farmers.json", _read_json)
        # farms created by farmer onboarding (farms.json) also appear as farmers, keyed by farm_id
        farms = self._load("farms.json", _read_json, required=False) or []
        extra = [{"farmer_id": f["farm_id"], "name": f["name"], "zone": f["zone"], "field_ids": f["field_ids"]}
                 for f in farms if f.get("field_ids")]
        return list(base) + extra

    def network(self, zone: str, month: str) -> dict | None:
        return self._load(f"network_{zone}_{month}.json", _read_json, required=False)

    def energy(self, zone: str, date: str) -> dict | None:
        return self._load(f"energy_{zone}_{date}.json", _read_json, required=False)

    def kpis(self, zone: str, month: str) -> dict | None:
        return self._load(f"kpis_{zone}_{month}.json", _read_json, required=False)

    # ------------------------------------------------------------------ fast indexes

    def predictions_slice(self, zone: str, month: str, status_type: str) -> pd.DataFrame:
        def build() -> dict:
            df = self.predictions()
            return {key: grp for key, grp in df.groupby(["zone", "month", "status_type"], sort=False)}

        index = self._derive("pred_by_zone_month", ("predictions.parquet",), build)
        hit = index.get((zone, month, status_type))
        return hit if hit is not None else self.predictions().iloc[0:0]

    def predictions_for_field(self, field_id: str) -> pd.DataFrame:
        index = self._derive(
            "pred_by_field",
            ("predictions.parquet",),
            lambda: {k: g for k, g in self.predictions().groupby("field_id", sort=False)},
        )
        hit = index.get(field_id)
        return hit if hit is not None else self.predictions().iloc[0:0]

    def field_monthly_for_field(self, field_id: str) -> pd.DataFrame:
        index = self._derive(
            "fm_by_field",
            ("field_monthly.parquet",),
            lambda: {k: g for k, g in self.field_monthly().groupby("field_id", sort=False)},
        )
        hit = index.get(field_id)
        return hit if hit is not None else self.field_monthly().iloc[0:0]
