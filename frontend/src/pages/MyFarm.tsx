import { motion } from 'framer-motion';
import { ArrowLeftRight, Clock, Droplets, Hand, Loader2, MapPin, Satellite, Sprout, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Polygon } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useBlockEdge, useConfig, useFarmEdge, useFarmPlan, useToggleRoute } from '../api/hooks';
import { ll, LockTo, optLabel, OutsideMask } from '../components/onboarding/farmMap';
import { ObstacleLayer } from '../components/onboarding/ObstacleLayer';
import { Mountain } from 'lucide-react';
import { ClassIcon, NA_COLOR } from '../components/ClassIcon';
import { MapView } from '../components/map/MapView';
import { AnimatedNumber, Segmented, Skeleton } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { esc } from '../lib/colors';
import { fmtNumber } from '../lib/format';
import { addMonths, formatMonth } from '../lib/months';
import { toast } from '../store/toasts';
import { useAppStore } from '../store/useAppStore';
import type { AppConfig, EdgeProps, FarmFieldProps, FieldCollection, FieldFeatureProps, NetworkResponse } from '../types';

/** [5,6,7,18,19,20,21] -> "5h–8h · 18h–22h" */
function hourRanges(hours: number[]): string {
  const runs: [number, number][] = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else runs.push([h, h]);
  }
  return runs.map(([a, b]) => `${a}h–${b + 1}h`).join(' · ');
}

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-water-500 shadow-glow' : 'bg-slate-600'}`}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`absolute top-1 h-6 w-6 rounded-full bg-paper shadow ${on ? 'end-1' : 'start-1'}`}
      />
    </button>
  );
}

export default function MyFarm() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data as AppConfig;
  const farmerId = useAppStore((s) => s.farmerId) as string;
  const zone = useAppStore((s) => s.zone);
  const patterns = useAppStore((s) => s.patterns);
  const [when, setWhen] = useState<'now' | 'next'>('now');
  const [satellite, setSatellite] = useState(false);
  const [obstacles, setObstacles] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const last = config.months.last_observed;
  const month = when === 'now' ? last : addMonths(last, 1);
  const status = when === 'now' ? 'current' : 'forecast';
  const plan = useFarmPlan(farmerId, month, status);
  const toggle = useToggleRoute(farmerId, zone);
  const block = useBlockEdge();
  const farmEdge = useFarmEdge(farmerId);
  const opts = useQuery({ queryKey: ['onboarding-options'], queryFn: api.onboardingOptions, staleTime: Infinity });
  const colors = config.class_colors;
  const zoneCfg = config.zones.find((z) => z.id === zone) ?? config.zones[0];
  const busy = toggle.isPending || block.isPending || farmEdge.isPending;

  const data = plan.data;
  const fields = data?.fields.features ?? [];
  const labelOf = useMemo(() => new Map(fields.map((f) => [f.properties.field_id, f.properties.label])), [fields]);
  const network = useMemo<NetworkResponse | undefined>(
    () =>
      data && {
        zone: data.farmer.zone,
        month: data.month,
        sources: data.sources,
        edges: data.routes,
        metrics: { total_length_m: 0, weighted_loss: 0, fields_served: 0, resilience_score: 0 },
      },
    [data],
  );

  const statusText = (p: FarmFieldProps) =>
    !p.is_irrigated || p.stress_class === null ? t('farm.status.na') : t(`farm.status.${p.stress_class}` as 'farm.status.0');

  const nameOf = (p: FarmFieldProps) => p.name ?? t('farm.parcel', { n: p.label });
  const cropOf = (p: FarmFieldProps) => (p.crop ? optLabel(opts.data?.crops.find((c) => c.id === p.crop), lang) : null);
  const fieldTooltip = (p: FieldFeatureProps) => {
    const fp = p as FarmFieldProps;
    return `<b>${esc(nameOf(fp))}</b>${cropOf(fp) ? ` · ${esc(cropOf(fp) as string)}` : ''}<br/>${esc(statusText(fp))}${fp.needs_water ? `<br/>${esc(t('farm.need', { v: fp.need_m3_day }))}` : ''}`;
  };
  const edgeTooltip = (p: EdgeProps) => {
    const serves = ((p as EdgeProps & { serves?: string[] }).serves ?? []).map((id) => t('farm.parcel', { n: labelOf.get(id) ?? '?' }));
    return p.blocked
      ? `<b>${esc(t('farm.closedPath'))}</b><br/><span style="color:#86efac">${esc(t('farm.tapOpen'))}</span>`
      : `<b>${esc(t('farm.pathTip', { serves: serves.join(', ') }))}</b><br/><span style="color:#fca5a5">${esc(t('farm.tapClose'))}</span>`;
  };

  const onEdgeClick = (p: EdgeProps) => {
    if (busy || !data) return;
    if (data.farm_scoped) {
      farmEdge.mutate(
        { month, status_type: status, edge_id: p.edge_id, blocked: !p.blocked },
        {
          onSuccess: (res) => {
            const cut = res.fields_unserved ?? [];
            const names = new Map(res.fields.features.map((f) => [f.properties.field_id, nameOf(f.properties)]));
            if (cut.length) toast.warning(t('farm.cutoff', { n: cut.length }), cut.map((id) => names.get(id) ?? id).join(', '));
            else toast.success(p.blocked ? t('farm.reopened') : t('farm.closed'));
          },
        },
      );
      return;
    }
    block.mutate(
      { zone: data.farmer.zone, month, edge_id: p.edge_id, blocked: !p.blocked },
      {
        onSuccess: (res) => {
          const mine = res.fields_unserved.filter((id) => labelOf.has(id));
          if (mine.length) toast.warning(t('farm.cutoff', { n: mine.length }), mine.map((id) => t('farm.parcel', { n: labelOf.get(id) ?? '?' })).join(', '));
          else toast.success(p.blocked ? t('farm.reopened') : t('farm.closed'));
        },
      },
    );
  };

  const onToggle = (p: FarmFieldProps) => {
    if (busy) return;
    toggle.mutate(
      { month, status_type: status, field_id: p.field_id, active: !p.route_active },
      { onSuccess: () => toast.success(p.route_active ? t('farm.routeOffToast', { n: p.name ?? p.label }) : t('farm.routeOn', { n: p.name ?? p.label })) },
    );
  };

  if (!data) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3">
        <Skeleton className="h-28" />
        <div className="grid gap-3 lg:grid-cols-[1fr_400px]">
          <Skeleton className="h-[56vh]" />
          <Skeleton className="h-[56vh]" />
        </div>
      </div>
    );
  }

  const s = data.summary;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3">
      {/* greeting + today / next month */}
      <div className="glass flex flex-wrap items-center gap-4 p-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slime-400 to-amber-600 font-display text-2xl font-bold text-ink-950">
          {data.farmer.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold text-white">{t('farm.hello', { name: data.farmer.name })}</h1>
          <p className="flex items-center gap-1 text-sm text-slate-400">
            <MapPin size={14} /> {zoneCfg.name} · {t('farm.parcels', { n: s.fields_total })} · {fmtNumber(data.farmer.area_ha, lang, 1)} {t('common.ha')}
            <span className="mx-1">·</span>
            <span className="capitalize">{formatMonth(month, lang, 'long')}</span>
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Segmented
            layoutId="farm-when"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'now', label: t('farm.today') },
              { value: 'next', label: config.pipeline ? t('farm.nextWeek') : t('farm.nextMonth') },
            ]}
          />
        </div>
      </div>
      {when === 'next' && (
        <p className="rounded-xl border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-sm text-violet-100">{t('farm.forecastNote')}</p>
      )}

      {/* three big answers */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="glass flex items-center gap-3 p-4">
          <div className={`grid h-12 w-12 place-items-center rounded-2xl ${s.fields_need_water ? 'bg-orange-500/20 text-orange-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
            <Sprout size={24} />
          </div>
          <div>
            <div className="text-sm text-slate-400">{t('farm.kpi.toWater')}</div>
            <div className="font-display text-3xl font-bold text-white">
              {s.fields_need_water} <span className="text-lg text-slate-400">/ {s.fields_total}</span>
            </div>
          </div>
        </div>
        <div className="glass flex items-center gap-3 p-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-water-500/20 text-water-300">
            <Droplets size={24} />
          </div>
          <div>
            <div className="text-sm text-slate-400">{t('farm.kpi.water')}</div>
            <div className="font-display text-3xl font-bold text-white">
              <AnimatedNumber value={s.total_need_m3_day} lang={lang} /> <span className="text-lg text-slate-400">m³</span>
            </div>
            <div className="text-xs text-slate-500">{t('farm.kpi.perDay', { v: fmtNumber(s.total_need_m3_day, lang) })}</div>
          </div>
        </div>
        <div className="glass flex items-center gap-3 p-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slime-400/20 text-slime-300">
            <Clock size={24} />
          </div>
          <div>
            <div className="text-sm text-slate-400">{t('farm.kpi.when')}</div>
            <div className="font-display text-xl font-bold text-white" dir="ltr">{hourRanges(s.irrigation_hours)}</div>
            <div className="text-xs text-slate-500">{t('farm.kpi.whenSub')}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* map of my parcels only + the water paths that reach them */}
        <div className="glass relative h-[58vh] min-h-[360px] overflow-hidden">
          <MapView
            zone={data.farmer.zone}
            center={zoneCfg.center}
            bbox={data.bbox}
            layers={{ fields: true, network: true, sources: true, satellite, pruned: false }}
            colors={colors}
            patterns={patterns}
            fields={data.fields as unknown as FieldCollection}
            network={network}
            selectedFieldId={selected}
            onFieldClick={setSelected}
            fieldTooltip={fieldTooltip}
            sourceLabel={t('legend.source')}
            interactiveNetwork
            onEdgeClick={onEdgeClick}
            edgeTooltip={edgeTooltip}
          >
            {data.boundary && data.boundary.length >= 3 && (
              <>
                <OutsideMask ring={data.boundary} />
                <Polygon positions={ll(data.boundary)} pathOptions={{ color: '#facc15', weight: 3, fillOpacity: 0, interactive: false }} />
                <LockTo ring={data.boundary} k={data.farmer.farmer_id} />
                {obstacles && data.bbox.length === 4 && <ObstacleLayer zone={data.farmer.zone} bbox={data.bbox} />}
              </>
            )}
          </MapView>
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start gap-2">
            <span className="chip bg-ink-950/85 py-1.5 text-sm text-slate-100">
              <Hand size={14} className="text-slime-300" /> {t('farm.mapHint')}
            </span>
            {busy && (
              <span className="chip bg-ink-950/85">
                <Loader2 size={12} className="animate-spin" /> {t('common.loading')}
              </span>
            )}
          </div>
          {data.farm_scoped && (
            <button
              onClick={() => setObstacles((v) => !v)}
              className={`absolute bottom-14 end-14 z-[500] flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                obstacles ? 'border-red-400/50 bg-red-500/80 text-white' : 'border-white/10 bg-ink-950/85 text-slate-200'
              }`}
            >
              <Mountain size={14} /> {t('obs.toggle')}
            </button>
          )}
          <button
            onClick={() => setSatellite((v) => !v)}
            className={`absolute bottom-3 end-14 z-[500] flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
              satellite ? 'border-water-400/50 bg-water-500 text-ink-950' : 'border-white/10 bg-ink-950/85 text-slate-200'
            }`}
          >
            <Satellite size={14} /> {t('layer.satellite')}
          </button>
          <div className="glass-strong absolute bottom-3 start-3 z-[500] space-y-1 p-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-6 rounded-full bg-water-400 shadow-glow" /> {t('farm.legend.path')}
            </div>
            <div className="flex items-center gap-2">
              <span className="h-0 w-6 border-t-2 border-dashed border-red-400" /> {t('farm.legend.closed')}
            </div>
            <div className="flex items-center gap-2">
              <span className="ms-1.5 me-1.5 h-3 w-3 rounded-full bg-water-400 shadow-glow" /> {t('legend.source')}
            </div>
          </div>
        </div>

        {/* my parcels: plain status + on/off watering switch */}
        <div className="flex flex-col gap-2">
          <h2 className="px-1 font-display text-lg font-bold text-white">{t('farm.myParcels')}</h2>
          <div className="thin-scroll flex max-h-[58vh] flex-col gap-2 overflow-y-auto pe-1">
            {fields.map(({ properties: p }) => {
              const classified = p.is_irrigated && p.stress_class !== null;
              const color = classified ? colors[p.stress_class as number] : NA_COLOR;
              const isSel = selected === p.field_id;
              return (
                <motion.div
                  key={p.field_id}
                  layout
                  onClick={() => setSelected(isSel ? null : p.field_id)}
                  className={`glass cursor-pointer border-s-4 p-3.5 transition ${isSel ? 'ring-2 ring-white/60' : 'hover:bg-white/[0.06]'}`}
                  style={{ borderInlineStartColor: color }}
                >
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `${color}2a`, color }}>
                      <ClassIcon cls={classified ? p.stress_class : null} size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-lg font-bold text-white">{nameOf(p)}</span>
                        <span className="text-xs text-slate-500">
                          {fmtNumber(p.area_ha, lang, 1)} {t('common.ha')}
                        </span>
                      </div>
                      {cropOf(p) && <div className="text-xs text-slate-400">{cropOf(p)}</div>}
                      <div className="text-sm font-semibold" style={{ color }}>
                        {statusText(p)}
                      </div>
                    </div>
                    {classified && (
                      <div className="flex flex-col items-center gap-1">
                        <Switch on={p.route_active && p.needs_water} disabled={!p.needs_water || busy} onChange={() => onToggle(p)} label={t('farm.watering')} />
                        <span className="text-[10px] text-slate-400">{p.needs_water ? (p.route_active ? t('farm.on') : t('farm.off')) : t('farm.noNeed')}</span>
                      </div>
                    )}
                  </div>
                  {p.needs_water && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      {p.route_active && p.reachable && (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-water-500/15 px-2 py-1 font-semibold text-water-200">
                          <Droplets size={14} /> {t('farm.need', { v: fmtNumber(p.need_m3_day, lang) })}
                        </span>
                      )}
                      {!p.route_active && <span className="text-xs text-slate-400">{t('farm.offNote')}</span>}
                      {p.route_active && !p.reachable && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                          <TriangleAlert size={12} /> {t('farm.unreachable')}
                        </span>
                      )}
                    </div>
                  )}
                  {p.is_irrigated && p.next_class !== null && when === 'now' && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
                      <ArrowLeftRight size={12} /> {t(config.pipeline ? 'farm.nextW' : 'farm.next', { status: t(`farm.status.${p.next_class}` as 'farm.status.0') })}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
          <p className="px-1 text-[11px] text-slate-500">{data.farm_scoped ? t('farm.ownOnly') : t('farm.shared')}</p>
        </div>
      </div>
    </div>
  );
}
