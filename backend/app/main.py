"""Physarum-Grid API (FastAPI). Run: uvicorn app.main:app --reload --port 8000 (from backend/)."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from .config import CORS_ORIGINS
from .errors import BadRequest, DataMissing, NotFound
from .routers import actuation, auth, energy, farmers, farms, fields, hardware, kpis, meta, model, network, predictions, zones

DESCRIPTION = """
Decision support for farmers in Kairouan, Sidi Bouzid and Kebili: **see** (Sentinel-2) ->
**predict** (forecaster) -> **classify** (green / yellow / orange / red) -> **route** (Physarum)
-> **power** (solar scheduling) -> **act** (virtual valves and pump).

All data is read through a `DataProvider` from `data/`. While `config.json` says
`"data_source": "synthetic"` the data is mock output: forecasts are a *business-as-usual*
outlook (they do not include the effect of irrigation) and water results are *modeled*.
"""

app = FastAPI(title="Physarum-Grid API", version="1.0.0", description=DESCRIPTION)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": message})


@app.exception_handler(NotFound)
async def _not_found(_: Request, exc: NotFound) -> JSONResponse:
    return _error(404, str(exc))


@app.exception_handler(BadRequest)
async def _bad_request(_: Request, exc: BadRequest) -> JSONResponse:
    return _error(400, str(exc))


@app.exception_handler(DataMissing)
async def _data_missing(_: Request, exc: DataMissing) -> JSONResponse:
    return _error(503, str(exc))


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    parts = []
    for err in exc.errors():
        loc = [str(p) for p in err.get("loc", ()) if p not in ("query", "body", "path")]
        parts.append(f"{'.'.join(loc) or 'request'}: {err.get('msg', 'invalid value')}")
    return _error(422, "; ".join(parts) or "Invalid request")


for module in (meta, auth, farms, hardware, zones, farmers, fields, predictions, network, energy, kpis, actuation, model):
    app.include_router(module.router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/docs")

# The ESP32 sketch sometimes gets PLATFORM_URL pasted with a trailing "/docs": accept that path too.
app.add_api_route("/docs/api/hardware/board/report", hardware.board_report, methods=["POST"], include_in_schema=False)
