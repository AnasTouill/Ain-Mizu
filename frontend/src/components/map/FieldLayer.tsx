import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { shade } from '../../lib/colors';
import type { FieldCollection, FieldFeatureProps, PolygonGeometry } from '../../types';
import { NA_COLOR } from '../ClassIcon';
import { ensurePanes } from './panes';

function toLatLngs(g: PolygonGeometry): L.LatLngExpression[][] | L.LatLngExpression[][][] {
  const ring = (r: number[][]) => r.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
  return g.type === 'Polygon' ? g.coordinates.map(ring) : g.coordinates.map((poly) => poly.map(ring));
}

export function fieldStyle(p: FieldFeatureProps, colors: string[], patterns: boolean, selected: boolean, dim: boolean): L.PathOptions {
  const classified = p.is_irrigated && p.stress_class !== null;
  const base = classified ? colors[p.stress_class as number] : NA_COLOR;
  const fill = classified ? (patterns ? `url(#pat-c${p.stress_class})` : base) : patterns ? 'url(#pat-na)' : NA_COLOR;
  return {
    fillColor: fill,
    fillOpacity: dim ? 0.28 : classified ? 0.85 : 0.5,
    color: selected ? '#ffffff' : classified ? shade(base, -0.35) : '#94a3b8',
    weight: selected ? 3.2 : 1,
    opacity: dim ? 0.45 : 0.95,
    dashArray: classified ? undefined : '3 3',
  };
}

interface Props {
  data: FieldCollection;
  colors: string[];
  patterns: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  dim?: boolean;
  tooltip: (p: FieldFeatureProps) => string;
}

/** Field polygons. Built once per zone; month changes only restyle them (smooth fill transitions). */
export function FieldLayer({ data, colors, patterns, selectedId = null, onSelect, dim = false, tooltip }: Props) {
  const map = useMap();
  const polys = useRef(new Map<string, L.Polygon>());
  const props = useRef(new Map<string, FieldFeatureProps>());
  const onSelectRef = useRef(onSelect);
  const tooltipRef = useRef(tooltip);
  onSelectRef.current = onSelect;
  tooltipRef.current = tooltip;
  const geomKey = useMemo(() => data.features.map((f) => f.properties.field_id).join('|'), [data]);

  useEffect(() => {
    ensurePanes(map);
    const group = L.layerGroup().addTo(map);
    polys.current.clear();
    for (const f of data.features) {
      const id = f.properties.field_id;
      props.current.set(id, f.properties);
      const poly = L.polygon(toLatLngs(f.geometry), { pane: 'pg-fields', className: 'field-poly' });
      poly.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectRef.current?.(id);
      });
      poly.bindTooltip(() => tooltipRef.current(props.current.get(id) ?? f.properties), {
        sticky: true,
        className: 'pg-tip',
        direction: 'top',
        offset: [0, -8],
      });
      poly.addTo(group);
      polys.current.set(id, poly);
    }
    return () => {
      group.remove();
      polys.current.clear();
    };
    // geometry only changes with the zone; data is read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, geomKey]);

  useEffect(() => {
    for (const f of data.features) {
      const id = f.properties.field_id;
      props.current.set(id, f.properties);
      const poly = polys.current.get(id);
      if (!poly) continue;
      poly.setStyle(fieldStyle(f.properties, colors, patterns, id === selectedId, dim));
      if (id === selectedId) poly.bringToFront();
    }
  }, [data, colors, patterns, selectedId, dim, geomKey]);

  return null;
}
