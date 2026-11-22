import { useQuery } from '@tanstack/react-query';
import { GeoJSON } from 'react-leaflet';
import { api } from '../../api/client';
import { useT } from '../../i18n';

/** Obstacles used by the farm routing: built-up (blocked), water bodies (blocked), roads (costly to
 * cross), existing canals (cheap to follow). Cached offline by backend/scripts/build_terrain.py. */
export function ObstacleLayer({ zone, bbox }: { zone: string; bbox: number[] }) {
  const q = useQuery({
    queryKey: ['terrain', zone, bbox.map((v) => v.toFixed(4)).join(',')],
    queryFn: () => api.terrain(zone, bbox),
    staleTime: Infinity,
    enabled: bbox.length === 4,
  });
  if (!q.data) return null;
  const k = bbox.join(',');
  return (
    <>
      <GeoJSON key={`b${k}`} data={q.data.builtup} style={{ color: '#f87171', weight: 1, dashArray: '3 3', fillColor: '#ef4444', fillOpacity: 0.35 }} interactive={false} />
      <GeoJSON key={`w${k}`} data={q.data.water} style={{ color: '#60a5fa', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.4 }} interactive={false} />
      <GeoJSON key={`r${k}`} data={q.data.roads} style={{ color: '#e2e8f0', weight: 2, opacity: 0.75 }} interactive={false} />
      <GeoJSON key={`c${k}`} data={q.data.canals} style={{ color: '#22d3ee', weight: 3.5, opacity: 0.9, dashArray: '8 5' }} interactive={false} />
    </>
  );
}

export function ObstacleLegend() {
  const t = useT();
  return (
    <div className="space-y-1 text-[11px] text-slate-300">
      <div className="flex items-center gap-2"><span className="h-3 w-4 rounded-sm border border-dashed border-red-400 bg-red-500/40" /> {t('obs.built')}</div>
      <div className="flex items-center gap-2"><span className="h-0.5 w-4 bg-slate-200" /> {t('obs.road')}</div>
      <div className="flex items-center gap-2"><span className="h-0 w-4 border-t-2 border-dashed border-cyan-400" /> {t('obs.canal')}</div>
      <div className="text-[10px] text-slate-500">Copernicus DEM · ESA WorldCover · © OpenStreetMap</div>
    </div>
  );
}
