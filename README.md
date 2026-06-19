# SIG Pantau Tsunami – Sistem Informasi Geografis Pemantauan & Manajemen Evakuasi Tsunami

## 1. Tentang Sistem (Apa Itu dan Bagaimana Cara Kerjanya)
**SIG Pantau Tsunami** adalah sebuah platform berbasis *Sistem Informasi Geografis (SIG)* yang dirancang untuk memantau ancaman tsunami secara real-time, memberikan peringatan dini kepada masyarakat, serta menjadi alat kendali komprehensif bagi tim penanggulangan bencana darurat. 

**Bagaimana Sistem Ini Bekerja?**
1. Sistem menerima data telemetri secara berkelanjutan (perubahan tinggi air dan parameter anomali) dari berbagai titik sensor.
2. Ketika terdeteksi anomali batas kritis (misalnya perubahan air > 3 meter), sistem secara otomatis mengeskalasi status peringatan (dari Normal $\rightarrow$ Waspada $\rightarrow$ Siaga $\rightarrow$ Awas).
3. Peta interaktif merender lokasi secara visual, menampilkan area mana yang aman, wilayah rendaman (inundation), lokasi sirene aktif, serta fasilitas terdekat (Posisi kepolisian, pemadam kebakaran, dan alat berat).
4. Command Center (Operator/Admin) menggunakan platform ini untuk mengatur rute evakuasi (misal, memblokir jalan yang rusak), memetakan area bahaya secara instan, serta mengerahkan (dispatch) armada bantuan.
5. Jalur pergerakan dari armada atau proses evakuasi dihitung secara dinamis mengikuti rute jalan aspal sesungguhnya berkat integrasi dengan teknologi **OSRM (Open Source Routing Machine)**.

---

## 2. Fitur-Fitur Utama

- **Pemantauan Geografis Real-Time** 🗺️
  Menampilkan sensor, radius sirene, zona rawan (rendaman), serta zona aman dalam satu peta terpusat (*React-Leaflet*).
- **Sistem Peringatan Dini (Early Warning System)** ⚠️
  Status peringatan dinamis dengan notifikasi visual (Overlay layar merah) dan audio (sirine berbunyi pada peramban web pengguna).
- **Routing & Evakuasi Dinamis dengan OSRM** 🛣️
  Menghitung estimasi jarak, waktu, dan rute jalan raya sebenarnya untuk armada maupun jalur evakuasi masyarakat.
- **Simulasi Pergerakan / Dispatch Aset** 🚒
  Fitur pengerahan armada (Polisi, Damkar, Alat Berat) ke lokasi spesifik. Aset akan bergerak di atas peta sesuai rute jalan yang telah dihitung.
- **Polygon Editor Cepat untuk Area Rendaman** 🖍️
  Menggambar area yang terdampak banjir/rendaman langsung di peta menggunakan klik tetikus.
- **Mode Simulasi & Drill** 🎮
  Sistem memiliki mode simulasi dimana sirine palsu dan kenaikan air palsu dapat dipicu untuk pelatihan kesiapsiagaan (tanpa mengganggu data operasional asli).

---

## 3. Detail Peran, Alur Kerja, dan Komponen UI Pengguna

Sistem ini membagi fungsionalitasnya berdasarkan 3 jenis peran pengguna:

### A. Pengguna Publik (Viewer / Masyarakat Umum)
**Deskripsi:** 
Pengguna yang tidak memerlukan proses login. Portal ini didesain sesederhana mungkin agar informasi mudah dipahami oleh masyarakat dalam keadaan panik/darurat.

**Alur Kerja:**
1. Masyarakat membuka aplikasi web.
2. Membaca **Sistem Informasi Publik Kebencanaan** pada banner paling atas untuk mengetahui status (Normal/Awas).
3. Membuka menu **Jalur Evakuasi** dan **Titik Rawan** untuk mengetahui ke arah mana mereka harus melarikan diri jika terjadi bahaya.
4. Jika sirine fisik berbunyi atau status berubah menjadi "Awas", perangkat masyarakat (HP/PC) akan menampilkan *fullscreen warning overlay* disertai suara peringatan.

**Komponen UI Utama:**
- **Public Portal Layout:** Navigasi atas yang sangat sederhana (Dashboard, Monitoring Peta, Titik Rawan, Fasilitas, Jalur Evakuasi, Peringatan).
- **Public Map View:** Peta murni hanya-baca (Read-only) tanpa tombol manipulasi atau layer kontrol kompleks.
- **Warning Overlay Alert:** Layar peringatan merah penuh yang menutupi aplikasi ketika status krisis terjadi.

---

### B. Operator (Tim Respon Cepat / Command Center)
**Deskripsi:**
Operator adalah pengguna yang sedang bertugas mengawasi monitor di ruang komando. Mereka memiliki kewenangan untuk memanipulasi informasi operasional secara cepat agar masyarakat dan tim di lapangan mendapatkan data terbaru (misal: jika sebuah jembatan runtuh, rute harus segera diblokir di peta).

**Alur Kerja:**
1. **Pemantauan Cepat:** Mengamati panel deteksi (level status air) dan mengaktifkan/menonaktifkan sirine dari *Floating Status Panel* di sisi kiri layar.
2. **Ubah Status Instan:** Jika operator menerima laporan lapangan bahwa rute tertentu macet, operator mengklik garis rute di peta dan mengubah statusnya dari `Clear` menjadi `Congested` atau `Blocked`. Jika fasilitas rusak, statusnya diubah menjadi `Non-aktif`.
3. **Menggambar Area Bencana:** Operator memilih mode tambah area rendaman, kemudian mengklik titik-titik polygon di peta untuk menutupi wilayah yang baru saja terendam air.
4. **Dispatch Penyelamatan (Dispatching):**
   - Operator melihat ada ikon api/darurat di suatu titik.
   - Mengklik tombol **Dispatch Aset**, lalu memilih unit (misalnya Unit Damkar A).
   - Mengklik lokasi bencana di peta (*Waypoint Selector*).
   - Sistem menarik data dari OSRM, menghasilkan rute biru.
   - Operator menekan tombol **"Mulai Perjalanan"**, kemudian animasi pergerakan kendaraan damkar akan terlihat bergeser menyusuri rute jalan menuju titik waypoint.

**Komponen UI Utama:**
- **Floating Status Panel (Kiri):** Indikator nyala sirine, indikator level (Awas/Siaga), dan identitas operator yang login.
- **Floating Control Panel (Kanan Atas):** Alat untuk men-toggle visibilitas setiap tipe layer (menyalakan/mematikan layer fasilitas, sensor, zona aman, dll).
- **MapWaypointSelector & Dispatch Banner:** Komponen untuk menangkap klik titik tujuan di peta, lalu memunculkan banner bawah berisi tombol kontrol animasi armada.
- **InundationEditModal:** Modal fungsionalitas untuk me-*reset*, *undo*, atau menyimpan titik polygon area rendaman yang telah digambar.
- **Layer Popups (Interaktif):** Jendela kecil yang muncul bila klik komponen di peta; pada sisi operator, jendela ini memiliki *dropdown* untuk mengubah status dan menyimpan datanya seketika.

---

### C. Admin (Administrator / Pengelola Instansi)
**Deskripsi:**
Pihak otoritas tertinggi yang mengatur konfigurasi struktural. Jika operator bertugas "saat krisis", admin bertugas "sebelum dan sesudah krisis".

**Alur Kerja:**
1. **Manajemen Data Master (Sebelum Krisis):** Admin masuk ke halaman "Data Master" dan "Fasilitas & Aset". Menambahkan titik sensor baru yang baru saja dipasang di laut, menambahkan rumah sakit baru, serta mendaftarkan armada Polisi/Damkar baru ke dalam database.
2. **Audit dan Evaluasi (Sesudah Krisis):** Admin mengakses halaman "Audit Log" dan "Riwayat" untuk melihat log rinci kapan operator A menyalakan sirine, serta mencetak "Laporan" pasca-bencana.
3. **Simulasi dan Latihan (Drill):** Admin membuka halaman "Simulasi & Drill", menyalakan parameter *Simulation Preview*, lalu memicu peringatan tsunami buatan untuk menguji keandalan sistem dan respons operator dalam latihan rutin.
4. **Manajemen Pengguna:** Menambah akun untuk operator baru atau mencabut akses operator lama dari menu "Pengaturan".

**Komponen UI Utama:**
- **Sidebar Admin Lengkap:** Bilah navigasi vertikal di kiri dengan menu menyeluruh: Dashboard, Deteksi & Alert, Evakuasi, Fasilitas, Status Perangkat, Simulasi, Riwayat, Audit Log, Laporan, Data Master, dan Pengaturan.
- **Tabel Data Terpusat (Data Tables):** Komponen tabel lengkap dengan fitur *Create, Read, Update, Delete (CRUD)*.
- **Simulation Control Panel:** Panel parameter khusus (slider dan toggle) untuk memanipulasi kecepatan air buatan dan sirine buatan.
- **Dashboard Metrik Bencana:** Berbagai grafik (chart) statistik historis kebencanaan dan log uptime alat IoT yang ada di lapangan.