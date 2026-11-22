import { useQuery } from '@tanstack/react-query';
import { BarChart3, Droplets, Leaf, Loader2, Sun, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { useConfig } from '../api/hooks';
import { optLabel } from '../components/onboarding/farmMap';
import { Panel } from '../components/ui/primitives';
import { useLang, useT } from '../i18n';
import { fmtNumber } from '../lib/format';
import { formatMonth } from '../lib/months';

const tip = { background: 'rgba(7,12,24,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function FarmStats() {
  const t = useT();
  const lang = useLang();
  const config = useConfig().data!;
  const colors = config.class_colors;
  const farms = useQuery({ queryKey: ['my-farms'], queryFn: api.myFarms });
  const farm = farms.data?.[farms.data.length - 1];
  const stats = useQuery({ queryKey: ['farm-stats', farm?.farm_id], queryFn: () => api.farmStats(farm!.farm_id), enabled: Boolean(farm) });
  const opts = useQuery({ queryKey: ['onboarding-options'], queryFn: api.onboardingOptions, staleTime: Infinity });
  const s = stats.data;
  if (!s) return <div className="grid h-full place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  const k = s.kpis;
  const labels = config.class_labels;
  const hist = s.class_history.map((h: any) => ({ month: h.month, forecast: h.forecast, ...Object.fromEntries(labels.map((l) => [l, Math.round(100 * (h.share_by_class[l] ?? 0))])) }));
  const fm = (m: string) => formatMonth(m, lang);
  const crop = (id: string) => optLabel(opts.data?.crops.find((c) => c.id === id), lang);

  const cards = [
    { icon: <Droplets size={16} />, v: `${fmtNumber(k.need_today_m3, lang)} m³`, l: t('stats.today'), sub: `${t('stats.nextWeek')} : ${fmtNumber(k.need_next_week_m3_day, lang)} m³/j` },
    { icon: <Leaf size={16} />, v: `${fmtNumber(k.water_saved_pct, lang, 1)} %`, l: t('stats.saved'), sub: `${fmtNumber(k.water_12m_m3 / 1000, lang)}k / ${fmtNumber(k.baseline_12m_m3 / 1000, lang)}k m³ (12 ${t('stats.months')})` },
    { icon: <Sun size={16} />, v: `${fmtNumber(k.solar_share_pct, lang, 1)} %`, l: t('stats.solar'), sub: `${fmtNumber(k.pump_kwh_12m / 1000, lang)} MWh ${t('stats.pumping')}` },
    { icon: k.worsening_next > k.improving_next ? <TrendingDown size={16} /> : <TrendingUp size={16} />, v: `${k.worsening_next} ↘ · ${k.improving_next} ↗`, l: t('stats.outlook'), sub: t('stats.outlookSub') },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3 p-3 pb-10">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-white"><BarChart3 className="text-water-300" /> {t('nav.stats')} · {farm?.name}</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.l} className="glass p-4">
            <div className="label flex items-center gap-1.5">{c.icon} {c.l}</div>
            <div className="mt-1 font-display text-2xl font-bold text-white">{c.v}</div>
            <div className="text-xs text-slate-400">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={t('stats.classHistory')}>
          <div dir="ltr" className="h-64">
            <ResponsiveContainer>
              <AreaChart data={hist} margin={{ left: -20, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickFormatter={(m) => (m === s.forecast_key ? t('ctrl.nextWeek') : fm(m))} tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip contentStyle={tip} labelFormatter={(m) => (m === s.forecast_key ? t('ctrl.nextWeek') : fm(m))} />
                {labels.map((l, i) => (
                  <Area key={l} dataKey={l} stackId="1" stroke={colors[i]} fill={colors[i]} fillOpacity={0.7} name={t(`class.${i}` as 'class.0')} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-slate-500">{t('stats.classHistoryNote')}</p>
        </Panel>

        <Panel title={t('stats.water')}>
          <div dir="ltr" className="h-64">
            <ResponsiveContainer>
              <ComposedChart data={s.demand} margin={{ left: 0, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fm} tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis yAxisId="m3" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <YAxis yAxisId="mm" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tip} labelFormatter={fm} formatter={(v: number) => fmtNumber(v, lang)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="m3" dataKey="baseline_m3" fill="#64748b" fillOpacity={0.5} name={t('stats.baseline')} />
                <Bar yAxisId="m3" dataKey="need_m3" fill="#38bdf8" name={t('stats.plan')} />
                <Line yAxisId="mm" dataKey="rain_mm" stroke="#a78bfa" dot={false} name={t('stats.rain')} />
                <Line yAxisId="mm" dataKey="et0_mm" stroke="#facc15" dot={false} name="ET0 (mm)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title={t('stats.energy')} icon={<Zap size={14} />}>
          <div dir="ltr" className="h-56">
            <ResponsiveContainer>
              <ComposedChart data={s.demand} margin={{ left: 0, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tickFormatter={fm} tick={{ fontSize: 10 }} minTickGap={20} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip contentStyle={tip} labelFormatter={fm} formatter={(v: number) => `${fmtNumber(v, lang)} kWh`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="pump_kwh" fill="#f97316" name={t('stats.pumpKwh')} />
                <Line dataKey="pv_kwh" stroke="#fde047" strokeWidth={2} dot={false} name={t('stats.pvKwh')} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title={t('stats.subzones')}>
          <div className="thin-scroll max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="py-1">{t('plan.col.field')}</th><th>{t('onb.crop')}</th><th className="text-right">ha</th>
                  <th>{t('stats.last12')}</th><th>{t('plan.col.next')}</th><th className="text-right">m³/j</th>
                </tr>
              </thead>
              <tbody>
                {s.sub_zones.map((r: any) => (
                  <tr key={r.sub_zone_id} className="border-t border-white/5">
                    <td className="py-1.5 font-semibold text-white">{r.name}</td>
                    <td className="text-slate-300">{crop(r.crop)}</td>
                    <td className="text-right text-slate-300">{fmtNumber(r.area_ha, lang, 1)}</td>
                    <td>
                      <div className="flex gap-0.5">
                        {r.history_12m.map((c: number | null, i: number) => (
                          <span key={i} className="h-3 w-2 rounded-sm" style={{ background: c === null ? '#334155' : colors[c] }} />
                        ))}
                      </div>
                    </td>
                    <td><span className="inline-block h-3 w-3 rounded-full" style={{ background: r.class_next === null ? '#334155' : colors[r.class_next] }} /></td>
                    <td className="text-right font-mono text-water-200">{fmtNumber(r.need_m3_day, lang)} → {fmtNumber(r.need_next_m3_day, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <p className="text-[11px] text-slate-500">{t('stats.note')}</p>
    </div>
  );
}
