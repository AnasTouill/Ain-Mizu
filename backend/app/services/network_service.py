"""Network orchestration: precomputed results, live what-if scenarios and the API shape.

* ``GET /api/network`` returns the live scenario for (zone, month) if one exists,
  otherwise the precomputed ``network_{zone}_{month}.json`` (computed live and cached
  when the file is missing).
* ``block-edge`` warm-starts Physarum from the current conductivities.
* ``recompute`` cold-starts Physarum with custom parameters / demand overrides.
"""
from __future__ import annotations

import math
import threading

import pandas as pd

from ..errors import NotFound
from . import physarum
from .data_provider import DataProvider
from .physarum import EdgeCostParams, PhysarumParams
from .scenario_store import Scenario, ScenarioStore


class NetworkService:
    def __init__(self, provider: DataProvider, store: ScenarioStore):
        self.provider = provider
        self.store = store
        self._live: dict[tuple[str, str], dict] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ static inputs

    def graph(self, zone: str) -> tuple[list[dict], list[dict]]:
        return self.provider.graph_nodes(zone), self.provider.graph_edges(zone)

    def field_maps(self, zone: str) -> tuple[dict[str, float], dict[str, bool]]:
        fc = self.provider.fields_geojson(zone)
        area = {f["properties"]["field_id"]: float(f["properties"]["area_ha"]) for f in fc["features"]}
        irrigated = {f["properties"]["field_id"]: bool(f["properties"]["is_irrigated"]) for f in fc["features"]}
        return area, irrigated

    def default_params(self) -> PhysarumParams:
        return PhysarumParams.from_dict(self.provider.config().get("physarum"))

    def cost(self) -> EdgeCostParams:
        return EdgeCostParams.from_dict(self.provider.config().get("edge_cost"))

    def status_for(self, zone: str, month: str) -> str:
        for status in ("current", "forecast"):
            if not self.provider.predictions_slice(zone, month, status).empty:
                return status
        raise NotFound(f"No predictions for zone '{zone}' and month '{month}'")

    def base_demands(self, zone: str, month: str) -> dict[str, float]:
        """Demand weight per field: w(stress_class) from config (0 for unclassified)."""
        cfg = self.provider.config()
        labels, weights = cfg["class_labels"], cfg["demand_weights"]
        rows = self.provider.predictions_slice(zone, month, self.status_for(zone, month))
        out: dict[str, float] = {}
        for fid, cls in zip(rows["field_id"], rows["stress_class"]):
            out[str(fid)] = 0.0 if pd.isna(cls) else float(weights.get(labels[int(cls)], 0.0))
        return out

    def total_demand_ha_eq(self, zone: str, month: str) -> float:
        area, _ = self.field_maps(zone)
        return float(sum(area.get(f, 0.0) * w for f, w in self.base_demands(zone, month).items()))

    def static_blocked(self, zone: str) -> set[str]:
        return {e["edge_id"] for e in self.provider.graph_edges(zone) if e.get("blocked")}

    def blocked_edges(self, zone: str, month: str) -> set[str]:
        scenario = self.store.get(zone, month)
        return self.static_blocked(zone) | (scenario.blocked if scenario else set())

    # ------------------------------------------------------------------ results

    def _compute(self, zone, month, *, params, demands, blocked=(), conductivity_init=None) -> dict:
        nodes, edges = self.graph(zone)
        _, irrigated = self.field_maps(zone)
        return physarum.compute_network(
            zone=zone,
            month=month,
            nodes=nodes,
            edges=edges,
            demand_weights=demands,
            params=params,
            cost=self.cost(),
            blocked=blocked,
            conductivity_init=conductivity_init,
            irrigated=irrigated,
        )

    def base(self, zone: str, month: str) -> dict:
        """Baseline plan: the stored file, or a live computation cached in memory."""
        stored = self.provider.network(zone, month)
        if stored is not None:
            return {
                "network": stored,
                "conductivity": {e["edge_id"]: float(e.get("conductivity") or 0.0) for e in stored["edges"]},
                "fields_unserved": [],
                "iterations_used": int((stored.get("params") or {}).get("iterations") or 0),
                "source": "file",
            }
        key = (zone, month)
        with self._lock:
            if key in self._live:
                return self._live[key]
        result = self._compute(zone, month, params=self.default_params(), demands=self.base_demands(zone, month))
        result["source"] = "live"
        with self._lock:
            self._live[key] = result
        return result

    def current(self, zone: str, month: str) -> dict:
        scenario = self.store.get(zone, month)
        if scenario is not None and scenario.result is not None:
            return scenario.result
        return self.base(zone, month)

    def water_saved(self, zone: str, network: dict) -> float:
        area, irrigated = self.field_maps(zone)
        return physarum.water_saved_from_network(network, area, irrigated)

    def unserved_fields(self, zone: str, network: dict, blocked: set[str]) -> list[str]:
        """Demanding fields not connected to a source through kept, unblocked edges."""
        nodes, edges = self.graph(zone)
        kept = {e["edge_id"] for e in network["edges"] if e.get("kept")} - blocked
        adjacency: dict[str, list[str]] = {n["node_id"]: [] for n in nodes}
        for e in edges:
            if e["edge_id"] in kept and e["from"] in adjacency and e["to"] in adjacency:
                adjacency[e["from"]].append(e["to"])
                adjacency[e["to"]].append(e["from"])
        seen = {n["node_id"] for n in nodes if n.get("type") == "source"}
        stack = list(seen)
        while stack:
            for nxt in adjacency[stack.pop()]:
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append(nxt)
        demands = network.get("demands") or {}
        return sorted(f for f, w in demands.items() if w and float(w) > 0 and f not in seen)

    # ------------------------------------------------------------------ API shape

    def to_api(self, zone: str, month: str, result: dict) -> dict:
        nodes, edges = self.graph(zone)
        pos = {n["node_id"]: [float(n["lon"]), float(n["lat"])] for n in nodes}
        by_id = {e["edge_id"]: e for e in result["network"]["edges"]}
        blocked = self.blocked_edges(zone, month)
        features = []
        for e in edges:
            r = by_id.get(e["edge_id"], {"flow": 0.0, "conductivity": 0.0, "kept": False})
            flow = float(r.get("flow") or 0.0)
            a, b = pos.get(e["from"]), pos.get(e["to"])
            if a is None or b is None:
                continue
            is_blocked = e["edge_id"] in blocked
            features.append(
                {
                    "type": "Feature",
                    # oriented downstream: the line starts where the water comes from
                    "geometry": {"type": "LineString", "coordinates": [a, b] if flow >= 0 else [b, a]},
                    "properties": {
                        "edge_id": e["edge_id"],
                        "flow": round(abs(flow), 4),
                        "conductivity": round(float(r.get("conductivity") or 0.0), 4),
                        "kept": bool(r.get("kept")) and not is_blocked,
                        "blocked": is_blocked,
                        "length_m": float(e["length_m"]),
                    },
                }
            )
        sources = [
            {
                "node_id": n["node_id"],
                "lon": float(n["lon"]),
                "lat": float(n["lat"]),
                "capacity_m3_day": float(n["capacity_m3_day"]) if n.get("capacity_m3_day") is not None else None,
            }
            for n in nodes
            if n.get("type") == "source"
        ]
        return {
            "zone": zone,
            "month": month,
            "sources": sources,
            "edges": {"type": "FeatureCollection", "features": features},
            "metrics": result["network"]["metrics"],
        }

    def get_api(self, zone: str, month: str) -> dict:
        return self.to_api(zone, month, self.current(zone, month))

    # ------------------------------------------------------------------ what-if

    def _scenario_params(self, scenario: Scenario) -> PhysarumParams:
        return PhysarumParams.from_dict(scenario.params, base=self.default_params())

    def _clean_params(self, scenario: Scenario) -> None:
        """Forget overrides that equal the config defaults (so the scenario can become pristine)."""
        defaults = self.default_params().to_dict()
        for key in list(scenario.params):
            if key not in defaults or math.isclose(float(scenario.params[key]), float(defaults[key]), rel_tol=1e-9):
                scenario.params.pop(key, None)

    def block_edge(self, zone: str, month: str, edge_id: str, blocked: bool) -> dict:
        _, edges = self.graph(zone)
        if edge_id not in {e["edge_id"] for e in edges}:
            raise NotFound(f"Unknown edge '{edge_id}' in zone '{zone}'")
        with self.store.lock:
            before = self.current(zone, month)
            blocked_before = self.blocked_edges(zone, month)
            kept_before = {e["edge_id"] for e in before["network"]["edges"] if e.get("kept")} - blocked_before

            scenario = self.store.get_or_create(zone, month)
            if not scenario.conductivity:
                scenario.conductivity = dict(before["conductivity"])
            if blocked:
                scenario.blocked.add(edge_id)
            else:
                scenario.blocked.discard(edge_id)
                # a re-opened canal starts open; the dynamics decide whether it stays
                initial = self._scenario_params(scenario).initial_conductivity
                scenario.conductivity[edge_id] = max(scenario.conductivity.get(edge_id, 0.0), initial)

            if scenario.is_pristine():
                self.store.drop(zone, month)
                after = dict(self.base(zone, month))
                after["iterations_used"] = 0  # restored the stored baseline plan
            else:
                demands = {**self.base_demands(zone, month), **scenario.demand_overrides}
                after = self._compute(
                    zone,
                    month,
                    params=self._scenario_params(scenario),
                    demands=demands,
                    blocked=scenario.blocked,
                    conductivity_init=scenario.conductivity,
                )
                scenario.result = after
                scenario.conductivity.update(after["conductivity"])

            blocked_after = self.blocked_edges(zone, month)
            kept_after = {e["edge_id"] for e in after["network"]["edges"] if e.get("kept")} - blocked_after
            response = self.to_api(zone, month, after)
            response.update(
                {
                    "rerouted": kept_after != kept_before,
                    "iterations_used": int(after["iterations_used"]),
                    "fields_unserved": self.unserved_fields(zone, after["network"], blocked_after),
                }
            )
            return response

    def recompute(
        self,
        zone: str,
        month: str,
        params: dict | None = None,
        demand_overrides: dict[str, float | None] | None = None,
        reset: bool = False,
    ) -> dict:
        with self.store.lock:
            if reset:
                self.store.drop(zone, month)
                result = self.base(zone, month)
            else:
                scenario = self.store.get_or_create(zone, month)
                if params:
                    scenario.params.update({k: v for k, v in params.items() if v is not None})
                    self._clean_params(scenario)
                if demand_overrides:
                    area, _ = self.field_maps(zone)
                    for fid, w in demand_overrides.items():
                        if fid not in area:
                            raise NotFound(f"Unknown field '{fid}' in zone '{zone}'")
                        if w is None:
                            scenario.demand_overrides.pop(fid, None)
                        else:
                            scenario.demand_overrides[fid] = min(max(float(w), 0.0), 1.0)
                if scenario.is_pristine():
                    self.store.drop(zone, month)
                    result = self.base(zone, month)
                else:
                    demands = {**self.base_demands(zone, month), **scenario.demand_overrides}
                    result = self._compute(
                        zone, month, params=self._scenario_params(scenario), demands=demands, blocked=scenario.blocked
                    )
                    scenario.result = result
                    scenario.conductivity = dict(result["conductivity"])
            response = self.to_api(zone, month, result)
            response["iterations_used"] = int(result["iterations_used"])
            return response

    def compare(self, zone: str, month: str) -> dict:
        network = self.current(zone, month)["network"]
        metrics, baselines = network["metrics"], network["baselines"]
        return {
            "physarum": {
                "total_length_m": metrics["total_length_m"],
                "weighted_loss": metrics["weighted_loss"],
                "resilience_score": metrics["resilience_score"],
            },
            "shortest_path": baselines["shortest_path"],
            "equal_split": baselines["equal_split"],
            "water_saved_pct_vs_equal_split": self.water_saved(zone, network),
        }
