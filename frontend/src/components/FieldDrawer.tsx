import { AnimatePresence, motion } from 'framer-motion';
import { Droplets, Mountain, Ruler, X } from 'lucide-react';
import { useConfig, useFieldWeekly, useTimeseries } from '../api/hooks';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { formatMonth } from '../lib/months';
import type { FieldCollection, StressClass } from '../types';
import { ClassIcon, NA_COLOR } from './ClassIcon';
import { NdmiChart } from './NdmiChart';
import { Skeleton } from './ui/primitives';
import { fmtWeek, WeeklyChart } from './WeeklyChart';

function ClassBadge({ cls, colors, label }: { cls: StressClass | null; colors: string[]; label?: string }) {
  const t = useT();
  const color = cls === null ? NA_COLOR : colors[cls];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ borderColor: `${color}88`, background: `${color}22`, color }}>
      <ClassIcon cls={cls} size={12} />
      {label && <span className="text-slate-300">{label}</span>}
      {cls === null ? t('class.na') : t(`class.${cls}` as 'class.0')}
    </span>
  );
}

export function FieldDrawer({ fieldId, fields, colors, month, onClose }: { fieldId: string | null; fields?: FieldCollection; colors: string[]; month: string; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const ts = useTimeseries(fieldId);
  const props = fields?.features.find((f) => f.properties.field_id === fieldId)?.properties;
  const forecast = ts.data?.points.filter((p) => p.status_type === 'forecast') ?? [];
  const pipeline = useConfig().data?.pipeline;
  const weekly = useFieldWeekly(fieldId, Boolean(pipeline));
  const nxt = weekly.data?.next;

  return (
    <AnimatePresence>
      {fieldId && (
        <motion.aside
          key="drawer"
          initial={{ opacity: 0, x: 60, rotateY: -12 }}
          animate={{ opacity: 1, x: 0, rotateY: 0 }}
          exit={{ opacity: 0, x: 60, rotateY: -12 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
          style={{ transformPerspective: 1200 }}
          className="glass-strong thin-scroll fixed inset-x-2 bottom-2 z-[600] max-h-[72vh] overflow-y-auto p-4 lg:absolute lg:inset-x-auto lg:bottom-3 lg:end-3 lg:top-3 lg:max-h-none lg:w-[430px]"
          aria-label={fieldId}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="label">{props?.is_irrigated ? t('drawer.irrigated') : t('drawer.rainfed')}</div>
              <h3 className="font-display text-2xl font-bold text-white">{fieldId}</h3>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" aria-label={t('drawer.close')}>
              <X size={18} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 p-2">
              <Ruler size={14} className="mx-auto text-slate-400" />
              <div className="text-sm font-bold text-white">{props ? fmtNumber(props.area_ha, lang, 1) : '–'} {t('common.ha')}</div>
              <div className="text-[10px] text-slate-400">{t('drawer.area')}</div>
            </div>
            <div className="rounded-xl bg-white/5 p-2">
              <Mountain size={14} className="mx-auto text-slate-400" />
              <div className="text-sm font-bold text-white">{props?.stress_score !== null && props?.stress_score !== undefined ? fmtNumber(props.stress_score, lang, 2) : '–'}</div>
              <div className="text-[10px] text-slate-400">{t('drawer.stress')}</div>
            </div>
            <div className="rounded-xl bg-white/5 p-2">
              <Droplets size={14} className="mx-auto text-water-300" />
              <div className="text-sm font-bold text-white">{props?.demand_score !== null && props?.demand_score !== undefined ? fmtNumber(props.demand_score, lang, 2) : '–'}</div>
              <div className="text-[10px] text-slate-400">{t('drawer.demand')}</div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {t('drawer.current')} · {formatMonth(month, lang, 'long')}
              {props && <ClassBadge cls={props.is_irrigated ? props.stress_class : null} colors={colors} />}
            </div>
            {props?.is_irrigated && forecast.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-slate-400">{t('drawer.outlook')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {forecast.map((p) => (
                    <ClassBadge key={p.month} cls={p.stress_class} colors={colors} label={pipeline ? t('ctrl.nextWeek') : formatMonth(p.month, lang)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {pipeline && nxt && (
            <div className="mt-3 rounded-xl border border-violet-400/25 bg-violet-500/10 p-3">
              <div className="text-xs text-violet-200">{t('weekly.next', { week: fmtWeek(nxt.week, lang) })}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <ClassBadge cls={nxt.class_now} colors={colors} label={t('plan.col.now')} />
                <span className="text-slate-400">→</span>
                <ClassBadge cls={nxt.class_next} colors={colors} label={t('plan.col.next')} />
                <span className="ms-auto text-sm font-bold text-water-200">
                  {fmtNumber(nxt.demand_m3, lang, 0)} m³
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                NDMI → {fmtNumber(nxt.pred_ndmi_next, lang, 3)} · z {fmtNumber(nxt.z_next, lang, 2)} · ET0 {fmtNumber(nxt.et0_next_mm, lang, 1)} mm · {t('weekly.demand')}
              </div>
            </div>
          )}

          {pipeline && (
            <div className="mt-4">
              <div className="label mb-1">{t('weekly.title')}</div>
              {weekly.isLoading ? (
                <Skeleton className="h-[230px]" />
              ) : weekly.data ? (
                <WeeklyChart points={weekly.data.points} colors={colors} />
              ) : (
                <p className="text-sm text-slate-400">{t('drawer.noData')}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-water-400" />{t('weekly.obs')}</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-yellow-400" />{t('weekly.pred')}</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-slate-400/30" />{t('weekly.normal')}</span>
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="label mb-1">{t('drawer.chart')}</div>
            {ts.isLoading ? (
              <Skeleton className="h-[260px]" />
            ) : ts.data && ts.data.points.length ? (
              <NdmiChart points={ts.data.points} colors={colors} currentMonth={month} />
            ) : (
              <p className="text-sm text-slate-400">{t('drawer.noData')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-water-400" />{t('drawer.obs')}</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-slime-400" />{t('drawer.pred')}</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-4 rounded-sm bg-slate-400/30" />{t('drawer.normal')}</span>
              <span>{t('drawer.classBands')}</span>
            </div>
            <p className="mt-2 text-[11px] text-violet-200/80">{t('notice.forecast')}</p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
