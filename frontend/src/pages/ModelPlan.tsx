import { motion } from 'framer-motion';
import { BarChart3, BrainCircuit, CalendarCheck, Droplets, Image as ImageIcon, MapPin, Search, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useConfig, useModelMetrics, useModelPlan } from '../api/hooks';
import { ClassIcon, NA_COLOR } from '../components/ClassIcon';
import { AnimatedNumber, Panel, Skeleton, TiltCard } from '../components/ui/primitives';
import { fmtWeek } from '../components/WeeklyChart';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { StressClass, ZoneId } from '../types';

function Badge({ cls, colors }: { cls: StressClass | null; colors: string[] }) {
  const t = useT();
  const color = cls === null ? NA_COLOR : colors[cls];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold" style={{ borderColor: `${color}88`, background: `${color}22`, color }}>
      <ClassIcon cls={cls} size={11} />
      {cls === null ? t('class.na') : t(`class.${cls}` as 'class.0')}
    </span>
  );
}

function ClassBar({ counts, colors }: { counts: Record<string, number>; colors: string[] }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5">
      {[0, 1, 2, 3].map((c) => (
        <div key={c} style={{ width: `${(100 * (counts[String(c)] ?? 0)) / total}%`, background: colors[c] }} title={`${counts[String(c)] ?? 0}`} />
      ))}
    </div>
  );
}

export default function ModelPlan() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data!;
  const colors = config.class_colors;
  const [zoneFilter, setZoneFilter] = useState<ZoneId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const plan = useModelPlan(undefined, Boolean(config.pipeline));
  const metrics = useModelMetrics(Boolean(config.pipeline));
  const setZone = useAppStore((s) => s.setZone);
  const selectField = useAppStore((s) => s.selectField);
  const zoneName = (id: string) => config.zones.find((z) => z.id === id)?.name ?? id;

  const rows = useMemo(() => {
    const all = plan.data?.rows ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((r) => (zoneFilter === 'all' || r.zone === zoneFilter) && (!q || r.field_id.toLowerCase().includes(q)));
  }, [plan.data, zoneFilter, query]);

  if (!config.pipeline) {
    return <div className="p-6 text-slate-300">{t('drawer.noData')}</div>;
  }

  const openOnMap = (zone: ZoneId, fieldId: string) => {
    setZone(zone);
    selectField(fieldId);
    window.location.hash = '/dashboard';
  };

  const m = metrics.data;
  const gain = m ? (100 * (m.persistence.mae - m.lightgbm.mae)) / m.persistence.mae : null;
  const week = config.pipeline.forecast_week;
  const zonesSummary = (plan.data?.zones ?? []).filter((z) => zoneFilter === 'all' || z.zone === zoneFilter);
  const totalM3 = zonesSummary.reduce((a, z) => a + z.demand_m3, 0);
  const nextCounts: Record<string, number> = {};
  for (const z of zonesSummary) for (const [k, v] of Object.entries(z.class_next)) nextCounts[k] = (nextCounts[k] ?? 0) + v;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 pb-10 sm:p-4">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
        <div className="chip w-fit border-slime-400/30 text-slime-200">
          <Sparkles size={12} /> {t('plan.kicker')} · {config.pipeline.model}
        </div>
        <h1 className="font-display text-3xl font-bold text-white">{t('plan.title', { week: fmtWeek(week, lang, true) })}</h1>
        <p className="max-w-4xl text-sm text-slate-300">{t('plan.lead')}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(['all', ...config.zones.map((z) => z.id)] as (ZoneId | 'all')[]).map((z) => (
            <button
              key={z}
              onClick={() => { setZoneFilter(z); setLimit(40); }}
              className={`rounded-xl border px-3 py-1.5 text-sm transition ${zoneFilter === z ? 'border-water-400/50 bg-water-500/20 text-white' : 'border-white/10 text-slate-400 hover:text-white'}`}
            >
              {z === 'all' ? t('plan.allZones') : zoneName(z)}
            </button>
          ))}
        </div>
      </motion.header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TiltCard>
          <div className="glass h-full p-4">
            <div className="label flex items-center gap-1.5"><Droplets size={12} /> {t('plan.total')}</div>
            <div className="mt-1 font-display text-3xl font-bold text-water-200">
              {plan.data ? <AnimatedNumber value={totalM3} lang={lang} suffix=" m³" /> : '…'}
            </div>
            <div className="text-xs text-slate-400">{zonesSummary.reduce((a, z) => a + z.fields, 0)} {t('plan.fields')}</div>
          </div>
        </TiltCard>
        <TiltCard>
          <div className="glass h-full p-4">
            <div className="label">{t('plan.classesNext')}</div>
            <div className="mt-3"><ClassBar counts={nextCounts} colors={colors} /></div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
              {[0, 1, 2, 3].map((c) => (
                <span key={c} className="flex items-center gap-1" style={{ color: colors[c] }}>
                  <ClassIcon cls={c as StressClass} size={11} /> {nextCounts[String(c)] ?? 0}
                </span>
              ))}
            </div>
          </div>
        </TiltCard>
        <TiltCard>
          <div className="glass h-full p-4">
            <div className="label flex items-center gap-1.5"><BrainCircuit size={12} /> {t('plan.mae')}</div>
            <div className="mt-1 font-display text-3xl font-bold text-white">{m ? fmtNumber(m.lightgbm.mae, lang, 4) : '…'}</div>
            <div className="text-xs text-emerald-300">{gain !== null ? `${fmtNumber(gain, lang, 1)} % ${t('plan.gain')}` : ''}</div>
          </div>
        </TiltCard>
        <TiltCard>
          <div className="glass h-full p-4">
            <div className="label">R²</div>
            <div className="mt-1 font-display text-3xl font-bold text-white">{m ? fmtNumber(m.lightgbm.r2, lang, 3) : '…'}</div>
            <div className="text-xs text-slate-400">{m ? t('plan.trainTest', { train: fmtNumber(m.n_train, lang), test: fmtNumber(m.n_test, lang) }) : ''}</div>
          </div>
        </TiltCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {zonesSummary.map((z) => (
          <Panel key={z.zone} title={zoneName(z.zone)} icon={<MapPin size={14} />}>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-2xl font-bold text-water-200">{fmtNumber(z.demand_m3, lang)} m³</span>
              <span className="text-xs text-slate-400">{z.fields} {t('plan.fields')} · {fmtNumber(z.area_ha, lang)} {t('common.ha')}</span>
            </div>
            <div className="mt-2 space-y-1.5 text-[11px] text-slate-400">
              <div>{t('plan.col.now')}<ClassBar counts={z.class_now} colors={colors} /></div>
              <div>{t('plan.col.next')}<ClassBar counts={z.class_next} colors={colors} /></div>
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <span className="flex items-center gap-1 text-red-300"><TrendingDown size={12} /> {z.worsening} {t('plan.worsening')}</span>
              <span className="flex items-center gap-1 text-emerald-300"><TrendingUp size={12} /> {z.improving} {t('plan.improving')}</span>
            </div>
          </Panel>
        ))}
      </div>

      <Panel
        title={t('plan.table')}
        icon={<CalendarCheck size={14} />}
        actions={
          <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs">
            <Search size={12} className="text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('plan.search')} className="w-36 bg-transparent text-slate-100 outline-none" />
          </label>
        }
      >
        {plan.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pe-2">{t('plan.col.field')}</th>
                  <th className="pe-2">{t('nav.zone')}</th>
                  <th className="pe-2 text-right">{t('plan.col.area')}</th>
                  <th className="pe-2">{t('plan.col.now')}</th>
                  <th className="pe-2">{t('plan.col.next')}</th>
                  <th className="pe-2 text-right">{t('plan.col.ndmi')}</th>
                  <th className="pe-2 text-right">{t('plan.col.z')}</th>
                  <th className="pe-2 text-right">{t('plan.col.demand')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => (
                  <tr key={r.field_id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="py-1.5 pe-2 font-mono text-xs text-white">{r.field_id}</td>
                    <td className="pe-2 text-slate-300">{zoneName(r.zone)}</td>
                    <td className="pe-2 text-right text-slate-300">{fmtNumber(r.area_ha, lang, 1)}</td>
                    <td className="pe-2"><Badge cls={r.class_now} colors={colors} /></td>
                    <td className="pe-2"><Badge cls={r.class_next} colors={colors} /></td>
                    <td className="pe-2 text-right font-mono text-xs text-slate-300">
                      {fmtNumber(r.ndmi, lang, 3)} → {fmtNumber(r.pred_ndmi_next, lang, 3)}
                    </td>
                    <td className="pe-2 text-right font-mono text-xs text-slate-300">{fmtNumber(r.z_next, lang, 2)}</td>
                    <td className="pe-2 text-right font-semibold text-water-200">{fmtNumber(r.demand_m3, lang)}</td>
                    <td className="text-right">
                      <button onClick={() => openOnMap(r.zone, r.field_id)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" title={t('plan.openMap')} aria-label={t('plan.openMap')}>
                        <MapPin size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <button onClick={() => setLimit(limit + 80)} className="mt-2 rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:text-white">
                {t('plan.showMore')} ({rows.length - limit})
              </button>
            )}
          </div>
        )}
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={t('plan.metrics')} icon={<BarChart3 size={14} />}>
          {!m ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-3 text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400">
                    <th />
                    <th className="text-right">MAE</th>
                    <th className="text-right">RMSE</th>
                    <th className="text-right">R²</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {([['LightGBM', m.lightgbm], [t('plan.persistence'), m.persistence], [t('plan.seasonal'), m.seasonal]] as const).map(([name, s]) => (
                    <tr key={name} className="border-t border-white/5">
                      <td className="py-1 font-sans text-slate-200">{name}</td>
                      <td className="text-right">{fmtNumber(s.mae, lang, 4)}</td>
                      <td className="text-right">{fmtNumber(s.rmse, lang, 4)}</td>
                      <td className="text-right">{fmtNumber(s.r2, lang, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m['drops_gt_0.05'] && (
                <p className="text-xs text-slate-300">
                  {t('plan.drops', { n: fmtNumber(m['drops_gt_0.05'].n, lang) })} : MAE {fmtNumber(m['drops_gt_0.05'].lightgbm.mae, lang, 3)} vs {fmtNumber(m['drops_gt_0.05'].persistence.mae, lang, 3)} ({t('plan.persistence').toLowerCase()})
                </p>
              )}
              {m.leave_one_zone_out && (
                <div>
                  <div className="label mb-1">{t('plan.lozo')}</div>
                  {Object.entries(m.leave_one_zone_out).map(([z, v]) => (
                    <div key={z} className="flex justify-between border-t border-white/5 py-1 text-xs">
                      <span className="text-slate-200">{zoneName(z)}</span>
                      <span className="font-mono text-slate-300">MAE {fmtNumber(v.lightgbm.mae, lang, 4)} vs {fmtNumber(v.persistence.mae, lang, 4)}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.stress_thresholds_z && (
                <div className="text-xs text-slate-300">
                  <span className="label me-2">{t('plan.thresholds')}</span>
                  <span style={{ color: colors[1] }}>z &lt; {m.stress_thresholds_z.jaune}</span> ·{' '}
                  <span style={{ color: colors[2] }}>z &lt; {m.stress_thresholds_z.orange}</span> ·{' '}
                  <span style={{ color: colors[3] }}>z &lt; {m.stress_thresholds_z.rouge}</span>
                </div>
              )}
            </div>
          )}
        </Panel>
        <Panel title={t('plan.features')} icon={<BrainCircuit size={14} />}>
          {!m ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-1">
              {m.feature_importance.map((f) => (
                <div key={f.feature} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 truncate font-mono text-slate-300">{f.feature}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-gradient-to-r from-water-500 to-slime-400" style={{ width: `${Math.min(100, (100 * f.share) / (m.feature_importance[0]?.share || 1))}%` }} />
                  </div>
                  <span className="w-12 text-right text-slate-400">{fmtNumber(100 * f.share, lang, 1)} %</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {m && m.figures.length > 0 && (
        <Panel title={t('plan.figures')} icon={<ImageIcon size={14} />}>
          <div className="grid gap-3 md:grid-cols-2">
            {m.figures.map((f) => (
              <a key={f} href={`/api/model/figures/${f}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-white/10 bg-paper">
                <img src={`/api/model/figures/${f}`} alt={f} loading="lazy" className="w-full" />
              </a>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
