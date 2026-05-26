import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { ROUTE_COLORS, FACILITY_COLORS, FACILITY_ICONS } from '../utils/constants';

// ====== EVAKUASI ======
export function Evakuasi({ sirenActive }: any) {
  const routes = [
    { id:'r001', name:'Jalur A - Ke Tanjung Karang', status:'clear', distance_m:4800, estimated_time_min:20, priority:1 },
    { id:'r002', name:'Jalur B - Ke Sukabumi', status:'clear', distance_m:3600, estimated_time_min:15, priority:2 },
    { id:'r003', name:'Jalur C - Alternatif Timur', status:'clear', distance_m:2800, estimated_time_min:12, priority:3 },
  ];
  const safeZones = [
    { name:'GOR Saburai', elevation_m:45, capacity:5000, current_count:0 },
    { name:'Stadion Pahoman', elevation_m:38, capacity:8000, current_count:0 },
    { name:'Area Evakuasi Bukit Randu', elevation_m:62, capacity:2000, current_count:0 },
  ];
  return (
    <div className="page-section">
      {sirenActive && (
        <div style={{ padding:16, borderRadius:8, background:'rgba(239,68,68,0.15)', border:'1px solid #ef4444', color:'#ef4444', fontWeight:700, textAlign:'center', fontSize:14, animation:'blink 1s infinite' }}>
          🚨 SIRINE AKTIF — SEGERA EVAKUASI SEKARANG
        </div>
      )}
      <div className="grid-2">
        <div className="card">
          <div className="card-title">🚶 Jalur Evakuasi</div>
          {routes.map(r => (
            <div key={r.id} className="route-item">
              <div className="route-status-dot" style={{ background: ROUTE_COLORS[r.status] }} />
              <div style={{ flex:1 }}>
                <div className="route-name">{r.name}</div>
                <div className="route-meta">{(r.distance_m/1000).toFixed(1)} km · Est. {r.estimated_time_min} menit · Prioritas {r.priority}</div>
              </div>
              <span className="badge" style={{ background: ROUTE_COLORS[r.status]+'22', color: ROUTE_COLORS[r.status] }}>{r.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-title">🟢 Titik Kumpul & Zona Aman</div>
          {safeZones.map((s, i) => (
            <div key={i} style={{ padding:'10px 0', borderBottom:'1px solid #1e293b', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontSize:12, color:'#f1f5f9', fontWeight:600 }}>{s.name}</div>
                <div style={{ fontSize:11, color:'#475569' }}>Elevasi {s.elevation_m}m · Kapasitas {s.capacity.toLocaleString('id-ID')}</div>
              </div>
              <span className="badge" style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>AMAN</span>
            </div>
          ))}
        </div>
      </div>
      <div className="infobox">
        ℹ Rekomendasi: Jalur A dan B dalam kondisi clear. Jalur C sebagai alternatif. Pastikan membawa dokumen penting sebelum evakuasi.
      </div>
    </div>
  );
}

// ====== FASILITAS ======
export function Fasilitas(_: any) {
  const facilities = [
    { name:'Polsek Panjang', type:'polisi', phone:'(0721) 35001', address:'Jl. Yos Sudarso, Panjang' },
    { name:'Puskesmas Panjang', type:'medis', phone:'(0721) 35678', address:'Jl. Panjang Raya' },
    { name:'RS Urip Sumoharjo', type:'medis', phone:'(0721) 772200', address:'Jl. Urip Sumoharjo No.200' },
    { name:'Pos Damkar Panjang', type:'damkar', phone:'(0721) 112', address:'Jl. Yos Sudarso Km.7' },
    { name:'Pos SAR Teluk Lampung', type:'sar', phone:'(0721) 115', address:'Pelabuhan Panjang Dalam' },
  ];
  const equipment = [
    { name:'Excavator CAT 320', type:'Excavator', status:'available' },
    { name:'Truk Evakuasi 01', type:'Truk', status:'available' },
    { name:'Ambulance SAR', type:'Ambulance', status:'available' },
  ];
  return (
    <div className="page-section">
      <div className="card">
        <div className="card-title">🏥 Fasilitas Publik</div>
        <table className="data-table">
          <thead><tr><th>Nama</th><th>Tipe</th><th>Telepon</th><th>Alamat</th></tr></thead>
          <tbody>
            {facilities.map((f,i) => (
              <tr key={i}>
                <td style={{ color:'#f1f5f9', fontWeight:600 }}>{FACILITY_ICONS[f.type]} {f.name}</td>
                <td><span className="badge" style={{ background: FACILITY_COLORS[f.type]+'22', color: FACILITY_COLORS[f.type] }}>{f.type.toUpperCase()}</span></td>
                <td style={{ fontFamily:'monospace', color:'#06b6d4' }}>{f.phone}</td>
                <td style={{ color:'#475569', fontSize:11 }}>{f.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="card-title">🚧 Alat Berat</div>
        <table className="data-table">
          <thead><tr><th>Nama</th><th>Tipe</th><th>Status</th></tr></thead>
          <tbody>
            {equipment.map((e,i) => (
              <tr key={i}>
                <td style={{ color:'#f1f5f9' }}>{e.name}</td>
                <td style={{ color:'#94a3b8' }}>{e.type}</td>
                <td><span className="badge" style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>{e.status.toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====== STATUS PERANGKAT ======
export function StatusPerangkat({ sensors }: any) {
  const sensorList = Object.values(sensors) as any[];
  return (
    <div className="page-section">
      <div className="grid-2">
        <div className="card">
          <div className="card-title">📡 Status Sensor</div>
          <table className="data-table">
            <thead><tr><th>Kode</th><th>Level</th><th>Quality</th><th>Last Seen</th></tr></thead>
            <tbody>
              {(['SNS-PLG-01','SNS-PLG-02','SNS-PLG-03','SNS-PLG-04']).map(code => {
                const s = sensorList.find(x => x.code === code);
                return (
                  <tr key={code}>
                    <td style={{ color:'#f1f5f9', fontFamily:'monospace' }}>{code}</td>
                    <td style={{ color:'#06b6d4', fontFamily:'monospace' }}>{s ? s.water_level_cm?.toFixed(1)+'cm' : '—'}</td>
                    <td>
                      <span className="badge" style={{ background: s?.quality === 'good' ? 'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)', color: s?.quality === 'good'?'#22c55e':'#ef4444' }}>
                        {s ? s.quality?.toUpperCase() : 'OFFLINE'}
                      </span>
                    </td>
                    <td style={{ color:'#475569', fontSize:11 }}>{s ? new Date(s.timestamp).toLocaleTimeString('id-ID') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title">🔊 Status Sirine</div>
          <table className="data-table">
            <thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Radius</th></tr></thead>
            <tbody>
              {[
                { code:'SRN-PLG-01', name:'Sirine Pelabuhan', status:'inactive', radius:800 },
                { code:'SRN-PLG-02', name:'Sirine Pasar', status:'inactive', radius:600 },
                { code:'SRN-PLG-03', name:'Sirine Gudang Pusri', status:'inactive', radius:700 },
              ].map((s,i) => (
                <tr key={i}>
                  <td style={{ fontFamily:'monospace', color:'#f1f5f9' }}>{s.code}</td>
                  <td style={{ color:'#94a3b8' }}>{s.name}</td>
                  <td><span className="badge" style={{ background:'rgba(34,197,94,0.15)', color:'#22c55e' }}>OK</span></td>
                  <td style={{ color:'#475569' }}>{s.radius}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-title">🌐 Status Konektivitas</div>
        <div className="grid-3">
          {[
            { label:'WebSocket', status:'OK', detail:'Terhubung ke backend' },
            { label:'Database', status:'OK', detail:'PostgreSQL + PostGIS' },
            { label:'API Backend', status:'OK', detail:'FastAPI / localhost:8000' },
          ].map((item,i) => (
            <div key={i} className="stat-box">
              <div className="stat-label">{item.label}</div>
              <div className="stat-value text-ok" style={{ fontSize:18 }}>✅ {item.status}</div>
              <div className="stat-sub">{item.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ====== RIWAYAT ======
export function Riwayat({ alertHistory, sirenHistory }: any) {
  return (
    <div className="page-section">
      <div className="card">
        <div className="card-title">📜 Riwayat Alert Session Ini</div>
        <div className="scroll-list" style={{ maxHeight: 250 }}>
          {alertHistory.length === 0 ? (
            <div className="text-dim" style={{ padding:12, fontSize:12 }}>Tidak ada alert dalam sesi ini.</div>
          ) : alertHistory.map((a: any, i: number) => (
            <div key={i} className="log-item">
              <span className="log-time">{new Date(a.timestamp).toLocaleString('id-ID')}</span>
              <span className="log-event">
                Level: <b style={{ color:'#ef4444' }}>{a.level.toUpperCase()}</b> · Δmax: {a.max_delta_cm.toFixed(1)}cm · {a.confidence_score}% confidence · {a.sensor_count} sensor
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-title">🔊 Riwayat Event Sirine</div>
        <div className="scroll-list" style={{ maxHeight: 200 }}>
          {sirenHistory.length === 0 ? (
            <div className="text-dim" style={{ padding:12, fontSize:12 }}>Tidak ada event sirine.</div>
          ) : sirenHistory.map((s: any, i: number) => (
            <div key={i} className="log-item">
              <span className="log-time">{new Date(s.timestamp).toLocaleString('id-ID')}</span>
              <span className="log-event">
                <span style={{ color: s.action.includes('on') ? '#ef4444':'#22c55e', fontWeight:700, marginRight:8 }}>{s.action.toUpperCase()}</span>
                {s.reason}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ====== AUDIT LOG ======
export function AuditLog(_: any) {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    api.get('/audit/logs').then(r => setLogs(r.data.logs)).catch(()=>{});
  }, []);
  return (
    <div className="page-section">
      <div className="card">
        <div className="card-title">🔍 Audit Log</div>
        <table className="data-table">
          <thead><tr><th>Waktu</th><th>User</th><th>Aksi</th><th>Entity</th><th>Keterangan</th></tr></thead>
          <tbody>
            {logs.map((l,i) => (
              <tr key={i}>
                <td style={{ fontFamily:'monospace', fontSize:10, color:'#475569', whiteSpace:'nowrap' }}>{new Date(l.created_at).toLocaleString('id-ID')}</td>
                <td style={{ color:'#06b6d4', fontWeight:600 }}>{l.username}</td>
                <td style={{ fontFamily:'monospace', color:'#f97316', fontSize:11 }}>{l.action}</td>
                <td style={{ color:'#94a3b8', fontSize:11 }}>{l.entity_type}</td>
                <td style={{ color:'#475569', fontSize:11 }}>{l.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ====== LAPORAN ======
export function Laporan(_: any) {
  return (
    <div className="page-section">
      <div className="grid-2">
        <div className="card">
          <div className="card-title">📄 Laporan Harian</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}>
            <div className="flex justify-between"><span className="text-dim">Tanggal</span><span>{new Date().toLocaleDateString('id-ID')}</span></div>
            <div className="flex justify-between"><span className="text-dim">Total Alert</span><span className="text-ok">0</span></div>
            <div className="flex justify-between"><span className="text-dim">Sensor Uptime</span><span className="text-ok">100%</span></div>
            <div className="flex justify-between"><span className="text-dim">Event Sirine</span><span>0</span></div>
            <div className="flex justify-between"><span className="text-dim">Level Maks</span><span className="text-ok">Normal</span></div>
          </div>
          <button className="btn btn-outline btn-sm" style={{ marginTop:16, width:'100%' }}>📥 Download PDF</button>
        </div>
        <div className="card">
          <div className="card-title">🏥 Kesehatan Perangkat</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}>
            <div className="flex justify-between"><span className="text-dim">Sensor Online</span><span className="text-ok">4/4</span></div>
            <div className="flex justify-between"><span className="text-dim">Sirine OK</span><span className="text-ok">3/3</span></div>
            <div className="flex justify-between"><span className="text-dim">Fault</span><span className="text-ok">0</span></div>
          </div>
          <button className="btn btn-outline btn-sm" style={{ marginTop:16, width:'100%' }}>📥 Download Laporan</button>
        </div>
      </div>
    </div>
  );
}

// ====== DATA MASTER ======
export function DataMaster(_: any) {
  return (
    <div className="page-section">
      <div className="grid-2">
        {[
          { title:'📡 Sensor', count:4, items:['SNS-PLG-01','SNS-PLG-02','SNS-PLG-03','SNS-PLG-04'] },
          { title:'🔊 Sirine', count:3, items:['SRN-PLG-01','SRN-PLG-02','SRN-PLG-03'] },
          { title:'🏥 Fasilitas', count:5, items:['Polsek Panjang','Puskesmas Panjang','RS Urip Sumoharjo','Pos Damkar','Pos SAR'] },
          { title:'🚶 Jalur Evakuasi', count:3, items:['Jalur A','Jalur B','Jalur C'] },
          { title:'🟢 Zona Aman', count:3, items:['GOR Saburai','Stadion Pahoman','Bukit Randu'] },
          { title:'⚙️ Konfigurasi Threshold', count:1, items:['Konfigurasi Default MVP'] },
        ].map((m,i) => (
          <div key={i} className="card">
            <div className="flex justify-between items-center mb-12">
              <div className="card-title" style={{ margin:0 }}>{m.title}</div>
              <span className="badge" style={{ background:'rgba(6,182,212,0.15)', color:'#06b6d4' }}>{m.count}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {m.items.map((item,j) => (
                <div key={j} style={{ fontSize:11, color:'#94a3b8', padding:'4px 8px', background:'#0f172a', borderRadius:4 }}>{item}</div>
              ))}
            </div>
            <button className="btn btn-outline btn-sm" style={{ marginTop:12, width:'100%' }}>✏️ Kelola</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ====== PENGATURAN ======
export function Pengaturan({ user }: any) {
  return (
    <div className="page-section">
      <div className="grid-2">
        <div className="card">
          <div className="card-title">⚙️ Konfigurasi Threshold</div>
          <table className="data-table">
            <thead><tr><th>Level</th><th>Δ3m (cm)</th><th>Rate (cm/min)</th><th>Z-score</th></tr></thead>
            <tbody>
              {[
                ['Suspect','15','-','2.0'],
                ['Waspada','25','8','2.5'],
                ['Siaga','40','13','3.0'],
                ['Awas','60','20','3.5'],
              ].map(([l,d,r,z]) => (
                <tr key={l}>
                  <td style={{ color:'#f1f5f9' }}>{l}</td>
                  <td style={{ fontFamily:'monospace', color:'#06b6d4' }}>{d}</td>
                  <td style={{ fontFamily:'monospace', color:'#94a3b8' }}>{r}</td>
                  <td style={{ fontFamily:'monospace', color:'#94a3b8' }}>{z}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(user?.role === 'admin' || user?.role === 'supervisor') && (
            <button className="btn btn-outline btn-sm" style={{ marginTop:12 }}>✏️ Edit Threshold (2-step confirmation)</button>
          )}
        </div>
        <div className="card">
          <div className="card-title">👤 Profil & Role</div>
          <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:12 }}>
            <div className="flex justify-between"><span className="text-dim">Nama</span><span>{user?.full_name}</span></div>
            <div className="flex justify-between"><span className="text-dim">Username</span><span style={{ fontFamily:'monospace' }}>{user?.username}</span></div>
            <div className="flex justify-between"><span className="text-dim">Role</span>
              <span className="badge" style={{ background:'rgba(6,182,212,0.15)', color:'#06b6d4' }}>{user?.role?.toUpperCase()}</span>
            </div>
          </div>
          <div className="infobox" style={{ marginTop:16 }}>
            ℹ Aksi kritis memerlukan 2-step confirmation: matikan sirine, ubah threshold, reset warning.
          </div>
        </div>
      </div>
    </div>
  );
}
