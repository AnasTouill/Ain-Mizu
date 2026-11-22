"""Physical controller link (ESP32, also the Wokwi simulation in ../wokwi).

The board polls ``POST /api/hardware/board/report`` every 2 s with its sensors and gets back the
pump / valve orders chosen on the website for the farm it is linked to. Channel n of the board =
the n-th sub-zone (route) of that farm. No login: the board has no account (demo only).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from ..deps import Provider
from ..services import auth, control, onboarding

router = APIRouter(prefix="/api", tags=["hardware"])


_reach_cache: dict[tuple, dict] = {}


def _reachable(provider, farm: dict, st: dict) -> dict[str, bool]:
    """Which sub-zones water can reach with the current closed pipes (cached per control change)."""
    from ..services.farm_local import farm_plan_local

    key = (farm["farm_id"], tuple(st["closed_valves"]), tuple(st["disabled_routes"]), farm.get("updated_at") or farm.get("created_at"))
    if key not in _reach_cache:
        plan = farm_plan_local(provider, farm, provider.config()["months"]["last_observed"], "current")
        out = {}
        for f in plan["fields"]["features"]:
            p = f["properties"]
            out[p["field_id"]] = bool(p["reachable"]) if p["needs_water"] else p["field_id"] not in set(plan.get("fields_unserved") or [])
        _reach_cache.clear()
        _reach_cache[key] = out
    return _reach_cache[key]


class BoardReport(BaseModel):
    moisture: list[int] = Field(default_factory=list, max_length=8, description="moisture % of channels 1..n")
    tank: int | None = Field(None, ge=0, le=100, description="tank level %")


def _auto_link() -> dict:
    """No farm linked yet: link the farm whose control panel was used most recently (demo-friendly)."""
    from ..config import DATA_DIR

    farms = {f["farm_id"] for f in onboarding.load_farms()}
    files = sorted((p for p in DATA_DIR.glob("control_farm_*.json") if p.stem.replace("control_", "") in farms),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return {}
    farm_id = files[0].stem.replace("control_", "")
    st = control.load(farm_id)
    st["hardware"] = {"adapter": "esp32", "connected": False}
    control.save(st)
    control.log(farm_id, None, "board_link", {"auto": True})
    b = {"farm_id": farm_id}
    control.save_binding(b)
    return b


@router.post("/hardware/board/report", summary="ESP32 board: send sensors, receive pump and valve orders")
def board_report(body: BoardReport, provider: Provider) -> dict:
    b = control.board_binding()
    farm_id = b.get("farm_id")
    farm = next((f for f in onboarding.load_farms() if f["farm_id"] == farm_id), None)
    if farm is None:
        b = _auto_link()
        farm_id = b.get("farm_id")
        farm = next((f for f in onboarding.load_farms() if f["farm_id"] == farm_id), None)
    if farm is None:
        raise HTTPException(409, "No farm is linked to the board: open the control panel and click 'Link the ESP32 board'")
    st = control.tick(control.load(farm_id))
    control.save(st)
    first_seen = not b.get("last_seen")
    b.update({"moisture": [max(0, min(100, int(v))) for v in body.moisture], "tank": body.tank,
              "last_seen": control._now().isoformat()})
    control.save_binding(b)
    if first_seen:
        control.log(farm_id, None, "board_online", {"tank": body.tank})
    subs = [s["sub_zone_id"] for s in farm["sub_zones"]][: control.BOARD_VALVES]
    reach = _reachable(provider, farm, st)
    # board valve n is open when sub-zone n's path is switched on AND water can still reach it
    # (closing a pipe on the site map that cuts a sub-zone off closes its valve on the board)
    valves = [sid not in set(st["disabled_routes"]) and reach.get(sid, True) for sid in subs]
    valves += [False] * (control.BOARD_VALVES - len(subs))
    return {"farmer_id": farm_id, "pump": bool(st["pump"]["on"]), "valves": valves,
            "channels": subs, "mode": st["mode"]}


@router.put("/farms/{farm_id}/control/board", summary="Link (or unlink) the ESP32 board to this farm")
def link_board(farm_id: str, body: dict, provider: Provider, user: auth.CurrentUser) -> dict:
    onboarding.get_farm(farm_id, user)
    st = control.load(farm_id)
    if body.get("linked", True):
        prev = control.board_binding()
        control.save_binding({"farm_id": farm_id} if prev.get("farm_id") != farm_id else prev)
        st["hardware"] = {"adapter": "esp32", "connected": False}
    else:
        if control.board_binding().get("farm_id") == farm_id:
            control.save_binding({})
        st["hardware"] = {"adapter": "virtual", "connected": True}
    control.touch(st, user)
    control.save(st)
    control.log(farm_id, user["user_id"], "board_link" if body.get("linked", True) else "board_unlink")
    return {"linked": body.get("linked", True), "hardware": control.adapter_for(st).status(farm_id)}


@router.get("/hardware/wokwi/{name}", summary="Wokwi project files; sketch.ino comes with PLATFORM_URL set to this server")
def wokwi_file(name: str, request: Request) -> PlainTextResponse:
    import re

    from ..config import REPO_DIR

    if name not in {"sketch.ino", "diagram.json", "libraries.txt"}:
        raise HTTPException(404, "Unknown file")
    text = (REPO_DIR / "hardware" / "wokwi" / name).read_text(encoding="utf-8")
    if name == "sketch.ino":
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        base = f"{proto}://{request.headers.get('host', request.url.netloc)}"
        text = re.sub(r'const char \*PLATFORM_URL = "[^"]*";', f'const char *PLATFORM_URL = "{base}";', text, count=1)
    return PlainTextResponse(text)
