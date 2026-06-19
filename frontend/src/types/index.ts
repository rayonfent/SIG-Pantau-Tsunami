export type AlertLevel = 'normal' | 'suspect' | 'waspada' | 'siaga' | 'awas';
export type SensorStatus = 'online' | 'offline' | 'suspect' | 'maintenance';
export type SirenStatus = 'active' | 'inactive' | 'fault';
export type RouteStatus = 'clear' | 'congested' | 'warning' | 'blocked' | 'maintenance';
export type UserRole = 'operator' | 'supervisor' | 'admin';

export interface SensorData {
  sensor_id: string;
  code: string;
  name: string;
  water_level_cm: number;
  delta_1m: number;
  delta_3m: number;
  delta_5m: number;
  rate_cm_per_min: number;
  z_score: number;
  quality: string;
  baseline_median: number;
  timestamp: string;
}

export interface DetectionState {
  level: AlertLevel;
  confidence_score: number;
  confidence_label: string;
  siren_active: boolean;
}

export interface AlertEvent {
  level: AlertLevel;
  previous_level: AlertLevel;
  confidence_score: number;
  confidence_label: string;
  triggered_by: string[];
  max_delta_cm: number;
  max_rate: number;
  max_zscore: number;
  sensor_count: number;
  timestamp: string;
  auto_siren: boolean;
}

export interface SirenEvent {
  action: string;
  siren_id?: string;
  siren_ids?: string[];
  reason: string;
  timestamp: string;
}

export interface User {
  username: string;
  role: UserRole;
  full_name: string;
}

export interface MapSensor {
  id: string; code: string; name: string;
  lng: number; lat: number; status: string; water_level_cm: number;
  delta_3m?: number; quality?: string; last_seen?: string;
}
export interface MapSiren {
  id: string; code: string; name: string;
  lng: number; lat: number; radius_m: number; status: string;
  is_auto_enabled?: boolean; last_activated?: string;
}
export interface MapFacility {
  id: string; name: string; type: string;
  lng: number; lat: number; phone: string; address?: string; capacity?: number; notes?: string; description?: string;
  is_active?: boolean;
}

export interface Facility {
  id: string;
  name: string;
  type: string;
  address?: string;
  phone?: string;
  description?: string;
  notes?: string;
  latitude: number;
  longitude: number;
  lat?: number;
  lng?: number;
  location_status?: string;
}
export interface EvacRoute {
  id: string; name: string; status: RouteStatus;
  coordinates: [number, number][]; distance_m: number; estimated_time_min: number;
  direction?: string; description?: string; notes?: string; capacity_persons?: number; priority?: number;
  geometry?: { type: 'LineString'; coordinates: [number, number][] };
}
export interface SafeZone {
  id: string; name: string; elevation_m: number;
  capacity: number; current_count: number;
  coordinates: [number, number][];
  facilities?: string[];
  geometry?: { type: 'Polygon'; coordinates: [number, number][][] };
  is_active?: boolean;
}
export interface InundationZone {
  id: string; name: string; risk_level: string;
  coordinates: [number, number][];
}

export interface MapEquipment {
  id: string; name: string; type: string; status: string;
  lng: number; lat: number; notes?: string; description?: string;
}

export interface HeavyEquipment {
  id: string;
  name: string;
  type: string;
  status: string;
  description?: string;
  latitude: number;
  longitude: number;
  lat?: number;
  lng?: number;
  notes?: string;
  location_status?: string;
}

export interface CustomMapPoint {
  id: string;
  name: string;
  description: string;
  type: 'posko' | 'titik_kumpul' | 'bahaya' | 'informasi' | 'lainnya';
  lng: number;
  lat: number;
  created_by?: string;
  created_at?: string;
}
