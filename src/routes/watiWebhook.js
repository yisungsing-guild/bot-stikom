const express = require('express');
const axios = require('axios');
const router = express.Router();
const logger = require('../logger');
const { requireWebhookToken } = require('../middleware/webhookToken');
const prisma = require('../db');

const DIAG_KEYS = {
  acceptedAt: 'wati_last_webhook_accepted_at',
  rejectedAt: 'wati_last_webhook_rejected_at',
  rejectedMeta: 'wati_last_webhook_rejected_meta',
  ignoredAt: 'wati_last_webhook_ignored_at',
  ignoredReason: 'wati_last_webhook_ignored_reason',
  payloadShape: 'wati_last_webhook_payload_shape',
  extracted: 'wati_last_webhook_extracted',
  forwardedAt: 'wati_last_webhook_forwarded_at',
  forwardResult: 'wati_last_webhook_forward_result'
};

async function upsertSetting(key, value) {
  try {
    if (!key) return;
    const v = (typeof value === 'string') ? value : JSON.stringify(value);
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: v },
      update: { value: v }
    });
  } catch (e) {
    // diagnostics must never break webhook
  }
}

function truncateString(s, maxLen = 600) {
  const raw = (typeof s === 'string') ? s : '';
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + '…';
}

function getString(v) {
  return (typeof v === 'string') ? v : '';
}

function firstNonEmptyString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

function parseTimestampMs(value) {
  try {
    if (value === undefined || value === null) return null;

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      return value < 1e12 ? value * 1000 : value;
    }

    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isNaN(t) ? null : t;
    }

    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;

      // Numeric string (unix seconds or ms)
      if (/^[0-9]+$/.test(s)) {
        const n = Number(s);
        if (!Number.isNaN(n) && Number.isFinite(n)) {
          return n < 1e12 ? n * 1000 : n;
        }
      }

      // ISO / RFC date string
      const d = Date.parse(s);
      if (!Number.isNaN(d)) return d;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function safeObjectKeys(value) {
  try {
    if (!value || typeof value !== 'object') return [];
    return Object.keys(value).slice(0, 80);
  } catch (e) {
    return [];
  }
}

function firstStringFromMessageTree(message) {
  if (!message || typeof message !== 'object') return null;

  return firstNonEmptyString(
    message.conversation,
    message.text,
    message.body,
    message.caption,
    message.messageText,
    message.extendedTextMessage && message.extendedTextMessage.text,
    message.imageMessage && message.imageMessage.caption,
    message.videoMessage && message.videoMessage.caption,
    message.documentMessage && message.documentMessage.caption,
    message.ephemeralMessage && firstStringFromMessageTree(message.ephemeralMessage.message),
    message.viewOnceMessage && firstStringFromMessageTree(message.viewOnceMessage.message),
    message.viewOnceMessageV2 && firstStringFromMessageTree(message.viewOnceMessageV2.message),
    message.templateMessage && message.templateMessage.hydratedTemplate && message.templateMessage.hydratedTemplate.hydratedContentText,
    message.buttonsMessage && message.buttonsMessage.contentText,
    message.listResponseMessage && message.listResponseMessage.singleSelectReply && message.listResponseMessage.singleSelectReply.selectedRowId
  );
}

function sanitizePreview(body) {
  // Avoid logging secrets; keep only high-level shape + a few safe fields.
  const preview = {
    keys: safeObjectKeys(body),
    eventType: body?.eventType || body?.type || body?.event || null,
    waId: body?.waId || body?.data?.waId || body?.messageContact?.waId || null,
    from: body?.from || body?.data?.from || body?.whatsapp_number || body?.data?.whatsapp_number || null,
    sender: body?.sender || body?.data?.sender || null,
    hasText: Boolean(
      (typeof body?.text === 'string' && body.text.trim()) ||
      (typeof body?.messageText === 'string' && body.messageText.trim()) ||
      (typeof body?.message === 'string' && body.message.trim()) ||
      (typeof body?.pesan === 'string' && body.pesan.trim()) ||
      (typeof body?.data?.text === 'string' && body.data.text.trim()) ||
      (typeof body?.data?.message === 'string' && body.data.message.trim()) ||
      (typeof body?.data?.pesan === 'string' && body.data.pesan.trim())
    ),
    id: body?.whatsappMessageId || body?.messageId || body?.id || null
  };

  // Truncate any accidental long strings
  for (const k of Object.keys(preview)) {
    if (typeof preview[k] === 'string' && preview[k].length > 160) {
      preview[k] = preview[k].slice(0, 160) + '…';
    }
  }
  return preview;
}

function redactWebhookUrl(rawUrl) {
  const s = (typeof rawUrl === 'string') ? rawUrl : '';
  if (!s) return '';
  // Mask common token query params to avoid leaking secrets in logs/DB.
  return s
    .replace(/([?&]token=)[^&]+/ig, '$1<redacted>')
    .replace(/([?&]verify_token=)[^&]+/ig, '$1<redacted>');
}

function extractPhoneAndText(body) {
  // Phone candidates
  const phone = firstNonEmptyString(
    body?.waId,
    body?.whatsapp_number,
    body?.key?.remoteJid,
    body?.data?.key?.remoteJid,
    body?.message?.key?.remoteJid,
    body?.messages?.[0]?.key?.remoteJid,
    body?.senderPhone,
    body?.senderPhoneNumber,
    body?.from,
    body?.fromNumber,
    body?.phone,
    body?.sender,
    body?.senderId,
    body?.data?.waId,
    body?.data?.whatsapp_number,
    body?.data?.senderPhone,
    body?.data?.senderPhoneNumber,
    body?.data?.from,
    body?.data?.fromNumber,
    body?.data?.phone,
    body?.data?.sender,
    body?.messageContact?.waId,
    body?.messageContact?.phone,
    body?.contact?.waId,
    body?.contact?.phone,
    body?.contacts?.[0]?.waId,
    body?.contacts?.[0]?.phone
  );

  // Text candidates
  const text = firstNonEmptyString(
    (typeof body?.text === 'string') ? body.text : null,
    body?.messageText,
    body?.pesan,
    (typeof body?.message === 'string') ? body.message : null,
    body?.text?.body,
    firstStringFromMessageTree(body?.message),
    body?.message?.text,
    body?.message?.body,
    body?.message?.text?.body,
    body?.data?.text,
    body?.data?.messageText,
    body?.data?.pesan,
    (typeof body?.data?.message === 'string') ? body.data.message : null,
    body?.data?.text?.body,
    firstStringFromMessageTree(body?.data?.message),
    body?.data?.message?.text,
    body?.data?.message?.body,
    body?.data?.message?.text?.body,
    body?.data?.data?.text,
    firstStringFromMessageTree(body?.messages?.[0]),
    body?.messages?.[0]?.text,
    body?.messages?.[0]?.text?.body,
    body?.messages?.[0]?.body
  ) || '';

  // Prefer the stable WhatsApp message id when present.
  const whatsappMessageId = firstNonEmptyString(
    body?.whatsappMessageId,
    body?.data?.whatsappMessageId,
    body?.message?.whatsappMessageId,
    body?.data?.message?.whatsappMessageId,
    body?.messages?.[0]?.whatsappMessageId,
    body?.data?.messages?.[0]?.whatsappMessageId,
    body?.key?.id,
    body?.data?.key?.id,
    body?.message?.key?.id,
    body?.messages?.[0]?.key?.id
  );

  // Fallback ids (may be event ids per delivery).
  const eventId = firstNonEmptyString(
    body?.messageId,
    body?.id,
    body?.data?.messageId,
    body?.data?.id,
    body?.message?.id,
    body?.data?.message?.id,
    body?.messages?.[0]?.id,
    body?.data?.messages?.[0]?.id,
    body?.key?.id,
    body?.data?.key?.id,
    body?.message?.key?.id,
    body?.messages?.[0]?.key?.id
  );

  const messageId = whatsappMessageId || eventId || null;

  const tsRaw = firstDefined(
    body?.created,
    body?.createdAt,
    body?.timestamp,
    body?.ts,
    body?.time,
    body?.messageTimestamp,
    body?.data?.created,
    body?.data?.createdAt,
    body?.data?.timestamp,
    body?.data?.ts,
    body?.data?.time,
    body?.data?.messageTimestamp,
    body?.message?.created,
    body?.message?.createdAt,
    body?.message?.timestamp,
    body?.message?.ts,
    body?.data?.message?.created,
    body?.data?.message?.createdAt,
    body?.data?.message?.timestamp,
    body?.data?.message?.ts
  );
  const ts = parseTimestampMs(tsRaw);

  // Normalize phone to digits-only and prefer E.164-like format without '+'
  // WATI sendSessionMessage commonly expects something like 62812xxxxxxx.
  let phoneNorm = phone ? String(phone).replace(/\D/g, '') : null;
  if (phoneNorm) {
    if (phoneNorm.startsWith('0')) phoneNorm = '62' + phoneNorm.slice(1);
    else if (phoneNorm.startsWith('8')) phoneNorm = '62' + phoneNorm;
  }

  return { phone: phoneNorm, text, messageId, whatsappMessageId, eventId, ts };
}

// Simple WATI webhook
// - No HMAC/signature verification here (WATI uses token)
// - Default behavior: forward inbound message to internal /provider/webhook
//   so only ONE logic path generates replies (prevents duplicate/irrelevant replies).

router.get('/webhook', (req, res) => {
  // Optional simple verification: accept ?token or ?verify_token
  const token = req.query.token || req.query.verify_token || null;
  if (token && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(req.query.challenge || 'ok');
  }
  // health check
  res.status(200).send('ok');
});

// Optional hardening: require token on webhook POST.
// Recommended behavior:
// - production: require token by default when WHATSAPP_WEBHOOK_VERIFY_TOKEN is configured
// - non-production: keep open by default for convenience
// Overrides:
// - set WATI_WEBHOOK_REQUIRE_TOKEN=true/false explicitly
const watiRequireTokenRaw = String(process.env.WATI_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const hasVerifyToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
const requireWatiToken =
  watiRequireTokenRaw === 'true' ? true :
  watiRequireTokenRaw === 'false' ? false :
  (isProduction && hasVerifyToken);
if (requireWatiToken) {
  router.post('/webhook', requireWebhookToken(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, {
    onReject: ({ path, hasProvidedToken, providedTokenLength, expectedTokenLength, source }) => {
      const now = new Date().toISOString();
      const safePath = redactWebhookUrl(path);

      // Always log to server output so rejections remain visible even if DB is down.
      logger.warn(
        { path: safePath, source, hasProvidedToken, providedTokenLength, expectedTokenLength },
        '[WATI Webhook] rejected (invalid/missing token)'
      );

      void upsertSetting(DIAG_KEYS.rejectedAt, now);
      void upsertSetting(DIAG_KEYS.rejectedMeta, truncateString(JSON.stringify({
        at: now,
        path: safePath,
        source,
        hasProvidedToken,
        providedTokenLength,
        expectedTokenLength
      })));
    }
  }), async (req, res) => {
    return watiWebhookHandler(req, res);
  });
} else {
  router.post('/webhook', async (req, res) => {
    return watiWebhookHandler(req, res);
  });
}

async function watiWebhookHandler(req, res) {
  try {
    const body = req.body || {};

    const { phone, text, messageId, whatsappMessageId, eventId, ts } = extractPhoneAndText(body);

    const debugPayload = String(process.env.WATI_LOG_PAYLOAD || '').toLowerCase() === 'true';
    const safePath = redactWebhookUrl(req.originalUrl);
    logger.info({ path: safePath, hasPhone: !!phone, hasText: !!String(text || '').trim(), messageId }, '[WATI Webhook] incoming');
    if (debugPayload && (!phone || !String(text || '').trim())) {
      logger.info({ preview: sanitizePreview(body) }, '[WATI Webhook] payload preview (missing phone/text)');
    }

    const nowIso = new Date().toISOString();
    void upsertSetting(DIAG_KEYS.acceptedAt, nowIso);
    void upsertSetting(DIAG_KEYS.payloadShape, truncateString(JSON.stringify({ at: nowIso, path: safePath, preview: sanitizePreview(body) })));
    void upsertSetting(DIAG_KEYS.extracted, truncateString(JSON.stringify({
      at: nowIso,
      hasPhone: Boolean(phone),
      hasText: Boolean(String(text || '').trim()),
      messageId: messageId || null,
      whatsappMessageId: whatsappMessageId || null,
      eventId: eventId || null,
      ts: ts || null,
      phoneLast4: phone ? String(phone).slice(-4) : null
    })));

    // Acknowledge immediately
    res.status(200).send('ok');

    if (!phone) {
      void upsertSetting(DIAG_KEYS.ignoredAt, nowIso);
      void upsertSetting(DIAG_KEYS.ignoredReason, 'no_phone');
      logger.warn({ preview: sanitizePreview(body) }, '[WATI Webhook] no phone found in payload');
      return;
    }

    // Many WATI event types are delivery/read/status updates and won't include inbound user text.
    // Only forward actual inbound messages.
    if (!String(text || '').trim()) {
      void upsertSetting(DIAG_KEYS.ignoredAt, nowIso);
      void upsertSetting(DIAG_KEYS.ignoredReason, 'empty_text');
      logger.info({ phone, messageId, preview: sanitizePreview(body) }, '[WATI Webhook] ignoring event with empty text (likely status update)');
      return;
    }

    const mode = String(process.env.WATI_WEBHOOK_MODE || 'forward').toLowerCase();
    if (mode === 'echo') {
      // Legacy behavior (not recommended): echo back the same text.
      // Keeping this behind a switch for backward compatibility.
      const watiBase = (process.env.WHATSAPP_API_ENDPOINT || '').replace(/\/$/, '') || 'https://app-server.wati.io';
      const sendUrl = `${watiBase}/api/v1/sendSessionMessage`;

      const payload = {
        to: phone,
        message: text || 'Terima kasih, pesan Anda telah diterima.'
      };

      const headers = {
        Authorization: `Bearer ${process.env.WHATSAPP_API_KEY}`,
        'Content-Type': 'application/json'
      };

      try {
        const resp = await axios.post(sendUrl, payload, { headers, timeout: 10000 });
        logger.info('[WATI Webhook] echo sent', { status: resp.status, data: resp.data });
      } catch (sendErr) {
        logger.error({ err: sendErr.response ? sendErr.response.data || sendErr.message : sendErr.message }, '[WATI Webhook] echo failed');
      }

      return;
    }

    if (mode !== 'forward') {
      logger.warn('[WATI Webhook] mode not forward/echo; ignoring message', { mode });
      return;
    }

    // Forward to internal provider route
    try {
      const internalHost = process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1';
      const internalPort = process.env.PORT || 4000;
      const timeoutMs = parseInt(process.env.WATI_FORWARD_TIMEOUT_MS || '60000', 10);
      const providerToken = (process.env.PROVIDER_WEBHOOK_TOKEN || '').toString().trim();
      await axios.post(`http://${internalHost}:${internalPort}/provider/webhook`, {
        chatId: phone,
        text,
        messageId,
        whatsappMessageId,
        watiEventId: eventId,
        ts
      }, {
        timeout: Number.isFinite(timeoutMs) ? timeoutMs : 60000,
        headers: providerToken ? { 'x-webhook-token': providerToken } : undefined
      });
      logger.info('[WATI Webhook] forwarded to /provider/webhook', { phone, messageId });
      void upsertSetting(DIAG_KEYS.forwardedAt, new Date().toISOString());
      void upsertSetting(DIAG_KEYS.forwardResult, truncateString(JSON.stringify({ ok: true, at: new Date().toISOString() })));
    } catch (forwardErr) {
      logger.error({ err: forwardErr.response ? forwardErr.response.data || forwardErr.message : forwardErr.message }, '[WATI Webhook] forward failed');
      const errMsg = forwardErr?.response ? (forwardErr.response.data || forwardErr.message) : forwardErr?.message;
      void upsertSetting(DIAG_KEYS.forwardedAt, new Date().toISOString());
      void upsertSetting(DIAG_KEYS.forwardResult, truncateString(JSON.stringify({ ok: false, at: new Date().toISOString(), error: errMsg ? String(errMsg) : 'unknown' })));
    }
  } catch (err) {
    logger.error({ err }, '[WATI Webhook] handler error');
    // Ensure request gets acknowledged
    try { res.status(200).send('ok'); } catch (e) { /* ignore */ }
  }
}

module.exports = router;
