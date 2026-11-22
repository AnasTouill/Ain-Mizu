import type L from 'leaflet';

/** Dedicated panes so the stacking order never depends on which layer loaded first. */
export function ensurePanes(map: L.Map) {
  const panes: [string, number][] = [
    ['pg-fields', 410],
    ['pg-network', 430],
    ['pg-hit', 440],
  ];
  for (const [name, z] of panes) {
    if (!map.getPane(name)) map.createPane(name).style.zIndex = String(z);
  }
}
