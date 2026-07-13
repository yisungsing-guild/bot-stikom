const express = require('express');
const axios = require('axios');
const logger = require('../logger');
const { requireWebhookToken } = require('../middleware/webhookToken');

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

const router = express.Router();

const requireTokenRaw = String(process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN || '').toLowerCase().trim();
const hasVerifyToken = Boolean(String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim());
const shouldRequireToken = requireTokenRaw === 'true' ? true : (requireTokenRaw === 'false' ? false : hasVerifyToken);

// Optional debug: when true, log payload preview when phone/text extraction fails
const debugPayload = String(process.env.FONNTE_LOG_PAYLOAD || '').toLowerCase().trim() === 'true';

if (shouldRequireToken) {
  // Custom middleware: require token from header, bearer, query OR body fields
  router.use('/webhook', (req, res, next) => {
    try {
      const expected = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').toString().trim();
      if (!expected) return next();

      const headerName = 'x-webhook-token';
      const headerToken = req.headers ? req.headers[headerName] || req.headers[headerName.toLowerCase()] : null;
      const query = req.query || {};
      const queryToken = (typeof query.token === 'string' && query.token.trim()) ? query.token.trim() : ((typeof query.verify_token === 'string' && query.verify_token.trim()) ? query.verify_token.trim() : null);

      const auth = req.headers ? (req.headers.authorization || req.headers.Authorization) : null;
      let bearer = null;
      if (typeof auth === 'string') {
        const m = /^bearer\s+(.+)$/i.exec(auth);
        if (m) bearer = m[1].trim();
      }

      const body = req.body || {};
      const bodyToken = (typeof body.token === 'string' && body.token.trim()) ? body.token.trim() : (
        (typeof body.verify_token === 'string' && body.verify_token.trim()) ? body.verify_token.trim() : (
          (typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : (typeof body.key === 'string' && body.key.trim() ? body.key.trim() : null)
        )
      );

      const provided = headerToken || bearer || queryToken || bodyToken || null;
      if (provided && provided === expected) return next();

      // fallback: call original requireWebhookToken for consistent rejection handling
      return requireWebhookToken(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)(req, res, next);
    } catch (e) {
      return requireWebhookToken(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)(req, res, next);
    }
  });
}

router.get(['/webhook', '/'], (req, res) => {
  res.status(200).send('ok');
});

async function handleFonnteWebhook(req, res) {
  try {
    const body = req.body || {};
    const { phone, text, messageId, ts } = extractInbound(body);

    logger.info({ hasPhone: Boolean(phone), hasText: Boolean(text), messageId }, '[Fonnte Webhook] incoming');
    res.status(200).send('ok');

    if (debugPayload && (!phone || !String(text || '').trim())) {
      try {
        const preview = {
          keys: Object.keys(body || {}).slice(0, 40),
          sample: JSON.stringify(body).slice(0, 1200)
        };
        logger.info({ preview }, '[Fonnte Webhook] payload preview (missing phone/text)');
      } catch (e) {
        logger.info('[Fonnte Webhook] payload preview (missing phone/text) - failed to stringify body');
      }
    }

    if (!phone || !text) {
      return;
    }

    await forwardToProvider({
      chatId: phone,
      text,
      messageId,
      fonnteMessageId: messageId,
      ts,
      source: 'fonnte'
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, '[Fonnte Webhook] handler error');
    try { res.status(200).send('ok'); } catch (e) { /* ignore */ }
  }
}

router.post(['/webhook', '/'], handleFonnteWebhook);

module.exports = router;