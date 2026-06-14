import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L, { LatLngTuple } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { mapApi } from '../utils/api';
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
type DispatchAssetType = 'facility' | 'equipment';

type DispatchAsset = {
  id: string;
  name: string;
  type: string;
  category: DispatchAssetType;
  lat: number;
  lng: number;
  status?: string;
  address?: string;
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
  inundation: false,
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
      ...mapFacilities.map(facility => ({
        id: `facility-${facility.id}`,
        name: facility.name,
        type: facility.type,
        category: 'facility' as const,
        lat: facility.lat,
        lng: facility.lng,
        address: facility.address,
        description: facility.description || facility.notes,
      })),
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

  const handleWaypointSelected = (waypoint: LatLngTuple) => {
    if (!selectedAsset) return;
    const nextPlan = buildDispatchPlan(selectedAsset, waypoint, evacRoutes);
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

  const operatorInstruction = selectedAsset
    ? 'Klik peta untuk menentukan waypoint tujuan. Sistem akan memilih koridor jalan utama/evakuasi terdekat secara otomatis.'
    : 'Pilih dahulu fasilitas atau aset yang akan diberangkatkan, lalu klik titik tujuan di peta.';

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 110px)', gap: 12 }}>
      <div className="card" style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
        <div>
          <div className="card-title">🧭 Konsol Operator</div>
          <div className="infobox" style={{ fontSize: 11, lineHeight: 1.6 }}>
            Operator dapat memilih fasilitas/aset, mematikan sirine sesuai prosedur, lalu mengirim unit ke waypoint tujuan dengan rute otomatis mengikuti koridor jalan utama.
          </div>
        </div>

        <div>
          <div className="section-title">Status Operasi</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="stat-box" style={{ padding: 12 }}>
              <div className="stat-label">Level</div>
              <div className="stat-value" style={{ fontSize: 22, color: LEVEL_COLORS[detection.level] }}>
                {detection.level.toUpperCase()}
              </div>
            </div>
            <div className="stat-box" style={{ padding: 12 }}>
              <div className="stat-label">Sirine</div>
              <div className="stat-value" style={{ fontSize: 22, color: sirenActive ? '#ef4444' : '#22c55e' }}>
                {sirenActive ? 'AKTIF' : 'OFF'}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="section-title">Dispatch Aset</div>
          <label className="form-label">Pilih fasilitas/aset awal</label>
          <select
            className="form-input"
            value={selectedAssetId}
            onChange={(event) => {
              setSelectedAssetId(event.target.value);
              setDispatchPlan(null);
              setAnimationRunning(false);
              setAnimationProgress(0);
            }}
          >
            <option value="">-- Pilih aset/fasilitas --</option>
            {dispatchAssets.map(asset => (
              <option key={asset.id} value={asset.id}>
                {asset.category === 'facility' ? 'Fasilitas' : 'Aset'} • {asset.name}
              </option>
            ))}
          </select>

          {selectedAsset && (
            <div className="infobox" style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6 }}>
              <b>{selectedAsset.category === 'facility' ? 'Fasilitas' : 'Aset'}:</b> {selectedAsset.name}<br />
              <b>Jenis:</b> {selectedAsset.category === 'facility' ? facilityLabel(selectedAsset.type) : equipmentLabel(selectedAsset.type)}<br />
              {selectedAsset.status && <><b>Status:</b> {selectedAsset.status}<br /></>}
              {selectedAsset.address && <><b>Alamat:</b> {selectedAsset.address}<br /></>}
              <b>Koordinat:</b> {selectedAsset.lat.toFixed(5)}, {selectedAsset.lng.toFixed(5)}
            </div>
          )}

          <div className="infobox" style={{ marginTop: 10, fontSize: 11 }}>
            {operatorInstruction}
          </div>
        </div>

        <div>
          <div className="section-title">Layer & Legenda</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {Object.entries(layers).map(([key, enabled]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11, color: enabled ? '#1f2937' : '#64748b' }}>
                <input type="checkbox" checked={enabled} onChange={() => toggleLayer(key as LayerKey)} style={{ accentColor: '#06b6d4' }} />
                {key.replace(/_/g, ' ').toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        {dispatchPlan ? (
          <div>
            <div className="section-title">Rencana Perjalanan</div>
            <div className="stat-box" style={{ padding: 12, gap: 8 }}>
              <div className="stat-label">Unit Terpilih</div>
              <div style={{ fontWeight: 700 }}>{dispatchPlan.asset.name}</div>
              <div className="route-meta">Koridor utama: {dispatchPlan.roadName}</div>
              <div className="route-meta">Jarak total: {dispatchPlan.distanceKm.toFixed(2)} km</div>
              <div className="route-meta">Estimasi waktu: {dispatchPlan.estimatedMinutes} menit</div>
              <div className="route-meta">Kecepatan simulasi: {dispatchPlan.travelSpeedKmh} km/jam</div>
              <div className="route-meta">
                Waypoint: {dispatchPlan.waypoint[0].toFixed(5)}, {dispatchPlan.waypoint[1].toFixed(5)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={handleStartAnimation}>
                  ▶ Mulai Animasi
                </button>
                <button className="btn btn-outline btn-sm" onClick={handleResetDispatch}>
                  Reset Jalur
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <div className="stat-label">Progres simulasi</div>
                <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(animationProgress * 100)}%`, height: '100%', background: '#06b6d4' }} />
                </div>
                <div className="route-meta" style={{ marginTop: 6 }}>
                  {Math.round(animationProgress * 100)}% perjalanan
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="infobox" style={{ fontSize: 11 }}>
            Belum ada jalur aktif. Pilih aset/fasilitas dan klik waypoint pada peta untuk membuat rute otomatis.
          </div>
        )}

        <div style={{ marginTop: 'auto', padding: 10, borderRadius: 6, background: LEVEL_COLORS[detection.level] + '22', border: `1px solid ${LEVEL_COLORS[detection.level]}`, textAlign: 'center', color: LEVEL_COLORS[detection.level], fontSize: 12, fontWeight: 700 }}>
          {user?.full_name || 'Operator'} • {user?.role?.toUpperCase()}
          {sirenActive && <div style={{ fontSize: 10, marginTop: 4 }}>🔊 Sirine aktif — operator dapat mengendalikan penghentian sesuai SOP</div>}
        </div>
      </div>

      <div style={{ flex: 1, borderRadius: 8, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
        {loadingLayers && <div className="infobox" style={{ margin: 12, fontSize: 11 }}>Memuat layer peta operator...</div>}
        {loadError && <div className="infobox" style={{ margin: 12, fontSize: 11, borderColor: '#ef4444', color: '#ef4444' }}>{loadError}</div>}

        <MapContainer center={MAP_CENTER} zoom={14} style={{ height: '100%', width: '100%', background: '#0a1628' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          <MapWaypointSelector enabled={Boolean(selectedAsset)} onSelect={handleWaypointSelected} />

          {layers.inundation && inundation.map(zone => (
            <Polygon
              key={zone.id}
              positions={zone.coordinates.map(([lng, lat]) => [lat, lng] as LatLngTuple)}
              pathOptions={{ color: zone.risk_level === 'high' ? '#ef4444' : '#f97316', fillOpacity: 0.22, weight: 1.5, dashArray: '6,3' }}
            >
              <Popup>
                <b>{zone.name}</b><br />
                Risiko: {zone.risk_level}
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
                <b>🟢 {zone.name}</b><br />
                Elevasi: {zone.elevation_m}m<br />
                Kapasitas: {zone.capacity?.toLocaleString('id-ID')} orang
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
                <b>{route.name}</b><br />
                Status: {route.status}<br />
                Estimasi: {route.estimated_time_min} menit<br />
                Jarak: {(route.distance_m / 1000).toFixed(1)} km
              </Popup>
            </Polyline>
          ))}

          {dispatchPlan && (
            <Polyline
              positions={dispatchPlan.routeCoordinates}
              pathOptions={{ color: '#06b6d4', weight: 6, opacity: 0.95, dashArray: '10,6' }}
            >
              <Popup>
                <b>Rute Dispatch Operator</b><br />
                Unit: {dispatchPlan.asset.name}<br />
                Koridor utama: {dispatchPlan.roadName}<br />
                Jarak: {dispatchPlan.distanceKm.toFixed(2)} km<br />
                Estimasi: {dispatchPlan.estimatedMinutes} menit
              </Popup>
            </Polyline>
          )}

          {dispatchPlan && (
            <Marker position={dispatchPlan.waypoint} icon={waypointIcon}>
              <Popup>
                <b>🎯 Waypoint Tujuan</b><br />
                {dispatchPlan.waypoint[0].toFixed(5)}, {dispatchPlan.waypoint[1].toFixed(5)}
              </Popup>
            </Marker>
          )}

          {movingPosition && dispatchPlan && (
            <Marker position={movingPosition} icon={movingAssetIcon}>
              <Popup>
                <b>🚓 Unit Bergerak</b><br />
                {dispatchPlan.asset.name}<br />
                Progres: {Math.round(animationProgress * 100)}%
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
                  <b>🔊 {siren.name}</b><br />
                  Kode: {siren.code}<br />
                  Status: {siren.status}<br />
                  Radius: {siren.radius_m}m
                </Popup>
              </CircleMarker>
              <CircleMarker
                center={[siren.lat, siren.lng]}
                radius={siren.radius_m / 15}
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
                <b>{FACILITY_ICONS[facility.type]} {facility.name}</b><br />
                Jenis: {facilityLabel(facility.type)}<br />
                {facility.address && <>Alamat: {facility.address}<br /></>}
                {facility.phone && <>Telp: {facility.phone}<br /></>}
                {(facility.description || facility.notes) && <>Keterangan: {facility.description || facility.notes}<br /></>}
                Koordinat: {facility.lat.toFixed(5)}, {facility.lng.toFixed(5)}
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
                <b>🚧 {item.name}</b><br />
                Jenis: {equipmentLabel(item.type)}<br />
                Status: {item.status}<br />
                {(item.description || item.notes) && <>Keterangan: {item.description || item.notes}<br /></>}
                Koordinat: {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
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
                  <b>📡 {sensor.name}</b><br />
                  Kode: {sensor.code}<br />
                  Status: {sensor.status}<br />
                  Level: <b>{(sensor.water_level_cm || 0).toFixed(1)} cm</b><br />
                  Δ3m: {(sensor.delta_3m || 0) > 0 ? '+' : ''}{(sensor.delta_3m || 0).toFixed(1)} cm<br />
                  Quality: {sensor.quality?.toUpperCase()}<br />
                  Update: {sensor.last_seen ? new Date(sensor.last_seen).toLocaleString('id-ID') : '-'}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}