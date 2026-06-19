import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMapEvents, Circle, useMap } from 'react-leaflet';
import L, { LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { dataApi, mapApi } from '../utils/api';
import {
  FACILITY_COLORS,
  FACILITY_ICONS,
  FACILITY_LABELS,
  EQUIPMENT_ICONS,
  EQUIPMENT_LABELS,
  LEVEL_COLORS,
  ROUTE_COLORS,
} from '../utils/constants';
import {
  DetectionState,
  EvacRoute,
  InundationZone,
  MapEquipment,
  MapFacility,
  MapSensor,
  MapSiren,
  SafeZone,
  SensorData,
  User,
} from '../types';

interface Props {
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  sirenActive: boolean;
  user: User;
  [key: string]: any;
}

type LayerKey = 'sensors' | 'sirens' | 'facilities' | 'evacuation' | 'safe_zones' | 'inundation' | 'heavy_equipment';
type DispatchAssetType = 'equipment';

type DispatchAsset = {
  id: string;
  name: string;
  type: string;
  category: DispatchAssetType;
  lat: number;
  lng: number;
  status?: string;
  description?: string;
};

type DispatchPlan = {
  asset: DispatchAsset;
  waypoint: LatLngTuple;
  routeCoordinates: LatLngTuple[];
  distanceKm: number;
  estimatedMinutes: number;
  roadName: string;
  travelSpeedKmh: number;
};

const LAYER_DEFAULTS: Record<LayerKey, boolean> = {
  sensors: true,
  sirens: true,
  facilities: true,
  evacuation: true,
  safe_zones: true,
  inundation: true,
  heavy_equipment: true,
};

const MAP_CENTER: LatLngTuple = [-5.4712, 105.2756];
const OPERATOR_SPEED_KMH = 38;
const OPERATOR_ANIMATION_MS = 10000;

const mapDivIcon = (label: string, color: string) =>
  L.divIcon({
    className: 'asset-div-icon',
    html: `<div style="background:${color};color:#ffffff;border:2px solid #ffffff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;box-shadow:0 4px 12px rgba(15,23,42,.18)">${label}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });

const waypointIcon = L.divIcon({
  className: 'operator-waypoint-icon',
  html: '<div style="width:20px;height:20px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 6px rgba(239,68,68,.18)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const movingAssetIcon = L.divIcon({
  className: 'operator-moving-asset-icon',
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#06b6d4;border:3px solid #fff;box-shadow:0 0 14px rgba(6,182,212,.45)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const facilityLabel = (type: string) => FACILITY_LABELS[type] || type || 'Lainnya';
const equipmentLabel = (type: string) => EQUIPMENT_LABELS[type] || type || 'Lainnya';
const equipmentIcon = (type: string) => EQUIPMENT_ICONS[type] || EQUIPMENT_ICONS.lainnya || 'AST';
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toRadians = (value: number) => (value * Math.PI) / 180;
const parseCoordinateInput = (value: string) => Number(String(value).replace(',', '.'));

const haversineKm = (from: LatLngTuple, to: LatLngTuple) => {
  const earthRadiusKm = 6371;
  const deltaLat = toRadians(to[0] - from[0]);
  const deltaLng = toRadians(to[1] - from[1]);
  const fromLat = toRadians(from[0]);
  const toLat = toRadians(to[0]);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const routeDistanceKm = (coordinates: LatLngTuple[]) => {
  if (coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineKm(coordinates[i - 1], coordinates[i]);
  }
  return total;
};

const routeProgressPosition = (coordinates: LatLngTuple[], progress: number): LatLngTuple | null => {
  if (!coordinates.length) return null;
  if (coordinates.length === 1) return coordinates[0];

  const targetDistance = routeDistanceKm(coordinates) * clamp(progress, 0, 1);
  let traversed = 0;

  for (let i = 1; i < coordinates.length; i += 1) {
    const start = coordinates[i - 1];
    const end = coordinates[i];
    const segmentDistance = haversineKm(start, end);

    if (traversed + segmentDistance >= targetDistance) {
      const localProgress = segmentDistance === 0 ? 0 : (targetDistance - traversed) / segmentDistance;
      return [
        start[0] + (end[0] - start[0]) * localProgress,
        start[1] + (end[1] - start[1]) * localProgress,
      ];
    }

    traversed += segmentDistance;
  }

  return coordinates[coordinates.length - 1];
};

const nearestCoordinateOnRoad = (point: LatLngTuple, routeCoordinates: LatLngTuple[]) => {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  routeCoordinates.forEach((candidate, index) => {
    const distance = haversineKm(point, candidate);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  return {
    index: closestIndex,
    coordinate: routeCoordinates[closestIndex],
    distanceKm: closestDistance,
  };
};

const routeSegment = (routeCoordinates: LatLngTuple[], startIndex: number, endIndex: number) => {
  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  const segment = routeCoordinates.slice(from, to + 1);
  return startIndex <= endIndex ? segment : [...segment].reverse();
};

const dedupeCoordinates = (coordinates: LatLngTuple[]) =>
  coordinates.filter((coord, index, arr) => index === 0 || coord[0] !== arr[index - 1][0] || coord[1] !== arr[index - 1][1]);

const buildDispatchPlan = (asset: DispatchAsset, waypoint: LatLngTuple, routes: EvacRoute[]): DispatchPlan => {
  const assetPoint: LatLngTuple = [asset.lat, asset.lng];
  const usableRoutes = routes.filter(route => Array.isArray(route.coordinates) && route.coordinates.length > 1);

  if (!usableRoutes.length) {
    const directCoordinates = [assetPoint, waypoint];
    const directDistance = routeDistanceKm(directCoordinates);
    return {
      asset,
      waypoint,
      routeCoordinates: directCoordinates,
      distanceKm: directDistance,
      estimatedMinutes: Math.max(1, Math.round((directDistance / OPERATOR_SPEED_KMH) * 60)),
      roadName: 'Rute langsung',
      travelSpeedKmh: OPERATOR_SPEED_KMH,
    };
  }

  let bestPlan: DispatchPlan | null = null;

  usableRoutes.forEach(route => {
    const roadCoordinates = route.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple);
    const startSnap = nearestCoordinateOnRoad(assetPoint, roadCoordinates);
    const endSnap = nearestCoordinateOnRoad(waypoint, roadCoordinates);
    const mainRoadSegment = routeSegment(roadCoordinates, startSnap.index, endSnap.index);
    const mergedCoordinates = dedupeCoordinates([assetPoint, startSnap.coordinate, ...mainRoadSegment, endSnap.coordinate, waypoint]);
    const totalDistance = routeDistanceKm(mergedCoordinates);

    const candidatePlan: DispatchPlan = {
      asset,
      waypoint,
      routeCoordinates: mergedCoordinates,
      distanceKm: totalDistance,
      estimatedMinutes: Math.max(1, Math.round((totalDistance / OPERATOR_SPEED_KMH) * 60)),
      roadName: route.name,
      travelSpeedKmh: OPERATOR_SPEED_KMH,
    };

    if (!bestPlan || candidatePlan.distanceKm < bestPlan.distanceKm) {
      bestPlan = candidatePlan;
    }
  });

  return bestPlan!;
};

function MapFocusController({ center }: { center: LatLngTuple | null }) {
  const map = useMap();
  useEffect(() => {
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.setView(center, 15);
    }
  }, [map, center]);
  return null;
}

function MapWaypointSelector({
  enabled,
  onSelect,
}: {
  enabled: boolean;
  onSelect: (waypoint: LatLngTuple) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onSelect([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

function InundationPointPicker({
  onSelect,
}: {
  onSelect: (coordinate: [number, number]) => void;
}) {
  useMapEvents({
    click(event) {
      onSelect([event.latlng.lng, event.latlng.lat]);
    },
  });

  return null;
}

function InundationEditModal({
  zone,
  onClose,
  onSaved,
}: {
  zone: InundationZone;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const normalizeCoordinates = (coordinates: [number, number][]) => {
    if (coordinates.length < 2) return coordinates;
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return coordinates.slice(0, -1);
    return coordinates;
  };

  const [form, setForm] = useState({
    name: zone.name || '',
    risk_level: zone.risk_level || 'medium',
    notes: (zone as any).notes || '',
  });
  const [coords, setCoords] = useState<[number, number][]>(normalizeCoordinates(zone.coordinates || []));
  const [manualPoint, setManualPoint] = useState({ latitude: '', longitude: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const polygonPreview = coords.length >= 3 ? [...coords, coords[0]] : coords;
  const center: LatLngTuple = coords[0] ? [coords[0][1], coords[0][0]] : MAP_CENTER;

  const addCoord = (coord: [number, number]) => {
    if (!Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) {
      setError('Koordinat tidak valid.');
      return;
    }
    if (coord[1] < -90 || coord[1] > 90 || coord[0] < -180 || coord[0] > 180) {
      setError('Koordinat berada di luar rentang yang valid.');
      return;
    }
    setCoords(prev => [...prev, coord]);
    setNotice('Titik batas area rendaman ditambahkan.');
    setError('');
  };

  const addManualCoord = () => {
    const latitude = parseCoordinateInput(manualPoint.latitude);
    const longitude = parseCoordinateInput(manualPoint.longitude);
    addCoord([longitude, latitude]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      setManualPoint({ latitude: '', longitude: '' });
    }
  };

  const validate = () => {
    if (!form.name.trim()) return 'Nama area rendaman wajib diisi.';
    if (!form.risk_level.trim()) return 'Level risiko wajib diisi.';
    if (coords.length < 3) return 'Area rendaman membutuhkan minimal 3 titik.';
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
        risk_level: form.risk_level.trim().toLowerCase(),
        notes: form.notes.trim() || null,
        coordinates: polygonPreview,
      };

      if (zone.id) {
        await dataApi.updateInundationZone(zone.id, payload);
        await onSaved('Area rendaman berhasil diperbarui.');
      } else {
        await dataApi.createInundationZone(payload);
        await onSaved('Area rendaman berhasil ditambahkan.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Gagal menyimpan area rendaman.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: 480,
      background: '#ffffff',
      boxShadow: '-4px 0 24px rgba(15, 23, 42, 0.15)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid #e2e8f0',
      color: '#1e293b'
    }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div className="card-title" style={{ margin: 0 }}>{zone.id ? 'Edit Area Rendaman' : 'Tambah Area Rendaman'}</div>
        <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Batal</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {notice && <div className="infobox" style={{ borderColor: '#22c55e', color: '#22c55e', margin: 0 }}>{notice}</div>}
        {error && <div className="infobox" style={{ borderColor: '#ef4444', color: '#ef4444', margin: 0 }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="text-dim" style={{ fontSize: 11 }}>Nama Area Rendaman *</label>
          <input className="form-input" value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} />

          <label className="text-dim" style={{ fontSize: 11 }}>Level Risiko *</label>
          <select className="form-input" value={form.risk_level} onChange={event => setForm(prev => ({ ...prev, risk_level: event.target.value }))}>
            <option value="low">LOW</option>
            <option value="medium">MEDIUM</option>
            <option value="high">HIGH</option>
          </select>

          <label className="text-dim" style={{ fontSize: 11 }}>Catatan</label>
          <textarea className="form-input" rows={3} value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} />

          <div className="grid-2">
            <div>
              <label className="text-dim" style={{ fontSize: 11 }}>Latitude Titik</label>
              <input className="form-input" value={manualPoint.latitude} onChange={event => setManualPoint(prev => ({ ...prev, latitude: event.target.value }))} placeholder="-5.468900" />
            </div>
            <div>
              <label className="text-dim" style={{ fontSize: 11 }}>Longitude Titik</label>
              <input className="form-input" value={manualPoint.longitude} onChange={event => setManualPoint(prev => ({ ...prev, longitude: event.target.value }))} placeholder="105.319700" />
            </div>
          </div>

          <button className="btn btn-outline btn-sm" onClick={addManualCoord} disabled={saving}>Tambah Titik dari Koordinat</button>

          <div className="infobox" style={{ fontSize: 11, margin: 0 }}>
            Titik batas: {coords.length}<br />
            Klik peta untuk menambah titik polygon area rendaman.
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving || coords.length < 3}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
            <button className="btn btn-outline" onClick={() => { setCoords(prev => prev.slice(0, -1)); setNotice('Titik terakhir dihapus.'); }} disabled={saving || coords.length === 0}>Hapus Titik Terakhir</button>
            <button className="btn btn-outline" onClick={() => { setCoords([]); setNotice('Batas area rendaman direset.'); }} disabled={saving || coords.length === 0}>Reset Area</button>
          </div>
        </div>

        <div>
          <div className="text-dim" style={{ fontSize: 11, marginBottom: 8 }}>Klik peta untuk menggambar batas area rendaman.</div>
          <div style={{ height: 260, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
              <InundationPointPicker onSelect={addCoord} />
              {polygonPreview.length >= 3 && (
                <Polygon positions={polygonPreview.map(([lng, lat]) => [lat, lng] as LatLngTuple)} pathOptions={{ color: form.risk_level === 'high' ? '#ef4444' : form.risk_level === 'low' ? '#eab308' : '#f97316', fillOpacity: 0.25, weight: 3 }} />
              )}
              {coords.map((coord, index) => (
                <CircleMarker key={`${coord[0]}-${coord[1]}-${index}`} center={[coord[1], coord[0]]} radius={index === 0 ? 7 : 5} pathOptions={{ color: '#0f4c81', fillColor: '#ffffff', fillOpacity: 1, weight: 3 }}>
                  <Popup>
                    Titik {index + 1}<br />
                    {coord[1].toFixed(6)}, {coord[0].toFixed(6)}
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OperatorPage({ sensors, detection, sirenActive, user }: Props) {
  const [mapSensors, setMapSensors] = useState<MapSensor[]>([]);
  const [mapSirens, setMapSirens] = useState<MapSiren[]>([]);
  const [mapFacilities, setMapFacilities] = useState<MapFacility[]>([]);
  const [evacRoutes, setEvacRoutes] = useState<EvacRoute[]>([]);
  const [safeZones, setSafeZones] = useState<SafeZone[]>([]);
  const [inundation, setInundation] = useState<InundationZone[]>([]);
  const [equipment, setEquipment] = useState<MapEquipment[]>([]);
  const [loadingLayers, setLoadingLayers] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(LAYER_DEFAULTS);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [dispatchPlan, setDispatchPlan] = useState<DispatchPlan | null>(null);
  const [animationProgress, setAnimationProgress] = useState(0);
  const [animationRunning, setAnimationRunning] = useState(false);
  const [editingInundationZone, setEditingInundationZone] = useState<InundationZone | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [focusCenter, setFocusCenter] = useState<LatLngTuple | null>(null);

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

  useEffect(() => {
    if (!dispatchPlan || !animationRunning) return;

    let frameId = 0;
    const startedAt = performance.now();

    const animate = (timestamp: number) => {
      const progress = clamp((timestamp - startedAt) / OPERATOR_ANIMATION_MS, 0, 1);
      setAnimationProgress(progress);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(animate);
      } else {
        setAnimationRunning(false);
      }
    };

    setAnimationProgress(0);
    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [dispatchPlan, animationRunning]);

  const mergedSensors = useMemo(
    () =>
      mapSensors.map(ms => {
        const live = Object.values(sensors).find(s => s.sensor_id === ms.id || s.code === ms.code);
        return {
          ...ms,
          water_level_cm: live?.water_level_cm ?? ms.water_level_cm,
          delta_3m: live?.delta_3m ?? 0,
          quality: live?.quality ?? 'good',
        };
      }),
    [mapSensors, sensors],
  );

  const dispatchAssets = useMemo<DispatchAsset[]>(
    () => [
      ...equipment.map(item => ({
        id: `equipment-${item.id}`,
        name: item.name,
        type: item.type,
        category: 'equipment' as const,
        lat: item.lat,
        lng: item.lng,
        status: item.status,
        description: item.description || item.notes,
      })),
      ...mapFacilities
        .filter(f => f.type === 'polisi' || f.type === 'damkar')
        .map(fac => ({
          id: `facility-${fac.id}`,
          name: fac.name,
          type: fac.type,
          category: 'equipment' as const,
          lat: fac.lat,
          lng: fac.lng,
          status: fac.is_active ? 'available' : 'unavailable',
          description: fac.description || fac.notes,
        })),
    ],
    [equipment, mapFacilities],
  );

  const selectedAsset = useMemo(
    () => dispatchAssets.find(asset => asset.id === selectedAssetId) || null,
    [dispatchAssets, selectedAssetId],
  );

  const movingPosition = useMemo(
    () => (dispatchPlan ? routeProgressPosition(dispatchPlan.routeCoordinates, animationProgress) : null),
    [dispatchPlan, animationProgress],
  );

  const getSensorColor = (delta3m: number) => {
    const value = Math.abs(delta3m);
    if (value >= 60) return '#7c3aed';
    if (value >= 40) return '#ef4444';
    if (value >= 25) return '#f97316';
    if (value >= 15) return '#eab308';
    return '#22c55e';
  };

  const toggleLayer = (key: LayerKey) => {
    setLayers(current => ({ ...current, [key]: !current[key] }));
  };

  const handleWaypointSelected = async (waypoint: LatLngTuple) => {
    if (!selectedAsset) return;
    
    // Fallback direct distance
    const assetPoint: LatLngTuple = [selectedAsset.lat, selectedAsset.lng];
    let routeCoordinates: LatLngTuple[] = [assetPoint, waypoint];
    let distanceKm = routeDistanceKm(routeCoordinates);
    let roadName = 'Rute OSRM';
    
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${selectedAsset.lng},${selectedAsset.lat};${waypoint[1]},${waypoint[0]}?overview=full&geometries=geojson`);
      if (response.ok) {
        const data = await response.json();
        const coords = data?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length > 1) {
          routeCoordinates = coords.map(([lng, lat]: [number, number]) => [lat, lng] as LatLngTuple);
          distanceKm = (data.routes[0].distance || 0) / 1000;
          if (data.routes[0].legs?.[0]?.summary) {
             roadName = data.routes[0].legs[0].summary;
          }
        }
      }
    } catch (e) {
      console.error('OSRM error', e);
    }
    
    const nextPlan: DispatchPlan = {
      asset: selectedAsset,
      waypoint,
      routeCoordinates,
      distanceKm,
      estimatedMinutes: Math.max(1, Math.round((distanceKm / OPERATOR_SPEED_KMH) * 60)),
      roadName,
      travelSpeedKmh: OPERATOR_SPEED_KMH,
    };

    setDispatchPlan(nextPlan);
    setAnimationRunning(false);
    setAnimationProgress(0);
  };

  const handleStartAnimation = () => {
    if (!dispatchPlan) return;
    setAnimationRunning(false);
    window.setTimeout(() => setAnimationRunning(true), 10);
  };

  const handleResetDispatch = () => {
    setDispatchPlan(null);
    setAnimationRunning(false);
    setAnimationProgress(0);
  };

  const canEditInundation = user?.role === 'operator' || user?.role === 'admin';
  const isOperator = user?.role === 'operator' || user?.role === 'admin';

  const handleToggleFacilityStatus = async (facility: MapFacility) => {
    try {
      const payload = {
        name: facility.name,
        type: facility.type,
        longitude: facility.lng,
        latitude: facility.lat,
        address: facility.address || '',
        phone: facility.phone || '',
        capacity: facility.capacity || null,
        is_active: !facility.is_active,
        notes: facility.notes || '',
      };
      await dataApi.updateFacility(facility.id, payload);
      setMapFacilities(prev => prev.map(f => f.id === facility.id ? { ...f, is_active: !f.is_active } : f));
      setActionMessage(`Status fasilitas ${facility.name} berhasil diubah.`);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal mengubah status fasilitas');
    }
  };

  const handleUpdateEquipmentStatus = async (equip: MapEquipment, newStatus: string) => {
    try {
      const payload = {
        name: equip.name,
        type: equip.type,
        longitude: equip.lng,
        latitude: equip.lat,
        status: newStatus,
        notes: equip.notes || '',
      };
      await dataApi.updateEquipment(equip.id, payload);
      setEquipment(prev => prev.map(e => e.id === equip.id ? { ...e, status: newStatus } : e));
      setActionMessage(`Status aset ${equip.name} berhasil diubah.`);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal mengubah status aset');
    }
  };

  const handleUpdateRouteStatus = async (route: EvacRoute, newStatus: string) => {
    try {
      const payload = {
        name: route.name,
        coordinates: route.geometry?.coordinates || route.coordinates || [],
        direction: route.direction || 'Utara',
        status: newStatus,
        capacity_persons: route.capacity_persons || 500,
        priority: route.priority || 1,
        notes: route.notes || '',
      };
      await dataApi.updateRoute(route.id, payload);
      setEvacRoutes(prev => prev.map(r => r.id === route.id ? { ...r, status: newStatus as any } : r));
      setActionMessage(`Status rute ${route.name} berhasil diubah.`);
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || 'Gagal mengubah status rute');
    }
  };

  const handleInundationSaved = async (message: string) => {
    setEditingInundationZone(null);
    setActionMessage(message);
    setActionError('');
    try {
      const response = await mapApi.inundation();
      setInundation(Array.isArray(response.data?.zones) ? response.data.zones : []);
    } catch {
      setActionError('Perubahan tersimpan, tetapi daftar area resapan gagal diperbarui otomatis.');
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 110px)', overflow: 'hidden' }}>
      {editingInundationZone && (
        <InundationEditModal
          zone={editingInundationZone}
          onClose={() => setEditingInundationZone(null)}
          onSaved={handleInundationSaved}
        />
      )}

      {/* FLOATING STATUS PANEL - Top Left */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 60,
        zIndex: 1000,
        width: 250,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(15, 23, 42, 0.15)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        border: '1px solid #e2e8f0',
        color: '#1e293b'
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🧭 Status Operasi</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: 4, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>LEVEL</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: LEVEL_COLORS[detection.level] }}>
              {detection.level.toUpperCase()}
            </div>
          </div>
          <div style={{ background: '#f8fafc', padding: '6px 8px', borderRadius: 4, textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 600 }}>SIRINE</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: sirenActive ? '#ef4444' : '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {sirenActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'pulse 1s infinite' }} />}
              {sirenActive ? 'AKTIF' : 'OFF'}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
          👤 {user?.full_name || 'Operator'} ({user?.role?.toUpperCase()})
        </div>
      </div>

      {/* FLOATING CONTROL PANEL (Layers & Quick Focus) - Top Right */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1000,
        width: 260,
        maxHeight: 'calc(100vh - 280px)',
        overflowY: 'auto',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(15, 23, 42, 0.15)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        border: '1px solid #e2e8f0',
        color: '#1e293b'
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>🎛️ Layer Peta</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {Object.entries(layers).map(([key, enabled]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 10, color: enabled ? '#1e293b' : '#64748b' }}>
              <input type="checkbox" checked={enabled} onChange={() => toggleLayer(key as LayerKey)} style={{ accentColor: '#06b6d4' }} />
              {key.replace(/_/g, ' ').toUpperCase()}
            </label>
          ))}
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginTop: 4 }}>🏥 Fokus Fasilitas</div>
        <select
          className="form-input"
          style={{ fontSize: 11, padding: '4px 6px', height: 'auto' }}
          onChange={(e) => {
            const fac = mapFacilities.find(f => `fac-${f.id}` === e.target.value);
            if (fac) setFocusCenter([fac.lat, fac.lng]);
          }}
          defaultValue=""
        >
          <option value="">-- Pilih Fasilitas --</option>
          {mapFacilities.map(f => (
            <option key={f.id} value={`fac-${f.id}`}>{facilityLabel(f.type)} • {f.name}</option>
          ))}
        </select>

        <div style={{ fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f1f5f9', paddingBottom: 6, marginTop: 4 }}>🚧 Fokus & Dispatch Aset</div>
        <select
          className="form-input"
          style={{ fontSize: 11, padding: '4px 6px', height: 'auto' }}
          value={selectedAssetId}
          onChange={(e) => {
            setSelectedAssetId(e.target.value);
            setDispatchPlan(null);
            setAnimationRunning(false);
            setAnimationProgress(0);
            const ast = dispatchAssets.find(a => a.id === e.target.value);
            if (ast) setFocusCenter([ast.lat, ast.lng]);
          }}
        >
          <option value="">-- Pilih Alat/Aset --</option>
          {dispatchAssets.map(a => (
            <option key={a.id} value={a.id}>{equipmentLabel(a.type)} • {a.name}</option>
          ))}
        </select>
      </div>

      {/* FLOATING INUNDATION CONFIG PANEL - Right Center */}
      <div style={{
        position: 'absolute',
        top: 310,
        right: 10,
        zIndex: 1000,
        width: 260,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(15, 23, 42, 0.15)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        border: '1px solid #e2e8f0',
        color: '#1e293b'
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, borderBottom: '1px solid #f1f5f9', paddingBottom: 6 }}>🌊 Konfigurasi Area Rendaman</div>
        
        {actionMessage && <div style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>{actionMessage}</div>}
        {actionError && <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>{actionError}</div>}

        <select
          className="form-input"
          style={{ fontSize: 11, padding: '4px 6px', height: 'auto' }}
          onChange={(e) => {
            const zone = inundation.find(z => String(z.id) === e.target.value);
            if (zone) {
              setEditingInundationZone(zone);
              const coords = zone.coordinates || [];
              if (coords.length > 0) setFocusCenter([coords[0][1], coords[0][0]]);
            }
          }}
          defaultValue=""
        >
          <option value="">-- Edit Area Rendaman --</option>
          {inundation.map(z => (
            <option key={z.id} value={z.id}>{z.name} ({(z.risk_level || '').toUpperCase()})</option>
          ))}
        </select>

        {canEditInundation ? (
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%', fontSize: 11, padding: '6px 10px' }}
            onClick={() => {
              setActionMessage('');
              setActionError('');
              setEditingInundationZone({
                id: 0,
                name: '',
                risk_level: 'medium',
                coordinates: [],
              } as any);
            }}
          >
            ➕ Tambah Area Baru
          </button>
        ) : (
          <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center' }}>Role anda hanya dapat melihat area rendaman.</div>
        )}
      </div>

      {/* DISPATCH ACTION FLOATING BANNER - Bottom Center */}
      {selectedAsset && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          width: 'min(720px, 90%)',
          background: 'rgba(15, 23, 42, 0.95)',
          color: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.3)',
          padding: '14px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#38bdf8', fontWeight: 700 }}>🚀 DISPATCH UNIT AKTIF</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>🚧 {selectedAsset.name} ({equipmentLabel(selectedAsset.type)})</div>
            </div>
            
            <div style={{ display: 'flex', gap: 8 }}>
              {dispatchPlan ? (
                <>
                  <button className="btn btn-primary btn-sm" style={{ color: '#000' }} onClick={handleStartAnimation}>
                    {animationRunning ? '🔄 Ulangi Animasi' : '▶ Mulai Perjalanan'}
                  </button>
                  <button className="btn btn-outline btn-sm" style={{ color: '#fff', borderColor: '#475569' }} onClick={handleResetDispatch}>
                    Reset Rute
                  </button>
                </>
              ) : (
                <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                  📌 Silakan klik lokasi mana saja pada peta untuk menentukan rute tujuan.
                </div>
              )}
              <button className="btn btn-outline btn-sm" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={() => {
                setSelectedAssetId('');
                setDispatchPlan(null);
                setAnimationRunning(false);
                setAnimationProgress(0);
              }}>
                Batal
              </button>
            </div>
          </div>

          {dispatchPlan && (
            <div style={{ borderTop: '1px solid #334155', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1' }}>
                <span><b>Rute Jalan:</b> {dispatchPlan.roadName}</span>
                <span><b>Jarak:</b> {dispatchPlan.distanceKm.toFixed(2)} km</span>
                <span><b>Estimasi:</b> {dispatchPlan.estimatedMinutes} menit</span>
              </div>
              
              <div style={{ width: '100%', height: 6, background: '#334155', borderRadius: 999, overflow: 'hidden', marginTop: 4 }}>
                <div style={{ width: `${Math.round(animationProgress * 100)}%`, height: '100%', background: '#06b6d4', transition: 'width 0.1s linear' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8' }}>
                <span>Titik Awal</span>
                <span>Progres: {Math.round(animationProgress * 100)}%</span>
                <span>Tujuan</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MAP VIEWPORT */}
      <div style={{ width: '100%', height: '100%' }}>
        {loadingLayers && <div style={{ position: 'absolute', top: 12, left: 320, zIndex: 1000, background: '#fff', padding: '6px 12px', borderRadius: 4, fontSize: 11, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>Memuat layer peta operator...</div>}
        {loadError && <div style={{ position: 'absolute', top: 12, left: 320, zIndex: 1000, background: '#fee2e2', color: '#ef4444', padding: '6px 12px', borderRadius: 4, fontSize: 11, border: '1px solid #fca5a5' }}>{loadError}</div>}

        <MapContainer center={MAP_CENTER} zoom={14} style={{ height: '100%', width: '100%', background: '#0a1628' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          <MapFocusController center={focusCenter} />
          <MapWaypointSelector enabled={Boolean(selectedAsset)} onSelect={handleWaypointSelected} />

          {layers.inundation && inundation.map(zone => (
            <Polygon
              key={zone.id}
              positions={zone.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple)}
              pathOptions={{ color: zone.risk_level === 'high' ? '#ef4444' : '#f97316', fillOpacity: 0.22, weight: 1.5, dashArray: '6,3' }}
            >
              <Popup>
                <div style={{ color: '#1e293b' }}>
                  <b style={{ fontSize: 13 }}>🌊 Area Rendaman: {zone.name}</b><br />
                  Risiko: <span style={{ fontWeight: 700, color: zone.risk_level === 'high' ? '#ef4444' : '#f97316' }}>{(zone.risk_level || '').toUpperCase()}</span><br />
                  Catatan: {(zone as any).notes || '-'}<br />
                  {canEditInundation && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setActionMessage('');
                        setActionError('');
                        setEditingInundationZone(zone);
                      }}
                      style={{ marginTop: 8, fontSize: 11, width: '100%' }}
                    >
                      ✏️ Edit Batas Area
                    </button>
                  )}
                </div>
              </Popup>
            </Polygon>
          ))}

          {layers.safe_zones && safeZones.map(zone => (
            <Polygon
              key={zone.id}
              positions={zone.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple)}
              pathOptions={{ color: '#22c55e', fillOpacity: 0.18, weight: 2 }}
            >
              <Popup>
                <div style={{ color: '#1e293b' }}>
                  <b style={{ fontSize: 13, color: '#22c55e' }}>🟢 Zona Aman: {zone.name}</b><br />
                  Elevasi: {zone.elevation_m}m<br />
                  Kapasitas: {zone.capacity?.toLocaleString('id-ID')} orang
                </div>
              </Popup>
            </Polygon>
          ))}

          {layers.evacuation && evacRoutes.map(route => (
            <Polyline
              key={route.id}
              positions={route.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple)}
              pathOptions={{ color: ROUTE_COLORS[route.status] || '#22c55e', weight: 4, opacity: 0.55, dashArray: route.status === 'clear' ? undefined : '8,4' }}
            >
              <Popup>
                <div style={{ color: '#1e293b', minWidth: 180 }}>
                  <b style={{ fontSize: 13 }}>{route.name}</b><br />
                  Estimasi: {route.estimated_time_min} menit<br />
                  Jarak: {(route.distance_m / 1000).toFixed(1)} km<br />
                  <div style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 10, color: '#64748b' }}>Status Jalur:</label>
                    <select 
                      className="form-input" 
                      style={{ fontSize: 11, padding: '4px 6px', marginTop: 4, height: 'auto', width: '100%' }}
                      value={route.status}
                      disabled={!isOperator}
                      onChange={(e) => handleUpdateRouteStatus(route, e.target.value)}
                    >
                      <option value="clear">Clear</option>
                      <option value="warning">Warning</option>
                      <option value="congested">Congested</option>
                      <option value="blocked">Blocked</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                </div>
              </Popup>
            </Polyline>
          ))}

          {dispatchPlan && (
            <Polyline
              positions={dispatchPlan.routeCoordinates}
              pathOptions={{ color: '#06b6d4', weight: 6, opacity: 0.95, dashArray: '10,6' }}
            >
              <Popup>
                <div style={{ color: '#1e293b' }}>
                  <b>Rute Dispatch</b><br />
                  Unit: {dispatchPlan.asset.name}<br />
                  Jalan: {dispatchPlan.roadName}<br />
                  Jarak: {dispatchPlan.distanceKm.toFixed(2)} km
                </div>
              </Popup>
            </Polyline>
          )}

          {dispatchPlan && (
            <Marker position={dispatchPlan.waypoint} icon={waypointIcon}>
              <Popup>
                <div style={{ color: '#1e293b' }}>
                  <b>🎯 Waypoint Tujuan</b>
                </div>
              </Popup>
            </Marker>
          )}

          {movingPosition && dispatchPlan && (
            <Marker position={movingPosition} icon={movingAssetIcon}>
              <Popup>
                <div style={{ color: '#1e293b' }}>
                  <b>🚓 Unit Bergerak</b><br />
                  {dispatchPlan.asset.name}<br />
                  Progres: {Math.round(animationProgress * 100)}%
                </div>
              </Popup>
            </Marker>
          )}

          {layers.sirens && mapSirens.map(siren => (
            <React.Fragment key={siren.id}>
              <CircleMarker
                center={[siren.lat, siren.lng]}
                radius={sirenActive ? 14 : 8}
                pathOptions={{ color: sirenActive ? '#ef4444' : '#94a3b8', fillColor: sirenActive ? '#ef4444' : '#475569', fillOpacity: 0.8, weight: 2 }}
              >
                <Popup>
                  <div style={{ color: '#1e293b' }}>
                    <b>🔊 {siren.name}</b><br />
                    Kode: {siren.code}<br />
                    Status: {siren.status}<br />
                    Radius: {siren.radius_m}m
                  </div>
                </Popup>
              </CircleMarker>
              <Circle
                center={[siren.lat, siren.lng]}
                radius={siren.radius_m || 500}
                pathOptions={{ color: sirenActive ? '#ef4444' : '#475569', fillColor: 'transparent', fillOpacity: 0, weight: 1, opacity: 0.3 }}
              />
            </React.Fragment>
          ))}

          {layers.facilities && mapFacilities.map(facility => (
            <Marker
              key={facility.id}
              position={[facility.lat, facility.lng]}
              icon={mapDivIcon(FACILITY_ICONS[facility.type] || FACILITY_ICONS.lainnya || 'FAS', FACILITY_COLORS[facility.type] || '#757575')}
            >
              <Popup>
                <div style={{ color: '#1e293b', minWidth: 180 }}>
                  <b style={{ fontSize: 13 }}>{FACILITY_ICONS[facility.type]} {facility.name}</b><br />
                  Jenis: {facilityLabel(facility.type)}<br />
                  Status: <span style={{ fontWeight: 700, color: facility.is_active !== false ? '#22c55e' : '#ef4444' }}>{facility.is_active !== false ? 'Aktif' : 'Non-Aktif'}</span><br />
                  {facility.address && <>Alamat: {facility.address}<br /></>}
                  {facility.phone && <>Telp: {facility.phone}<br /></>}
                  {(facility.description || facility.notes) && <>Keterangan: {facility.description || facility.notes}<br /></>}
                  
                  {isOperator && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button 
                        className="btn btn-outline btn-sm" 
                        style={{ fontSize: 11, width: '100%' }}
                        onClick={() => handleToggleFacilityStatus(facility)}
                      >
                        {facility.is_active !== false ? '🔴 Non-Aktifkan Fasilitas' : '🟢 Aktifkan Fasilitas'}
                      </button>

                      {(facility.type === 'polisi' || facility.type === 'damkar') && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: 11, width: '100%' }}
                          onClick={() => {
                            setSelectedAssetId(`facility-${facility.id}`);
                            setDispatchPlan(null);
                            setAnimationRunning(false);
                            setAnimationProgress(0);
                          }}
                        >
                          🚀 Dispatch Unit {facility.type === 'polisi' ? 'Polisi' : 'Damkar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {layers.heavy_equipment && equipment.map(item => (
            <Marker
              key={item.id}
              position={[item.lat, item.lng]}
              icon={mapDivIcon(
                equipmentIcon(item.type),
                item.status === 'available' ? '#facc15' : item.status === 'in_use' ? '#f97316' : item.status === 'maintenance' ? '#ef4444' : '#94a3b8',
              )}
            >
              <Popup>
                <div style={{ color: '#1e293b', minWidth: 180 }}>
                  <b style={{ fontSize: 13 }}>🚧 {item.name}</b><br />
                  Jenis: {equipmentLabel(item.type)}<br />
                  {(item.description || item.notes) && <>Keterangan: {item.description || item.notes}<br /></>}
                  
                  {isOperator && (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 10, color: '#64748b' }}>Status Aset:</label>
                      <select 
                        className="form-input" 
                        style={{ fontSize: 11, padding: '4px 6px', marginTop: 4, height: 'auto', width: '100%' }}
                        value={item.status}
                        onChange={(e) => handleUpdateEquipmentStatus(item, e.target.value)}
                      >
                        <option value="available">Available</option>
                        <option value="in_use">In Use</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                    </div>
                  )}
                  
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 8, width: '100%', fontSize: 11 }}
                    onClick={() => {
                      setSelectedAssetId(`equipment-${item.id}`);
                      setDispatchPlan(null);
                      setAnimationRunning(false);
                      setAnimationProgress(0);
                    }}
                  >
                    🚀 Dispatch Aset Ini
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}

          {layers.sensors && mergedSensors.map(sensor => {
            const color = getSensorColor(sensor.delta_3m || 0);
            return (
              <CircleMarker
                key={sensor.id}
                center={[sensor.lat, sensor.lng]}
                radius={10}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>
                  <div style={{ color: '#1e293b' }}>
                    <b>📡 {sensor.name}</b><br />
                    Kode: {sensor.code}<br />
                    Status: {sensor.status}<br />
                    Level: <b>{(sensor.water_level_cm || 0).toFixed(1)} cm</b><br />
                    Δ3m: {(sensor.delta_3m || 0) > 0 ? '+' : ''}{(sensor.delta_3m || 0).toFixed(1)} cm
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}