/** Local metric projection around a zone centre (same as the backend's util.to_local). */
const M_PER_DEG_LAT = 110_540;

export function makeProjector(center: [number, number], unitMeters = 100) {
  const [lon0, lat0] = center;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  /** lon/lat -> scene units: x east, z south (three.js: y is up, north is -z) */
  return (lon: number, lat: number): [number, number] => [
    ((lon - lon0) * mLon) / unitMeters,
    (-(lat - lat0) * M_PER_DEG_LAT) / unitMeters,
  ];
}

export function outerRings(geometry: { type: string; coordinates: unknown }): number[][][] {
  if (geometry.type === 'Polygon') return [(geometry.coordinates as number[][][])[0]];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as number[][][][]).map((p) => p[0]);
  return [];
}

export function ringCentroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length - (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] ? 1 : 0);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / Math.max(n, 1), y / Math.max(n, 1)];
}
