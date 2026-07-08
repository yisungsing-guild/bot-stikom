# Production Setup (Siap Pakai di Domain)

Dokumen ini menyatukan langkah deploy yang paling “langsung jalan” untuk:
- Admin UI (Next.js static export) + API backend
- WhatsApp provider (WATI atau Meta Cloud API)
- RAG/Training (opsional)
- Upload gambar dari Admin → URL publik `/media/*` → bot kirim gambar

> Prinsip: **1 domain HTTPS** yang melayani UI + API + webhook + media.

---

## 0) Prasyarat

- VPS / server Linux (disarankan Ubuntu 22.04/24.04)
- Domain mengarah ke IP server
- Node.js **>= 20**
- PostgreSQL (lokal) atau Supabase Postgres
- Reverse proxy HTTPS (Nginx/Caddy/Cloudflare) — penting untuk WhatsApp media

---

## 1) Install & Build (di server)

Catatan penting: Admin UI adalah **Next.js static export** (`admin-ui/out`).
Jadi setiap kali Anda melakukan `git pull` (update code), Anda perlu **rebuild Admin UI** supaya tampilan terbaru muncul.

```bash
# di folder project
npm ci --omit=dev

# prisma generate
npm run prisma:generate

# build admin ui (hasilnya: admin-ui/out)
npm --prefix admin-ui ci
npm --prefix admin-ui run build
```

Jika Anda pakai OCR/PDF/image features di server, ikuti checklist di `README_ADMIN.md` dan jalankan:

```bash
npm run diag:ocr:deps
```

---

## 2) Environment Production (wajib)

### 2.1 Buat file env yang aman

Disarankan menyimpan secret di file yang tidak di-commit:

- Copy template: `.env.production` → `.env.production.local`
- Isi nilai sebenarnya di `.env.production.local`

PM2 sudah otomatis memilih `.env.production.local` jika file itu ada.

Jika Anda pernah mengisi `.env.production` langsung di server, `git pull` bisa gagal karena file ini ter-track oleh git.
Solusi aman (tanpa kehilangan secret):

```bash
cd ~/bot-stikom
test -f .env.production.local || cp .env.production .env.production.local

# Kembalikan template .env.production dari git (kalau file ini memang dikenal git)
git restore .env.production 2>/dev/null || git checkout -- .env.production 2>/dev/null || true

# Jika masih gagal (mis. "pathspec did not match" atau tetap menghalangi pull),
# pindahkan file lokalnya. Konfigurasi production sebaiknya disimpan di .env.production.local.
test -f .env.production && mv .env.production .env.production.serverbak.$(date +%F_%H%M%S)

git pull
```

### 2.2 Minimal env yang harus benar

Wajib:
- `DATABASE_URL` (Postgres)
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD` (disarankan bcrypt)
- `PUBLIC_BASE_URL=https://your-domain.com`
- `ALLOWED_ORIGINS=https://your-domain.com` (jika Admin UI dan API 1 domain)

Generate `JWT_SECRET` + hash admin password:

```bash
ADMIN_PASSWORD_PLAIN="PasswordKuatKamu" node src/scripts/generateSecrets.js
```

Copy output `JWT_SECRET="..."` dan `ADMIN_PASSWORD="..."` ke `.env.production.local`.

### 2.3 (Opsional) Gaya bahasa Tiko (lebih natural)

Kalau ingin Tiko terdengar seperti asisten virtual (lebih santai, pakai "aku/kamu", dan boleh emoji secukupnya), set di `.env.production.local`:

```env
BOT_TONE="casual"

# Opsional (contoh yang kamu minta)
BOT_FRIENDLY_OPENING="Siap! Aku bantu ya 👍"
BOT_FRIENDLY_CLOSING="Kalau masih bingung, bilang aja—aku bantu lagi 😊"
```

Catatan:
- Saat `BOT_TONE=casual` aktif, beberapa pesan template (menu & pesan cepat "cek dulu ya" saat proses lama) ikut menyesuaikan otomatis.
- Kalau kamu set `BOT_REPLY_TIMEOUT_MESSAGE` custom, pesan timeout akan mengikuti custom itu.

### 2.4 (Opsional) Alias greeting (anggap salam versi friendly)

Kalau kamu ingin pesan tertentu dianggap sebagai **greeting-only** (mis. "Mas bro"), set:

```env
WELCOME_GREETING_ALIASES="mas bro, bro, sis"
```

Catatan:
- Pemisah bisa koma, titik-koma, atau baris baru.
- Tetap konservatif: hanya berlaku untuk pesan greeting saja (tidak mengambil alih pesan panjang seperti "mas bro mau tanya biaya").

---

## 3) Migrasi Database (production)

```bash
npm run migrate:deploy
```

Jika Anda baru pertama deploy dan belum ada schema di DB, pastikan `DATABASE_URL` sudah benar.

---

## 4) Konfigurasi WhatsApp Provider

Sistem mendukung 2 jalur:

### Opsi A — WATI (umum dipakai)

Di `.env.production.local`:
- `WHATSAPP_PROVIDER="wati"`
- `WHATSAPP_API_ENDPOINT="https://...wati..."`
- `WHATSAPP_API_KEY="..."`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN="<random panjang>"`
- `WATI_WEBHOOK_REQUIRE_TOKEN=true`

Webhook inbound yang diterima server:
- `POST /wati/webhook`
- dan juga alias `POST /webhook` (compat)

Rekomendasi agar aman:
- Set callback URL di WATI menjadi:
  - `https://your-domain.com/webhook?token=<WHATSAPP_WEBHOOK_VERIFY_TOKEN>`

### Opsi B — Meta Cloud API (Business)

Di `.env.production.local`:
- `WHATSAPP_PROVIDER="business"`
- `WHATSAPP_API_KEY="EAA..."`
- `WHATSAPP_PHONE_NUMBER_ID="..."`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN="<random panjang>"`

Meta akan memanggil:
- `GET /webhook` (verify)
- `POST /webhook` (incoming)

---

## 5) Aktifkan Outbound Gambar (wajib untuk fitur upload gambar admin)

Di `.env.production.local`:

```env
PUBLIC_BASE_URL=https://your-domain.com
WHATSAPP_ENABLE_OUTBOUND_IMAGES=true
WHATSAPP_MAX_OUTBOUND_IMAGES=1
WHATSAPP_IMAGE_URL_ALLOWLIST=your-domain.com
WHATSAPP_IMAGE_CAPTION_MAX=900
```

Alur gambar:
- Admin upload → server simpan di `uploads/public-media/`
- URL publik: `GET /media/<filename>`
- Marker: `[[image:https://your-domain.com/media/<filename>|Caption]]`

---

## 6) Jalankan Server (PM2)

Install PM2 (sekali saja):

```bash
npm i -g pm2
```

Start:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
```

---

## 7) HTTPS + Reverse Proxy (Nginx)

- Contoh konfigurasi ada di `deploy/nginx.bot.example.conf`.
- Pastikan Nginx meneruskan header:
  - `X-Forwarded-Proto` (supaya server bisa membentuk URL https dengan benar)

Setelah Nginx aktif, pasang TLS (contoh Certbot):

```bash
# contoh (Ubuntu):
# apt-get install -y certbot python3-certbot-nginx
# certbot --nginx -d your-domain.com
```

---

## 8) Verifikasi Cepat (Checklist)

1) Admin UI bisa dibuka:
- `https://your-domain.com/login`

2) Login berhasil:
- `POST /auth/login`

3) Media publik berfungsi:
- Upload 1 gambar dari Admin UI
- Pastikan `GET https://your-domain.com/media/<filename>` bisa dibuka (tanpa token)

4) Bot benar-benar mengirim gambar:
- Buat keyword response yang diawali marker `[[image:...]]`
- Kirim pesan ke bot yang memicu keyword

---

## 9) Opsional: Aktifkan RAG (Training)

Jika ingin RAG:

```env
ENABLE_AI=true
ENABLE_RAG=true
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.2
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Lalu:
- Upload training di halaman Training Data
- (Untuk gambar) simpan training yang mengandung marker gambar; sistem akan auto-attach marker dari context jika jawaban RAG tidak memuat marker.

---

## 10) Referensi Dokumen

- `README_ADMIN.md` (akun admin, deploy PM2, troubleshooting)
- `WHATSAPP_SETUP.md` (provider, webhook, outbound images)
- `SUPABASE_SETUP.md` (database Supabase)
- `SECURITY_IMPROVEMENTS.md` (checklist security)
