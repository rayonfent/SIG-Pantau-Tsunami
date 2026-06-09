import React, { useEffect, useMemo, useState } from 'react';
import { simApi } from '../utils/api';
import { AlertLevel, SensorData, DetectionState, User } from '../types';
import { LEVEL_COLORS, LEVEL_LABEL } from '../utils/constants';

interface Props {
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  mode: string;
  user: User;
  onSimulationPreview?: (payload: {
    running: boolean;
    sensors?: Record<string, SensorData>;
    detection?: DetectionState;
  }) => void;
  [k: string]: any;
}

const SCENARIOS = [
  { id: 'normal',         label: '🌊 Normal (tidal biasa)',         desc: 'Sinusoidal ±3cm, noise acak' },
  { id: 'naik_cepat',     label: '🔴 Air Naik Cepat',              desc: 'Kenaikan +5cm/menit → trigger siaga/awas' },
  { id: 'surut_mendadak', label: '🟠 Surutnya Mendadak',           desc: 'Penurunan -8cm/menit → anomali drastis' },
  { id: 'sensor_offline', label: '⚫ Sensor SNS-PLG-01 Offline',   desc: 'Simulasi sensor utama mati, fallback ke cadangan' },
];

const SCENARIO_LABELS = Object.fromEntries(SCENARIOS.map((item) => [item.id, item.label])) as Record<string, string>;

const computeDetectionPreview = (sensorList: SensorData[], selectedScenario: string, override: number): DetectionState => {
  const onlineSensors = sensorList.filter((sensor) => sensor.quality !== 'offline');
  const maxRate = onlineSensors.reduce((max, sensor) => Math.max(max, Math.abs(sensor.rate_cm_per_min || 0)), 0);
  const maxDelta = onlineSensors.reduce((max, sensor) => Math.max(max, Math.abs(sensor.delta_3m || 0)), 0);
  const offlineCount = sensorList.length - onlineSensors.length;
  const absOverride = Math.abs(override);

  let level: AlertLevel = 'normal';
  let confidence = 0.12;
  let confidenceLabel = 'low';
  let siren = false;

  if (selectedScenario === 'sensor_offline') {
    level = 'suspect';
    confidence = 0.45;
    confidenceLabel = 'medium';
  }

  if (selectedScenario === 'naik_cepat') {
    level = 'waspada';
    confidence = 0.68;
    confidenceLabel = 'high';
  }

  if (selectedScenario === 'surut_mendadak') {
    level = 'siaga';
    confidence = 0.84;
    confidenceLabel = 'high';
    siren = true;
  }

  if (absOverride >= 75 || maxDelta >= 35 || maxRate >= 8) {
    level = 'waspada';
    confidence = Math.max(confidence, 0.68);
    confidenceLabel = 'high';
  }

  if (absOverride >= 150 || maxDelta >= 80 || maxRate >= 12) {
    level = 'siaga';
    confidence = Math.max(confidence, 0.84);
    confidenceLabel = 'high';
    siren = true;
  }

  if (absOverride >= 250 || maxDelta >= 140 || maxRate >= 16) {
    level = 'awas';
    confidence = Math.max(confidence, 0.97);
    confidenceLabel = 'very_high';
    siren = true;
  }

  if (offlineCount > 0 && level === 'normal') {
    level = 'suspect';
    confidence = 0.45;
    confidenceLabel = 'medium';
  }

  return {
    level,
    confidence_score: confidence,
    confidence_label: confidenceLabel,
    siren_active: siren,
  };
};

const simulateSensor = (sensor: SensorData, selectedScenario: string, override: number, index: number): SensorData => {
  if (selectedScenario === 'sensor_offline' && index === 0) {
    return {
      ...sensor,
      quality: 'offline',
      delta_1m: 0,
      delta_3m: 0,
      delta_5m: 0,
      rate_cm_per_min: 0,
      timestamp: new Date().toISOString(),
    };
  }

  let deltaAdjustment = 0;
  let rateAdjustment = 0;
  let waveAdjustment = 0;
  const offset = (index % 3) - 1;

  if (selectedScenario === 'normal') {
    waveAdjustment = offset * 2;
    deltaAdjustment = offset * 1.5;
    rateAdjustment = offset * 0.2;
  } else if (selectedScenario === 'naik_cepat') {
    waveAdjustment = 18 + offset * 4;
    deltaAdjustment = 42 + override * 0.35 + index * 4;
    rateAdjustment = 5 + Math.max(override, 0) / 25 + index * 0.6;
  } else if (selectedScenario === 'surut_mendadak') {
    waveAdjustment = -24 + offset * 5;
    deltaAdjustment = -58 - Math.abs(override) * 0.3 - index * 5;
    rateAdjustment = -(8 + Math.abs(override) / 28 + index * 0.7);
  } else {
    waveAdjustment = override * 0.2 + offset * 3;
    deltaAdjustment = override * 0.28 + offset * 2;
    rateAdjustment = override / 40 + offset * 0.25;
  }

  const nextWaterLevel = sensor.water_level_cm + waveAdjustment + override;
  const nextDelta3m = (sensor.delta_3m || 0) + deltaAdjustment;
  const nextRate = (sensor.rate_cm_per_min || 0) + rateAdjustment;

  return {
    ...sensor,
    water_level_cm: Number(nextWaterLevel.toFixed(1)),
    delta_1m: Number((((sensor.delta_1m || 0) + deltaAdjustment * 0.45)).toFixed(1)),
    delta_3m: Number(nextDelta3m.toFixed(1)),
    delta_5m: Number((((sensor.delta_5m || 0) + deltaAdjustment * 1.35)).toFixed(1)),
    rate_cm_per_min: Number(nextRate.toFixed(1)),
    quality: sensor.quality || 'online',
    timestamp: new Date().toISOString(),
  };
};

export default function SimulasiDrill({ sensors, detection, mode, user, onSimulationPreview }: Props) {
  const [scenario, setScenario] = useState('normal');
  const [waterOverride, setWaterOverride] = useState(0);
  const [running, setRunning] = useState(mode === 'simulation');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [statusLoaded, setStatusLoaded] = useState(false);
  const canControl = user.role === 'supervisor' || user.role === 'admin';
  const baseSensorsRef = React.useRef<SensorData[]>([]);

  const applySimulationStatus = (status: any) => {
    if (!status) return;
    const isSimulation = status.mode === 'simulation' || status.running === true || status.active === true;
    setRunning(isSimulation);
    if (typeof status.scenario === 'string' && status.scenario) setScenario(status.scenario);
    const backendOverride = Number(status.water_override ?? status.override ?? status.waterOverride);
    if (Number.isFinite(backendOverride)) setWaterOverride(backendOverride);
  };

  const refreshSimulationStatus = async (silent = true) => {
    try {
      const response = await simApi.status();
      applySimulationStatus(response.data);
      setStatusLoaded(true);
    } catch {
      setStatusLoaded(true);
      if (!silent) setMessage('⚠ Status simulasi backend belum dapat dimuat. Tampilan lokal tetap digunakan.');
    }
  };

  useEffect(() => {
    refreshSimulationStatus();
  }, []);

  useEffect(() => {
    if (mode === 'simulation') {
      setRunning(true);
    } else if (statusLoaded) {
      setRunning(false);
    }
  }, [mode, statusLoaded]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => refreshSimulationStatus(), 2500);
    return () => window.clearInterval(timer);
  }, [running]);

  const sensorList = useMemo(() => Object.values(sensors), [sensors]);

  useEffect(() => {
    if (!running) {
      baseSensorsRef.current = sensorList;
    } else if (baseSensorsRef.current.length === 0 && sensorList.length > 0) {
      baseSensorsRef.current = sensorList;
    }
  }, [running, sensorList]);

  const displaySensors = useMemo(() => {
    if (!running) return sensorList;
    const baseSensors = baseSensorsRef.current.length ? baseSensorsRef.current : sensorList;
    return baseSensors.map((sensor, index) => simulateSensor(sensor, scenario, waterOverride, index));
  }, [running, scenario, sensorList, waterOverride]);

  const displayDetection = useMemo(() => {
    if (!running) return detection;
    return computeDetectionPreview(displaySensors, scenario, waterOverride);
  }, [running, detection, displaySensors, scenario, waterOverride]);

  useEffect(() => {
    if (!onSimulationPreview) return;

    if (!running) {
      onSimulationPreview({ running: false });
      return;
    }

    onSimulationPreview({
      running: true,
      sensors: Object.fromEntries(displaySensors.map((sensor) => [sensor.sensor_id, sensor])),
      detection: displayDetection,
    });
  }, [displayDetection, displaySensors, onSimulationPreview, running]);

  const handleStart = async () => {
    if (!canControl) { setMessage('⛔ Hanya Supervisor/Admin yang dapat menjalankan simulasi saat live.'); return; }
    baseSensorsRef.current = sensorList;
    setLoading(true);
    try {
      const response = await simApi.start(scenario, waterOverride);
      applySimulationStatus(response.data);
      setRunning(true);
      setMessage(`✅ Simulasi "${scenario}" dimulai. Preview sensor dan deteksi diperbarui.`);
      await refreshSimulationStatus();
    } catch { setMessage('❌ Gagal memulai simulasi.'); }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await simApi.stop();
      setRunning(false);
      setWaterOverride(0);
      baseSensorsRef.current = [];
      onSimulationPreview?.({ running: false });
      setMessage('✅ Simulasi dihentikan, kembali ke mode LIVE.');
    } catch {
      setRunning(false);
      setWaterOverride(0);
      baseSensorsRef.current = [];
      onSimulationPreview?.({ running: false });
      setMessage('⚠ Simulasi lokal dihentikan, tetapi backend gagal dikembalikan ke mode LIVE.');
    }
    setLoading(false);
  };

  const handleScenarioChange = async (nextScenario: string) => {
    setScenario(nextScenario);
    if (running) {
      try {
        const response = await simApi.update(nextScenario, waterOverride);
        applySimulationStatus(response.data);
      } catch {
        setMessage('⚠ Skenario lokal berubah, tetapi backend gagal diperbarui.');
      }
    }
  };

  const handleSliderChange = async (val: number) => {
    setWaterOverride(val);
    if (running) {
      try {
        const response = await simApi.update(scenario, val);
        applySimulationStatus(response.data);
      } catch {
        setMessage('⚠ Override lokal berubah, tetapi backend gagal diperbarui.');
      }
    }
  };

  const lc = LEVEL_COLORS[displayDetection.level];

  return (
    <div className="page-section">
      <div className="grid-2">
        {/* Control panel */}
        <div className="card">
          <div className="card-title">🎮 Kontrol Simulasi</div>

          {!canControl && (
            <div className="infobox" style={{ marginBottom: 12, background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)' }}>
              ⚠ Mode simulasi hanya dapat diaktifkan oleh Supervisor atau Admin.
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <div className="section-title">Pilih Skenario</div>
            {SCENARIOS.map(s => (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                padding: '10px', borderRadius: 6, marginBottom: 6,
                background: scenario === s.id ? 'rgba(6,182,212,0.1)' : 'transparent',
                border: `1px solid ${scenario === s.id ? '#0f4c81' : '#e2e8f0'}`,
                transition: 'all 0.15s'
              }}>
                <input type="radio" name="scenario" value={s.id}
                  checked={scenario === s.id} onChange={() => handleScenarioChange(s.id)}
                  style={{ marginTop: 2, accentColor: '#06b6d4' }} />
                <div>
                  <div style={{ fontSize: 12, color: '#1f2937', fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{s.desc}</div>
                </div>
              </label>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="section-title">Override Muka Air Manual</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <input type="range" className="sim-slider" style={{ flex: 1 }}
                min={-200} max={300} step={5} value={waterOverride}
                onChange={e => handleSliderChange(Number(e.target.value))} />
              <span style={{ fontSize: 18, fontWeight: 700, color: waterOverride >= 0 ? '#ef4444' : '#22c55e', width: 80, textAlign: 'right', fontFamily: 'monospace' }}>
                {waterOverride > 0 ? '+' : ''}{waterOverride} cm
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#475569', marginTop: 4 }}>
              <span>-200cm (surut)</span><span>0 (normal)</span><span>+300cm (naik)</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {!running ? (
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleStart} disabled={loading || !canControl}>
                {loading ? '...' : '▶ Mulai Simulasi'}
              </button>
            ) : (
              <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleStop} disabled={loading}>
                {loading ? '...' : '⏹ Hentikan Simulasi'}
              </button>
            )}
          </div>

          {message && (
            <div className="infobox" style={{ marginTop: 12, fontSize: 11 }}>{message}</div>
          )}
        </div>

        {/* Live status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="card-title">📡 Status Mode</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0' }}>
              <div style={{
                padding: '12px 20px', borderRadius: 8,
                background: running ? 'rgba(168,85,247,0.15)' : 'rgba(34,197,94,0.15)',
                border: `1px solid ${running ? '#a855f7' : '#22c55e'}`,
                color: running ? '#a855f7' : '#22c55e',
                fontWeight: 700, fontSize: 14, letterSpacing: 2,
              }}>
                {running ? '🎮 SIMULASI' : '🔴 LIVE'}
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Mode aktif</div>
                {running && <div style={{ fontSize: 11, color: '#475569' }}>Skenario: {SCENARIO_LABELS[scenario] || scenario} · Override: {waterOverride > 0 ? '+' : ''}{waterOverride}cm</div>}
              </div>
            </div>
          </div>

          <div className="alert-level-display" style={{ background: lc + '15', borderColor: lc }}>
            <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 1 }}>DETEKSI ANOMALI</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: lc, letterSpacing: 4 }}>{LEVEL_LABEL[displayDetection.level]}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Confidence: {displayDetection.confidence_score}% · Status: {displayDetection.confidence_label} · Sirine: {displayDetection.siren_active ? '🔊 AKTIF' : '🔇 Tidak Aktif'}
            </div>
          </div>

          <div className="card">
            <div className="card-title">📋 Skenario Drill Yang Tersedia</div>
            <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.8 }}>
              <div>✅ Air naik cepat → trigger waspada → siaga → awas</div>
              <div>✅ Surut mendadak → anomali besar → alert</div>
              <div>✅ Sensor offline → fallback ke cadangan</div>
              <div>✅ Sirine aktif otomatis pada level Siaga/Awas</div>
              <div>✅ Jalur evakuasi padat → ubah status route di Data Master</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sensor readings during sim */}
      <div className="card">
        <div className="card-title">📊 Bacaan Sensor Saat Ini</div>
        <div className="grid-4">
          {displaySensors.map(s => (
            <div key={s.sensor_id} style={{
              padding: 12, borderRadius: 6,
              background: running ? 'rgba(168,85,247,0.04)' : '#ffffff', border: `1px solid ${running ? 'rgba(168,85,247,0.18)' : '#e2e8f0'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#475569' }}>{s.code}</div>
                {running && <div style={{ fontSize: 9, color: '#a855f7', fontWeight: 700 }}>SIMULASI</div>}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#06b6d4', fontFamily: 'monospace' }}>
                {s.water_level_cm?.toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: '#475569' }}>cm</div>
              <div style={{ fontSize: 11, color: (s.delta_3m || 0) > 0 ? '#ef4444' : '#22c55e', marginTop: 4 }}>
                Δ3m: {(s.delta_3m || 0) > 0 ? '+' : ''}{(s.delta_3m || 0).toFixed(1)} cm
              </div>
              <div style={{ fontSize: 11, color: (s.rate_cm_per_min || 0) > 0 ? '#ef4444' : '#22c55e', marginTop: 2 }}>
                Rate: {(s.rate_cm_per_min || 0) > 0 ? '+' : ''}{(s.rate_cm_per_min || 0).toFixed(1)} cm/menit
              </div>
              <div style={{ fontSize: 10, color: s.quality === 'offline' ? '#ef4444' : '#22c55e', marginTop: 2 }}>
                {s.quality?.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
