import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { AlertLevel, SensorData, DetectionState, AlertEvent, SirenEvent, User } from './types';
import { LEVEL_COLORS, LEVEL_LABEL } from './utils/constants';
import { authApi } from './utils/api';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import MonitoringPeta from './pages/MonitoringPeta';
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activePage, setActivePage] = useState('dashboard');
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

  const handleLogin = async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    const { access_token, role, full_name } = res.data;
    localStorage.setItem('token', access_token);
    setUser({ username, role, full_name });
  };

  const handleDismissWarning = () => {
    if (user?.role === 'supervisor' || user?.role === 'admin') {
      setShowWarning(false);
    }
  };

  if (!user) return <LoginPage onLogin={handleLogin} />;

  const levelColor = LEVEL_COLORS[detection.level];
  const levelLabel = LEVEL_LABEL[detection.level];

  const renderPage = () => {
    const commonProps = { sensors, detection, alertHistory, sirenHistory, sirenActive, connected, mode, user };
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
          onNavigate={(page) => { setActivePage(page); }}
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
              onClick={() => setActivePage(p.id)}
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
            <div className="ws-status">
              <span className={`ws-dot ${connected ? 'connected' : 'disconnected'}`} />
              <span>{connected ? 'Terhubung' : 'Reconnecting...'}</span>
            </div>
            {mode === 'simulation' && (
              <div className="sim-badge">🎮 MODE SIMULASI</div>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <main className="main-content">
        {/* Top bar */}
        <header className="topbar" style={{ borderBottomColor: detection.level !== 'normal' ? levelColor : '#1e293b' }}>
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
