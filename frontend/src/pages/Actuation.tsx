import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, Gauge, Pause, Play, Radio, Waves } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useActuation, useEnergy } from '../api/hooks';
import { Panel, Segmented, Skeleton } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { formatMonth } from '../lib/months';
import { useZoneContext } from '../lib/useZoneContext';
import { useAppStore } from '../store/useAppStore';
import type { Actuation as ActuationState } from '../types';

const PumpStation3D = lazy(() => import('../components/three/PumpStation3D'));

type Filter = 'all' | 'open' | 'closed';
interface LogLine {
  id: number;
  time: string;
  topic: string;
  payload: string;
  open: boolean;
}

// Valve states last seen per zone|month (module level: survives page changes, so a canal blocked
// in the Network Lab shows up as commands here).
const SEEN = new Map<string, Map<string, ActuationState['valves'][number]>>();
const LOG = new Map<string, LogLine[]>();
let nextLogId = 1;

export default function Actuation() {
  const t = useT();
  const lang = useLang();
  const { config, zone, zoneCfg, effMonth } = useZoneContext();
  const hour = useAppStore((s) => s.actuationHour);
  const setHour = useAppStore((s) => s.setActuationHour);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');
  const act = useActuation(zone, effMonth, hour);
  const energy = useEnergy(zone, `${effMonth}-15`);
  const [log, setLog] = useState<LogLine[]>(() => LOG.get(`${zone}|${effMonth}`) ?? []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setHour((useAppStore.getState().actuationHour + 1) % 24), 700);
    return () => window.clearInterval(id);
  }, [playing, setHour]);

  // virtual MQTT: publish a command for every valve whose state changed in the plan
  useEffect(() => {
    if (!act.data) return;
    const key = `${zone}|${effMonth}`;
    const before = SEEN.get(key);
    let lines = LOG.get(key) ?? [];
    if (before) {
      const fresh: LogLine[] = [];
      for (const v of act.data.valves) {
        const b = before.get(v.edge_id);
        if (b && (b.open !== v.open || Math.abs(b.opening_pct - v.opening_pct) >= 5)) {
          fresh.push({
            id: nextLogId++,
            time: new Date().toLocaleTimeString(),
            topic: `physarum/${zone}/valve/${v.edge_id}/set`,
            payload: JSON.stringify({ open: v.open, pct: v.opening_pct }),
            open: v.open,
          });
        }
      }
      if (fresh.length) lines = [...fresh, ...lines].slice(0, 40);
    }
    LOG.set(key, lines);
    SEEN.set(key, new Map(act.data.valves.map((v) => [v.edge_id, v])));
    setLog(lines);
  }, [act.data, zone, effMonth]);

  const valves = useMemo(() => {
    const all = [...(act.data?.valves ?? [])].sort((a, b) => b.opening_pct - a.opening_pct || a.edge_id.localeCompare(b.edge_id));
    return filter === 'all' ? all : all.filter((v) => (filter === 'open' ? v.open : !v.open));
  }, [act.data, filter]);
  const counts = { open: act.data?.valves.filter((v) => v.open).length ?? 0, closed: act.data?.valves.filter((v) => !v.open).length ?? 0 };
  const day = energy.data;
  const cur = day?.hours[hour];
  const peak = day ? Math.max(...day.hours.map((h) => h.solar_kw), 1) : 1;
  const pumpKw = config.energy?.pump_kw ?? 15;
  const irrigating = (config.energy?.irrigation_hours ?? []).includes(hour);
  const mainValves = useMemo(() => {
    const open = (act.data?.valves ?? []).filter((v) => v.open).sort((a, b) => b.opening_pct - a.opening_pct);
    const closed = (act.data?.valves ?? []).filter((v) => !v.open);
    return [...open.slice(0, 6), ...closed.slice(0, 1)];
  }, [act.data]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3">
      <div className="glass flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white">
            <Cpu className="text-water-300" /> {t('act.title')} · {zoneCfg.name} · <span className="capitalize">{formatMonth(effMonth, lang, 'long')}</span>
          </h1>
          <p className="text-sm text-slate-400">{t('act.subtitle')}</p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-80">
          <button className="btn-ghost px-2" onClick={() => setPlaying((p) => !p)} aria-label={t('energy.playDay')}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div className="flex-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>{t('act.hour')}</span>
              <span className="font-mono text-white">{String(hour).padStart(2, '0')}:00</span>
            </div>
            <input type="range" className="pg-range" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ ['--fill' as string]: `${(hour / 23) * 100}%` }} aria-label={t('act.hour')} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="glass relative h-[460px] overflow-hidden">
          <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
            {act.data && (
              <PumpStation3D
                pumpOn={act.data.pump.on}
                powerFrac={act.data.pump.power_kw / pumpKw}
                tankFrac={cur && day ? cur.tank_level_m3 / day.tank_capacity_m3 : 0.35}
                solarFrac={cur ? cur.solar_kw / peak : 0}
                hour={hour}
                irrigating={irrigating || act.data.pump.on}
                valves={mainValves}
                labels={{ pump: t('act.pump'), tank: t('act.tank'), open: t('act.open'), closed: t('act.closed') }}
              />
            )}
          </Suspense>
          <div className="chip pointer-events-none absolute bottom-3 start-3 bg-ink-950/80">{t('act.mainValves')}</div>
        </div>

        <div className="flex flex-col gap-3">
          <Panel title={t('act.pump')} icon={<Gauge size={14} />}>
            {act.data ? (
              <div className="flex items-center gap-4">
                <motion.div
                  animate={act.data.pump.on ? { boxShadow: ['0 0 0px #38bdf8', '0 0 28px #38bdf8', '0 0 0px #38bdf8'] } : { boxShadow: '0 0 0px #000' }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className={`grid h-16 w-16 place-items-center rounded-2xl font-display text-sm font-bold ${act.data.pump.on ? 'bg-water-500 text-ink-950' : 'bg-slate-700 text-slate-300'}`}
                >
                  {act.data.pump.on ? t('act.on') : t('act.off')}
                </motion.div>
                <div className="grid flex-1 grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-white/5 p-2">
                    <div className="text-[11px] text-slate-400">{t('act.power')}</div>
                    <div className="text-lg font-bold text-white">{fmtNumber(act.data.pump.power_kw, lang, 1)} kW</div>
                  </div>
                  <div className="rounded-xl bg-white/5 p-2">
                    <div className="text-[11px] text-slate-400">{t('act.flow')}</div>
                    <div className="text-lg font-bold text-white">{fmtNumber(act.data.pump.flow_m3_h, lang, 0)} m³/h</div>
                  </div>
                </div>
              </div>
            ) : (
              <Skeleton className="h-16" />
            )}
          </Panel>

          <Panel title={`${t('act.valves')} · ${counts.open} / ${counts.open + counts.closed}`} icon={<Waves size={14} />}>
            <Segmented
              size="sm"
              layoutId="valve-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: `${t('act.open')} (${counts.open})` },
                { value: 'closed', label: `${t('act.closed')} (${counts.closed})` },
                { value: 'all', label: t('act.all') },
              ]}
            />
            <ul className="thin-scroll mt-2 max-h-[220px] space-y-1 overflow-y-auto pe-1">
              {valves.slice(0, 120).map((v) => (
                <li key={v.edge_id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-xs hover:bg-white/5">
                  <span className={`h-2 w-2 rounded-full ${v.open ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-red-500'}`} />
                  <span className="w-14 font-mono text-slate-200">{v.edge_id}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                    <motion.div className="h-full rounded-full bg-gradient-to-r from-water-600 to-water-300" animate={{ width: `${v.opening_pct}%` }} transition={{ duration: 0.6 }} />
                  </div>
                  <span className="w-9 text-end font-mono text-slate-300">{v.opening_pct}%</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title={t('act.log')} icon={<Radio size={14} />}>
        {log.length === 0 ? (
          <p className="text-sm text-slate-400">{t('act.logEmpty')}</p>
        ) : (
          <ul className="thin-scroll max-h-48 space-y-1 overflow-y-auto font-mono text-[11px]" dir="ltr">
            <AnimatePresence initial={false}>
              {log.map((l) => (
                <motion.li key={l.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                  <span className="text-slate-500">{l.time}</span>
                  <span className="text-water-300">{l.topic}</span>
                  <span className={l.open ? 'text-emerald-300' : 'text-red-300'}>{l.payload}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </div>
  );
}
