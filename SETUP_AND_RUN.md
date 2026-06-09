# Setup dan Menjalankan Sistem SIG Pemantauan Tsunami

## 📋 Prasyarat
- Docker & Docker Compose
- Node.js v16+ (untuk development)
- Python 3.10+

## 🚀 Langkah-Langkah Setup Awal

### 1. Clone Repository
```bash
cd x:\Kuliah\SIG\sig-pantau-tsunami\sig-pantau-tsunami
```

### 2. Build dan Start Docker Containers
```bash
docker-compose up -d
```

Ini akan memulai:
- **PostgreSQL 15** (port 5432): Database dengan PostGIS
- **Backend FastAPI** (port 8000): API server
- **Frontend React** (port 3000): Web application

### 3. Verifikasi Setup
```bash
# Cek status containers
docker-compose ps

# Cek logs backend
docker-compose logs -f backend

# Cek logs frontend
docker-compose logs -f frontend
```

## 🔄 RESTART Docker (Untuk Menerapkan Perubahan)

Jika telah membuat perubahan pada database atau backend:

```bash
# Stop semua containers
docker-compose down

# Build ulang (opsional, jika ada perubahan Dockerfile)
docker-compose build --no-cache

# Start kembali
docker-compose up -d

# Lihat logs untuk memastikan semuanya berjalan
docker-compose logs -f
```

## 🔐 Login Akun Demo

Buka http://localhost:3000 dan login dengan salah satu akun:

### Akun Admin (Dapat menambah titik peta)
- **Username**: `admin`
- **Password**: `admin123`
- **Role**: Admin (dapat menambah & mengelola titik peta kustom)

### Akun Supervisor
- **Username**: `supervisor1`
- **Password**: `super123`
- **Role**: Supervisor (dapat melihat titik, tidak bisa menambah)

### Akun Operator
- **Username**: `operator1`
- **Password**: `oper123`
- **Role**: Operator (dapat melihat titik, tidak bisa menambah)

## 🗺️ Menggunakan Fitur Tambah Titik (ADMIN ONLY)

### Lokasi Tombol
1. **Halaman**: Monitoring Peta (Dashboard utama)
2. **Panel**: Sisi kiri, bagian "Layer & Legenda"
3. **Tombol**: "➕ Tambah Titik" (warna biru)

### Screenshot Lokasi
```
┌─────────────────────────────────────┐
│       🗂️ Layer & Legenda              │
├─────────────────────────────────────┤
│ ☑ SENSORS                           │
│ ☑ SIRENS                            │
│ ☑ FACILITIES                        │
│ ...                                 │
├─────────────────────────────────────┤
│    Admin Titik Peta                 │
│  ┌─────────────────────────────────┐│
│  │ ➕ Tambah Titik    ← TOMBOL INI │ │
│  └─────────────────────────────────┘│
│  Klik untuk meng-enable mode tambah  │
├─────────────────────────────────────┤
│    Legenda Sensor                   │
│ 🟢 Normal                           │
│ 🟡 Suspect (Δ≥15cm)               │
│ ...                                 │
└─────────────────────────────────────┘
```

### Langkah-Langkah Penggunaan

#### Step 1: Aktifkan Mode Tambah Titik
```
Login sebagai ADMIN
  ↓
Buka halaman "Monitoring Peta"
  ↓
Cari panel kiri "Layer & Legenda"
  ↓
Scroll ke bawah hingga menemukan section "Admin Titik Peta"
  ↓
Klik tombol "➕ Tambah Titik" (berubah warna menjadi merah saat aktif)
```

#### Step 2: Pilih Lokasi pada Peta
```
Peta akan menjadi interaktif
  ↓
Klik lokasi yang diinginkan pada peta
  ↓
Draft point akan muncul dengan warna KUNING dan garis putus-putus
  ↓
Modal form akan otomatis terbuka
```

#### Step 3: Isi Form Detail
```
┌──────────────────────────────────┐
│    ➕ Titik Baru                  │
├──────────────────────────────────┤
│ Koordinat: -5.471234, 105.275643 │
│                                  │
│ [Nama titik peta        ]        │
│ [Pilih Tipe ▼  ]                 │
│   - 🏕️  Posko                    │
│   - 🟢 Titik Kumpul              │
│   - ⚠️  Bahaya                   │
│   - ℹ️  Informasi (default)      │
│   - 📍 Lainnya                   │
│                                  │
│ [Deskripsi lokasi (opsional)  ] │
│                                  │
│ [Simpan]  [Batal]                │
└──────────────────────────────────┘
```

**Field yang harus diisi:**
- **Nama Titik**: Wajib (min 1 karakter, max 128)
- **Tipe**: Pilih dari dropdown
  - 🏕️ **Posko**: Pusat komando/koordinasi
  - 🟢 **Titik Kumpul**: Lokasi pengumpulan warga
  - ⚠️ **Bahaya**: Area berbahaya
  - ℹ️ **Informasi**: Titik informasi umum
  - 📍 **Lainnya**: Kategori lain
- **Deskripsi**: Opsional, catatan/detail tambahan

#### Step 4: Simpan Titik
```
Klik tombol "Simpan"
  ↓
Status: "Menyimpan..." (loading)
  ↓
Titik dikirim ke Backend API: POST /api/map/custom-points
  ↓
Database menyimpan ke table "custom_map_points"
  ↓
Sukses! Titik muncul di peta dengan warna sesuai tipenya
```

#### Step 5: Verifikasi
```
Titik akan ditampilkan di peta dengan:
- Warna sesuai tipe (cyan untuk posko, hijau untuk titik_kumpul, etc)
- Icon emoji
- Dapat diklik untuk melihat detail di popup

Refresh halaman (F5)
  ↓
Titik tetap ada di peta (disimpan di database)
```

## 🎨 Panduan Warna & Icon Titik

| Tipe | Icon | Warna | Kegunaan |
|------|------|-------|----------|
| Posko | 🏕️ | Cyan (#06b6d4) | Pusat komando/koordinasi |
| Titik Kumpul | 🟢 | Hijau (#22c55e) | Pengumpulan warga evakuasi |
| Bahaya | ⚠️ | Merah (#ef4444) | Area terlarang/berbahaya |
| Informasi | ℹ️ | Biru (#3b82f6) | Titik informasi umum |
| Lainnya | 📍 | Ungu (#a855f7) | Kategori lain |

## 🐛 Troubleshooting

### Tombol "Tambah Titik" Tidak Terlihat
**Solusi:**
- ✅ Pastikan login dengan akun **admin** (bukan supervisor/operator)
- ✅ Pastikan sudah di halaman "Monitoring Peta"
- ✅ Scroll panel kiri ke bawah untuk mencari section "Admin Titik Peta"

### Tombol Ada, Tapi Tidak Bisa Klik Titik pada Peta
**Solusi:**
- ✅ Pastikan tombol "Tambah Titik" berwarna MERAH (state: active)
- ✅ Jika masih biru, klik sekali lagi
- ✅ Restart Docker jika masih tidak berfungsi: `docker-compose down && docker-compose up -d`

### Titik Tidak Tersimpan ke Database
**Solusi:**
- ✅ Cek console browser (F12) untuk error message
- ✅ Cek backend logs: `docker-compose logs backend`
- ✅ Pastikan Backend sudah restart setelah perubahan: `docker-compose restart backend`
- ✅ Pastikan PostgreSQL sudah running: `docker-compose logs postgres`

### Backend Tidak Merespons
**Solusi:**
```bash
# Cek status
docker-compose ps

# Jika backend tidak running, lihat error
docker-compose logs backend

# Restart backend saja
docker-compose restart backend

# Atau restart semua
docker-compose down && docker-compose up -d
```

### Database Migration Error
**Solusi:**
```bash
# Cek apakah table sudah ada
docker-compose exec postgres psql -U tsunami -d sig_tsunami -c "\dt"

# Jika table belum ada, drop dan recreate
docker-compose down -v
docker-compose up -d
```

## 📊 API Endpoints

### Untuk Testing Menggunakan Postman/curl

#### 1. Get Custom Points
```bash
curl -X GET http://localhost:8000/api/map/custom-points
```

**Response:**
```json
{
  "points": [
    {
      "id": "uuid-xxx",
      "name": "Posko Darurat",
      "description": "Lokasi posko evakuasi",
      "type": "posko",
      "lng": 105.2756,
      "lat": -5.4712,
      "created_by": "admin",
      "created_at": "2026-05-26T11:00:00+00:00"
    }
  ]
}
```

#### 2. Create Custom Point (ADMIN ONLY)
```bash
curl -X POST http://localhost:8000/api/map/custom-points \
  -H "Authorization: Bearer demo_token_admin" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Posko Darurat",
    "description": "Lokasi posko evakuasi sementara",
    "type": "posko",
    "lng": 105.2756,
    "lat": -5.4712
  }'
```

**Response (201 Created):**
```json
{
  "point": {
    "id": "uuid-xxx",
    "name": "Posko Darurat",
    "description": "Lokasi posko evakuasi sementara",
    "type": "posko",
    "lng": 105.2756,
    "lat": -5.4712,
    "created_by": "admin",
    "created_at": "2026-05-26T11:00:00+00:00"
  }
}
```

## 📝 Catatan Penting

1. **Role-Based Access**: Hanya admin yang dapat membuat titik. Operator dan supervisor hanya bisa melihat.

2. **Data Persistence**: Semua titik disimpan di PostgreSQL, akan tetap ada meskipun:
   - Refresh halaman (F5)
   - Close aplikasi
   - Restart Docker

3. **Real-time Update**: Setelah klik "Simpan", titik langsung muncul di peta tanpa perlu refresh.

4. **Token Demo**: Sistem menggunakan token dummy untuk demo. Dalam production, implementasikan JWT proper.

5. **Koordinat**: Menggunakan WGS84 (EPSG:4326) standard untuk semua geografis data.

## 🔗 Links Penting

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Database: postgresql://tsunami:tsunami123@localhost:5432/sig_tsunami

---

**Jika masih ada masalah, cek file:**
- `FEATURE_CUSTOM_MAP_POINTS.md` - Dokumentasi teknis lengkap
- `docker-compose.yml` - Konfigurasi Docker
- `backend/app/api/map_data.py` - Backend implementation
- `frontend/src/pages/MonitoringPeta.tsx` - Frontend implementation