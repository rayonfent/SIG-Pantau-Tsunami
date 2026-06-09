import React, { useState, useEffect } from 'react';
import { simApi } from '../utils/api';
import { SensorData, DetectionState, User } from '../types';
import { LEVEL_COLORS, LEVEL_LABEL } from '../utils/constants';

interface Props { sensors: Record<string, SensorData>; detection: DetectionState; mode: string; user: User; [k: string]: any; }

const SCENARIOS = [
  { id: 'normal',         label: '🌊 Normal (tidal biasa)',         desc: 'Sinusoidal ±3cm, noise acak' },
  { id: 'naik_cepat',     label: '🔴 Air Naik Cepat',              desc: 'Kenaikan +5cm/menit → trigger siaga/awas' },
  { id: 'surut_mendadak', label: '🟠 Surutnya Mendadak',           desc: 'Penurunan -8cm/menit → anomali drastis' },
  { id: 'sensor_offline', label: '⚫ Sensor SNS-PLG-01 Offline',   desc: 'Simulasi sensor utama mati, fallback ke cadangan' },
];

export default function SimulasiDrill({ sensors, detection, mode, user }: Props) {
  const [scenario, setScenario] = useState('normal');
  const [waterOverride, setWaterOverride] = useState(0);
  const [running, setRunning] = useState(mode === 'simulation');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const canControl = user.role === 'supervisor' || user.role === 'admin';

  const handleStart = async () => {
    if (!canControl) { setMessage('⛔ Hanya Supervisor/Admin yang dapat menjalankan simulasi saat live.'); return; }
    setLoading(true);
    try {
      await simApi.start(scenario, waterOverride);
      setRunning(true);
      setMessage(`✅ Simulasi "${scenario}" dimulai.`);
    } catch { setMessage('❌ Gagal memulai simulasi.'); }
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await simApi.stop();
      setRunning(false);
      setWaterOverride(0);
      setMessage('✅ Simulasi dihentikan, kembali ke mode LIVE.');
    } catch { setMessage('❌ Gagal menghentikan simulasi.'); }
    setLoading(false);
  };

  const handleSliderChange = async (val: number) => {
    setWaterOverride(val);
    if (running) {
      try { await simApi.update(scenario, val); } catch {}
    }
  };

  const lc = LEVEL_COLORS[detection.level];

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
                  checked={scenario === s.id} onChange={() => setScenario(s.id)}
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
                {running && <div style={{ fontSize: 11, color: '#475569' }}>Skenario: {scenario} · Override: {waterOverride > 0 ? '+' : ''}{waterOverride}cm</div>}
              </div>
            </div>
          </div>

          <div className="alert-level-display" style={{ background: lc + '15', borderColor: lc }}>
            <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 1 }}>DETEKSI ANOMALI</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: lc, letterSpacing: 4 }}>{LEVEL_LABEL[detection.level]}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              Confidence: {detection.confidence_score}% · Sirine: {detection.siren_active ? '🔊 AKTIF' : '🔇 Tidak Aktif'}
            </div>
          </div>

          <div className="card">
            <div className="card-title">📋 Skenario Drill Yang Tersedia</div>
            <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.8 }}>
              <div>✅ Air naik cepat → trigger waspada → siaga → awas</div>
              <div>✅ Surut mendadak → anomali besar → alert</div>
              <div>✅ Sensor offline → fallback ke cadangan</div>
              <div>✅ Sirine gagal → error kritis (simulasikan dengan mematikan backend)</div>
              <div>✅ Jalur evakuasi padat → ubah status route di Data Master</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sensor readings during sim */}
      <div className="card">
        <div className="card-title">📊 Bacaan Sensor Saat Ini</div>
        <div className="grid-4">
          {Object.values(sensors).map(s => (
            <div key={s.sensor_id} style={{
              padding: 12, borderRadius: 6,
              background: '#ffffff', border: '1px solid #e2e8f0',
            }}>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>{s.code}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#06b6d4', fontFamily: 'monospace' }}>
                {s.water_level_cm?.toFixed(1)}
              </div>
              <div style={{ fontSize: 10, color: '#475569' }}>cm</div>
              <div style={{ fontSize: 11, color: (s.delta_3m || 0) > 0 ? '#ef4444' : '#22c55e', marginTop: 4 }}>
                Δ3m: {(s.delta_3m || 0) > 0 ? '+' : ''}{(s.delta_3m || 0).toFixed(1)} cm
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
