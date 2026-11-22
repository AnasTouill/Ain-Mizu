import { ChevronLeft, ChevronRight, Grid3x3, Layers as LayersIcon, Map as MapIcon, Pause, Play, Satellite, Scissors, Waypoints, Droplet, Palette } from 'lucide-react';
import { useConfig } from '../api/hooks';
import { useLang, useT } from '../i18n';
import { addMonths, formatMonth } from '../lib/months';
import type { Horizon, Layers } from '../store/useAppStore';
import { Segmented, Toggle } from './ui/primitives';
import { fmtWeek } from './WeeklyChart';

/** Month slider (observed months) with play / step buttons and year ticks. */
export function MonthSlider({
  months,
  value,
  onChange,
  disabled,
  playing,
  onTogglePlay,
}: {
  months: string[];
  value: string;
  onChange: (m: string) => void;
  disabled?: boolean;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const idx = Math.max(0, months.indexOf(value));
  const last = months.length - 1;
  const fill = last > 0 ? (idx / last) * 100 : 0;
  const years = months
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.endsWith('-01') && Number(m.slice(0, 4)) % 2 === 0);
  const rtl = lang === 'ar';
  return (
    <div className={disabled ? 'opacity-60' : ''}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="label">{t('ctrl.month')}</span>
        <span className="font-display text-lg font-semibold capitalize text-white">{formatMonth(value, lang, 'long')}</span>
      </div>
      <input
        type="range"
        className="pg-range"
        min={0}
        max={last}
        value={idx}
        disabled={disabled}
        onChange={(e) => onChange(months[Number(e.target.value)])}
        style={{ ['--fill' as string]: `${fill}%` }}
        aria-label={t('ctrl.month')}
        aria-valuetext={formatMonth(value, lang, 'long')}
      />
      <div className="relative h-4 text-[10px] text-slate-500">
        {years.map(({ m, i }) => (
          <span
            key={m}
            className="absolute"
            style={{ [rtl ? 'right' : 'left']: `${(i / last) * 100}%`, transform: `translateX(${rtl ? '50%' : '-50%'})` }}
          >
            {m.slice(0, 4)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-ghost px-2" onClick={() => onChange(months[Math.max(0, idx - 1)])} disabled={disabled || idx === 0} aria-label={t('ctrl.prev')}>
          <ChevronLeft size={16} className="rtl:rotate-180" />
        </button>
        <button className={`${playing ? 'btn-ghost' : 'btn-primary'} flex-1`} onClick={onTogglePlay} disabled={disabled && !playing}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
          {playing ? t('ctrl.pause') : t('ctrl.play')}
        </button>
        <button className="btn-ghost px-2" onClick={() => onChange(months[Math.min(last, idx + 1)])} disabled={disabled || idx === last} aria-label={t('ctrl.next')}>
          <ChevronRight size={16} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}

/** Now / +1 / +2 / +3 months (forecast from the last observation). */
export function StatusToggle({ horizon, onChange, lastObserved, maxHorizon }: { horizon: Horizon; onChange: (h: Horizon) => void; lastObserved: string; maxHorizon: number }) {
  const t = useT();
  const lang = useLang();
  const opts = [0, 1, 2, 3].filter((h) => h <= maxHorizon) as Horizon[];
  const pipeline = useConfig().data?.pipeline;
  return (
    <div>
      <div className="mb-1.5 label">{t('ctrl.status')}</div>
      <Segmented
        layoutId="horizon-pill"
        ariaLabel={t('ctrl.status')}
        value={horizon}
        onChange={onChange}
        options={opts.map((h) => ({
          value: h,
          label: h === 0 ? t('ctrl.now') : pipeline ? t('ctrl.nextWeek') : t('ctrl.plus', { n: h }),
          title: h === 0 ? undefined : pipeline ? t('ctrl.nextWeekTitle', { week: fmtWeek(pipeline.forecast_week, lang) }) : formatMonth(addMonths(lastObserved, h), lang, 'long'),
        }))}
      />
      {horizon > 0 && (
        <p className="mt-2 rounded-lg border border-violet-400/20 bg-violet-500/10 px-2 py-1.5 text-[11px] text-violet-200">
          {pipeline
            ? t('ctrl.forecastWeek', { week: fmtWeek(pipeline.forecast_week, lang, true), state: fmtWeek(pipeline.state_week, lang, true) })
            : `${t('ctrl.forecastFrom', { month: formatMonth(lastObserved, lang, 'long') })} ${t('notice.forecast')}`}
        </p>
      )}
    </div>
  );
}

export function LayerToggles({ layers, toggle, patterns, setPatterns, view, setView }: {
  layers: Layers;
  toggle: (k: keyof Layers) => void;
  patterns: boolean;
  setPatterns: (v: boolean) => void;
  view: '2d' | '3d';
  setView: (v: '2d' | '3d') => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label flex items-center gap-1.5">
          <LayersIcon size={12} /> {t('ctrl.layers')}
        </span>
        <div className="w-36">
          <Segmented
            size="sm"
            layoutId="view-pill"
            value={view}
            onChange={setView}
            options={[
              { value: '2d', label: <><MapIcon size={12} />{t('view.2d')}</> },
              { value: '3d', label: <><Grid3x3 size={12} />{t('view.3d')}</> },
            ]}
          />
        </div>
      </div>
      <Toggle checked={layers.fields} onChange={() => toggle('fields')} label={t('layer.fields')} icon={<Grid3x3 size={15} />} />
      <Toggle checked={layers.network} onChange={() => toggle('network')} label={t('layer.network')} icon={<Waypoints size={15} />} />
      <Toggle checked={layers.sources} onChange={() => toggle('sources')} label={t('layer.sources')} icon={<Droplet size={15} />} />
      <Toggle checked={layers.pruned} onChange={() => toggle('pruned')} label={t('layer.pruned')} icon={<Scissors size={15} />} />
      <Toggle checked={layers.satellite} onChange={() => toggle('satellite')} label={t('layer.satellite')} icon={<Satellite size={15} />} />
      <Toggle checked={patterns} onChange={() => setPatterns(!patterns)} label={t('layer.patterns')} icon={<Palette size={15} />} />
    </div>
  );
}
