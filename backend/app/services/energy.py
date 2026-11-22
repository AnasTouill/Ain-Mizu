"""
Energy scheduler (M4, ARCHITECTURE.md sections 3 and 13.7).

One representative solar pumping station per zone: a pump, a PV array and a storage
tank. A small linear program (scipy ``linprog`` / HiGHS, 120 variables, solved in a
few milliseconds) decides, hour by hour:

* ``P[h]`` pump power (kW), split into ``S[h]`` solar and ``G[h]`` grid power;
* ``R[h]`` irrigation release from the tank (m3), preferably in the cool hours;
* ``T[h]`` tank level (m3).

Objective: minimise grid energy (plus small penalties that prefer pumping at peak sun
and irrigating in the cool hours). The tank stores daytime solar pumping for the
evening / early-morning irrigation - it acts as a battery - and must end the day at
least as full as it started.
"""
from __future__ import annotations

import dataclasses
import datetime as dt
import math
import threading
import zlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np
from scipy.optimize import linprog

from ..errors import BadRequest, NotFound
from .util import days_in_month

if TYPE_CHECKING:  # pragma: no cover
    from .data_provider import DataProvider
    from .network_service import NetworkService

HOURS = 24


@dataclass(frozen=True)
class StationParams:
    pump_kw: float = 15.0
    kwh_per_m3: float = 0.357  # specific pumping energy -> 42 m3/h at 15 kW
    pv_kwp: float = 24.0
    pv_performance_ratio: float = 0.8
    tank_capacity_m3: float = 500.0
    tank_initial_frac: float = 0.35
    station_share_of_demand: float = 0.08  # share of the zone's modeled need delivered by this station
    irrigation_hours: tuple[int, ...] = (5, 6, 7, 18, 19, 20, 21)

    @classmethod
    def from_config(cls, cfg: dict) -> "StationParams":
        values = dict(cfg.get("energy") or {})
        kwargs = {}
        for f in dataclasses.fields(cls):
            if values.get(f.name) is None:
                continue
            kwargs[f.name] = (
                tuple(int(h) for h in values[f.name]) if f.name == "irrigation_hours" else float(values[f.name])
            )
        return cls(**kwargs)

    @property
    def pump_m3_per_h(self) -> float:
        return self.pump_kw / self.kwh_per_m3


# =========================================================================== inputs


def cloud_factor(zone: str, date: str) -> float:
    """Deterministic day-to-day cloudiness (seeded by zone + date, never by Python's hash)."""
    rng = np.random.default_rng(zlib.crc32(f"{zone}|{date}".encode("utf-8")))
    month = int(date[5:7])
    if month in (11, 12, 1, 2, 3) and rng.random() < 0.18:
        return float(rng.uniform(0.35, 0.7))
    return float(np.clip(rng.normal(0.97, 0.05), 0.75, 1.05))


def solar_profile_kw(date: str, lat: float, lon: float, ghi_kwh_m2_day: float, station: StationParams) -> np.ndarray:
    """Hourly PV output (kW). Bell-shaped between sunrise and sunset (day length from the
    solar declination), integrating to the daily irradiation. Clock time is CET (UTC+1,
    Tunisia has no daylight saving), so solar noon is ~12:25 and the peak falls at 12-13 h."""
    doy = dt.date.fromisoformat(date).timetuple().tm_yday
    decl = math.radians(23.44) * math.sin(2 * math.pi * (284 + doy) / 365.0)
    cos_ws = -math.tan(math.radians(lat)) * math.tan(decl)
    daylength = 2 * math.degrees(math.acos(max(-1.0, min(1.0, cos_ws)))) / 15.0
    solar_noon = 12.0 + (15.0 - lon) / 15.0
    sunrise = solar_noon - daylength / 2
    t = np.arange(HOURS) + 0.5
    x = (t - sunrise) / daylength
    shape = np.where((x > 0) & (x < 1), np.sin(np.pi * np.clip(x, 0.0, 1.0)) ** 1.3, 0.0)
    if shape.sum() <= 0 or ghi_kwh_m2_day <= 0:
        return np.zeros(HOURS)
    irradiance = shape / shape.sum() * ghi_kwh_m2_day  # kWh/m2 in each hour == mean kW/m2
    return station.pv_kwp * station.pv_performance_ratio * irradiance


def daily_water_need_m3(total_demand_ha_eq: float, et0_mm_month: float, days: int, station: StationParams) -> float:
    """Station's daily volume: demand (ha-eq) x ET0 (mm/day) x 10 m3 per mm.ha x station share,
    capped at 90 % of the pump's 24 h capacity."""
    et0_day = et0_mm_month / max(days, 1)
    need = total_demand_ha_eq * et0_day * 10.0 * station.station_share_of_demand
    return float(min(max(need, 0.0), 0.9 * station.pump_m3_per_h * HOURS))


# =========================================================================== LP


def _fallback_schedule(solar_kw: np.ndarray, need_m3: float, station: StationParams):
    """Rule-based schedule used only if the LP fails: solar first, then grid at night."""
    e = station.kwh_per_m3
    P = np.minimum(solar_kw, station.pump_kw)
    pumped = P.sum() / e
    if pumped > need_m3:
        P *= need_m3 / pumped
    else:
        deficit = need_m3 - pumped
        for h in list(range(0, 6)) + list(range(22, 24)) + list(range(6, 22)):
            if deficit <= 0:
                break
            add = min(station.pump_kw - P[h], deficit * e)
            P[h] += add
            deficit -= add / e
    S = np.minimum(P, solar_kw)
    G = P - S
    irr = list(station.irrigation_hours) or list(range(HOURS))
    R = np.zeros(HOURS)
    R[irr] = need_m3 / len(irr)
    T = np.clip(station.tank_capacity_m3 * station.tank_initial_frac + np.cumsum(P / e - R), 0, station.tank_capacity_m3)
    return P, S, G, T


def schedule_day(zone: str, date: str, solar_kw: np.ndarray, need_m3: float, station: StationParams) -> dict:
    """Solve the hourly pumping LP and return the energy_{zone}_{date}.json document."""
    H, e = HOURS, station.kwh_per_m3
    cap = station.tank_capacity_m3
    T0 = cap * station.tank_initial_frac
    nP, nS, nG, nT, nR = 0, H, 2 * H, 3 * H, 4 * H
    N = 5 * H
    peak = float(solar_kw.max()) if solar_kw.max() > 0 else 1.0

    c = np.zeros(N)
    c[nG : nG + H] = 1.0  # grid kWh (what we minimise)
    c[nP : nP + H] = 1e-3 * (1.0 - solar_kw / peak) + 1e-4  # prefer pumping at peak sun
    cool = set(station.irrigation_hours)
    for h in range(H):
        if h not in cool:
            c[nR + h] = 0.5  # irrigating in the heat wastes water to evaporation

    A_eq, b_eq = [], []
    for h in range(H):  # pump power = solar + grid
        row = np.zeros(N)
        row[nP + h], row[nS + h], row[nG + h] = 1.0, -1.0, -1.0
        A_eq.append(row)
        b_eq.append(0.0)
    for h in range(H):  # tank balance: T[h] = T[h-1] + P[h]/e - R[h]
        row = np.zeros(N)
        row[nT + h], row[nP + h], row[nR + h] = 1.0, -1.0 / e, 1.0
        if h > 0:
            row[nT + h - 1] = -1.0
            b_eq.append(0.0)
        else:
            b_eq.append(T0)
        A_eq.append(row)
    row = np.zeros(N)
    row[nR : nR + H] = 1.0  # deliver the day's need
    A_eq.append(row)
    b_eq.append(need_m3)

    A_ub = np.zeros((1, N))
    A_ub[0, nT + H - 1] = -1.0  # end the day at least as full as it started
    b_ub = [-T0]
    r_max = max(need_m3 * 0.25, 1.0)  # spread irrigation over >= 4 hours
    bounds = (
        [(0.0, station.pump_kw)] * H
        + [(0.0, float(s)) for s in solar_kw]
        + [(0.0, station.pump_kw)] * H
        + [(0.0, cap)] * H
        + [(0.0, r_max)] * H
    )
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, A_eq=np.array(A_eq), b_eq=b_eq, bounds=bounds, method="highs")
    if res.status == 0 and res.x is not None:
        x = np.maximum(res.x, 0.0)
        P, S, G, T = x[nP : nP + H], x[nS : nS + H], x[nG : nG + H], x[nT : nT + H]
    else:  # pragma: no cover - only for infeasible custom configs
        P, S, G, T = _fallback_schedule(solar_kw, need_m3, station)

    hours = [
        {
            "hour": h,
            "solar_kw": round(float(solar_kw[h]), 2),
            "pump_on": bool(P[h] > 0.05),
            "pump_kw": round(float(P[h]), 2),
            "tank_level_m3": round(float(T[h]), 1),
        }
        for h in range(H)
    ]
    e_pump, e_solar, e_grid = float(P.sum()), float(S.sum()), float(G.sum())
    share = 100.0 * e_solar / e_pump if e_pump > 1e-6 else 100.0
    return {
        "zone": zone,
        "date": date,
        "tank_capacity_m3": cap,
        "hours": hours,
        "summary": {
            "solar_share_pct": round(share, 1),
            "grid_kwh": round(e_grid, 1),
            "total_pumped_m3": round(e_pump / e, 1),
        },
    }


def build_energy_day(
    zone: str,
    date: str,
    *,
    lat: float,
    lon: float,
    ghi_kwh_m2_day: float,
    et0_mm_month: float,
    total_demand_ha_eq: float,
    station: StationParams,
) -> dict:
    solar = solar_profile_kw(date, lat, lon, ghi_kwh_m2_day * cloud_factor(zone, date), station)
    need = daily_water_need_m3(total_demand_ha_eq, et0_mm_month, days_in_month(date[:7]), station)
    return schedule_day(zone, date, solar, need, station)


# =========================================================================== service


class EnergyService:
    """Serves energy_{zone}_{date}.json; computes the schedule on the fly for dates
    without a stored file (the same LP the mock generator uses)."""

    def __init__(self, provider: "DataProvider", network: "NetworkService"):
        self.provider = provider
        self.network = network
        self._cache: dict[tuple[str, str], dict] = {}
        self._lock = threading.Lock()

    def station(self) -> StationParams:
        return StationParams.from_config(self.provider.config())

    def day(self, zone: str, date: str) -> dict:
        try:
            dt.date.fromisoformat(date)
        except ValueError as exc:
            raise BadRequest(f"Invalid date '{date}' (expected a real calendar date YYYY-MM-DD)") from exc
        stored = self.provider.energy(zone, date)
        if stored is not None:
            return stored
        key = (zone, date)
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        month = date[:7]
        weather = self.provider.weather_monthly()
        row = weather[(weather["zone"] == zone) & (weather["month"] == month)]
        if row.empty:
            raise NotFound(f"No weather data for zone '{zone}' in {month}: energy schedules cover the observed and forecast months")
        r = row.iloc[0]
        lon, lat = self.provider.zone_center(zone)
        day = build_energy_day(
            zone,
            date,
            lat=lat,
            lon=lon,
            ghi_kwh_m2_day=float(r["solar_kwh_m2_day"]),
            et0_mm_month=float(r["et0_mm"]),
            total_demand_ha_eq=self.network.total_demand_ha_eq(zone, month),
            station=self.station(),
        )
        with self._lock:
            self._cache[key] = day
        return day
