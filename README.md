# 🌊 SIG-PANTAU TSUNAMI
**Sistem Informasi Geografis Deteksi Dini Anomali Muka Air Laut**  
Area: Panjang, Bandar Lampung, Indonesia

---

## Arsitektur

```
┌─────────────────────────────────────────────────────┐
│  Browser (React + TypeScript)                        │
│  ├─ Dashboard · Monitoring Peta (Leaflet)           │
│  ├─ Deteksi & Alert · Warning Fullscreen Overlay    │
│  ├─ Evakuasi · Fasilitas · Status Perangkat         │
│  ├─ Simulasi & Drill (slider -200..+300 cm)         │
│  └─ Riwayat · Audit Log · Laporan · Pengaturan     │
└────────────────┬────────────────────────────────────┘
                 │ WebSocket (10 detik) + REST API
┌────────────────▼────────────────────────────────────┐
│  FastAPI (Python) — port 8000                        │
│  ├─ Sensor Stream (background task, tiap 10 detik)  │
│  ├─ Anomaly Detection Engine (threshold+zscore)     │
│  ├─ WebSocket Broadcast Manager                     │
│  └─ REST API: auth, map, sensors, alerts, sirens,  │
│     evacuation, simulation, audit, reports          │
└────────────────┬────────────────────────────────────┘
                 │ asyncpg
┌────────────────▼────────────────────────────────────┐
│  PostgreSQL 15 + PostGIS 3.3 — port 5432            │
│  ├─ 17 tabel inti (sensors, readings, alerts, ...)  │
│  └─ Geo types: Point, LineString, Polygon + GIST    │
└─────────────────────────────────────────────────────┘
```

---

## Cara Menjalankan (Lokal)

### Prasyarat
- Docker Desktop terinstall dan berjalan
- Docker Compose v2+

### Langkah

```bash
# 1. Clone / extract project
cd sig-pantau-tsunami

# 2. Jalankan semua service sekaligus
docker compose up --build

# Tunggu sampai semua service healthy (~60 detik pertama kali)
# Anda akan melihat:
#   ✅ Database PostgreSQL + PostGIS: READY
#   ✅ Backend FastAPI: http://localhost:8000
#   ✅ Frontend React: http://localhost:3000
#   ✅ Sensor stream: started (tiap 10 detik)
```

### Akses Aplikasi

| URL | Keterangan |
|-----|------------|
| http://localhost:3000 | Frontend (UI utama) |
| http://localhost:8000/docs | API Documentation (Swagger) |
| http://localhost:8000/api/health | Health check |

### Akun Login Demo

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | Admin |
| `supervisor1` | `super123` | Supervisor |
| `operator1` | `oper123` | Operator |

---

## Modul Halaman

| Halaman | Fungsi |
|---------|--------|
| **Dashboard** | Statistik real-time, sensor readings, chart, alert history |
| **Monitoring Peta** | Peta Leaflet: sensor, sirine, fasilitas, jalur evakuasi, zona aman, genangan |
| **Deteksi & Alert** | Rule threshold, nilai deteksi per sensor, histori alert |
| **Evakuasi** | Status jalur A/B/C, titik kumpul, informasi zona aman |
| **Fasilitas & Aset** | Daftar fasilitas publik dan alat berat |
| **Status Perangkat** | Uptime sensor, status sirine, konektivitas |
| **Simulasi & Drill** | Mode simulasi dengan slider -200..+300 cm, 4 skenario |
| **Riwayat** | Histori alert dan event sirine sesi ini |
| **Audit Log** | Rekam jejak aksi sistem dan pengguna |
| **Laporan** | Laporan harian dan kesehatan perangkat |
| **Data Master** | CRUD sensor, sirine, fasilitas, jalur, zona, threshold |
| **Pengaturan** | Konfigurasi threshold, profil pengguna |

---

## Logika Deteksi Anomali

**Sampling:** 10 detik  
**Pra-proses:** Moving median (5 sampel) + Baseline median 45 menit

| Level | Δ3m | Rate | Z-score |
|-------|-----|------|---------|
| Suspect | ≥15 cm | — | ≥2.0 |
| Waspada | ≥25 cm | ≥8 cm/min | ≥2.5 |
| Siaga | ≥40 cm | ≥13 cm/min | ≥3.0 |
| **AWAS** | **≥60 cm** | **≥20 cm/min** | **≥3.5** |

**Konfirmasi:** minimal 2 sensor dalam 60 detik  
**Sirine:** otomatis ON saat level AWAS → OFF jika normal stabil 10 menit atau konfirmasi supervisor (2-step)

---

## Warning Fullscreen

Saat level AWAS terdeteksi:
- Overlay fullscreen gelap dengan border pulse merah-ungu
- Teks besar: **PERINGATAN TSUNAMI**
- Informasi: lokasi, waktu, confidence, sensor konfirmasi, status sirine
- Tombol cepat: Jalur Evakuasi, Titik Kumpul, Konfirmasi Supervisor (2-step dismiss)
- Hanya Supervisor/Admin yang dapat menutup overlay

---

## Simulasi & Drill

Aktifkan dari halaman **Simulasi & Drill** (perlu login sebagai Supervisor/Admin):

| Skenario | Efek |
|----------|------|
| Normal | Sinusoidal ±3cm + noise acak |
| Air Naik Cepat | +5cm/menit → trigger siaga/awas dalam ~3 menit |
| Surut Mendadak | -8cm/menit → anomali besar |
| Sensor Offline | SNS-PLG-01 mati, fallback ke sensor cadangan |

Slider override: -200 cm s.d. +300 cm dari baseline

---

## Failover Minimal

- Sensor offline jika tidak ada data >30 detik → fallback ke sensor cadangan
- WebSocket putus → fallback polling 10 detik (auto-reconnect)
- Sirine gagal aktivasi → broadcast error kritis ke UI

---

## Struktur File

```
sig-pantau-tsunami/
├── docker-compose.yml
├── database/
│   ├── migrations/001_schema.sql    # DDL lengkap + PostGIS
│   └── seeds/002_seed.sql           # Data Panjang, Lampung
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                  # FastAPI entry point
│       ├── core/config.py           # Settings
│       ├── core/database.py         # AsyncPG connection
│       ├── services/
│       │   ├── detection_engine.py  # Anomaly detection logic
│       │   └── sensor_stream.py     # Background sensor simulation
│       ├── websocket/manager.py     # WS broadcast manager
│       └── api/                     # REST routers
└── frontend/
    └── src/
        ├── App.tsx                  # Main layout + routing
        ├── App.css                  # Dark tactical design system
        ├── pages/                   # 12 halaman
        ├── components/alert/        # WarningOverlay
        ├── hooks/useWebSocket.ts    # WS hook + auto-reconnect
        ├── utils/api.ts             # Axios client
        └── types/index.ts           # TypeScript types
```

---

## Pengembangan Lanjutan (P1/P2)

- [ ] Integrasi DB nyata (sensor readings ke PostgreSQL via asyncpg)
- [ ] JWT auth penuh + PIN 2-step confirmation
- [ ] DEM inundation modeling yang lebih akurat
- [ ] Laporan PDF (ReportLab)
- [ ] Optimasi jalur dinamis (Dijkstra via PostGIS)
- [ ] Push notification (FCM) saat level AWAS
- [ ] Integrasi BMKG WebSocket feed
