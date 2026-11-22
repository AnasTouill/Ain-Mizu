"""Control panel of an onboarded farm (ARCHITECTURE.md 13.13 / 14): pump, routes (one per sub-zone),
valves (one per pipe of the Physarum network), schedule, mode, activity log.

State is persisted in data/control_{farm_id}.json and every action is appended to
data/control_log_{farm_id}.jsonl. All physical effects go through a ``HardwareAdapter``; the only
implementation today is ``VirtualAdapter`` (simulated pump and valves). An MQTT / ESP32 adapter can
replace it later without changing the API (set ``hardware.adapter`` in the control file).

Everything time-related is lazy (no background thread): delivered volume = flow x time since the
pump started, auto-off and the schedule are applied whenever the state is read.
"""
from __future__ import annotations

import json
import threading
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException

from ..config import DATA_DIR
from .auth import write_json_atomic

_lock = threading.RLock()
PUMP_KW = 15.0
PUMP_FLOW_M3_H = 42.0


# --------------------------------------------------------------------------- hardware


class HardwareAdapter(ABC):
    """Where commands go. Implementations must be idempotent."""

    name = "abstract"

    @abstractmethod
    def set_pump(self, farm_id: str, on: bool) -> None: ...

    @abstractmethod
    def set_valve(self, farm_id: str, valve_id: str, open_: bool) -> None: ...

    @abstractmethod
    def status(self, farm_id: str) -> dict: ...


class VirtualAdapter(HardwareAdapter):
    """Simulated hardware: remembers the last command per device and reports it back."""

    name = "virtual"

    def __init__(self) -> None:
        self.devices: dict[str, dict[str, Any]] = {}

    def set_pump(self, farm_id: str, on: bool) -> None:
        self.devices.setdefault(farm_id, {})["pump"] = on

    def set_valve(self, farm_id: str, valve_id: str, open_: bool) -> None:
        self.devices.setdefault(farm_id, {})[valve_id] = open_

    def status(self, farm_id: str) -> dict:
        return {"adapter": self.name, "connected": True, "devices": len(self.devices.get(farm_id, {}))}


ADAPTERS: dict[str, HardwareAdapter] = {"virtual": VirtualAdapter()}


def adapter_for(state: dict) -> HardwareAdapter:
    return ADAPTERS.get((state.get("hardware") or {}).get("adapter", "virtual"), ADAPTERS["virtual"])


# --------------------------------------------------------------------------- state


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _path(farm_id: str):
    return DATA_DIR / f"control_{farm_id}.json"


def _default(farm_id: str) -> dict:
    return {
        "farm_id": farm_id,
        "mode": "manual",
        "pump": {"on": False, "on_since": None, "auto_off_at": None},
        "disabled_routes": [],          # sub-zone ids whose route is switched off
        "closed_valves": [],            # pipe (edge) ids closed by the farmer
        "schedule": [{"start": "05:00", "minutes": 120}, {"start": "18:00", "minutes": 120}],
        "delivered_m3_today": 0.0,
        "delivered_day": _now().date().isoformat(),
        "updated_at": _now().isoformat(),
        "updated_by": None,
        "hardware": {"adapter": "virtual", "connected": True},
    }


def load(farm_id: str) -> dict:
    with _lock:
        p = _path(farm_id)
        if not p.exists():
            return _default(farm_id)
        st = json.loads(p.read_text(encoding="utf-8"))
        base = _default(farm_id)
        base.update(st)
        return base


def save(state: dict) -> None:
    with _lock:
        write_json_atomic(_path(state["farm_id"]), state)


def log(farm_id: str, user_id: str | None, action: str, detail: dict | None = None) -> None:
    line = json.dumps({"ts": _now().isoformat(), "user_id": user_id, "action": action, "detail": detail or {}}, ensure_ascii=False)
    with _lock, open(DATA_DIR / f"control_log_{farm_id}.jsonl", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def read_log(farm_id: str, limit: int = 30) -> list[dict]:
    p = DATA_DIR / f"control_log_{farm_id}.jsonl"
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").strip().splitlines()[-limit:]
    return [json.loads(x) for x in reversed(lines) if x.strip()]


def _in_schedule(state: dict, t: datetime) -> bool:
    for slot in state.get("schedule") or []:
        h, m = (int(v) for v in slot["start"].split(":"))
        start = t.replace(hour=h, minute=m, second=0)
        if start <= t < start + timedelta(minutes=int(slot["minutes"])):
            return True
    return False


def tick(state: dict) -> dict:
    """Apply time: count delivered water, auto-off, daily reset, and the schedule in auto mode."""
    now = _now()
    pump = state["pump"]
    if state.get("delivered_day") != now.date().isoformat():
        state["delivered_day"], state["delivered_m3_today"] = now.date().isoformat(), 0.0
    if pump["on"] and pump.get("on_since"):
        since = datetime.fromisoformat(pump["on_since"])
        end = now
        if pump.get("auto_off_at") and datetime.fromisoformat(pump["auto_off_at"]) <= now:
            end = datetime.fromisoformat(pump["auto_off_at"])
            pump.update({"on": False, "on_since": None, "auto_off_at": None})
        state["delivered_m3_today"] = round(state.get("delivered_m3_today", 0.0) + max((end - since).total_seconds(), 0) / 3600 * PUMP_FLOW_M3_H, 2)
        if pump["on"]:
            pump["on_since"] = now.isoformat()
    if state.get("mode") == "auto":
        want = _in_schedule(state, now)
        if want != pump["on"]:
            pump.update({"on": want, "on_since": now.isoformat() if want else None, "auto_off_at": None})
    return state


# --------------------------------------------------------------------------- view


def view(state: dict, plan: dict) -> dict:
    """Control state merged with the current farm plan (routes, pipes, coverage, live flow)."""
    feats = plan["fields"]["features"]
    disabled = set(state["disabled_routes"])
    routes = []
    for f in feats:
        p = f["properties"]
        routes.append({
            "route_id": f"rt_{p['field_id']}", "sub_zone_id": p["field_id"], "label": p.get("name") or p["field_id"],
            "crop": p.get("crop"), "stress_class": p["stress_class"], "needs_water": p["needs_water"],
            "recommended": p["needs_water"], "enabled": p["field_id"] not in disabled,
            "reachable": p["reachable"], "need_m3_day": p["need_m3_day"],
        })
    need = [r for r in routes if r["needs_water"]]
    served = [r for r in need if r["enabled"] and r["reachable"]]
    pump_on = bool(state["pump"]["on"])
    total_need = sum(r["need_m3_day"] for r in served) or 1.0
    flow = PUMP_FLOW_M3_H if pump_on and served else 0.0
    for r in routes:
        r["flow_m3_h"] = round(flow * r["need_m3_day"] / total_need, 2) if (pump_on and r in served) else 0.0
    closed = set(state["closed_valves"])
    valves = [{"valve_id": e["properties"]["edge_id"], "open": e["properties"]["edge_id"] not in closed,
               "flow_share": e["properties"]["flow"], "serves": e["properties"].get("serves", []),
               "length_m": e["properties"]["length_m"]} for e in plan["routes"]["features"]]
    warnings = []
    for r in need:
        if r["enabled"] and not r["reachable"]:
            warnings.append({"code": "unserved", "message": f"{r['label']} n'est plus atteinte par l'eau (conduite fermée ?)", "sub_zone_id": r["sub_zone_id"]})
        if not r["enabled"] and r["stress_class"] == 3:
            warnings.append({"code": "red_off", "message": f"{r['label']} est en rouge mais son arrosage est coupé", "sub_zone_id": r["sub_zone_id"]})
    hours_to_need = sum(r["need_m3_day"] for r in served) / PUMP_FLOW_M3_H if served else 0.0
    return {
        "farm_id": state["farm_id"],
        "mode": state["mode"],
        "pump": {**state["pump"], "rated_power_kw": PUMP_KW, "flow_m3_h": PUMP_FLOW_M3_H, "power_now_kw": PUMP_KW if pump_on else 0.0},
        "schedule": state["schedule"],
        "routes": routes,
        "valves": valves,
        "coverage": {"sub_zones_needing_water": len(need), "sub_zones_reached": len(served),
                     "coverage_pct": round(100 * len(served) / len(need)) if need else 100},
        "live": {"flow_m3_h": flow, "delivered_m3_today": state["delivered_m3_today"],
                 "need_m3_today": sum(r["need_m3_day"] for r in served),
                 "pumping_hours_needed": round(hours_to_need, 1)},
        "hardware": adapter_for(state).status(state["farm_id"]) | {"adapter": (state.get("hardware") or {}).get("adapter", "virtual")},
        "warnings": warnings,
        "network": {"sources": plan["sources"], "edges": plan["routes"], "boundary": plan.get("boundary"),
                    "fields": plan["fields"], "bbox": plan["bbox"]},
        "updated_at": state["updated_at"],
    }


def touch(state: dict, user: dict | None) -> None:
    state["updated_at"] = _now().isoformat()
    state["updated_by"] = user["user_id"] if user else None


def set_pump(state: dict, plan: dict, on: bool, auto_off_minutes: int | None, user: dict) -> None:
    if on:
        served = [f for f in plan["fields"]["features"] if f["properties"]["needs_water"] and f["properties"]["reachable"]
                  and f["properties"]["field_id"] not in set(state["disabled_routes"])]
        if not served:
            raise HTTPException(409, "Aucun chemin ouvert n'amène l'eau à une sous-zone qui en a besoin")
    now = _now()
    state["mode"] = "manual" if state["mode"] == "auto" else state["mode"]
    state["pump"] = {"on": on, "on_since": now.isoformat() if on else None,
                     "auto_off_at": (now + timedelta(minutes=auto_off_minutes)).isoformat() if on and auto_off_minutes else None}
    adapter_for(state).set_pump(state["farm_id"], on)
    touch(state, user)
    log(state["farm_id"], user["user_id"], "pump_on" if on else "pump_off", {"auto_off_minutes": auto_off_minutes})
