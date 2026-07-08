# 🚀 Panduan Setup Lokal Step-by-Step

**Status Saat Ini (12 Mei 2026):**
- ✅ Server dev running: `http://localhost:4000`
- ✅ Ngrok aktif: `https://undelinquent-jovita-radishlike.ngrok-free.dev`
- ✅ Database: Supabase (production)
- ✅ Redis: Upstash (production)
- ✅ Provider: WATI

---

## 📋 LANGKAH-LANGKAH LENGKAP

### **FASE 1: SETUP AWAL (Sudah Selesai ✓)**

#### 1.1 Install Dependencies
```powershell
npm install --no-audit --no-fund
```
- Menginstall semua package dari `package.json`
- Prisma client di-generate otomatis (scripts/postinstall.js)
- Patch untuk OpenAI di-apply via patch-package

**Status**: ✅ SELESAI

---

#### 1.2 Buat File .env
```powershell
# Jika belum ada, copy dari template
Copy-Item .env.example .env
```

**File `.env` sudah ada dengan konfigurasi production:**
- `DATABASE_URL`: Supabase PostgreSQL
- `UPSTASH_REDIS_REST_URL/TOKEN`: Redis cache
- `OPENAI_API_KEY`: AI engine
- `WHATSAPP_PROVIDER`: "wati" (mode WATI aktif)
- `ADMIN_USERNAME/PASSWORD`: Placeholder (ganti nanti)

**Status**: ✅ SELESAI

---

#### 1.3 Jalankan Server Dev
```powershell
npm run dev
# atau
npm start
```

**Server berjalan di:**
- URL lokal: `http://localhost:4000`
- Port: 4000 (listening)
- Mode: Production (NODE_ENV="production" di .env)
- Provider: WATI (auto-detect dari config)

**Status**: ✅ RUNNING (jangan tutup terminal!)

---

### **FASE 2: SETUP NGROK UNTUK WEBHOOK PUBLIK** 

#### 2.1 Jalankan Ngrok (Sudah Aktif)
```powershell
.\ngrok-v3-stable-windows-amd64\ngrok.exe http 4000
```

**Ngrok URL publik Anda:**
```
https://undelinquent-jovita-radishlike.ngrok-free.dev
```

**Status**: ✅ RUNNING (jangan tutup terminal!)

---

#### 2.2 Pahami Routing Webhook

**Endpoint webhook di server:**
- `POST /wati/webhook` ← UTAMA (WATI mode)
- `POST /webhook` ← Alternative (untuk compatibility)
- `POST /provider/webhook` ← Provider umum

**Mapping URL:**
| Type | URL |
|------|-----|
| **Lokal** (dev testing) | `http://localhost:4000/wati/webhook` |
| **Publik** (WATI production) | `https://undelinquent-jovita-radishlike.ngrok-free.dev/wati/webhook` |

**Status**: ✅ READY

---

### **FASE 3: KONFIGURASI WEBHOOK WATI**

#### 3.1 Login ke Dashboard WATI
1. Buka: https://business.wati.io/
2. Login dengan akun WATI Anda
3. Navigasi ke **Settings** → **Webhooks**

**Status**: ❓ TERGANTUNG ANDA

---

#### 3.2 Setup Webhook di WATI
Buka pengaturan webhook WATI dan atur:

**Field 1: Webhook URL**
```
https://undelinquent-jovita-radishlike.ngrok-free.dev/wati/webhook
```

**Field 2: Webhook Verify Token**
```
Lihat di .env: WHATSAPP_WEBHOOK_VERIFY_TOKEN
Saat ini: (kosong/placeholder)
```

Jika kosong, Anda bisa:
- Option A: Set di .env dan restart server
- Option B: Kosongkan di WATI juga (jika tidak perlu token)

**Field 3: Event Subscriptions**
Pastikan yang aktif:
- ✅ Messages (inbound)
- ✅ Message Status (delivery/read)
- ✅ (Optional) Conversations

**Status**: 📋 TODO (tergantung akses WATI Anda)

---

#### 3.3 Test Webhook Connection
Setelah setup di WATI, trigger test:

**Via WATI Dashboard:**
- Klik tombol "Test Webhook" atau "Send Test Event"
- Lihat apakah server receive (cek server logs)

**Via Manual Testing:**
```powershell
# Test endpoint dengan curl
$headers = @{
    "Content-Type" = "application/json"
}
$body = @{
    "chatId" = "test-123"
    "text" = "Hello from local test"
    "messageId" = "msg-001"
    "ts" = [int][double]::Parse((Get-Date -UFormat %s)) * 1000
} | ConvertTo-Json

curl.exe -X POST `
  https://undelinquent-jovita-radishlike.ngrok-free.dev/wati/webhook `
  -H $headers `
  -Body $body
```

**Respons sukses:**
```json
{
  "ok": true,
  "deduped": false
}
```

**Status**: 🔄 NEXT

---

### **FASE 4: TESTING & DEBUGGING**

#### 4.1 Monitor Server Logs
**Terminal server dev (jangan tutup):**
```
[ProviderRoute] POST /provider/webhook received { chatId, text, messageId, inboundTs }
```

---

#### 4.2 Test Chat Behavior

**Scenario 1: Send Message dari WhatsApp → WATI → Server**
1. Kirim pesan ke nomor WhatsApp Anda (yang ter-setup di WATI)
2. Lihat di server logs apakah webhook diterima
3. Bot harus respond sesuai RAG/AI

**Scenario 2: Cek Webhook Diagnostics**
```powershell
# Lihat diagnostic data webhook
curl.exe http://localhost:4000/admin/whatsapp/webhook-diagnostics
# (perlu token auth)
```

**Status**: 🔄 NEXT

---

### **FASE 5: KONFIGURASI LANJUTAN (Optional)**

#### 5.1 Setup Admin Username & Password
**Di .env, ganti:**
```env
ADMIN_USERNAME="admin_name_anda"
ADMIN_PASSWORD="password_kuat_anda"
# atau bcrypt hash (lebih aman untuk production)
```

**Generate bcrypt password:**
```powershell
node -e "console.log(require('bcryptjs').hashSync('password_anda', 10))"
```

Kemudian copy hasil hash ke `ADMIN_PASSWORD=` di .env dan restart server.

**Status**: 🔄 OPTIONAL

---

#### 5.2 Setup Webhook Token (Security)
**Di .env:**
```env
PROVIDER_WEBHOOK_TOKEN="random-secret-token-anda"
```

Kemudian di WATI, pass header:
```
Authorization: Bearer random-secret-token-anda
```

atau query param:
```
POST /wati/webhook?token=random-secret-token-anda
```

**Status**: 🔄 OPTIONAL (tapi recommended untuk production)

---

### **FASE 6: PRODUCTION DEPLOYMENT KE VPS**

Ketika VPS sudah aktif:

#### 6.1 Siapkan VPS
- Install Node.js, PostgreSQL (atau connect ke Supabase)
- Setup SSL/TLS certificate (Let's Encrypt)
- Setup Reverse Proxy (Nginx)

#### 6.2 Disable Ngrok, Update WHATSAPP_WEBHOOK_URL
```env
# Hapus ngrok URL
WHATSAPP_WEBHOOK_URL=""

# Ganti dengan domain VPS Anda
WHATSAPP_WEBHOOK_URL="https://your-domain.com"
```

#### 6.3 Deploy ke VPS
```powershell
# Di VPS
git clone https://github.com/geniastrawirabhuana/bot-stikom.git
cd bot-stikom
npm install
npm run dev
# atau pakai PM2 untuk production
```

#### 6.4 Update WATI Webhook URL
```
Dari: https://undelinquent-jovita-radishlike.ngrok-free.dev/wati/webhook
Ke:   https://your-domain.com/wati/webhook
```

**Status**: 🔄 LATER (setelah VPS active)

---

## 🎯 **CHECKLIST UNTUK HARI INI**

- [ ] **1. Setup Lokal** ✅ SELESAI
  - [x] npm install
  - [x] .env ready
  - [x] Server running
  - [x] Ngrok running

- [ ] **2. Setup Webhook WATI** 🔄 NEXT
  - [ ] Login WATI dashboard
  - [ ] Input ngrok URL: `https://undelinquent-jovita-radishlike.ngrok-free.dev/wati/webhook`
  - [ ] Set verify token (jika diperlukan)
  - [ ] Save & test

- [ ] **3. Testing** 🔄 AFTER
  - [ ] Kirim test message via WATI
  - [ ] Cek server logs
  - [ ] Verifikasi response bot

---

## 🔗 **USEFUL LINKS**

| Task | URL |
|------|-----|
| **Server Admin UI** | `http://localhost:4000` (perlu login) |
| **Ngrok Dashboard** | `http://127.0.0.1:4040` |
| **WATI Business** | https://business.wati.io/ |
| **Supabase Console** | https://app.supabase.com |
| **Upstash Console** | https://console.upstash.com |

---

## ⚠️ **IMPORTANT NOTES**

1. **Ngrok URL berubah setiap restart** (free plan)
   - Solusi: Upgrade ke ngrok Pro/Plus, atau gunakan static domain
   - Untuk setiap restart, update URL di WATI dashboard

2. **Terminal jangan ditutup**
   - Terminal ngrok & server harus tetap running
   - Jika ditutup, webhook tidak bisa diterima

3. **Database tetap production**
   - Server lokal connect ke Supabase production
   - Hati-hati jangan delete data testing

4. **Git tidak terpengaruh**
   - Branch masih `main`, commit history aman
   - `.env` & `node_modules` adalah gitignore

---

## ❓ **TROUBLESHOOTING**

### Problem: Server tidak respond di port 4000
```powershell
# Cek apakah port sudah dipakai
netstat -ano | findstr :4000

# Jika ada process lain, kill terlebih dahulu
taskkill /F /IM node.exe
```

### Problem: Ngrok URL tidak bisa diakses
```powershell
# Cek ngrok status
curl.exe http://127.0.0.1:4040/api/tunnels

# Jika error, restart ngrok
# Ctrl+C di terminal ngrok, lalu jalankan lagi:
.\ngrok-v3-stable-windows-amd64\ngrok.exe http 4000
```

### Problem: Webhook tidak diterima
1. Cek ngrok URL benar di WATI dashboard
2. Cek server logs (`npm run dev` terminal)
3. Cek token/auth settings
4. Cek firewall/antivirus tidak blocking

---

**Selesai! Apa yang perlu dilakukan sekarang?**
👉 Langkah 3: Setup Webhook WATI
