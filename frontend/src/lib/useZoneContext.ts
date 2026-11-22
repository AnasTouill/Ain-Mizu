import { useCallback } from 'react';
import { useConfig, useZones } from '../api/hooks';
import { NA_COLOR } from '../components/ClassIcon';
import { useLang, useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import type { AppConfig, EdgeProps, FieldFeatureProps, StatusType } from '../types';
import { esc } from './colors';
import { fmtNumber } from './format';
import { addMonths } from './months';

/** Zone, slider month and the effective month/status shown (Now = slider month, +h = forecast). */
export function useZoneContext() {
  const config = useConfig().data as AppConfig;
  const zones = useZones().data;
  const zone = useAppStore((s) => s.zone);
  const month = useAppStore((s) => s.month);
  const horizon = useAppStore((s) => s.horizon);
  const zoneCfg = config.zones.find((z) => z.id === zone) ?? config.zones[0];
  const zoneInfo = zones?.find((z) => z.id === zone);
  const lastObserved = config.months.last_observed;
  const effMonth = horizon === 0 ? month : addMonths(lastObserved, horizon);
  const status: StatusType = horizon === 0 ? 'current' : 'forecast';
  return { config, zone, zoneCfg, zoneInfo, month, horizon, effMonth, status, lastObserved };
}

export function useFieldTooltip(colors: string[]) {
  const t = useT();
  const lang = useLang();
  return useCallback(
    (p: FieldFeatureProps) => {
      const cls = p.is_irrigated ? p.stress_class : null;
      const color = cls === null ? NA_COLOR : colors[cls];
      const label = cls === null ? `${t('class.na')}` : `${t(`class.${cls}` as 'class.0')} · ${t(`class.${cls}.desc` as 'class.0.desc')}`;
      const demand = p.demand_score ? ` · ${t('drawer.demand')} ${fmtNumber(p.demand_score, lang, 2)}` : '';
      return `<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:${color}"></span><b>${esc(
        p.field_id,
      )}</b></div><div>${esc(label)}</div><div style="color:#6d746e">${fmtNumber(p.area_ha, lang, 1)} ${t('common.ha')}${esc(demand)}</div>`;
    },
    [t, lang, colors],
  );
}

export function useEdgeTooltip() {
  const t = useT();
  const lang = useLang();
  return useCallback(
    (p: EdgeProps) =>
      `<b>${esc(t('lab.edge', { id: p.edge_id }))}</b><br/>${t('lab.flow')}: ${fmtNumber(p.flow * 100, lang, 1)} % · ${t('lab.conductivity')}: ${fmtNumber(
        p.conductivity,
        lang,
        2,
      )}<br/>${t('lab.lengthShort')}: ${fmtNumber(p.length_m, lang, 0)} m<br/><span style="color:${p.blocked ? '#86efac' : '#fca5a5'}">${
        p.blocked ? t('lab.clickToUnblock') : t('lab.clickToBlock')
      }</span>`,
    [t, lang],
  );
}
