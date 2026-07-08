# 🚀 SETUP LENGKAP: Bot Real WhatsApp Reply

## ❌ Masalah Sekarang
- Local test works (node test-flow-detailed.js ✓)
- Real WhatsApp tidak reply ✗
- **Penyebab:** ngrok tidak running → server tidak accessible dari internet → Fonnte tidak bisa send webhook

---

## 📋 SETUP CHECKLIST

### ✓ Step 1: Start ngrok (Internet Tunnel)

ngrok membuat server lokal Anda accessible dari internet sehingga Fonnte bisa send webhook.

**Terminal 1 (ngrok):**
```bash
ngrok http 4000
```

**Expected output:**
```
ngrok by @inconshrevable

Session Status: online
Version: 3.x.x
Region: jp, ap, au (depending on location)

Web Interface: http://127.0.0.1:4040
Forwarding: https://xxxxxxxx-xx.ngrok.io -> http://localhost:4000
```

**Copy the "Forwarding" URL** (looks like `https://xxxxxxxx-xx.ngrok.io`)

❌ **Important:** Don't close this terminal!

---

### ✓ Step 2: Start Bot Server

**Terminal 2 (bot server):**
```bash
npm run dev
```

**Expected output:**
```
[Server] Listening { port: 4000 ... }
[Server] ✓ WhatsApp Provider: Fonnte (production)
```

❌ **Important:** Don't close this terminal!

---

### ✓ Step 3: Get Webhook URL

**Terminal 3 (run this):**
```bash
node check-webhook-url.js
```

**Output should show:**
```
✓ ngrok tunnel ACTIVE
  Public URL: https://xxxxxxxx-xx.ngrok.io
  
📝 Fonnte webhook URLs to configure:
   Option A (preferred):
   https://xxxxxxxx-xx.ngrok.io/fonnte/webhook
```

**Copy this URL** (you'll need it in next step)

---

### ✓ Step 4: Configure Fonnte Dashboard

Go to **https://dashboard.fonnte.com**

1. **Find "Webhook" settings** (usually in Settings > Integration > Webhook)

2. **Set these values:**
   ```
   Webhook URL: https://xxxxxxxx-xx.ngrok.io/fonnte/webhook
   ```

3. **Add Headers (if token required):**
   - Header name: `x-webhook-token`
   - Header value: (from WHATSAPP_WEBHOOK_VERIFY_TOKEN in .env)

4. **Select events to receive:**
   - ✓ Incoming Messages (required)
   - ✓ Message Status (optional)

5. **Test webhook** (usually button in Fonnte dashboard)
   - Should show HTTP 200 or 201

6. **Save**

---

### ✓ Step 5: Test Real Message

1. **Open WhatsApp**
2. **Send message to bot number**
3. **Watch Terminal 2 (npm run dev) for logs:**
   ```
   [Fontte Webhook] incoming
   [ProviderRoute] POST /provider/webhook received
   [sendBotMessageRaw]
   [WhatsAppBusiness] ✓ Pesan terkirim via Fonnte
   ```

4. **If you see logs → bot is replying!**
5. **Check WhatsApp for reply message**

---

## 🔧 TERMINAL SETUP (3 Terminals)

Run these in 3 separate terminal windows:

**Terminal 1 - ngrok tunnel:**
```bash
ngrok http 4000
# Keep running! Don't close!
```

**Terminal 2 - Bot server:**
```bash
npm run dev
# Keep running! Don't close!
```

**Terminal 3 - Check URL (run once):**
```bash
node check-webhook-url.js
# Get webhook URL from output
```

**Then configure Fonnte dashboard with webhook URL from Terminal 3**

---

## 🆘 Troubleshooting

### Problem: ngrok not found

**Solution:** Install ngrok globally
```bash
npm install -g ngrok
# or download from https://ngrok.com/download
```

---

### Problem: "ngrok not in PATH"

**Solution:** Download from https://ngrok.com/download and run:
```bash
# Windows
ngrok.exe http 4000

# Or add to system PATH
```

---

### Problem: Port 4000 already in use

**Solution:** Kill process on port 4000
```powershell
# PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess | Stop-Process

# Or use different port:
PORT=5000 npm run dev
# Then in ngrok:
ngrok http 5000
```

---

### Problem: Fonnte webhook still not received

**Checklist:**
- [ ] ngrok running? (Terminal 1 should show "Session Status: online")
- [ ] Bot server running? (Terminal 2 should show "Listening")
- [ ] Webhook URL in Fonnte dashboard correct? (exactly like Terminal 3 output)
- [ ] Headers set correctly? (if token required)
- [ ] Fonnte webhook saved/active? (check dashboard)
- [ ] Phone number WhatsApp Business verified? (in Fonnte account)
- [ ] Bot account has balance? (check Fonnte account)

---

## 📝 Quick Command Reference

```bash
# Check webhook URL (after ngrok + server running)
node check-webhook-url.js

# Test webhook manually
node test-flow-detailed.js

# Test Fonnte API directly
node test-fonnte-send.js

# Debug configuration
node diagnose-bot-reply.js

# Monitor logs
npm run dev 2>&1 | grep -E "ProviderRoute|sendBotMessage|Fonnte|error"
```

---

## ✨ Success Indicators

✓ Logs show `[ProviderRoute] POST /provider/webhook received`
✓ Logs show `[WhatsAppBusiness] ✓ Pesan terkirim via Fonnte`
✓ WhatsApp shows reply message
✓ No 401/403 errors in logs

---

## 🎯 START HERE

```bash
# Terminal 1
ngrok http 4000

# Terminal 2
npm run dev

# Terminal 3
node check-webhook-url.js
# Copy URL from output

# Then configure Fonnte dashboard
```

Done! 🎉
