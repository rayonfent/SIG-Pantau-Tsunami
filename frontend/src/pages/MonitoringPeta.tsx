import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Polygon, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { mapApi } from '../utils/api';
import { FACILITY_COLORS, FACILITY_ICONS, ROUTE_COLORS, LEVEL_COLORS } from '../utils/constants';
import { SensorData, DetectionState, MapSensor, MapSiren, MapFacility, EvacRoute, SafeZone, InundationZone, CustomMapPoint, User } from '../types';

interface Props {
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  sirenActive: boolean;
  user: User;
  [key: string]: any;
}

interface DraftPoint {
  lat: number;
  lng: number;
}

const LAYER_DEFAULTS = {
  sensors: true, sirens: true, facilities: true,
  evacuation: true, safe_zones: true, inundation: false,
  custom_points: true,
};

const CUSTOM_POINT_META: Record<string, { icon: string; color: string; label: string }> = {
  posko: { icon: '🏕️', color: '#06b6d4', label: 'Posko' },
  titik_kumpul: { icon: '🟢', color: '#22c55e', label: 'Titik Kumpul' },
  bahaya: { icon: '⚠️', color: '#ef4444', label: 'Bahaya' },
  informasi: { icon: 'ℹ️', color: '#3b82f6', label: 'Informasi' },
  lainnya: { icon: '📍', color: '#a855f7', label: 'Lainnya' },
};

export default function MonitoringPeta({ sensors, detection, sirenActive, user }: Props) {
  const [mapSensors, setMapSensors] = useState<MapSensor[]>([]);
  const [mapSirens, setMapSirens] = useState<MapSiren[]>([]);
  const [mapFacilities, setMapFacilities] = useState<MapFacility[]>([]);
  const [evacRoutes, setEvacRoutes] = useState<EvacRoute[]>([]);
  const [safeZones, setSafeZones] = useState<SafeZone[]>([]);
  const [inundation, setInundation] = useState<InundationZone[]>([]);
  const [customPoints, setCustomPoints] = useState<CustomMapPoint[]>([]);
  const [layers, setLayers] = useState(LAYER_DEFAULTS);
  const [addPointMode, setAddPointMode] = useState(false);
  const [draftPoint, setDraftPoint] = useState<DraftPoint | null>(null);
  const [pointForm, setPointForm] = useState({ name: '', description: '', type: 'informasi' });
  const [savingPoint, setSavingPoint] = useState(false);
  const [pointError, setPointError] = useState('');

  useEffect(() => {
    Promise.all([
      mapApi.sensors(), mapApi.sirens(), mapApi.facilities(),
      mapApi.evacRoutes(), mapApi.safeZones(), mapApi.inundation(), mapApi.customPoints(),
    ]).then(([s, si, f, r, sz, iz, cp]) => {
      setMapSensors(s.data.sensors);
      setMapSirens(si.data.sirens);
      setMapFacilities(f.data.facilities);
      setEvacRoutes(r.data.routes);
      setSafeZones(sz.data.safe_zones);
      setInundation(iz.data.zones);
      setCustomPoints(cp.data.points);
    }).catch(() => {});
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

  const handleSaveCustomPoint = async () => {
    if (!draftPoint) return;
    if (!pointForm.name.trim()) {
      setPointError('Nama titik wajib diisi.');
      return;
    }

    setSavingPoint(true);
    setPointError('');
    try {
      const res = await mapApi.createCustomPoint({
        name: pointForm.name.trim(),
        description: pointForm.description.trim(),
        type: pointForm.type,
        lng: draftPoint.lng,
        lat: draftPoint.lat,
      });
      setCustomPoints(prev => [res.data.point, ...prev]);
      setDraftPoint(null);
      setPointForm({ name: '', description: '', type: 'informasi' });
      setAddPointMode(false);
    } catch (err: any) {
      setPointError(err?.response?.data?.detail || 'Gagal menyimpan titik ke database.');
    } finally {
      setSavingPoint(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 110px)', gap: 12 }}>
      {/* Layer control */}
      <div className="card" style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="card-title">🗂️ Layer & Legenda</div>
        {Object.entries(layers).map(([key, on]) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: on ? '#f1f5f9' : '#475569' }}>
            <input type="checkbox" checked={on} onChange={() => toggleLayer(key)} style={{ accentColor: '#06b6d4' }} />
            {key.replace('_', ' ').toUpperCase()}
          </label>
        ))}

        {isAdmin && (
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8 }}>
            <div className="section-title">Admin Titik Peta</div>
            <button
              className={`btn ${addPointMode ? 'btn-danger' : 'btn-primary'}`}
              style={{ width: '100%', fontSize: 11, padding: '8px 10px' }}
              onClick={() => {
                setAddPointMode(v => !v);
                setDraftPoint(null);
                setPointError('');
              }}
            >
              {addPointMode ? 'Batal Tambah Titik' : '➕ Tambah Titik'}
            </button>
            <div style={{ fontSize: 10, color: addPointMode ? '#facc15' : '#64748b', marginTop: 6, lineHeight: 1.4 }}>
              {addPointMode ? 'Klik lokasi pada peta, lalu isi nama dan deskripsi.' : 'Admin dapat menempatkan titik manual di peta.'}
            </div>
          </div>
        )}

        <div style={{ marginTop: 8, borderTop: '1px solid #1e293b', paddingTop: 8 }}>
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

        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8, fontSize: 10, color: '#475569' }}>
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
      <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #1e293b' }}>
        <MapContainer
          center={[-5.4712, 105.2756]}
          zoom={14}
          style={{ height: '100%', width: '100%', background: '#0a1628' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />

          {isAdmin && (
            <AdminPointClickHandler
              enabled={addPointMode}
              onSelect={(lat, lng) => {
                setDraftPoint({ lat, lng });
                setPointError('');
              }}
            />
          )}

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
          {layers.safe_zones && safeZones.map(sz => (
            <Polygon
              key={sz.id}
              positions={sz.coordinates.map(([lng, lat]) => [lat, lng])}
              pathOptions={{ color: '#22c55e', fillOpacity: 0.2, weight: 2 }}
            >
              <Popup>
                <b>🟢 {sz.name}</b><br />
                Elevasi: {sz.elevation_m}m<br />
                Kapasitas: {sz.capacity?.toLocaleString('id-ID')} orang
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
                Jarak: {(r.distance_m / 1000).toFixed(1)} km<br />
                Est. waktu: {r.estimated_time_min} menit
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
                  Status: {sirenActive ? '🔴 AKTIF' : '⚫ Tidak Aktif'}<br />
                  Radius: {s.radius_m}m
                </Popup>
              </CircleMarker>
              {/* Radius ring */}
              <CircleMarker
                center={[s.lat, s.lng]}
                radius={s.radius_m / 15}
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
            <CircleMarker
              key={f.id}
              center={[f.lat, f.lng]}
              radius={9}
              pathOptions={{
                color: FACILITY_COLORS[f.type] || '#757575',
                fillColor: FACILITY_COLORS[f.type] || '#757575',
                fillOpacity: 0.85, weight: 2,
              }}
            >
              <Popup>
                <b>{FACILITY_ICONS[f.type]} {f.name}</b><br />
                Tipe: {f.type.toUpperCase()}<br />
                {f.phone && <>Telp: {f.phone}</>}
              </Popup>
            </CircleMarker>
          ))}

          {/* Custom admin points */}
          {layers.custom_points && customPoints.map(p => {
            const meta = CUSTOM_POINT_META[p.type] || CUSTOM_POINT_META.lainnya;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.lng]}
                radius={11}
                pathOptions={{
                  color: meta.color,
                  fillColor: meta.color,
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              >
                <Popup>
                  <b>{meta.icon} {p.name}</b><br />
                  Tipe: {meta.label}<br />
                  {p.description && <>{p.description}<br /></>}
                  {p.created_by && <>Dibuat oleh: {p.created_by}<br /></>}
                  Koordinat: {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Draft custom admin point */}
          {draftPoint && (
            <CircleMarker
              center={[draftPoint.lat, draftPoint.lng]}
              radius={13}
              pathOptions={{ color: '#facc15', fillColor: '#facc15', fillOpacity: 0.9, weight: 3, dashArray: '4,3' }}
            >
              <Popup closeOnClick={false} autoClose={false}>
                <div style={{ minWidth: 220 }}>
                  <b>➕ Titik Baru</b><br />
                  <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>
                    {draftPoint.lat.toFixed(6)}, {draftPoint.lng.toFixed(6)}
                  </div>
                  <input
                    value={pointForm.name}
                    onChange={e => setPointForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Nama titik"
                    style={{ width: '100%', marginBottom: 6, padding: 6, borderRadius: 4, border: '1px solid #cbd5e1' }}
                  />
                  <select
                    value={pointForm.type}
                    onChange={e => setPointForm(f => ({ ...f, type: e.target.value }))}
                    style={{ width: '100%', marginBottom: 6, padding: 6, borderRadius: 4, border: '1px solid #cbd5e1' }}
                  >
                    {Object.entries(CUSTOM_POINT_META).map(([key, meta]) => (
                      <option key={key} value={key}>{meta.icon} {meta.label}</option>
                    ))}
                  </select>
                  <textarea
                    value={pointForm.description}
                    onChange={e => setPointForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Deskripsi / catatan lokasi"
                    rows={3}
                    style={{ width: '100%', marginBottom: 6, padding: 6, borderRadius: 4, border: '1px solid #cbd5e1', resize: 'vertical' }}
                  />
                  {pointError && <div style={{ color: '#ef4444', fontSize: 11, marginBottom: 6 }}>{pointError}</div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={handleSaveCustomPoint} disabled={savingPoint} style={{ flex: 1, padding: 6, borderRadius: 4, border: 0, background: '#06b6d4', color: '#fff', cursor: 'pointer' }}>
                      {savingPoint ? 'Menyimpan...' : 'Simpan'}
                    </button>
                    <button onClick={() => setDraftPoint(null)} disabled={savingPoint} style={{ flex: 1, padding: 6, borderRadius: 4, border: 0, background: '#64748b', color: '#fff', cursor: 'pointer' }}>
                      Batal
                    </button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )}

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
                  Level: <b>{(s.water_level_cm || 0).toFixed(1)} cm</b><br />
                  Δ3m: {(s.delta_3m || 0) > 0 ? '+' : ''}{(s.delta_3m || 0).toFixed(1)} cm<br />
                  Quality: {s.quality?.toUpperCase()}<br />
                  Kode: {s.code}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}

function AdminPointClickHandler({ enabled, onSelect }: { enabled: boolean; onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}
