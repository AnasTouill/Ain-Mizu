import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { Clock, Cpu, Droplets, Gauge, Loader2, Plus, Power, Radio, Trash2, TriangleAlert, Waves } from 'lucide-react';
import { useState } from 'react';
import { MapContainer, Marker, Polygon, Polyline, Tooltip, ZoomControl } from 'react-leaflet';
import { ApiError, api } from '../api/client';
import { useConfig } from '../api/hooks';
import { BaseTiles, ll, LockTo, optLabel, OutsideMask } from '../components/onboarding/farmMap';
import { Panel } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { toast } from '../store/toasts';
import type { LonLat } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const pumpIcon = L.divIcon({
  className: '',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: '<div class="pg-source"><span class="ring"></span><span class="ring r2"></span><span class="core"></span></div>',
});

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-water-500 shadow-glow' : 'bg-slate-600'}`}>
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-paper shadow transition-all ${on ? 'end-1' : 'start-1'}`} />
    </button>
  );
}

/** Control panel: the pump, the water paths (routes per sub-zone, valves per pipe), schedule and log.
 * Commands go to the backend control API; today they drive a virtual adapter (simulated hardware). */
export default function ControlPanel() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data!;
  const qc = useQueryClient();
  const [autoOff, setAutoOff] = useState(120);
  const [satellite, setSatellite] = useState(true);
  const farms = useQuery({ queryKey: ['my-farms'], queryFn: api.myFarms });
  const farm = farms.data?.[farms.data.length - 1];
  const fid = farm?.farm_id ?? '';
  const ctl = useQuery({ queryKey: ['control', fid], queryFn: () => api.control(fid), enabled: Boolean(fid), refetchInterval: 5000 });
  const logQ = useQuery({ queryKey: ['control-log', fid], queryFn: () => api.controlLog(fid), enabled: Boolean(fid), refetchInterval: 8000 });
  const opts = useQuery({ queryKey: ['onboarding-options'], queryFn: api.onboardingOptions, staleTime: Infinity });
  const cmd = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => api.controlPut(fid, path, body),
    onSuccess: (data) => {
      qc.setQueryData(['control', fid], data);
      qc.invalidateQueries({ queryKey: ['control-log', fid] });
      qc.invalidateQueries({ queryKey: ['farm'] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : String(e)),
  });

  const c = ctl.data;
  if (!c || !farm) return <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  const pumpOn = c.pump.on;
  const busy = cmd.isPending;
  const crop = (id: string) => optLabel(opts.data?.crops.find((x) => x.id === id), lang);
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-TN' : 'fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–');
  const closed = new Set(c.valves.filter((v: any) => !v.open).map((v: any) => v.valve_id));
  const maxFlow = Math.max(0.01, ...c.network.edges.features.map((f: any) => f.properties.flow));
  const schedule: { start: string; minutes: number }[] = c.schedule;
  const setSchedule = (slots: { start: string; minutes: number }[]) => cmd.mutate({ path: 'schedule', body: { slots } });

  return (
    <div className="mx-auto flex min-h-full max-w-[1680px] flex-col gap-3 p-3 pb-10 lg:h-full lg:min-h-0">
      <header className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white"><Gauge className="text-water-300" /> {t('nav.control')} · {farm.name}</h1>
        <span className="chip ms-auto border-emerald-400/30 text-emerald-200"><Radio size={12} /> {t('ctl.hw', { a: c.hardware.adapter })}</span>
      </header>

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="order-2 flex flex-col gap-3 lg:order-1 lg:min-h-0 lg:overflow-y-auto lg:pe-1">
          {/* pump */}
          <Panel title={t('ctl.pump')} icon={<Power size={14} />}>
            <div className="flex items-center gap-4">
              <button
                disabled={busy || c.mode === 'auto'}
                onClick={() => {
                  if (!pumpOn && !window.confirm(t('ctl.confirmOn', { n: c.coverage.sub_zones_reached }))) return;
                  cmd.mutate({ path: 'pump', body: { on: !pumpOn, auto_off_minutes: !pumpOn && autoOff ? autoOff : null } });
                }}
                className={`grid h-24 w-24 shrink-0 place-items-center rounded-full border-4 font-display text-lg font-bold transition disabled:opacity-60 ${pumpOn ? 'border-water-300 bg-water-500 text-ink-950 shadow-glow' : 'border-slate-500 bg-ink-800 text-slate-300'}`}
              >
                <div className="text-center"><Power size={26} className="mx-auto" />{pumpOn ? 'ON' : 'OFF'}</div>
              </button>
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <div className="text-slate-300">{pumpOn ? t('ctl.runningSince', { t: time(c.pump.on_since) }) : t('ctl.stopped')}</div>
                {c.pump.auto_off_at && <div className="text-xs text-amber-200"><Clock size={12} className="me-1 inline" />{t('ctl.autoOffAt', { t: time(c.pump.auto_off_at) })}</div>}
                <div className="text-xs text-slate-400">{fmtNumber(c.pump.rated_power_kw, lang)} kW · {fmtNumber(c.pump.flow_m3_h, lang)} m³/h</div>
                {!pumpOn && c.mode === 'manual' && (
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    {t('ctl.autoOff')}
                    <select value={autoOff} onChange={(e) => setAutoOff(Number(e.target.value))} className="input w-auto py-1 text-xs">
                      {[0, 30, 60, 120, 180, 240].map((m) => <option key={m} value={m}>{m ? `${m} min` : t('ctl.never')}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {(['manual', 'auto'] as const).map((m) => (
                <button key={m} disabled={busy} onClick={() => cmd.mutate({ path: 'mode', body: { mode: m } })}
                  className={`rounded-lg py-1.5 text-xs font-semibold ${c.mode === m ? 'bg-water-500/25 text-white' : 'text-slate-400 hover:text-white'}`}>
                  {t(`ctl.mode.${m}` as 'ctl.mode.manual')}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">{c.mode === 'auto' ? t('ctl.autoHelp') : t('ctl.manualHelp')}</p>
          </Panel>

          {/* live */}
          <Panel title={t('ctl.live')} icon={<Waves size={14} />}>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-white/5 p-2"><div className="font-display text-xl font-bold text-white">{fmtNumber(c.live.flow_m3_h, lang)}</div><div className="text-[10px] text-slate-400">m³/h {t('ctl.now')}</div></div>
              <div className="rounded-xl bg-white/5 p-2"><div className="font-display text-xl font-bold text-white">{fmtNumber(c.live.delivered_m3_today, lang, 1)}</div><div className="text-[10px] text-slate-400">m³ {t('ctl.delivered')}</div></div>
              <div className="rounded-xl bg-white/5 p-2"><div className="font-display text-xl font-bold text-white">{c.coverage.sub_zones_reached}/{c.coverage.sub_zones_needing_water}</div><div className="text-[10px] text-slate-400">{t('ctl.coverage')}</div></div>
              <div className="rounded-xl bg-white/5 p-2"><div className="font-display text-xl font-bold text-white">{fmtNumber(c.live.pumping_hours_needed, lang, 1)} h</div><div className="text-[10px] text-slate-400">{t('ctl.hoursNeeded', { m3: fmtNumber(c.live.need_m3_today, lang) })}</div></div>
            </div>
            {c.warnings.map((w: any, i: number) => (
              <p key={i} className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100"><TriangleAlert size={13} className="mt-0.5 shrink-0" /> {w.message}</p>
            ))}
          </Panel>

          {/* schedule */}
          <Panel title={t('ctl.schedule')} icon={<Clock size={14} />}>
            <div className="space-y-1.5">
              {schedule.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <input type="time" value={s.start} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} className="input w-28 py-1" />
                  <select value={s.minutes} onChange={(e) => setSchedule(schedule.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)))} className="input w-auto py-1">
                    {[30, 60, 90, 120, 180, 240, 360].map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <button onClick={() => setSchedule(schedule.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:text-red-300" aria-label={t('onb.delete')}><Trash2 size={14} /></button>
                </div>
              ))}
              <button onClick={() => setSchedule([...schedule, { start: '12:00', minutes: 60 }])} className="btn-ghost w-full text-xs"><Plus size={13} /> {t('ctl.addSlot')}</button>
            </div>
          </Panel>

          <Panel title={t('ctl.log')} icon={<Cpu size={14} />} className="max-h-[120px] shrink-0 !p-2">
            <ul className="thin-scroll max-h-[64px] space-y-1 overflow-y-auto text-xs">
              {(logQ.data ?? []).map((l, i) => (
                <li key={i} className="flex gap-2 border-b border-white/5 pb-1">
                  <span className="font-mono text-slate-500">{time(l.ts)}</span>
                  <span className="text-slate-200">{t(`ctl.act.${l.action}` as 'ctl.act.pump_on', {}) ?? l.action}</span>
                  <span className="truncate text-slate-500">{Object.values(l.detail ?? {}).filter((v) => typeof v !== 'object').join(' ')}</span>
                </li>
              ))}
              {!logQ.data?.length && <li className="text-slate-500">{t('ctl.noLog')}</li>}
            </ul>
          </Panel>
        </aside>

        <main className="order-1 flex min-h-0 flex-col gap-3 lg:order-2">
          {/* map: click a pipe to close / open its valve */}
          <div className="glass relative h-[60vh] min-h-[400px] overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
            <MapContainer center={[farm.bounds[0][0], farm.bounds[0][1]]} zoom={14} zoomControl={false} className="h-full w-full" scrollWheelZoom>
              <BaseTiles satellite={satellite} />
              <ZoomControl position="bottomright" />
              <LockTo ring={farm.boundary as LonLat[]} k={farm.farm_id} />
              <OutsideMask ring={farm.boundary as LonLat[]} />
              {c.network.fields.features.map((f: any) => {
                const cls = f.properties.stress_class;
                const color = cls === null ? '#64748b' : config.class_colors[cls];
                const route = c.routes.find((r: any) => r.sub_zone_id === f.properties.field_id);
                return (
                  <Polygon key={f.properties.field_id} positions={ll(f.geometry.coordinates[0])} pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: route?.enabled ? 0.45 : 0.12, dashArray: route?.enabled ? undefined : '4 4' }}>
                    <Tooltip direction="center" className="pg-tip">{f.properties.name}</Tooltip>
                  </Polygon>
                );
              })}
              <Polygon positions={ll(farm.boundary as LonLat[])} pathOptions={{ color: '#facc15', weight: 3, fillOpacity: 0, interactive: false }} />
              {c.network.edges.features.map((f: any) => {
                const p = f.properties;
                const isClosed = closed.has(p.edge_id) || p.blocked;
                const flowing = pumpOn && !isClosed && p.flow > 0;
                return (
                  <Polyline
                    key={p.edge_id}
                    positions={f.geometry.coordinates.map(([x, y]: number[]) => [y, x])}
                    pathOptions={{ color: isClosed ? '#f87171' : flowing ? '#38bdf8' : '#94a3b8', weight: isClosed ? 3 : 2 + 7 * (p.flow / maxFlow), dashArray: isClosed ? '6 6' : flowing ? '10 8' : undefined, className: flowing ? 'pg-flow' : undefined }}
                    eventHandlers={{ click: () => !busy && cmd.mutate({ path: `valves/${p.edge_id}`, body: { open: isClosed } }) }}
                  >
                    <Tooltip className="pg-tip">{isClosed ? t('ctl.valveClosed') : t('ctl.valveOpen')} · {fmtNumber(p.length_m, lang)} m</Tooltip>
                  </Polyline>
                );
              })}
              {c.network.sources.map((s: any) => <Marker key={s.node_id} position={[s.lat, s.lon]} icon={pumpIcon}><Tooltip className="pg-tip">{t('ctl.pump')}</Tooltip></Marker>)}
            </MapContainer>
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start gap-2">
              <span className="chip bg-ink-950/85 text-xs text-slate-100">{t('ctl.mapHint')}</span>
              {busy && <span className="chip bg-ink-950/85"><Loader2 size={12} className="animate-spin" /></span>}
              <button onClick={() => setSatellite(!satellite)} className="pointer-events-auto ms-auto chip bg-ink-950/85 text-xs">{satellite ? t('onb.mapPlan') : t('onb.mapSat')}</button>
            </div>
          </div>

        </main>

        <aside className="order-3 flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:ps-1">
          <Panel title={t('ctl.routes')} icon={<Droplets size={14} />}>
            <div className="space-y-1.5">
              {c.routes.map((r: any) => {
                const color = r.stress_class === null ? '#64748b' : config.class_colors[r.stress_class];
                return (
                  <div key={r.route_id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2 text-sm" style={{ borderInlineStartColor: color, borderInlineStartWidth: 4 }}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-white">{r.label} <span className="text-xs font-normal text-slate-400">· {crop(r.crop)}</span></div>
                      <div className="text-[11px] text-slate-400">
                        {r.needs_water ? `${fmtNumber(r.need_m3_day, lang)} m³/j` : t('farm.noNeed')}
                        {r.recommended && <span className="ms-1 rounded bg-emerald-500/20 px-1 text-emerald-200">{t('ctl.recommended')}</span>}
                        {r.enabled && r.needs_water && !r.reachable && <span className="ms-1 text-amber-300">{t('farm.unreachable')}</span>}
                        {r.flow_m3_h > 0 && <span className="ms-1 text-water-200">{fmtNumber(r.flow_m3_h, lang, 1)} m³/h</span>}
                      </div>
                    </div>
                    <Switch on={r.enabled} disabled={busy} label={r.label} onChange={() => cmd.mutate({ path: `routes/${r.sub_zone_id}`, body: { enabled: !r.enabled } })} />
                  </div>
                );
              })}
            </div>
          </Panel>
        </aside>
      </div>
      <p className="shrink-0 text-[11px] text-slate-500">{t('ctl.note')}</p>
    </div>
  );
}
