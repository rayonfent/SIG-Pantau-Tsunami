import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SensorData, DetectionState, AlertEvent, SirenEvent, User } from '../types';
import { LEVEL_COLORS, LEVEL_LABEL, formatTime } from '../utils/constants';

interface Props {
  sensors: Record<string, SensorData>;
  detection: DetectionState;
  alertHistory: AlertEvent[];
  sirenHistory: SirenEvent[];
  sirenActive: boolean;
  connected: boolean;
  mode: string;
  user: User;
}

const SENSOR_COLORS = ['#06b6d4', '#22c55e', '#f97316', '#a855f7'];

export default function Dashboard({ sensors, detection, alertHistory, sirenHistory, connected }: Props) {
  const sensorList = Object.values(sensors);
  const levelColor = LEVEL_COLORS[detection.level];
  const levelLabel = LEVEL_LABEL[detection.level];

  // Build simple chart data from last 20 alerts (level changes)
  const chartData = useMemo(() => {
    return sensorList.map((s, i) => ({
      name: s.code,
      level: s.water_level_cm,
      baseline: s.baseline_median,
      delta: s.delta_3m,
    }));
  }, [sensorList]);

  const onlineSensors = sensorList.filter(s => s.quality !== 'offline').length;

  return (
    <div className="page-section">
      {/* Stat row */}
      <div className="grid-4">
        <div className="stat-box" style={{ borderTop: `3px solid ${levelColor}` }}>
          <div className="stat-label">STATUS SAAT INI</div>
          <div className="stat-value" style={{ color: levelColor, fontSize: 22, letterSpacing: 2 }}>
            {levelLabel}
          </div>
          <div className="stat-sub">Confidence: {detection.confidence_score}% ({detection.confidence_label})</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">SENSOR ONLINE</div>
          <div className="stat-value text-ok">{onlineSensors}</div>
          <div className="stat-sub">dari {sensorList.length} sensor</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">SIRINE</div>
          <div className="stat-value" style={{ color: detection.siren_active ? '#ef4444' : '#22c55e', fontSize: 20 }}>
            {detection.siren_active ? '🔊 AKTIF' : '🔇 TIDAK AKTIF'}
          </div>
          <div className="stat-sub">3 unit terpasang</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">ALERT HARI INI</div>
          <div className="stat-value">{alertHistory.length}</div>
          <div className="stat-sub">event terdeteksi</div>
        </div>
      </div>

      {/* Sensor cards + chart */}
      <div className="grid-2">
        {/* Sensor readings */}
        <div className="card">
          <div className="card-title">📡 Pembacaan Sensor Real-time</div>
          {sensorList.length === 0 ? (
            <div className="text-dim" style={{ fontSize: 12, padding: 20, textAlign: 'center' }}>
              Menunggu data sensor... {connected ? '(terhubung)' : '(reconnecting)'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sensorList.map((s, i) => {
                const d3 = s.delta_3m || 0;
                const isUp = d3 > 0;
                const absD3 = Math.abs(d3);
                let borderColor = '#22c55e';
                if (absD3 >= 60) borderColor = '#7c3aed';
                else if (absD3 >= 40) borderColor = '#ef4444';
                else if (absD3 >= 25) borderColor = '#f97316';
                else if (absD3 >= 15) borderColor = '#eab308';
                return (
                  <div key={s.sensor_id} className="sensor-card" style={{ borderLeftColor: borderColor }}>
                    <div className="flex justify-between items-center mb-8">
                      <div className="sensor-name">{s.name} <span style={{ color: SENSOR_COLORS[i] }}>◉</span></div>
                      <span className="badge" style={{
                        background: s.quality === 'good' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                        color: s.quality === 'good' ? '#22c55e' : '#ef4444'
                      }}>{s.quality?.toUpperCase()}</span>
                    </div>
                    <div className="flex gap-16 items-center">
                      <div>
                        <div className="sensor-level">{s.water_level_cm?.toFixed(1)}</div>
                        <div className="sensor-unit">cm dari datum</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', flex: 1 }}>
                        <div>Δ1m: <span style={{ color: (s.delta_1m||0) > 0 ? '#ef4444' : '#22c55e' }}>{(s.delta_1m||0) > 0 ? '+' : ''}{s.delta_1m?.toFixed(1)} cm</span></div>
                        <div>Δ3m: <span style={{ color: isUp ? '#ef4444' : '#22c55e' }}>{d3 > 0 ? '+' : ''}{d3.toFixed(1)} cm</span></div>
                        <div>Rate: {s.rate_cm_per_min?.toFixed(1)} cm/min</div>
                        <div>Z: {s.z_score?.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="sensor-quality">
                      Baseline: {s.baseline_median?.toFixed(1)} cm · {s.timestamp ? formatTime(s.timestamp) : '-'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Chart & events */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">📈 Muka Air Real-time (cm)</div>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', fontSize: 11 }}
                    labelStyle={{ color: '#94a3b8' }}
                  />
                  <Line type="monotone" dataKey="level" stroke="#06b6d4" strokeWidth={2} dot={false} name="Level (cm)" />
                  <Line type="monotone" dataKey="baseline" stroke="#475569" strokeWidth={1} strokeDasharray="4 2" dot={false} name="Baseline" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>
                Menunggu data...
              </div>
            )}
          </div>

          {/* Alert history */}
          <div className="card" style={{ flex: 1 }}>
            <div className="card-title">📋 Riwayat Alert</div>
            <div className="scroll-list">
              {alertHistory.length === 0 ? (
                <div className="text-dim" style={{ fontSize: 12, padding: '8px 0' }}>Belum ada alert.</div>
              ) : alertHistory.slice(0, 10).map((a, i) => (
                <div key={i} className="log-item">
                  <span className="log-time">{formatTime(a.timestamp)}</span>
                  <span className="log-event">
                    <span className="badge" style={{
                      background: LEVEL_COLORS[a.level] + '22',
                      color: LEVEL_COLORS[a.level],
                      marginRight: 6,
                    }}>{LEVEL_LABEL[a.level]}</span>
                    Δ{a.max_delta_cm.toFixed(1)}cm · {a.confidence_score}% confidence
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Siren history */}
      <div className="card">
        <div className="card-title">🔊 Event Sirine Terbaru</div>
        <div className="scroll-list">
          {sirenHistory.length === 0 ? (
            <div className="text-dim" style={{ fontSize: 12, padding: '4px 0' }}>Belum ada event sirine.</div>
          ) : sirenHistory.slice(0, 5).map((s, i) => (
            <div key={i} className="log-item">
              <span className="log-time">{formatTime(s.timestamp)}</span>
              <span className="log-event">
                <span style={{ color: s.action.includes('on') ? '#ef4444' : '#22c55e', marginRight: 6, fontWeight: 700 }}>
                  {s.action.toUpperCase()}
                </span>
                {s.reason}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
