# AUDIT KOMPREHENSIF: MENGGANTI FONNTE DENGAN BAILEYS
## Status: AUDIT ONLY - NO IMPLEMENTATION YET

---

## 📋 RINGKASAN EKSEKUTIF

**Objective:** Replace Fonnte WhatsApp gateway with Baileys, keeping ALL AI/RAG/FSM logic unchanged.

**Scope:** Gateway layer only (incoming messages + outgoing sending)

**Impact:** 
- 2-3 files perlu dimodifikasi (minor additions)
- 7+ files harus tetap unchanged
- Zero changes to AI/RAG/FSM/OpenAI logic

---

## 🔍 PART 1: TITIK MASUK FONNTE (INCOMING MESSAGES)

### Lokasi saat ini: `src/routes/fonnteWebhook.js`

```
┌─────────────────────────────────────────────────────────┐
│ CURRENT FONNTE FLOW (INCOMING)                          │
└─────────────────────────────────────────────────────────┘

  WhatsApp User
      ↓
  Fonnte Gateway (api.fonnte.com)
      ↓
  POST /fonnte/webhook ← payload dari Fonnte
      ↓
  extractInbound()
  ├─ sender → "62812345678"
  ├─ message → "Halo"
  ├─ id → "msg_123456789"
  └─ timestamp → 1623456789 (unix seconds)
      ↓
  forwardToProvider()
  POST http://127.0.0.1:4000/provider/webhook
  with payload: {
    chatId: "62812345678",
    text: "Halo",
    messageId: "msg_123456789",
    ts: 1623456789
  }
      ↓
  /provider/webhook (provider.js)
      ↓
  FSM/RAG/AI processing
      ↓
  provider.sendMessage(chatId, answer)
      ↓
  WhatsAppBusinessProvider.sendMessage()
      ↓
  Fonnte API POST request
      ↓
  Fonnte sends to WhatsApp
      ↓
  WhatsApp User receives reply
```

### Fonnte webhook payload (berbagai format yang didukung):

```javascript
// Format 1: Standard Fonnte
{
  sender: "62812345678",
  message: "Halo",
  id: "msg_123456789",
  timestamp: 1623456789
}

// Format 2: Alternative fields
{
  from: "62812345678",
  text: "Halo",
  messageId: "msg_123456789",
  ts: 1623456789
}

// Format 3: Nested structure
{
  data: {
    sender: "62812345678",
    message: "Halo",
    key: { id: "msg_123456789" }
  }
}

// Format 4: WhatsApp-like structure
{
  key: { remoteJid: "62812345678@s.whatsapp.net", id: "msg_123456789" },
  message: { conversation: "Halo" },
  messageTimestamp: 1623456789
}
```

### Ekstraksi di `fonnteWebhook.js` (line 23-55):

```javascript
function extractInbound(body) {
  // Tries multiple field names (robust parsing)
  const phoneRaw = firstString(
    body?.sender,
    body?.from,
    body?.whatsapp_number,
    body?.key?.remoteJid,
    // ... more fallbacks
  ).replace(/@s\.whatsapp\.net$/i, '');  // Strip @s.whatsapp.net if present
  
  const text = firstString(
    body?.message,
    body?.text,
    body?.messageText,
    body?.conversation,
    body?.body,
    // ... more fallbacks
  );
  
  const messageId = firstString(
    body?.id,
    body?.messageId,
    body?.whatsappMessageId,
    body?.key?.id
    // ... more fallbacks
  );
  
  const ts = body?.timestamp || body?.ts || body?.messageTimestamp || null;
  
  return {
    phone: normalizePhone(phoneRaw),  // "62812345678"
    text: String(text || '').trim(),
    messageId,
    ts
  };
}

function normalizePhone(value) {
  // 0812345678 → 62812345678
  // 8812345678 → 628812345678
  // 62812345678 → 62812345678
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
}
```

### Forward ke `/provider/webhook` (line 98-108):

```javascript
async function forwardToProvider(inbound) {
  const internalHost = process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1';
  const internalPort = process.env.PORT || 4000;
  const providerToken = process.env.PROVIDER_WEBHOOK_TOKEN || '';
  
  return axios.post(
    `http://${internalHost}:${internalPort}/provider/webhook`,
    {
      chatId: inbound.phone,           // "62812345678"
      text: inbound.text,              // "Halo"
      messageId: inbound.messageId,    // optional
      ts: inbound.ts                   // optional
    },
    {
      headers: providerToken 
        ? { 'x-webhook-token': providerToken }
        : {}
    }
  );
}
```

---

## 🔄 PART 2: PROCESSING AT /provider/webhook

### Lokasi: `src/routes/provider.js` line 6294+

```javascript
router.post('/webhook', providerWebhookAuth, async (req, res) => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: PARSE PAYLOAD (provider-agnostic)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const chatId = req.body.chatId;           // "62812345678"
  let text = String(req.body.text || '').trim();
  const messageIdRaw = req.body.whatsappMessageId || req.body.messageId || null;
  const inboundTsRaw = req.body.ts || req.body.timestamp || null;
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: DEDUP CHECKS (triple-layer protection)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (messageId && hasSeenInboundId(messageId)) {
    return res.send({ ok: true, deduped: true });  // Already processed
  }
  
  // Strong dedupe: if timestamp provided, use (chatId + norm_text + ts)
  if (inboundTs) {
    const key = `${chatId}|${inboundTs}|${normalizeTextForDedup(text)}`;
    if (hasSeenInboundKey(key)) {
      return res.send({ ok: true, deduped: true });
    }
    rememberInboundKey(key);
  }
  
  // Stale protection: ignore messages older than last accepted
  if (inboundTs) {
    const lastTs = lastInboundTsByChat.get(chatId);
    if (lastTs && inboundTs < (lastTs - STALE_TOLERANCE_MS)) {
      return res.send({ ok: true, deduped: true, reason: 'stale_ts' });
    }
    lastInboundTsByChat.set(chatId, inboundTs);
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: RETRIEVE SESSION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const session = await prisma.session.findUnique({ where: { chatId } });
  const sessionData = session?.data || {};
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: FSM / RAG / AI PROCESSING (unchanged)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const fsmReply = await handleFSM(chatId, text);
  if (fsmReply) {
    await sendBotMessage(chatId, fsmReply);
    return res.send({ ok: true, source: 'fsm' });
  }
  
  const keywordReply = await findReplyByRules(text);
  if (keywordReply) {
    await sendBotMessage(chatId, keywordReply.answer);
    return res.send({ ok: true, source: 'rules' });
  }
  
  const ragResult = await ragQueryWithEval(chatId, text, topK, {});
  if (ragResult?.success && ragResult.answer) {
    await sendBotMessage(chatId, ragResult.answer);
    return res.send({ ok: true, source: 'rag' });
  }
  
  const aiResult = await AIReplyEngine.getReply(text);
  if (aiResult?.success) {
    await sendBotMessage(chatId, aiResult.reply);
    return res.send({ ok: true, source: 'ai' });
  }
  
  // Fallback
  await sendBotMessage(chatId, 'Maaf, saya belum bisa menjawab.');
  return res.send({ ok: true, source: 'fallback' });
});
```

**Key point:** This handler is **COMPLETELY PROVIDER-AGNOSTIC**:
- Doesn't care if message came from Fonnte, Baileys, WATI, etc
- Only needs: `chatId`, `text`, optional `messageId`, `ts`
- All processing uses Prisma (database), not provider-specific logic

---

## 📤 PART 3: OUTGOING MESSAGE FLOW

### Lokasi A: `src/routes/provider.js` line 6489

```javascript
let sendBotMessage = async (toChatId, messageText) => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PROCESSING (tone, sanitization, formatting)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const cleanedText = normalizeGreetingHeader(messageText);
  const outboundText = looksLikeFeeTemplateOutboundText(cleanedText)
    ? sanitizeFeeTemplateWhatsappText(cleanedText)
    : sanitizeWhatsappText(autoToneOutboundText(cleanedText));
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEDUP CHECK (prevent double sends)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const norm = normalizeTextForDedup(outboundText);
  const lastOut = lastOutboundByChat.get(toChatId);
  if (lastOut && lastOut.text === norm && (Date.now() - lastOut.ts) <= OUTBOUND_TEXT_WINDOW_MS) {
    console.log('[sendBotMessage] SKIPPED duplicate outbound');
    return;
  }
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ACTUAL SEND (via provider)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  try {
    await provider.sendMessage(toChatId, outboundText);
    lastOutboundByChat.set(toChatId, { text: norm, ts: Date.now() });
  } catch (e) {
    logger.error({ err }, '[ProviderRoute] sendBotMessage failed');
    // Retry logic, error handling...
  }
};
```

### Lokasi B: `src/providers/whatsappBusinessProvider.js` line 157

```javascript
async sendMessage(chatId, message, options = {}) {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: NORMALIZE CHATID
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const normalizedChatId = normalizeWhatsAppTarget(chatId);
  // "62812345678@s.whatsapp.net" → "62812345678"
  // "62812345678" → "62812345678"
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: DETECT PROVIDER MODE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (isFonnteMode) {
    const encoded = encodeURIComponent(message);
    const fonnte_url = `https://api.fonnte.com/send?phone=${normalizedChatId}&message=${encoded}`;
    const fonnte_resp = await axios.post(fonnte_url, {}, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    return fonnte_resp.data;
  }
  
  if (isWatiMode) {
    const url = `${watiHost}/api/v1/sendSessionMessage/${normalizedChatId}?messageText=${encoded}`;
    const resp = await axios.get(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    return resp.data;
  }
  
  // ... other providers
}
```

**Key point:** sendMessage() is the **gateway abstraction**:
- Input: `chatId` (phone), `message` (text)
- Output: Sends via appropriate API (Fonnte, WATI, WhatsVA, etc)
- Currently handles 4 providers, we'll add Baileys as 5th

---

## 🎯 PART 4: BAILEYS IMPLEMENTATION MAPPING

### Baileys incoming event structure:

```javascript
sock.ev.on('messages.upsert', ({ messages }) => {
  for (const msg of messages) {
    if (msg.key.fromMe) continue;  // Skip bot's own messages
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // EXTRACT MESSAGE DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const chatId = msg.key.remoteJid;
    // → "62812345678@s.whatsapp.net" (Baileys format with suffix)
    
    // Text can be in various places
    const userText = 
      msg.message?.conversation ||                    // Simple text
      msg.message?.extendedTextMessage?.text ||       // Long text
      msg.message?.imageMessage?.caption ||           // Image with caption
      (msg.message?.sticker ? '[sticker]' : '') ||
      (msg.message?.audioMessage ? '[audio]' : '') ||
      '[unsupported message type]';
    
    const messageId = msg.key.id;
    // → "XXXX12345678YYYY" (Baileys unique ID)
    
    const timestamp = msg.messageTimestamp;
    // → 1623456789 (unix seconds, same as Fonnte)
  }
});
```

### Baileys outgoing call:

```javascript
// Baileys format
await sock.sendMessage('62812345678@s.whatsapp.net', {
  text: 'Jawaban'
});

// Can also send media
await sock.sendMessage('62812345678@s.whatsapp.net', {
  image: { url: 'https://...' },
  caption: 'Caption text'
});
```

### Required format conversions:

| Flow | Fonnte Format | Baileys Format | Conversion Required |
|------|---------------|----------------|--------------------| 
| **Incoming chatId** | `"62812345678"` | `"62812345678@s.whatsapp.net"` | **Strip suffix** for `/provider/webhook` |
| **Incoming messageId** | `"msg_123"` | `"XXXX123"` | No conversion needed (both unique) |
| **Incoming timestamp** | `1623456789` | `1623456789` | No conversion (same unix seconds) |
| **Outgoing chatId** | `"62812345678"` | `"62812345678@s.whatsapp.net"` | **Add suffix** when sending via Baileys |

---

## 📊 PART 5: MINIMAL CHANGES NEEDED

### Change 1: `sandbox-baileys.js` - ADD incoming POST

**What to add:**
```javascript
const axios = require('axios');

sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    if (msg.key.fromMe) continue;
    
    // Extract message data
    const chatId = msg.key.remoteJid;                    // "62812345678@s.whatsapp.net"
    const userText = msg.message?.conversation || '';
    const messageId = msg.key.id;
    const timestamp = msg.messageTimestamp;
    
    // Convert to /provider/webhook format (same as Fonnte does)
    const chatIdForWebhook = chatId.replace(/@s\.whatsapp\.net$/, '');  // Strip suffix
    
    try {
      const providerToken = process.env.PROVIDER_WEBHOOK_TOKEN || '';
      const response = await axios.post('http://127.0.0.1:4000/provider/webhook', {
        chatId: chatIdForWebhook,                          // "62812345678"
        text: userText,
        messageId: messageId,                              // Baileys message ID
        ts: timestamp                                      // unix seconds
      }, {
        headers: providerToken ? { 'x-webhook-token': providerToken } : {}
      });
      
      console.log('[Baileys] Message processed:', { chatId, messageId, source: 'webhook' });
    } catch (e) {
      console.error('[Baileys] Failed to forward to /provider/webhook:', e.message);
      // Optional: Send error message to user or log
    }
  }
});
```

**Why this approach:**
- ✅ Reuses `/provider/webhook` (no duplication)
- ✅ Reuses FSM/RAG/AI logic (no changes)
- ✅ Identical dedup/session/logging
- ✅ Same message format as Fonnte

### Change 2: `src/providers/whatsappBusinessProvider.js` - ADD Baileys check in sendMessage()

**What to add (in sendMessage() method around line 157):**
```javascript
async sendMessage(chatId, message, options = {}) {
  const normalizedChatId = normalizeWhatsAppTarget(chatId);
  
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NEW: Check if Baileys socket is available
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (this.baileysSocket && typeof this.baileysSocket.sendMessage === 'function') {
    try {
      // Baileys expects JID format: "62812345678@s.whatsapp.net"
      const fullJid = normalizedChatId.includes('@') 
        ? normalizedChatId 
        : `${normalizedChatId}@s.whatsapp.net`;
      
      const result = await this.baileysSocket.sendMessage(fullJid, { text: message });
      
      logger.info({ chatId, source: 'baileys' }, '[WhatsAppBusinessProvider] Message sent via Baileys');
      return result;
    } catch (e) {
      logger.warn({ err: e.message }, '[WhatsAppBusinessProvider] Baileys send failed, falling back to Fonnte');
      // Fallthrough to Fonnte API
    }
  }
  
  // EXISTING: Fonnte/WATI/WhatsVA/Business API logic (unchanged)
  if (isFonnteMode) {
    // ... existing Fonnte code ...
  }
  
  if (isWatiMode) {
    // ... existing WATI code ...
  }
  
  // ... rest unchanged ...
}
```

**Why this approach:**
- ✅ Non-breaking: Fallback to Fonnte if Baileys unavailable
- ✅ Minimal: Just add socket check at beginning
- ✅ Clean: No changes to existing provider logic
- ✅ Flexible: Can switch between Baileys and Fonnte without restart (if socket changes)

### Change 3: `src/index.js` (optional) OR `sandbox-baileys.js` - Inject socket

**Option A: In `src/index.js` at startup:**
```javascript
// After provider is initialized, inject Baileys socket if available
if (global.BAILEYS_SOCKET) {
  provider.baileysSocket = global.BAILEYS_SOCKET;
  logger.info('[Server] Baileys socket injected into WhatsAppBusinessProvider');
}
```

**Option B: In `sandbox-baileys.js` after authentication:**
```javascript
// After sock is authenticated
global.BAILEYS_SOCKET = sock;
provider.baileysSocket = sock;  // If provider is accessible
console.log('[Baileys] Socket injected into provider');
```

**Choose Option A** (cleaner, more modular) - Let `src/index.js` handle injection.

---

## 📝 PART 6: FILE MODIFICATION MATRIX

### Files MUST CHANGE:

| File | Change | Lines | Complexity |
|------|--------|-------|------------|
| `sandbox-baileys.js` | ADD POST to `/provider/webhook` | ~20 lines | Low (copy pattern from Fonnte) |
| `src/providers/whatsappBusinessProvider.js` | ADD Baileys socket check in sendMessage() | ~15 lines | Low (simple if/try/catch) |
| `src/index.js` | ADD socket injection (optional) | ~5 lines | Low (one-liner) |

**Total new code:** ~40 lines max

### Files MUST NOT CHANGE:

| File | Reason |
|------|--------|
| `src/routes/provider.js` | Core webhook handler is provider-agnostic |
| `src/routes/fonnteWebhook.js` | Fonnte webhook can coexist with Baileys |
| `src/engine/fsm.js` | FSM logic unchanged |
| `src/engine/ragEngine.js` | RAG retrieval unchanged |
| `src/engine/aiEngine.js` | AI logic unchanged |
| `src/engine/replyEngine.js` | Keyword rules unchanged |
| `src/providers/whatsappBusinessProvider.js` | Only ADD check, don't change existing |
| `src/middleware/*` | Middleware unchanged |
| `src/handlers/*` | All handler files unchanged |
| Database, training data, `.env` | No changes needed |

---

## 🔄 PART 7: MESSAGE FLOW COMPARISON

### CURRENT: Fonnte-only flow

```
WhatsApp User
    ↓
Fonnte Gateway
    ↓
POST /fonnte/webhook
    ├─ body: { sender, message, id, timestamp }
    ├─ extractInbound() → { phone, text, messageId, ts }
    └─ forwardToProvider() → POST /provider/webhook
        ↓
        { chatId: phone, text, messageId, ts }
        ↓
    /provider/webhook (provider.js)
    ├─ Dedup checks
    ├─ Session retrieval
    ├─ FSM/RAG/AI processing
    └─ sendBotMessage(chatId, answer)
        ↓
    provider.sendMessage(chatId, answer)
    ├─ normalizeWhatsAppTarget(chatId)
    ├─ Detect provider mode (isFonnteMode)
    ├─ POST to Fonnte API
    └─ Response sent to Fonnte
        ↓
Fonnte Gateway
    ↓
WhatsApp User receives reply
```

### TARGET: Baileys + Fonnte (coexistence)

```
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ PATH A: BAILEYS                  │     │ PATH B: FONNTE (unchanged)       │
└──────────────────────────────────┘     └──────────────────────────────────┘

WhatsApp User (Baileys)           WhatsApp User (Fonnte)
    ↓                                 ↓
Baileys Socket (ws)               Fonnte Gateway (https)
    ↓                                 ↓
messages.upsert event             POST /fonnte/webhook
    ↓                                 ↓
sandbox-baileys.js                fonnteWebhook.js
POST /provider/webhook            forwardToProvider()
{ chatId, text, ... }             POST /provider/webhook
    ↓                                 ↓
    └─────────────────────────────────┘
            ↓
    /provider/webhook (provider.js)
    ├─ Dedup checks (same for both)
    ├─ Session retrieval (same)
    ├─ FSM/RAG/AI processing (same)
    └─ sendBotMessage(chatId, answer)
            ↓
    provider.sendMessage(chatId, answer)
    ├─ normalizeWhatsAppTarget(chatId)
    ├─ NEW: Check if Baileys socket available
    │   ├─ YES → sock.sendMessage(fullJid, { text })
    │   └─ NO → continue to Fonnte API
    ├─ isFonnteMode → POST to Fonnte API
    └─ Response sent
            ↓
    Baileys socket            Fonnte Gateway
            ↓                         ↓
WhatsApp user receives      WhatsApp user receives
reply via Baileys           reply via Fonnte
```

**Key feature:** Both can run simultaneously! Switch per-chatId or per-startup flag.

---

## 🎓 PART 8: DEDUP & SESSION LOGIC (UNCHANGED)

The existing dedup in `/provider/webhook` is **provider-agnostic**:

```javascript
// Layer 1: By messageId (global TTL cache)
if (messageId && hasSeenInboundId(messageId)) {
  return res.send({ ok: true, deduped: true });
}

// Layer 2: By text + timestamp (strong dedupe)
// - Baileys messageId: "XXXX123"
// - Fonnte messageId: "msg_123"
// Both unique, both work with hasSeenInboundId()

// Layer 3: By text + arrival time window
// Prevents duplicate replies if upstream retries webhook
// Works for both Baileys and Fonnte

// Layer 4: Stale timestamp protection
// Ignores messages older than last accepted for that chatId
// Prevents "old" messages from being re-processed
```

**Session persistence is also provider-agnostic:**
```javascript
const session = await prisma.session.findUnique({ where: { chatId } });
// chatId: "62812345678" (for both Baileys and Fonnte, after normalization)
// Session data is independent of provider
```

---

## 🚀 PART 9: IMPLEMENTATION ROADMAP

### Phase 1: Incoming messages (Baileys → /provider/webhook)
- [ ] Add axios import to `sandbox-baileys.js`
- [ ] Add `messages.upsert` event handler
- [ ] POST to `/provider/webhook` with normalized payload
- [ ] Test: Send message from WhatsApp → Verify /provider/webhook receives it
- [ ] Test: Dedup works (send same message twice)
- [ ] Test: FSM/RAG/AI processing works correctly
- [ ] Result: Baileys messages now processed through core pipeline

### Phase 2: Outgoing messages (provider.sendMessage → Baileys socket)
- [ ] Add Baileys socket check in `sendMessage()` method
- [ ] Add JID format conversion (add @s.whatsapp.net suffix)
- [ ] Add fallback to Fonnte API if socket unavailable
- [ ] Inject socket into provider in `src/index.js` or `sandbox-baileys.js`
- [ ] Test: Reply sent via Baileys (not Fonnte API)
- [ ] Test: Image/media sending via Baileys
- [ ] Result: Baileys now receives replies via socket

### Phase 3: Cleanup & validation
- [ ] Keep Fonnte webhook + provider support (coexistence)
- [ ] Add environment flags for provider preference (optional)
- [ ] Add logging to distinguish Baileys vs Fonnte messages
- [ ] Test switching between modes without restart
- [ ] Load testing with both providers active
- [ ] Result: Production-ready dual-gateway setup

---

## ⚠️ PART 10: CRITICAL REQUIREMENTS CHECKLIST

```
✅ NO changes to AI/RAG/FSM logic
✅ NO changes to /provider/webhook handler
✅ NO changes to OpenAI API calls
✅ NO changes to Prisma/database logic
✅ NO changes to training data structure
✅ NO changes to message dedup logic
✅ NO changes to session management
✅ NO changes to Fonnte support (backward compatible)
✅ Minimal code additions (~40 lines)
✅ Reuse existing `/provider/webhook` completely
✅ Same message format normalization
✅ Same FSM/RAG/AI processing
✅ Same bot response logic
✅ Can switch providers without code changes (config-based)
✅ Can run both providers simultaneously (coexistence)
```

---

## 📌 PART 11: KEY TECHNICAL DECISIONS

### Decision 1: POST to `/provider/webhook` instead of calling AI directly
**Why:** Reuses dedup, session, FSM, RAG, logging
**Alternative:** Call AI directly from Baileys (❌ would duplicate code)
**Impact:** ✅ Zero impact on core logic, pure gateway swap

### Decision 2: Inject socket into provider instead of modifying sendMessage() signature
**Why:** Non-breaking, minimal changes, backward compatible
**Alternative:** Create new method `baileySendMessage()` (❌ would require changes in provider.js)
**Impact:** ✅ Just add socket check, existing code unchanged

### Decision 3: Keep Fonnte webhook & provider logic unchanged
**Why:** Both can coexist, switch per-message or per-config
**Alternative:** Replace Fonnte completely (❌ breaking change, reduces flexibility)
**Impact:** ✅ Can migrate gradually, test in parallel

### Decision 4: Strip @s.whatsapp.net for `/provider/webhook`, add for Baileys send
**Why:** Normalizes chatId to "62812345678" format (internal standard)
**Why:** Baileys requires full JID format with suffix
**Alternative:** Keep full JID everywhere (❌ breaks Fonnte normalization)
**Impact:** ✅ Clean abstraction, no logic changes

---

## 📚 PART 12: PAYLOAD REFERENCE

### Incoming Baileys → /provider/webhook format

```json
POST /provider/webhook
Authorization: x-webhook-token: ${PROVIDER_WEBHOOK_TOKEN}

{
  "chatId": "62812345678",
  "text": "Halo, apa kabar?",
  "messageId": "XXXX1234YYYY5678",
  "ts": 1686012345
}
```

### Incoming Fonnte → /provider/webhook format (same!)

```json
POST /provider/webhook
Authorization: x-webhook-token: ${PROVIDER_WEBHOOK_TOKEN}

{
  "chatId": "62812345678",
  "text": "Halo, apa kabar?",
  "messageId": "msg_1234567890",
  "ts": 1686012345
}
```

**Identical format!** Only source gateway differs.

### Outgoing provider.sendMessage() call (unchanged)

```javascript
await provider.sendMessage(
  "62812345678",              // chatId (input from /provider/webhook)
  "Halo juga! Apa kabar?"     // formatted answer from AI/RAG
);
```

### Baileys socket.sendMessage() call (new)

```javascript
if (this.baileysSocket) {
  const fullJid = "62812345678".includes('@')
    ? "62812345678"
    : "62812345678@s.whatsapp.net";
  
  await this.baileysSocket.sendMessage(fullJid, {
    text: "Halo juga! Apa kabar?"
  });
}
```

---

## 🎯 CONCLUSION

**What stays the same:** 99% of code (AI/RAG/FSM/OpenAI)

**What changes:** Gateway layer only (~40 lines added)

**Impact on bot responses:** ZERO (same logic, same processing, same output)

**Risk level:** LOW (minimal changes, backward compatible, can coexist)

**Testing effort:** MEDIUM (need to verify incoming + outgoing for Baileys)

**Deployment:** Can be gradual (test with Baileys, keep Fonnte active)

---

## 📞 NEXT STEPS

1. **Review this audit** - Confirm understanding of all 12 parts
2. **Approve file changes** - Confirm which files to modify
3. **Start Phase 1** - Implement incoming message forwarding
4. **Test Phase 1** - Verify messages reach /provider/webhook
5. **Start Phase 2** - Implement outgoing Baileys sending
6. **Test Phase 2** - Verify replies come back via Baileys
7. **Phase 3** - Cleanup, logging, dual-mode support

**Ready to implement when approved! ✅**
