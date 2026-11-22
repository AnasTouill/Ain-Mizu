"""In-memory what-if state (blocked canals, custom Physarum parameters, demand overrides).

One scenario per (zone, month). The state lives in the API process: it is shared by the
Dashboard, Network Lab and Actuation screens, and resets when the server restarts
(single-worker dev server; see README).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field


@dataclass
class Scenario:
    blocked: set[str] = field(default_factory=set)
    params: dict[str, float] = field(default_factory=dict)  # only values that differ from config
    demand_overrides: dict[str, float] = field(default_factory=dict)
    conductivity: dict[str, float] = field(default_factory=dict)  # last D per edge (warm starts)
    result: dict | None = None  # last physarum.compute_network() output

    def is_pristine(self) -> bool:
        return not self.blocked and not self.params and not self.demand_overrides


class ScenarioStore:
    def __init__(self) -> None:
        self._items: dict[tuple[str, str], Scenario] = {}
        self.lock = threading.RLock()

    def get(self, zone: str, month: str) -> Scenario | None:
        with self.lock:
            return self._items.get((zone, month))

    def get_or_create(self, zone: str, month: str) -> Scenario:
        with self.lock:
            return self._items.setdefault((zone, month), Scenario())

    def drop(self, zone: str, month: str) -> None:
        with self.lock:
            self._items.pop((zone, month), None)

    def keys(self) -> list[tuple[str, str]]:
        with self.lock:
            return list(self._items)
