# SIG Pantau Tsunami – Sistem Monitoring & Manajemen Evakuasi

## Ringkasan Sistem
SIG Pantau Tsunami adalah aplikasi web **real‑time** yang menampilkan peta interaktif untuk memantau kondisi sensor, sirene, fasilitas darurat, rute evakuasi, zona aman, dan area rendaman. Sistem ini dirancang untuk tiga tipe pengguna utama:

| Peran | Hak Akses | Fungsi Utama |
|------|-----------|--------------|
| **Pengguna (Viewer)** | Membaca data peta | Melihat status sensor, sirene, fasilitas, rute evakuasi, zona aman, dan area rendaman. |
| **Operator** | Mengelola status, melakukan dispatch, mengatur waypoint | - Mengubah status **fasilitas** (aktif / non‑aktif).<br>- Mengubah status **aset** (available, in‑use, maintenance, unavailable).<br>- Mengubah status **rute evakuasi** (clear, warning, congested, blocked, maintenance).<br>- **Dispatch** unit Polisi/Polkesta atau Damkar serta aset berat ke titik tujuan pada peta.<br>- Menentukan **waypoint** dengan klik peta; rute dihitung menggunakan **OSRM** (Open Source Routing Machine) sehingga mengikuti jalan sebenarnya.<br>- Mengedit **area rendaman** (polygon) secara visual. |
| **Admin** | Manajemen penuh | - Mengelola semua data master (fasilitas, aset, rute, zona aman, area rendaman).<br>- Mengatur hak akses pengguna.<br>- Melihat log aktivitas dan statistik sistem. |

> **Catatan:** Penjelasan backend tidak dibahas di sini; fokus README adalah pada antarmuka, alur kerja, dan peran pengguna.

## Cara Kerja

1. **Pengambilan Data**  
   Frontend memanggil API (`dataApi` & `mapApi`) untuk memperoleh data sensor, sirene, fasilitas, rute evakuasi, zona aman, dan area rendaman. Data ini di‑render pada **React‑Leaflet** map.

2. **Layer Peta**  
   - **Sensors** – Lingkaran berwarna menandakan level perubahan air (`Δ3m`).<br>
   - **Sirene** – Ikon dengan radius visual; warna merah bila aktif.<br>
   - **Facilities** – Ikon sesuai tipe (polisi, damkar, dll) dengan status aktif/non‑aktif.<br>
   - **Heavy Equipment** – Ikon aset berat; warna menandakan status (available, in‑use, maintenance, unavailable).<br>
   - **Evacuation Routes** – Polyline berwarna sesuai status rute.<br>
   - **Safe Zones** – Polygon hijau menandakan area aman.<br>
   - **Inundation Zones** – Polygon berwarna (merah, oranye, kuning) menandakan tingkat risiko rendaman.

3. **Panel Kontrol (Top‑Right)**  
   - **Toggle Layer** – Aktifkan/Non‑aktifkan masing‑masing layer.  
   - **Fokus Fasilitas** – Pilih fasilitas untuk memusatkan peta.  
   - **Fokus & Dispatch Aset** – Pilih aset (polisi, damkar, atau alat berat) untuk dispatch.

4. **Dispatch & Waypoint**  
   - Pilih aset → klik peta untuk menentukan **waypoint**.  
   - Sistem memanggil **OSRM** (`https://router.project-osrm.org`) untuk menghitung rute jalan yang optimal.  
   - Rute ditampilkan sebagai polyline biru, dengan estimasi jarak & waktu.  
   - Tombol **Mulai Perjalanan** memulai animasi unit bergerak di sepanjang rute.

5. **Edit Area Rendaman**  
   - Operator dapat menambah, menghapus, atau mereset titik polygon.  
   - Simpan perubahan melalui API (`dataApi.createInundationZone` / `updateInundationZone`).  

6. **Status & Aksi**  
   - Panel kiri menampilkan **Level Deteksi**, status **Sirene**, dan info pengguna (nama & peran).  
   - Operator dapat mengubah status fasilitas, aset, atau rute langsung dari popup pada peta.  

## Komponen Utama UI

| Komponen | Deskripsi |
|----------|-----------|
| **MapFocusController** | Memusatkan peta pada koordinat yang dipilih (fasilitas, aset, atau waypoint). |
| **MapWaypointSelector** | Menangkap klik peta untuk menentukan tujuan dispatch. |
| **InundationEditModal** | Modal untuk menambah/ubah area rendaman secara interaktif. |
| **Floating Status Panel** | Menampilkan level deteksi, status sirene, dan info pengguna. |
| **Floating Control Panel** | Kontrol layer, fokus fasilitas, dan pemilihan aset untuk dispatch. |
| **Dispatch Action Banner** | Menampilkan detail dispatch, estimasi, dan kontrol animasi. |
| **Layer Popups** | Menyajikan informasi detail (nama, tipe, status, catatan) serta aksi (ubah status, dispatch). |

## Alur Kerja Operator (Contoh)

1. **Masuk** sebagai operator → UI menampilkan panel status.  
2. **Ubah status** fasilitas (mis. menonaktifkan pos polisi yang rusak).  
3. **Pilih aset** (mis. unit damkar) pada dropdown “Dispatch Aset”.  
4. **Klik peta** pada lokasi kebakaran → sistem menghitung rute via OSRM.  
5. **Tekan “Mulai Perjalanan”** → animasi unit bergerak, menampilkan progres.  
6. **Selesai** → unit tiba di waypoint, operator dapat reset atau dispatch baru.

## Pengembangan & Deploy

- **Build Frontend**: `npm run build` menghasilkan folder `build/` siap disajikan oleh server statis.  
- **Deploy**: Gunakan `serve -s build` atau integrasikan ke Docker/Kubernetes sesuai kebutuhan.  
- **Repositori**: Semua perubahan disimpan di GitHub (`https://github.com/rayonfent/SIG-Pantau_Tsunami`).  

---

*Dokumentasi ini memberikan gambaran lengkap tentang cara kerja sistem, peran masing‑masing pengguna, serta interaksi UI yang tersedia.*