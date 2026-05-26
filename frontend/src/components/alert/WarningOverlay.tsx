import React, { useState } from 'react';
import { AlertEvent, User } from '../../types';
import { formatDateTime } from '../../utils/constants';

interface Props {
  alert: AlertEvent;
  sirenActive: boolean;
  user: User;
  onDismiss: () => void;
  onNavigate: (page: string) => void;
}

export default function WarningOverlay({ alert, sirenActive, user, onDismiss, onNavigate }: Props) {
  const [step, setStep] = useState(0);
  const canDismiss = user.role === 'supervisor' || user.role === 'admin';

  return (
    <div className="warning-overlay">
      <div className="warning-border" />
      <div className="warning-content">
        <div className="warning-icon">🚨</div>

        <div className="warning-title">PERINGATAN TSUNAMI</div>
        <div className="warning-subtitle">⚠ KONDISI AIR LAUT ABNORMAL TERDETEKSI ⚠</div>
        <div className="warning-evakuasi">
          SEGERA EVAKUASI KE ZONA AMAN
        </div>

        <div className="warning-meta">
          <div className="warning-meta-item">
            <div className="warning-meta-label">LOKASI</div>
            <div className="warning-meta-value">📍 Panjang, Bandar Lampung</div>
          </div>
          <div className="warning-meta-item">
            <div className="warning-meta-label">WAKTU DETEKSI</div>
            <div className="warning-meta-value">{formatDateTime(alert.timestamp)}</div>
          </div>
          <div className="warning-meta-item">
            <div className="warning-meta-label">CONFIDENCE</div>
            <div className="warning-meta-value" style={{ color: '#fbbf24' }}>
              {alert.confidence_score}% ({alert.confidence_label.toUpperCase()})
            </div>
          </div>
          <div className="warning-meta-item">
            <div className="warning-meta-label">SENSOR KONFIRMASI</div>
            <div className="warning-meta-value">{alert.sensor_count} sensor</div>
          </div>
          <div className="warning-meta-item">
            <div className="warning-meta-label">DELTA MAKS</div>
            <div className="warning-meta-value" style={{ color: '#ef4444' }}>
              {alert.max_delta_cm.toFixed(1)} cm (3 menit)
            </div>
          </div>
          <div className="warning-meta-item">
            <div className="warning-meta-label">STATUS SIRINE</div>
            <div className="warning-meta-value" style={{ color: sirenActive ? '#ef4444' : '#94a3b8' }}>
              {sirenActive ? '🔊 AKTIF' : '🔇 TIDAK AKTIF'}
            </div>
          </div>
        </div>

        <div className="warning-actions">
          <button className="warning-btn warning-btn-evac"
            onClick={() => { onNavigate('evakuasi'); onDismiss(); }}>
            🚶 Lihat Jalur Evakuasi
          </button>
          <button className="warning-btn warning-btn-evac"
            style={{ background: '#3b82f6', borderColor: '#3b82f6' }}
            onClick={() => { onNavigate('monitoring'); onDismiss(); }}>
            🗺️ Tampilkan Titik Kumpul
          </button>

          {canDismiss ? (
            step === 0 ? (
              <button className="warning-btn" style={{ background: '#7c3aed', borderColor: '#7c3aed', color: '#fff' }}
                onClick={() => setStep(1)}>
                ✅ Konfirmasi Supervisor (1/2)
              </button>
            ) : (
              <button className="warning-btn" style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                onClick={onDismiss}>
                ✅ Konfirmasi Akhir — Reset Warning (2/2)
              </button>
            )
          ) : (
            <div style={{ fontSize: 11, color: '#64748b', padding: '8px 16px' }}>
              ⚠ Hanya Supervisor/Admin yang dapat menutup overlay ini
            </div>
          )}
        </div>

        {alert.triggered_by.length > 0 && (
          <div style={{ marginTop: 16, fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
            Trigger: {alert.triggered_by.slice(0, 3).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
