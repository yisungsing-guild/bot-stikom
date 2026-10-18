const express = require('express');
const axios = require('axios');
const logger = require('../logger');
const { requireWebhookToken } = require('../middleware/webhookToken');
const { normalizeEventText } = require('../lib/normalizer');
const { enqueueChat } = require('../engine/chatQueue');

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return digits;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractInbound(body) {
  const phoneRaw = firstString(
    body?.sender,
    body?.from,
    body?.whatsapp_number,
    body?.waId,
    body?.key?.remoteJid,
    body?.message?.key?.remoteJid,
    body?.data?.sender,
    body?.data?.from,
    body?.data?.whatsapp_number,
    body?.data?.waId,
    body?.data?.key?.remoteJid
  ).replace(/@s\.whatsapp\.net$/i, '');

  const text = firstString(
    body?.message,
    body?.text,
    body?.messageText,
    body?.conversation,
    body?.body,
    body?.data?.message,
    body?.data?.text,
    body?.data?.messageText,
    body?.data?.conversation,
    body?.data?.body,
    body?.message?.conversation,
    body?.message?.extendedTextMessage?.text,
    body?.message?.text
  );

  const messageId = firstString(
    body?.id,
    body?.messageId,
    body?.whatsappMessageId,
    body?.key?.id,
    body?.data?.id,
    body?.data?.messageId,
    body?.data?.whatsappMessageId,
    body?.data?.key?.id
  );

  const ts = body?.timestamp || body?.ts || body?.messageTimestamp || body?.data?.timestamp || body?.data?.ts || null;

  return {
    phone: normalizePhone(phoneRaw),
    text: String(text || '').trim(),
    messageId,
    ts
  };
}

async function forwardToProvider(inbound) {
  const internalHost = process.env.INTERNAL_PROVIDER_HOST || '127.0.0.1';
  const internalPort = process.env.PORT || 4000;
  const providerToken = (process.env.PROVIDER_WEBHOOK_TOKEN || '').toString().trim();

  return axios.post(`http://${internalHost}:${internalPort}/provider/webhook`, inbound, {
    headers: providerToken ? { 'x-webhook-token': providerToken } : undefined,
    timeout: parseInt(process.env.FONNTE_FORWARD_TIMEOUT_MS || '60000', 10)
  });
}

function redactWebhookUrl(rawUrl) {
  const s = typeof rawUrl === 'string' ? rawUrl : '';
  if (!s) return '';
  return s
    .replace(/([?&]token=)[^&]+/gi, '$1<redacted>')
    .replace(/([?&]verify_token=)[^&]+/gi, '$1<redacted>')
    .replace(/([?&]key=)[^&]+/gi, '$1<redacted>')
    .replace(/([?&]api_key=)[^&]+/gi, '$1<redacted>');
}

function sanitizePreview(body) {
  if (!body || typeof body !== 'object') return {};
  const safe = {};
  const SENSITIVE_KEYS = new Set(['token', 'verify_token', 'api_key', 'key', 'secret', 'authorization']);
  for (const k of Object.keys(body)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      safe[k] = '<redacted>';
    } else if (typeof body[k] === 'string' && body[k].length > 160) {
      safe[k] = body[k].slice(0, 160) + '…';
    } else {
      safe[k] = body[k];
    }
  }
  return safe;
}

const crypto = require('crypto');

const INSECURE_PLACEHOLDERS = new Set([
  'your_verify_token_here',
  'your-verify-token-here',
  'your_token_here',
  'your-token-here',
  'placeholder',
  'changeme',
  'change_me',
  'secret',
  'token',
  'default',
  'admin',
  'password'
]);

function isPlaceholderToken(val) {
  if (!val || typeof val !== 'string') return true;
  const s = val.trim().toLowerCase();
  return INSECURE_PLACEHOLDERS.has(s) || /^(your[_-]?verify[_-]?token|your[_-]?token|placeholder|change[_-]?me)$/i.test(s);
}

function constantTimeEquals(a, b) {
  const sa = typeof a === 'string' ? a.trim() : '';
  const sb = typeof b === 'string' ? b.trim() : '';
  if (!sa || !sb) return false;
  try {
    const hashA = crypto.createHash('sha256').update(sa, 'utf8').digest();
    const hashB = crypto.createHash('sha256').update(sb, 'utf8').digest();
    return crypto.timingSafeEqual(hashA, hashB);
  } catch (_) {
    return false;
  }
}

function getExpectedWebhookTokens() {
  const rawValues = [
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    process.env.FONNTE_WEBHOOK_TOKEN
  ];
  const tokens = [];
  for (const r of rawValues) {
    if (!r) continue;
    const parts = String(r).split(',').map(s => s.trim()).filter(Boolean);
    for (const item of parts) {
      if (!isPlaceholderToken(item)) {
        tokens.push(item);
      }
    }
  }
  return Array.from(new Set(tokens));
}

const router = express.Router();

const debugPayload = String(process.env.FONNTE_LOG_PAYLOAD || '').toLowerCase().trim() === 'true';

// Authentication middleware for Fonnte webhook
router.use((req, res, next) => {
  try {
    const reqTokenRaw = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
    const expectedTokens = getExpectedWebhookTokens();
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const enforceToken = reqTokenRaw === 'true'
      ? true
      : (reqTokenRaw === 'false' ? false : (expectedTokens.length > 0 || isProd));

    if (!enforceToken) {
      return next();
    }

    if (expectedTokens.length === 0) {
      if (isProd || reqTokenRaw === 'true') {
        logger.warn({ path: redactWebhookUrl(req.originalUrl || req.url) }, '[Fonnte Webhook] rejected: verify token not configured or contains insecure placeholder in production');
        return res.status(401).send({ ok: false, error: 'Unauthorized: verify token not configured or insecure placeholder' });
      }
      return next();
    }

    const headerToken = req.headers
      ? (req.headers['x-webhook-token'] || req.headers['x-fonnte-token'] || req.headers['x-token'])
      : null;
    const query = req.query || {};
    const queryToken = (typeof query.token === 'string' && query.token.trim()) ? query.token.trim() : ((typeof query.verify_token === 'string' && query.verify_token.trim()) ? query.verify_token.trim() : null);

    const auth = req.headers ? (req.headers.authorization || req.headers.Authorization) : null;
    let bearer = null;
    if (typeof auth === 'string') {
      const m = /^bearer\s+(.+)$/i.exec(auth);
      if (m) bearer = m[1].trim();
    }

    const body = Object.assign({}, req.query || {}, req.body || {});
    const bodyToken = (typeof body.token === 'string' && body.token.trim()) ? body.token.trim() : (
      (typeof body.verify_token === 'string' && body.verify_token.trim()) ? body.verify_token.trim() : (
        (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : (typeof body.key === 'string' && body.key.trim() ? body.key.trim() : null)
      )
    );

    const provided = headerToken || bearer || queryToken || bodyToken || null;
    if (provided) {
      const isMatch = expectedTokens.some(expected => constantTimeEquals(provided, expected));
      if (isMatch) {
        return next();
      }
    }

    logger.warn({
      path: redactWebhookUrl(req.originalUrl || req.url),
      hasProvided: Boolean(provided),
      providedLen: provided ? String(provided).length : 0
    }, '[Fonnte Webhook] rejected (invalid/missing token)');

    return res.status(401).send({ ok: false, error: 'Unauthorized: missing or invalid webhook token' });
  } catch (e) {
    logger.error({ err: e.message }, '[Fonnte Webhook] authentication middleware error');
    return res.status(401).send({ ok: false, error: 'Unauthorized: authentication error' });
  }
});

router.get(['/webhook', '/'], async (req, res) => {
  const hasInboundQuery = req.query && Object.keys(req.query).some((key) => /^(sender|from|whatsapp_number|waId|message|text|body)$/i.test(key));
  if (hasInboundQuery) return handleFonnteWebhook(req, res);
  res.status(200).send('ok');
});

async function handleFonnteWebhook(req, res) {
  try {
    const body = Object.assign({}, req.query || {}, req.body || {});
    const { phone, text, messageId, ts } = extractInbound(body);

    logger.info({
      path: redactWebhookUrl(req.originalUrl || req.url),
      hasPhone: Boolean(phone),
      hasText: Boolean(text),
      messageId
    }, '[Fonnte Webhook] incoming');
    res.status(200).send('ok');

    if (debugPayload && (!phone || !String(text || '').trim())) {
      try {
        const safeBody = sanitizePreview(body);
        const preview = {
          keys: Object.keys(body || {}).slice(0, 40),
          sample: JSON.stringify(safeBody).slice(0, 1200)
        };
        logger.info({ preview }, '[Fonnte Webhook] payload preview (missing phone/text)');
      } catch (e) {
        logger.info('[Fonnte Webhook] payload preview (missing phone/text) - failed to stringify body');
      }
    }

    if (!phone || !text) {
      return;
    }

    const normalizedEvent = normalizeEventText(text, { preserveCase: false });
    const isV2 = String(process.env.CHAT_ENGINE || '').toLowerCase().trim() === 'v2' ||
      String(process.env.USE_GREENFIELD || '').toLowerCase().trim() === 'true';

    await enqueueChat(phone, async () => {
      if (isV2) {
        try {
          const { handleInboundMessage } = require('../core/orchestrator');
          logger.info({ phone, messageId }, '[ChatEngine] Routing inbound message to Greenfield V2');
          await handleInboundMessage(body, { executeDispatch: true });
        } catch (v2Err) {
          logger.error({ err: v2Err.message, phone, messageId }, '[ChatEngine] Greenfield V2 execution failed (safe failure, no legacy fallback)');
        }
        return;
      }

      await forwardToProvider({
        chatId: phone,
        text,
        normalizedText: normalizedEvent.normalized,
        searchText: normalizedEvent.searchText,
        tokens: normalizedEvent.tokens,
        urls: normalizedEvent.urls,
        messageId,
        fonnteMessageId: messageId,
        ts,
        source: 'fonnte'
      });
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, '[Fonnte Webhook] handler error');
    try { res.status(200).send('ok'); } catch (e) { /* ignore */ }
  }
}

router.post(['/webhook', '/'], handleFonnteWebhook);
router.all(['/webhook', '/'], handleFonnteWebhook);

router.constantTimeEquals = constantTimeEquals;
router.redactWebhookUrl = redactWebhookUrl;
router.isPlaceholderToken = isPlaceholderToken;
router.getExpectedWebhookTokens = getExpectedWebhookTokens;

module.exports = router;
module.exports.constantTimeEquals = constantTimeEquals;
module.exports.redactWebhookUrl = redactWebhookUrl;
module.exports.isPlaceholderToken = isPlaceholderToken;
module.exports.getExpectedWebhookTokens = getExpectedWebhookTokens;