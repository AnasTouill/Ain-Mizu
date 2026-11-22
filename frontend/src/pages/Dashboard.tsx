import { useQueryClient } from '@tanstack/react-query';
import { Loader2, MapPin } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { api } from '../api/client';
import { qk, useFields, useKpis, useNetwork } from '../api/hooks';
import { LayerToggles, MonthSlider, StatusToggle } from '../components/Controls';
import { FieldDrawer } from '../components/FieldDrawer';
import { KpiStrip } from '../components/KpiStrip';
import { Legend } from '../components/Legend';
import { MapView } from '../components/map/MapView';
import { Skeleton } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { formatMonth, monthRange } from '../lib/months';
import { useFieldTooltip, useZoneContext } from '../lib/useZoneContext';
import { useAppStore } from '../store/useAppStore';

const Zone3D = lazy(() => import('../components/three/Zone3D'));

export default function Dashboard() {
  const t = useT();
  const lang = useLang();
  const qc = useQueryClient();
  const { config, zone, zoneCfg, zoneInfo, month, horizon, effMonth, status, lastObserved } = useZoneContext();
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const patterns = useAppStore((s) => s.patterns);
  const setPatterns = useAppStore((s) => s.setPatterns);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setMonth = useAppStore((s) => s.setMonth);
  const setHorizon = useAppStore((s) => s.setHorizon);
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const selectedFieldId = useAppStore((s) => s.selectedFieldId);
  const selectField = useAppStore((s) => s.selectField);
  const colors = config.class_colors;

  const months = useMemo(() => monthRange(config.months.first_observed, lastObserved), [config.months.first_observed, lastObserved]);
  const fields = useFields(zone, effMonth, status);
  const network = useNetwork(zone, effMonth);
  const kpis = useKpis(zone, effMonth);
  const fieldTooltip = useFieldTooltip(colors);

  // time-lapse: advance one month every 0.9 s and prefetch the next one
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const cur = useAppStore.getState().month;
      const i = months.indexOf(cur);
      if (i < 0 || i >= months.length - 1) {
        setPlaying(false);
        return;
      }
      setMonth(months[i + 1]);
      const next = months[i + 2];
      if (next) {
        qc.prefetchQuery({ queryKey: qk.fields(zone, next, 'current'), queryFn: () => api.fields(zone, next, 'current') });
        qc.prefetchQuery({ queryKey: qk.network(zone, next), queryFn: () => api.network(zone, next) });
      }
    }, 900);
    return () => window.clearInterval(id);
  }, [playing, months, zone, qc, setMonth, setPlaying]);

  const togglePlay = () => {
    if (!playing && months.indexOf(month) >= months.length - 1) setMonth(months[0]);
    setPlaying(!playing);
  };

  return (
    <div className="flex min-h-full flex-col gap-3 p-3 lg:h-full lg:flex-row">
      <aside className="glass thin-scroll flex shrink-0 flex-col gap-5 p-4 lg:w-[330px] lg:overflow-y-auto">
        <div className="flex items-center gap-2">
          <MapPin size={18} className="text-slime-400" />
          <div>
            <div className="font-display text-xl font-bold text-white">{zoneCfg.name}</div>
            {zoneInfo && (
              <div className="text-xs text-slate-400">
                {zoneInfo.field_count} {t('common.fields')} · {zoneInfo.irrigated_count} {t('drawer.irrigated').toLowerCase()}
              </div>
            )}
          </div>
        </div>
        <MonthSlider months={months} value={month} onChange={setMonth} disabled={horizon > 0} playing={playing} onTogglePlay={togglePlay} />
        {horizon > 0 && <p className="-mt-3 text-[11px] text-slate-400">{t('ctrl.sliderLocked')}</p>}
        <StatusToggle horizon={horizon} onChange={setHorizon} lastObserved={lastObserved} maxHorizon={config.months.forecast_horizon} />
        <LayerToggles layers={layers} toggle={toggleLayer} patterns={patterns} setPatterns={setPatterns} view={view} setView={setView} />
        <div>
          <div className="label mb-2">{t('legend.title')}</div>
          <Legend colors={colors} patterns={patterns} />
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="glass relative h-[62vh] min-h-[380px] overflow-hidden lg:h-auto lg:flex-1">
          {fields.isLoading && !fields.data ? (
            <Skeleton className="h-full rounded-none" />
          ) : view === '2d' ? (
            <MapView
              zone={zone}
              center={zoneCfg.center}
              bbox={zoneInfo?.bbox}
              layers={layers}
              colors={colors}
              patterns={patterns}
              fields={fields.data}
              network={network.data}
              selectedFieldId={selectedFieldId}
              onFieldClick={selectField}
              fieldTooltip={fieldTooltip}
              sourceLabel={t('legend.source')}
            />
          ) : (
            <Suspense fallback={<Skeleton className="h-full rounded-none" />}>
              <Zone3D
                fields={layers.fields ? fields.data : undefined}
                network={layers.network ? network.data : undefined}
                showSources={layers.sources}
                center={zoneCfg.center}
                colors={colors}
                selectedId={selectedFieldId}
                onSelect={selectField}
                hint={t('view.3dHint')}
              />
            </Suspense>
          )}

          <div className="pointer-events-none absolute start-3 top-3 z-[500] flex flex-wrap items-center gap-2">
            <span
              className={`chip border-0 font-bold ${status === 'current' ? 'bg-water-500/25 text-water-200' : 'bg-violet-500/30 text-violet-100'}`}
            >
              {status === 'current' ? t('status.current') : t('status.forecast')}
            </span>
            <span className="chip bg-ink-950/80 font-display text-sm capitalize text-white">{formatMonth(effMonth, lang, 'long')}</span>
            {(fields.isFetching || network.isFetching) && (
              <span className="chip bg-ink-950/80">
                <Loader2 size={12} className="animate-spin" />
                {t('common.loading')}
              </span>
            )}
          </div>

          <FieldDrawer fieldId={selectedFieldId} fields={fields.data} colors={colors} month={effMonth} onClose={() => selectField(null)} />
        </div>
        <KpiStrip kpis={kpis.data} metrics={network.data?.metrics} status={status} colors={colors} loading={kpis.isLoading} />
      </section>
    </div>
  );
}
