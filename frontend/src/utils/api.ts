import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export const api = axios.create({ baseURL: `${API_URL}/api` });

// Inject token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const mapApi = {
  config:       () => api.get('/map/config'),
  layers:       () => api.get('/map/layers'),
  sensors:      () => api.get('/map/sensors'),
  sirens:       () => api.get('/map/sirens'),
  facilities:   () => api.get('/map/facilities'),
  evacRoutes:   () => api.get('/map/evacuation-routes'),
  safeZones:    () => api.get('/map/safe-zones'),
  inundation:   () => api.get('/map/inundation-zones'),
  equipment:    () => api.get('/map/heavy-equipment'),
  customPoints: () => api.get('/map/custom-points'),
  createCustomPoint: (payload: { name: string; description?: string; type: string; lng: number; lat: number }) =>
    api.post('/map/custom-points', payload),
};

export const simApi = {
  start:  (scenario: string, override: number) => api.post('/simulation/start', { scenario, water_override: override }),
  stop:   () => api.post('/simulation/stop'),
  update: (scenario: string, override: number) => api.post('/simulation/update', { scenario, water_override: override }),
  status: () => api.get('/simulation/status'),
};

export const authApi = {
  login: (username: string, password: string) => api.post('/auth/login', { username, password }),
  me:    () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const dashboardApi = {
  summary: () => api.get('/reports/dashboard'),
};

export const dataApi = {
  sensors: () => api.get('/sensors/'),
  sirens: () => api.get('/sirens/'),
  alerts: () => api.get('/alerts/'),
  activeAlerts: () => api.get('/alerts/active'),
  routes: () => api.get('/evacuation/routes'),
  createRoute: (payload: any) => api.post('/evacuation/routes', payload),
  updateRoute: (id: string, payload: any) => api.put(`/evacuation/routes/${id}`, payload),
  deleteRoute: (id: string) => api.delete(`/evacuation/routes/${id}`),
  safeZones: () => api.get('/evacuation/safe-zones'),
  recommendedRoutes: () => api.get('/evacuation/recommended'),
  facilities: () => api.get('/facilities/'),
  equipment: () => api.get('/facilities/equipment'),
  createFacility: (payload: any) => api.post('/facilities/', payload),
  updateFacility: (id: string, payload: any) => api.put(`/facilities/${id}`, payload),
  deleteFacility: (id: string) => api.delete(`/facilities/${id}`),
  createEquipment: (payload: any) => api.post('/facilities/equipment', payload),
  updateEquipment: (id: string, payload: any) => api.put(`/facilities/equipment/${id}`, payload),
  deleteEquipment: (id: string) => api.delete(`/facilities/equipment/${id}`),
  auditLogs: (action?: string) => api.get('/audit/logs', { params: action ? { action } : {} }),
  dailyReport: () => api.get('/reports/daily'),
  deviceHealth: () => api.get('/reports/device-health'),
  thresholdConfig: () => api.get('/reports/threshold-config'),
  updateThresholdConfig: (payload: any) => api.put('/reports/threshold-config', payload),
};
