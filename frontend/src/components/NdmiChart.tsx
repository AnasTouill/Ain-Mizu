import { useMemo } from 'react';
import { Area, Bar, Brush, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useConfig } from '../api/hooks';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { formatMonth } from '../lib/months';
import type { TimeseriesPoint } from '../types';

interface Row {
  month: string;
  obs: number | null;
  pred: number | null;
  range: [number, number] | null;
  band: number;
  cls: number | null;
  forecast: boolean;
}

/** NDMI observed vs predicted, with the field's normal range, monthly class bands and the forecast zone. */
export function NdmiChart({ points, colors, currentMonth }: { points: TimeseriesPoint[]; colors: string[]; currentMonth?: string }) {
  const t = useT();
  const lang = useLang();
  const fcKey = useConfig().data?.pipeline?.forecast_month_key;
  const label = (m: string, style?: 'long') => (m === fcKey ? t('ctrl.nextWeek') : formatMonth(m, lang, style));

  const rows = useMemo<Row[]>(() => {
    const byCal = new Map<number, number[]>();
    for (const p of points) {
      if (p.status_type !== 'current' || p.ndmi_obs === null) continue;
      const m = Number(p.month.slice(5, 7));
      if (!byCal.has(m)) byCal.set(m, []);
      byCal.get(m)!.push(p.ndmi_obs);
    }
    const normal = new Map<number, [number, number]>();
    for (const [m, xs] of byCal) {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      normal.set(m, [+(mean - sd).toFixed(3), +(mean + sd).toFixed(3)]);
    }
    return points.map((p) => ({
      month: p.month,
      obs: p.ndmi_obs,
      pred: p.ndmi_pred,
      range: normal.get(Number(p.month.slice(5, 7))) ?? null,
      band: 1,
      cls: p.stress_class,
      forecast: p.status_type === 'forecast',
    }));
  }, [points]);

  const firstForecast = rows.find((r) => r.forecast)?.month;
  const start = Math.max(0, rows.length - 40);

  return (
    <div dir="ltr" className="h-[260px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={0}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m: string) => label(m)} minTickGap={24} />
          <YAxis yAxisId="ndmi" tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} />
          <YAxis yAxisId="band" hide domain={[0, 1]} />
          <Bar yAxisId="band" dataKey="band" isAnimationActive={false} legendType="none">
            {rows.map((r) => (
              <Cell key={r.month} fill={r.cls === null ? 'transparent' : colors[r.cls]} fillOpacity={r.forecast ? 0.3 : 0.13} />
            ))}
          </Bar>
          <Area yAxisId="ndmi" dataKey="range" stroke="none" fill="#94a3b8" fillOpacity={0.16} isAnimationActive={false} name={t('drawer.normal')} />
          <Line yAxisId="ndmi" dataKey="obs" stroke="#38bdf8" strokeWidth={2} dot={false} connectNulls={false} name={t('drawer.obs')} />
          <Line yAxisId="ndmi" dataKey="pred" stroke="#facc15" strokeWidth={1.6} strokeDasharray="5 4" dot={false} name={t('drawer.pred')} />
          {firstForecast && (
            <ReferenceLine yAxisId="ndmi" x={firstForecast} stroke="#c4b5fd" strokeDasharray="4 3" label={{ value: t('drawer.forecastZone'), fill: '#c4b5fd', fontSize: 10, position: 'insideTopRight' }} />
          )}
          {currentMonth && <ReferenceLine yAxisId="ndmi" x={currentMonth} stroke="rgba(255,255,255,0.5)" />}
          <Tooltip
            contentStyle={{ background: 'rgba(7,12,24,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 }}
            labelFormatter={(m: string) => label(m, 'long')}
            formatter={(v: unknown, name: string) => {
              if (Array.isArray(v)) return [`${fmtNumber(v[0], lang, 2)} – ${fmtNumber(v[1], lang, 2)}`, name];
              if (typeof v === 'number' && name !== 'band') return [fmtNumber(v, lang, 3), name];
              return [null, null] as unknown as [string, string];
            }}
          />
          <Brush dataKey="month" height={16} startIndex={start} stroke="#38bdf8" fill="rgba(7,12,24,0.8)" travellerWidth={8} tickFormatter={(m: string) => m.slice(0, 4)} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
