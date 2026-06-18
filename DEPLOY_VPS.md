# Deploy SIG-PANTAU TSUNAMI ke VPS Murah

Panduan ini untuk deploy aplikasi SIG-PANTAU TSUNAMI ke internet menggunakan:

- VPS Ubuntu Server
- Docker Compose
- PostgreSQL + PostGIS
- FastAPI backend
- React frontend production build
- Caddy reverse proxy + SSL otomatis

Target akhir:

```text
https://domain-kamu.my.id
```

---

## 1. Rekomendasi VPS

Pilih VPS dengan spesifikasi:

```text
OS       : Ubuntu Server 22.04 LTS
RAM      : minimal 2 GB
CPU      : minimal 1 vCPU
Storage  : minimal 20 GB SSD
```

Rekomendasi provider:

```text
Hostinger VPS
IDCloudHost VPS
Niagahoster VPS
Biznet Gio
Rumahweb VPS
```

Untuk project kuliah/demo, paket RAM 2GB sudah cukup.

---

## 2. Rekomendasi domain

Untuk murah:

```text
.my.id
```

Contoh:

```text
sigtsunami.my.id
pantautsunami.my.id
sig-pantau-tsunami.my.id
```

---

## 3. Arahkan DNS domain ke VPS

Masuk ke panel DNS domain, buat record:

```text
Type : A
Name : @
Value: IP_VPS_KAMU
TTL  : Auto
```

Opsional untuk `www`:

```text
Type : A
Name : www
Value: IP_VPS_KAMU
TTL  : Auto
```

Tunggu propagasi DNS beberapa menit sampai beberapa jam.

Cek dari komputer lokal:

```bash
ping domain-kamu.my.id
```

Pastikan IP yang muncul adalah IP VPS.

---

## 4. Login ke VPS

Dari terminal lokal:

```bash
ssh root@IP_VPS_KAMU
```

Kalau username bukan `root`, gunakan username dari provider.

---

## 5. Install Docker, Docker Compose, dan Git

Di VPS Ubuntu:

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl gnupg git ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Cek instalasi:

```bash
docker --version
docker compose version
```

---

## 6. Setup firewall

Buka hanya port SSH, HTTP, dan HTTPS:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

---

## 7. Clone project dari GitHub

```bash
git clone https://github.com/rayonfent/SIG-Pantau_Tsunami.git
cd SIG-Pantau_Tsunami
```

Kalau nama folder hasil clone berbeda, masuk ke folder project yang berisi `docker-compose.prod.yml`.

---

## 8. Buat file `.env` production

Copy template:

```bash
cp .env.production.example .env
```

Edit:

```bash
nano .env
```

Ubah minimal bagian ini:

```env
DOMAIN=domain-kamu.my.id
ACME_EMAIL=emailkamu@example.com

PUBLIC_APP_URL=https://domain-kamu.my.id
PUBLIC_WS_URL=wss://domain-kamu.my.id

POSTGRES_PASSWORD=password_database_yang_kuat
DATABASE_URL=postgresql+asyncpg://tsunami:password_database_yang_kuat@db:5432/sig_tsunami
SECRET_KEY=secret_key_panjang_random
```

Penting:
- `POSTGRES_PASSWORD` harus sama dengan password di `DATABASE_URL`
- `DOMAIN` jangan pakai `https://`
- `PUBLIC_APP_URL` wajib pakai `https://`
- `PUBLIC_WS_URL` wajib pakai `wss://`

Contoh:

```env
DOMAIN=sigtsunami.my.id
PUBLIC_APP_URL=https://sigtsunami.my.id
PUBLIC_WS_URL=wss://sigtsunami.my.id
```

---

## 9. Jalankan aplikasi production

Build dan jalankan container:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Cek status:

```bash
docker compose -f docker-compose.prod.yml ps
```

Cek log:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

Kalau Caddy berhasil, SSL HTTPS akan dibuat otomatis.

---

## 10. Test aplikasi

Buka:

```text
https://domain-kamu.my.id
```

Test backend health:

```text
https://domain-kamu.my.id/api/health
```

Test dokumentasi API:

```text
https://domain-kamu.my.id/docs
```

Kalau semua benar:
- frontend React tampil
- API health mengembalikan status OK
- docs FastAPI terbuka

---

## 11. Perintah operasional penting

### Melihat container

```bash
docker compose -f docker-compose.prod.yml ps
```

### Melihat log semua service

```bash
docker compose -f docker-compose.prod.yml logs -f
```

### Melihat log backend saja

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

### Restart aplikasi

```bash
docker compose -f docker-compose.prod.yml restart
```

### Stop aplikasi

```bash
docker compose -f docker-compose.prod.yml down
```

### Update dari GitHub

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 12. Backup database

Backup database ke file SQL:

```bash
docker exec sig_tsunami_db_prod pg_dump -U tsunami sig_tsunami > backup_sig_tsunami.sql
```

Restore database:

```bash
cat backup_sig_tsunami.sql | docker exec -i sig_tsunami_db_prod psql -U tsunami -d sig_tsunami
```

Sebaiknya backup rutin sebelum update besar.

---

## 13. Catatan penting production

### Jangan expose database ke internet

Di `docker-compose.prod.yml`, database tidak membuka port `5432` ke publik. Ini lebih aman.

### Jangan pakai password default

Ubah:

```env
POSTGRES_PASSWORD
SECRET_KEY
```

### Jangan jalankan backend dengan `--reload`

Production compose sudah menjalankan backend tanpa `--reload`.

### Frontend production bukan `npm start`

Production frontend sudah memakai:

```text
npm run build + nginx
```

---

## 14. Troubleshooting

### Domain belum bisa dibuka

Cek DNS:

```bash
ping domain-kamu.my.id
```

Pastikan IP mengarah ke VPS.

Cek port:

```bash
ufw status
```

Pastikan `80/tcp` dan `443/tcp` terbuka.

---

### SSL gagal dibuat

Cek log Caddy:

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

Penyebab umum:
- DNS belum mengarah ke VPS
- port 80/443 tertutup
- domain salah di `.env`
- domain memakai proxy/CDN yang belum benar

---

### Backend error database

Cek log backend:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

Cek log database:

```bash
docker compose -f docker-compose.prod.yml logs -f db
```

Pastikan password di `DATABASE_URL` sama dengan `POSTGRES_PASSWORD`.

---

### Frontend tidak bisa akses API

Pastikan `.env`:

```env
PUBLIC_APP_URL=https://domain-kamu.my.id
```

Lalu rebuild frontend:

```bash
docker compose -f docker-compose.prod.yml up -d --build frontend
```

---

## 15. Ringkasan pilihan paling cocok

Untuk project ini, rekomendasi deployment:

```text
Provider : Hostinger VPS / IDCloudHost VPS
OS       : Ubuntu Server 22.04 LTS
RAM      : 2 GB
Domain   : .my.id
Deploy   : Docker Compose + Caddy
```

Arsitektur:

```text
Internet
  ↓
Caddy HTTPS
  ↓
React Frontend + FastAPI Backend + PostGIS Database
```
