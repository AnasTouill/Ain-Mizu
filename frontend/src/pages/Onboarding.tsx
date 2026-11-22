import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Droplet, Eraser, Layers, Loader2, MapPin, MousePointerClick, PenLine, Satellite, Sparkles, Trash2, Undo2, Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Rectangle, Tooltip, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '../api/client';
import { useConfig } from '../api/hooks';
import {
  areaHa, BaseTiles, CATEGORY_COLORS, centroidOf, ClickCapture, FitTo, ll, NO_CROP_COLOR, optLabel, OutsideMask, pointInPolygon,
} from '../components/onboarding/farmMap';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useAuth } from '../store/useAuth';
import { toast } from '../store/toasts';
import type { LonLat, SavedFarm, SourceDraft, SourceSuggestion, SubZoneDraft, ZoneId } from '../types';

type Step = 1 | 2 | 3 | 4;

const dropIcon = (color: string, dashed = false) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 28],
    html: `<div style="width:30px;height:30px;display:grid;place-items:center;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px ${dashed ? 'dashed' : 'solid'} white;box-shadow:0 0 14px ${color}"><span style="transform:rotate(45deg);font-size:14px">💧</span></div>`,
  });

export default function Onboarding({ editFarm }: { editFarm?: SavedFarm }) {
  const t = useT();
  const lang = useLang();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const setFarmer = useAppStore((s) => s.setFarmer);
  const opts = useQuery({ queryKey: ['onboarding-options'], queryFn: api.onboardingOptions, staleTime: Infinity });
  const classColors = useConfig().data?.class_colors ?? ['#2e9e4f', '#f2c230', '#f08a24', '#d62f2f'];

  const [step, setStep] = useState<Step>(editFarm ? 2 : 1);
  const [satellite, setSatellite] = useState(true);
  const [region, setRegion] = useState<ZoneId | null>(editFarm?.zone ?? null);
  const [draft, setDraft] = useState<LonLat[]>([]); // polygon being drawn (outline or sub-zone)
  const [drawing, setDrawing] = useState(false);
  const [boundary, setBoundary] = useState<LonLat[] | null>(editFarm ? (editFarm.boundary.slice(0, -1) as LonLat[]) : null);
  const [subs, setSubs] = useState<SubZoneDraft[]>(
    editFarm ? editFarm.sub_zones.map((s) => ({ key: s.sub_zone_id, name: s.name, polygon: s.polygon.slice(0, -1) as LonLat[], crop: s.crop, soil: s.soil })) : [],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [hasWater, setHasWater] = useState<boolean | null>(editFarm ? editFarm.has_water_source : null);
  const [sources, setSources] = useState<SourceDraft[]>(editFarm ? editFarm.water_sources.map((s) => ({ lon: s.lon, lat: s.lat, type: s.type, suggested: s.suggested })) : []);
  const [suggestion, setSuggestion] = useState<SourceSuggestion | null>(null);
  const [farmName, setFarmName] = useState(editFarm?.name ?? (user ? `Ferme ${user.name}` : ''));
  const [busy, setBusy] = useState(false);
  const [sat, setSat] = useState<{ field_id: string; polygon: LonLat[]; area_ha: number; stress_class: number | null }[]>([]);

  const zones = opts.data?.zones ?? [];
  const regionInfo = zones.find((z) => z.id === region);
  const cropById = useMemo(() => new Map((opts.data?.crops ?? []).map((c) => [c.id, c])), [opts.data]);
  const allBbox = useMemo<[number, number, number, number] | undefined>(() => {
    if (!zones.length) return undefined;
    return [Math.min(...zones.map((z) => z.bbox[0])), Math.min(...zones.map((z) => z.bbox[1])), Math.max(...zones.map((z) => z.bbox[2])), Math.max(...zones.map((z) => z.bbox[3]))];
  }, [zones]);

  // ------------------------------------------------------------------ drawing
  const finishDraft = () => {
    if (draft.length < 3) {
      toast.error(t('onb.need3'));
      return;
    }
    if (step === 1) {
      setBoundary(draft);
      setSubs([]);
      setSat([]);
      setSources([]);
      setSuggestion(null);
      void autoSegment(draft, true); // select the satellite fields inside the outline right away
    } else {
      const key = `s${Date.now()}`;
      setSubs((s) => [...s, { key, name: `${t('onb.subzone')} ${s.length + 1}`, polygon: draft, crop: null, soil: null }]);
      setSelected(key);
    }
    setDraft([]);
    setDrawing(false);
  };

  const onMapClick = (p: LonLat) => {
    if (step === 1 && !region) return;
    if (drawing) {
      if (step === 2 && boundary && !pointInPolygon(p, boundary)) {
        toast.error(t('onb.insideOnly'));
        return;
      }
      // closing click near the first point
      if (draft.length >= 3) {
        const [x0, y0] = draft[0];
        if (Math.hypot((p[0] - x0) * 92000, (p[1] - y0) * 111000) < 25) {
          finishDraft();
          return;
        }
      }
      setDraft((d) => [...d, p]);
      return;
    }
    if (step === 3 && hasWater !== null && boundary) {
      if (!pointInPolygon(p, boundary)) {
        toast.error(t('onb.insideOnly'));
        return;
      }
      if (hasWater) setSources((s) => [...s, { lon: p[0], lat: p[1], type: 'puits' }]);
      else setSources([{ lon: p[0], lat: p[1], type: suggestion?.type ?? 'forage', suggested: false }]);
    }
  };

  // ------------------------------------------------------------------ actions
  const autoSegment = async (outline?: LonLat[], first = false) => {
    const b = outline ?? boundary;
    if (!b || !region) return;
    setBusy(true);
    try {
      const res = await api.autoSegment({ zone: region, boundary: b });
      setSat(res.segments.map((s) => ({ ...s, polygon: s.polygon.slice(0, -1) as LonLat[] })));
      if (!res.segments.length) {
        if (!first) toast.error(t('onb.autoNone'));
        return;
      }
      const manual = first ? [] : subs.filter((c) => !c.field_id);
      const clipped = res.segments.map((s, i) => ({
        key: `a${s.field_id}`,
        name: `${t('onb.subzone')} ${manual.length + i + 1}`,
        polygon: s.polygon.slice(0, -1) as LonLat[],
        crop: null,
        soil: null,
        field_id: s.field_id,
      }));
      setSubs([...manual, ...clipped]);
      setSelected(clipped[0].key);
      toast.success(t(first ? 'onb.autoSelected' : 'onb.autoDone', { n: clipped.length }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const wholeFarm = () => {
    if (!boundary) return;
    const key = `w${Date.now()}`;
    setSubs([{ key, name: `${t('onb.subzone')} 1`, polygon: boundary, crop: null, soil: null }]);
    setSelected(key);
  };

  const askSuggestion = async () => {
    if (!boundary || !region) return;
    setBusy(true);
    try {
      const s = await api.suggestSource({ zone: region, boundary, sub_zones: subs.map((z) => ({ name: z.name, polygon: z.polygon, crop: z.crop, soil: z.soil })) });
      setSuggestion(s);
      setSources([{ lon: s.lon, lat: s.lat, type: s.type, suggested: true }]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };


  const validate = async () => {
    if (!boundary || !region) return;
    setBusy(true);
    try {
      const payload = {
        name: farmName,
        zone: region,
        boundary,
        sub_zones: subs.map((z) => ({ name: z.name, polygon: z.polygon, crop: z.crop, soil: z.soil })),
        has_water_source: Boolean(hasWater),
        water_sources: sources,
      };
      const res = editFarm ? await api.updateFarm(editFarm.farm_id, payload) : await api.createFarm(payload);
      if (!editFarm) setUser(res.user);
      setFarmer(res.farm.farm_id, res.farm.zone);
      toast.success(t('onb.saved'));
      window.location.hash = '/profile';
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ step guards
  const subsComplete = subs.length > 0 && subs.every((s) => s.crop && s.soil);
  const canNext =
    (step === 1 && Boolean(boundary)) ||
    (step === 2 && subsComplete && !drawing) ||
    (step === 3 && hasWater !== null && sources.length > 0) ||
    step === 4;
  const goNext = () => {
    if (!canNext) return;
    setDrawing(false);
    setDraft([]);
    setStep((s) => Math.min(4, s + 1) as Step);
  };
  const goBack = () => {
    setDrawing(false);
    setDraft([]);
    if (step === 1 && region && !boundary) setRegion(null);
    else if (step === 1 && boundary) setBoundary(null);
    else setStep((s) => Math.max(1, s - 1) as Step);
  };

  const sel = subs.find((s) => s.key === selected) ?? null;
  const updateSel = (patch: Partial<SubZoneDraft>) => setSubs((all) => all.map((s) => (s.key === selected ? { ...s, ...patch } : s)));
  const subColor = (s: SubZoneDraft) => (s.crop ? CATEGORY_COLORS[cropById.get(s.crop)?.category ?? 'autre'] : NO_CROP_COLOR);
  const fitKey = boundary ? `b${boundary.length}${boundary[0]}` : region ? `r${region}` : `all${zones.length}`;

  const STEPS: { n: Step; label: string }[] = [
    { n: 1, label: t('onb.step1') },
    { n: 2, label: t('onb.step2') },
    { n: 3, label: t('onb.step3') },
    { n: 4, label: t('onb.step4') },
  ];

  if (opts.isLoading) return <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="grid h-full gap-3 p-3 lg:grid-cols-[380px_1fr]">
      {/* ---------------- side panel */}
      <aside className="glass thin-scroll order-2 flex min-h-0 flex-col gap-3 overflow-y-auto p-4 lg:order-1">
        <div>
          <div className="chip mb-2 border-slime-400/30 text-slime-200"><Sparkles size={12} /> {editFarm ? t('edit.kicker', { name: editFarm.name }) : t('onb.kicker', { name: user?.name ?? '' })}</div>
          <ol className="grid grid-cols-4 gap-1">
            {STEPS.map((s) => (
              <li key={s.n} className={`rounded-lg border px-1.5 py-1 text-center text-[10px] font-semibold leading-tight ${s.n === step ? 'border-water-400/60 bg-water-500/20 text-white' : s.n < step ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10 text-slate-500'}`}>
                {s.n < step ? <Check size={11} className="mx-auto" /> : s.n}
                <div className="mt-0.5">{s.label}</div>
              </li>
            ))}
          </ol>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={`${step}-${region ? 1 : 0}-${boundary ? 1 : 0}`} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="flex flex-col gap-3">
            {/* STEP 1 */}
            {step === 1 && !region && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s1.title')}</h2>
                <p className="text-sm text-slate-300">{t('onb.s1.region')}</p>
                {zones.map((z) => (
                  <button key={z.id} onClick={() => setRegion(z.id)} className="btn-ghost justify-start">
                    <MapPin size={15} className="text-water-300" /> {z.name}
                  </button>
                ))}
              </>
            )}
            {step === 1 && region && !boundary && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s1.draw', { zone: regionInfo?.name ?? '' })}</h2>
                <p className="text-sm text-slate-300">{t('onb.s1.drawHelp')}</p>
                <DrawTools drawing={drawing} n={draft.length} onStart={() => { setDraft([]); setDrawing(true); }} onUndo={() => setDraft((d) => d.slice(0, -1))} onClear={() => setDraft([])} onFinish={finishDraft} t={t} startLabel={t('onb.drawOutline')} />
              </>
            )}
            {step === 1 && boundary && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s1.done')}</h2>
                <p className="text-sm text-slate-300">{t('onb.s1.doneHelp', { ha: fmtNumber(areaHa(boundary), lang, 2) })}</p>
                {busy ? (
                  <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> {t('onb.s1.detecting')}</p>
                ) : (
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-50">
                    <div className="font-semibold">{sat.length ? t('onb.s1.found', { n: sat.length }) : t('onb.s1.none')}</div>
                    {sat.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        {[0, 1, 2, 3].map((c) => {
                          const n = sat.filter((s) => s.stress_class === c).length;
                          return n ? (
                            <span key={c} className="rounded-full px-2 py-0.5 font-semibold" style={{ background: `${classColors[c]}33`, color: classColors[c] }}>
                              {n} · {t(`class.${c}` as 'class.0')}
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => setBoundary(null)} className="btn-ghost"><PenLine size={15} /> {t('onb.redraw')}</button>
              </>
            )}

            {/* STEP 2 */}
            {step === 2 && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s2.title')}</h2>
                <p className="text-sm text-slate-300">{t('onb.s2.help')}</p>
                <DrawTools drawing={drawing} n={draft.length} onStart={() => { setDraft([]); setDrawing(true); setSelected(null); }} onUndo={() => setDraft((d) => d.slice(0, -1))} onClear={() => setDraft([])} onFinish={finishDraft} t={t} startLabel={t('onb.drawSub')} />
                {!drawing && (
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => void autoSegment()} disabled={busy} className="btn-ghost text-xs" title={t('onb.autoHelp')}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {t('onb.auto')}
                    </button>
                    <button onClick={wholeFarm} className="btn-ghost text-xs"><Layers size={14} /> {t('onb.whole')}</button>
                  </div>
                )}
                <div className="space-y-1.5">
                  {subs.map((s) => (
                    <div key={s.key} className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-sm ${s.key === selected ? 'border-water-400/60 bg-water-500/10' : 'border-white/10 bg-white/5'}`}>
                      <button onClick={() => setSelected(s.key)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
                        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: subColor(s) }} />
                        <span className="truncate text-slate-100">{s.name}</span>
                        <span className="ms-auto shrink-0 text-[11px] text-slate-400">{fmtNumber(areaHa(s.polygon), lang, 2)} ha</span>
                        {s.crop && s.soil ? <CheckCircle2 size={14} className="shrink-0 text-emerald-400" /> : <span className="shrink-0 text-[10px] text-amber-300">{t('onb.todo')}</span>}
                      </button>
                      <button onClick={() => { setSubs((a) => a.filter((x) => x.key !== s.key)); if (selected === s.key) setSelected(null); }} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-red-300" aria-label={t('onb.delete')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {sel && (
                  <div className="space-y-2 rounded-xl border border-water-400/30 bg-ink-800/60 p-3">
                    <label className="block">
                      <span className="label">{t('onb.subName')}</span>
                      <input value={sel.name} onChange={(e) => updateSel({ name: e.target.value })} className="input mt-1" />
                    </label>
                    <label className="block">
                      <span className="label">{t('onb.crop')}</span>
                      <select value={sel.crop ?? ''} onChange={(e) => updateSel({ crop: e.target.value || null })} className="input mt-1">
                        <option value="">{t('onb.choose')}</option>
                        {(opts.data?.categories ?? []).map((c) => (
                          <optgroup key={c.id} label={optLabel(c, lang)}>
                            {(opts.data?.crops ?? []).filter((x) => x.category === c.id).map((x) => (
                              <option key={x.id} value={x.id}>{optLabel(x, lang)}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="label">{t('onb.soil')}</span>
                      <select value={sel.soil ?? ''} onChange={(e) => updateSel({ soil: e.target.value || null })} className="input mt-1">
                        <option value="">{t('onb.choose')}</option>
                        {(opts.data?.soils ?? []).map((x) => <option key={x.id} value={x.id}>{optLabel(x, lang)}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </>
            )}

            {/* STEP 3 */}
            {step === 3 && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s3.title')}</h2>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setHasWater(true); setSources([]); setSuggestion(null); }} className={`btn-ghost ${hasWater === true ? 'border-water-400/60 bg-water-500/20 text-white' : ''}`}>{t('onb.yes')}</button>
                  <button onClick={() => { setHasWater(false); setSources([]); setSuggestion(null); void askSuggestion(); }} className={`btn-ghost ${hasWater === false ? 'border-amber-400/60 bg-amber-500/20 text-white' : ''}`}>{t('onb.no')}</button>
                </div>
                {hasWater === true && (
                  <>
                    <p className="flex items-start gap-2 text-sm text-slate-300"><MousePointerClick size={16} className="mt-0.5 shrink-0 text-water-300" /> {t('onb.s3.place')}</p>
                    {sources.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2 text-sm">
                        <Droplet size={14} className="text-water-300" />
                        <select value={s.type} onChange={(e) => setSources((all) => all.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} className="input flex-1 py-1">
                          {(opts.data?.source_types ?? []).map((x) => <option key={x.id} value={x.id}>{optLabel(x, lang)}</option>)}
                        </select>
                        <button onClick={() => setSources((all) => all.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:text-red-300" aria-label={t('onb.delete')}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </>
                )}
                {hasWater === false && (
                  <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-50">
                    {busy || !suggestion ? (
                      <div className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> {t('onb.s3.computing')}</div>
                    ) : (
                      <>
                        <div className="font-semibold">{t('onb.s3.suggest', { type: optLabel(opts.data?.source_types.find((x) => x.id === suggestion.type), lang) })}</div>
                        <ul className="list-disc space-y-0.5 ps-4 text-xs text-amber-100/90">
                          <li>{t('onb.s3.need', { m3: fmtNumber(suggestion.need_m3_year, lang) })}</li>
                          <li>{t('onb.s3.pipe', { m: fmtNumber(suggestion.mean_distance_m, lang), pct: fmtNumber(suggestion.saving_vs_center_pct, lang, 1) })}</li>
                          <li>{t('onb.s3.max', { m: fmtNumber(suggestion.max_distance_m, lang) })}</li>
                        </ul>
                        <p className="text-[11px] text-amber-200/80">{t('onb.s3.method')}</p>
                        <p className="text-xs text-slate-300">{t('onb.s3.move')}</p>
                        {sources[0] && !sources[0].suggested && (
                          <button onClick={() => setSources([{ lon: suggestion.lon, lat: suggestion.lat, type: suggestion.type, suggested: true }])} className="btn-ghost text-xs"><Undo2 size={13} /> {t('onb.s3.reset')}</button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {/* STEP 4 */}
            {step === 4 && boundary && (
              <>
                <h2 className="font-display text-xl font-bold text-white">{t('onb.s4.title')}</h2>
                <label className="block">
                  <span className="label">{t('onb.farmName')}</span>
                  <input value={farmName} onChange={(e) => setFarmName(e.target.value)} className="input mt-1" />
                </label>
                <dl className="space-y-1 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                  <Row k={t('onb.zone')} v={regionInfo?.name ?? ''} />
                  <Row k={t('onb.area')} v={`${fmtNumber(areaHa(boundary), lang, 2)} ha`} />
                  <Row k={t('onb.step2')} v={String(subs.length)} />
                  <Row k={t('onb.step3')} v={hasWater ? t('onb.existing', { n: sources.length }) : t('onb.planned')} />
                </dl>
                <ul className="space-y-1 text-xs text-slate-300">
                  {subs.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: subColor(s) }} />
                      <span className="font-semibold text-slate-100">{s.name}</span> · {optLabel(cropById.get(s.crop ?? ''), lang)} · {optLabel(opts.data?.soils.find((x) => x.id === s.soil), lang)}
                    </li>
                  ))}
                </ul>
                <button onClick={validate} disabled={busy} className="btn-primary py-2.5">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {editFarm ? t('edit.save') : t('onb.validate')}
                </button>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-auto flex gap-2 pt-2">
          {(step > 1 || region) && (
            <button onClick={goBack} className="btn-ghost"><ArrowLeft size={15} className="rtl:rotate-180" /> {t('onb.back')}</button>
          )}
          {step < 4 && (
            <button onClick={goNext} disabled={!canNext} className="btn-primary ms-auto">
              {t('onb.next')} <ArrowRight size={15} className="rtl:rotate-180" />
            </button>
          )}
        </div>
      </aside>

      {/* ---------------- map */}
      <section className="glass relative order-1 min-h-[52vh] overflow-hidden lg:order-2">
        <MapContainer center={[34.6, 9.5]} zoom={8} zoomControl={false} className="h-full w-full" scrollWheelZoom>
          <BaseTiles satellite={satellite} />
          <ZoomControl position="bottomright" />
          <FitTo k={fitKey} bbox={regionInfo?.bbox ?? allBbox} ring={boundary ?? undefined} lock={Boolean(boundary)} />
          <ClickCapture onClick={onMapClick} cursor={drawing || (step === 3 && hasWater !== null)} />

          {!boundary &&
            zones.map((z) =>
              !region || region === z.id ? (
                <Rectangle
                  key={z.id}
                  bounds={[[z.bbox[1], z.bbox[0]], [z.bbox[3], z.bbox[2]]]}
                  pathOptions={{ color: '#38bdf8', weight: 2, dashArray: region ? '6 6' : undefined, fillOpacity: region ? 0 : 0.18 }}
                  eventHandlers={region ? {} : { click: () => setRegion(z.id) }}
                  interactive={!region}
                >
                  {!region && <Tooltip permanent direction="center" className="pg-tip">{z.name}</Tooltip>}
                </Rectangle>
              ) : null,
            )}

          {boundary && <OutsideMask ring={boundary} />}
          {boundary && step === 1 &&
            sat.map((s) => {
              const color = s.stress_class === null ? NO_CROP_COLOR : classColors[s.stress_class];
              return (
                <Polygon key={`sat${s.field_id}`} positions={ll(s.polygon)} pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.45 }}>
                  <Tooltip className="pg-tip">{s.field_id} · {fmtNumber(s.area_ha, lang, 1)} ha · {s.stress_class === null ? t('class.na') : t(`class.${s.stress_class}` as 'class.0')}</Tooltip>
                </Polygon>
              );
            })}
          {boundary && <Polygon positions={ll(boundary)} pathOptions={{ color: '#facc15', weight: 3, fillOpacity: step === 1 ? 0.15 : 0, interactive: false }} />}

          {step >= 2 && subs.map((s) => (
            <Polygon
              key={s.key}
              positions={ll(s.polygon)}
              pathOptions={{ color: s.key === selected ? '#ffffff' : subColor(s), weight: s.key === selected ? 3 : 1.5, fillColor: subColor(s), fillOpacity: 0.4 }}
              eventHandlers={{ click: (e) => { if (!drawing && step === 2) { L.DomEvent.stopPropagation(e); setSelected(s.key); } } }}
              interactive={step === 2 && !drawing}
            >
              <Tooltip direction="center" className="pg-tip">{s.name}{s.crop ? ` · ${optLabel(cropById.get(s.crop), lang)}` : ''}</Tooltip>
            </Polygon>
          ))}

          {draft.length > 0 && (
            <>
              <Polyline positions={ll(draft)} pathOptions={{ color: '#facc15', weight: 2.5, dashArray: '6 5' }} />
              {draft.map((p, i) => (
                <CircleMarker key={i} center={[p[1], p[0]]} radius={i === 0 ? 7 : 4} pathOptions={{ color: '#facc15', fillColor: i === 0 ? '#facc15' : '#1F2421', fillOpacity: 1, weight: 2 }} />
              ))}
            </>
          )}

          {step >= 3 &&
            sources.map((s, i) => (
              <Marker key={`${i}-${s.lon}-${s.lat}`} position={[s.lat, s.lon]} icon={dropIcon(hasWater ? '#0ea5e9' : '#f59e0b', !hasWater)}>
                <Tooltip direction="top" offset={[0, -26]} className="pg-tip">
                  {hasWater ? optLabel(opts.data?.source_types.find((x) => x.id === s.type), lang) : s.suggested ? t('onb.suggested') : t('onb.yourChoice')}
                </Tooltip>
              </Marker>
            ))}
          {step >= 3 && hasWater === false && suggestion &&
            subs.map((s) => {
              const c = centroidOf(s.polygon);
              const src = sources[0];
              return src ? <Polyline key={`p${s.key}`} positions={[[src.lat, src.lon], [c[1], c[0]]]} pathOptions={{ color: '#f59e0b', weight: 1.5, dashArray: '4 6', opacity: 0.8 }} /> : null;
            })}
        </MapContainer>

        <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex items-start gap-2">
          {drawing && (
            <div className="pointer-events-auto rounded-xl border border-slime-400/40 bg-ink-950/85 px-3 py-1.5 text-xs text-slime-100">
              <PenLine size={12} className="me-1 inline" /> {t('onb.drawingHint', { n: draft.length })}
            </div>
          )}
          <button onClick={() => setSatellite(!satellite)} className="pointer-events-auto ms-auto flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-950/85 px-2.5 py-1.5 text-xs text-slate-200">
            <Satellite size={13} /> {satellite ? t('onb.mapPlan') : t('onb.mapSat')}
          </button>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{k}</dt>
      <dd className="font-semibold text-slate-100">{v}</dd>
    </div>
  );
}

function DrawTools({ drawing, n, onStart, onUndo, onClear, onFinish, t, startLabel }: {
  drawing: boolean; n: number; onStart: () => void; onUndo: () => void; onClear: () => void; onFinish: () => void;
  t: ReturnType<typeof useT>; startLabel: string;
}) {
  if (!drawing) return <button onClick={onStart} className="btn-primary"><PenLine size={15} /> {startLabel}</button>;
  return (
    <div className="grid grid-cols-3 gap-2">
      <button onClick={onUndo} disabled={!n} className="btn-ghost text-xs"><Undo2 size={13} /> {t('onb.undo')}</button>
      <button onClick={onClear} disabled={!n} className="btn-ghost text-xs"><Eraser size={13} /> {t('onb.clear')}</button>
      <button onClick={onFinish} disabled={n < 3} className="btn-primary text-xs"><Check size={13} /> {t('onb.finish')}</button>
    </div>
  );
}
