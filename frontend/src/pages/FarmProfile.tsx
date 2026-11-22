import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import { CalendarCheck, Droplet, Droplets, Loader2, Map as MapIcon, Ruler, Satellite, Sprout } from 'lucide-react';
import { useState } from 'react';
import { MapContainer, Marker, Polygon, Tooltip, ZoomControl } from 'react-leaflet';
import { api } from '../api/client';
import { useConfig, useFarmPlan } from '../api/hooks';
import { NetworkLayer } from '../components/map/NetworkLayer';
import { ObstacleLayer, ObstacleLegend } from '../components/onboarding/ObstacleLayer';
import { BarChart3, ChevronDown, Gauge, Mountain, Pencil } from 'lucide-react';
import { ClassIcon } from '../components/ClassIcon';
import type { NetworkResponse, StressClass } from '../types';
import { BaseTiles, CATEGORY_COLORS, FitTo, ll, optLabel, OutsideMask } from '../components/onboarding/farmMap';
import { Panel } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';

const srcIcon = (planned: boolean) =>
  L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 26],
    html: `<div style="width:28px;height:28px;display:grid;place-items:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${planned ? '#f59e0b' : '#0ea5e9'};border:2px ${planned ? 'dashed' : 'solid'} white"><span style="transform:rotate(45deg);font-size:13px">💧</span></div>`,
  });

/** The farmer's saved farm: outline, sub-zones (crop + soil), water sources, and the satellite
 * stress of the detected fields under it. */
function hourRanges(hours: number[]): string {
  const runs: [number, number][] = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && h === last[1] + 1) last[1] = h;
    else runs.push([h, h]);
  }
  return runs.map(([a, b]) => `${a}–${b + 1}h`).join(' · ');
}

export default function FarmProfile() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data!;
  const [satellite, setSatellite] = useState(true);
  const [byStress, setByStress] = useState(true);
  const [obstacles, setObstacles] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const farms = useQuery({ queryKey: ['my-farms'], queryFn: api.myFarms });
  const opts = useQuery({ queryKey: ['onboarding-options'], queryFn: api.onboardingOptions, staleTime: Infinity });
  const farm = farms.data?.[farms.data.length - 1];
  const plan = useFarmPlan(farm?.farm_id ?? null, config.months.last_observed, 'current');
  const subState = new Map((plan.data?.fields.features ?? []).map((f) => [f.properties.field_id, f.properties]));
  const network: NetworkResponse | undefined = plan.data && {
    zone: plan.data.farmer.zone,
    month: plan.data.month,
    sources: plan.data.sources,
    edges: plan.data.routes,
    metrics: { total_length_m: 0, weighted_loss: 0, fields_served: 0, resilience_score: 0 },
  };

  if (farms.isLoading) return <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  if (!farm) {
    window.location.hash = '/onboarding';
    return <div />;
  }
  const crop = (id: string) => opts.data?.crops.find((c) => c.id === id);
  const zoneName = config.zones.find((z) => z.id === farm.zone)?.name ?? farm.zone;

  return (
    <div className="grid gap-3 p-3 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-3 lg:min-h-0">
        <Panel>
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[10rem] flex-1">
              <div className="label">{zoneName}</div>
              <h1 className="font-display text-2xl font-bold text-white">{farm.name}</h1>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
              <button onClick={() => { window.location.hash = '/edit'; }} className="btn-primary min-w-0 px-2 text-xs"><Pencil size={14} /> {t('edit.btn')}</button>
              <button onClick={() => { window.location.hash = '/stats'; }} className="btn-ghost min-w-0 px-2 text-xs"><BarChart3 size={14} /> {t('nav.stats')}</button>
              <button onClick={() => { window.location.hash = '/control'; }} className="btn-ghost min-w-0 px-2 text-xs"><Gauge size={14} /> {t('nav.control')}</button>
            </div>
          </div>
          <button
            onClick={() => setShowStats((v) => !v)}
            aria-expanded={showStats}
            className="mt-3 flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-start text-sm text-slate-200 hover:bg-white/10"
          >
            <BarChart3 size={14} className="text-water-300" />
            <span className="font-semibold">{t('profile.summary')}</span>
            {!showStats && plan.data && (
              <span className="truncate text-xs text-slate-400">
                · {plan.data.summary.fields_need_water}/{plan.data.summary.fields_total} {t('farm.kpi.toWater').toLowerCase()} · {fmtNumber(plan.data.summary.total_need_m3_day, lang)} m³
              </span>
            )}
            <ChevronDown size={16} className={`ms-auto shrink-0 text-slate-400 transition-transform ${showStats ? 'rotate-180' : ''}`} />
          </button>
          {showStats && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
            <Stat icon={<Ruler size={14} />} v={`${fmtNumber(farm.area_ha, lang, 1)} ha`} k={t('onb.area')} />
            <Stat icon={<Sprout size={14} />} v={String(farm.sub_zones.length)} k={t('onb.step2')} />
            <Stat icon={<Droplets size={14} />} v={`${fmtNumber(farm.need_m3_year / 1000, lang, 0)}k m³`} k={t('profile.need')} />
            {plan.data && (
              <>
                <Stat icon={<Sprout size={14} />} v={`${plan.data.summary.fields_need_water} / ${plan.data.summary.fields_total}`} k={t('farm.kpi.toWater')} />
                <Stat icon={<Droplets size={14} />} v={`${fmtNumber(plan.data.summary.total_need_m3_day, lang)} m³`} k={t('profile.today')} />
                <Stat icon={<CalendarCheck size={14} />} v={hourRanges(plan.data.summary.irrigation_hours)} k={t('farm.kpi.when')} />
              </>
            )}
          </div>
          )}
        </Panel>

        <section className="glass relative h-[52vh] min-h-[360px] overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
          <MapContainer center={[farm.bounds[0][0], farm.bounds[0][1]]} zoom={14} zoomControl={false} className="h-full w-full" scrollWheelZoom>
            <BaseTiles satellite={satellite} />
            <ZoomControl position="bottomright" />
            <FitTo k={farm.farm_id} ring={farm.boundary} lock />
            <OutsideMask ring={farm.boundary} />
            {farm.sub_zones.map((s) => {
              const st = subState.get(s.sub_zone_id);
              const c = st?.stress_class ?? null;
              const stressColor = c === null ? '#64748b' : config.class_colors[c];
              const fill = byStress ? stressColor : CATEGORY_COLORS[s.category];
              return (
                <Polygon key={s.sub_zone_id} positions={ll(s.polygon)} pathOptions={{ color: fill, weight: 2.5, fillColor: fill, fillOpacity: 0.5 }}>
                  <Tooltip direction="center" className="pg-tip">
                    {s.name} · {optLabel(crop(s.crop), lang)} · {c === null ? t('class.na') : t(`class.${c}` as 'class.0')}
                    {st?.needs_water ? ` · ${fmtNumber(st.need_m3_day, lang)} m³/j` : ''}
                  </Tooltip>
                </Polygon>
              );
            })}
            {obstacles && <ObstacleLayer zone={farm.zone} bbox={[farm.bounds[0][1], farm.bounds[0][0], farm.bounds[1][1], farm.bounds[1][0]]} />}
            {network && <NetworkLayer data={network} showPruned={false} />}
            <Polygon positions={ll(farm.boundary)} pathOptions={{ color: '#facc15', weight: 3, fillOpacity: 0, interactive: false }} />
            {farm.water_sources.map((s) => (
              <Marker key={s.source_id} position={[s.lat, s.lon]} icon={srcIcon(s.status === 'planned')}>
                <Tooltip direction="top" offset={[0, -24]} className="pg-tip">{optLabel(opts.data?.source_types.find((x) => x.id === s.type), lang)}</Tooltip>
              </Marker>
            ))}
          </MapContainer>
          <div className="absolute end-3 top-3 z-[500] flex gap-2">
            <button onClick={() => setObstacles(!obstacles)} className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs ${obstacles ? 'border-red-400/50 bg-red-500/20 text-red-100' : 'border-white/10 bg-ink-950/85 text-slate-200'}`}>
              <Mountain size={13} /> {t('obs.toggle')}
            </button>
            <button onClick={() => setByStress(!byStress)} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-950/85 px-2.5 py-1.5 text-xs text-slate-200">
              <MapIcon size={13} /> {byStress ? t('profile.colorStress') : t('profile.colorCrop')}
            </button>
            <button onClick={() => setSatellite(!satellite)} className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-950/85 px-2.5 py-1.5 text-xs text-slate-200">
              <Satellite size={13} /> {satellite ? t('onb.mapPlan') : t('onb.mapSat')}
            </button>
          </div>
        </section>
      </div>

      <aside className="thin-scroll flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <Panel title={t('onb.step2')} icon={<Sprout size={14} />}>
          <ul className="space-y-2 text-sm">
            {farm.sub_zones.map((s) => {
              const st = subState.get(s.sub_zone_id);
              const stressColor = st?.stress_class === null || st?.stress_class === undefined ? '#64748b' : config.class_colors[st.stress_class];
              return (
                <li key={s.sub_zone_id} className="rounded-xl border bg-white/5 p-3" style={{ borderColor: stressColor }}>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: CATEGORY_COLORS[s.category] }} />
                    <span className="min-w-0 flex-1 font-semibold text-white">{s.name}</span>
                    <span className="text-xs text-slate-400">{fmtNumber(s.area_ha, lang, 2)} ha</span>
                    {st && <span className="flex items-center" style={{ color: stressColor }}><ClassIcon cls={st.stress_class as StressClass | null} size={15} /></span>}
                  </div>
                  {st && (
                    <div className="mt-1 text-xs font-semibold" style={{ color: stressColor }}>
                      {t(`farm.status.${st.stress_class ?? 'na'}` as 'farm.status.0')}
                      {st.needs_water ? ` · ${fmtNumber(st.need_m3_day, lang)} m³/j` : ''}
                      {st.needs_water && !st.route_active ? ` · ${t('farm.off')}` : ''}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-slate-300">
                    {optLabel(crop(s.crop), lang)} · {t('onb.soil')} {optLabel(opts.data?.soils.find((x) => x.id === s.soil), lang).toLowerCase()} · {fmtNumber(s.need_m3_year, lang)} m³/{t('profile.year')}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title={t('onb.step3')} icon={<Droplet size={14} />}>
          {farm.water_sources.map((s) => (
            <div key={s.source_id} className="flex items-center gap-2 text-sm text-slate-200">
              <Droplet size={14} className={s.status === 'planned' ? 'text-amber-300' : 'text-water-300'} />
              {optLabel(opts.data?.source_types.find((x) => x.id === s.type), lang)}
              <span className={`ms-auto chip ${s.status === 'planned' ? 'text-amber-200' : 'text-water-200'}`}>
                {s.status === 'planned' ? (s.suggested ? t('profile.suggested') : t('profile.planned')) : t('profile.existing')}
              </span>
            </div>
          ))}
        </Panel>
        {plan.data?.terrain?.available && (
          <Panel title={t('obs.title')} icon={<Mountain size={14} />}>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>{t('obs.elev', { min: fmtNumber(plan.data.terrain.elevation_min_m, lang), max: fmtNumber(plan.data.terrain.elevation_max_m, lang) })}</li>
              <li>{t('obs.len', { m: fmtNumber(plan.data.terrain.route_length_m, lang) })}</li>
              <li>{t('obs.cross', { n: plan.data.terrain.route_road_crossings })}</li>
              <li>{t('obs.follow', { m: fmtNumber(plan.data.terrain.route_on_existing_canals_m, lang) })}</li>
              <li>{t('obs.uphill', { pct: fmtNumber(plan.data.terrain.route_max_uphill_pct, lang, 1) })}</li>
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">{t('obs.rules')}</p>
            {obstacles && <div className="mt-2"><ObstacleLegend /></div>}
          </Panel>
        )}
      </aside>
    </div>
  );
}

function Stat({ icon, v, k }: { icon: React.ReactNode; v: string; k: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <div className="mx-auto w-fit text-slate-400">{icon}</div>
      <div className="text-sm font-bold text-white">{v}</div>
      <div className="text-[10px] text-slate-400">{k}</div>
    </div>
  );
}
