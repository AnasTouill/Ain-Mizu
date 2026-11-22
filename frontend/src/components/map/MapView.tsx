import L from 'leaflet';
import { useEffect, useRef, type ReactNode } from 'react';
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet';
import { esc } from '../../lib/colors';
import type { Layers } from '../../store/useAppStore';
import type { EdgeProps, FieldCollection, FieldFeatureProps, NetworkResponse, SourcePoint } from '../../types';
import { FieldLayer } from './FieldLayer';
import { NetworkLayer } from './NetworkLayer';

function FitZone({ zone, bbox, center }: { zone: string; bbox?: number[]; center: [number, number] }) {
  const map = useMap();
  const first = useRef(true);
  const bboxKey = bbox?.join(',') ?? '';
  useEffect(() => {
    const bounds = bbox && bbox.length === 4 ? L.latLngBounds([bbox[1], bbox[0]], [bbox[3], bbox[2]]) : null;
    if (first.current) {
      if (bounds) map.fitBounds(bounds, { padding: [28, 28] });
      else map.setView([center[1], center[0]], 14);
      first.current = false;
    } else if (bounds) {
      map.flyToBounds(bounds, { padding: [28, 28], duration: 1.4 });
    } else {
      map.flyTo([center[1], center[0]], 14, { duration: 1.4 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, zone, bboxKey]);
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function SourceLayer({ sources, label }: { sources: SourcePoint[]; label: string }) {
  const map = useMap();
  const sourcesKey = sources.map((s) => `${s.node_id}@${s.lon},${s.lat}`).join('|');
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    for (const s of sources) {
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div class="pg-source"><span class="ring"></span><span class="ring r2"></span><span class="core"></span></div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
        keyboard: false,
        zIndexOffset: 1000,
      })
        .bindTooltip(
          `<b>${esc(s.node_id)}</b><br/>${esc(label)}${s.capacity_m3_day ? ` · ${Math.round(s.capacity_m3_day)} m³/d` : ''}`,
          { className: 'pg-tip', direction: 'top', offset: [0, -16] },
        )
        .addTo(group);
    }
    return () => {
      group.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sourcesKey, label]);
  return null;
}

interface Props {
  zone: string;
  center: [number, number];
  bbox?: number[];
  layers: Layers;
  colors: string[];
  patterns: boolean;
  fields?: FieldCollection;
  network?: NetworkResponse;
  selectedFieldId?: string | null;
  onFieldClick?: (id: string) => void;
  fieldTooltip: (p: FieldFeatureProps) => string;
  sourceLabel: string;
  dimFields?: boolean;
  interactiveNetwork?: boolean;
  onEdgeClick?: (p: EdgeProps) => void;
  edgeTooltip?: (p: EdgeProps) => string;
  children?: ReactNode;
}

export function MapView(props: Props) {
  const [lon, lat] = props.center;
  return (
    // Leaflet controls misbehave in RTL documents: keep the map itself LTR.
    <div dir="ltr" className="h-full w-full">
      <MapContainer center={[lat, lon]} zoom={14} zoomControl={false} className="h-full w-full" scrollWheelZoom attributionControl>
        <ZoomControl position="bottomright" />
        {props.layers.satellite ? (
          <TileLayer
            key="esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="osm"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            className="tiles-dark"
            maxZoom={19}
          />
        )}
        <FitZone zone={props.zone} bbox={props.bbox} center={props.center} />
        {props.layers.fields && props.fields && (
          <FieldLayer
            data={props.fields}
            colors={props.colors}
            patterns={props.patterns}
            selectedId={props.selectedFieldId}
            onSelect={props.onFieldClick}
            dim={props.dimFields}
            tooltip={props.fieldTooltip}
          />
        )}
        {props.layers.network && props.network && props.network.zone === props.zone && (
          <NetworkLayer
            data={props.network}
            showPruned={props.layers.pruned}
            interactive={props.interactiveNetwork}
            onEdgeClick={props.onEdgeClick}
            tooltip={props.edgeTooltip}
          />
        )}
        {props.layers.sources && props.network && props.network.zone === props.zone && (
          <SourceLayer sources={props.network.sources} label={props.sourceLabel} />
        )}
        {props.children}
      </MapContainer>
    </div>
  );
}
