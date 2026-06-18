import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Polygon, Marker, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { mapApi } from '../utils/api';
import { FACILITY_COLORS, FACILITY_ICONS, FACILITY_LABELS, EQUIPMENT_ICONS, EQUIPMENT_LABELS, ROUTE_COLORS, LEVEL_COLORS } from '../utils/constants';
import { SensorData, DetectionState, MapSensor, MapSiren, MapFacility, EvacRoute, SafeZone, InundationZone, MapEquipment, User } from '../types';

interface Props {
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  sirenActive: boolean;
  user: User;
  [key: string]: any;
}

const LAYER_DEFAULTS = {
  sensors: true, sirens: true, facilities: true,
  evacuation: true, safe_zones: true, inundation: true,
  heavy_equipment: true,
};

const mapDivIcon = (label: string, color: string) => L.divIcon({
  className: 'asset-div-icon',
  html: `<div style="background:${color};color:#ffffff;border:2px solid #ffffff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;box-shadow:0 4px 12px rgba(15,23,42,.18)">${label}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

const facilityLabel = (type: string) => FACILITY_LABELS[type] || type || 'Lainnya';
const equipmentLabel = (type: string) => EQUIPMENT_LABELS[type] || type || 'Lainnya';
const equipmentIcon = (type: string) => EQUIPMENT_ICONS[type] || EQUIPMENT_ICONS.lainnya || 'AST';

export default function MonitoringPeta({ sensors, detection, sirenActive, user }: Props) {
  const [mapSensors, setMapSensors] = useState<MapSensor[]>([]);
  const [mapSirens, setMapSirens] = useState<MapSiren[]>([]);
  const [mapFacilities, setMapFacilities] = useState<MapFacility[]>([]);
  const [evacRoutes, setEvacRoutes] = useState<EvacRoute[]>([]);
  const [safeZones, setSafeZones] = useState<SafeZone[]>([]);
  const [inundation, setInundation] = useState<InundationZone[]>([]);
  const [equipment, setEquipment] = useState<MapEquipment[]>([]);
  const [loadingLayers, setLoadingLayers] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [layers, setLayers] = useState(LAYER_DEFAULTS);

  useEffect(() => {
    let mounted = true;

    const loadLayers = async () => {
      setLoadingLayers(true);
      setLoadError('');

      const layerRequests = [
        { key: 'sensors', request: mapApi.sensors() },
        { key: 'sirens', request: mapApi.sirens() },
        { key: 'facilities', request: mapApi.facilities() },
        { key: 'evacuation', request: mapApi.evacRoutes() },
        { key: 'safe_zones', request: mapApi.safeZones() },
        { key: 'inundation', request: mapApi.inundation() },
        { key: 'heavy_equipment', request: mapApi.equipment() },
      ] as const;

      const results = await Promise.allSettled(layerRequests.map(({ request }) => request));

      if (!mounted) return;

      const failedLayers: string[] = [];

      results.forEach((result, index) => {
        const layerKey = layerRequests[index].key;

        if (result.status === 'rejected') {
          failedLayers.push(layerKey);
          return;
        }

        const data = result.value.data;

        switch (layerKey) {
          case 'sensors':
            setMapSensors(Array.isArray(data?.sensors) ? data.sensors : []);
            break;
          case 'sirens':
            setMapSirens(Array.isArray(data?.sirens) ? data.sirens : []);
            break;
          case 'facilities':
            setMapFacilities(
              Array.isArray(data?.facilities)
                ? data.facilities
                    .map((item: any) => ({
                      ...item,
                      lng: Number(item.lng ?? item.longitude),
                      lat: Number(item.lat ?? item.latitude),
                    }))
                    .filter((item: MapFacility) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
                : [],
            );
            break;
          case 'evacuation':
            setEvacRoutes(Array.isArray(data?.routes) ? data.routes : []);
            break;
          case 'safe_zones':
            setSafeZones(Array.isArray(data?.safe_zones) ? data.safe_zones : []);
            break;
          case 'inundation':
            setInundation(Array.isArray(data?.zones) ? data.zones : []);
            break;
          case 'heavy_equipment':
            setEquipment(
              Array.isArray(data?.equipment)
                ? data.equipment
                    .map((item: any) => ({
                      ...item,
                      lng: Number(item.lng ?? item.longitude),
                      lat: Number(item.lat ?? item.latitude),
                    }))
                    .filter((item: MapEquipment) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
                : [],
            );
            break;
        }
      });

      if (failedLayers.length > 0) {
        setLoadError(`Sebagian layer gagal dimuat: ${failedLayers.map(layer => layer.replace(/_/g, ' ')).join(', ')}.`);
      }

      setLoadingLayers(false);
    };

    loadLayers();

    return () => {
      mounted = false;
    };
  }, []);

  // Merge live water levels into map sensors
  const mergedSensors = useMemo(() => mapSensors.map(ms => {
    const live = Object.values(sensors).find(s => s.sensor_id === ms.id || s.code === ms.code);
    return { ...ms, water_level_cm: live?.water_level_cm ?? ms.water_level_cm, delta_3m: live?.delta_3m ?? 0, quality: live?.quality ?? 'good' };
  }), [mapSensors, sensors]);

  const getSensorColor = (delta3m: number) => {
    const a = Math.abs(delta3m);
    if (a >= 60) return '#7c3aed';
    if (a >= 40) return '#ef4444';
    if (a >= 25) return '#f97316';
    if (a >= 15) return '#eab308';
    return '#22c55e';
  };

  const toggleLayer = (key: string) => setLayers(l => ({ ...l, [key]: !l[key as keyof typeof l] }));

  const isAdmin = user?.role === 'admin';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 110px)', gap: 12 }}>
      {/* Layer control */}
      <div className="card" style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="card-title">🗂️ Layer & Legenda</div>
        {loadingLayers && <div className="infobox" style={{ fontSize: 10 }}>Memuat layer peta...</div>}
        {loadError && <div className="infobox" style={{ fontSize: 10, borderColor: '#ef4444', color: '#ef4444' }}>{loadError}</div>}
        {Object.entries(layers).map(([key, on]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: on ? '#1f2937' : '#64748b' }}>
            <input type="checkbox" checked={on} onChange={() => toggleLayer(key)} style={{ accentColor: '#06b6d4' }} />
            {key.replace(/_/g, ' ').toUpperCase()}
          </label>
        ))}
        <div style={{ marginTop: 8, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
          <div className="section-title">Legenda Sensor</div>
          {[
            { color: '#22c55e', label: 'Normal' },
            { color: '#eab308', label: 'Suspect (Δ≥15cm)' },
            { color: '#f97316', label: 'Waspada (Δ≥25cm)' },
            { color: '#ef4444', label: 'Siaga (Δ≥40cm)' },
            { color: '#7c3aed', label: 'AWAS (Δ≥60cm)' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 10, color: '#94a3b8' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              {label}
            </div>
          ))}

          <div className="section-title" style={{ marginTop: 8 }}>Fasilitas</div>
          {Object.entries(FACILITY_ICONS).map(([type, icon]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 10, color: '#94a3b8' }}>
              <span>{icon}</span>
              <span style={{ color: FACILITY_COLORS[type] }}>{type.toUpperCase()}</span>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, fontSize: 10, color: '#64748b' }}>
          <div style={{ marginBottom: 4 }}>
            <span style={{ display: 'inline-block', width: 24, height: 4, background: '#22c55e', marginRight: 6 }} />
            Jalur Clear
          </div>
          <div style={{ marginBottom: 4 }}>
            <span style={{ display: 'inline-block', width: 24, height: 4, background: '#f97316', marginRight: 6 }} />
            Congested
          </div>
          <div>
            <span style={{ display: 'inline-block', width: 24, height: 4, background: '#ef4444', marginRight: 6 }} />
            Blocked
          </div>
        </div>

        {/* Alert level indicator */}
        <div style={{
          marginTop: 'auto', padding: 10, borderRadius: 6,
          background: LEVEL_COLORS[detection.level] + '22',
          border: `1px solid ${LEVEL_COLORS[detection.level]}`,
          textAlign: 'center', color: LEVEL_COLORS[detection.level], fontSize: 12, fontWeight: 700
        }}>
          {detection.level.toUpperCase()}
          {sirenActive && <div style={{ fontSize: 10, marginTop: 4 }}>🔊 SIRINE AKTIF</div>}
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        <MapContainer
          center={[-5.4712, 105.2756]}
          zoom={14}
          style={{ height: '100%', width: '100%', background: '#0a1628' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />

          {/* Inundation zones */}
          {layers.inundation && inundation.map(iz => (
            <Polygon
              key={iz.id}
              positions={iz.coordinates.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: iz.risk_level === 'high' ? '#ef4444' : '#f97316',
                fillOpacity: 0.25, weight: 1.5, dashArray: '6,3'
              }}
            >
              <Popup><b>{iz.name}</b><br />Risiko: {iz.risk_level}</Popup>
            </Polygon>
          ))}

          {/* Safe zones */}
          {layers.safe_zones && safeZones.filter(sz => sz.is_active !== false).map(sz => (
            <Polygon
              key={sz.id}
              positions={sz.coordinates.map(([lng, lat]) => [lat, lng])}
              pathOptions={{ color: '#22c55e', fillOpacity: 0.2, weight: 2 }}
            >
              <Popup>
                <b>🟢 {sz.name}</b><br />
                Elevasi: {sz.elevation_m}m<br />
                Kapasitas: {sz.capacity?.toLocaleString('id-ID')} orang<br />
                Fasilitas: {sz.facilities?.join(', ') || '-'}
              </Popup>
            </Polygon>
          ))}

          {/* Evacuation routes */}
          {layers.evacuation && evacRoutes.map(r => (
            <Polyline
              key={r.id}
              positions={r.coordinates.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: ROUTE_COLORS[r.status] || '#22c55e',
                weight: 4, opacity: 0.85, dashArray: r.status === 'clear' ? undefined : '8,4'
              }}
            >
              <Popup>
                <b>{r.name}</b><br />
                Status: {r.status}<br />
                Arah: {r.direction || '-'}<br />
                Keterangan: {r.description || r.notes || '-'}<br />
                Kapasitas: {r.capacity_persons?.toLocaleString('id-ID') || '-'} orang<br />
                Jarak: {(r.distance_m / 1000).toFixed(1)} km<br />
                Est. waktu: {r.estimated_time_min} menit<br />
                Jumlah titik: {r.coordinates.length}
              </Popup>
            </Polyline>
          ))}

          {/* Sirens */}
          {layers.sirens && mapSirens.map(s => (
            <React.Fragment key={s.id}>
              <CircleMarker
                center={[s.lat, s.lng]}
                radius={sirenActive ? 14 : 8}
                pathOptions={{
                  color: sirenActive ? '#ef4444' : '#94a3b8',
                  fillColor: sirenActive ? '#ef4444' : '#475569',
                  fillOpacity: 0.8,
                  weight: 2,
                }}
              >
                <Popup>
                  <b>🔊 {s.name}</b><br />
                  Kode: {s.code}<br />
                  Status: {s.status}<br />
                  Radius: {s.radius_m}m<br />
                  Otomatis: {s.is_auto_enabled ? 'Ya' : 'Tidak'}<br />
                  Aktivasi terakhir: {s.last_activated ? new Date(s.last_activated).toLocaleString('id-ID') : '-'}
                </Popup>
              </CircleMarker>
              {/* Radius ring */}
              <Circle
                center={[s.lat, s.lng]}
                radius={s.radius_m || 500}
                pathOptions={{
                  color: sirenActive ? '#ef4444' : '#475569',
                  fillColor: 'transparent',
                  fillOpacity: 0, weight: 1, opacity: 0.3,
                }}
              />
            </React.Fragment>
          ))}

          {/* Facilities */}
          {layers.facilities && mapFacilities.map(f => (
            <Marker
              key={f.id}
              position={[f.lat, f.lng]}
              icon={mapDivIcon(FACILITY_ICONS[f.type] || FACILITY_ICONS.lainnya || 'FAS', FACILITY_COLORS[f.type] || '#757575')}
            >
              <Popup>
                <b>{FACILITY_ICONS[f.type]} {f.name}</b><br />
                Jenis: {facilityLabel(f.type)}<br />
                {f.address && <>Alamat: {f.address}<br /></>}
                {f.phone && <>Telp: {f.phone}<br /></>}
                {(f.description || f.notes) && <>Keterangan: {f.description || f.notes}<br /></>}
                Koordinat: {f.lat.toFixed(5)}, {f.lng.toFixed(5)}
              </Popup>
            </Marker>
          ))}

          {/* Heavy equipment */}
          {layers.heavy_equipment && equipment.map(e => (
            <Marker
              key={e.id}
              position={[e.lat, e.lng]}
              icon={mapDivIcon(equipmentIcon(e.type), e.status === 'available' ? '#facc15' : e.status === 'in_use' ? '#f97316' : e.status === 'maintenance' ? '#ef4444' : '#94a3b8')}
            >
              <Popup>
                <b>🚧 {e.name}</b><br />
                Jenis: {equipmentLabel(e.type)}<br />
                Status: {e.status}<br />
                {(e.description || e.notes) && <>Keterangan: {e.description || e.notes}<br /></>}
                Koordinat: {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
              </Popup>
            </Marker>
          ))}

          {/* Sensors */}
          {layers.sensors && mergedSensors.map(s => {
            const color = getSensorColor(s.delta_3m || 0);
            return (
              <CircleMarker
                key={s.id}
                center={[s.lat, s.lng]}
                radius={10}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>
                  <b>📡 {s.name}</b><br />
                  Kode: {s.code}<br />
                  Status: {s.status}<br />
                  Level: <b>{(s.water_level_cm || 0).toFixed(1)} cm</b><br />
                  Δ3m: {(s.delta_3m || 0) > 0 ? '+' : ''}{(s.delta_3m || 0).toFixed(1)} cm<br />
                  Quality: {s.quality?.toUpperCase()}<br />
                  Update: {s.last_seen ? new Date(s.last_seen).toLocaleString('id-ID') : '-'}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
