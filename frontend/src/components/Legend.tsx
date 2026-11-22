import { useT } from '../i18n';
import type { StressClass } from '../types';
import { ClassIcon, Swatch } from './ClassIcon';

/** Four classes (colour + pattern + icon + words), unclassified land, canal and source symbols. */
export function Legend({ colors, patterns, showBlocked = false, compact = false }: { colors: string[]; patterns: boolean; showBlocked?: boolean; compact?: boolean }) {
  const t = useT();
  const classes: (StressClass | null)[] = [0, 1, 2, 3, null];
  return (
    <div className="space-y-1.5">
      {classes.map((c) => (
        <div key={String(c)} className="flex items-center gap-2">
          <Swatch cls={c} patterns={patterns} colors={colors} />
          <ClassIcon cls={c} size={13} className="shrink-0 text-slate-300" />
          <div className="min-w-0 leading-tight">
            <span className="text-xs font-semibold text-slate-100">{c === null ? t('class.na') : t(`class.${c}` as 'class.0')}</span>
            {!compact && (
              <span className="block truncate text-[11px] text-slate-400">{c === null ? t('class.na.desc') : t(`class.${c}.desc` as 'class.0.desc')}</span>
            )}
          </div>
        </div>
      ))}
      <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2 text-[11px] text-slate-400">
        <div className="flex items-center gap-2">
          <svg width="34" height="10" aria-hidden>
            <line x1="2" y1="5" x2="32" y2="5" stroke="#38bdf8" strokeWidth="6" strokeLinecap="round" opacity="0.9" />
            <line x1="2" y1="5" x2="32" y2="5" stroke="#f0f9ff" strokeWidth="2" strokeDasharray="3 6" />
          </svg>
          {t('legend.network')}
        </div>
        <div className="flex items-center gap-2">
          <span className="ms-2 me-3 inline-block h-3 w-3 rounded-full bg-water-400 shadow-glow" />
          {t('legend.source')}
        </div>
        {showBlocked && (
          <div className="flex items-center gap-2">
            <svg width="34" height="10" aria-hidden>
              <line x1="2" y1="5" x2="32" y2="5" stroke="#f87171" strokeWidth="3" strokeDasharray="6 5" />
            </svg>
            {t('legend.blocked')}
          </div>
        )}
      </div>
    </div>
  );
}
