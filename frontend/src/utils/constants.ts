import { AlertLevel } from '../types';

export const LEVEL_COLORS: Record<AlertLevel, string> = {
  normal:   '#22c55e',
  suspect:  '#eab308',
  waspada:  '#f97316',
  siaga:    '#ef4444',
  awas:     '#7c3aed',
};

export const LEVEL_BG: Record<AlertLevel, string> = {
  normal:   '#052e16',
  suspect:  '#422006',
  waspada:  '#431407',
  siaga:    '#450a0a',
  awas:     '#2e1065',
};

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  normal:   'NORMAL',
  suspect:  'SUSPECT',
  waspada:  'WASPADA',
  siaga:    'SIAGA',
  awas:     'AWAS ⚠️',
};

export const FACILITY_COLORS: Record<string, string> = {
  polisi:  '#1E88E5',
  medis:   '#43A047',
  damkar:  '#E53935',
  sar:     '#FDD835',
  lainnya: '#757575',
};

export const FACILITY_ICONS: Record<string, string> = {
  polisi:  '🛡️',
  medis:   '🏥',
  damkar:  '🚒',
  sar:     '🛟',
  lainnya: '🏢',
};

export const ROUTE_COLORS: Record<string, string> = {
  clear:     '#22c55e',
  congested: '#f97316',
  blocked:   '#ef4444',
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID');
}
