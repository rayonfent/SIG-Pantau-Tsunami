import React from 'react';
import { SensorData, DetectionState, AlertEvent } from '../types';
import { LEVEL_COLORS, LEVEL_LABEL, formatDateTime } from '../utils/constants';

interface Props { sensors: Record<string, SensorData>; detection: DetectionState; alertHistory: AlertEvent[]; [k: string]: any; }

export default function DeteksiAlert({ sensors, detection, alertHistory }: Props) {
  const lc = LEVEL_COLORS[detection.level];
  const sensorList = Object.values(sensors);

  return (
    <div className="page-section">
      {/* Big level display */}
      <div className="grid-2">
        <div className="alert-level-display" style={{ background: lc + '15', borderColor: lc }}>
          <div style={{ fontSize: 12, color: '#64748b', letterSpacing: 2 }}>STATUS DETEKSI ANOMALI</div>
          <div className="alert-level-main" style={{ color: lc }}>{LEVEL_LABEL[detection.level]}</div>
          <div className="alert-confidence">
            Confidence: <b style={{ color: lc }}>{detection.confidence_score}%</b> ({detection.confidence_label})
          </div>
          {detection.siren_active && (
            <div style={{ marginTop: 8, color: '#ef4444', fontWeight: 700, fontSize: 12, animation: 'blink 1s infinite' }}>
              🔊 SIRINE AKTIF
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">📐 Rule Deteksi (Aktif)</div>
          <table className="data-table">
            <thead><tr><th>Level</th><th>Δ3m</th><th>Rate</th><th>Z-score</th></tr></thead>
            <tbody>
              {[
                { l: 'suspect', c: '#eab308', d: '≥15cm', r: '-', z: '≥2.0' },
                { l: 'waspada', c: '#f97316', d: '≥25cm', r: '≥8cm/min', z: '≥2.5' },
                { l: 'siaga',   c: '#ef4444', d: '≥40cm', r: '≥13cm/min', z: '≥3.0' },
                { l: 'awas',    c: '#7c3aed', d: '≥60cm', r: '≥20cm/min', z: '≥3.5' },
              ].map(r => (
                <tr key={r.l}>
                  <td><span className="badge" style={{ background: r.c + '22', color: r.c }}>{r.l.toUpperCase()}</span></td>
                  <td style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: 11 }}>{r.d}</td>
                  <td style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: 11 }}>{r.r}</td>
                  <td style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: 11 }}>{r.z}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="infobox" style={{ marginTop: 10 }}>
            ✔ Konfirmasi minimal: 2 sensor dalam 60 detik · Sampling: 10 detik
          </div>
        </div>
      </div>

      {/* Per-sensor detection values */}
      <div className="card">
        <div className="card-title">📡 Nilai Deteksi Per Sensor</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Sensor</th><th>Level (cm)</th><th>Δ1m</th><th>Δ3m</th><th>Δ5m</th><th>Rate</th><th>Z-score</th><th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {sensorList.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: '#475569' }}>Menunggu data sensor...</td></tr>
            )}
            {sensorList.map(s => {
              const d3 = Math.abs(s.delta_3m || 0);
              let rowColor = 'transparent';
              if (d3 >= 60) rowColor = 'rgba(124,58,237,0.08)';
              else if (d3 >= 40) rowColor = 'rgba(239,68,68,0.08)';
              else if (d3 >= 25) rowColor = 'rgba(249,115,22,0.08)';
              else if (d3 >= 15) rowColor = 'rgba(234,179,8,0.08)';
              return (
                <tr key={s.sensor_id} style={{ background: rowColor }}>
                  <td style={{ color: '#1f2937' }}>{s.code}<div style={{ fontSize: 10, color: '#64748b' }}>{s.name}</div></td>
                  <td style={{ color: '#06b6d4', fontFamily: 'monospace' }}>{s.water_level_cm?.toFixed(1)}</td>
                  <td style={{ color: (s.delta_1m || 0) > 0 ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>
                    {(s.delta_1m || 0) > 0 ? '+' : ''}{(s.delta_1m || 0).toFixed(1)}
                  </td>
                  <td style={{ color: (s.delta_3m || 0) > 0 ? '#ef4444' : '#22c55e', fontFamily: 'monospace', fontWeight: 700 }}>
                    {(s.delta_3m || 0) > 0 ? '+' : ''}{(s.delta_3m || 0).toFixed(1)}
                  </td>
                  <td style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                    {(s.delta_5m || 0) > 0 ? '+' : ''}{(s.delta_5m || 0).toFixed(1)}
                  </td>
                  <td style={{ fontFamily: 'monospace' }}>{s.rate_cm_per_min?.toFixed(2)}</td>
                  <td style={{ fontFamily: 'monospace', color: (s.z_score || 0) >= 2 ? '#f97316' : '#94a3b8' }}>
                    {s.z_score?.toFixed(3)}
                  </td>
                  <td>
                    <span className="badge" style={{
                      background: s.quality === 'good' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: s.quality === 'good' ? '#22c55e' : '#ef4444'
                    }}>{s.quality?.toUpperCase()}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Alert history */}
      <div className="card">
        <div className="card-title">🗂️ Histori Alert Session Ini</div>
        <div className="scroll-list" style={{ maxHeight: 200 }}>
          {alertHistory.length === 0 ? (
            <div className="text-dim" style={{ padding: 12, fontSize: 12 }}>Tidak ada alert dalam sesi ini.</div>
          ) : alertHistory.map((a, i) => (
            <div key={i} className="log-item">
              <span className="log-time">{formatDateTime(a.timestamp)}</span>
              <span className="log-event">
                <span className="badge" style={{ background: LEVEL_COLORS[a.level] + '22', color: LEVEL_COLORS[a.level], marginRight: 6 }}>
                  {LEVEL_LABEL[a.level]}
                </span>
                Δmax: {a.max_delta_cm.toFixed(1)}cm · Rate: {a.max_rate.toFixed(1)} · Z: {a.max_zscore.toFixed(2)} · {a.sensor_count} sensor
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
