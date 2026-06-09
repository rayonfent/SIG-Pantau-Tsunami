import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, Popup, CircleMarker, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, dataApi, mapApi } from '../utils/api';
import { ROUTE_COLORS, FACILITY_COLORS, FACILITY_ICONS, FACILITY_LABELS, EQUIPMENT_ICONS, EQUIPMENT_LABELS } from '../utils/constants';
import { EvacRoute, Facility, HeavyEquipment, MapSensor, MapSiren, SafeZone, User } from '../types';

function StateBox({ loading, error, empty, onRefresh }: { loading: boolean; error: string; empty?: boolean; onRefresh?: () => void }) {
  return (
    <>
      {loading && <div className="infobox">Memuat data...</div>}
      {error && <div className="infobox" style={{ borderColor: '#ef4444', color: '#ef4444' }}>{error}</div>}
      {!loading && !error && empty && <div className="text-dim" style={{ padding: 12, fontSize: 12 }}>Belum ada data.</div>}
      {onRefresh && <button className="btn btn-outline btn-sm" onClick={onRefresh} disabled={loading}>Refresh</button>}
    </>
  );
}

function useLoad<T>(loader: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { setData(await loader()); } catch { setError('Gagal memuat data dari backend.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return { data, loading, error, load, setData };
}

const routeColor = (status: string) => {
  if (status === 'maintenance') return '#94a3b8';
  if (status === 'blocked') return '#ef4444';
  if (status === 'warning' || status === 'congested') return '#f97316';
  return ROUTE_COLORS[status] || '#22c55e';
};

const toLatLng = ([lng, lat]: [number, number]): [number, number] => [lat, lng];
const routeCoords = (route: EvacRoute): [number, number][] => route.geometry?.coordinates || route.coordinates || [];
const zoneCoords = (zone: SafeZone): [number, number][] => zone.geometry?.coordinates?.[0] || zone.coordinates || [];
const ROUTE_STATUS_OPTIONS = ['clear', 'warning', 'blocked', 'maintenance'];
type RouteCoordinate = [number, number];

const isValidRouteCoordinate = ([lng, lat]: RouteCoordinate) => (
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
  lat >= PROJECT_BOUNDS.minLat && lat <= PROJECT_BOUNDS.maxLat &&
  lng >= PROJECT_BOUNDS.minLng && lng <= PROJECT_BOUNDS.maxLng
);

const parseCoordinateInput = (value: string) => Number(String(value).replace(',', '.'));

const reverseGeocode = async (lat: number, lng: number) => {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Gagal mengambil alamat otomatis.');
  const data = await response.json();
  return data?.display_name || '';
};

const routeDistancePreview = (coords: RouteCoordinate[]) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  let meters = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const [lng1, lat1] = coords[i - 1];
    const [lng2, lat2] = coords[i];
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    meters += 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return meters;
};

const editableRouteWaypoints = (route: EvacRoute | null): RouteCoordinate[] => {
  const coords = route ? routeCoords(route) : [];
  if (coords.length <= 12) return coords;
  const sampled: RouteCoordinate[] = [];
  const targetPoints = Math.min(12, coords.length);
  const step = (coords.length - 1) / (targetPoints - 1);
  for (let index = 0; index < targetPoints; index += 1) {
    const coord = coords[Math.round(index * step)];
    if (!coord) continue;
    if (!sampled.length || sampled[sampled.length - 1][0] !== coord[0] || sampled[sampled.length - 1][1] !== coord[1]) {
      sampled.push(coord);
    }
  }
  if (sampled.length < 2 && coords.length >= 2) return [coords[0], coords[coords.length - 1]];
  return sampled;
};

const fetchRoadRoute = async (waypoints: RouteCoordinate[]): Promise<RouteCoordinate[]> => {
  if (waypoints.length < 2) return waypoints;
  const coordinateText = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinateText}?overview=full&geometries=geojson&continue_straight=false`);
  if (!response.ok) throw new Error('Router OSRM tidak merespons.');
  const data = await response.json();
  const coordinates = data?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('Router OSRM tidak menemukan jalur jalan.');
  return coordinates.map(([lng, lat]: [number, number]) => [Number(lng), Number(lat)] as RouteCoordinate).filter(isValidRouteCoordinate);
};

function RouteDrawHandler({ onAdd }: { onAdd: (coord: RouteCoordinate) => void }) {
  useMapEvents({
    click(e) {
      onAdd([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

function EvacuationMapFocus({ selectedRoute, selectedZone }: { selectedRoute: EvacRoute | null; selectedZone: SafeZone | null }) {
  const map = useMap();
  useEffect(() => {
    const coords = selectedRoute ? routeCoords(selectedRoute) : selectedZone ? zoneCoords(selectedZone) : [];
    if (!coords.length) return;
    map.fitBounds(coords.map(toLatLng), { padding: [30, 30], maxZoom: 16 });
  }, [map, selectedRoute, selectedZone]);
  return null;
}

function EvacRouteModal({
  route, onClose, onSaved,
}: {
  route: EvacRoute | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: route?.name || '',
    direction: route?.direction || '',
    description: route?.description || route?.notes || '',
    capacity_persons: route?.capacity_persons || 500,
    estimated_time_min: route?.estimated_time_min || '',
    status: route?.status || 'clear',
    priority: route?.priority || 1,
  });
  const initialWaypoints = editableRouteWaypoints(route);
  const [waypoints, setWaypoints] = useState<RouteCoordinate[]>(initialWaypoints);
  const [coords, setCoords] = useState<RouteCoordinate[]>(route ? routeCoords(route) : []);
  const [manualPoint, setManualPoint] = useState({ latitude: '', longitude: '' });
  const [routing, setRouting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const previewMeters = routeDistancePreview(coords);
  const lineColor = routeColor(form.status);

  const rebuildRoadRoute = async (nextWaypoints: RouteCoordinate[]) => {
    setRouting(true);
    try {
      const roadCoords = await fetchRoadRoute(nextWaypoints);
      setCoords(roadCoords);
      setNotice('Jalur berhasil mengikuti jaringan jalan besar.');
      setError('');
      return roadCoords;
    } catch (err: any) {
      setCoords(nextWaypoints);
      setNotice('Jalur sementara ditampilkan sebagai garis langsung karena router jalan tidak tersedia.');
      setError(err?.message || 'Gagal membuat jalur mengikuti jalan.');
      return nextWaypoints;
    } finally {
      setRouting(false);
    }
  };

  const addManualCoord = async () => {
    const latitude = parseCoordinateInput(manualPoint.latitude);
    const longitude = parseCoordinateInput(manualPoint.longitude);
    await addCoord([longitude, latitude]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) setManualPoint({ latitude: '', longitude: '' });
  };

  const addCoord = async (coord: RouteCoordinate) => {
    if (!isValidRouteCoordinate(coord)) {
      setError('Titik berada di luar area operasional Bandar Lampung.');
      return;
    }
    const nextWaypoints = [...waypoints, coord];
    setWaypoints(nextWaypoints);
    if (nextWaypoints.length >= 2) {
      await rebuildRoadRoute(nextWaypoints);
    } else {
      setCoords(nextWaypoints);
      setNotice('Titik awal rute ditambahkan. Tambahkan titik tujuan agar jalur mengikuti jalan.');
      setError('');
    }
  };

  const validate = () => {
    if (!form.name.trim()) return 'Nama jalur wajib diisi.';
    if (!form.direction.trim()) return 'Arah jalur wajib diisi.';
    if (Number(form.capacity_persons) <= 0) return 'Kapasitas wajib lebih besar dari 0.';
    if (!ROUTE_STATUS_OPTIONS.includes(form.status)) return 'Status wajib valid.';
    if (Number(form.priority) < 1 || Number(form.priority) > 5) return 'Prioritas wajib 1 sampai 5.';
    if (waypoints.length < 2) return 'Rute wajib memiliki minimal dua titik.';
    if (!waypoints.every(isValidRouteCoordinate)) return 'Ada titik rute di luar area operasional Bandar Lampung.';
    return '';
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const roadCoords = await rebuildRoadRoute(waypoints);
      const estimated = form.estimated_time_min === '' ? null : Number(form.estimated_time_min);
      const payload = {
        name: form.name.trim(),
        direction: form.direction.trim(),
        description: form.description.trim(),
        capacity_persons: Number(form.capacity_persons),
        estimated_time_min: estimated,
        status: form.status,
        priority: Number(form.priority),
        coordinates: roadCoords,
      };
      if (route) await dataApi.updateRoute(route.id, payload);
      else await dataApi.createRoute(payload);
      onSaved(route ? 'Jalur evakuasi berhasil diperbarui.' : 'Jalur evakuasi berhasil ditambahkan.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Gagal menyimpan jalur evakuasi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(2,8,23,0.78)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="card" style={{ width:'min(1040px, 96vw)', maxHeight:'92vh', overflow:'auto' }}>
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin:0 }}>{route ? 'Edit' : 'Tambah'} Jalur Evakuasi</div>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Batal</button>
        </div>
        {notice && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{notice}</div>}
        {error && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{error}</div>}
        <div className="grid-2">
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label className="text-dim" style={{ fontSize:11 }}>Nama Jalur *</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} />
            <label className="text-dim" style={{ fontSize:11 }}>Arah Jalur *</label>
            <input className="form-input" value={form.direction} onChange={e => setForm(f => ({ ...f, direction:e.target.value }))} />
            <label className="text-dim" style={{ fontSize:11 }}>Keterangan</label>
            <textarea className="form-input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description:e.target.value }))} />
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Kapasitas Orang *</label><input className="form-input" type="number" value={form.capacity_persons} onChange={e => setForm(f => ({ ...f, capacity_persons:Number(e.target.value) }))} /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Estimasi Menit</label><input className="form-input" type="number" value={form.estimated_time_min} onChange={e => setForm(f => ({ ...f, estimated_time_min:e.target.value }))} /></div>
            </div>
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Status *</label><select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status:e.target.value as any }))}>{ROUTE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Prioritas *</label><select className="form-input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority:Number(e.target.value) }))}>{[1,2,3,4,5].map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            </div>
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Latitude Waypoint</label><input className="form-input" value={manualPoint.latitude} onChange={e => setManualPoint(p => ({ ...p, latitude:e.target.value }))} placeholder="-5.468900" /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Longitude Waypoint</label><input className="form-input" value={manualPoint.longitude} onChange={e => setManualPoint(p => ({ ...p, longitude:e.target.value }))} placeholder="105.319700" /></div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={addManualCoord} disabled={saving || routing}>Tambah Waypoint dari Koordinat</button>
            <div className="infobox" style={{ fontSize:11 }}>
              Waypoint admin: {waypoints.length}<br />
              Titik hasil routing jalan: {coords.length}<br />
              Jarak estimasi mengikuti jalan: {(previewMeters / 1000).toFixed(2)} km<br />
              Status: {form.status.toUpperCase()}<br />
              Prioritas: {form.priority}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving || routing || waypoints.length < 2}>{saving ? 'Menyimpan...' : routing ? 'Routing...' : 'Simpan'}</button>
              <button className="btn btn-outline" onClick={() => { const next = waypoints.slice(0, -1); setWaypoints(next); if (next.length >= 2) rebuildRoadRoute(next); else setCoords(next); }} disabled={saving || routing || waypoints.length === 0}>Hapus Waypoint Terakhir</button>
              <button className="btn btn-outline" onClick={() => { setWaypoints([]); setCoords([]); setNotice('Rute direset.'); }} disabled={saving || routing || waypoints.length === 0}>Reset Rute</button>
              <button className="btn btn-outline" onClick={onClose} disabled={saving || routing}>Batal</button>
            </div>
          </div>
          <div>
            <div className="text-dim" style={{ fontSize:11, marginBottom:8 }}>Klik peta untuk menambah waypoint. Sistem akan membentuk jalur mengikuti jaringan jalan. Pilih titik di jalan utama agar hasil routing mengikuti jalan besar.</div>
            <div style={{ height:420, borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0' }}>
              <MapContainer center={coords[0] ? toLatLng(coords[0]) : DEFAULT_PANJANG_CENTER} zoom={coords[0] ? 14 : 13} style={{ height:'100%', width:'100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <RouteDrawHandler onAdd={addCoord} />
                {coords.length >= 2 && <Polyline positions={coords.map(toLatLng)} pathOptions={{ color: lineColor, weight:5, opacity:0.9 }} />}
                {waypoints.map((coord, idx) => (
                  <CircleMarker key={`${coord[0]}-${coord[1]}-${idx}`} center={toLatLng(coord)} radius={idx === 0 || idx === waypoints.length - 1 ? 8 : 5} pathOptions={{ color: idx === 0 ? '#22c55e' : idx === waypoints.length - 1 ? '#ef4444' : '#0f4c81', fillColor:'#ffffff', fillOpacity:1, weight:3 }}>
                    <Popup>{idx === 0 ? 'Waypoint awal' : idx === waypoints.length - 1 ? 'Waypoint tujuan' : `Waypoint ${idx + 1}`}<br />{coord[1].toFixed(6)}, {coord[0].toFixed(6)}</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROJECT_BOUNDS = {
  minLat: -5.70,
  maxLat: -5.20,
  minLng: 104.90,
  maxLng: 105.60,
};
const DEFAULT_PANJANG_CENTER: [number, number] = [-5.4689, 105.3197];
const FACILITY_TYPE_OPTIONS = ['medis', 'polisi', 'damkar', 'sar', 'posko_evakuasi', 'sekolah', 'tempat_ibadah', 'fasilitas_umum', 'lainnya'];
const EQUIPMENT_TYPE_OPTIONS = ['ambulance', 'excavator', 'truk_evakuasi', 'mobil_sar', 'perahu_karet', 'alat_berat_lainnya', 'lainnya'];
const EQUIPMENT_STATUS_OPTIONS = ['available', 'in_use', 'maintenance', 'unavailable'];

const pointLat = (item: { latitude?: number; lat?: number }) => Number(item.latitude ?? item.lat);
const pointLng = (item: { longitude?: number; lng?: number }) => Number(item.longitude ?? item.lng);

const isValidPoint = (item: { latitude?: number; longitude?: number; lat?: number; lng?: number }) => {
  const latitude = pointLat(item);
  const longitude = pointLng(item);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= PROJECT_BOUNDS.minLat &&
    latitude <= PROJECT_BOUNDS.maxLat &&
    longitude >= PROJECT_BOUNDS.minLng &&
    longitude <= PROJECT_BOUNDS.maxLng
  );
};

const coordinateText = (item: { latitude?: number; longitude?: number; lat?: number; lng?: number }, digits = 4) => {
  if (!isValidPoint(item)) return 'Lokasi belum terverifikasi';
  return `${pointLat(item).toFixed(digits)}, ${pointLng(item).toFixed(digits)}`;
};

const validationText = (item: { latitude?: number; longitude?: number; lat?: number; lng?: number; location_status?: string }) => {
  if (!Number.isFinite(pointLat(item)) || !Number.isFinite(pointLng(item))) return 'Koordinat tidak lengkap';
  if (!isValidPoint(item)) return 'Di luar area validasi Panjang/Bandar Lampung';
  if (item.location_status === 'verified_area') return 'Terverifikasi area lokal';
  return 'Terverifikasi frontend';
};

const closePolygon = (coords: RouteCoordinate[]) => {
  if (!coords.length) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords;
  return [...coords, first];
};

const safeZoneCoordinates = (zone: SafeZone | null): RouteCoordinate[] => {
  if (!zone) return [];
  const coords = zoneCoords(zone);
  if (coords.length < 2) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return coords.slice(0, -1);
  return coords;
};

const isValidZoneCoordinate = (coord: RouteCoordinate) => isValidRouteCoordinate(coord);

const facilityIcon = (type: string) => FACILITY_ICONS[type] || FACILITY_ICONS.lainnya || 'FAS';
const facilityLabel = (type: string) => FACILITY_LABELS[type] || type || 'Lainnya';
const assetIcon = (type: string) => EQUIPMENT_ICONS[type] || EQUIPMENT_ICONS.lainnya || 'AST';
const assetLabel = (type: string) => EQUIPMENT_LABELS[type] || type || 'Lainnya';

const markerIcon = (label: string, color: string) => L.divIcon({
  className: 'asset-div-icon',
  html: `<div style="background:${color};color:#ffffff;border:2px solid #ffffff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;box-shadow:0 4px 12px rgba(15,23,42,.18)">${label}</div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17],
});

function LocationPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

const equipmentColor = (status: string) => {
  if (status === 'available') return '#22c55e';
  if (status === 'in_use') return '#f97316';
  if (status === 'unavailable' || status === 'maintenance') return '#ef4444';
  return '#94a3b8';
};

const equipmentIcon = (type: string) => {
  const t = (type || '').toLowerCase();
  if (t.includes('ambulance')) return '🚑';
  if (t.includes('excavator')) return '🚜';
  if (t.includes('truk') || t.includes('truck')) return '🚚';
  return '🚧';
};

function FacilitiesMapFocus({ selected }: { selected: { latitude?: number; longitude?: number; lat?: number; lng?: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!selected || !isValidPoint(selected)) return;
    map.setView([pointLat(selected), pointLng(selected)], 16, { animate: true });
  }, [map, selected]);
  return null;
}

function FacilitiesFitBounds({ facilities, equipment }: { facilities: Facility[]; equipment: HeavyEquipment[] }) {
  const map = useMap();
  useEffect(() => {
    const points = [...facilities, ...equipment].filter(isValidPoint).map((p) => [pointLat(p), pointLng(p)] as [number, number]);
    if (!points.length) return;
    map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
  }, [map, facilities, equipment]);
  return null;
}

type FacilityAssetKind = 'facility' | 'equipment';

function SafeZoneModal({
  zone, onClose, onSaved,
}: {
  zone: SafeZone | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: zone?.name || '',
    elevation_m: zone?.elevation_m ?? 0,
    capacity: zone?.capacity ?? 0,
    current_count: zone?.current_count ?? 0,
    facilities: zone?.facilities?.join(', ') || '',
  });
  const [coords, setCoords] = useState<RouteCoordinate[]>(safeZoneCoordinates(zone));
  const [manualPoint, setManualPoint] = useState({ latitude: '', longitude: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const polygonPreview = closePolygon(coords);

  const addManualCoord = () => {
    const latitude = parseCoordinateInput(manualPoint.latitude);
    const longitude = parseCoordinateInput(manualPoint.longitude);
    addCoord([longitude, latitude]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) setManualPoint({ latitude: '', longitude: '' });
  };

  const addCoord = (coord: RouteCoordinate) => {
    if (!isValidZoneCoordinate(coord)) {
      setError('Titik zona aman berada di luar area operasional Bandar Lampung.');
      return;
    }
    setCoords(prev => [...prev, coord]);
    setNotice('Titik batas zona aman ditambahkan.');
    setError('');
  };

  const validate = () => {
    if (!form.name.trim()) return 'Nama zona aman wajib diisi.';
    if (Number(form.capacity) < 0) return 'Kapasitas tidak boleh negatif.';
    if (Number(form.current_count) < 0) return 'Jumlah penghuni saat ini tidak boleh negatif.';
    if (coords.length < 3) return 'Zona aman membutuhkan minimal 3 titik.';
    if (!coords.every(isValidZoneCoordinate)) return 'Ada titik zona aman di luar area operasional Bandar Lampung.';
    return '';
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        elevation_m: Number(form.elevation_m),
        capacity: Number(form.capacity),
        current_count: Number(form.current_count),
        facilities: form.facilities.split(',').map(item => item.trim()).filter(Boolean),
        is_active: true,
        notes: '',
        coordinates: closePolygon(coords),
      };
      if (zone) await dataApi.updateSafeZone(zone.id, payload);
      else await dataApi.createSafeZone(payload);
      onSaved(zone ? 'Zona aman berhasil diperbarui.' : 'Zona aman berhasil ditambahkan.');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Gagal menyimpan zona aman.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(2,8,23,0.78)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="card" style={{ width:'min(1040px, 96vw)', maxHeight:'92vh', overflow:'auto' }}>
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin:0 }}>{zone ? 'Edit' : 'Tambah'} Zona Aman</div>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Batal</button>
        </div>
        {notice && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{notice}</div>}
        {error && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{error}</div>}
        <div className="grid-2">
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label className="text-dim" style={{ fontSize:11 }}>Nama Zona Aman *</label>
            <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name:e.target.value }))} />
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Elevasi (m)</label><input className="form-input" type="number" value={form.elevation_m} onChange={e => setForm(f => ({ ...f, elevation_m:Number(e.target.value) }))} /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Kapasitas</label><input className="form-input" type="number" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity:Number(e.target.value) }))} /></div>
            </div>
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Jumlah Saat Ini</label><input className="form-input" type="number" value={form.current_count} onChange={e => setForm(f => ({ ...f, current_count:Number(e.target.value) }))} /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Jumlah Titik</label><input className="form-input" readOnly value={coords.length} /></div>
            </div>
            <label className="text-dim" style={{ fontSize:11 }}>Fasilitas (pisahkan dengan koma)</label>
            <textarea className="form-input" rows={3} value={form.facilities} onChange={e => setForm(f => ({ ...f, facilities:e.target.value }))} />
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Latitude Titik Zona</label><input className="form-input" value={manualPoint.latitude} onChange={e => setManualPoint(p => ({ ...p, latitude:e.target.value }))} placeholder="-5.468900" /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Longitude Titik Zona</label><input className="form-input" value={manualPoint.longitude} onChange={e => setManualPoint(p => ({ ...p, longitude:e.target.value }))} placeholder="105.319700" /></div>
            </div>
            <button className="btn btn-outline btn-sm" onClick={addManualCoord} disabled={saving}>Tambah Titik dari Koordinat</button>
            <div className="infobox" style={{ fontSize:11 }}>
              Klik peta untuk menambah titik batas zona aman. Minimal 3 titik untuk membentuk polygon.
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving || coords.length < 3}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              <button className="btn btn-outline" onClick={() => { setCoords(prev => prev.slice(0, -1)); setNotice('Titik terakhir dihapus.'); }} disabled={saving || coords.length === 0}>Hapus Titik Terakhir</button>
              <button className="btn btn-outline" onClick={() => { setCoords([]); setNotice('Batas zona aman direset.'); }} disabled={saving || coords.length === 0}>Reset Zona</button>
              <button className="btn btn-outline" onClick={onClose} disabled={saving}>Batal</button>
            </div>
          </div>
          <div>
            <div className="text-dim" style={{ fontSize:11, marginBottom:8 }}>Klik peta untuk menggambar area aman. Gunakan beberapa titik agar bentuk area sesuai kondisi lapangan.</div>
            <div style={{ height:420, borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0' }}>
              <MapContainer center={coords[0] ? toLatLng(coords[0]) : DEFAULT_PANJANG_CENTER} zoom={coords[0] ? 15 : 13} style={{ height:'100%', width:'100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <RouteDrawHandler onAdd={addCoord} />
                {polygonPreview.length >= 3 && <Polygon positions={polygonPreview.map(toLatLng)} pathOptions={{ color:'#22c55e', fillOpacity:0.22, weight:3 }} />}
                {coords.map((coord, idx) => (
                  <CircleMarker key={`${coord[0]}-${coord[1]}-${idx}`} center={toLatLng(coord)} radius={idx === 0 ? 7 : 5} pathOptions={{ color:'#22c55e', fillColor:'#ffffff', fillOpacity:1, weight:3 }}>
                    <Popup>Titik {idx + 1}<br />{coord[1].toFixed(6)}, {coord[0].toFixed(6)}</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacilityAssetModal({
  kind, item, onClose, onSaved,
}: {
  kind: FacilityAssetKind;
  item: Facility | HeavyEquipment | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isEquipment = kind === 'equipment';
  const [form, setForm] = useState({
    name: item?.name || '',
    type: item?.type || (isEquipment ? 'ambulance' : 'medis'),
    address: (item as Facility | null)?.address || '',
    phone: (item as Facility | null)?.phone || '',
    status: (item as HeavyEquipment | null)?.status || 'available',
    description: item?.description || item?.notes || '',
    latitude: item ? pointLat(item) : NaN,
    longitude: item ? pointLng(item) : NaN,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const hasPoint = Number.isFinite(form.latitude) && Number.isFinite(form.longitude);
  const selectedPoint = hasPoint ? { latitude: form.latitude, longitude: form.longitude } : null;
  const color = isEquipment ? equipmentColor(form.status) : FACILITY_COLORS[form.type] || '#757575';
  const iconLabel = isEquipment ? assetIcon(form.type) : facilityIcon(form.type);

  const setField = (key: string, value: string | number) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  const pickLocation = async (latitude: number, longitude: number) => {
    setForm(prev => ({ ...prev, latitude, longitude }));
    setNotice('Titik lokasi berhasil dipilih. Mengambil alamat otomatis...');
    setError('');
    try {
      const address = await reverseGeocode(latitude, longitude);
      if (address) {
        setForm(prev => ({ ...prev, latitude, longitude, address: isEquipment ? prev.address : address }));
        setNotice(isEquipment ? 'Titik lokasi berhasil dipilih.' : 'Titik lokasi berhasil dipilih dan alamat otomatis terisi.');
      } else {
        setNotice('Titik lokasi berhasil dipilih, tetapi alamat otomatis tidak ditemukan.');
      }
    } catch {
      setNotice('Titik lokasi berhasil dipilih, tetapi alamat otomatis gagal dimuat.');
    }
  };

  const validate = () => {
    if (!form.name.trim()) return 'Nama wajib diisi.';
    if (!form.type) return isEquipment ? 'Jenis aset wajib dipilih.' : 'Jenis fasilitas wajib dipilih.';
    if (!isEquipment && !form.address.trim()) return 'Alamat wajib diisi.';
    if (!hasPoint) return 'Lokasi wajib dipilih pada peta.';
    if (!isValidPoint({ latitude: form.latitude, longitude: form.longitude })) return 'Lokasi berada di luar area operasional Bandar Lampung.';
    return '';
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = isEquipment ? {
        name: form.name.trim(),
        type: form.type,
        status: form.status,
        description: form.description.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
      } : {
        name: form.name.trim(),
        type: form.type,
        address: form.address.trim(),
        phone: form.phone.trim(),
        description: form.description.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        is_active: true,
      };
      if (isEquipment) {
        if (item) await dataApi.updateEquipment(item.id, payload);
        else await dataApi.createEquipment(payload);
      } else {
        if (item) await dataApi.updateFacility(item.id, payload);
        else await dataApi.createFacility(payload);
      }
      onSaved(isEquipment ? (item ? 'Aset berhasil diperbarui.' : 'Aset berhasil ditambahkan.') : (item ? 'Fasilitas berhasil diperbarui.' : 'Fasilitas berhasil ditambahkan.'));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Gagal menyimpan data. Silakan coba kembali.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(2,8,23,0.78)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="card" style={{ width:'min(960px, 96vw)', maxHeight:'92vh', overflow:'auto' }}>
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin:0 }}>{item ? 'Edit' : 'Tambah'} {isEquipment ? 'Aset' : 'Fasilitas'}</div>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Batal</button>
        </div>
        {notice && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{notice}</div>}
        {error && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{error}</div>}
        <div className="grid-2">
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label className="text-dim" style={{ fontSize:11 }}>Nama {isEquipment ? 'Aset' : 'Fasilitas'} *</label>
            <input className="form-input" value={form.name} onChange={e => setField('name', e.target.value)} />
            <label className="text-dim" style={{ fontSize:11 }}>Jenis *</label>
            <select className="form-input" value={form.type} onChange={e => setField('type', e.target.value)}>
              {(isEquipment ? EQUIPMENT_TYPE_OPTIONS : FACILITY_TYPE_OPTIONS).map(type => <option key={type} value={type}>{isEquipment ? assetIcon(type) : facilityIcon(type)} {isEquipment ? assetLabel(type) : facilityLabel(type)}</option>)}
            </select>
            <div className="infobox" style={{ fontSize:11 }}>Ikon marker: <b>{iconLabel}</b> {isEquipment ? assetLabel(form.type) : facilityLabel(form.type)}</div>
            {!isEquipment && (
              <>
                <label className="text-dim" style={{ fontSize:11 }}>Alamat *</label>
                <input className="form-input" value={form.address} onChange={e => setField('address', e.target.value)} />
                <label className="text-dim" style={{ fontSize:11 }}>Nomor Telepon</label>
                <input className="form-input" value={form.phone} onChange={e => setField('phone', e.target.value)} />
              </>
            )}
            {isEquipment && (
              <>
                <label className="text-dim" style={{ fontSize:11 }}>Status *</label>
                <select className="form-input" value={form.status} onChange={e => setField('status', e.target.value)}>
                  <option value="available">Available</option>
                  <option value="in_use">In Use</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </>
            )}
            <label className="text-dim" style={{ fontSize:11 }}>Keterangan</label>
            <textarea className="form-input" rows={4} value={form.description} onChange={e => setField('description', e.target.value)} />
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Latitude *</label><input className="form-input" value={Number.isFinite(form.latitude) ? String(form.latitude) : ''} onChange={e => setField('latitude', parseCoordinateInput(e.target.value))} placeholder="-5.468900" /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Longitude *</label><input className="form-input" value={Number.isFinite(form.longitude) ? String(form.longitude) : ''} onChange={e => setField('longitude', parseCoordinateInput(e.target.value))} placeholder="105.319700" /></div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              <button className="btn btn-outline" onClick={() => { setForm(prev => ({ ...prev, latitude: NaN, longitude: NaN })); setNotice('Titik lokasi direset.'); }} disabled={saving}>Reset Titik</button>
              <button className="btn btn-outline" onClick={onClose} disabled={saving}>Batal</button>
            </div>
          </div>
          <div>
            <div className="text-dim" style={{ fontSize:11, marginBottom:8 }}>Klik peta untuk memilih atau memindahkan titik.</div>
            <div style={{ height:380, borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0' }}>
              <MapContainer center={selectedPoint ? [form.latitude, form.longitude] : DEFAULT_PANJANG_CENTER} zoom={selectedPoint ? 16 : 13} style={{ height:'100%', width:'100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <LocationPicker onPick={pickLocation} />
                {selectedPoint && (
                  <Marker
                    position={[form.latitude, form.longitude]}
                    icon={markerIcon(iconLabel, color)}
                    draggable
                    eventHandlers={{ dragend: (e) => {
                      const ll = e.target.getLatLng();
                      pickLocation(ll.lat, ll.lng);
                    } }}
                  >
                    <Popup>Preview lokasi<br />{form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}</Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Evakuasi({ sirenActive, user }: any) {
  const routes = useLoad<EvacRoute[]>(async () => (await dataApi.routes()).data.routes, []);
  const safeZones = useLoad<SafeZone[]>(async () => (await dataApi.safeZones()).data.safe_zones, []);
  const recommended = useLoad<any>(async () => (await dataApi.recommendedRoutes()).data, null);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [selectedZoneId, setSelectedZoneId] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [routeModal, setRouteModal] = useState<EvacRoute | null | undefined>(undefined);
  const [zoneModal, setZoneModal] = useState<SafeZone | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const isAdmin = user?.role === 'admin';
  const selectedRoute = useMemo(() => routes.data.find(r => r.id === selectedRouteId) || null, [routes.data, selectedRouteId]);
  const selectedZone = useMemo(() => safeZones.data.find(z => z.id === selectedZoneId) || null, [safeZones.data, selectedZoneId]);
  const mapCenter: [number, number] = [-5.4712, 105.2756];
  useEffect(() => {
    if (!routes.loading && !safeZones.loading && !lastUpdated) {
      setLastUpdated(new Date().toLocaleString('id-ID'));
    }
  }, [routes.loading, safeZones.loading, lastUpdated]);
  const refreshAll = async () => {
    await Promise.all([routes.load(), safeZones.load(), recommended.load()]);
    setLastUpdated(new Date().toLocaleString('id-ID'));
  };
  const handleRouteSaved = async (msg: string) => {
    setRouteModal(undefined);
    setMessage(msg);
    setActionError('');
    await refreshAll();
  };
  const deleteRoute = async (route: EvacRoute) => {
    if (!isAdmin) {
      setActionError('Anda tidak memiliki izin untuk mengubah jalur evakuasi.');
      return;
    }
    if (!window.confirm(`Hapus ${route.name}?`)) return;
    setActionError('');
    try {
      await dataApi.deleteRoute(route.id);
      if (selectedRouteId === route.id) setSelectedRouteId('');
      setMessage('Jalur evakuasi berhasil dihapus.');
      await refreshAll();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal menghapus jalur evakuasi.');
    }
  };
  const deleteZone = async (zone: SafeZone) => {
    if (!isAdmin) {
      setActionError('Anda tidak memiliki izin untuk mengubah zona aman.');
      return;
    }
    if (!window.confirm(`Hapus ${zone.name}?`)) return;
    setActionError('');
    try {
      await dataApi.deleteSafeZone(zone.id);
      if (selectedZoneId === zone.id) setSelectedZoneId('');
      setMessage('Zona aman berhasil dihapus.');
      await refreshAll();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal menghapus zona aman.');
    }
  };
  return (
    <div className="page-section">
      {routeModal !== undefined && <EvacRouteModal route={routeModal} onClose={() => setRouteModal(undefined)} onSaved={handleRouteSaved} />}
      {zoneModal !== undefined && <SafeZoneModal zone={zoneModal} onClose={() => setZoneModal(undefined)} onSaved={async (msg) => { setZoneModal(undefined); setMessage(msg); setActionError(''); await refreshAll(); }} />}
      {sirenActive && <div style={{ padding:16, borderRadius:8, background:'rgba(239,68,68,0.15)', border:'1px solid #ef4444', color:'#ef4444', fontWeight:700, textAlign:'center', fontSize:14, animation:'blink 1s infinite' }}>SIRINE AKTIF - SEGERA EVAKUASI SEKARANG</div>}
      <div className="flex justify-between items-center mb-12"><div className="text-dim">Data jalur dan zona aman dari database. Last update: {lastUpdated || '-'}</div><div style={{ display:'flex', gap:8 }}>{isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setRouteModal(null)}>+ Tambah Jalur Evakuasi</button>}{isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setZoneModal(null)}>+ Tambah Zona Aman</button>}<button className="btn btn-outline btn-sm" onClick={refreshAll} disabled={routes.loading || safeZones.loading}>Refresh</button></div></div>
      {!isAdmin && <div className="infobox">Anda masuk sebagai {user?.role?.toUpperCase() || 'USER'}. Jalur evakuasi hanya dapat diubah oleh Admin.</div>}
      {message && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{message}</div>}
      {actionError && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{actionError}</div>}
      <div className="grid-2">
        <div className="card">
          <div className="card-title">Jalur Evakuasi</div>
          <StateBox loading={routes.loading} error={routes.error} empty={routes.data.length === 0} />
          {!routes.loading && routes.data.length === 0 && <div className="text-dim" style={{ padding:12 }}>Belum ada jalur evakuasi terverifikasi. Silakan tambahkan jalur melalui akun Admin.</div>}
          {routes.data.map(r => (
            <div key={r.id} className="route-item" onClick={() => { setSelectedRouteId(r.id); setSelectedZoneId(''); }} style={{ cursor: 'pointer', borderColor: selectedRouteId === r.id ? routeColor(r.status) : undefined, background: selectedRouteId === r.id ? `${routeColor(r.status)}12` : undefined }}>
              <div className="route-status-dot" style={{ background: routeColor(r.status) }} />
              <div style={{ flex:1 }}>
                <div className="route-name">{r.name}</div>
                <div className="route-meta">{r.direction || '-'} · {(Number(r.distance_m || 0)/1000).toFixed(1)} km · Est. {r.estimated_time_min || '-'} menit · Kapasitas {r.capacity_persons}</div>
              </div>
              <span className="badge" style={{ background: routeColor(r.status)+'22', color: routeColor(r.status) }}>{r.status.toUpperCase()}</span>
              {isAdmin && <div onClick={e => e.stopPropagation()} style={{ display:'flex', gap:6, marginLeft:8 }}><button className="btn btn-outline btn-sm" onClick={() => setRouteModal(r)}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteRoute(r)}>Hapus</button></div>}
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">Titik Kumpul & Zona Aman</div>
          <StateBox loading={safeZones.loading} error={safeZones.error} empty={safeZones.data.length === 0} />
          {safeZones.data.map(s => (
            <div key={s.id} onClick={() => { setSelectedZoneId(s.id); setSelectedRouteId(''); }} style={{ padding:'10px 8px', borderBottom:'1px solid #e2e8f0', display:'flex', justifyContent:'space-between', alignItems:'center', cursor:'pointer', background: selectedZoneId === s.id ? 'rgba(25,135,84,0.10)' : 'transparent', borderLeft: selectedZoneId === s.id ? '3px solid #198754' : '3px solid transparent' }}>
              <div>
                <div style={{ fontSize:12, color:'#1f2937', fontWeight:600 }}>{s.name}</div>
                <div style={{ fontSize:11, color:'#475569' }}>Elevasi {s.elevation_m}m · Kapasitas {Number(s.capacity || 0).toLocaleString('id-ID')} · {s.facilities?.join(', ') || '-'}</div>
              </div>
              <div onClick={e => e.stopPropagation()} style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span className="badge" style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>AMAN</span>
                {isAdmin && <div style={{ display:'flex', gap:6 }}><button className="btn btn-outline btn-sm" onClick={() => setZoneModal(s)}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteZone(s)}>Hapus</button></div>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="infobox">Rekomendasi: {recommended.data?.note || 'Memuat rekomendasi jalur...'}</div>
      <div className="card">
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin: 0 }}>PETA RUTE EVAKUASI</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 10, color: '#94a3b8' }}>
            <span><i style={{ display:'inline-block', width:16, height:4, background:'#22c55e', marginRight:4 }} />Clear</span>
            <span><i style={{ display:'inline-block', width:16, height:4, background:'#f97316', marginRight:4 }} />Warning</span>
            <span><i style={{ display:'inline-block', width:16, height:4, background:'#ef4444', marginRight:4 }} />Blocked</span>
          </div>
        </div>
        {(routes.error || safeZones.error) && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>Peta tidak dapat memuat seluruh data evakuasi.</div>}
        {!routes.loading && !safeZones.loading && routes.data.length === 0 && <div className="text-dim" style={{ padding: 12 }}>Belum ada jalur evakuasi terverifikasi. Silakan tambahkan jalur melalui akun Admin.</div>}
        <div style={{ height: 460, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', background: '#0a1628' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <EvacuationMapFocus selectedRoute={selectedRoute} selectedZone={selectedZone} />
            {safeZones.data.map(zone => {
              const coords = zoneCoords(zone);
              if (!coords.length) return null;
              return (
                <Polygon key={zone.id} positions={coords.map(toLatLng)} pathOptions={{ color: selectedZoneId === zone.id ? '#86efac' : '#22c55e', fillOpacity: selectedZoneId === zone.id ? 0.35 : 0.18, weight: selectedZoneId === zone.id ? 3 : 2 }}>
                  <Popup>
                    <b>{zone.name}</b><br />
                    Elevasi: {zone.elevation_m} meter<br />
                    Kapasitas: {Number(zone.capacity || 0).toLocaleString('id-ID')} orang<br />
                    Fasilitas: {zone.facilities?.join(', ') || '-'}
                  </Popup>
                </Polygon>
              );
            })}
            {routes.data.map(route => {
              const coords = routeCoords(route);
              if (coords.length < 2) return null;
              const start = coords[0];
              const end = coords[coords.length - 1];
              const color = routeColor(route.status);
              return (
                <React.Fragment key={route.id}>
                  <Polyline positions={coords.map(toLatLng)} pathOptions={{ color, weight: selectedRouteId === route.id ? 7 : 5, opacity: 0.9 }}>
                    <Popup>
                      <b>{route.name}</b><br />
                      Status: {route.status?.toUpperCase()}<br />
                      Arah: {route.direction || '-'}<br />
                      Keterangan: {route.description || route.notes || '-'}<br />
                      Jarak: {(Number(route.distance_m || 0) / 1000).toFixed(1)} km<br />
                      Estimasi: {route.estimated_time_min || '-'} menit<br />
                      Kapasitas: {Number(route.capacity_persons || 0).toLocaleString('id-ID')} orang<br />
                      Prioritas: {route.priority || '-'}<br />
                      Jumlah titik: {coords.length}
                    </Popup>
                  </Polyline>
                  <CircleMarker center={toLatLng(start)} radius={7} pathOptions={{ color, fillColor:'#ffffff', fillOpacity:1, weight:3 }}>
                    <Popup><b>Titik awal</b><br />{route.name}</Popup>
                  </CircleMarker>
                  <CircleMarker center={toLatLng(end)} radius={8} pathOptions={{ color:'#22c55e', fillColor:color, fillOpacity:0.9, weight:2 }}>
                    <Popup><b>Titik akhir</b><br />{route.name}</Popup>
                  </CircleMarker>
                </React.Fragment>
              );
            })}
          </MapContainer>
        </div>
      </div>
    </div>
  );
}

export function Fasilitas({ user }: { user?: User }) {
  const facilities = useLoad<Facility[]>(async () => (await dataApi.facilities()).data.facilities, []);
  const equipment = useLoad<HeavyEquipment[]>(async () => (await dataApi.equipment()).data.equipment, []);
  const [filter, setFilter] = useState('all');
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');
  const [showFacilities, setShowFacilities] = useState(true);
  const [showEquipment, setShowEquipment] = useState(true);
  const [lastUpdated, setLastUpdated] = useState('');
  const [modal, setModal] = useState<{ kind: FacilityAssetKind; item: Facility | HeavyEquipment | null } | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const isAdmin = user?.role === 'admin';
  const visible = facilities.data.filter(f => filter === 'all' || f.type === filter);
  const validFacilities = visible.filter(isValidPoint);
  const validEquipment = equipment.data.filter(isValidPoint);
  const invalidFacilities = visible.length - validFacilities.length;
  const invalidEquipment = equipment.data.length - validEquipment.length;
  const selectedFacility = facilities.data.find(f => f.id === selectedFacilityId) || null;
  const selectedEquipment = equipment.data.find(e => e.id === selectedEquipmentId) || null;
  const selectedPoint = selectedFacility || selectedEquipment;
  const refreshAll = async () => {
    await Promise.all([facilities.load(), equipment.load()]);
    setLastUpdated(new Date().toLocaleString('id-ID'));
  };
  const handleSaved = async (msg: string) => {
    setModal(null);
    setMessage(msg);
    setActionError('');
    await refreshAll();
  };
  const deleteItem = async (kind: FacilityAssetKind, item: Facility | HeavyEquipment) => {
    if (!isAdmin) {
      setActionError('Anda tidak memiliki izin untuk mengubah data.');
      return;
    }
    if (!window.confirm(`Hapus ${item.name}?`)) return;
    setActionError('');
    try {
      if (kind === 'facility') {
        await dataApi.deleteFacility(item.id);
        if (selectedFacilityId === item.id) setSelectedFacilityId('');
        setMessage('Fasilitas berhasil dihapus.');
      } else {
        await dataApi.deleteEquipment(item.id);
        if (selectedEquipmentId === item.id) setSelectedEquipmentId('');
        setMessage('Aset berhasil dihapus.');
      }
      await refreshAll();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal menghapus data. Silakan coba kembali.');
    }
  };
  useEffect(() => {
    if (!facilities.loading && !equipment.loading && !lastUpdated) {
      setLastUpdated(new Date().toLocaleString('id-ID'));
    }
  }, [facilities.loading, equipment.loading, lastUpdated]);
  return (
    <div className="page-section">
      {modal && <FacilityAssetModal kind={modal.kind} item={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />}
      <div className="flex justify-between items-center mb-12">
        <select className="form-input" style={{ width: 180 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">Semua tipe</option>
          {FACILITY_TYPE_OPTIONS.map(type => <option key={type} value={type}>{facilityLabel(type)}</option>)}
        </select>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind:'facility', item:null })}>+ Tambah Fasilitas</button>}
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind:'equipment', item:null })}>+ Tambah Aset</button>}
          <span className="text-dim" style={{ fontSize: 11 }}>Last update: {lastUpdated || '-'}</span>
          <button className="btn btn-outline btn-sm" onClick={refreshAll} disabled={facilities.loading || equipment.loading}>Refresh</button>
        </div>
      </div>
      {!isAdmin && <div className="infobox">Anda masuk sebagai {user?.role?.toUpperCase() || 'USER'}. Fasilitas dan aset hanya dapat diubah oleh Admin.</div>}
      {message && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{message}</div>}
      {actionError && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{actionError}</div>}
      <div className="card">
        <div className="card-title">Fasilitas Publik</div>
        <StateBox loading={facilities.loading} error={facilities.error} empty={visible.length === 0} />
        {!facilities.loading && visible.length === 0 && <div className="text-dim" style={{ padding:12 }}>Belum ada titik fasilitas. Silakan tambahkan data melalui akun Admin.</div>}
        <table className="data-table"><thead><tr><th>Nama</th><th>Tipe</th><th>Telepon</th><th>Alamat</th><th>Lokasi</th><th>Aksi</th></tr></thead><tbody>
          {visible.map(f => <tr key={f.id} onClick={() => { setSelectedFacilityId(f.id); setSelectedEquipmentId(''); }} style={{ cursor:'pointer', background: selectedFacilityId === f.id ? 'rgba(15,76,129,0.10)' : 'transparent', outline: selectedFacilityId === f.id ? '1px solid rgba(15,76,129,0.25)' : undefined }}><td style={{ color:'#1f2937', fontWeight:600 }}>{facilityIcon(f.type)} {f.name}</td><td><span className="badge" style={{ background: (FACILITY_COLORS[f.type] || '#757575')+'22', color: FACILITY_COLORS[f.type] || '#757575' }}>{facilityLabel(f.type)}</span></td><td style={{ fontFamily:'monospace', color:'#0f4c81' }}>{f.phone || '-'}</td><td style={{ color:'#64748b', fontSize:11 }}>{f.address || '-'}</td><td style={{ color: isValidPoint(f) ? '#64748b' : '#dc3545', fontSize:10 }}>{coordinateText(f)}</td><td onClick={e => e.stopPropagation()}>{isAdmin ? <div style={{ display:'flex', gap:6 }}><button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'facility', item:f })}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteItem('facility', f)}>Hapus</button></div> : <span className="text-dim">Lihat</span>}</td></tr>)}
        </tbody></table>
      </div>
      <div className="card">
        <div className="card-title">Alat Berat</div>
        <StateBox loading={equipment.loading} error={equipment.error} empty={equipment.data.length === 0} />
        {!equipment.loading && equipment.data.length === 0 && <div className="text-dim" style={{ padding:12 }}>Belum ada titik aset. Silakan tambahkan data melalui akun Admin.</div>}
        <table className="data-table"><thead><tr><th>Nama</th><th>Tipe</th><th>Status</th><th>Lokasi</th><th>Aksi</th></tr></thead><tbody>
          {equipment.data.map(e => <tr key={e.id} onClick={() => { setSelectedEquipmentId(e.id); setSelectedFacilityId(''); }} style={{ cursor:'pointer', background: selectedEquipmentId === e.id ? 'rgba(245,158,11,0.12)' : 'transparent', outline: selectedEquipmentId === e.id ? '1px solid rgba(245,158,11,0.30)' : undefined }}><td style={{ color:'#1f2937' }}>{assetIcon(e.type)} {e.name}</td><td style={{ color:'#64748b' }}>{assetLabel(e.type)}</td><td><span className="badge" style={{ background: equipmentColor(e.status)+'22', color: equipmentColor(e.status) }}>{e.status.toUpperCase()}</span></td><td style={{ color: isValidPoint(e) ? '#64748b' : '#dc3545', fontSize:10 }}>{coordinateText(e)}</td><td onClick={ev => ev.stopPropagation()}>{isAdmin ? <div style={{ display:'flex', gap:6 }}><button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'equipment', item:e })}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteItem('equipment', e)}>Hapus</button></div> : <span className="text-dim">Lihat</span>}</td></tr>)}
        </tbody></table>
      </div>
      <div className="card">
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin: 0 }}>PETA LOKASI FASILITAS & ASET</div>
          <div style={{ display:'flex', gap:12, alignItems:'center', fontSize:11, color:'#94a3b8' }}>
            <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}><input type="checkbox" checked={showFacilities} onChange={e => setShowFacilities(e.target.checked)} /> Fasilitas Publik</label>
            <label style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }}><input type="checkbox" checked={showEquipment} onChange={e => setShowEquipment(e.target.checked)} /> Aset & Alat Berat</label>
          </div>
        </div>
        {(facilities.loading || equipment.loading) && <div className="infobox">Memuat marker fasilitas dan aset...</div>}
        {(facilities.error || equipment.error) && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>Gagal memuat sebagian marker lokasi.</div>}
        {(invalidFacilities > 0 || invalidEquipment > 0) && <div className="infobox" style={{ borderColor:'#f97316', color:'#f97316' }}>{invalidFacilities + invalidEquipment} titik lokasi berada di luar area validasi dan tidak dirender sebagai marker.</div>}
        {!facilities.loading && !equipment.loading && facilities.data.length === 0 && equipment.data.length === 0 && <div className="text-dim" style={{ padding: 12 }}>Belum ada titik fasilitas atau aset. Silakan tambahkan data melalui akun Admin.</div>}
        {!facilities.loading && !equipment.loading && facilities.data.length + equipment.data.length > 0 && validFacilities.length === 0 && validEquipment.length === 0 && <div className="text-dim" style={{ padding: 12 }}>Belum ada fasilitas atau aset dengan koordinat valid.</div>}
        <div style={{ height: 460, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <MapContainer center={DEFAULT_PANJANG_CENTER} zoom={14} style={{ height:'100%', width:'100%', background:'#0a1628' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <FacilitiesFitBounds facilities={showFacilities ? validFacilities : []} equipment={showEquipment ? validEquipment : []} />
            <FacilitiesMapFocus selected={selectedPoint && isValidPoint(selectedPoint) ? selectedPoint : null} />
            {showFacilities && validFacilities.map(f => {
              const color = FACILITY_COLORS[f.type] || '#757575';
              return (
                <Marker key={f.id} position={[pointLat(f), pointLng(f)]} icon={markerIcon(facilityIcon(f.type), color)}>
                  <Popup>
                    <b>{facilityIcon(f.type)} {f.name}</b><br />
                    Jenis: {facilityLabel(f.type)}<br />
                    Alamat: {f.address || '-'}<br />
                    Telepon: {f.phone || '-'}<br />
                    Keterangan: {f.description || f.notes || '-'}<br />
                    Latitude: {pointLat(f).toFixed(5)}<br />
                    Longitude: {pointLng(f).toFixed(5)}<br />
                    Status validasi: {validationText(f)}<br />
                    {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'facility', item:f })}>Edit</button>}
                  </Popup>
                </Marker>
              );
            })}
            {showEquipment && validEquipment.map(e => {
              const color = equipmentColor(e.status);
              return (
                <Marker key={e.id} position={[pointLat(e), pointLng(e)]} icon={markerIcon(assetIcon(e.type), color)}>
                  <Popup>
                    <b>{assetIcon(e.type)} {e.name}</b><br />
                    Jenis: {assetLabel(e.type)}<br />
                    Status: {e.status?.toUpperCase()}<br />
                    Keterangan: {e.description || e.notes || '-'}<br />
                    Latitude: {pointLat(e).toFixed(5)}<br />
                    Longitude: {pointLng(e).toFixed(5)}<br />
                    Status validasi: {validationText(e)}<br />
                    {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'equipment', item:e })}>Edit</button>}
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginTop:10, fontSize:11, color:'#94a3b8' }}>
          <span>🏥 Medis</span><span>🛡️ Polisi</span><span>🚒 Damkar</span><span>🛟 SAR</span><span>🚑 Ambulance</span><span>🚜 Alat Berat</span><span>🚚 Truk Evakuasi</span>
        </div>
      </div>
    </div>
  );
}

const SENSOR_STATUS_OPTIONS = ['online', 'offline', 'suspect', 'maintenance'];
const SIREN_STATUS_OPTIONS = ['active', 'inactive', 'fault'];

type DeviceKind = 'sensor' | 'siren';
type DeviceItem = MapSensor | MapSiren;

const deviceLat = (item: { lat?: number; latitude?: number }) => Number(item.lat ?? item.latitude);
const deviceLng = (item: { lng?: number; longitude?: number }) => Number(item.lng ?? item.longitude);

function DevicePointModal({
  kind, item, onClose, onSaved,
}: {
  kind: DeviceKind;
  item: DeviceItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isSensor = kind === 'sensor';
  const [form, setForm] = useState({
    code: item?.code || '',
    name: item?.name || '',
    lng: item ? deviceLng(item) : DEFAULT_PANJANG_CENTER[1],
    lat: item ? deviceLat(item) : DEFAULT_PANJANG_CENTER[0],
    address: (item as any)?.address || '',
    elevation_m: (item as any)?.elevation_m ?? 0,
    is_primary: (item as any)?.is_primary ?? true,
    radius_m: (item as MapSiren | null)?.radius_m ?? 500,
    status: item?.status || (isSensor ? 'online' : 'inactive'),
    is_auto_enabled: (item as MapSiren | null)?.is_auto_enabled ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const setField = (key: string, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError('');
  };

  const pickLocation = async (lat: number, lng: number) => {
    setForm(prev => ({ ...prev, lat, lng }));
    setNotice('Koordinat titik berhasil dipilih/dipindahkan.');
    setError('');
    if (!isSensor) return;
    setNotice('Koordinat titik berhasil dipilih/dipindahkan. Mengambil alamat otomatis...');
    try {
      const address = await reverseGeocode(lat, lng);
      if (address) {
        setForm(prev => ({ ...prev, lat, lng, address }));
        setNotice('Koordinat titik berhasil dipilih/dipindahkan dan alamat otomatis terisi.');
      } else {
        setNotice('Koordinat titik berhasil dipilih/dipindahkan, tetapi alamat otomatis tidak ditemukan.');
      }
    } catch {
      setNotice('Koordinat titik berhasil dipilih/dipindahkan, tetapi alamat otomatis gagal dimuat.');
    }
  };

  const validate = () => {
    if (!form.code.trim()) return 'Kode perangkat wajib diisi.';
    if (!form.name.trim()) return 'Nama perangkat wajib diisi.';
    if (!Number.isFinite(form.lat) || !Number.isFinite(form.lng)) return 'Koordinat perangkat wajib valid.';
    if (!isValidPoint({ lat: form.lat, lng: form.lng })) return 'Titik perangkat berada di luar area operasional Bandar Lampung.';
    if (isSensor && !SENSOR_STATUS_OPTIONS.includes(form.status)) return 'Status sensor tidak valid.';
    if (!isSensor && !SIREN_STATUS_OPTIONS.includes(form.status)) return 'Status sirine tidak valid.';
    if (!isSensor && Number(form.radius_m) <= 0) return 'Radius sirine wajib lebih besar dari 0.';
    return '';
  };

  const save = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (isSensor) {
        const payload = {
          code: form.code.trim(),
          name: form.name.trim(),
          lng: form.lng,
          lat: form.lat,
          address: form.address.trim(),
          elevation_m: Number(form.elevation_m),
          is_primary: Boolean(form.is_primary),
          status: form.status,
        };
        if (item) await dataApi.updateSensor(item.id, payload);
        else await dataApi.createSensor(payload);
      } else {
        const payload = {
          code: form.code.trim(),
          name: form.name.trim(),
          lng: form.lng,
          lat: form.lat,
          radius_m: Number(form.radius_m),
          status: form.status,
          is_auto_enabled: Boolean(form.is_auto_enabled),
        };
        if (item) await dataApi.updateSiren(item.id, payload);
        else await dataApi.createSiren(payload);
      }
      onSaved(isSensor ? (item ? 'Sensor berhasil diperbarui.' : 'Sensor berhasil ditambahkan.') : (item ? 'Sirine berhasil diperbarui.' : 'Sirine berhasil ditambahkan.'));
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Gagal menyimpan perangkat.');
    } finally {
      setSaving(false);
    }
  };

  const markerLabel = isSensor ? 'SNS' : 'SRN';
  const markerColor = isSensor ? '#06b6d4' : form.status === 'active' ? '#ef4444' : form.status === 'fault' ? '#f97316' : '#64748b';

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(2,8,23,0.78)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="card" style={{ width:'min(980px, 96vw)', maxHeight:'92vh', overflow:'auto' }}>
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin:0 }}>{item ? 'Edit' : 'Tambah'} {isSensor ? 'Sensor' : 'Sirine'}</div>
          <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Batal</button>
        </div>
        {notice && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{notice}</div>}
        {error && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{error}</div>}
        <div className="grid-2">
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <label className="text-dim" style={{ fontSize:11 }}>Kode *</label>
            <input className="form-input" value={form.code} onChange={e => setField('code', e.target.value)} placeholder={isSensor ? 'SNS-001' : 'SRN-001'} />
            <label className="text-dim" style={{ fontSize:11 }}>Nama *</label>
            <input className="form-input" value={form.name} onChange={e => setField('name', e.target.value)} />
            {isSensor ? (
              <>
                <label className="text-dim" style={{ fontSize:11 }}>Alamat</label>
                <input className="form-input" value={form.address} onChange={e => setField('address', e.target.value)} />
                <div className="grid-2">
                  <div><label className="text-dim" style={{ fontSize:11 }}>Elevasi (m)</label><input className="form-input" type="number" value={form.elevation_m} onChange={e => setField('elevation_m', Number(e.target.value))} /></div>
                  <div><label className="text-dim" style={{ fontSize:11 }}>Status *</label><select className="form-input" value={form.status} onChange={e => setField('status', e.target.value)}>{SENSOR_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></div>
                </div>
                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#475569' }}><input type="checkbox" checked={form.is_primary} onChange={e => setField('is_primary', e.target.checked)} /> Sensor primer</label>
              </>
            ) : (
              <>
                <div className="grid-2">
                  <div><label className="text-dim" style={{ fontSize:11 }}>Radius (m) *</label><input className="form-input" type="number" value={form.radius_m} onChange={e => setField('radius_m', Number(e.target.value))} /></div>
                  <div><label className="text-dim" style={{ fontSize:11 }}>Status *</label><select className="form-input" value={form.status} onChange={e => setField('status', e.target.value)}>{SIREN_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></div>
                </div>
                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'#475569' }}><input type="checkbox" checked={form.is_auto_enabled} onChange={e => setField('is_auto_enabled', e.target.checked)} /> Auto sirine aktif</label>
              </>
            )}
            <div className="grid-2">
              <div><label className="text-dim" style={{ fontSize:11 }}>Latitude *</label><input className="form-input" value={Number.isFinite(form.lat) ? String(form.lat) : ''} onChange={e => setField('lat', parseCoordinateInput(e.target.value))} placeholder="-5.468900" /></div>
              <div><label className="text-dim" style={{ fontSize:11 }}>Longitude *</label><input className="form-input" value={Number.isFinite(form.lng) ? String(form.lng) : ''} onChange={e => setField('lng', parseCoordinateInput(e.target.value))} placeholder="105.319700" /></div>
            </div>
            <div className="infobox" style={{ fontSize:11 }}>Klik peta atau drag marker untuk memindahkan titik perangkat ke layer operasional.</div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              <button className="btn btn-outline" onClick={onClose} disabled={saving}>Batal</button>
            </div>
          </div>
          <div>
            <div className="text-dim" style={{ fontSize:11, marginBottom:8 }}>Lokasi akan langsung dipakai oleh layer Sensor/Sirine di Monitoring Peta.</div>
            <div style={{ height:390, borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0' }}>
              <MapContainer center={[form.lat, form.lng]} zoom={14} style={{ height:'100%', width:'100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                <LocationPicker onPick={pickLocation} />
                <Marker
                  position={[form.lat, form.lng]}
                  icon={markerIcon(markerLabel, markerColor)}
                  draggable
                  eventHandlers={{ dragend: (e) => {
                    const ll = e.target.getLatLng();
                    pickLocation(ll.lat, ll.lng);
                  } }}
                >
                  <Popup>{form.code || markerLabel}<br />{form.lat.toFixed(6)}, {form.lng.toFixed(6)}</Popup>
                </Marker>
              </MapContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatusPerangkat({ connected, user }: any) {
  const sensors = useLoad<MapSensor[]>(async () => (await dataApi.sensors()).data.sensors, []);
  const sirens = useLoad<MapSiren[]>(async () => (await dataApi.sirens()).data.sirens, []);
  const health = useLoad<any>(async () => (await dataApi.deviceHealth()).data, {});
  const [modal, setModal] = useState<{ kind: DeviceKind; item: DeviceItem | null } | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const isAdmin = user?.role === 'admin';

  const refreshAll = async () => {
    await Promise.all([sensors.load(), sirens.load(), health.load()]);
  };

  const handleSaved = async (msg: string) => {
    setModal(null);
    setMessage(msg);
    setActionError('');
    await refreshAll();
  };

  const deleteDevice = async (kind: DeviceKind, item: DeviceItem) => {
    if (!isAdmin) {
      setActionError('Anda tidak memiliki izin untuk mengubah perangkat.');
      return;
    }
    if (!window.confirm(`Hapus ${item.code} - ${item.name}?`)) return;
    setActionError('');
    try {
      if (kind === 'sensor') {
        await dataApi.deleteSensor(item.id);
        setMessage('Sensor berhasil dihapus.');
      } else {
        await dataApi.deleteSiren(item.id);
        setMessage('Sirine berhasil dihapus.');
      }
      await refreshAll();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal menghapus perangkat.');
    }
  };

  return (
    <div className="page-section">
      {modal && <DevicePointModal kind={modal.kind} item={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />}
        <div className="flex justify-between items-center mb-12">
          <div className="text-dim">Status aktual dari database dan WebSocket. Admin dapat tambah, edit, dan hapus sensor serta sirine. Koordinat perangkat dikelola melalui form edit.</div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind:'sensor', item:null })}>+ Tambah Sensor</button>}
          {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind:'siren', item:null })}>+ Tambah Sirine</button>}
          <button className="btn btn-outline btn-sm" onClick={refreshAll} disabled={sensors.loading || sirens.loading || health.loading}>Refresh</button>
        </div>
      </div>
      {!isAdmin && <div className="infobox">Anda masuk sebagai {user?.role?.toUpperCase() || 'USER'}. Titik sensor dan sirine hanya dapat diubah oleh Admin.</div>}
      {message && <div className="infobox" style={{ borderColor:'#22c55e', color:'#22c55e' }}>{message}</div>}
      {actionError && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>{actionError}</div>}
      <div className="grid-2">
        <div className="card"><div className="card-title">Status Sensor</div><StateBox loading={sensors.loading} error={sensors.error} empty={sensors.data.length === 0} />
          <table className="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Level</th><th>Status</th><th>Quality</th><th>Lokasi</th><th>Last Seen</th><th>Aksi</th></tr></thead><tbody>{sensors.data.map(s => <tr key={s.id}><td style={{ fontFamily:'monospace', color:'#1f2937' }}>{s.code}</td><td>{s.name}</td><td style={{ color:'#0f4c81', fontFamily:'monospace' }}>{s.water_level_cm ? `${Number(s.water_level_cm).toFixed(1)}cm` : '-'}</td><td>{s.status}</td><td>{s.quality || '-'}</td><td style={{ color:isValidPoint(s) ? '#64748b' : '#dc3545', fontSize:10 }}>{coordinateText(s)}</td><td style={{ color:'#64748b', fontSize:10 }}>{s.last_seen ? new Date(s.last_seen).toLocaleString('id-ID') : '-'}</td><td>{isAdmin ? <div style={{ display:'flex', gap:6 }}><button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'sensor', item:s })}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteDevice('sensor', s)}>Hapus</button></div> : <span className="text-dim">Lihat</span>}</td></tr>)}</tbody></table>
        </div>
        <div className="card"><div className="card-title">Status Sirine</div><StateBox loading={sirens.loading} error={sirens.error} empty={sirens.data.length === 0} />
          <table className="data-table"><thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Radius</th><th>Auto</th><th>Lokasi</th><th>Last Update</th><th>Aksi</th></tr></thead><tbody>{sirens.data.map(s => <tr key={s.id}><td style={{ fontFamily:'monospace', color:'#1f2937' }}>{s.code}</td><td>{s.name}</td><td>{s.status}</td><td>{Number(s.radius_m || 0).toLocaleString('id-ID')}m</td><td>{s.is_auto_enabled ? 'Ya' : 'Tidak'}</td><td style={{ color:isValidPoint(s) ? '#64748b' : '#dc3545', fontSize:10 }}>{coordinateText(s)}</td><td style={{ color:'#64748b', fontSize:10 }}>{s.last_activated ? new Date(s.last_activated).toLocaleString('id-ID') : '-'}</td><td>{isAdmin ? <div style={{ display:'flex', gap:6 }}><button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'siren', item:s })}>Edit</button><button className="btn btn-danger btn-sm" onClick={() => deleteDevice('siren', s)}>Hapus</button></div> : <span className="text-dim">Lihat</span>}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="card">
        <div className="flex justify-between items-center mb-12">
          <div className="card-title" style={{ margin:0 }}>PETA SENSOR & SIRINE</div>
          <div className="text-dim" style={{ fontSize:11 }}>Menampilkan hanya perangkat sensor dan sirine yang memiliki koordinat valid.</div>
        </div>
        {(sensors.loading || sirens.loading) && <div className="infobox">Memuat marker sensor dan sirine...</div>}
        {(sensors.error || sirens.error) && <div className="infobox" style={{ borderColor:'#ef4444', color:'#ef4444' }}>Gagal memuat sebagian marker perangkat.</div>}
        {!sensors.loading && !sirens.loading && sensors.data.length === 0 && sirens.data.length === 0 && <div className="text-dim" style={{ padding:12 }}>Belum ada data sensor atau sirine.</div>}
        <div style={{ height: 460, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
          <MapContainer center={DEFAULT_PANJANG_CENTER} zoom={14} style={{ height:'100%', width:'100%', background:'#0a1628' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <FacilitiesFitBounds facilities={sensors.data.filter(isValidPoint) as any} equipment={sirens.data.filter(isValidPoint) as any} />
            {sensors.data.filter(isValidPoint).map(sensor => (
              <Marker key={sensor.id} position={[deviceLat(sensor), deviceLng(sensor)]} icon={markerIcon('SNS', '#06b6d4')}>
                <Popup>
                  <b>📡 {sensor.name}</b><br />
                  Kode: {sensor.code}<br />
                  Status: {sensor.status}<br />
                  Level air: {sensor.water_level_cm ? `${Number(sensor.water_level_cm).toFixed(1)} cm` : '-'}<br />
                  Quality: {sensor.quality || '-'}<br />
                  Latitude: {deviceLat(sensor).toFixed(6)}<br />
                  Longitude: {deviceLng(sensor).toFixed(6)}<br />
                  {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'sensor', item:sensor })}>Edit</button>}
                </Popup>
              </Marker>
            ))}
            {sirens.data.filter(isValidPoint).map(siren => (
              <Marker key={siren.id} position={[deviceLat(siren), deviceLng(siren)]} icon={markerIcon('SRN', siren.status === 'active' ? '#ef4444' : siren.status === 'fault' ? '#f97316' : '#64748b')}>
                <Popup>
                  <b>📢 {siren.name}</b><br />
                  Kode: {siren.code}<br />
                  Status: {siren.status}<br />
                  Radius: {Number(siren.radius_m || 0).toLocaleString('id-ID')} m<br />
                  Auto: {siren.is_auto_enabled ? 'Ya' : 'Tidak'}<br />
                  Latitude: {deviceLat(siren).toFixed(6)}<br />
                  Longitude: {deviceLng(siren).toFixed(6)}<br />
                  {isAdmin && <button className="btn btn-outline btn-sm" onClick={() => setModal({ kind:'siren', item:siren })}>Edit</button>}
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
      <div className="grid-3">
        <div className="stat-box"><div className="stat-label">WebSocket</div><div className="stat-value text-ok" style={{ fontSize:18 }}>{connected ? 'OK' : 'RECONNECT'}</div><div className="stat-sub">Koneksi realtime frontend</div></div>
        <div className="stat-box"><div className="stat-label">Sensor Online</div><div className="stat-value text-ok" style={{ fontSize:18 }}>{health.data.sensors_online || 0}/{health.data.sensors_total || 0}</div><div className="stat-sub">Database PostgreSQL</div></div>
        <div className="stat-box"><div className="stat-label">Sirine Aktif</div><div className="stat-value" style={{ fontSize:18 }}>{health.data.sirens_active || 0}</div><div className="stat-sub">Fault {health.data.sirens_fault || 0}</div></div>
      </div>
    </div>
  );
}

export function Riwayat(_: any) {
  const alerts = useLoad<any[]>(async () => (await dataApi.alerts()).data.alerts, []);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [error, setError] = useState('');
  const loadEvents = async () => {
    setLoadingEvents(true); setError('');
    try {
      const [sirens, audit] = await Promise.all([api.get('/audit/logs'), api.get('/alerts/')]);
      setEvents([...(sirens.data.logs || []), ...((audit.data.alerts || []).map((a: any) => ({ id: a.id, created_at: a.triggered_at, action: `ALERT_${a.level}`, entity_type: 'alerts', reason: a.status })))]);
    } catch { setError('Gagal memuat riwayat.'); }
    finally { setLoadingEvents(false); }
  };
  useEffect(() => { loadEvents(); }, []);
  return (
    <div className="page-section">
      <div className="flex justify-between items-center mb-12"><div className="text-dim">Riwayat alert dan event sistem dari database.</div><button className="btn btn-outline btn-sm" onClick={() => { alerts.load(); loadEvents(); }}>Refresh</button></div>
      <div className="card"><div className="card-title">Riwayat Alert</div><StateBox loading={alerts.loading} error={alerts.error} empty={alerts.data.length === 0} />
        <div className="scroll-list" style={{ maxHeight: 260 }}>{alerts.data.map(a => <div key={a.id} className="log-item"><span className="log-time">{new Date(a.triggered_at).toLocaleString('id-ID')}</span><span className="log-event">Level <b>{a.level?.toUpperCase()}</b> · {a.status} · {a.confidence_score}% · sensor {a.sensor_count}</span></div>)}</div>
      </div>
      <div className="card"><div className="card-title">Event Sistem</div><StateBox loading={loadingEvents} error={error} empty={events.length === 0} />
        <div className="scroll-list" style={{ maxHeight: 220 }}>{events.slice(0, 50).map((e, i) => <div key={`${e.id}-${i}`} className="log-item"><span className="log-time">{new Date(e.created_at).toLocaleString('id-ID')}</span><span className="log-event">{e.action || e.event_type} · {e.entity_type || 'system'} · {e.reason || e.message || '-'}</span></div>)}</div>
      </div>
    </div>
  );
}

export function AuditLog(_: any) {
  const [action, setAction] = useState('');
  const logs = useLoad<any[]>(async () => (await dataApi.auditLogs(action || undefined)).data.logs, []);
  useEffect(() => { logs.load(); }, [action]);
  return (
    <div className="page-section">
      <div className="flex justify-between items-center mb-12">
        <select className="form-input" style={{ width: 220 }} value={action} onChange={e => setAction(e.target.value)}>
          <option value="">Semua aksi</option><option value="LOGIN">LOGIN</option><option value="LOGOUT">LOGOUT</option><option value="START_SIMULATION">START_SIMULATION</option><option value="ALERT_CREATED">ALERT_CREATED</option><option value="CREATE_MASTER_DATA">CREATE_MASTER_DATA</option><option value="UPDATE_MASTER_DATA">UPDATE_MASTER_DATA</option><option value="DELETE_MASTER_DATA">DELETE_MASTER_DATA</option>
        </select>
        <button className="btn btn-outline btn-sm" onClick={logs.load}>Refresh</button>
      </div>
      <div className="card"><div className="card-title">Audit Log</div><StateBox loading={logs.loading} error={logs.error} empty={logs.data.length === 0} />
        <table className="data-table"><thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Entity</th><th>Keterangan</th></tr></thead><tbody>{logs.data.map(l => <tr key={l.id}><td style={{ fontFamily:'monospace', fontSize:10, color:'#64748b' }}>{new Date(l.created_at).toLocaleString('id-ID')}</td><td style={{ color:'#06b6d4', fontWeight:600 }}>{l.username || 'system'}</td><td style={{ fontFamily:'monospace', color:'#f97316', fontSize:11 }}>{l.action}</td><td>{l.entity_type}</td><td style={{ color:'#64748b', fontSize:11 }}>{l.reason || '-'}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

export function Laporan(_: any) {
  const daily = useLoad<any>(async () => (await dataApi.dailyReport()).data, {});
  const health = useLoad<any>(async () => (await dataApi.deviceHealth()).data, {});
  const exportReport = () => {
    const text = JSON.stringify({ daily: daily.data, health: health.data }, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `laporan-sig-tsunami-${daily.data.date || 'hari-ini'}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="page-section">
      <div className="flex justify-between items-center mb-12"><div className="text-dim">Laporan ringkas dari database.</div><button className="btn btn-outline btn-sm" onClick={() => { daily.load(); health.load(); }}>Refresh</button></div>
      <div className="grid-2">
        <div className="card"><div className="card-title">Laporan Harian</div><StateBox loading={daily.loading} error={daily.error} />
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}><div className="flex justify-between"><span className="text-dim">Tanggal</span><span>{daily.data.date || '-'}</span></div><div className="flex justify-between"><span className="text-dim">Total Alert</span><span>{daily.data.alerts || 0}</span></div><div className="flex justify-between"><span className="text-dim">Event Sirine</span><span>{daily.data.siren_events || 0}</span></div><div className="flex justify-between"><span className="text-dim">System Events</span><span>{daily.data.system_events || 0}</span></div></div>
          <button className="btn btn-outline btn-sm" style={{ marginTop:16, width:'100%' }} onClick={exportReport}>Download Laporan</button>
        </div>
        <div className="card"><div className="card-title">Kesehatan Perangkat</div><StateBox loading={health.loading} error={health.error} />
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}><div className="flex justify-between"><span className="text-dim">Sensor Online</span><span>{health.data.sensors_online || 0}/{health.data.sensors_total || 0}</span></div><div className="flex justify-between"><span className="text-dim">Sirine OK</span><span>{health.data.sirens_ok || 0}</span></div><div className="flex justify-between"><span className="text-dim">Sirine Aktif</span><span>{health.data.sirens_active || 0}</span></div><div className="flex justify-between"><span className="text-dim">Fault</span><span>{health.data.sirens_fault || 0}</span></div></div>
          <button className="btn btn-outline btn-sm" style={{ marginTop:16, width:'100%' }} onClick={exportReport}>Download Laporan</button>
        </div>
      </div>
    </div>
  );
}

const MASTER: Record<string, any> = {
  sensors: { title:'Sensor', list: () => dataApi.sensors().then(r => r.data.sensors), base:'/sensors/', id:'id', sample:{ code:'SNS-DEMO-01', name:'Sensor Demo', lng:105.275, lat:-5.471, address:'Demo', elevation_m:0, is_primary:true, status:'online' } },
  sirens: { title:'Sirine', list: () => dataApi.sirens().then(r => r.data.sirens), base:'/sirens/', id:'id', sample:{ code:'SRN-DEMO-01', name:'Sirine Demo', lng:105.276, lat:-5.472, radius_m:500, status:'inactive', is_auto_enabled:true } },
  facilities: { title:'Fasilitas', list: () => dataApi.facilities().then(r => r.data.facilities), base:'/facilities/', id:'id', sample:{ name:'', type:'medis', address:'', phone:'', description:'', latitude:null, longitude:null, is_active:true } },
  equipment: { title:'Aset Berat', list: () => dataApi.equipment().then(r => r.data.equipment), base:'/facilities/equipment/', id:'id', sample:{ name:'', type:'ambulance', status:'available', description:'', latitude:null, longitude:null } },
  routes: { title:'Jalur Evakuasi', list: () => dataApi.routes().then(r => r.data.routes), base:'/evacuation/routes/', id:'id', sample:{ name:'', direction:'', description:'', capacity_persons:500, estimated_time_min:null, status:'clear', priority:1, coordinates:[[105.25,-5.45],[105.26,-5.44]] } },
  safeZones: { title:'Zona Aman', list: () => mapApi.safeZones().then(r => r.data.safe_zones), base:'/evacuation/safe-zones/', id:'id', sample:{ name:'Zona Demo', coordinates:[[105.29,-5.45],[105.291,-5.45],[105.291,-5.451],[105.29,-5.451]], elevation_m:40, capacity:100, current_count:0, facilities:['air'], is_active:true, notes:'' } },
  inundation: { title:'Zona Rawan', list: () => mapApi.inundation().then(r => r.data.zones), base:'/map/inundation-zones/', id:'id', sample:{ name:'Zona Rawan Demo', coordinates:[[105.26,-5.47],[105.261,-5.47],[105.261,-5.471],[105.26,-5.471]], risk_level:'medium', notes:'' } },
};

export function DataMaster({ user }: { user?: User }) {
  const [entity, setEntity] = useState('sensors');
  const cfg = MASTER[entity];
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [payload, setPayload] = useState(JSON.stringify(cfg.sample, null, 2));
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const isAdmin = user?.role === 'admin';
  const load = async () => { setLoading(true); setMessage(''); try { setItems(await cfg.list()); } catch { setMessage('Gagal memuat data master.'); } finally { setLoading(false); } };
  useEffect(() => { setPayload(JSON.stringify(cfg.sample, null, 2)); setSelected(null); load(); }, [entity]);
  const submit = async (mode: 'create' | 'update' | 'delete') => {
    if (!isAdmin) {
      setMessage('Anda tidak memiliki izin untuk mengubah data.');
      return;
    }
    setLoading(true); setMessage('');
    try {
      if (mode === 'delete') {
        if (!selected || !window.confirm('Hapus data ini?')) return;
        await api.delete(`${cfg.base}${selected[cfg.id]}`);
        setMessage('Data berhasil dihapus.');
      } else {
        const body = JSON.parse(payload);
        if (mode === 'create') await api.post(cfg.base, body);
        if (mode === 'update') {
          if (!selected) throw new Error('Pilih data yang akan diedit.');
          await api.put(`${cfg.base}${selected[cfg.id]}`, body);
        }
        setMessage(mode === 'create' ? 'Data berhasil dibuat.' : 'Data berhasil diperbarui.');
      }
      await load();
    } catch (err: any) {
      setMessage(err?.response?.data?.detail || err?.message || 'Aksi gagal.');
    } finally { setLoading(false); }
  };
  return (
    <div className="page-section">
      <div className="grid-2">
        <div className="card"><div className="card-title">Data Master</div>
          <select className="form-input" value={entity} onChange={e => setEntity(e.target.value)}>{Object.entries(MASTER).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}</select>
          <StateBox loading={loading} error="" empty={items.length === 0} onRefresh={load} />
          <div className="scroll-list" style={{ maxHeight: 320 }}>{items.map(item => <button key={item.id} className="nav-item" style={{ width:'100%', textAlign:'left' }} onClick={() => { setSelected(item); setPayload(JSON.stringify({ ...cfg.sample, ...item }, null, 2)); }}>{item.code || item.name} <span className="text-dim">{item.status || item.type || item.risk_level || ''}</span></button>)}</div>
        </div>
        <div className="card"><div className="card-title">Kelola {cfg.title}</div>
          {!isAdmin && <div className="infobox" style={{ fontSize:11 }}>Data Master hanya dapat diubah oleh Admin.</div>}
          {message && <div className="infobox" style={{ fontSize: 11 }}>{message}</div>}
          <textarea className="form-input" rows={14} value={payload} onChange={e => setPayload(e.target.value)} />
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn btn-primary" disabled={loading || !isAdmin} onClick={() => submit('create')}>Tambah</button>
            <button className="btn btn-outline" disabled={loading || !selected || !isAdmin} onClick={() => submit('update')}>Simpan</button>
            <button className="btn btn-danger" disabled={loading || !selected || !isAdmin} onClick={() => submit('delete')}>Hapus</button>
            <button className="btn btn-outline" disabled={loading} onClick={() => { setSelected(null); setPayload(JSON.stringify(cfg.sample, null, 2)); }}>Batal</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Pengaturan({ user }: any) {
  const cfg = useLoad<any>(async () => (await dataApi.thresholdConfig()).data.config, {});
  const [form, setForm] = useState<any>({});
  const [message, setMessage] = useState('');
  useEffect(() => { setForm(cfg.data || {}); }, [cfg.data]);
  const save = async () => {
    setMessage('');
    try { await dataApi.updateThresholdConfig(form); setMessage('Konfigurasi threshold berhasil disimpan.'); cfg.load(); }
    catch (err: any) { setMessage(err?.response?.data?.detail || 'Gagal menyimpan threshold.'); }
  };
  const row = (label: string, key: string) => <div className="flex justify-between items-center" style={{ gap:12 }}><span className="text-dim">{label}</span><input className="form-input" type="number" value={form[key] ?? ''} onChange={e => setForm((f: any) => ({ ...f, [key]: Number(e.target.value) }))} /></div>;
  return (
    <div className="page-section">
      <div className="grid-2">
        <div className="card"><div className="card-title">Konfigurasi Threshold</div><StateBox loading={cfg.loading} error={cfg.error} />
          {message && <div className="infobox" style={{ fontSize:11 }}>{message}</div>}
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}>
            {row('Suspect Δ3m', 'suspect_delta3m')}{row('Suspect Z', 'suspect_zscore')}{row('Waspada Δ3m', 'waspada_delta3m')}{row('Waspada Rate', 'waspada_rate')}{row('Waspada Z', 'waspada_zscore')}{row('Siaga Δ3m', 'siaga_delta3m')}{row('Siaga Rate', 'siaga_rate')}{row('Siaga Z', 'siaga_zscore')}{row('Awas Δ3m', 'awas_delta3m')}{row('Awas Rate', 'awas_rate')}{row('Awas Z', 'awas_zscore')}
          </div>
          {(user?.role === 'admin' || user?.role === 'supervisor') && <button className="btn btn-outline btn-sm" style={{ marginTop:12 }} onClick={save}>Simpan Threshold</button>}
        </div>
        <div className="card"><div className="card-title">Profil & Role</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}><div className="flex justify-between"><span className="text-dim">Nama</span><span>{user?.full_name}</span></div><div className="flex justify-between"><span className="text-dim">Username</span><span style={{ fontFamily:'monospace' }}>{user?.username}</span></div><div className="flex justify-between"><span className="text-dim">Role</span><span className="badge" style={{ background:'rgba(6,182,212,0.15)', color:'#06b6d4' }}>{user?.role?.toUpperCase()}</span></div></div>
          <div className="infobox" style={{ marginTop:16 }}>Aksi kritis dicatat di audit log: simulasi, sirine, threshold, dan data master.</div>
        </div>
      </div>
    </div>
  );
}
