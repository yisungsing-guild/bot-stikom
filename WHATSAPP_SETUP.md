# WhatsApp Business API Integration Setup Guide

## Overview

Sistem ini mendukung integrasi dengan WhatsApp Business API (Meta Cloud API) untuk menghubungkan bot ke WhatsApp secara langsung.

**Dua mode provider tersedia:**
- ✅ **Mock Mode** (default) - Untuk development/testing tanpa WhatsApp real
- 🚀 **Business Mode** - Integrasi real dengan WhatsApp Business API

---

## Mengirim Gambar (Outbound Media)

Sistem sudah mendukung **kirim gambar + teks jawaban** (image message) selama gambar tersedia via **URL publik (HTTPS)**.

### Cara trigger (di jawaban bot)

Gunakan salah satu marker berikut di teks jawaban bot:

- Marker custom:
  - `[[image:https://domain.com/path/gambar.jpg|Caption singkat]]`
- Markdown image:
  - `![Caption singkat](https://domain.com/path/gambar.jpg)`

Jika marker valid, bot akan mengirim **gambar terlebih dahulu**, lalu mengirim **teks jawabannya** (marker akan dihapus dari teks).

### Upload gambar dari Admin Panel (tanpa hosting sendiri)

Sekarang admin bisa **upload gambar langsung** (tanpa perlu upload ke CDN/hosting terpisah). Sistem akan:
- menyimpan file ke folder publik `uploads/public-media/`
- menyediakan URL publik via endpoint static `GET /media/<filename>`
- mengembalikan `url` + `marker` siap pakai

Endpoint:
- `POST /admin/media/upload` (multipart form)
  - field file: `file`
  - optional: `caption`

Contoh (curl):

```bash
curl -X POST https://domainkamu.com/admin/media/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "caption=Brosur" \
  -F "file=@./brosur.jpg"
```

Response akan berisi (contoh):

```json
{
  "ok": true,
  "url": "https://domainkamu.com/media/1700000000000_brosur.jpg",
  "marker": "[[image:https://domainkamu.com/media/1700000000000_brosur.jpg|Brosur]]"
}
```

Marker tersebut bisa langsung ditempel ke:
- **Keyword Response** (agar keyword mengirim gambar)
- **Training Data (RAG)** (agar konteks RAG bisa memicu pengiriman gambar)

Catatan keamanan:
- Folder publik hanya `uploads/public-media/` (bukan seluruh `uploads/`).
- Simpan hanya gambar yang memang aman untuk diakses publik.

### Konfigurasi (opsional tapi direkomendasikan)

Env vars:

```env
WHATSAPP_ENABLE_OUTBOUND_IMAGES=true
WHATSAPP_MAX_OUTBOUND_IMAGES=1
WHATSAPP_IMAGE_URL_ALLOWLIST=cdn.domainkamu.com,storage.googleapis.com
WHATSAPP_IMAGE_CAPTION_MAX=900
```

Catatan:
- `WHATSAPP_IMAGE_URL_ALLOWLIST` jika diisi, bot hanya akan mengirim gambar dari domain tersebut (lebih aman).

### Konfigurasi URL publik (penting untuk production)

WhatsApp umumnya membutuhkan URL gambar yang bisa diakses publik dan **HTTPS**. Untuk memastikan URL yang dikembalikan dari upload selalu benar (terutama jika server di belakang reverse proxy), set:

```env
PUBLIC_BASE_URL=https://domainkamu.com
```

Jika `PUBLIC_BASE_URL` tidak diset, sistem akan mencoba membentuk base URL dari request (`host` + `x-forwarded-proto`).

### Setting untuk “Form pendaftaran” (agar otomatis kirim gambar)

Kalau Anda set URL gambar form pendaftaran, maka saat user masuk flow “mau daftar” (S1/S2) bot akan otomatis kirim gambar form + teks ringkas.

- Key setting: `admission_form_image_url`
- Isi value: URL publik HTTPS ke gambar form (mis. JPG/PNG).

Contoh set via API:

```bash
curl -X POST http://localhost:4000/admin/settings \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"admission_form_image_url","value":"https://cdn.domainkamu.com/form-pendaftaran.jpg"}'
```

### Test manual kirim gambar

```bash
node scripts/testWatiSendImage.js 62812xxxxxxx https://cdn.domainkamu.com/form.jpg "Caption test"
```

Mode provider:
- **Business (Meta Cloud API)**: akan mengirim image message asli.
- **WATI**: default fallback kirim URL sebagai text (biasanya muncul preview). Jika ingin coba endpoint media WATI, set `WATI_ENABLE_MEDIA_SEND=true` dan sesuaikan `WATI_SEND_IMAGE_PATH`/param bila perlu.

---

## Quick Start (Development)

### 1. Konfigurasi saat ini

```
WHATSAPP_PROVIDER="mock"      # Development default
```

Bot akan menerima pesan simulasi. Tidak perlu API key.

### 2. Test dengan Mock Provider

```bash
# POST ke /provider/webhook dengan format:
{
  "chatId": "628123456789",    # Nomor WhatsApp lengkap (62 untuk Indonesia)
  "text": "Halo bot!"           # Pesan yang akan diproses
}
```

Respons akan diproses sesuai keywords yang dikonfigurasi di admin panel.

---

## Production Setup (WhatsApp Business API)

### Step 1: Buat Facebook App

1. Kunjungi https://developers.facebook.com
2. Buat "New App" dengan tipe **Business**
3. Di App Dashboard, tambahkan produk **WhatsApp**
4. Pilih **Cloud API** (bukan On-Premises)

### Step 2: Setup WhatsApp Business Account

1. Di WhatsApp Settings > Getting Started
2. Pilih atau buat **WhatsApp Business Account**
3. Verifikasi nomor telepon bisnis Anda
4. Tunggu approval (biasanya instant untuk nomor verified)

### Step 3: Dapatkan Credentials

Dari WhatsApp Settings > API Setup, ambil:

- **Access Token**: 
  - Klik "Generate Token"
  - Format: `EAAx...` (long-lived token priority)
  
- **Phone Number ID**: 
  - Dari "Numbers" section
  - Format: `11234567890123`

- **Business Account ID** (optional):
  - Dari Account Overview
  - Format: `123456789123456`

### Step 4: Konfigurasi Environment

Update file `.env`:

```env
WHATSAPP_PROVIDER="business"
WHATSAPP_API_KEY="EAAx...your-long-lived-token-here...zXW"
WHATSAPP_PHONE_NUMBER_ID="11234567890123"
WHATSAPP_BUSINESS_ACCOUNT_ID="123456789123456"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="my_secure_webhook_token_12345"
WHATSAPP_WEBHOOK_URL="https://yourdomain.com/webhook"
```

### Step 5: Setup Webhook (untuk receive pesan)

#### A. Generate Webhook URL (untuk Production)

Untuk production dengan domain real:
```
https://yourdomain.com/webhook
```

Untuk development lokal, gunakan **ngrok**:

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 4000

# Output:
# Forwarding https://abc123.ngrok.io -> http://localhost:4000
```

URL webhook: `https://abc123.ngrok.io/webhook`

#### B. Register Webhook di Facebook

1. Login ke Facebook Developers
2. Buka App > Settings > Basic
3. Copy App ID dan App Secret
4. Dashboard > WhatsApp > Configuration
5. Di bagian "Webhooks":
   - **Callback URL**: `https://yourdomain.com/webhook` (atau ngrok URL)
   - **Verify Token**: `my_secure_webhook_token_12345` (harus match di .env)
   - Klik "Verify and Save"

#### C. Subscribe ke Events

Di bagian "Webhook fields":
- ✓ messages
- ✓ message_status
- ✓ message_template_status_update (opsional)

Klik "Subscribe"

### Step 6: Test Koneksi

#### Via Admin Panel API:

```bash
# 1. Check current config
curl http://localhost:4000/admin/whatsapp/config \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 2. Test connection ke WhatsApp API
curl -X POST http://localhost:4000/admin/whatsapp/health \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Expected Success Response:
{
  "healthy": true,
  "phoneNumberId": "11234567890123",
  "displayPhoneNumber": "+6281234567890",
  "verifiedName": "My Bot Business"
}
```

#### Via WhatsApp:
1. Kirim pesan ke nomor bot Anda dari any mobile
2. Seharusnya menerima welcome message (jika configured)
3. Bot akan memproses keyword dan mengirim reply otomatis

### Step 7: Restart Server

```bash
# Stop
Ctrl+C atau Get-Process node | Stop-Process -Force

# Start
npm run dev
```

Console output should show:
```
[Server] WhatsApp Provider: Business API (production)
[Server] Listening on port 4000
```

---

## Production Setup (WATI)

Jika Anda menggunakan **WATI** (bukan Meta Cloud API langsung), server akan menerima inbound webhook di:
- `POST /wati/webhook`
- dan juga alias `POST /webhook` (compat, banyak setup WATI pakai path ini)

### Konfigurasi environment (WATI)

Di `.env` / `.env.production.local`:

```env
WHATSAPP_PROVIDER="wati"
WHATSAPP_API_ENDPOINT="https://live-mt-server.wati.io/<TENANT_ID>"
WHATSAPP_API_KEY="<WATI_API_KEY>"

# Token untuk mengamankan webhook inbound (recommended)
WHATSAPP_WEBHOOK_VERIFY_TOKEN="<random panjang>"
WATI_WEBHOOK_REQUIRE_TOKEN=true

# Opsional (untuk display di admin UI / dokumentasi)
WHATSAPP_WEBHOOK_URL="https://yourdomain.com/webhook"
```

### Set URL webhook di dashboard WATI

Rekomendasi (aman): set callback URL WATI menjadi:

```
https://yourdomain.com/webhook?token=<WHATSAPP_WEBHOOK_VERIFY_TOKEN>
```

Jika Anda tidak ingin token (tidak direkomendasikan), set `WATI_WEBHOOK_REQUIRE_TOKEN=false`.

---

## Production Setup (Fonnte)

Jika Anda menggunakan **Fonnte** sebagai gateway WhatsApp, server akan menerima inbound webhook di:
- `POST /fonnte/webhook`
- dan juga alias `POST /webhook` saat mode Fonnte aktif

### Konfigurasi environment (Fonnte)

Di `.env` / `.env.production.local`:

```env
WHATSAPP_PROVIDER="fonnte"
WHATSAPP_API_ENDPOINT="https://api.fonnte.com"
WHATSAPP_API_KEY="<FONNTE_TOKEN>"

# Opsional: amankan forwarding inbound ke /provider/webhook
PROVIDER_WEBHOOK_TOKEN="<random panjang>"

# Opsional: minta token saat webhook Fonnte dipanggil
FONNTE_WEBHOOK_REQUIRE_TOKEN=true

# URL webhook publik yang diisi di dashboard Fonnte
WHATSAPP_WEBHOOK_URL="https://yourdomain.com/fonnte/webhook"
```

### Set URL webhook di dashboard Fonnte

Rekomendasi: set callback URL Fonnte menjadi:

```
https://yourdomain.com/fonnte/webhook
```

Jika Anda ingin memanggil alias root saat mode Fonnte aktif, server juga menerima:

```
https://yourdomain.com/webhook
```

Pastikan auto read di device Fonnte = ON agar webhook masuk dengan benar.

## API Endpoints untuk WhatsApp Config

### 1. GET /admin/whatsapp/config
Ambil konfigurasi WhatsApp saat ini (tanpa sensitive data)

**Response:**
```json
{
  "provider": "business",
  "phoneNumberId": "***890123",
  "businessAccountId": "***789456",
  "webhookVerifyToken": "my_secure_...",
  "webhookUrl": "https://yourdomain.com/webhook",
  "isConfigured": true
}
```

### 2. POST /admin/whatsapp/config
Update konfigurasi WhatsApp

**Request Body:**
```json
{
  "provider": "business",
  "apiKey": "EAAx...token...",
  "phoneNumberId": "11234567890123",
  "businessAccountId": "123456789123456",
  "webhookVerifyToken": "my_secure_token",
  "webhookUrl": "https://yourdomain.com/webhook"
}
```

### 3. POST /admin/whatsapp/health
Test koneksi ke WhatsApp Business API

**Response (Success):**
```json
{
  "healthy": true,
  "phoneNumberId": "11234567890123",
  "displayPhoneNumber": "+6281234567890",
  "verifiedName": "My Business Name"
}
```

**Response (Error):**
```json
{
  "healthy": false,
  "error": "Invalid access token"
}
```

### 4. GET /admin/whatsapp/webhook-setup
Dapatkan instruksi setup webhook

**Response:**
```json
{
  "instructions": { ... },
  "currentConfig": {
    "webhookUrl": "https://yourdomain.com/webhook",
    "verifyToken": "my_token",
    "environment": "production"
  }
}
```

---

## Incoming Message Handling

Ketika ada pesan masuk dari WhatsApp:

1. **Webhook Receive** (`POST /webhook`)
   - Meta POST pesan ke webhook URL
   - Sistem acknowledge dengan 200 OK dalam 5 detik

2. **Parse Message** 
   - Extract: chatId, text, contact name, timestamp

3. **Bot Processing**
   - Welcome check
   - FSM (menu flow)
   - Rule-based reply (keywords)
   - AI reply (jika enabled)
   - Fallback message

4. **Send Response**
   - Call `provider.sendMessage(chatId, reply)`
   - Emit 'sent' event dengan messageId

5. **Status Tracking**
   - Meta send status: sent → delivered → read
   - Bot track di `Message` table

---

## Message Types Supported

### Text Message
```
User: "Halo bot!"
Bot: "Halo! Ada yang bisa kami bantu?"
```

### Interactive Buttons
```javascript
await provider.sendButtons(chatId, "Pilih opsi:", [
  { label: "Info" },
  { label: "Komplain" }
]);
```

### Template Messages
```javascript
await provider.sendTemplate(chatId, "hello_world");
```

---

## Troubleshooting

### Error: "Invalid access token"
- Check WHATSAPP_API_KEY di .env
- Pastikan token belum expired (gunakan long-lived)
- Regenerate token dari Facebook Developers

### Error: "Webhook failed to verify"
- WHATSAPP_WEBHOOK_VERIFY_TOKEN harus eksak match
- Verify Token di .env harus sama dengan di Facebook
- Test dengan curl:
  ```bash
  curl "http://localhost:4000/webhook?hub.mode=subscribe&hub.verify_token=my_token&hub.challenge=challenge123"
  ```

### Webhook tidak terima pesan
- Pastikan webhook URL accessible dari internet
- Gunakan ngrok untuk development
- Check Facebook Logs (App > Activity Log)
- Verify webhook subscription di Facebook

### Message tidak terkirim
- Check whatsapp/health endpoint
- Verify nomor WhatsApp format (62 untuk Indonesia)
- Check daily message limit (WhatsApp Business memiliki constraints)

---

## Rate Limiting & Best Practices

- **Message Queue**: Bot punya internal queue untuk rate limiting
- **Retry Logic**: Automatic retry 3x dengan exponential backoff untuk rate limit (429)
- **Status Tracking**: Track sent/delivered/read status
- **Session Management**: Maintain session per user untuk context

---

## Migration ke Production

### Saat siap production:

1. **Ganti Mock ke Business**
   ```env
   WHATSAPP_PROVIDER="business"
   ```

2. **Secure Credentials**
   - Jangan commit .env ke git
   - Gunakan env manager (AWS Secrets, HashiCorp Vault)
   - Rotate token regularly

3. **Setup Domain**
   - Ganti ngrok URL dengan domain real
   - Setup SSL/TLS (https)

4. **Monitor**
   - Setup logging aggregation (Sentry, DataDog)
   - Monitor message queue depth
   - Track API rate limits

5. **Backup & Recovery**
   - Backup database regularly
   - Setup redundancy untuk provider

---

## Useful Links

- **WhatsApp Business Cloud API Docs**: https://developers.facebook.com/docs/whatsapp/cloud-api
- **Meta Developer Docs**: https://developers.facebook.com/docs
- **ngrok**: https://ngrok.com
- **WhatsApp Business API Status**: https://status.cloud.facebook.com

---

**Last Updated**: Feb 10, 2026
**Status**: ✅ Ready for Development & Production
