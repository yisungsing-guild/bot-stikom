# 🔧 Troubleshooting: Bot Tidak Membalas (Fonnte)

## 📋 Status Diagnostic

Berdasarkan testing yang sudah dilakukan:

✅ **WORKING:**
- Webhook `/fonnte/webhook` menerima pesan dengan status 200
- Fonnte API `https://api.fonnte.com/send` reachable dan menerima pesan
- Provider Fonnte configured (WHATSAPP_PROVIDER=fonnte)
- API Key valid (WHATSAPP_API_KEY set)

❌ **PROBLEM:**
- Bot tidak mengirim reply ke user

## 🔍 Flow Debug

Pesan seharusnya mengikuti flow ini:

```
1. Fonnte API menerima pesan dari user
   ↓
2. Fonnte forward ke webhook server (/fonnte/webhook)
   ↓
3. Server process pesan via provider.js
   ↓
4. Bot engine generate reply (FSM + rules + RAG)
   ↓
5. Provider.sendMessage() kirim balik ke Fonnte
   ↓
6. Fonnte teruskan ke user
```

## 🧪 Langkah Debugging

### Step 1: Cek Server Logs
```bash
npm run dev
```
Lihat untuk log pattern:
- `[ProviderRoute] POST /provider/webhook received` → pesan masuk diterima
- `[WhatsAppBusiness]` atau `[Fonnte]` → provider action
- `[sendBotMessage]` → bot trying to send
- Error messages → cari apa yang gagal

### Step 2: Simulate Inbound Message
```bash
node test-fonnte-webhook.js
```
Ini akan POST dummy pesan ke webhook. Cek di server console apakah terjadi processing.

### Step 3: Check Bot Processing
Di server console, cari:
```
[ProviderRoute] POST /provider/webhook received { chatId: '628...', text: 'Halo bot...' }
```

Jika ada, lanjut ke processing logic.

### Step 4: Check Reply Generation
Cari log yang menunjukkan bot trying to generate reply:
- FSM state machine decision
- Keyword matching result
- RAG query result
- Final reply text

Jika tidak ada, berarti session/state engine tidak jalan.

### Step 5: Check Provider Send
Cari log:
```
[WhatsAppBusiness] ✓ Pesan terkirim via Fonnte
```

Jika tidak ada, berarti sendMessage tidak dipanggil atau gagal.

## 🔧 Possible Issues & Solutions

### A. Webhook tidak menerima pesan dari Fonnte
**Symptom:** Sama sekali tidak ada log webhook
**Solution:**
1. Verify ngrok/tunnel URL in Fonnte dashboard
2. Check FONNTE_WEBHOOK_REQUIRE_TOKEN setting
3. Test dengan `test-fonnte-webhook.js`

### B. Webhook terima, tapi processor tidak berjalan
**Symptom:** Log webhook received, tapi tidak ada [ProviderRoute] log
**Solution:**
1. Check `forwardToProvider()` in fonnteWebhook.js
2. Verify PROVIDER_WEBHOOK_TOKEN matches
3. Check if `/provider/webhook` route mounted properly

### C. Processor berjalan, tapi bot engine tidak generate reply
**Symptom:** Log [ProviderRoute] received tapi tidak ada [sendBotMessage]
**Solution:**
1. Check FSM engine (src/engine/fsm.js)
2. Check keyword rules (src/engine/replyEngine.js)
3. Check RAG engine initialization
4. Look for exception in try-catch blocks

### D. Reply generated, tapi provider.sendMessage() fail
**Symptom:** Log say "tried to send" tapi Fonnte tidak receive
**Solution:**
1. Check provider.sendMessage() error handling
2. Verify Fonnte token still valid
3. Check phone number format (must be digits only)
4. Look for network errors to Fonnte API

### E. Provider.sendMessage() succeed, tapi pesan tidak sampai user
**Symptom:** Log [WhatsAppBusiness] ✓ Fonnte send success, tapi user tidak terima
**Solution:**
1. Check Fonnte dashboard for failed deliveries
2. Verify phone number is correct format
3. Check account balance
4. Check if phone number valid WhatsApp Business

## 📊 Environment Check

Run diagnostic:
```bash
node debug-fontte.js
```

Should output:
```
WHATSAPP_PROVIDER: fonnte ✓
WHATSAPP_API_KEY: xxx...xxx ✓
Konfigurasi Fonnte LENGKAP! ✓
```

## 🎯 Next Steps

1. **Enable detailed logging:**
   ```bash
   LOG_PII=true DEBUG=* npm run dev
   ```

2. **Add debug point in provider.js:**
   Look for `sendBotMessageRaw` function and add console.log

3. **Monitor with:**
   ```bash
   node monitor-bot-debug.js
   ```

4. **Test end-to-end:**
   ```bash
   node test-fonnte-webhook.js
   ```

5. **Check actual message receipt:**
   - Use real WhatsApp number sending to bot
   - Check Fonnte dashboard webhook log
   - Check bot server console

## 📞 Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `Fonnte token belum dikonfigurasi` | WHATSAPP_API_KEY missing | Set in .env |
| `HTTP 401 Unauthorized` | Webhook token mismatch | Check WHATSAPP_WEBHOOK_VERIFY_TOKEN |
| `ECONNREFUSED` | Can't reach Fonnte API | Check internet, WHATSAPP_FONNTE_SEND_URL |
| `Fonnte send rejected: ...` | API error from Fonnte | Check dashboard for account issues |
| `no phone found in payload` | Phone number extraction fail | Check webhook payload format |

## 💡 Pro Tips

1. Add temporary console.log() di strategic points:
   - fonnteWebhook.js POST handler (before forward)
   - provider.js webhook handler (before sendBotMessage)
   - provider.js sendBotMessageRaw (before provider.sendMessage)

2. Use real ngrok URL to test Fonnte webhook delivery

3. Monitor both server console AND Fonnte dashboard logs

4. Keep test script running in separate terminal

---

**Last Updated:** 2026-05-16
**Status:** Investigating - Bot reply not reaching user
