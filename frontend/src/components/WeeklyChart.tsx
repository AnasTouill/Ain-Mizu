import { useMemo } from 'react';
import { CHART, CHART_TIP } from '../lib/colors';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { LOCALES } from '../lib/months';
import type { Lang, WeeklyPoint } from '../types';

export function fmtWeek(week: string, lang: Lang, year = false): string {
  const d = new Date(`${week}T12:00:00`);
  return d.toLocaleDateString(LOCALES[lang], year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

/** Weekly NDMI of one field: observed images, interpolated line, LightGBM one-week-ahead prediction,
 * the field's weekly normal ±1σ, weekly class bands and next week's forecast. */
export function WeeklyChart({ points, colors }: { points: WeeklyPoint[]; colors: string[] }) {
  const t = useT();
  const lang = useLang();
  const rows = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        range: p.normal !== null && p.sd !== null ? [+(p.normal - p.sd).toFixed(4), +(p.normal + p.sd).toFixed(4)] : null,
        band: 1,
      })),
    [points],
  );
  const fc = rows.find((r) => r.forecast)?.week;
  return (
    <div dir="ltr" className="h-[230px] w-full">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={0}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={(w: string) => fmtWeek(w, lang)} minTickGap={28} />
          <YAxis yAxisId="ndmi" tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v: number) => v.toFixed(2)} />
          <YAxis yAxisId="band" hide domain={[0, 1]} />
          <Bar yAxisId="band" dataKey="band" isAnimationActive={false} legendType="none">
            {rows.map((r) => (
              <Cell key={r.week} fill={r.cls === null ? 'transparent' : colors[r.cls]} fillOpacity={r.forecast ? 0.35 : 0.13} />
            ))}
          </Bar>
          <Area yAxisId="ndmi" dataKey="range" stroke="none" fill={CHART.muted} fillOpacity={0.16} isAnimationActive={false} name={t('weekly.normal')} />
          <Line yAxisId="ndmi" dataKey="ndmi_interp" stroke={CHART.water} strokeOpacity={0.55} strokeWidth={1.5} dot={false} connectNulls name="NDMI" />
          <Scatter yAxisId="ndmi" dataKey="ndmi" fill={CHART.water} name={t('weekly.obs')} shape="circle" />
          <Line yAxisId="ndmi" dataKey="ndmi_pred" stroke={CHART.forecast} strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls name={t('weekly.pred')} />
          {fc && <ReferenceLine yAxisId="ndmi" x={fc} stroke={CHART.ref} strokeDasharray="4 3" label={{ value: t('ctrl.nextWeek'), fill: CHART.ref, fontSize: 10, position: 'insideTopLeft' }} />}
          <Tooltip
            contentStyle={CHART_TIP}
            labelFormatter={(w: string) => fmtWeek(w, lang, true)}
            formatter={(v: unknown, name: string) => {
              if (Array.isArray(v)) return [`${fmtNumber(v[0], lang, 3)} – ${fmtNumber(v[1], lang, 3)}`, name];
              if (typeof v === 'number' && name !== 'band') return [fmtNumber(v, lang, 3), name];
              return [null, null] as unknown as [string, string];
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
