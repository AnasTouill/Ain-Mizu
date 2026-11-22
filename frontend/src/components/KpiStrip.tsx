import { Activity, Droplets, Sun, Waypoints } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import type { ClassLabel, Kpis, NetworkMetrics, StatusType } from '../types';
import { ClassIcon } from './ClassIcon';
import { AnimatedNumber, Ring, Skeleton, TiltCard } from './ui/primitives';

const KEYS: ClassLabel[] = ['green', 'yellow', 'orange', 'red'];

function Card({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <TiltCard className="h-full">
      <div className="glass relative h-full overflow-hidden p-3.5">
        <div className="pointer-events-none absolute -end-10 -top-10 h-28 w-28 rounded-full blur-2xl" style={{ background: accent, opacity: 0.18 }} />
        {children}
      </div>
    </TiltCard>
  );
}

export function KpiStrip({ kpis, metrics, status, colors, loading }: { kpis?: Kpis; metrics?: NetworkMetrics; status: StatusType; colors: string[]; loading?: boolean }) {
  const t = useT();
  const lang = useLang();
  if (!kpis || loading) {
    return (
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className={`h-[104px] ${i === 0 ? 'col-span-2 xl:col-span-1' : ''}`} />
        ))}
      </div>
    );
  }
  const total = KEYS.reduce((s, k) => s + kpis.fields_by_class[k], 0) || 1;
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      <div className="col-span-2 xl:col-span-1">
        <Card accent="#2e9e4f">
          <div className="label mb-2">{t('kpi.fields')}</div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-white/5">
            {KEYS.map((k, i) => (
              <div key={k} className="h-full transition-all duration-700" style={{ width: `${(kpis.fields_by_class[k] / total) * 100}%`, background: colors[i] }} />
            ))}
          </div>
          <div className="mt-2.5 grid grid-cols-4 gap-1">
            {KEYS.map((k, i) => (
              <div key={k} className="text-center" title={`${t(`class.${i}` as 'class.0')}: ${t(`class.${i}.desc` as 'class.0.desc')}`}>
                <div className="flex items-center justify-center gap-1 text-base font-bold" style={{ color: colors[i] }}>
                  <ClassIcon cls={i as 0} size={12} />
                  <AnimatedNumber value={kpis.fields_by_class[k]} lang={lang} />
                </div>
                <div className="text-[10px] text-slate-400">
                  {fmtNumber(kpis.hectares_by_class[k], lang, 0)} {t('common.ha')}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card accent="#38bdf8">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Ring value={kpis.water_saved_pct_vs_equal_split} color="#38bdf8" />
            <Droplets size={18} className="absolute inset-0 m-auto text-water-300" />
          </div>
          <div className="min-w-0">
            <div className="label">{t('kpi.waterSaved')}</div>
            <div className="font-display text-2xl font-bold text-white text-glow">
              <AnimatedNumber value={kpis.water_saved_pct_vs_equal_split} lang={lang} digits={0} suffix=" %" />
            </div>
            <div className="text-[11px] text-slate-400">{t('kpi.waterSaved.sub')}</div>
          </div>
        </div>
      </Card>
      <Card accent="#facc15">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Ring value={kpis.solar_share_pct} color="#facc15" />
            <Sun size={18} className="absolute inset-0 m-auto text-slime-300" />
          </div>
          <div className="min-w-0">
            <div className="label">{t('kpi.solar')}</div>
            <div className="font-display text-2xl font-bold text-white text-glow-gold">
              <AnimatedNumber value={kpis.solar_share_pct} lang={lang} suffix=" %" />
            </div>
            <div className="text-[11px] text-slate-400">{t('kpi.solar.sub')}</div>
          </div>
        </div>
      </Card>
      <Card accent="#a78bfa">
        <div className="label flex items-center gap-1.5">
          <Activity size={12} /> {t('kpi.mae')}
        </div>
        <div className="mt-1 font-display text-2xl font-bold text-white">
          <AnimatedNumber value={kpis.forecast_mae_ndmi} lang={lang} digits={3} />
        </div>
        <div className="text-[11px] text-slate-400">{status === 'current' ? t('kpi.mae.sub') : t('kpi.mae.subForecast')}</div>
      </Card>
      <Card accent="#0ea5e9">
        <div className="label flex items-center gap-1.5">
          <Waypoints size={12} /> {t('kpi.network')}
        </div>
        <div className="mt-1 font-display text-2xl font-bold text-white">
          {metrics ? <AnimatedNumber value={metrics.total_length_m / 1000} lang={lang} digits={1} suffix=" km" /> : '–'}
        </div>
        <div className="text-[11px] text-slate-400">
          {metrics ? t('kpi.network.sub', { served: metrics.fields_served, res: fmtNumber(metrics.resilience_score, lang, 2) }) : ''}
        </div>
      </Card>
    </div>
  );
}
