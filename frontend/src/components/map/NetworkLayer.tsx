import L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import { mix } from '../../lib/colors';
import type { EdgeProps, NetworkResponse } from '../../types';
import { ensurePanes } from './panes';

interface EdgeLayers {
  glow: L.Polyline;
  tube: L.Polyline;
  pulse: L.Polyline;
  hit?: L.Polyline;
  cross?: L.Marker;
}

interface Props {
  data: NetworkResponse;
  showPruned: boolean;
  interactive?: boolean;
  dimmed?: boolean;
  onEdgeClick?: (p: EdgeProps) => void;
  tooltip?: (p: EdgeProps) => string;
}

const key = (lon: number, lat: number) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

/** Hops from the nearest source along kept canals: drives the "growing from the source" animation. */
function edgeDepths(data: NetworkResponse): Map<string, number> {
  const adj = new Map<string, { to: string; id: string }[]>();
  for (const f of data.edges.features) {
    if (!f.properties.kept) continue;
    const [a, b] = f.geometry.coordinates;
    const ka = key(a[0], a[1]);
    const kb = key(b[0], b[1]);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push({ to: kb, id: f.properties.edge_id });
    adj.get(kb)!.push({ to: ka, id: f.properties.edge_id });
  }
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const s of data.sources) {
    const k = key(s.lon, s.lat);
    dist.set(k, 0);
    queue.push(k);
  }
  const depth = new Map<string, number>();
  while (queue.length) {
    const cur = queue.shift() as string;
    const d = dist.get(cur) as number;
    for (const { to, id } of adj.get(cur) ?? []) {
      if (!depth.has(id)) depth.set(id, d);
      if (!dist.has(to)) {
        dist.set(to, d + 1);
        queue.push(to);
      }
    }
  }
  return depth;
}

function grow(line: L.Polyline, delay: number) {
  const el = line.getElement() as SVGPathElement | undefined;
  if (!el || typeof el.getTotalLength !== 'function' || typeof el.animate !== 'function') return;
  const len = el.getTotalLength();
  if (!len) return;
  el.animate(
    [
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: `${len}` },
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: '0' },
    ],
    { duration: 650, delay, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' },
  );
}

function style(e: EdgeLayers, p: EdgeProps, showPruned: boolean, dimmed: boolean) {
  const w = 1.6 + 7.5 * Math.sqrt(Math.max(p.conductivity, 0));
  if (p.blocked) {
    e.glow.setStyle({ opacity: 0, weight: 1 });
    e.tube.setStyle({ color: '#f87171', weight: 3.2, opacity: 0.95, dashArray: '7 6' });
    e.pulse.setStyle({ opacity: 0 });
  } else if (p.kept) {
    const color = mix('#0284c7', '#7dd3fc', Math.min(1, Math.sqrt(p.flow) * 1.4));
    e.glow.setStyle({ color: '#38bdf8', weight: w + 9, opacity: dimmed ? 0.07 : 0.2, dashArray: undefined });
    e.tube.setStyle({ color, weight: w, opacity: dimmed ? 0.55 : 0.95, dashArray: undefined, lineCap: 'round' });
    e.pulse.setStyle({ color: '#f0f9ff', weight: Math.max(1.3, w * 0.36), opacity: dimmed ? 0.35 : 0.85 });
    const el = e.pulse.getElement() as SVGElement | undefined;
    if (el) el.style.animationDuration = `${Math.max(0.45, 1.9 - Math.sqrt(p.flow) * 2.2).toFixed(2)}s`;
  } else {
    e.glow.setStyle({ opacity: 0 });
    e.tube.setStyle(
      showPruned ? { color: '#94a3b8', weight: 1.1, opacity: 0.45, dashArray: '2 6' } : { opacity: 0, weight: 1, dashArray: undefined },
    );
    e.pulse.setStyle({ opacity: 0 });
  }
}

/** The "slime mold": glowing tubes (width = conductivity) with dashes flowing downstream. */
export function NetworkLayer({ data, showPruned, interactive = false, dimmed = false, onEdgeClick, tooltip }: Props) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  const edges = useRef(new Map<string, EdgeLayers>());
  const props = useRef(new Map<string, EdgeProps>());
  const prevKept = useRef<Set<string> | null>(null);
  const clickRef = useRef(onEdgeClick);
  const tipRef = useRef(tooltip);
  clickRef.current = onEdgeClick;
  tipRef.current = tooltip;

  useEffect(() => {
    ensurePanes(map);
    const group = L.layerGroup().addTo(map);
    groupRef.current = group;
    edges.current.clear();
    prevKept.current = null;
    return () => {
      group.remove();
      edges.current.clear();
      groupRef.current = null;
    };
  }, [map, data.zone, interactive]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const depth = edgeDepths(data);
    const first = prevKept.current === null;
    const seen = new Set<string>();
    const nowKept = new Set<string>();

    for (const f of data.edges.features) {
      const p = f.properties;
      seen.add(p.edge_id);
      props.current.set(p.edge_id, p);
      const latlngs = f.geometry.coordinates.map(([lon, lat]) => L.latLng(lat, lon));
      let e = edges.current.get(p.edge_id);
      if (!e) {
        const base = { pane: 'pg-network', interactive: false } as const;
        e = {
          glow: L.polyline(latlngs, { ...base, className: 'net-glow' }).addTo(group),
          tube: L.polyline(latlngs, { ...base, className: 'net-tube' }).addTo(group),
          pulse: L.polyline(latlngs, { ...base, className: 'net-pulse' }).addTo(group),
        };
        if (interactive) {
          const id = p.edge_id;
          e.hit = L.polyline(latlngs, { pane: 'pg-hit', className: 'net-hit', weight: 18, opacity: 0, interactive: true })
            .on('click', (ev) => {
              L.DomEvent.stopPropagation(ev);
              const cur = props.current.get(id);
              if (cur) clickRef.current?.(cur);
            })
            .on('mouseover', () => edges.current.get(id)?.glow.setStyle({ opacity: 0.6, color: '#fde047' }))
            .on('mouseout', () => {
              const cur = props.current.get(id);
              const layers = edges.current.get(id);
              if (cur && layers) style(layers, cur, showPrunedRef.current, dimmedRef.current);
            })
            .bindTooltip(() => tipRef.current?.(props.current.get(id) as EdgeProps) ?? id, {
              sticky: true,
              className: 'pg-tip',
              direction: 'top',
              offset: [0, -8],
            })
            .addTo(group);
        }
        edges.current.set(p.edge_id, e);
      } else {
        e.glow.setLatLngs(latlngs);
        e.tube.setLatLngs(latlngs);
        e.pulse.setLatLngs(latlngs);
        e.hit?.setLatLngs(latlngs);
      }
      style(e, p, showPruned, dimmed);

      if (p.blocked && !e.cross) {
        const mid = L.latLng((latlngs[0].lat + latlngs[1].lat) / 2, (latlngs[0].lng + latlngs[1].lng) / 2);
        e.cross = L.marker(mid, {
          icon: L.divIcon({ className: '', html: '<div class="pg-blocked-x">×</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
          interactive: false,
          keyboard: false,
        }).addTo(group);
      } else if (!p.blocked && e.cross) {
        e.cross.remove();
        e.cross = undefined;
      }

      if (p.kept) {
        nowKept.add(p.edge_id);
        if (first || !prevKept.current?.has(p.edge_id)) {
          const delay = (depth.get(p.edge_id) ?? 0) * (first ? 75 : 45);
          grow(e.glow, delay);
          grow(e.tube, delay);
        }
      }
    }
    for (const [id, e] of edges.current) {
      if (seen.has(id)) continue;
      e.glow.remove();
      e.tube.remove();
      e.pulse.remove();
      e.hit?.remove();
      e.cross?.remove();
      edges.current.delete(id);
    }
    prevKept.current = nowKept;
  }, [data, showPruned, dimmed, interactive]);

  const showPrunedRef = useRef(showPruned);
  const dimmedRef = useRef(dimmed);
  showPrunedRef.current = showPruned;
  dimmedRef.current = dimmed;

  return null;
}
