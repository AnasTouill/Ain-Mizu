"""Virtual hardware (M7): pump and valve states derived from the plan.

* Valves follow the current network (including a live what-if scenario): a kept,
  unblocked canal is open with ``opening_pct = round(conductivity * 100)``.
* The pump follows the hourly energy schedule of the chosen day (default: the 15th
  of the month, 12:00).
"""
from __future__ import annotations

from ..errors import BadRequest
from .energy import EnergyService
from .network_service import NetworkService


def actuation_state(
    network: NetworkService,
    energy: EnergyService,
    zone: str,
    month: str,
    hour: int | None = None,
    date: str | None = None,
) -> dict:
    hour = 12 if hour is None else int(hour)
    if not 0 <= hour <= 23:
        raise BadRequest("hour must be between 0 and 23")
    day = energy.day(zone, date or f"{month}-15")
    row = next((h for h in day["hours"] if int(h["hour"]) == hour), None) or {"pump_on": False, "pump_kw": 0.0}
    pump_kw = float(row.get("pump_kw") or 0.0)
    station = energy.station()

    result = network.current(zone, month)
    blocked = network.blocked_edges(zone, month)
    valves = []
    for e in result["network"]["edges"]:
        is_open = bool(e.get("kept")) and e["edge_id"] not in blocked
        opening = max(1, int(round(min(max(float(e.get("conductivity") or 0.0), 0.0), 1.0) * 100))) if is_open else 0
        valves.append({"edge_id": e["edge_id"], "open": is_open, "opening_pct": opening})
    return {
        "pump": {
            "on": bool(row.get("pump_on")),
            "power_kw": round(pump_kw, 2),
            "flow_m3_h": round(pump_kw / station.kwh_per_m3, 1),
        },
        "valves": valves,
    }
