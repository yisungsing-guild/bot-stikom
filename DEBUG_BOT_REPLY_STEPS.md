# 🔧 DEBUG: Bot Tidak Reply - Step by Step

## 📸 Evidence
Dari screenshot: User mengirim "halo" berkali-kali, bot tidak ada reply.

✅ Sudah di-test:
- Webhook receives: YES (HTTP 200)
- Fonnte API reachable: YES (message queued)
- Config OK: YES

❌ Problem: Bot tidak send reply

---

## 🧪 TEST FLOW - Execute This NOW

### Step 1: Start Server dengan Debug Logging
```bash
npm run dev
```

**Biarkan running, jangan di-stop!**

### Step 2: Trigger Test Webhook (Terminal 2)
```bash
node test-flow-detailed.js
```

### Step 3: Watch Server Console Output
Cari patterns ini dalam order:

#### ✓ Pattern 1: Webhook Terima
```
[Fontte Webhook] incoming
[Fontte Webhook] forwarding to /provider/webhook
```

❌ Jika TIDAK ada:
- Check: `/fonnte/webhook` endpoint not mounted?
- Check: Request tidak sampai?

---

#### ✓ Pattern 2: Provider Webhook Terima
```
[ProviderRoute] POST /provider/webhook received
```

❌ Jika TIDAK ada:
- forwardToProvider() gagal send
- PROVIDER_WEBHOOK_TOKEN mismatch?
- Cek error log dari axios

---

#### ✓ Pattern 3: Session Processing
```
[ProviderRoute] Processing...
Session lookup
```

❌ Jika TIDAK ada:
- Code hanging di early stage?
- Check: Database timeout?

---

#### ✓ Pattern 4: Bot Message Generation
```
[sendBotMessageRaw]
[ProviderRoute] Generated reply
```

❌ Jika TIDAK ada:
- FSM engine tidak generate reply?
- Check: Keyword matching, RAG engine

---

#### ✓ Pattern 5: Send to Fonnte
```
[WhatsAppBusiness] ✓ Pesan terkirim via Fonnte
```

❌ Jika TIDAK ada:
- provider.sendMessage() never called
- atau error sending

---

## 🎯 Most Likely Issues

### Issue A: Pattern 1 & 2 missing
**Problem:** Webhook not forwarding properly

**Fix:**
```bash
node diagnose-bot-reply.js
```
Check if PROVIDER_WEBHOOK_TOKEN is set correctly.

---

### Issue B: Pattern 1-3 exist, but 4-5 missing
**Problem:** Bot engine not generating reply

**Why:**
- FSM not initialized?
- Session data corrupted?
- Rule engine disabled?

**Check in code:**
- `src/engine/fsm.js` - FSM logic
- `src/engine/replyEngine.js` - Keyword matching
- `src/engine/ragEngine.js` - RAG disabled?

**Check environment:**
```bash
grep -i "DISABLE_" .env
# Should NOT disable FSM, keyword rules
```

---

### Issue C: All patterns exist but reply not reach user
**Problem:** Fonnte API accepted but didn't deliver

**Check:**
- Fonnte dashboard for delivery status
- Check phone number format
- Check account balance

---

## 📝 Log Extraction Commands

### Get full log with timestamps
```bash
npm run dev 2>&1 | tee server.log
# Then grep:
grep "ProviderRoute\|sendBotMessage\|WhatsAppBusiness" server.log
```

### Watch live (PowerShell)
```powershell
npm run dev | Select-String "ProviderRoute|sendBotMessage|WhatsAppBusiness|ERROR"
```

### Or use grep with color
```bash
npm run dev 2>&1 | grep --color=always -E "ProviderRoute|sendBotMessage|WhatsAppBusiness|ERROR|error"
```

---

## 📸 SCREENSHOT THIS

When you run `npm run dev`, then `node test-flow-detailed.js`:

1. Take screenshot of ALL console output
2. Include both start messages and any error
3. Share it

This will show exactly where flow stops.

---

## 🆘 If All Logs Look OK

If you see all 5 patterns but bot still not reply:

1. **Check Fonnte Dashboard**
   - Is message in "Sent" or "Failed"?
   - Check delivery status

2. **Check phone number**
   - Must be valid format: 62... (not 0...)
   - Must have verified WhatsApp number

3. **Check account**
   - Sufficient balance?
   - Account not suspended?

---

## ⏭️ NEXT ACTION

```bash
# Terminal 1
npm run dev

# Wait 5 seconds for server to start

# Terminal 2
node test-flow-detailed.js

# Terminal 1: Watch for logs
# Take screenshot of console output
# Share the screenshot
```

Then we can identify exactly where the problem is!
