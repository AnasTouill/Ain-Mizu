"""API contract tests (ARCHITECTURE.md section 14). Needs the generated data in data/."""
import time

import pytest
from fastapi.testclient import TestClient

from app.config import DATA_DIR
from app.main import app

pytestmark = pytest.mark.skipif(
    not (DATA_DIR / "predictions.parquet").exists(), reason="run backend/scripts/generate_mock_data.py first"
)

FIELD_PROPS = {"field_id", "area_ha", "is_irrigated", "stress_class", "stress_score", "demand_score",
               "ndmi_pred", "ndmi_obs", "status_type", "horizon"}
EDGE_PROPS = {"edge_id", "flow", "conductivity", "kept", "blocked", "length_m"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health_and_config(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    cfg = client.get("/api/config").json()
    assert cfg["class_colors"] == ["#2e9e4f", "#f2c230", "#f08a24", "#d62f2f"]
    assert cfg["data_source"] == "synthetic"


def test_zones(client):
    zones = client.get("/api/zones").json()
    assert [z["id"] for z in zones] == ["kairouan", "sidi_bouzid", "kebili"]
    for z in zones:
        assert 80 <= z["field_count"] <= 120
        assert z["first_month"] == "2018-01" and z["last_month"] == "2026-10"
        assert z["forecast_months"] == ["2026-11", "2026-12", "2027-01"]
        assert len(z["bbox"]) == 4


def test_fields_current_and_forecast(client):
    fc = client.get("/api/fields", params={"zone": "kebili", "month": "2026-08"}).json()
    assert fc["type"] == "FeatureCollection" and len(fc["features"]) > 0
    assert set(fc["features"][0]["properties"]) == FIELD_PROPS
    forecast = client.get("/api/fields", params={"zone": "kebili", "month": "2026-11", "status_type": "forecast"}).json()
    props = forecast["features"][0]["properties"]
    assert props["status_type"] == "forecast" and props["horizon"] == 1 and props["ndmi_obs"] is None


def test_errors_use_detail_strings(client):
    r = client.get("/api/fields", params={"zone": "tunis", "month": "2026-08"})
    assert r.status_code == 404 and isinstance(r.json()["detail"], str)
    r = client.get("/api/fields", params={"zone": "kebili", "month": "2026-8"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    r = client.get("/api/fields", params={"zone": "kebili", "month": "2020-05", "status_type": "forecast"})
    assert r.status_code == 404


def test_timeseries_and_predictions(client):
    fid = client.get("/api/fields", params={"zone": "kairouan", "month": "2026-10"}).json()["features"][0]["properties"]["field_id"]
    ts = client.get(f"/api/fields/{fid}/timeseries").json()
    assert ts["field_id"] == fid and len(ts["points"]) == 109
    assert sum(p["status_type"] == "forecast" for p in ts["points"]) == 3
    window = client.get(f"/api/fields/{fid}/timeseries", params={"from": "2025-01", "to": "2025-12"}).json()
    assert len(window["points"]) == 12
    rows = client.get("/api/predictions", params={"zone": "kairouan", "month": "2026-10", "stress_class": 2}).json()
    assert all(r["stress_class"] == 2 for r in rows)
    assert client.get("/api/fields/nope_0001/timeseries").status_code == 404


def test_network_compare_kpis(client):
    net = client.get("/api/network", params={"zone": "kebili", "month": "2026-08"}).json()
    assert {"zone", "month", "sources", "edges", "metrics"} <= set(net)
    assert set(net["edges"]["features"][0]["properties"]) == EDGE_PROPS
    assert net["metrics"]["fields_served"] > 0
    cmp_ = client.get("/api/compare", params={"zone": "kebili", "month": "2026-08"}).json()
    assert set(cmp_) == {"physarum", "shortest_path", "equal_split", "water_saved_pct_vs_equal_split"}
    kpis = client.get("/api/kpis", params={"zone": "kebili", "month": "2026-08"}).json()
    assert set(kpis["fields_by_class"]) == {"green", "yellow", "orange", "red"}
    assert kpis["water_saved_pct_vs_equal_split"] == cmp_["water_saved_pct_vs_equal_split"]


def test_block_edge_reroutes_fast_and_unblock_restores(client):
    params = {"zone": "sidi_bouzid", "month": "2026-09"}
    before = client.get("/api/network", params=params).json()
    busiest = max((f["properties"] for f in before["edges"]["features"] if f["properties"]["kept"]),
                  key=lambda p: p["flow"])
    t0 = time.perf_counter()
    r = client.post("/api/network/block-edge", json={**params, "edge_id": busiest["edge_id"], "blocked": True})
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.text
    body = r.json()
    assert elapsed < 2.0
    assert body["rerouted"] is True and body["iterations_used"] > 0
    blocked = next(f["properties"] for f in body["edges"]["features"] if f["properties"]["edge_id"] == busiest["edge_id"])
    assert blocked["blocked"] and not blocked["kept"]
    # the live scenario is visible to GET /api/network and the actuation valves
    live = client.get("/api/network", params=params).json()
    assert live["metrics"] == body["metrics"]
    valves = client.get("/api/actuation", params=params).json()["valves"]
    assert next(v for v in valves if v["edge_id"] == busiest["edge_id"])["open"] is False
    # unblocking restores the stored baseline plan exactly
    back = client.post("/api/network/block-edge", json={**params, "edge_id": busiest["edge_id"], "blocked": False}).json()
    assert back["metrics"] == before["metrics"]
    assert client.post("/api/network/block-edge", json={**params, "edge_id": "e_9999"}).status_code == 404


def test_recompute_and_reset(client):
    params = {"zone": "kairouan", "month": "2025-06"}
    base = client.get("/api/network", params=params).json()
    r = client.post("/api/network/recompute", json={**params, "params": {"gamma": 1.8, "prune_threshold": 0.05}})
    assert r.status_code == 200 and r.json()["iterations_used"] > 0
    reset = client.post("/api/network/recompute", json={**params, "reset": True}).json()
    assert reset["metrics"] == base["metrics"]
    bad = client.post("/api/network/recompute", json={**params, "params": {"gamma": -1}})
    assert bad.status_code == 422


def test_farmer_view_and_route_toggle(client):
    farms = client.get("/api/farmers").json()
    assert len(farms) > 20 and all(f["field_count"] >= 1 for f in farms)
    # a Kebili farm with a parcel that needs water in the last observed month
    farm = next(f for f in farms if f["zone"] == "kebili" and f["fields_need_water"] > 0)
    url = f"/api/farmers/{farm['farmer_id']}/plan"
    plan = client.get(url, params={"month": "2026-10"}).json()
    props = [f["properties"] for f in plan["fields"]["features"]]
    assert len(props) == farm["field_count"]
    target = next(p for p in props if p["needs_water"] and p["reachable"])
    assert any(target["field_id"] in r["properties"]["serves"] for r in plan["routes"]["features"])
    assert plan["summary"]["total_need_m3_day"] > 0
    # switch the route off -> no canal serves it any more and the volume drops
    off = client.post(f"/api/farmers/{farm['farmer_id']}/routes",
                      json={"month": "2026-10", "field_id": target["field_id"], "active": False}).json()
    p_off = next(f["properties"] for f in off["fields"]["features"] if f["properties"]["field_id"] == target["field_id"])
    assert p_off["route_active"] is False
    assert not any(target["field_id"] in r["properties"]["serves"] for r in off["routes"]["features"])
    assert off["summary"]["total_need_m3_day"] < plan["summary"]["total_need_m3_day"]
    back = client.post(f"/api/farmers/{farm['farmer_id']}/routes",
                       json={"month": "2026-10", "field_id": target["field_id"], "active": True}).json()
    assert back["summary"] == plan["summary"]
    assert client.get("/api/farmers/nope/plan", params={"month": "2026-10"}).status_code == 404


def test_energy_and_actuation(client):
    stored = client.get("/api/energy", params={"zone": "kebili", "date": "2026-08-15"}).json()
    assert len(stored["hours"]) == 24 and set(stored["summary"]) == {"solar_share_pct", "grid_kwh", "total_pumped_m3"}
    computed = client.get("/api/energy", params={"zone": "kebili", "date": "2026-08-03"}).json()
    assert computed["date"] == "2026-08-03" and len(computed["hours"]) == 24
    assert client.get("/api/energy", params={"zone": "kebili", "date": "2026-02-30"}).status_code == 400
    assert client.get("/api/energy", params={"zone": "kebili", "date": "2030-01-01"}).status_code == 404
    act = client.get("/api/actuation", params={"zone": "kebili", "month": "2026-08", "hour": 12}).json()
    assert set(act["pump"]) == {"on", "power_kw", "flow_m3_h"}
    assert all(set(v) == {"edge_id", "open", "opening_pct"} for v in act["valves"])
