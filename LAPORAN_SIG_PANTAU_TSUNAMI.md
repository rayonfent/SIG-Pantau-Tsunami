# LAPORAN PERANCANGAN SIG PANTAU TSUNAMI

## 1. Rancangan Dataset

Project **SIG Pantau Tsunami** menggunakan **PostgreSQL** dengan ekstensi **PostGIS**. Hal ini terlihat pada file `database/migrations/001_schema.sql` melalui perintah:

- `CREATE EXTENSION IF NOT EXISTS postgis;`
- `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

Pemakaian PostGIS menunjukkan bahwa sistem ini dirancang untuk mengelola **data spasial/geografis**, seperti titik sensor, sirine, fasilitas, jalur evakuasi, dan zona aman.

### 1.1 Karakteristik dataset
Dataset pada sistem ini terdiri dari dua kelompok besar:

1. **Data operasional sistem**
   - pengguna
   - log audit
   - event sistem
   - konfigurasi threshold

2. **Data spasial kebencanaan**
   - sensor muka air
   - pembacaan sensor
   - alert
   - sirine
   - fasilitas umum
   - jalur evakuasi
   - safe zone
   - inundation zone
   - custom map point

### 1.2 Struktur tabel utama

#### a. Tabel `users`
Tabel ini menyimpan data pengguna aplikasi.

Atribut penting:
- `id`
- `username`
- `full_name`
- `email`
- `hashed_password`
- `role`
- `is_active`

Role yang tersedia:
- `operator`
- `supervisor`
- `admin`

**Fungsi:**  
Mengatur otorisasi pengguna dalam sistem, terutama untuk fitur operasional seperti pengelolaan titik peta dan monitoring.

---

#### b. Tabel `sensors`
Tabel ini menyimpan posisi dan identitas sensor muka air.

Atribut penting:
- `code`
- `name`
- `location` → `geometry(Point, 4326)`
- `address`
- `elevation_m`
- `is_primary`
- `backup_sensor_id`
- `status`
- `last_seen`

Status sensor:
- `online`
- `suspect`
- `offline`
- `maintenance`

**Fungsi:**  
Menjadi sumber data utama untuk mendeteksi anomali muka air sebagai indikasi tsunami.

---

#### c. Tabel `sensor_readings`
Tabel ini menyimpan data pembacaan sensor secara berkala.

Atribut penting:
- `sensor_id`
- `recorded_at`
- `water_level_cm`
- `raw_value`
- `quality`
- `delta_1m`
- `delta_3m`
- `delta_5m`
- `rate_cm_per_min`
- `z_score`
- `smoothed_level`
- `baseline_median`

Quality flag:
- `good`
- `suspect`
- `bad`
- `offline`

**Fungsi:**  
Menyimpan data time-series untuk analisis perubahan muka air dan deteksi dini.

---

#### d. Tabel `threshold_configs`
Tabel ini berisi konfigurasi ambang batas deteksi.

Atribut penting:
- `suspect_delta3m`
- `suspect_zscore`
- `waspada_delta3m`
- `waspada_rate`
- `waspada_zscore`
- `siaga_delta3m`
- `siaga_rate`
- `siaga_zscore`
- `awas_delta3m`
- `awas_rate`
- `awas_zscore`
- `min_sensors_confirm`
- `confirm_window_sec`
- `siren_auto_level`

**Fungsi:**  
Menentukan aturan logika sistem untuk menaikkan status dari normal sampai awas.

---

#### e. Tabel `alerts`
Tabel ini menyimpan informasi peringatan yang dihasilkan sistem.

Atribut penting:
- `level`
- `status`
- `confidence_score`
- `triggered_at`
- `confirmed_at`
- `resolved_at`
- `resolution_note`
- `max_delta_cm`
- `max_rate`
- `max_zscore`
- `sensor_count`

Level alert:
- `normal`
- `suspect`
- `waspada`
- `siaga`
- `awas`

Status alert:
- `active`
- `confirmed`
- `resolved`
- `false_alarm`

**Fungsi:**  
Menjadi pusat informasi status kedaruratan yang ditampilkan ke dashboard dan peta.

---

#### f. Tabel `alert_sensor_evidence`
Tabel ini menghubungkan alert dengan sensor yang menjadi bukti.

Atribut penting:
- `alert_id`
- `sensor_id`
- `reading_id`
- `delta_3m`
- `rate`
- `z_score`
- `recorded_at`

**Fungsi:**  
Menyimpan evidence atau dasar perhitungan suatu alert.

---

#### g. Tabel `sirens`
Tabel ini menyimpan data sirine peringatan.

Atribut penting:
- `code`
- `name`
- `location` → `geometry(Point, 4326)`
- `radius_m`
- `status`
- `is_auto_enabled`
- `last_tested`
- `last_activated`

Status sirine:
- `active`
- `inactive`
- `fault`
- `maintenance`

**Fungsi:**  
Menunjukkan lokasi sirine dan cakupan radius peringatan di peta.

---

#### h. Tabel `siren_events`
Tabel ini mencatat histori aktivasi sirine.

Atribut penting:
- `siren_id`
- `alert_id`
- `event_type`
- `triggered_by`
- `reason`
- `success`
- `error_detail`

**Fungsi:**  
Sebagai jejak audit untuk aktivitas sirine otomatis maupun manual.

---

#### i. Tabel `facilities`
Tabel ini berisi fasilitas pendukung tanggap bencana.

Atribut penting:
- `name`
- `type`
- `location`
- `address`
- `phone`
- `capacity`
- `is_active`

Jenis fasilitas:
- `polisi`
- `medis`
- `damkar`
- `sar`
- `lainnya`

**Fungsi:**  
Menyediakan informasi fasilitas penting di sekitar area bencana.

---

#### j. Tabel `heavy_equipment`
Tabel ini menyimpan data alat berat.

Atribut penting:
- `name`
- `type`
- `location`
- `status`
- `notes`

**Fungsi:**  
Mendukung operasi penanganan bencana di lapangan.

---

#### k. Tabel `evacuation_routes`
Tabel ini menyimpan jalur evakuasi.

Atribut penting:
- `name`
- `route` → `geometry(LineString, 4326)`
- `direction`
- `capacity_persons`
- `distance_m`
- `estimated_time_min`
- `status`
- `priority`

Status rute:
- `clear`
- `congested`
- `blocked`

**Fungsi:**  
Menampilkan rute evakuasi pada peta beserta kondisi lalu lintas/kelancaran jalur.

---

#### l. Tabel `traffic_density`
Tabel ini mencatat kepadatan jalur evakuasi.

Atribut penting:
- `route_id`
- `density_percent`
- `recorded_at`

**Fungsi:**  
Memberikan data dinamis terkait kepadatan pada jalur evakuasi.

---

#### m. Tabel `safe_zones`
Tabel ini menyimpan zona aman.

Atribut penting:
- `name`
- `zone` → `geometry(Polygon, 4326)`
- `elevation_m`
- `capacity`
- `current_count`
- `facilities`
- `is_active`

**Fungsi:**  
Menunjukkan area tujuan evakuasi yang aman dari ancaman tsunami.

---

#### n. Tabel `inundation_zones`
Tabel ini menyimpan zona genangan.

Atribut penting:
- `name`
- `zone` → `geometry(Polygon, 4326)`
- `risk_level`
- `notes`

**Fungsi:**  
Membantu visualisasi area yang berpotensi tergenang saat tsunami.

---

#### o. Tabel `custom_map_points`
Tabel ini menyimpan titik tambahan yang dibuat admin.

Atribut penting:
- `name`
- `description`
- `type`
- `location` → `geometry(Point, 4326)`
- `created_by`
- `is_active`

Jenis titik:
- `posko`
- `titik_kumpul`
- `bahaya`
- `informasi`
- `lainnya`

**Fungsi:**  
Memungkinkan admin menambahkan informasi spasial baru langsung dari peta.

---

#### p. Tabel `simulation_sessions`
Digunakan untuk simulasi.

Atribut penting:
- `name`
- `scenario`
- `status`
- `water_level_override`
- `started_by`
- `started_at`
- `ended_at`

**Fungsi:**  
Mendukung pengujian skenario tanpa mengganggu data riil.

---

#### q. Tabel `audit_logs`
Mencatat aktivitas pengguna.

Atribut penting:
- `user_id`
- `username`
- `action`
- `entity_type`
- `entity_id`
- `old_value`
- `new_value`
- `reason`
- `ip_address`

**Fungsi:**  
Mendukung keamanan, pelacakan perubahan, dan akuntabilitas.

---

#### r. Tabel `system_events`
Mencatat event sistem.

Atribut penting:
- `event_type`
- `severity`
- `message`
- `detail`

**Fungsi:**  
Mencatat kejadian internal sistem untuk monitoring teknis.

### 1.3 Relasi data
Beberapa relasi penting pada dataset:

- `sensor_readings.sensor_id` → `sensors.id`
- `alerts.resolved_by` → `users.id`
- `alert_sensor_evidence.alert_id` → `alerts.id`
- `alert_sensor_evidence.sensor_id` → `sensors.id`
- `alert_sensor_evidence.reading_id` → `sensor_readings.id`
- `siren_events.siren_id` → `sirens.id`
- `siren_events.alert_id` → `alerts.id`
- `traffic_density.route_id` → `evacuation_routes.id`
- `threshold_configs.created_by` → `users.id`
- `simulation_sessions.started_by` → `users.id`

### 1.4 Tipe data spasial
Sistem memanfaatkan beberapa bentuk geometri:

- **Point**  
  Untuk sensor, sirine, fasilitas, alat berat, dan custom point.
- **LineString**  
  Untuk jalur evakuasi.
- **Polygon**  
  Untuk safe zone dan inundation zone.

Semua data spasial menggunakan **SRID 4326 (WGS84)**, sehingga cocok digunakan untuk web mapping berbasis Leaflet/OpenStreetMap.

### 1.5 Kesimpulan rancangan dataset
Rancangan dataset pada project ini sudah cukup lengkap karena tidak hanya menyimpan data sensor, tetapi juga:
- data pengguna,
- data operasional peringatan,
- data spasial kebencanaan,
- data evakuasi,
- data fasilitas pendukung,
- serta data audit.

Dengan demikian, dataset dirancang untuk mendukung **sistem monitoring tsunami yang terintegrasi**.

---

## 2. Rancangan Layers

Dalam project ini, istilah layer dapat dijelaskan dalam dua sudut pandang:

1. **Layer arsitektur sistem**
2. **Layer peta (map layers)**

## 2.1 Layer arsitektur sistem

### a. Layer database
Layer paling bawah adalah database PostgreSQL + PostGIS.

Tugas layer ini:
- menyimpan seluruh data aplikasi,
- mengelola data spasial,
- menyediakan indeks geospasial,
- mendukung query berbasis lokasi.

Contoh:
- sensor disimpan sebagai `geometry(Point, 4326)`
- safe zone disimpan sebagai `geometry(Polygon, 4326)`
- evacuation route disimpan sebagai `geometry(LineString, 4326)`

### b. Layer backend / service
Backend menggunakan **FastAPI**.  
Berdasarkan file `backend/app/api/map_data.py`, backend bertugas:

- menyediakan endpoint untuk peta,
- mengambil dan mengirim data ke frontend,
- melakukan validasi input,
- melakukan kontrol akses,
- menyimpan titik peta custom ke database.

Contoh endpoint:
- `/config`
- `/layers`
- `/status`
- `/sensors`
- `/sirens`
- `/facilities`
- `/evacuation-routes`
- `/safe-zones`
- `/inundation-zones`
- `/custom-points`

Fitur penting pada layer backend:
- validasi data menggunakan **Pydantic**
- otorisasi admin pada pembuatan titik custom
- koneksi ke PostgreSQL menggunakan **asyncpg**
- pengolahan data custom map point

### c. Layer frontend
Frontend menggunakan **React + TypeScript** dan library **React-Leaflet**.

Tugas layer frontend:
- meminta data dari backend,
- menampilkan data ke peta,
- mengatur interaksi pengguna,
- mengatur visibilitas layer.

Pada `MonitoringPeta.tsx`, frontend memanggil data secara paralel melalui:
- `mapApi.sensors()`
- `mapApi.sirens()`
- `mapApi.facilities()`
- `mapApi.evacRoutes()`
- `mapApi.safeZones()`
- `mapApi.inundation()`
- `mapApi.customPoints()`

### d. Layer interaksi pengguna
Layer ini merupakan lapisan tempat user berinteraksi langsung dengan sistem, misalnya:
- menyalakan/mematikan layer,
- melihat popup,
- melihat status alert,
- admin menambah titik baru di peta.

### e. Layer keamanan dan otorisasi
Walaupun sederhana, sistem ini sudah menerapkan pemisahan hak akses:
- hanya **admin** yang dapat menambahkan custom map point,
- token dicek pada backend,
- user dengan role lain tidak boleh membuat titik baru.

---

## 2.2 Layer peta (map layers)

Berdasarkan file `MonitoringPeta.tsx` dan endpoint `/layers`, sistem memiliki beberapa layer peta utama.

### a. Layer sensor
Layer ini menampilkan titik sensor muka air.

Ciri:
- divisualisasikan dengan `CircleMarker`
- warna marker menunjukkan tingkat perubahan muka air
- popup menampilkan:
  - nama sensor
  - level air
  - delta 3 menit
  - kualitas data
  - kode sensor

Warna sensor:
- hijau = normal
- kuning = suspect
- oranye = waspada
- merah = siaga
- ungu = awas

### b. Layer sirine
Layer ini menampilkan lokasi sirine.

Ciri:
- ada marker titik sirine
- ada radius cakupan sirine
- saat sirine aktif warna menjadi merah
- popup menampilkan nama, status, dan radius

### c. Layer fasilitas
Layer ini menampilkan fasilitas publik pendukung.

Jenis fasilitas:
- polisi
- medis
- damkar
- sar

Ciri:
- tiap jenis fasilitas memiliki warna/icon berbeda
- popup menampilkan nama, tipe, dan nomor telepon

### d. Layer jalur evakuasi
Layer ini menampilkan rute evakuasi menggunakan polyline.

Ciri:
- divisualisasikan dengan `Polyline`
- warna rute menunjukkan status:
  - hijau = clear
  - oranye = congested
  - merah = blocked
- popup menampilkan:
  - nama jalur
  - status
  - jarak
  - estimasi waktu

### e. Layer safe zone
Layer ini menampilkan zona aman.

Ciri:
- divisualisasikan dengan `Polygon`
- warna dominan hijau
- popup menampilkan:
  - nama zona
  - elevasi
  - kapasitas

### f. Layer inundation zone
Layer ini menampilkan zona genangan/risiko.

Ciri:
- divisualisasikan dengan `Polygon`
- warna merah atau oranye
- menggunakan opacity transparan dan garis putus-putus
- popup menampilkan nama dan level risiko

### g. Layer custom points
Layer ini menampilkan titik tambahan buatan admin.

Jenis custom point:
- posko
- titik kumpul
- bahaya
- informasi
- lainnya

Ciri:
- tiap jenis punya icon dan warna sendiri
- popup menampilkan nama, tipe, deskripsi, pembuat, dan koordinat

### h. Base layer
Base layer yang digunakan adalah:
- **OpenStreetMap**

Base layer ini dipanggil melalui:
`TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"`

---

## 2.3 Pengaturan default layer
Default layer pada frontend:

- `sensors: true`
- `sirens: true`
- `facilities: true`
- `evacuation: true`
- `safe_zones: true`
- `inundation: false`
- `custom_points: true`

Artinya, saat halaman dibuka:
- layer penting langsung aktif,
- layer inundation dimatikan dulu agar peta tidak terlalu padat.

---

## 2.4 Kesimpulan rancangan layers
Rancangan layer pada sistem ini sudah baik karena:
- memisahkan layer database, backend, dan frontend,
- menyediakan layer peta yang sesuai dengan kebutuhan mitigasi bencana,
- mendukung kontrol visibilitas layer,
- mendukung visualisasi spasial yang informatif.

Dengan desain seperti ini, pengguna dapat memahami kondisi lapangan secara cepat melalui peta.

---

## 3. Rancangan UI

Rancangan UI dapat dilihat terutama pada halaman `frontend/src/pages/MonitoringPeta.tsx`.  
UI difokuskan pada **dashboard peta interaktif** untuk monitoring tsunami.

## 3.1 Struktur layout utama
Layout utama terdiri dari dua bagian besar:

1. **Panel kiri (sidebar / control panel)**
2. **Area kanan (map container)**

Secara sederhana:
- kiri = kontrol layer, legenda, dan status
- kanan = peta interaktif

Kode menunjukkan layout:
- container utama memakai `display: flex`
- sidebar lebar sekitar `200px`
- map memenuhi sisa area

## 3.2 Komponen UI utama

### a. Sidebar Layer & Legenda
Sidebar menampilkan:
- daftar layer dengan checkbox,
- kontrol admin untuk menambah titik,
- legenda sensor,
- legenda fasilitas,
- legenda jalur evakuasi,
- indikator level alert.

Tujuan sidebar:
- memudahkan pengguna mengatur tampilan peta,
- memberikan panduan visual,
- menyediakan akses cepat ke fitur admin.

### b. Layer toggle
Setiap layer dapat diaktifkan atau dimatikan dengan checkbox.

Contoh layer:
- sensors
- sirens
- facilities
- evacuation
- safe_zones
- inundation
- custom_points

Keunggulan UI ini:
- sederhana,
- langsung dipahami,
- cocok untuk dashboard monitoring.

### c. Panel admin tambah titik
Jika user berperan sebagai admin, muncul fitur:
- tombol `Tambah Titik`
- mode klik pada peta
- form isian nama, tipe, dan deskripsi
- tombol simpan dan batal

Alur interaksi:
1. admin menekan tombol tambah titik,
2. admin klik lokasi pada peta,
3. sistem menampilkan marker draft,
4. admin mengisi form,
5. data dikirim ke backend dan disimpan.

### d. Legenda warna sensor
UI menyediakan legenda agar pengguna memahami arti warna sensor:
- hijau → normal
- kuning → suspect
- oranye → waspada
- merah → siaga
- ungu → awas

Hal ini penting agar visualisasi peta mudah ditafsirkan.

### e. Legenda fasilitas
UI juga menampilkan daftar jenis fasilitas beserta icon/warna, sehingga user tahu titik tertentu adalah:
- polisi,
- medis,
- damkar,
- SAR.

### f. Indikator level alert
Di bagian bawah sidebar terdapat panel indikator alert.

Karakteristik:
- warna mengikuti level alert
- teks menampilkan status seperti `NORMAL`, `WASPADA`, `SIAGA`, atau `AWAS`
- jika sirine aktif, muncul tulisan `SIRINE AKTIF`

Komponen ini penting karena menjadi ringkasan situasi terkini.

---

## 3.3 Area peta interaktif
Peta adalah komponen utama UI.

Karakteristik:
- memakai `MapContainer` dari React-Leaflet
- menggunakan pusat koordinat sekitar Bandar Lampung
- zoom default `14`
- base map OpenStreetMap

Elemen pada peta:
- marker sensor
- marker sirine
- marker fasilitas
- polyline jalur evakuasi
- polygon zona aman
- polygon zona genangan
- marker custom point

### Popup interaktif
Setiap objek peta memiliki popup.  
Contohnya:

- sensor → level air, delta, kualitas, kode
- sirine → nama, status, radius
- fasilitas → nama, tipe, kontak
- jalur evakuasi → jarak dan waktu tempuh
- safe zone → kapasitas dan elevasi
- custom point → deskripsi dan pembuat

Hal ini menunjukkan UI tidak hanya informatif secara visual, tetapi juga menyediakan detail saat dibutuhkan.

---

## 3.4 Gaya visual UI
Dari kode yang ada, UI menggunakan pendekatan warna gelap dan panel modern.

Ciri visual:
- background gelap
- border tipis
- warna aksen cyan, hijau, oranye, merah, ungu
- marker warna-warni sesuai kategori

Kesan desain:
- modern,
- fokus ke data,
- cocok untuk sistem command center atau monitoring real-time.

---

## 3.5 Kelebihan rancangan UI
Beberapa kelebihan desain UI project ini:

1. **Berbasis peta**
   - sangat sesuai untuk sistem SIG.

2. **Informasi bertingkat**
   - user melihat ringkasan dulu, lalu detail melalui popup.

3. **Kontrol layer sederhana**
   - cocok untuk operator lapangan atau admin.

4. **Mendukung role admin**
   - ada fitur tambah titik peta secara langsung.

5. **Visual status jelas**
   - warna membantu memahami kondisi cepat.

6. **Fokus pada monitoring**
   - layout memprioritaskan peta sebagai pusat perhatian.

---

## 3.6 Saran narasi penjelasan singkat saat presentasi
Jika ingin dijelaskan secara lisan, bisa memakai narasi berikut:

### Rancangan Dataset
“Dataset pada sistem ini dirancang menggunakan PostgreSQL dan PostGIS agar mampu menyimpan data spasial dan nonspasial. Data utamanya meliputi sensor muka air, pembacaan sensor, alert, sirine, fasilitas, jalur evakuasi, zona aman, zona genangan, dan titik peta tambahan. Struktur ini mendukung kebutuhan monitoring tsunami secara real-time dan terintegrasi.”

### Rancangan Layers
“Layers pada sistem dibagi menjadi dua, yaitu layer arsitektur sistem dan layer peta. Pada arsitektur sistem terdapat layer database, backend FastAPI, frontend React, dan layer interaksi pengguna. Sedangkan pada peta terdapat layer sensor, sirine, fasilitas, jalur evakuasi, safe zone, inundation zone, dan custom point. Masing-masing layer dapat ditampilkan atau disembunyikan sesuai kebutuhan pengguna.”

### Rancangan UI
“UI sistem dirancang berbentuk dashboard peta interaktif. Bagian kiri berisi kontrol layer, legenda, dan indikator alert, sedangkan bagian kanan menampilkan peta utama. Setiap objek pada peta memiliki popup informasi sehingga pengguna dapat melihat detail data tanpa meninggalkan tampilan peta. Desain ini memudahkan operator dalam memantau kondisi dan mengambil keputusan dengan cepat.”

---

## 4. Kesimpulan

Secara keseluruhan, project **SIG Pantau Tsunami** sudah memiliki rancangan yang terstruktur.

- **Dataset** dirancang lengkap untuk kebutuhan monitoring, peringatan, evakuasi, dan audit.
- **Layers** dirancang berlapis mulai dari database sampai tampilan peta interaktif.
- **UI** dirancang fokus pada kemudahan monitoring berbasis peta dan pengambilan keputusan cepat.

Rancangan seperti ini sangat sesuai untuk sistem informasi geografis kebencanaan karena mampu menggabungkan:
- data real-time,
- data spasial,
- informasi fasilitas,
- jalur evakuasi,
- dan visualisasi interaktif dalam satu dashboard.