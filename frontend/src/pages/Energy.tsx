import { motion } from 'framer-motion';
import { CHART, CHART_TIP } from '../lib/colors';
import { BatteryCharging, CalendarDays, ChevronLeft, ChevronRight, Droplets, Pause, Play, PlugZap, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useEnergy } from '../api/hooks';
import { AnimatedNumber, Panel, Ring, Skeleton, TiltCard } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { addMonths, formatDate, lastDayOfMonth, shiftDate } from '../lib/months';
import { useZoneContext } from '../lib/useZoneContext';
import { useAppStore } from '../store/useAppStore';

/** Pseudo-3D glass tank whose water level follows the selected hour. */
function TankGauge({ level, capacity, label }: { level: number; capacity: number; label: string }) {
  const lang = useLang();
  const frac = capacity > 0 ? Math.max(0, Math.min(1, level / capacity)) : 0;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-44 w-28" style={{ perspective: 600 }}>
        <div className="absolute inset-0 overflow-hidden rounded-[50%/14%] border border-white/20 bg-gradient-to-r from-white/5 via-white/10 to-white/5 shadow-inner">
          <motion.div
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-water-600 via-water-500 to-water-300/90"
            animate={{ height: `${frac * 100}%` }}
            transition={{ type: 'spring', stiffness: 80, damping: 18 }}
          >
            <div className="absolute -top-2 inset-x-0 h-4 rounded-[50%] bg-water-200/70 blur-[1px]" />
          </motion.div>
          <div className="absolute inset-y-0 start-3 w-2 rounded-full bg-white/20 blur-[2px]" />
        </div>
        <div className="absolute -top-2 inset-x-0 h-5 rounded-[50%] border border-white/25 bg-ink-800/80" />
      </div>
      <div className="text-center">
        <div className="font-display text-xl font-bold text-white">{fmtNumber(level, lang, 0)} m³</div>
        <div className="text-[11px] text-slate-400">
          {label} · {fmtNumber(frac * 100, lang, 0)} % / {fmtNumber(capacity, lang, 0)} m³
        </div>
      </div>
    </div>
  );
}

function SunArc({ hour, solarFrac }: { hour: number; solarFrac: number }) {
  const angle = Math.PI * Math.max(0, Math.min(1, (hour + 0.5 - 6) / 13));
  const x = 70 - Math.cos(angle) * 60;
  const y = 70 - Math.sin(angle) * 55;
  const up = hour >= 6 && hour <= 19;
  return (
    <svg viewBox="0 0 140 80" className="h-20 w-36" aria-hidden>
      <path d="M10 70 A60 55 0 0 1 130 70" fill="none" stroke="rgba(148,163,184,0.3)" strokeDasharray="3 4" />
      <line x1="4" y1="70" x2="136" y2="70" stroke="rgba(148,163,184,0.3)" />
      {up && (
        <>
          <motion.circle initial={false} animate={{ cx: x, cy: y }} transition={{ type: 'spring', stiffness: 90, damping: 16 }} r={7 + solarFrac * 5} fill={CHART.forecast} opacity={0.25 + solarFrac * 0.4} />
          <motion.circle initial={false} animate={{ cx: x, cy: y }} transition={{ type: 'spring', stiffness: 90, damping: 16 }} r={6} fill={CHART.sun} />
        </>
      )}
    </svg>
  );
}

export default function Energy() {
  const t = useT();
  const lang = useLang();
  const { config, zone, zoneCfg, effMonth, lastObserved } = useZoneContext();
  const energyDate = useAppStore((s) => s.energyDate);
  const setEnergyDate = useAppStore((s) => s.setEnergyDate);
  const date = energyDate && energyDate.slice(0, 7) === effMonth ? energyDate : `${effMonth}-15`;
  const minDate = `${config.months.first_observed}-01`;
  const maxDate = lastDayOfMonth(addMonths(lastObserved, config.months.forecast_horizon));
  const energy = useEnergy(zone, date);
  const [hour, setHour] = useState(12);
  const [playing, setPlaying] = useState(false);
  const irrigation = new Set(config.energy?.irrigation_hours ?? []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setHour((h) => (h + 1) % 24), 450);
    return () => window.clearInterval(id);
  }, [playing]);

  const day = energy.data;
  const peak = day ? Math.max(...day.hours.map((h) => h.solar_kw), 1) : 1;
  const cur = day?.hours[hour];
  const rows = day?.hours.map((h) => ({ ...h, grid: Math.max(0, h.pump_kw - h.solar_kw) })) ?? [];
  const irrigationRuns: [number, number][] = [];
  for (const h of [...irrigation].sort((a, b) => a - b)) {
    const last = irrigationRuns[irrigationRuns.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else irrigationRuns.push([h, h]);
  }
  const setDate = (d: string) => {
    if (d < minDate || d > maxDate) return;
    setEnergyDate(d);
    if (d.slice(0, 7) !== effMonth) {
      useAppStore.getState().setHorizon(0);
      if (d.slice(0, 7) <= lastObserved) useAppStore.getState().setMonth(d.slice(0, 7));
      else useAppStore.getState().setHorizon(Math.min(3, Math.max(1, (Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7))) - (Number(lastObserved.slice(0, 4)) * 12 + Number(lastObserved.slice(5, 7))))) as 1 | 2 | 3);
    }
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3">
      <div className="glass flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
            <Sun className="text-slime-400" /> {t('energy.title')} · {zoneCfg.name}
          </h1>
          <p className="text-sm text-slate-400">{t('energy.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost px-2" onClick={() => setDate(shiftDate(date, -1))} aria-label={t('energy.prevDay')}>
            <ChevronLeft size={16} className="rtl:rotate-180" />
          </button>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-ink-800 px-2 py-1.5">
            <CalendarDays size={16} className="text-water-300" />
            <span className="sr-only">{t('energy.date')}</span>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="bg-transparent text-sm text-slate-100 [color-scheme:dark] focus:outline-none"
            />
          </label>
          <button className="btn-ghost px-2" onClick={() => setDate(shiftDate(date, 1))} aria-label={t('energy.nextDay')}>
            <ChevronRight size={16} className="rtl:rotate-180" />
          </button>
          <button className="btn-ghost text-xs" onClick={() => setDate(`${date.slice(0, 7)}-15`)}>
            {t('energy.mid')}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Sun, label: t('energy.solarShare'), value: day?.summary.solar_share_pct, digits: 0, suffix: ' %', color: CHART.forecast, ring: true },
          { icon: PlugZap, label: t('energy.grid'), value: day?.summary.grid_kwh, digits: 1, suffix: ' kWh', color: CHART.terracotta },
          { icon: Droplets, label: t('energy.pumped'), value: day?.summary.total_pumped_m3, digits: 0, suffix: ' m³', color: CHART.water },
        ].map((c) => (
          <TiltCard key={c.label}>
            <div className="glass flex items-center gap-3 p-4">
              {c.ring ? (
                <div className="relative">
                  <Ring value={c.value ?? 0} color={c.color} />
                  <c.icon size={18} className="absolute inset-0 m-auto" style={{ color: c.color }} />
                </div>
              ) : (
                <div className="grid h-16 w-16 place-items-center rounded-2xl" style={{ background: `${c.color}1f` }}>
                  <c.icon size={26} style={{ color: c.color }} />
                </div>
              )}
              <div>
                <div className="label">{c.label}</div>
                <div className="font-display text-3xl font-bold text-white">
                  {day ? <AnimatedNumber value={c.value} lang={lang} digits={c.digits} suffix={c.suffix} /> : '–'}
                </div>
              </div>
            </div>
          </TiltCard>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Panel
          title={formatDate(date, lang)}
          icon={<BatteryCharging size={14} />}
          actions={
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause size={14} /> : <Play size={14} />} {t('energy.playDay')}
            </button>
          }
        >
          {!day ? (
            <Skeleton className="h-[340px]" />
          ) : (
            <>
              <div dir="ltr" className="h-[340px]">
                <ResponsiveContainer>
                  <ComposedChart data={rows} margin={{ top: 10, right: 6, bottom: 0, left: -10 }} barCategoryGap="18%" onClick={(s) => s && typeof s.activeLabel !== 'undefined' && setHour(Number(s.activeLabel))}>
                    <defs>
                      <linearGradient id="solarFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART.forecast} stopOpacity={0.55} />
                        <stop offset="100%" stopColor={CHART.forecast} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickFormatter={(h: number) => `${h}h`} />
                    <YAxis yAxisId="kw" tick={{ fontSize: 11 }} unit=" kW" width={58} />
                    <YAxis yAxisId="m3" orientation="right" tick={{ fontSize: 11 }} unit=" m³" width={58} domain={[0, day.tank_capacity_m3]} />
                    {irrigationRuns.map(([a, b]) => (
                      <ReferenceArea key={a} yAxisId="kw" x1={a} x2={b} fill={CHART.rain} fillOpacity={0.12} strokeOpacity={0} />
                    ))}
                    <Area yAxisId="kw" type="monotone" dataKey="solar_kw" name={t('energy.solarKw')} stroke={CHART.forecast} strokeWidth={2} fill="url(#solarFill)" />
                    <Bar yAxisId="kw" dataKey="pump_kw" name={t('energy.pumpKw')} radius={[4, 4, 0, 0]}>
                      {rows.map((r) => (
                        <Cell key={r.hour} fill={r.grid > 0.05 ? CHART.terracotta : CHART.water} fillOpacity={r.hour === hour ? 1 : 0.75} />
                      ))}
                    </Bar>
                    <Line yAxisId="m3" type="monotone" dataKey="tank_level_m3" name={t('energy.tankLevel')} stroke={CHART.ink} strokeWidth={2} dot={false} />
                    <ReferenceLine yAxisId="kw" x={hour} stroke={CHART.sun} strokeDasharray="4 3" />
                    <Tooltip
                      contentStyle={CHART_TIP}
                      labelFormatter={(h: number) => `${t('energy.hour')} ${h}:00`}
                      formatter={(v: number, name: string) => (name === 'band' ? [null, null] as unknown as [string, string] : [fmtNumber(v, lang, 1), name])}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-slime-400/70" />{t('energy.solarKw')}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-water-400" />{t('energy.pumpKw')}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-red-400" />{t('energy.gridDraw')}</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-slate-200" />{t('energy.tankLevel')}</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-violet-400/30" />{t('energy.irrigationHours')}</span>
              </div>
              <input
                type="range"
                className="pg-range mt-3"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                style={{ ['--fill' as string]: `${(hour / 23) * 100}%` }}
                aria-label={t('energy.hour')}
              />
            </>
          )}
          <p className="mt-2 text-[11px] text-slate-500">{t('energy.computedNote')} {t('notice.modeled')}</p>
        </Panel>
        <div className="glass flex flex-col items-center gap-4 p-4">
          <div className="label">
            {t('energy.hour')} {hour}:00
          </div>
          <SunArc hour={hour} solarFrac={cur ? cur.solar_kw / peak : 0} />
          <div className="grid w-full grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-xl bg-white/5 p-2">
              <div className="text-slate-400">{t('energy.solarKw')}</div>
              <div className="text-lg font-bold text-slime-300">{cur ? fmtNumber(cur.solar_kw, lang, 1) : '–'}</div>
            </div>
            <div className="rounded-xl bg-white/5 p-2">
              <div className="text-slate-400">{t('energy.pumpKw')}</div>
              <div className={`text-lg font-bold ${cur?.pump_on ? 'text-water-300' : 'text-slate-500'}`}>{cur ? fmtNumber(cur.pump_kw, lang, 1) : '–'}</div>
            </div>
          </div>
          {day && cur && <TankGauge level={cur.tank_level_m3} capacity={day.tank_capacity_m3} label={t('energy.tank')} />}
        </div>
      </div>
    </div>
  );
}
