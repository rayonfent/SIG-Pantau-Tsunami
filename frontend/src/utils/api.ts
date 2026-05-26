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
};
