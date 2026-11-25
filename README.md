# Ain-mizu: web platform

Decision-support platform (Kizuna @ ESPRIT) for Kairouan, Sidi Bouzid and Kebili. It has a FastAPI backend and a React 18 + TypeScript + Leaflet frontend with 3D views (react-three-fiber). It runs on **synthetic mock data** that follows ARCHITECTURE.md section 13. Real pipeline output can replace the files in `data/` (same names, same schemas) with no code change.

> While `data/config.json` says `"data_source": "synthetic"`, the UI shows a synthetic-data banner. Forecasts are a business-as-usual outlook (they do not include the effect of irrigation). Water and energy results are modeled, not measured.

## Run (Windows PowerShell, from the repository root)

**1. Backend**

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts\generate_mock_data.py
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

- The third command generates the mock data: about 1,000 files in `data/`, in about 25 s.
- The last command starts the API. Docs are at http://localhost:8000/docs.

On macOS or Linux, use `python3 -m venv .venv` and `.venv/bin/python` instead.

**2. Frontend** (second terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to `http://127.0.0.1:8000`.

**Tests:** run `.\.venv\Scripts\python.exe -m pytest` in `backend/` (17 tests: solver, energy LP, every endpoint).

**Docker (optional):** `docker compose up --build`. It generates the data on first start. It is untested here because Docker isn't installed on this machine.

## Screens

| Screen | What it does |
|---|---|
| Dashboard | Leaflet map with fields coloured green, yellow, orange or red, plus colour-blind patterns and icons. The Physarum network is drawn as glowing tubes (width = conductivity) with dashes flowing downstream, growing out from the source. Water sources pulse. Month slider 2018-01 to 2026-10 with Play, a Now / +1 / +2 / +3 toggle, layer toggles, legend and an animated KPI strip with 3D tilt cards. Clicking a field opens a drawer with the NDMI observed vs predicted chart, normal range, monthly class bands and the forecast marker. A 2D/3D switch shows extruded fields (height = stress score), tubes and flowing particles. |
| Network Lab | Click a canal to block or unblock it. Physarum warm-starts and reroutes in about 0.1–0.2 s, and any cut-off fields are reported. Bar charts compare Physarum, shortest path and equal split. γ, prune threshold and flux scale sliders call `/recompute`. |
| Energy | Date picker. Hourly chart of solar PV, pump power (red where it draws from the grid), tank level and cool irrigation hours. Summary cards, an animated sun arc and a 3D tank gauge. "Play the day" steps through the hours. |
| Actuation | 3D pump station: PV array, sun following the hour, spinning impeller, tank level, and valve wheels with water flowing through open branches. Pump card, valve list and a virtual MQTT command log. Everything follows the live network, so a canal blocked in the Lab closes its valve here. |
| About | Live agent-based Physarum simulation linking the three zones on a canvas tilted in 3D, the pipeline steps, where the AI is, data sources and honest limitations. |

French is the default language, with English and Arabic (RTL) available. The layout is responsive, with loading skeletons, error toasts and an error boundary.

## Project structure

```
data/                     config.json (kept) + generated files (§13)
backend/app/              main.py, config.py, schemas.py (Pydantic v2), deps.py, errors.py
backend/app/routers/      meta, zones, fields, predictions, network, energy, kpis, actuation (thin)
backend/app/services/     data_provider (the only data access), physarum, energy (LP), kpis, network_service,
                          scenario_store, fields, zones, actuation, util
backend/scripts/          generate_mock_data.py (seeded, deterministic, uses the real physarum/energy/kpis services)
backend/tests/            test_physarum.py, test_api.py
frontend/src/api/         typed client + TanStack Query hooks
frontend/src/types/       TypeScript mirror of §13 / §14
frontend/src/store/       Zustand (zone, month, horizon, layers, language...) + toasts
frontend/src/i18n/        fr (default), en, ar (RTL)
frontend/src/components/  layout, ui (tilt cards, counters, gauges, toasts, skeletons), map (Leaflet layers),
                          three (Zone3D, PumpStation3D), PhysarumHero, Legend, KpiStrip, FieldDrawer, NdmiChart, Controls
frontend/src/pages/       Dashboard, NetworkLab, Energy, Actuation, About
```

## Swapping in real pipeline output

1. Write the pipeline files into `data/` with the same names and schemas: `fields_{zone}.geojson`, `field_monthly.parquet`, `weather_monthly.parquet`, `predictions.parquet`, `graph_nodes_{zone}.json`, `graph_edges_{zone}.json`.
2. `network_*`, `energy_*` and `kpis_*` files are optional. When one is missing, the backend computes it live with the same services.
3. Set `"data_source"` in `config.json` to anything other than `"synthetic"`. That hides the banner, and the generator then refuses to overwrite the folder unless you pass `--force`.

Files are cached and reloaded automatically when they change on disk.

## Choices made where the spec was ambiguous

- **Forecast months:** forecasts exist only for the 3 months after the last observation. "+1/+2/+3" means the last observed month + h, and the slider is locked while a forecast is shown.
- **Network demands:** the network file's `demands` hold class weights w in [0, 1]. The solver injects `area_ha × w` (hectare-equivalents). `flow` is the share of the total inflow, signed relative to the edge's from→to direction. The API orients line geometries downstream.
- **Added `physarum.flux_scale` (default 12):** this is Tero et al.'s I0, used inside the adaptation term.
  - Raw ha-eq units kept about 2.5× the shortest-path length.
  - Values of 4 or less collapse to the shortest-path tree.
  - 12 gives lean networks with backup loops. Mean result: 34 km vs 28 km, resilience 0.97 vs 0.93.
- **Convergence:** with the spec's tolerance of `1e-4`, many runs stop at `max_iterations` (200). The UI reports the real count.
- **Water saved:** compared with an equal per-hectare split that delivers the same water to the fields that need it, including conveyance losses. The formula is documented in `physarum.water_saved_pct_vs_equal_split`, and the result is modeled.
- **Weighted loss:** the fraction of delivered water lost in conveyance, with `loss_rate` read as a fraction per km (documented in `physarum.network_metrics`).
- **Unclassified fields:** non-irrigated fields are not classified (`stress_class` is null, shown grey) and have zero demand.
- **Energy:** one representative solar pumping station per zone (`config.energy`). The schedule is stored for the 15th of each month; other dates are solved on the fly with the same LP. `/api/actuation` takes optional `hour` (default 12) and `date` parameters.
- **What-if state:** block-edge and recompute state lives in memory per (zone, month). It is shared by every screen and resets when the server restarts, so run a single worker. `/recompute` accepts an extra optional `reset: true`. Unblocking the last blocked canal restores the stored baseline plan exactly.
- **Geometry:** local equirectangular projection instead of UTM 32N (under 0.1% error over 10 km). Graph edges are k=5 nearest neighbours that are also Delaunay edges, so canals never cross on the map.
- **Mock class thresholds:** quantiles of a stress score in normal months, giving about 55/25/15/5 %. Red also needs persistence and an NDVI drop. The real pipeline would use k-means.
