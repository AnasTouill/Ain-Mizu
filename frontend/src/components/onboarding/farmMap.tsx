import L from 'leaflet';
import { useEffect } from 'react';
import { Polygon, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Lang, LonLat } from '../../types';

export const CATEGORY_COLORS: Record<string, string> = {
  arbre: '#22c55e',
  fruit: '#f472b6',
  legume: '#f59e0b',
  cereale: '#eab308',
  fourrage: '#a3e635',
  autre: '#94a3b8',
};
export const NO_CROP_COLOR = '#e2e8f0';

export const optLabel = (o: { fr: string; en: string; ar: string } | undefined, lang: Lang) => (o ? o[lang] ?? o.fr : '–');

/** [lon, lat][] -> Leaflet [lat, lon][] */
export const ll = (ring: LonLat[]): [number, number][] => ring.map(([lon, lat]) => [lat, lon]);

export function pointInPolygon([x, y]: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Shoelace area in hectares on a local equirectangular projection. */
export function areaHa(ring: LonLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
  return Math.abs(a / 2) / 10000;
}

export function centroidOf(ring: LonLat[]): LonLat {
  const n = ring.length || 1;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

export function BaseTiles({ satellite }: { satellite: boolean }) {
  return satellite ? (
    <TileLayer
      key="sat"
      url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      attribution="Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics"
      maxZoom={19}
    />
  ) : (
    <TileLayer key="osm" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' maxZoom={19} />
  );
}

/** Darkens everything outside the farm outline: only the farm stays visible. */
export function OutsideMask({ ring }: { ring: LonLat[] }) {
  const world: [number, number][] = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
  return <Polygon positions={[world, ll(ring)]} pathOptions={{ stroke: false, fillColor: '#04070f', fillOpacity: 0.82, interactive: false }} />;
}

/** Fits the map to a bounding box ([w, s, e, n]) or a ring whenever the key changes; optionally locks panning. */
export function FitTo({ bbox, ring, lock = false, k }: { bbox?: [number, number, number, number]; ring?: LonLat[]; lock?: boolean; k: string }) {
  const map = useMap();
  useEffect(() => {
    let b: L.LatLngBounds | null = null;
    if (ring && ring.length >= 3) b = L.latLngBounds(ll(ring));
    else if (bbox) b = L.latLngBounds([bbox[1], bbox[0]], [bbox[3], bbox[2]]);
    if (!b) return;
    // release any previous lock first, otherwise setMaxBounds cancels the fly animation
    map.setMaxBounds(undefined as unknown as L.LatLngBounds);
    map.setMinZoom(3);
    const bounds = b;
    const onEnd = () => {
      if (!lock) return;
      map.setMinZoom(Math.max(map.getZoom() - 2, 3));
      map.setMaxBounds(bounds.pad(0.6));
    };
    map.once('moveend', onEnd);
    map.flyToBounds(bounds, { padding: [30, 30], duration: 1.1 });
    return () => {
      map.off('moveend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, k]);
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Keeps the map on one farm: fits it once, then limits panning and zooming out to its surroundings. */
export function LockTo({ ring, k }: { ring: LonLat[]; k: string }) {
  const map = useMap();
  useEffect(() => {
    const b = L.latLngBounds(ll(ring));
    map.setMaxBounds(undefined as unknown as L.LatLngBounds);
    const onEnd = () => {
      map.setMinZoom(Math.max(map.getZoom() - 1, 3));
      map.setMaxBounds(b.pad(0.4));
    };
    map.once('moveend', onEnd);
    map.fitBounds(b, { padding: [24, 24] });
    return () => {
      map.off('moveend', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, k]);
  return null;
}

export function ClickCapture({ onClick, cursor }: { onClick?: (p: LonLat) => void; cursor?: boolean }) {
  const map = useMapEvents({
    click(e) {
      onClick?.([+e.latlng.lng.toFixed(6), +e.latlng.lat.toFixed(6)]);
    },
  });
  useEffect(() => {
    map.getContainer().style.cursor = cursor ? 'crosshair' : '';
    if (cursor) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [map, cursor]);
  return null;
}
