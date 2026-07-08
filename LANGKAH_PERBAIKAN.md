# 🎯 LANGKAH PERBAIKAN - Ikuti Sekarang

## ❌ Masalah Saat Ini
```
Local test: ✓ Kerja
Real WhatsApp: ✗ Tidak reply
```

## ✅ Penyebab
ngrok tidak running → Server tidak accessible dari internet → Fonnte tidak bisa kirim webhook

---

## 🚀 PERBAIKAN - 5 Langkah Mudah

### Langkah 1️⃣: Buka Terminal Pertama (ngrok)

```bash
# Windows: Buka PowerShell baru
ngrok http 4000
```

**Harapan:**
```
Forwarding: https://xxxxxxxx-xx.ngrok.io -> http://localhost:4000
Session Status: online
```

❌ **JANGAN tutup terminal ini!**

---

### Langkah 2️⃣: Buka Terminal Kedua (Bot Server)

```bash
npm run dev
```

**Harapan:**
```
[Server] Listening { port: 4000 ... }
[Server] ✓ WhatsApp Provider: Fonnte (production)
```

❌ **JANGAN tutup terminal ini!**

---

### Langkah 3️⃣: Buka Terminal Ketiga (Get Webhook URL)

```bash
node check-webhook-url.js
```

**Output akan seperti:**
```
✓ ngrok tunnel ACTIVE
  Public URL: https://xxxxxxxx-xx.ngrok.io

📝 Fonnte webhook URLs to configure:
   Option A (preferred):
   https://xxxxxxxx-xx.ngrok.io/fonnte/webhook
```

**COPY URL DARI SINI** → `https://xxxxxxxx-xx.ngrok.io/fonnte/webhook`

---

### Langkah 4️⃣: Masuk Fonnte Dashboard

1. Go to: **https://dashboard.fonnte.com**
2. Login dengan akun Fonnte Anda
3. Cari menu **"Webhook"** atau **"Integration"** atau **"Settings"**

---

### Langkah 5️⃣: Setup Webhook di Fonnte Dashboard

**Find "Webhook URL" field dan isi:**
```
https://xxxxxxxx-xx.ngrok.io/fonnte/webhook
```
(Ganti `xxxxxxxx-xx` dengan nilai dari Langkah 3)

**Jika ada "Headers" field, isi:**
```json
{"x-webhook-token": "your-token-here"}
```

**Klik "Test" atau "Save"**

---

## ✨ SELESAI!

Sekarang **kirim pesan WhatsApp ke bot number**

### 📊 Cek hasil:

**Terminal 2 (npm run dev) akan tampil:**
```
[Fontte Webhook] incoming
[ProviderRoute] POST /provider/webhook received
[sendBotMessageRaw]
[WhatsAppBusiness] ✓ Pesan terkirim via Fonnte
```

**WhatsApp akan menampilkan reply!** ✓

---

## 🆘 Jika Masih Tidak Berfungsi

### Check 1: Pastikan 3 Terminal Running

```bash
# Di Windows, check:
netstat -ano | find ":4040"  # ngrok admin
netstat -ano | find ":4000"  # bot server
```

### Check 2: Fonnte URL Correct?

```bash
# Buka Terminal baru, test:
node test-flow-detailed.js
```

Harapkan HTTP 200 response

### Check 3: Check Logs untuk Error

Di Terminal 2 (npm run dev), cari:
```
ERROR
error
failed
401
403
```

---

## 📝 File Reference

- `SETUP_COMPLETE_FONNTE.md` - Dokumentasi lengkap
- `check-webhook-url.js` - Ambil webhook URL
- `test-flow-detailed.js` - Test webhook
- `test-fonnte-send.js` - Test Fonnte API

---

## 🎯 TL;DR

```bash
# Terminal 1
ngrok http 4000

# Terminal 2
npm run dev

# Terminal 3
node check-webhook-url.js
# Copy URL → Paste ke Fonnte Dashboard

# Then send WhatsApp message
# Should get reply!
```

---

**Start now! Langkah 1️⃣ dulu:**
```bash
ngrok http 4000
```
