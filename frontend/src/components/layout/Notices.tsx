import { FlaskConical, Info, Satellite } from 'lucide-react';
import { useLang } from '../../i18n';
import type { PipelineInfo } from '../../types';
import { fmtWeek } from '../WeeklyChart';
import { useT } from '../../i18n';

/** Always-visible notice while mock data is in use (config.data_source === "synthetic"). */
export function SyntheticBanner() {
  const t = useT();
  return (
    <div
      role="status"
      className="relative z-20 flex items-center gap-2 overflow-hidden border-b border-amber-400/20 bg-gradient-to-r from-amber-500/15 via-amber-400/10 to-transparent px-3 py-1.5 text-xs text-amber-100 sm:px-4"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2 py-0.5 font-bold uppercase tracking-wider text-amber-200">
        <FlaskConical size={12} />
        {t('notice.synthetic.title')}
      </span>
      <span className="truncate">{t('notice.synthetic.body')}</span>
    </div>
  );
}

/** Shown when data/ holds the real pipeline output (config.data_source === "pipeline"). */
export function RealDataBanner({ info }: { info: PipelineInfo }) {
  const t = useT();
  const lang = useLang();
  return (
    <div
      role="status"
      className="relative z-20 flex items-center gap-2 overflow-hidden border-b border-emerald-400/20 bg-gradient-to-r from-emerald-500/15 via-emerald-400/10 to-transparent px-3 py-1.5 text-xs text-emerald-100 sm:px-4"
    >
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/20 px-2 py-0.5 font-bold uppercase tracking-wider text-emerald-200">
        <Satellite size={12} />
        {t('notice.real.title')}
      </span>
      <span className="truncate">
        {t('notice.real.body', { state: fmtWeek(info.state_week, lang, true), next: fmtWeek(info.forecast_week, lang, true) })}
      </span>
    </div>
  );
}

export function Footer() {
  const t = useT();
  return (
    <footer className="relative z-20 flex items-start gap-2 border-t border-white/5 bg-ink-950/80 px-3 py-1.5 text-[11px] text-slate-400 backdrop-blur sm:px-4">
      <Info size={12} className="mt-0.5 shrink-0 text-water-300" />
      <p className="line-clamp-2">
        {t('notice.forecast')} {t('notice.modeled')}
      </p>
    </footer>
  );
}
