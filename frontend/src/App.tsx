import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Polygon, CircleMarker, Popup, LayersControl, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useWebSocket } from './hooks/useWebSocket';
import { AlertLevel, SensorData, DetectionState, AlertEvent, SirenEvent, User } from './types';
import { LEVEL_COLORS, LEVEL_LABEL, ROUTE_COLORS, FACILITY_COLORS, FACILITY_ICONS, FACILITY_LABELS } from './utils/constants';
import { authApi, dataApi, mapApi } from './utils/api';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import MonitoringPeta from './pages/MonitoringPeta';
import OperatorPage from './pages/OperatorPage';
import DeteksiAlert from './pages/DeteksiAlert';
import Evakuasi from './pages/Evakuasi';
import Fasilitas from './pages/Fasilitas';
import StatusPerangkat from './pages/StatusPerangkat';
import SimulasiDrill from './pages/SimulasiDrill';
import Riwayat from './pages/Riwayat';
import AuditLog from './pages/AuditLog';
import Laporan from './pages/Laporan';
import DataMaster from './pages/DataMaster';
import Pengaturan from './pages/Pengaturan';
import WarningOverlay from './components/alert/WarningOverlay';
import './App.css';

const PAGES = [
  { id: 'dashboard',    label: 'Dashboard',         icon: '📊' },
  { id: 'monitoring',   label: 'Monitoring Peta',   icon: '🗺️' },
  { id: 'deteksi',      label: 'Deteksi & Alert',   icon: '🚨' },
  { id: 'evakuasi',     label: 'Evakuasi',           icon: '🚶' },
  { id: 'fasilitas',    label: 'Fasilitas & Aset',  icon: '🏥' },
  { id: 'perangkat',    label: 'Status Perangkat',  icon: '📡' },
  { id: 'simulasi',     label: 'Simulasi & Drill',  icon: '🎮' },
  { id: 'riwayat',      label: 'Riwayat',            icon: '📜' },
  { id: 'audit',        label: 'Audit Log',          icon: '🔍' },
  { id: 'laporan',      label: 'Laporan',            icon: '📄' },
  { id: 'master',       label: 'Data Master',        icon: '🗃️' },
  { id: 'pengaturan',   label: 'Pengaturan',         icon: '⚙️' },
];

const PAGE_PATHS: Record<string, string> = {
  dashboard: 'dashboard',
  monitoring: 'map',
  deteksi: 'alerts',
  evakuasi: 'evacuation',
  fasilitas: 'facilities',
  perangkat: 'devices',
  simulasi: 'simulation',
  riwayat: 'history',
  audit: 'audit',
  laporan: 'reports',
  master: 'master-data',
  pengaturan: 'settings',
};
const pageFromPath = (path: string) => Object.entries(PAGE_PATHS).find(([, slug]) => `/admin/${slug}` === path)?.[0] || 'dashboard';
const pathFromPage = (id: string) => `/admin/${PAGE_PATHS[id] || 'dashboard'}`;
const toLatLng = ([lng, lat]: [number, number]): [number, number] => [lat, lng];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [activePage, setActivePage] = useState(pageFromPath(window.location.pathname));
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Real-time state
  const [sensors, setSensors] = useState<Record<string, SensorData>>({});
  const [detection, setDetection] = useState<DetectionState>({
    level: 'normal', confidence_score: 0, confidence_label: 'low', siren_active: false,
  });
  const [alertHistory, setAlertHistory] = useState<AlertEvent[]>([]);
  const [sirenHistory, setSirenHistory] = useState<SirenEvent[]>([]);
  const [showWarning, setShowWarning] = useState(false);
  const [currentAlert, setCurrentAlert] = useState<AlertEvent | null>(null);
  const [sirenActive, setSirenActive] = useState(false);
  const [mode, setMode] = useState<'live' | 'simulation'>('live');
  const [simulationPreview, setSimulationPreview] = useState<{
    running: boolean;
    sensors?: Record<string, SensorData>;
    detection?: DetectionState;
  }>({ running: false });
  const [authMessage, setAuthMessage] = useState('');
  const { connected } = useWebSocket(useCallback((msg) => {
    if (msg.event === 'sensor_update') {
      const d = msg.data;
      const updated: Record<string, SensorData> = {};
      for (const s of d.sensors) updated[s.sensor_id] = s;
      setSensors(prev => ({ ...prev, ...updated }));
      setDetection(d.detection);
      setSirenActive(d.detection.siren_active);
      setMode(d.mode);
    } else if (msg.event === 'alert') {
      const a: AlertEvent = msg.data;
      setAlertHistory(prev => [a, ...prev].slice(0, 100));
      if (a.level === 'awas') {
        setCurrentAlert(a);
        setShowWarning(true);
      } else if (a.level === 'normal' && a.previous_level === 'awas') {
        // Keep warning until supervisor dismisses
      }
    } else if (msg.event === 'siren_event') {
      const s: SirenEvent = msg.data;
      setSirenHistory(prev => [s, ...prev].slice(0, 50));
      if (s.action === 'auto_on' || s.action === 'manual_on') setSirenActive(true);
      if (s.action === 'auto_off' || s.action === 'manual_off') setSirenActive(false);
    }
  }, []));

  const navigate = useCallback((path: string, replace = false) => {
    if (replace) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
    setCurrentPath(window.location.pathname);
    if (path.startsWith('/admin')) setActivePage(pageFromPath(path));
  }, []);

  useEffect(() => {
    const onPop = () => {
      setCurrentPath(window.location.pathname);
      if (window.location.pathname.startsWith('/admin')) {
        setActivePage(pageFromPath(window.location.pathname));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleLogin = async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    const { access_token, role, full_name } = res.data;
    localStorage.setItem('token', access_token);
    setUser({ username, role, full_name });
    setAuthMessage(`Login berhasil sebagai ${role}`);
    navigate('/admin/dashboard', true);
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    localStorage.removeItem('token');
    setUser(null);
    setActivePage('dashboard');
    setAuthMessage('');
    navigate('/', true);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    authApi.me()
      .then(res => {
        const { username, role, full_name } = res.data;
        setUser({ username, role, full_name });
        if (window.location.pathname === '/login') navigate('/admin/dashboard', true);
      })
      .catch(() => {
        localStorage.removeItem('token');
        setUser(null);
        if (window.location.pathname.startsWith('/admin') || window.location.pathname === '/operator') navigate('/login', true);
      });
  }, [navigate]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (currentPath === '/login' && user) {
      navigate('/admin/dashboard', true);
    } else if ((currentPath.startsWith('/admin') || currentPath === '/operator') && !user && !token) {
      navigate('/login', true);
    }
  }, [currentPath, user, navigate]);

  const handleDismissWarning = () => {
    if (user?.role === 'supervisor' || user?.role === 'admin') {
      setShowWarning(false);
    }
  };

  const effectiveSensors = simulationPreview.running && simulationPreview.sensors ? simulationPreview.sensors : sensors;
  const effectiveDetection = simulationPreview.running && simulationPreview.detection ? simulationPreview.detection : detection;
  const effectiveSirenActive = simulationPreview.running && simulationPreview.detection ? simulationPreview.detection.siren_active : sirenActive;
  const effectiveMode = simulationPreview.running ? 'simulation' : mode;

  useEffect(() => {
    const stored = localStorage.getItem('sig-tsunami-simulation-preview');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.running) setSimulationPreview(parsed);
      } catch {
        localStorage.removeItem('sig-tsunami-simulation-preview');
      }
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'sig-tsunami-simulation-preview') return;
      if (!event.newValue) {
        setSimulationPreview({ running: false });
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue);
        setSimulationPreview(parsed?.running ? parsed : { running: false });
      } catch {
        setSimulationPreview({ running: false });
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleSimulationPreview = useCallback((payload: {
    running: boolean;
    sensors?: Record<string, SensorData>;
    detection?: DetectionState;
  }) => {
    setSimulationPreview(payload);
    if (payload.running) {
      localStorage.setItem('sig-tsunami-simulation-preview', JSON.stringify(payload));
    } else {
      localStorage.removeItem('sig-tsunami-simulation-preview');
    }
  }, []);

  const isLoginRoute = currentPath === '/login';
  const isAdminRoute = currentPath.startsWith('/admin');
  const isOperatorRoute = currentPath === '/operator';

  if (isLoginRoute && user) {
    return null;
  }

  if (isLoginRoute) return <LoginPage onLogin={handleLogin} />;

  if ((isAdminRoute || isOperatorRoute) && !user) {
    return null;
  }

  if (!isAdminRoute && !isOperatorRoute) {
    return (
      <PublicPortal
        currentPath={currentPath}
        navigate={navigate}
        sensors={effectiveSensors}
        detection={effectiveDetection}
        sirenActive={effectiveSirenActive}
        connected={connected}
      />
    );
  }

  const levelColor = LEVEL_COLORS[effectiveDetection.level];
  const levelLabel = LEVEL_LABEL[effectiveDetection.level];

  if (isOperatorRoute) {
    return (
      <div className="app-root">
        {showWarning && currentAlert && (
          <WarningOverlay
            alert={currentAlert}
            sirenActive={effectiveSirenActive}
            user={user}
            onDismiss={handleDismissWarning}
            onNavigate={(page) => { setActivePage(page); navigate(pathFromPage(page)); }}
          />
        )}

        <main className="main-content">
          <header className="topbar" style={{ borderBottomColor: effectiveDetection.level !== 'normal' ? levelColor : '#e2e8f0' }}>
            <div className="topbar-left">
              <h1 className="page-title">Tampilan Operator</h1>
            </div>
            <div className="topbar-right">
              <span className="area-label">📍 Panjang, Bandar Lampung</span>
              {effectiveSirenActive && (
                <span className="siren-active-badge">🔊 SIRINE AKTIF</span>
              )}
              <span className="time-display" id="clock" />
            </div>
          </header>

          <div className="page-body">
            <OperatorPage
              sensors={effectiveSensors}
              detection={effectiveDetection}
              alertHistory={alertHistory}
              sirenHistory={sirenHistory}
              sirenActive={effectiveSirenActive}
              connected={connected}
              mode={effectiveMode}
              user={user}
              onSimulationPreview={handleSimulationPreview}
            />
          </div>
        </main>

        <Clock />
      </div>
    );
  }

  const renderPage = () => {
    const commonProps = { 
      sensors: effectiveSensors, 
      detection: effectiveDetection, 
      alertHistory, 
      sirenHistory, 
      sirenActive: effectiveSirenActive, 
      connected, 
      mode: effectiveMode, 
      user,
      onSimulationPreview: handleSimulationPreview,
    };
    switch (activePage) {
      case 'dashboard':   return <Dashboard {...commonProps} />;
      case 'monitoring':  return <MonitoringPeta {...commonProps} />;
      case 'deteksi':     return <DeteksiAlert {...commonProps} />;
      case 'evakuasi':    return <Evakuasi {...commonProps} />;
      case 'fasilitas':   return <Fasilitas {...commonProps} />;
      case 'perangkat':   return <StatusPerangkat {...commonProps} />;
      case 'simulasi':    return <SimulasiDrill {...commonProps} />;
      case 'riwayat':     return <Riwayat {...commonProps} />;
      case 'audit':       return <AuditLog {...commonProps} />;
      case 'laporan':     return <Laporan {...commonProps} />;
      case 'master':      return <DataMaster {...commonProps} />;
      case 'pengaturan':  return <Pengaturan {...commonProps} />;
      default:            return <Dashboard {...commonProps} />;
    }
  };

  return (
    <div className="app-root">
      {/* Warning Fullscreen Overlay */}
      {showWarning && currentAlert && (
        <WarningOverlay
          alert={currentAlert}
          sirenActive={sirenActive}
          user={user}
          onDismiss={handleDismissWarning}
          onNavigate={(page) => { setActivePage(page); navigate(pathFromPage(page)); }}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-icon">🌊</span>
            {sidebarOpen && <span className="logo-text">SIG-PANTAU<br/><small>TSUNAMI</small></span>}
          </div>
          <button className="toggle-btn" onClick={() => setSidebarOpen(p => !p)}>
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        {/* Alert level badge */}
        <div className="level-badge" style={{ background: levelColor + '22', borderColor: levelColor, color: levelColor }}>
          <span className={`level-dot ${detection.level !== 'normal' ? 'pulse' : ''}`}
                style={{ background: levelColor }} />
          {sidebarOpen && <span>{levelLabel}</span>}
        </div>

        <nav className="sidebar-nav">
          {PAGES.map(p => (
            <button
              key={p.id}
              className={`nav-item ${activePage === p.id ? 'active' : ''} ${p.id === 'deteksi' && detection.level !== 'normal' ? 'alert-nav' : ''}`}
              onClick={() => { setActivePage(p.id); navigate(pathFromPage(p.id)); }}
              style={activePage === p.id ? { borderLeftColor: levelColor, color: levelColor } : {}}
            >
              <span className="nav-icon">{p.icon}</span>
              {sidebarOpen && <span className="nav-label">{p.label}</span>}
              {p.id === 'deteksi' && detection.level !== 'normal' && (
                <span className="nav-badge" style={{ background: levelColor }}>!</span>
              )}
            </button>
          ))}
        </nav>

        {sidebarOpen && (
          <div className="sidebar-footer">
            <div className="user-info">
              <span className="user-icon">👤</span>
              <div>
                <div className="user-name">{user.full_name}</div>
                <div className="user-role">{user.role.toUpperCase()}</div>
              </div>
            </div>
            {authMessage && <div className="infobox" style={{ fontSize: 10, padding: 8 }}>{authMessage}</div>}
            <div className="ws-status">
              <span className={`ws-dot ${connected ? 'connected' : 'disconnected'}`} />
              <span>{connected ? 'Terhubung' : 'Reconnecting...'}</span>
            </div>
            {mode === 'simulation' && (
              <div className="sim-badge">🎮 MODE SIMULASI</div>
            )}
            <button className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="main-content">
        {/* Top bar */}
        <header className="topbar" style={{ borderBottomColor: detection.level !== 'normal' ? levelColor : '#e2e8f0' }}>
          <div className="topbar-left">
            <h1 className="page-title">{PAGES.find(p => p.id === activePage)?.label}</h1>
          </div>
          <div className="topbar-right">
            <span className="area-label">📍 Panjang, Bandar Lampung</span>
            {sirenActive && (
              <span className="siren-active-badge">🔊 SIRINE AKTIF</span>
            )}
            <span className="time-display" id="clock" />
          </div>
        </header>

        <div className="page-body">
          {renderPage()}
        </div>
      </main>

      <Clock />
    </div>
  );
}

function Clock() {
  useEffect(() => {
    const el = document.getElementById('clock');
    const update = () => {
      if (el) el.textContent = new Date().toLocaleTimeString('id-ID', { hour12: false });
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);
  return null;
}

type PublicPortalProps = {
  currentPath: string;
  navigate: (path: string, replace?: boolean) => void;
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  sirenActive: boolean;
  connected: boolean;
};

type PublicData = {
  mapSensors: any[];
  sirens: any[];
  routes: any[];
  safeZones: any[];
  riskZones: any[];
  facilities: any[];
  alerts: any[];
  status: any;
};

const PUBLIC_NAV = [
  { path: '/', label: 'Dashboard' },
  { path: '/public/map', label: 'Monitoring Peta' },
  { path: '/public/risk-zones', label: 'Titik Rawan' },
  { path: '/public/facilities', label: 'Fasilitas' },
  { path: '/public/evacuation', label: 'Jalur Evakuasi' },
  { path: '/public/alerts', label: 'Peringatan' },
];

const PUBLIC_CENTER: [number, number] = [-5.4689, 105.3197];

const RISK_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#eab308',
};

const STATUS_GUIDE: Record<string, string> = {
  normal: 'Aktivitas masyarakat berjalan seperti biasa.',
  suspect: 'Sistem memantau perubahan awal. Tetap ikuti informasi resmi.',
  waspada: 'Pantau informasi resmi dan siapkan rute evakuasi.',
  siaga: 'Bersiap menuju zona aman melalui jalur yang tersedia.',
  awas: 'Segera lakukan evakuasi melalui jalur yang tersedia.',
};

function PublicPortal({ currentPath, navigate, sensors, detection, sirenActive, connected }: PublicPortalProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPublicWarning, setShowPublicWarning] = useState(false);
  const previousPublicLevel = useRef<AlertLevel>('normal');
  const publicSirenAudioRef = useRef<HTMLAudioElement | null>(null);
  const [data, setData] = useState<PublicData>({
    mapSensors: [],
    sirens: [],
    routes: [],
    safeZones: [],
    riskZones: [],
    facilities: [],
    alerts: [],
    status: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');

  const loadPublicData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statusRes, sensorRes, sirenRes, routeRes, zoneRes, riskRes, facilityRes, alertRes] = await Promise.all([
        mapApi.status(),
        mapApi.sensors(),
        mapApi.sirens(),
        dataApi.routes(),
        dataApi.safeZones(),
        mapApi.inundation(),
        dataApi.facilities(),
        dataApi.activeAlerts(),
      ]);
      setData({
        status: statusRes.data,
        mapSensors: sensorRes.data.sensors || [],
        sirens: sirenRes.data.sirens || [],
        routes: routeRes.data.routes || [],
        safeZones: zoneRes.data.safe_zones || [],
        riskZones: riskRes.data.zones || [],
        facilities: facilityRes.data.facilities || [],
        alerts: alertRes.data.alerts || [],
      });
      setLastUpdated(new Date().toLocaleString('id-ID'));
    } catch {
      setError('Gagal memuat data publik. Silakan tekan Refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPublicData(); }, [loadPublicData]);

  useEffect(() => {
    const previousLevel = previousPublicLevel.current;
    const isDanger = detection.level === 'awas' || sirenActive;

    if (isDanger && previousLevel !== detection.level) {
      setShowPublicWarning(true);

      const sirenAudio = publicSirenAudioRef.current;
      if (sirenAudio) {
        sirenAudio.volume = 1;
        sirenAudio.currentTime = 0;
        sirenAudio.play().catch(() => undefined);
      }
    }

    if (detection.level === 'normal' && previousLevel !== 'normal') {
      setShowPublicWarning(false);

      const sirenAudio = publicSirenAudioRef.current;
      if (sirenAudio) {
        sirenAudio.volume = 0.05;
      }
    }

    previousPublicLevel.current = detection.level;
  }, [detection.level, sirenActive]);

  const mergedSensors = data.mapSensors.map(ms => {
    const live = Object.values(sensors).find(s => s.sensor_id === ms.id || s.code === ms.code);
    return { ...ms, water_level_cm: live?.water_level_cm ?? ms.water_level_cm, delta_3m: live?.delta_3m ?? ms.delta_3m ?? 0 };
  });
  const activePath = PUBLIC_NAV.some(item => item.path === currentPath) ? currentPath : '/';
  const levelColor = LEVEL_COLORS[detection.level] || '#22c55e';
  const publicData = { ...data, mapSensors: mergedSensors };
  const activeAwas = detection.level === 'awas' || publicData.alerts.some((a: any) => String(a.level).toLowerCase() === 'awas');
  // Use detection and sirenActive from props (already effectiveDetection/effectiveSirenActive from parent)
  const common = { data: publicData, loading, error, lastUpdated, detection, sirenActive, connected, navigate, refresh: loadPublicData };
  const goPublic = (path: string) => {
    navigate(path);
    setMenuOpen(false);
  };

  const handleClosePublicWarning = () => {
    setShowPublicWarning(false);
    const sirenAudio = publicSirenAudioRef.current;
    if (sirenAudio) {
      sirenAudio.volume = 0.05;
    }
  };

  return (
    <div className="public-root">
      <div className="public-govbar">
        <div className="public-govbar-inner">
          <span>Sistem Informasi Publik Kebencanaan</span>
          <span>Panjang, Bandar Lampung</span>
          <span>{new Date().toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span>
          <span>{connected ? 'Realtime aktif' : 'Menyambungkan realtime'}</span>
        </div>
      </div>
      <audio
        ref={publicSirenAudioRef}
        src="https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg"
        loop
        preload="auto"
      />
      <header className="public-header">
        <div className="public-header-inner">
          <div className="public-agency-mark" aria-hidden="true">BP</div>
          <div className="public-brand">
            <h1>SIG-PANTAU TSUNAMI</h1>
            <p>Sistem Informasi Geografis Deteksi Dini Tsunami</p>
            <span>Panjang, Bandar Lampung</span>
          </div>
          <div className="public-status" style={{ borderColor: levelColor, color: levelColor, background: levelColor + '18' }}>
            <span className={`level-dot ${detection.level !== 'normal' ? 'pulse' : ''}`} style={{ background: levelColor }} />
            {detection.level.toUpperCase()}
          </div>
          <button className="public-menu-toggle" aria-label="Buka navigasi publik" onClick={() => setMenuOpen(v => !v)}>
            <span />
            <span />
            <span />
          </button>
        </div>
        <nav className={`public-nav ${menuOpen ? 'open' : ''}`} aria-label="Navigasi portal publik">
          {PUBLIC_NAV.map(item => (
            <button key={item.path} className={activePath === item.path ? 'active' : ''} onClick={() => goPublic(item.path)}>
              {item.path === '/' ? 'Beranda' : item.label}
            </button>
          ))}
        </nav>
      </header>

      {showPublicWarning && (
          <PublicWarningPopup
            detection={detection}
            sirenActive={sirenActive}
            onClose={handleClosePublicWarning}
            navigate={navigate}
          />
      )}

      <main className="public-main">
        <PublicSystemState loading={loading} error={error} lastUpdated={lastUpdated} connected={connected} refresh={loadPublicData} />
        {activeAwas && <PublicEmergencyBanner navigate={navigate} />}
        {activePath === '/' && <PublicDashboard {...common} />}
        {activePath === '/public/map' && <PublicMapPage {...common} />}
        {activePath === '/public/risk-zones' && <PublicRiskZonesPage {...common} />}
        {activePath === '/public/facilities' && <PublicFacilitiesPage {...common} />}
        {activePath === '/public/evacuation' && <PublicEvacuationPage {...common} />}
        {activePath === '/public/alerts' && <PublicAlertsPage {...common} />}
      </main>
      <footer className="public-footer">
        <div className="public-footer-inner">
          <div>
            <strong>SIG-PANTAU TSUNAMI</strong>
            <p>Sistem Informasi Publik Deteksi Dini Tsunami<br />Panjang, Bandar Lampung</p>
          </div>
          <p>Informasi pada portal ini digunakan sebagai panduan awal. Ikuti arahan petugas dan informasi resmi saat kondisi darurat.</p>
          <span>© 2026 Pemerintah Daerah</span>
        </div>
      </footer>
    </div>
  );
}

function PublicSystemState({ loading, error, lastUpdated, connected, refresh }: any) {
  return (
    <div className="public-system-row">
      <span className={`ws-dot ${connected ? 'connected' : 'disconnected'}`} />
      <span>{connected ? 'Koneksi realtime aktif' : 'Koneksi realtime tersambung ulang'}</span>
      <span>Pembaruan terakhir: {lastUpdated || '-'}</span>
      {loading && <span>Data sedang dimuat...</span>}
      {error && <span className="text-warn">{error}</span>}
      <button className="btn btn-outline btn-sm" onClick={refresh} disabled={loading}>Refresh</button>
    </div>
  );
}

function PublicWarningPopup({ detection, sirenActive, onClose, navigate }: any) {
  const levelColor = LEVEL_COLORS[detection.level] || '#ef4444';
  const title = detection.level === 'awas' ? 'PERINGATAN TSUNAMI AWAS' : 'PERINGATAN DINI TSUNAMI';
  const instruction = STATUS_GUIDE[detection.level] || STATUS_GUIDE.awas;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 5000,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 'min(680px, 100%)',
          background: '#ffffff',
          borderRadius: 20,
          border: `4px solid ${levelColor}`,
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.35)',
          overflow: 'hidden',
        }}
      >
        <div style={{ background: levelColor, color: '#fff', padding: '18px 22px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1.2 }}>STATUS DARURAT PUBLIK</div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{title}</div>
        </div>
        <div style={{ padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px', color: '#0f172a' }}>
            {instruction}
          </p>
          <p style={{ margin: '0 0 18px', color: '#334155', lineHeight: 1.6 }}>
            Portal publik sedang menampilkan status simulasi/peringatan terbaru. Masyarakat diminta mengikuti
            jalur evakuasi, menuju zona aman atau fasilitas terdekat, dan menunggu informasi resmi lanjutan.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <div className="stat-box">
              <div className="stat-label">Status</div>
              <div className="stat-value" style={{ color: levelColor }}>{String(detection.level).toUpperCase()}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Sirine</div>
              <div className="stat-value" style={{ color: sirenActive ? '#ef4444' : '#22c55e' }}>
                {sirenActive ? 'AKTIF' : 'SIAGA'}
              </div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Sensor Aktif</div>
              <div className="stat-value">
                {Object.keys(detection?.active_sensors || {}).length || 'Realtime'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <button className="btn btn-primary" onClick={() => { navigate('/public/evacuation'); onClose(); }}>
              Lihat Jalur Evakuasi
            </button>
            <button className="btn btn-outline" onClick={() => { navigate('/public/facilities'); onClose(); }}>
              Lihat Fasilitas
            </button>
            <button className="btn btn-outline" onClick={onClose}>
              Tutup Pesan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublicDashboard({ data, detection, sirenActive, lastUpdated, navigate }: any) {
  const levelColor = LEVEL_COLORS[detection.level] || '#22c55e';
  const activeAwas = detection.level === 'awas' || data.alerts.some((a: any) => String(a.level).toLowerCase() === 'awas');
  const activeAlertCount = Math.max(data.alerts.length, detection.level === 'normal' ? 0 : 1);
  const statusText = activeAwas
    ? 'Peringatan AWAS aktif. Segera ikuti arahan evakuasi.'
    : detection.level === 'normal'
      ? 'Tidak ada indikasi tsunami. Tetap pantau informasi resmi dan ikuti arahan petugas apabila status berubah.'
      : 'Terdapat peningkatan status. Pantau informasi resmi dan siapkan rute evakuasi terdekat.';

  return (
    <div className="page-section">
      <div className="grid-4 public-stat-grid">
        <div className="stat-box"><div className="stat-label">Status Tsunami</div><div className="stat-value" style={{ color: levelColor }}>{detection.level.toUpperCase()}</div><div className="stat-sub">{STATUS_GUIDE[detection.level] || STATUS_GUIDE.normal}</div></div>
        <div className="stat-box"><div className="stat-label">Sensor Aktif</div><div className="stat-value">{Object.keys(detection?.active_sensors || {}).length || data.mapSensors.length || '-'}</div><div className="stat-sub">Titik pantau realtime</div></div>
        <div className="stat-box"><div className="stat-label">Sirine Publik</div><div className="stat-value" style={{ color: sirenActive ? '#ef4444' : '#22c55e' }}>{sirenActive ? 'AKTIF' : detection.level === 'normal' ? 'NORMAL' : 'SIAGA'}</div><div className="stat-sub">Status informasi masyarakat</div></div>
        <div className="stat-box"><div className="stat-label">Alert Aktif</div><div className="stat-value">{activeAlertCount}</div><div className="stat-sub">Update {lastUpdated || '-'}</div></div>
      </div>

      <div className="card public-summary">
        <div>
          <div className="card-title">Ringkasan Kondisi Saat Ini</div>
          <p>{statusText}</p>
          <div className="public-actions">
            <button className="btn btn-primary" onClick={() => navigate('/public/map')}>Lihat Peta Lengkap</button>
            <button className="btn btn-outline" onClick={() => navigate('/public/evacuation')}>Lihat Jalur Evakuasi</button>
            <button className="btn btn-outline" onClick={() => navigate('/public/facilities')}>Lihat Fasilitas</button>
            <button className="btn btn-outline" onClick={() => navigate('/public/alerts')}>Lihat Peringatan</button>
          </div>
        </div>
        <StatusGuide />
      </div>

      <PublicMap data={data} compact />

      <div className="grid-3 public-card-grid">
        <SummaryCard title="Zona Rawan" empty="Belum ada zona rawan terverifikasi." items={data.riskZones.slice(0, 5).map((z: any) => `${z.name} - ${String(z.risk_level || '-').toUpperCase()}`)} />
        <SummaryCard title="Jalur Evakuasi" empty="Belum ada jalur evakuasi terverifikasi." items={data.routes.slice(0, 5).map((r: any) => `${r.name} - ${String(r.status || '-').toUpperCase()}`)} />
        <SummaryCard title="Fasilitas Penting" empty="Belum ada fasilitas terverifikasi." items={data.facilities.slice(0, 5).map((f: any) => `${FACILITY_LABELS[f.type] || f.type || 'Fasilitas'} - ${f.name}`)} />
      </div>

      <PublicGuidance />
    </div>
  );
}

function PublicMapPage({ data }: any) {
  return (
    <div className="page-section">
      <PageIntro title="Monitoring Peta Publik" text="Layer publik menampilkan zona rawan, zona aman, jalur evakuasi, fasilitas, titik kumpul, sirine, dan alert aktif." />
      <PublicMap data={data} />
    </div>
  );
}

function PublicRiskZonesPage({ data, loading, error, lastUpdated, refresh }: any) {
  return (
    <div className="page-section">
      <PageIntro title="Titik Rawan Bencana" text={`Polygon zona risiko dari database. Pembaruan terakhir: ${lastUpdated || '-'}`} action={refresh} loading={loading} />
      {error && <div className="infobox text-warn">{error}</div>}
      <div className="grid-2 public-two-col">
        <div className="card">
          <div className="card-title">Daftar Zona Rawan</div>
          {loading && <StateLine text="Data sedang dimuat..." />}
          {!loading && data.riskZones.length === 0 && <StateLine text="Belum ada zona rawan terverifikasi." />}
          {data.riskZones.map((z: any) => (
            <div key={z.id} className="public-list-row">
              <span className="route-status-dot" style={{ background: riskColor(z.risk_level) }} />
              <div>
                <div className="route-name">{z.name}</div>
                <div className="route-meta">Risiko {String(z.risk_level || '-').toUpperCase()} - {z.notes || 'Keterangan belum tersedia'}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">Peta Zona Rawan</div>
          <PublicMap data={{ ...data, routes: [], safeZones: [], facilities: [], sirens: [], mapSensors: [] }} showOnly="risk" compact />
        </div>
      </div>
    </div>
  );
}

function PublicFacilitiesPage({ data, loading, error, lastUpdated, refresh }: any) {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const types = Array.from(new Set(data.facilities.map((f: any) => f.type).filter(Boolean)));
  const visible = data.facilities.filter((f: any) => filter === 'all' || f.type === filter);
  const selected = visible.find((f: any) => f.id === selectedId) || null;

  return (
    <div className="page-section">
      <PageIntro title="Fasilitas Publik" text={`Fasilitas berasal dari tabel facilities. Pembaruan terakhir: ${lastUpdated || '-'}`} action={refresh} loading={loading} />
      {error && <div className="infobox text-warn">{error}</div>}
      <div className="public-toolbar">
        <select className="form-input public-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Semua tipe</option>
          {types.map((type: any) => <option key={type} value={type}>{FACILITY_LABELS[type] || type}</option>)}
        </select>
      </div>
      <div className="grid-2 public-two-col">
        <div className="card public-table-card">
          <div className="card-title">Tabel Fasilitas</div>
          {loading && <StateLine text="Data sedang dimuat..." />}
          {!loading && visible.length === 0 && <StateLine text="Belum ada fasilitas terverifikasi." />}
          <div className="public-table-wrap">
            <table className="data-table">
              <thead><tr><th>Nama</th><th>Jenis</th><th>Alamat</th><th>Telepon</th></tr></thead>
              <tbody>
                {visible.map((f: any) => (
                  <tr key={f.id} onClick={() => setSelectedId(f.id)} className={selectedId === f.id ? 'selected' : ''}>
                    <td>{FACILITY_ICONS[f.type] || 'PIN'} {f.name}</td>
                    <td>{FACILITY_LABELS[f.type] || f.type || '-'}</td>
                    <td>{f.address || '-'}</td>
                    <td>{f.phone || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Peta Lokasi Fasilitas</div>
          <PublicMap data={{ ...data, riskZones: [], routes: [], safeZones: [], sirens: [], mapSensors: [] }} selectedFacility={selected} compact />
        </div>
      </div>
    </div>
  );
}

function PublicEvacuationPage({ data, loading, error, lastUpdated, refresh }: any) {
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const selectedRoute = data.routes.find((r: any) => r.id === selectedRouteId) || null;
  const selectedRouteGoogleMapsUrl = selectedRoute ? buildGoogleMapsRouteUrl(selectedRoute) : '';

  return (
    <div className="page-section">
      <PageIntro title="Jalur Evakuasi" text={`Jalur dan zona aman berasal dari evacuation_routes dan safe_zones. Pembaruan terakhir: ${lastUpdated || '-'}`} action={refresh} loading={loading} />
      {error && <div className="infobox text-warn">{error}</div>}
      <div className="grid-2 public-two-col">
        <div className="card">
          <div className="card-title">Daftar Jalur</div>
          {loading && <StateLine text="Data sedang dimuat..." />}
          {!loading && data.routes.length === 0 && <StateLine text="Belum ada jalur evakuasi terverifikasi." />}
          {data.routes.map((r: any) => (
            <button
              key={r.id}
              className={`public-route-card ${selectedRouteId === r.id ? 'selected' : ''}`}
              onClick={() => setSelectedRouteId(prev => prev === r.id ? '' : r.id)}
            >
              <span className="route-status-dot" style={{ background: routeColor(r.status) }} />
              <span>
                <strong>{r.name}</strong>
                <small>{r.direction || '-'} - {(Number(r.distance_m || 0) / 1000).toFixed(1)} km - Est. {r.estimated_time_min || '-'} menit - Kapasitas {Number(r.capacity_persons || 0).toLocaleString('id-ID')}</small>
              </span>
            </button>
          ))}
          {selectedRoute && (
            <div className="infobox" style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Rute terpilih: {selectedRoute.name}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-outline" onClick={() => setSelectedRouteId('')}>
                  Tampilkan Semua Jalur
                </button>
                {selectedRouteGoogleMapsUrl && (
                  <button className="btn btn-primary" onClick={() => window.open(selectedRouteGoogleMapsUrl, '_blank', 'noopener,noreferrer')}>
                    Buka Rute di Google Maps
                  </button>
                )}
              </div>
            </div>
          )}
          <Legend items={[['clear', 'Aman'], ['warning', 'Waspada'], ['blocked', 'Terblokir'], ['maintenance', 'Pemeliharaan']]} colorFor={routeColor} />
        </div>
        <div className="card">
          <div className="card-title">Peta Rute dan Zona Aman</div>
          <PublicMap data={{ ...data, riskZones: [], facilities: [], sirens: [], mapSensors: [] }} selectedRoute={selectedRoute} compact />
        </div>
      </div>
    </div>
  );
}

function PublicAlertsPage({ data, detection, lastUpdated }: any) {
  const hasAwas = data.alerts.some((a: any) => String(a.level).toLowerCase() === 'awas');

  return (
    <div className="page-section">
      <PageIntro title="Peringatan Aktif" text={`Informasi peringatan untuk masyarakat. Pembaruan terakhir: ${lastUpdated || '-'}`} />
      {!hasAwas && data.alerts.length === 0 && (
        <div className="card public-empty-alert">
          <div className="card-title">Status Wilayah</div>
          <h2>Status wilayah saat ini aman.</h2>
          <p>Belum ada peringatan aktif.</p>
        </div>
      )}
      <div className="grid-2 public-two-col">
        {data.alerts.map((a: any) => (
          <div key={a.id} className="card public-alert-card" style={{ borderColor: LEVEL_COLORS[a.level as AlertLevel] || '#f97316' }}>
            <div className="card-title">Level {String(a.level || '-').toUpperCase()}</div>
            <p><b>Waktu:</b> {a.triggered_at ? new Date(a.triggered_at).toLocaleString('id-ID') : '-'}</p>
            <p><b>Status:</b> {a.status || '-'}</p>
            <p><b>Lokasi:</b> Panjang, Bandar Lampung</p>
            <p><b>Instruksi:</b> {STATUS_GUIDE[a.level] || STATUS_GUIDE[detection.level] || STATUS_GUIDE.normal}</p>
          </div>
        ))}
      </div>
      <PublicGuidance />
    </div>
  );
}

function PublicMap({ data, compact = false, selectedFacility, selectedRoute, showOnly }: any) {
  return (
    <div className="card public-map-card">
      <div className="card-title">Peta Publik</div>
      <div className="public-map" style={{ height: compact ? 430 : 620 }}>
        <MapContainer center={PUBLIC_CENTER} zoom={13} style={{ height:'100%', width:'100%', background:'#0a1628' }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
          {selectedFacility && <MapFocus point={[Number(selectedFacility.latitude ?? selectedFacility.lat), Number(selectedFacility.longitude ?? selectedFacility.lng)]} />}
          {selectedRoute && <MapFocus route={routeCoords(selectedRoute).map(toLatLng)} />}
          <LayersControl position="topright">
            <LayersControl.Overlay checked name="Zona Rawan">
              <>
                {data.riskZones.map((z: any) => renderRiskZone(z))}
              </>
            </LayersControl.Overlay>
            {showOnly !== 'risk' && (
              <>
                <LayersControl.Overlay checked name="Zona Aman">
                  <>{data.safeZones.map((z: any) => renderSafeZone(z))}</>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Jalur Evakuasi">
                  <>{(selectedRoute ? [selectedRoute] : data.routes).map((r: any) => renderRoute(r, selectedRoute?.id === r.id))}</>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Fasilitas">
                  <>{data.facilities.map((f: any) => renderFacility(f, selectedFacility?.id === f.id))}</>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Titik Kumpul">
                  <>{data.safeZones.map((z: any) => renderSafeZoneCenter(z))}</>
                </LayersControl.Overlay>
                <LayersControl.Overlay checked name="Sirine">
                  <>{data.sirens.map((s: any) => renderSiren(s))}</>
                </LayersControl.Overlay>
              </>
            )}
          </LayersControl>
        </MapContainer>
      </div>
      <PublicLegend />
    </div>
  );
}

function MapFocus({ point, route }: { point?: [number, number]; route?: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (route && route.length > 1) {
      map.fitBounds(route, { padding: [24, 24], maxZoom: 16 });
    } else if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) {
      map.setView(point, 16);
    }
  }, [map, point, route]);
  return null;
}

function renderRiskZone(z: any) {
  const coords = polygonCoords(z);
  if (!coords.length) return null;
  return (
    <Polygon key={z.id} positions={coords.map(toLatLng)} pathOptions={{ color: riskColor(z.risk_level), fillColor: riskColor(z.risk_level), fillOpacity:0.24, weight:2 }}>
      <Popup><b>{z.name}</b><br />Tingkat Risiko: {String(z.risk_level || '-').toUpperCase()}<br />Keterangan: {z.notes || '-'}</Popup>
    </Polygon>
  );
}

function renderSafeZone(z: any) {
  const coords = polygonCoords(z);
  if (!coords.length) return null;
  return (
    <Polygon key={z.id} positions={coords.map(toLatLng)} pathOptions={{ color:'#22c55e', fillColor:'#22c55e', fillOpacity:0.16, weight:2 }}>
      <Popup><b>{z.name}</b><br />Kapasitas: {Number(z.capacity || 0).toLocaleString('id-ID')} orang<br />Elevasi: {z.elevation_m || '-'} m<br />Fasilitas: {z.facilities?.join(', ') || '-'}</Popup>
    </Polygon>
  );
}

function renderSafeZoneCenter(z: any) {
  const coords = polygonCoords(z);
  if (!coords.length) return null;
  const center = coords.reduce((acc: [number, number], c: [number, number]) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]).map(v => v / coords.length) as [number, number];
  return <CircleMarker key={`center-${z.id}`} center={toLatLng(center)} radius={7} pathOptions={{ color:'#86efac', fillColor:'#22c55e', fillOpacity:0.9, weight:2 }}><Popup><b>Titik Kumpul</b><br />{z.name}</Popup></CircleMarker>;
}

function renderRoute(r: any, selected = false) {
  const coords = routeCoords(r);
  if (coords.length < 2) return null;
  const color = routeColor(r.status);
  const start = coords[0];
  const end = coords[coords.length - 1];
  return (
    <React.Fragment key={r.id}>
      <Polyline positions={coords.map(toLatLng)} pathOptions={{ color, weight:selected ? 8 : 5, opacity:0.9 }}>
        <Popup><b>{r.name}</b><br />Status: {String(r.status || '-').toUpperCase()}<br />Arah: {r.direction || '-'}<br />Keterangan: {r.description || r.notes || '-'}<br />Kapasitas: {Number(r.capacity_persons || 0).toLocaleString('id-ID')} orang<br />Jarak: {(Number(r.distance_m || 0) / 1000).toFixed(1)} km<br />Estimasi Waktu: {r.estimated_time_min || '-'} menit<br />Prioritas: {r.priority || '-'}</Popup>
      </Polyline>
      <CircleMarker center={toLatLng(start)} radius={6} pathOptions={{ color, fillColor:'#ffffff', fillOpacity:1, weight:3 }}><Popup>Titik awal<br />{r.name}</Popup></CircleMarker>
      <CircleMarker center={toLatLng(end)} radius={7} pathOptions={{ color:'#22c55e', fillColor:color, fillOpacity:0.9, weight:2 }}><Popup>Titik akhir<br />{r.name}</Popup></CircleMarker>
    </React.Fragment>
  );
}

function renderFacility(f: any, selected = false) {
  const lat = Number(f.latitude ?? f.lat);
  const lng = Number(f.longitude ?? f.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const color = FACILITY_COLORS[f.type] || '#757575';
  return (
    <CircleMarker key={f.id} center={[lat, lng]} radius={selected ? 12 : 8} pathOptions={{ color:selected ? '#f8fafc' : color, fillColor:color, fillOpacity:0.88, weight:selected ? 3 : 2 }}>
      <Popup><b>{FACILITY_ICONS[f.type] || 'PIN'} {f.name}</b><br />Jenis: {FACILITY_LABELS[f.type] || f.type || '-'}<br />Alamat: {f.address || '-'}<br />Telepon: {f.phone || '-'}<br />Keterangan: {f.description || f.notes || '-'}<br />Koordinat: {lat.toFixed(6)}, {lng.toFixed(6)}</Popup>
    </CircleMarker>
  );
}

function renderSiren(s: any) {
  const lat = Number(s.lat);
  const lng = Number(s.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return <CircleMarker key={s.id} center={[lat, lng]} radius={8} pathOptions={{ color:'#eab308', fillColor:'#eab308', fillOpacity:0.85, weight:2 }}><Popup><b>{s.name}</b><br />Status: {s.status || '-'}</Popup></CircleMarker>;
}

function polygonCoords(item: any): [number, number][] {
  return item.geometry?.coordinates?.[0] || item.coordinates || [];
}

function routeCoords(item: any): [number, number][] {
  return item.geometry?.coordinates || item.coordinates || [];
}

function buildGoogleMapsRouteUrl(route: any) {
  const coords = routeCoords(route);
  if (!coords.length) return '';

  const start = coords[0];
  const end = coords[coords.length - 1];
  if (!start || !end) return '';

  const [startLng, startLat] = start;
  const [endLng, endLat] = end;

  if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) return '';

  return `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${endLat},${endLng}&travelmode=driving`;
}

function riskColor(level: string) {
  return RISK_COLORS[String(level || '').toLowerCase()] || '#eab308';
}

function routeColor(status: string) {
  return ROUTE_COLORS[status] || '#22c55e';
}

function PageIntro({ title, text, action, loading }: any) {
  return (
    <div className="public-page-intro">
      <div>
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      {action && <button className="btn btn-outline" onClick={action} disabled={loading}>Refresh</button>}
    </div>
  );
}

function StateLine({ text }: { text: string }) {
  return <div className="infobox">{text}</div>;
}

function SummaryCard({ title, items, empty }: any) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      {items.length === 0 && <div className="text-dim">{empty}</div>}
      {items.map((item: string) => <div key={item} className="public-mini-row">{item}</div>)}
    </div>
  );
}

function StatusGuide() {
  return (
    <div className="public-status-guide">
      <div><b>NORMAL</b><span>Kondisi aman</span></div>
      <div><b>WASPADA</b><span>Pantau informasi</span></div>
      <div><b>SIAGA</b><span>Bersiap evakuasi</span></div>
      <div><b>AWAS</b><span>Segera evakuasi</span></div>
    </div>
  );
}

function PublicGuidance() {
  return (
    <div className="card public-guidance">
      <div className="card-title">Panduan Saat Peringatan Aktif</div>
      <p>Tetap tenang. Ikuti jalur evakuasi terdekat. Prioritaskan anak-anak, lansia, dan kelompok rentan. Jangan kembali ke area pesisir sebelum ada informasi aman.</p>
      <small>Informasi pada portal ini digunakan sebagai panduan awal. Ikuti arahan petugas dan informasi resmi saat kondisi darurat.</small>
    </div>
  );
}

function PublicEmergencyBanner({ navigate }: any) {
  return (
    <div className="public-emergency-banner">
      <div>
        <strong>PERINGATAN AWAS AKTIF</strong>
        <p>Segera lakukan evakuasi melalui jalur yang tersedia dan menuju fasilitas atau zona aman terdekat.</p>
      </div>
      <div className="public-actions">
        <button className="btn btn-primary" onClick={() => navigate('/public/evacuation')}>Jalur Evakuasi</button>
        <button className="btn btn-outline" onClick={() => navigate('/public/facilities')}>Fasilitas</button>
      </div>
    </div>
  );
}

function PublicLegend() {
  return (
    <div className="public-legend">
      <span><i style={{ background:'#ef4444' }} /> Risiko Tinggi</span>
      <span><i style={{ background:'#f97316' }} /> Risiko Sedang</span>
      <span><i style={{ background:'#22c55e' }} /> Zona Aman</span>
      <span><i style={{ background:'#06b6d4' }} /> Jalur Evakuasi</span>
      <span><i style={{ background:'#eab308' }} /> Sirine</span>
    </div>
  );
}

function Legend({ items, colorFor }: any) {
  return (
    <div className="public-legend">
      {items.map(([key, label]: [string, string]) => <span key={key}><i style={{ background: colorFor(key) }} /> {label}</span>)}
    </div>
  );
}
