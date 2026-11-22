"""
Physarum-Grid water routing solver (ARCHITECTURE.md section 16).

Model (Tero, Nakagaki et al., "Rules for Biologically Inspired Adaptive Network
Design", Science 2010):

* every candidate canal / pipe is a tube with conductivity ``D_ij`` and effective
  length ``L_ij``;
* node pressures ``p`` solve Kirchhoff's law
  ``sum_j D_ij / L_ij * (p_i - p_j) = b_i`` with ``b_i = +inflow`` at sources,
  ``-demand_i`` at fields and ``0`` at junctions;
* flow on each tube ``Q_ij = D_ij / L_ij * (p_i - p_j)``;
* adaptation ``D_ij <- D_ij + dt * (|Q_ij|^gamma / (1 + |Q_ij|^gamma) - D_ij)``.

Tubes that carry flow thicken and idle tubes decay, so the network converges to
short routes that keep backup loops where the flow is large.

Units
-----
* ``demand_i = area_ha_i * w(class_i)`` is expressed in *hectare-equivalents*
  (ha-eq): one hectare that needs a full (red) dose. Physarum runs on these
  absolute units, which keeps the saturation term ``|Q|^g / (1 + |Q|^g)``
  meaningful: trunks carrying many ha-eq saturate (D -> 1) and keep backup loops,
  small laterals compete and thin out.
* The ``flow`` values written to ``network_{zone}_{month}.json`` are normalised by
  the total injected inflow ``I0``: ``flow = 0.42`` means 42 % of all the water
  passes through that canal. The sign is positive in the edge's ``from -> to``
  direction (graph_edges file).
* ``demands`` in the network file are the per-field demand *weights* ``w`` in
  [0, 1] (class weight or a user override). The solver injects ``area_ha * w``.
"""
from __future__ import annotations

import time
from collections import Counter
from dataclasses import asdict, dataclass
from dataclasses import fields as dc_fields
from typing import Any, Iterable, Mapping

import networkx as nx
import numpy as np
from scipy import sparse
from scipy.sparse.csgraph import connected_components
from scipy.sparse.linalg import spsolve

D_FLOOR = 1e-9  # numerical floor on conductivities (keeps the Laplacian non-singular)


# =========================================================================== parameters


@dataclass(frozen=True)
class PhysarumParams:
    gamma: float = 1.4
    dt: float = 0.1
    max_iterations: int = 200
    tolerance: float = 1e-4
    prune_threshold: float = 0.01
    initial_conductivity: float = 1.0
    # Tero et al.'s total flux I0 used inside the adaptation term: flows enter
    # |Q|^g / (1 + |Q|^g) as  Q * flux_scale / sum(demand). 0 = raw ha-eq units.
    # Small values (<= 4) collapse to the shortest-path tree, raw units keep almost the
    # whole mesh; 12 gives lean networks that keep backup loops on the busy trunks.
    flux_scale: float = 12.0

    @classmethod
    def from_dict(cls, values: Mapping[str, Any] | None, base: "PhysarumParams | None" = None) -> "PhysarumParams":
        merged = asdict(base or cls())
        for f in dc_fields(cls):
            if values and values.get(f.name) is not None:
                merged[f.name] = int(values[f.name]) if f.name == "max_iterations" else float(values[f.name])
        return cls(**merged)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class EdgeCostParams:
    slope_penalty_a: float = 5.0
    default_loss_rate: float = 0.08
    existing_canal_factor: float = 0.6

    @classmethod
    def from_dict(cls, values: Mapping[str, Any] | None) -> "EdgeCostParams":
        merged = asdict(cls())
        for f in dc_fields(cls):
            if values and values.get(f.name) is not None:
                merged[f.name] = float(values[f.name])
        return cls(**merged)


def effective_length(
    length_m: float, uphill_slope: float, loss_rate: float, is_existing_canal: bool, cost: EdgeCostParams
) -> float:
    """``L_ij = length_m * (1 + a * uphill_slope) * (1 + loss_rate)``, times
    ``existing_canal_factor`` for existing canals (cheaper to reuse)."""
    length = max(float(length_m), 1.0)
    value = length * (1.0 + cost.slope_penalty_a * max(float(uphill_slope), 0.0)) * (1.0 + float(loss_rate))
    if is_existing_canal:
        value *= cost.existing_canal_factor
    return value


# =========================================================================== graph preparation


@dataclass
class PreparedGraph:
    node_ids: list[str]
    node_index: dict[str, int]
    node_type: np.ndarray  # str per node: source | field | junction
    area_ha: np.ndarray
    capacity: np.ndarray  # source capacity (m3/day), 0 elsewhere
    irrigated: np.ndarray  # bool, field nodes on the irrigation network
    edge_ids: list[str]  # every edge, input order
    active: np.ndarray  # bool, edge usable (not blocked, valid endpoints)
    u: np.ndarray  # from-node index (-1 when invalid)
    v: np.ndarray  # to-node index
    length_m: np.ndarray
    loss_rate: np.ndarray  # fractional loss per km of canal
    L: np.ndarray  # effective length
    comp: np.ndarray  # connected-component label per node (active edges)
    n_comp: int
    sources: np.ndarray  # node indices of sources

    @property
    def n(self) -> int:
        return len(self.node_ids)

    @property
    def m(self) -> int:
        return len(self.edge_ids)


def prepare_graph(
    nodes: list[dict],
    edges: list[dict],
    cost: EdgeCostParams,
    blocked: Iterable[str] = (),
    irrigated: Mapping[str, bool] | None = None,
) -> PreparedGraph:
    node_ids = [str(n["node_id"]) for n in nodes]
    index = {nid: i for i, nid in enumerate(node_ids)}
    ntype = np.array([str(n.get("type", "field")) for n in nodes], dtype=object)
    area = np.array([float(n.get("area_ha") or 0.0) for n in nodes])
    cap = np.array(
        [float(n.get("capacity_m3_day") or 0.0) if t == "source" else 0.0 for n, t in zip(nodes, ntype)]
    )
    if irrigated is None:
        irr = ntype == "field"
    else:
        irr = np.array([bool(irrigated.get(nid, False)) for nid in node_ids]) & (ntype == "field")

    blocked_set = set(blocked)
    m = len(edges)
    u = np.full(m, -1, dtype=int)
    v = np.full(m, -1, dtype=int)
    length = np.ones(m)
    loss = np.full(m, cost.default_loss_rate)
    L = np.ones(m)
    active = np.zeros(m, dtype=bool)
    edge_ids: list[str] = []
    for k, e in enumerate(edges):
        edge_ids.append(str(e["edge_id"]))
        length[k] = max(float(e.get("length_m") or 1.0), 1.0)
        if e.get("loss_rate") is not None:
            loss[k] = float(e["loss_rate"])
        L[k] = effective_length(
            length[k], float(e.get("uphill_slope") or 0.0), loss[k], bool(e.get("is_existing_canal")), cost
        ) * float(e.get("cost_mult") or 1.0)  # optional terrain/obstacle multiplier (farm graphs)
        a, b = index.get(str(e.get("from"))), index.get(str(e.get("to")))
        if a is None or b is None or a == b:
            continue
        u[k], v[k] = a, b
        active[k] = not (bool(e.get("blocked")) or edge_ids[-1] in blocked_set)

    n = len(node_ids)
    if n:
        adj = sparse.coo_matrix((np.ones(int(active.sum())), (u[active], v[active])), shape=(n, n))
        n_comp, comp = connected_components(adj, directed=False)
    else:
        n_comp, comp = 0, np.zeros(0, dtype=int)
    return PreparedGraph(
        node_ids=node_ids,
        node_index=index,
        node_type=ntype,
        area_ha=area,
        capacity=cap,
        irrigated=irr,
        edge_ids=edge_ids,
        active=active,
        u=u,
        v=v,
        length_m=length,
        loss_rate=loss,
        L=L,
        comp=comp,
        n_comp=int(n_comp),
        sources=np.flatnonzero(ntype == "source"),
    )


def node_demands(pg: PreparedGraph, demand_weights: Mapping[str, float]) -> np.ndarray:
    """``demand_i = area_ha_i * w_i`` for field nodes (ha-eq)."""
    demand = np.zeros(pg.n)
    for nid, w in demand_weights.items():
        i = pg.node_index.get(nid)
        if i is not None and pg.node_type[i] == "field" and w is not None and float(w) > 0:
            demand[i] = pg.area_ha[i] * float(w)
    return demand


def balance_injections(pg: PreparedGraph, demand: np.ndarray) -> tuple[np.ndarray, np.ndarray, list[int], float]:
    """Build the right-hand side ``b``.

    Per connected component, the sources inject the component's total demand,
    split by capacity (``I0 = sum(demand_i)``). Demanding fields in a component
    without any source cannot be served: their demand is dropped and they are
    reported as unserved.
    """
    b = -demand.copy()
    served = demand.copy()
    unserved: list[int] = []
    for c in range(pg.n_comp):
        members = pg.comp == c
        total = float(demand[members].sum())
        if total <= 0:
            continue
        srcs = [int(s) for s in pg.sources if pg.comp[s] == c]
        if not srcs:
            idx = np.flatnonzero(members & (demand > 0))
            unserved.extend(int(i) for i in idx)
            b[idx] = 0.0
            served[idx] = 0.0
            continue
        caps = pg.capacity[srcs]
        share = caps / caps.sum() if caps.sum() > 0 else np.full(len(srcs), 1.0 / len(srcs))
        b[srcs] += total * share
    return b, served, unserved, float(served.sum())


# =========================================================================== Kirchhoff solver


class _Kirchhoff:
    """Sparse pressure solve on the active edges, one grounded node per component."""

    def __init__(self, pg: PreparedGraph):
        self.ai = np.flatnonzero(pg.active)
        self.u = pg.u[self.ai]
        self.v = pg.v[self.ai]
        self.L = pg.L[self.ai]
        self.n = pg.n
        ground: list[int] = []
        for c in range(pg.n_comp):
            members = np.flatnonzero(pg.comp == c)
            srcs = [int(s) for s in pg.sources if pg.comp[s] == c]
            ground.append(srcs[0] if srcs else int(members[0]))  # p = 0 at the source
        self.free = np.setdiff1d(np.arange(self.n), np.array(ground, dtype=int))
        fi = np.full(self.n, -1, dtype=int)
        fi[self.free] = np.arange(len(self.free))
        self.fu, self.fv = fi[self.u], fi[self.v]
        self.mu, self.mv = self.fu >= 0, self.fv >= 0
        self.both = self.mu & self.mv
        self.nf = len(self.free)
        self._diag_idx = np.arange(self.nf)

    def pressures(self, D: np.ndarray, b: np.ndarray) -> np.ndarray:
        p = np.zeros(self.n)
        if self.nf == 0 or len(self.ai) == 0:
            return p
        g = D / self.L
        diag = np.bincount(self.fu[self.mu], weights=g[self.mu], minlength=self.nf) + np.bincount(
            self.fv[self.mv], weights=g[self.mv], minlength=self.nf
        )
        gb = g[self.both]
        rows = np.concatenate([self._diag_idx, self.fu[self.both], self.fv[self.both]])
        cols = np.concatenate([self._diag_idx, self.fv[self.both], self.fu[self.both]])
        data = np.concatenate([diag, -gb, -gb])
        A = sparse.csc_matrix((data, (rows, cols)), shape=(self.nf, self.nf))
        p[self.free] = np.atleast_1d(spsolve(A, b[self.free]))
        return p


def run_physarum(
    pg: PreparedGraph, b: np.ndarray, params: PhysarumParams, D_init: np.ndarray | None = None
) -> tuple[np.ndarray, np.ndarray, int, bool]:
    """Iterate pressure solve + conductivity update. Returns (D, Q, iterations, converged)
    as arrays over *all* edges (0 for inactive ones)."""
    solver = _Kirchhoff(pg)
    ai = solver.ai
    D = np.full(len(ai), float(params.initial_conductivity))
    if D_init is not None:  # warm start: keep previous conductivities where known
        prev = np.asarray(D_init, dtype=float)[ai]
        D = np.where(np.isfinite(prev), prev, D)
    D = np.maximum(D, D_FLOOR)
    inflow = float(b[b > 0].sum())
    scale = params.flux_scale / inflow if params.flux_scale > 0 and inflow > 0 else 1.0

    iterations, converged = 0, False
    for iterations in range(1, int(params.max_iterations) + 1):
        p = solver.pressures(D, b)
        Q = D / solver.L * (p[solver.u] - p[solver.v])
        aq = np.abs(Q * scale) ** params.gamma
        D_new = np.maximum(D + params.dt * (aq / (1.0 + aq) - D), D_FLOOR)
        delta = float(np.max(np.abs(D_new - D))) if len(D) else 0.0
        D = D_new
        if delta < params.tolerance:
            converged = True
            break

    p = solver.pressures(D, b)
    Q = D / solver.L * (p[solver.u] - p[solver.v])
    D_all, Q_all = np.zeros(pg.m), np.zeros(pg.m)
    D_all[ai], Q_all[ai] = D, Q
    return D_all, Q_all, iterations, converged


# =========================================================================== connectivity helpers


def _reachable(pg: PreparedGraph, mask: np.ndarray) -> np.ndarray:
    """Nodes connected to any source through the edges selected by ``mask``."""
    reach = np.zeros(pg.n, dtype=bool)
    if pg.n == 0:
        return reach
    sel = mask & pg.active
    if not sel.any():
        reach[pg.sources] = True
        return reach
    adj = sparse.coo_matrix((np.ones(int(sel.sum())), (pg.u[sel], pg.v[sel])), shape=(pg.n, pg.n))
    _, labels = connected_components(adj, directed=False)
    src_labels = np.unique(labels[pg.sources]) if len(pg.sources) else np.array([], dtype=int)
    return np.isin(labels, src_labels)


def _simple_graph(pg: PreparedGraph, weights: np.ndarray) -> nx.Graph:
    """Undirected graph over active edges; parallel edges collapse to the lightest one."""
    G = nx.Graph()
    for k in np.flatnonzero(pg.active):
        a, b, w = int(pg.u[k]), int(pg.v[k]), float(weights[k])
        if G.has_edge(a, b) and G[a][b]["w"] <= w:
            continue
        G.add_edge(a, b, w=w, k=int(k))
    return G


def prune_network(pg: PreparedGraph, D: np.ndarray, demand: np.ndarray, params: PhysarumParams) -> np.ndarray:
    """Keep edges with ``D >= prune_threshold``, then make sure every demanding field is
    still connected to a source: for each disconnected one, restore the strongest pruned
    edges along its minimum-resistance path (resistance = L / D)."""
    kept = pg.active & (D >= params.prune_threshold)
    targets = np.flatnonzero(demand > 0)
    if len(targets) == 0:
        return kept
    reach = _reachable(pg, kept)
    missing = [int(t) for t in targets if not reach[t]]
    if not missing:
        return kept

    G = _simple_graph(pg, pg.L / np.maximum(D, D_FLOOR))
    for _ in range(len(targets) + 5):
        if not missing:
            break
        reached = {int(i) for i in np.flatnonzero(reach)} & set(G.nodes)
        if not reached:
            break
        dist, paths = nx.multi_source_dijkstra(G, reached, weight="w")
        candidates = [t for t in missing if t in dist]
        if not candidates:
            break
        best = min(candidates, key=lambda t: dist[t])
        path = paths[best]
        for a, b in zip(path[:-1], path[1:]):
            kept[G[a][b]["k"]] = True
        reach = _reachable(pg, kept)
        missing = [int(t) for t in targets if not reach[t]]
    return kept


def resilience_score(pg: PreparedGraph, kept: np.ndarray, demand: np.ndarray) -> float:
    """Remove each kept edge one at a time and average the share of (currently served)
    demanding fields that stay connected to a source. Only bridges can disconnect
    anything, so non-bridge edges score 1 without a search."""
    targets = demand > 0
    base_reach = _reachable(pg, kept)
    base = int((targets & base_reach).sum())
    kept_idx = np.flatnonzero(kept & pg.active)
    if base == 0 or len(kept_idx) == 0:
        return 1.0
    pairs = [(min(int(pg.u[k]), int(pg.v[k])), max(int(pg.u[k]), int(pg.v[k]))) for k in kept_idx]
    multiplicity = Counter(pairs)
    G = nx.Graph()
    G.add_edges_from(multiplicity.keys())
    bridges = {(min(a, b), max(a, b)) for a, b in nx.bridges(G)}
    total = 0.0
    for k, pair in zip(kept_idx, pairs):
        if pair in bridges and multiplicity[pair] == 1:
            mask = kept.copy()
            mask[k] = False
            total += float((targets & _reachable(pg, mask)).sum()) / base
        else:
            total += 1.0
    return total / len(kept_idx)


def network_metrics(pg: PreparedGraph, kept: np.ndarray, flow_norm: np.ndarray, demand: np.ndarray) -> dict:
    """Metrics on the kept sub-network.

    ``weighted_loss`` normalisation: each kept canal loses ``loss_rate`` (fraction per
    km) of the water it carries, so the water lost on edge e is
    ``|Q_e| * loss_rate_e * length_e / 1000``. Summing over kept edges and dividing by
    the total demand delivered (I0) gives the *fraction of the delivered water lost in
    conveyance*. With flows already normalised by I0 this is simply
    ``sum(|flow_e| * loss_rate_e * length_km_e)``.
    """
    reach = _reachable(pg, kept)
    return {
        "total_length_m": int(round(float(pg.length_m[kept].sum()))),
        "weighted_loss": round(
            float(np.sum(np.abs(flow_norm[kept]) * pg.loss_rate[kept] * pg.length_m[kept] / 1000.0)), 4
        ),
        "fields_served": int(((demand > 0) & reach).sum()),
        "resilience_score": round(resilience_score(pg, kept, demand), 3),
    }


# =========================================================================== baselines


def shortest_path_tree(pg: PreparedGraph) -> tuple[nx.Graph, dict[int, list[int]]]:
    """Dijkstra (by effective length) from the nearest source to every reachable node."""
    G = _simple_graph(pg, pg.L)
    srcs = {int(s) for s in pg.sources if int(s) in G}
    if not srcs:
        return G, {}
    _, paths = nx.multi_source_dijkstra(G, srcs, weight="w")
    return G, paths


def _route(pg: PreparedGraph, G: nx.Graph, paths: Mapping[int, list[int]], amounts: Mapping[int, float]):
    """Send ``amounts[node]`` from its nearest source along its shortest path; flows superpose."""
    F = np.zeros(pg.m)
    total = 0.0
    for i, amount in amounts.items():
        if amount <= 0 or i not in paths:
            continue
        total += amount
        path = paths[i]
        for a, b in zip(path[:-1], path[1:]):
            k = G[a][b]["k"]
            F[k] += amount if pg.u[k] == a else -amount
    return F, total


def shortest_path_baseline(pg: PreparedGraph, demand: np.ndarray, G: nx.Graph, paths) -> dict:
    """Union of Dijkstra paths from the source to each demanding field."""
    amounts = {int(i): float(demand[i]) for i in np.flatnonzero(demand > 0)}
    F, total = _route(pg, G, paths, amounts)
    kept = np.abs(F) > 0
    Fn = F / total if total > 0 else F
    return {
        "total_length_m": int(round(float(pg.length_m[kept].sum()))),
        "weighted_loss": round(float(np.sum(np.abs(Fn[kept]) * pg.loss_rate[kept] * pg.length_m[kept] / 1000.0)), 4),
        "resilience_score": round(resilience_score(pg, kept, demand), 3),
    }


def equal_split_baseline(pg: PreparedGraph, demand: np.ndarray, G: nx.Graph, paths) -> dict:
    """Every irrigated field receives the same depth regardless of its class.

    The depth is chosen so that the fields that need water receive, in total, the same
    water as in the targeted plan (``depth = need / area_demanding``); green fields get
    the same depth too. Water is routed along shortest paths; ``weighted_loss`` is the
    conveyance-loss fraction of that plan (same normalisation as ``network_metrics``).
    """
    targets = demand > 0
    need = float(demand.sum())
    area_dem = float(pg.area_ha[targets].sum())
    if need <= 0 or area_dem <= 0:
        return {"weighted_loss": 0.0}
    depth = need / area_dem
    amounts = {int(i): float(pg.area_ha[i] * depth) for i in np.flatnonzero(pg.irrigated | targets)}
    F, total = _route(pg, G, paths, amounts)
    if total <= 0:
        return {"weighted_loss": 0.0}
    kept = np.abs(F) > 0
    return {
        "weighted_loss": round(
            float(np.sum(np.abs(F[kept]) / total * pg.loss_rate[kept] * pg.length_m[kept] / 1000.0)), 4
        )
    }


# =========================================================================== water saved


def water_saved_pct_vs_equal_split(
    need_ha_eq: float,
    area_demanding_ha: float,
    area_irrigated_ha: float,
    loss_targeted: float,
    loss_equal: float,
) -> float:
    """Modeled water saving of the class-targeted plan versus an equal split, *for the
    same demand satisfied* (ARCHITECTURE.md sections 8 and 16). Volumes in ha-eq.

    * Targeted plan: delivers exactly the need ``N`` to the fields that need water.
      Gross water at the sources: ``G_t = N / (1 - loss_targeted)``.
    * Equal split: every irrigated field receives the same depth ``d`` per hectare.
      To bring the same water ``N`` to the fields that need it, ``d = N / A_demanding``,
      so it delivers ``d * A_irrigated`` in total and needs
      ``G_e = d * A_irrigated / (1 - loss_equal)`` at the sources.
    * ``saved = 1 - G_t / G_e``, returned in percent (1 decimal).

    ``loss_*`` are the conveyance-loss fractions (``weighted_loss``) of each plan.
    Returns 0.0 when nothing needs water (no saving to claim). The result is MODELED,
    not measured irrigation.
    """
    if need_ha_eq <= 0 or area_demanding_ha <= 0:
        return 0.0
    area_irrigated_ha = max(float(area_irrigated_ha), float(area_demanding_ha))
    lt = min(max(float(loss_targeted), 0.0), 0.95)
    le = min(max(float(loss_equal), 0.0), 0.95)
    gross_targeted = need_ha_eq / (1.0 - lt)
    depth = need_ha_eq / area_demanding_ha
    gross_equal = depth * area_irrigated_ha / (1.0 - le)
    return round(100.0 * max(0.0, 1.0 - gross_targeted / gross_equal), 1)


def water_saved_from_network(
    network: Mapping[str, Any], area_ha: Mapping[str, float], irrigated: Mapping[str, bool]
) -> float:
    """Same metric, derived only from schema fields (network file + fields GeoJSON), so it
    also works for network files produced by the real pipeline."""
    demands = network.get("demands") or {}
    need = sum(float(area_ha.get(f, 0.0)) * float(w) for f, w in demands.items() if w and float(w) > 0)
    area_dem = sum(float(area_ha.get(f, 0.0)) for f, w in demands.items() if w and float(w) > 0)
    area_irr = sum(float(a) for f, a in area_ha.items() if irrigated.get(f))
    loss_t = float((network.get("metrics") or {}).get("weighted_loss") or 0.0)
    loss_e = float(((network.get("baselines") or {}).get("equal_split") or {}).get("weighted_loss") or 0.0)
    return water_saved_pct_vs_equal_split(need, area_dem, area_irr, loss_t, loss_e)


# =========================================================================== orchestration


def compute_network(
    *,
    zone: str,
    month: str,
    nodes: list[dict],
    edges: list[dict],
    demand_weights: Mapping[str, float],
    params: PhysarumParams,
    cost: EdgeCostParams,
    blocked: Iterable[str] = (),
    conductivity_init: Mapping[str, float] | None = None,
    irrigated: Mapping[str, bool] | None = None,
) -> dict:
    """Run Physarum + pruning + baselines + metrics.

    Returns ``{"network": <network_{zone}_{month}.json schema>, "conductivity": {edge_id: D},
    "fields_unserved": [...], "iterations_used": int, "converged": bool, "compute_ms": float}``.
    Pass ``conductivity_init`` (previous D values) for a warm start.
    """
    t0 = time.perf_counter()
    pg = prepare_graph(nodes, edges, cost, blocked, irrigated)
    demand = node_demands(pg, demand_weights)
    b, served, unserved_idx, I0 = balance_injections(pg, demand)

    D_init = None
    if conductivity_init:
        D_init = np.array([conductivity_init.get(eid, np.nan) for eid in pg.edge_ids], dtype=float)
    D, Q, iterations, converged = run_physarum(pg, b, params, D_init)
    flow_norm = Q / I0 if I0 > 0 else np.zeros_like(Q)

    kept = prune_network(pg, D, served, params)
    metrics = network_metrics(pg, kept, flow_norm, served)
    G_sp, sp_paths = shortest_path_tree(pg)
    baselines = {
        "shortest_path": shortest_path_baseline(pg, served, G_sp, sp_paths),
        "equal_split": equal_split_baseline(pg, served, G_sp, sp_paths),
    }

    demands_out = {
        nid: round(float(demand_weights.get(nid, 0.0) or 0.0), 4)
        for i, nid in enumerate(pg.node_ids)
        if pg.node_type[i] == "field"
    }
    edges_out = []
    for k, eid in enumerate(pg.edge_ids):
        if not pg.active[k]:
            edges_out.append({"edge_id": eid, "flow": 0.0, "conductivity": 0.0, "kept": False})
        else:
            edges_out.append(
                {
                    "edge_id": eid,
                    "flow": round(float(flow_norm[k]), 4),
                    "conductivity": round(float(D[k]), 4),
                    "kept": bool(kept[k]),
                }
            )
    network = {
        "zone": zone,
        "month": month,
        "params": {
            "gamma": params.gamma,
            "dt": params.dt,
            "iterations": int(iterations),
            "prune_threshold": params.prune_threshold,
        },
        "demands": demands_out,
        "edges": edges_out,
        "metrics": metrics,
        "baselines": baselines,
    }
    return {
        "network": network,
        "conductivity": {eid: float(D[k]) for k, eid in enumerate(pg.edge_ids) if pg.active[k]},
        "fields_unserved": [pg.node_ids[i] for i in unserved_idx],
        "iterations_used": int(iterations),
        "converged": bool(converged),
        "compute_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }
