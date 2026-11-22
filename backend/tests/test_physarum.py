"""Unit tests for the Physarum solver and the energy LP (no data files needed)."""
from collections import defaultdict

import numpy as np
import pytest

from app.services import energy, physarum
from app.services.physarum import EdgeCostParams, PhysarumParams


def grid(nx_: int = 4, ny_: int = 4, spacing: float = 100.0):
    """A small grid: source at (0, 0), fields everywhere else, 2 ha each."""
    ids, nodes = {}, []
    for i in range(nx_):
        for j in range(ny_):
            if (i, j) == (0, 0):
                ids[(i, j)] = "src"
                nodes.append({"node_id": "src", "type": "source", "lon": 0.0, "lat": 0.0, "capacity_m3_day": 900})
            else:
                ids[(i, j)] = f"f_{i}_{j}"
                nodes.append({"node_id": ids[(i, j)], "type": "field", "lon": i * 1e-3, "lat": j * 1e-3, "area_ha": 2.0})
    edges, k = [], 0
    for i in range(nx_):
        for j in range(ny_):
            for di, dj in ((1, 0), (0, 1)):
                if (i + di, j + dj) in ids:
                    k += 1
                    edges.append({"edge_id": f"e{k}", "from": ids[(i, j)], "to": ids[(i + di, j + dj)],
                                  "length_m": spacing, "uphill_slope": 0.0, "loss_rate": 0.05,
                                  "is_existing_canal": False, "blocked": False})
    return nodes, edges


def run(nodes, edges, demands, **kwargs):
    params = kwargs.pop("params", PhysarumParams())
    return physarum.compute_network(zone="t", month="2026-01", nodes=nodes, edges=edges,
                                    demand_weights=demands, params=params, cost=EdgeCostParams(), **kwargs)


DEMANDS = {"f_3_3": 1.0, "f_0_3": 0.6, "f_3_0": 0.2}


def net_inflow(edges, network):
    by_id = {e["edge_id"]: e for e in network["edges"]}
    inflow = defaultdict(float)
    for e in edges:
        f = by_id[e["edge_id"]]["flow"]
        inflow[e["to"]] += f
        inflow[e["from"]] -= f
    return inflow


def test_kirchhoff_flow_conservation():
    nodes, edges = grid()
    network = run(nodes, edges, DEMANDS)["network"]
    total = 2.0 * sum(DEMANDS.values())
    inflow = net_inflow(edges, network)
    for fid, w in DEMANDS.items():
        assert inflow[fid] == pytest.approx(2.0 * w / total, abs=1e-3)
    assert inflow["src"] == pytest.approx(-1.0, abs=1e-3)  # all water leaves the source
    assert inflow["f_1_1"] == pytest.approx(0.0, abs=1e-3)  # zero-demand field = junction


def test_prune_keeps_every_demanding_field_connected():
    nodes, edges = grid(6, 6)
    demands = {f"f_{i}_5": 1.0 for i in range(6)} | {"f_5_0": 0.2}
    result = run(nodes, edges, demands, params=PhysarumParams(prune_threshold=0.2))
    metrics = result["network"]["metrics"]
    assert metrics["fields_served"] == len(demands)
    assert result["fields_unserved"] == []
    assert 0.0 <= metrics["resilience_score"] <= 1.0
    assert metrics["total_length_m"] < 60 * 100  # pruned well below the full mesh (60 edges)


def test_block_edge_warm_start_reroutes():
    nodes, edges = grid()
    base = run(nodes, edges, DEMANDS)
    busiest = max((e for e in base["network"]["edges"] if e["kept"]), key=lambda e: abs(e["flow"]))
    warm = run(nodes, edges, DEMANDS, blocked={busiest["edge_id"]}, conductivity_init=base["conductivity"])
    blocked_row = next(e for e in warm["network"]["edges"] if e["edge_id"] == busiest["edge_id"])
    assert not blocked_row["kept"] and blocked_row["flow"] == 0.0
    assert warm["network"]["metrics"]["fields_served"] == len(DEMANDS)
    assert warm["iterations_used"] <= PhysarumParams().max_iterations


def test_isolated_field_is_reported_unserved():
    nodes, edges = grid()
    cut = {e["edge_id"] for e in edges if "f_3_3" in (e["from"], e["to"])}
    result = run(nodes, edges, DEMANDS, blocked=cut)
    assert result["fields_unserved"] == ["f_3_3"]
    assert result["network"]["metrics"]["fields_served"] == 2


def test_no_demand_means_no_network():
    nodes, edges = grid()
    result = run(nodes, edges, {})
    m = result["network"]["metrics"]
    assert m["total_length_m"] == 0 and m["fields_served"] == 0 and m["weighted_loss"] == 0.0


def test_shortest_path_baseline_is_a_tree():
    nodes, edges = grid(5, 5)
    demands = {"f_4_4": 1.0, "f_0_4": 1.0, "f_4_0": 1.0, "f_2_2": 0.6}
    sp = run(nodes, edges, demands)["network"]["baselines"]["shortest_path"]
    assert sp["resilience_score"] < 1.0  # every edge of a tree is a bridge
    assert sp["total_length_m"] > 0


def test_water_saved_formula():
    # need 10 ha-eq on 10 ha, 20 ha irrigated, same losses -> half of an equal split
    assert physarum.water_saved_pct_vs_equal_split(10, 10, 20, 0.1, 0.1) == pytest.approx(50.0)
    # higher conveyance loss for the equal split increases the saving
    assert physarum.water_saved_pct_vs_equal_split(10, 10, 20, 0.1, 0.2) > 50.0
    assert physarum.water_saved_pct_vs_equal_split(0, 0, 20, 0.1, 0.1) == 0.0


def test_energy_schedule_is_consistent():
    station = energy.StationParams()
    day = energy.build_energy_day("kebili", "2026-07-15", lat=33.7, lon=8.97, ghi_kwh_m2_day=8.1,
                                  et0_mm_month=285.0, total_demand_ha_eq=40.0, station=station)
    hours = day["hours"]
    assert len(hours) == 24
    assert all(0 <= h["tank_level_m3"] <= station.tank_capacity_m3 for h in hours)
    assert all(h["pump_kw"] <= station.pump_kw + 1e-6 for h in hours)
    need = energy.daily_water_need_m3(40.0, 285.0, 31, station)
    assert day["summary"]["total_pumped_m3"] == pytest.approx(need, rel=0.02)
    assert 0 <= day["summary"]["solar_share_pct"] <= 100
    peak_hour = int(np.argmax([h["solar_kw"] for h in hours]))
    assert 11 <= peak_hour <= 14
