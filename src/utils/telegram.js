const axios = require('axios');
const logger = require('../logger');

function parseCsvIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => String(s));
}

function getTelegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim();

  const enabledRaw = String(process.env.ENABLE_TELEGRAM_ALERTS || '').trim().toLowerCase();
  const enabled = enabledRaw
    ? (enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes' || enabledRaw === 'y' || enabledRaw === 'on')
    : Boolean(token && chatId);

  const timeoutMsRaw = parseInt(process.env.TELEGRAM_TIMEOUT_MS || '3500', 10);
  const timeoutMs = (Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0) ? timeoutMsRaw : 3500;

  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  // Restrict who can issue repair commands.
  // - If TELEGRAM_ALLOWED_CHAT_IDS is set, use it.
  // - Else fall back to TELEGRAM_CHAT_ID.
  const allowed = parseCsvIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS || chatId);

  return {
    enabled,
    token,
    chatId,
    timeoutMs,
    webhookSecret,
    allowedChatIds: allowed,
  };
}

function isTelegramConfigured() {
  const cfg = getTelegramConfig();
  return Boolean(cfg.enabled && cfg.token && cfg.chatId);
}

function isAllowedTelegramChatId(incomingChatId) {
  const cfg = getTelegramConfig();
  const incoming = String(incomingChatId || '').trim();
  if (!incoming) return false;

  // If no allowlist configured, default deny in production.
  // In practice cfg.allowedChatIds defaults to TELEGRAM_CHAT_ID.
  const allow = Array.isArray(cfg.allowedChatIds) ? cfg.allowedChatIds : [];
  return allow.includes(incoming);
}

async function sendTelegramMessage(text, opts = {}) {
  const cfg = getTelegramConfig();
  const token = cfg.token;
  const defaultChatId = cfg.chatId;

  if (!cfg.enabled || !token || !defaultChatId) {
    return { ok: false, disabled: true };
  }

  const chatId = (opts && opts.chatId) ? String(opts.chatId) : defaultChatId;
  const disablePreview = (opts && typeof opts.disableWebPreview === 'boolean') ? opts.disableWebPreview : true;

  const payload = {
    chat_id: chatId,
    text: String(text || ''),
    disable_web_page_preview: disablePreview,
  };

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const resp = await axios.post(url, payload, {
      timeout: cfg.timeoutMs,
      validateStatus: () => true,
    });

    const ok = Boolean(resp && resp.data && resp.data.ok);
    if (!ok) {
      logger.warn(
        { status: resp && resp.status, data: resp && resp.data ? resp.data : null },
        '[Telegram] sendMessage failed'
      );
      return { ok: false, status: resp && resp.status, data: resp && resp.data };
    }

    return { ok: true, result: resp.data.result };
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[Telegram] sendMessage error');
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  getTelegramConfig,
  isTelegramConfigured,
  isAllowedTelegramChatId,
  sendTelegramMessage,
};
