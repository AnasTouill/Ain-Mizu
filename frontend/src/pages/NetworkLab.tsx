import { AnimatePresence, motion } from 'framer-motion';
import { CHART, CHART_TIP } from '../lib/colors';
import { Ban, CircleCheck, FlaskConical, Lightbulb, Loader2, RotateCcw, SlidersHorizontal, TriangleAlert, Unlock, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useBlockEdge, useCompare, useFields, useNetwork, useRecompute } from '../api/hooks';
import { Legend } from '../components/Legend';
import { MapView } from '../components/map/MapView';
import { AnimatedNumber, Panel, Skeleton } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { formatMonth } from '../lib/months';
import { useEdgeTooltip, useFieldTooltip, useZoneContext } from '../lib/useZoneContext';
import { useAppStore } from '../store/useAppStore';
import type { EdgeProps } from '../types';

const PLAN_COLORS = { physarum: CHART.water, shortest: CHART.muted, equal: '#f08a24' };

function MiniBars({ title, data, digits, unit }: { title: string; data: { name: string; value: number; color: string }[]; digits: number; unit?: string }) {
  const lang = useLang();
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-300">{title}</div>
      <div dir="ltr" className="h-[110px]">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="name" width={122} tick={{ fontSize: 10.5 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.08)' }}
              contentStyle={CHART_TIP}
              formatter={(v: number) => [`${fmtNumber(v, lang, digits)}${unit ?? ''}`, title]}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16} animationDuration={700}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
              <LabelList dataKey="value" position="right" formatter={(v: number) => `${fmtNumber(v, lang, digits)}${unit ?? ''}`} style={{ fill: CHART.ink, fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, digits = 2 }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; digits?: number }) {
  const lang = useLang();
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-water-200">{fmtNumber(value, lang, digits)}</span>
      </div>
      <input
        type="range"
        className="pg-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
    </label>
  );
}

type Status = { kind: 'ok' | 'warn' | 'info'; text: string; sub?: string; key: number };

export default function NetworkLab() {
  const t = useT();
  const lang = useLang();
  const { config, zone, zoneCfg, zoneInfo, effMonth, status } = useZoneContext();
  const satellite = useAppStore((s) => s.layers.satellite);
  const patterns = useAppStore((s) => s.patterns);
  const network = useNetwork(zone, effMonth);
  const fields = useFields(zone, effMonth, status);
  const compare = useCompare(zone, effMonth);
  const block = useBlockEdge();
  const recompute = useRecompute();
  const fieldTooltip = useFieldTooltip(config.class_colors);
  const edgeTooltip = useEdgeTooltip();
  const defaults = config.physarum;
  const [params, setParams] = useState({ gamma: defaults.gamma, prune_threshold: defaults.prune_threshold, flux_scale: defaults.flux_scale ?? 12 });
  const [last, setLast] = useState<Status | null>(null);
  useEffect(() => setLast(null), [zone, effMonth]);

  const blocked = useMemo(() => network.data?.edges.features.filter((f) => f.properties.blocked).map((f) => f.properties) ?? [], [network.data]);
  const busy = block.isPending || recompute.isPending;

  const onEdgeClick = (p: EdgeProps) => {
    if (busy) return;
    const t0 = performance.now();
    block.mutate(
      { zone, month: effMonth, edge_id: p.edge_id, blocked: !p.blocked },
      {
        onSuccess: (d) => {
          const ms = Math.round(performance.now() - t0);
          if (d.fields_unserved.length) {
            setLast({ kind: 'warn', key: Date.now(), text: t('lab.unserved', { n: d.fields_unserved.length, ids: d.fields_unserved.slice(0, 6).join(', ') }), sub: `${ms} ms` });
          } else if (d.iterations_used === 0) {
            setLast({ kind: 'info', key: Date.now(), text: t('lab.restored'), sub: `${ms} ms` });
          } else if (!d.rerouted) {
            setLast({ kind: 'info', key: Date.now(), text: t('lab.noChange'), sub: `${d.iterations_used} ${t('lab.iterations')} · ${ms} ms` });
          } else {
            setLast({ kind: 'ok', key: Date.now(), text: t('lab.rerouted', { n: d.iterations_used }), sub: `${ms} ms` });
          }
        },
      },
    );
  };

  const runRecompute = (reset = false) => {
    const t0 = performance.now();
    if (reset) setParams({ gamma: defaults.gamma, prune_threshold: defaults.prune_threshold, flux_scale: defaults.flux_scale ?? 12 });
    recompute.mutate(reset ? { zone, month: effMonth, reset: true } : { zone, month: effMonth, params },
      {
        onSuccess: (d) =>
          setLast({ kind: reset ? 'info' : 'ok', key: Date.now(), text: reset ? t('lab.restored') : t('lab.recomputed', { n: d.iterations_used }), sub: `${Math.round(performance.now() - t0)} ms` }),
      },
    );
  };

  const c = compare.data;
  const names = { p: t('lab.physarum'), s: t('lab.shortest'), e: t('lab.equal') };

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:flex-row">
      <section className="glass relative h-[60vh] min-h-[380px] overflow-hidden lg:h-auto lg:flex-1">
        {network.data && fields.data ? (
          <MapView
            zone={zone}
            center={zoneCfg.center}
            bbox={zoneInfo?.bbox}
            layers={{ fields: true, network: true, sources: true, satellite, pruned: true }}
            colors={config.class_colors}
            patterns={patterns}
            fields={fields.data}
            network={network.data}
            dimFields
            fieldTooltip={fieldTooltip}
            sourceLabel={t('legend.source')}
            interactiveNetwork
            onEdgeClick={onEdgeClick}
            edgeTooltip={edgeTooltip}
          />
        ) : (
          <Skeleton className="h-full rounded-none" />
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start gap-2">
          <div className="glass-strong pointer-events-auto max-w-md px-3 py-2">
            <div className="flex items-center gap-2 font-display font-bold text-white">
              <Waypoints size={16} className="text-water-300" />
              {t('nav.network')} · {zoneCfg.name} · <span className="capitalize">{formatMonth(effMonth, lang, 'long')}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{t('lab.subtitle')}</p>
          </div>
          <AnimatePresence>
            {(busy || last) && (
              <motion.div
                key={busy ? 'busy' : last?.key}
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                className={`glass-strong flex items-center gap-2 px-3 py-2 text-sm ${
                  busy ? 'text-water-200' : last?.kind === 'warn' ? 'border-amber-400/40 text-amber-200' : last?.kind === 'ok' ? 'border-emerald-400/40 text-emerald-200' : 'text-slate-200'
                }`}
                role="status"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : last?.kind === 'warn' ? <TriangleAlert size={16} /> : <CircleCheck size={16} />}
                <span>{busy ? t('common.loading') : last?.text}</span>
                {!busy && last?.sub && <span className="font-mono text-xs text-slate-400">{last.sub}</span>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="glass-strong absolute bottom-3 start-3 z-[500] hidden w-64 p-3 md:block">
          <Legend colors={config.class_colors} patterns={patterns} showBlocked compact />
        </div>
      </section>

      <aside className="thin-scroll flex shrink-0 flex-col gap-3 lg:w-[380px] lg:overflow-y-auto">
        <Panel title={t('lab.compare')} icon={<FlaskConical size={14} />}>
          {c ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-water-400/20 bg-water-500/10 px-3 py-2">
                <span className="text-xs text-water-100">{t('lab.waterSaved')}</span>
                <span className="font-display text-2xl font-bold text-white text-glow">
                  <AnimatedNumber value={c.water_saved_pct_vs_equal_split} lang={lang} suffix=" %" />
                </span>
              </div>
              <MiniBars
                title={t('lab.length')}
                digits={1}
                unit=" km"
                data={[
                  { name: names.p, value: c.physarum.total_length_m / 1000, color: PLAN_COLORS.physarum },
                  { name: names.s, value: c.shortest_path.total_length_m / 1000, color: PLAN_COLORS.shortest },
                ]}
              />
              <MiniBars
                title={t('lab.loss')}
                digits={1}
                unit=" %"
                data={[
                  { name: names.p, value: c.physarum.weighted_loss * 100, color: PLAN_COLORS.physarum },
                  { name: names.s, value: c.shortest_path.weighted_loss * 100, color: PLAN_COLORS.shortest },
                  { name: names.e, value: c.equal_split.weighted_loss * 100, color: PLAN_COLORS.equal },
                ]}
              />
              <MiniBars
                title={t('lab.resilience')}
                digits={3}
                data={[
                  { name: names.p, value: c.physarum.resilience_score, color: PLAN_COLORS.physarum },
                  { name: names.s, value: c.shortest_path.resilience_score, color: PLAN_COLORS.shortest },
                ]}
              />
              <p className="text-[11px] text-slate-400">{t('lab.metricsNote')}</p>
            </div>
          ) : (
            <Skeleton className="h-80" />
          )}
        </Panel>

        <Panel title={t('lab.params')} icon={<SlidersHorizontal size={14} />}>
          <div className="space-y-3">
            <Slider label={t('lab.gamma')} value={params.gamma} min={0.6} max={3} step={0.1} digits={1} onChange={(v) => setParams((p) => ({ ...p, gamma: v }))} />
            <Slider label={t('lab.prune')} value={params.prune_threshold} min={0.001} max={0.2} step={0.001} digits={3} onChange={(v) => setParams((p) => ({ ...p, prune_threshold: v }))} />
            <Slider label={t('lab.flux')} value={params.flux_scale} min={1} max={40} step={1} digits={0} onChange={(v) => setParams((p) => ({ ...p, flux_scale: v }))} />
            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={busy} onClick={() => runRecompute(false)}>
                {recompute.isPending ? <Loader2 size={16} className="animate-spin" /> : <Waypoints size={16} />}
                {t('lab.recompute')}
              </button>
              <button className="btn-ghost" disabled={busy} onClick={() => runRecompute(true)}>
                <RotateCcw size={16} />
                {t('lab.reset')}
              </button>
            </div>
          </div>
        </Panel>

        <Panel title={t('lab.blocked')} icon={<Ban size={14} />}>
          {blocked.length === 0 ? (
            <p className="text-sm text-slate-400">{t('lab.noneBlocked')}</p>
          ) : (
            <ul className="space-y-1.5">
              {blocked.map((p) => (
                <li key={p.edge_id} className="flex items-center gap-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-sm">
                  <Ban size={14} className="text-red-300" />
                  <span className="font-mono text-red-100">{p.edge_id}</span>
                  <span className="text-xs text-slate-400">{fmtNumber(p.length_m, lang, 0)} m</span>
                  <button className="btn-ghost ms-auto px-2 py-1 text-xs" disabled={busy} onClick={() => onEdgeClick(p)}>
                    <Unlock size={12} /> {t('lab.unblock')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 flex gap-2 text-[11px] text-slate-400">
            <Lightbulb size={14} className="shrink-0 text-slime-400" />
            {t('lab.hint')}
          </p>
        </Panel>
      </aside>
    </div>
  );
}
