const { WhatsAppProvider } = require('./whatsappProvider');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

function envTruthy(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function shouldLogPII() {
  // Default: DO NOT log PII in production/test. Opt-in with LOG_PII=true.
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  const defaultValue = env === 'development';
  return envTruthy('LOG_PII', defaultValue);
}

function maskChatId(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '[unknown]';

  const last4 = digits.slice(-4);
  const cc = digits.length >= 2 ? digits.slice(0, 2) : '';
  if (digits.length <= 6) return `${cc ? cc : ''}***${last4}`;
  return `${cc}****${last4}`;
}

function safeTextForLog(text, maxLen = 120) {
  const s = String(text || '');
  if (!s) return '';
  if (shouldLogPII()) {
    const preview = s.replace(/\s+/g, ' ').trim().slice(0, maxLen);
    return preview + (s.length > maxLen ? '…' : '');
  }
  return `[redacted len=${s.length}]`;
}

function looksLikeHttpsImageUrl(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  return /\.(?:jpe?g|png|gif|webp)(?:\?|#|$)/i.test(u);
}

function normalizeAllowedHost(value) {
  let v = String(value || '').trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^\*\./, '');

  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return String(u.hostname || '').toLowerCase() || null;
    } catch {
      v = v.replace(/^https?:\/\//i, '');
    }
  }

  v = v.split('/')[0];
  v = v.split(':')[0];
  return v || null;
}

function writeProviderSendAudit(out) {
  try {
    const outDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const logPath = path.join(outDir, 'provider_send_results.log');
    fs.appendFileSync(logPath, JSON.stringify(out) + '\n', { encoding: 'utf8' });
  } catch (e) {
    logger.error({ err: e && e.message ? e.message : String(e), provider: out && out.provider, chatId: out && out.chatId }, '[WhatsAppBusiness] Failed to write provider_send_results.log');
  }
}

function isAllowedOutboundImageUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (!/^https:\/\//i.test(u)) return false;

  const rawAllowlist = String(process.env.WHATSAPP_IMAGE_URL_ALLOWLIST || '').trim();
  if (!rawAllowlist) return true;

  const allowedHosts = rawAllowlist
    .split(',')
    .map(normalizeAllowedHost)
    .filter(Boolean);

  if (!allowedHosts.length) return true;

  try {
    const host = String(new URL(u).hostname || '').toLowerCase();
    if (!host) return false;
    return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function normalizeWhatsAppTarget(chatId) {
  const raw = String(chatId || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^tel:/i, '').replace(/[^\d+]/g, '');
  let digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    digits = '62' + digits;
  }

  if (!/^\d{6,20}$/.test(digits)) return '';
  return digits;
}

function isWhatsvaMode() {
  const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim();
  const endpoint = String(process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase();
  return provider === 'whatsva' || endpoint.includes('whatsva.id');
}

function isFonnteMode() {
  const provider = String(process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim();
  const endpoint = String(process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase();
  return provider === 'fonnte' || endpoint.includes('fonnte.com');
}

function getWhatsvaInstanceKey() {
  return String(process.env.WHATSAPP_INSTANCE_KEY || process.env.WHATSAPP_API_KEY || '').trim();
}

function getFonnteToken() {
  return String(process.env.WHATSAPP_API_KEY || '').trim();
}

/**
 * WhatsApp Business API Provider (Meta Cloud API)
 * Implementasi lengkap untuk menghubungkan bot ke WhatsApp Business Account
 * 
 * Setup:
 * 1. Buat app di developers.facebook.com
 * 2. Setup WhatsApp Business Account
 * 3. Generate Access Token
 * 4. Tentukan Phone Number ID
 * 5. Setup webhook dengan verify token
 */
class WhatsAppBusinessProvider extends WhatsAppProvider {
  constructor(apiKey, phoneNumberId, businessAccountId) {
    super();
    this.apiKey = apiKey;
    this.phoneNumberId = phoneNumberId;
    this.businessAccountId = businessAccountId;
    this.apiVersion = 'v18.0'; // WhatsApp Cloud API version
    this.baseUrl = 'https://graph.facebook.com'; // WhatsApp API endpoint
    this.messageQueue = []; // Queue untuk rate limiting
    this.retryCount = 0;
    this.maxRetries = 3;
    // Anti-looping: simpan messageId yang sudah pernah diproses
    this.seenMessageIds = new Set();
    // Anti-looping tambahan: simpan pesan terakhir per chat (text + timestamp)
    this.lastIncomingByChat = new Map();
  }

  /**
   * Kirim pesan text ke WhatsApp
   */
  async sendMessage(chatId, message, options = {}) {
    try {
      const isWhatsva = isWhatsvaMode();
      const isFonnte = isFonnteMode();
      const isWati = !isWhatsva && (
        String(process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim() === 'wati' ||
        (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati')
      );
      if (isWhatsva) {
        if (!getWhatsvaInstanceKey()) {
          logger.error('[WhatsAppBusiness] WhatsVA instance key belum dikonfigurasi');
          throw new Error('WhatsVA belum dikonfigurasi. Isi WHATSAPP_INSTANCE_KEY di .env.local.');
        }
      } else if (!this.apiKey || (!isWati && !isFonnte && !this.phoneNumberId)) {
        logger.error('[WhatsAppBusiness] API key atau phoneNumberId tidak dikonfigurasi');
        throw new Error('WhatsApp API belum dikonfigurasi. Silakan setup credentials.');
      }

      const normalizedChatId = normalizeWhatsAppTarget(chatId);
      if (!normalizedChatId) {
        const errMsg = `Invalid WhatsApp target: ${String(chatId || '')}`;
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('[WhatsAppBusiness] Skipping send in non-production mode: invalid WhatsApp target', {
            chatId: String(chatId || ''),
            message: safeTextForLog(message, 120)
          });
          this.emit('sent', { chatId: String(chatId || ''), message, ts: Date.now(), status: 'skipped', reason: 'invalid_target' });
          return { success: true, skipped: true };
        }
        throw new Error(errMsg);
      }

      // TRACE: final message preview before any provider-specific send
      try {
        logger.info({ tag: 'TRACE_BEFORE_SEND', message: safeTextForLog(message, 120) }, '[TRACE_BEFORE_SEND]');
      } catch (e) {
        logger.info('[TRACE_BEFORE_SEND] <unserializable message>');
      }

      // Auto-detect: if callers accidentally send a bare image URL as text,
      // deliver it as a WhatsApp image message instead (WATI only).
      // Guarded to avoid recursion when sendImage() falls back to sendMessage().
      const skipImageAutoDetect = Boolean(options && options.skipImageAutoDetect);
      const outboundImagesEnabled = envTruthy('WHATSAPP_ENABLE_OUTBOUND_IMAGES', true);
      const candidate = String(message || '').trim();
      if (
        isWati &&
        outboundImagesEnabled &&
        !skipImageAutoDetect &&
        looksLikeHttpsImageUrl(candidate) &&
        isAllowedOutboundImageUrl(candidate)
      ) {
        if (envTruthy('WATI_DEBUG_MEDIA_SEND', false)) {
          logger.debug('[WhatsAppBusiness] Auto-detected bare image URL in sendMessage; delegating to sendImage');
        }
        return await this.sendImage(normalizedChatId, candidate, '', {
          ...options,
          // Ensure any fallback text send does NOT re-trigger auto-detection.
          skipImageAutoDetect: true,
          // Treat as explicit intent: prefer media send for image URLs.
          forceMediaSend: true,
        });
      }

      logger.info({ chatId: maskChatId(normalizedChatId), message: safeTextForLog(message, 120) }, '[WhatsAppBusiness] Mengirim ke');

      if (isWhatsva) {
        const whatsvaUrl = (process.env.WHATSAPP_WHATSVA_SEND_TEXT_URL || process.env.WHATSAPP_API_ENDPOINT || 'https://whatsva.id/api/sendMessageText').replace(/\/$/, '');
        const instanceKey = getWhatsvaInstanceKey();
        const url = whatsvaUrl;
        const payload = {
          instance_key: instanceKey,
          jid: normalizedChatId,
          message: String(message || '')
        };

        try {
          const resp = await this.makeRequest('POST', url, payload, 0, {});

          const messageId = resp?.messageId || resp?.id || resp?.data?.id || resp?.data?.message_id || null;
          logger.info({ chatId: maskChatId(normalizedChatId), messageId }, '[WhatsAppBusiness] ✓ Pesan terkirim via WhatsVA.');
          this.emit('sent', { chatId: normalizedChatId, message, ts: Date.now(), messageId, status: 'sent' });

          writeProviderSendAudit({
            timestamp: new Date().toISOString(),
            provider: 'whatsva',
            chatId: normalizedChatId,
            messageId: messageId || null,
            success: true,
            providerResponse: resp || null
          });

          return { success: true, messageId, provider: 'whatsva', response: resp };
        } catch (err) {
          logger.error({ err: err && err.message ? err.message : String(err), provider: 'whatsva', chatId: normalizedChatId }, '[WhatsAppBusiness] WhatsVA send failed');
          throw err;
        }
      }

      if (isWati) {
        const watiHost = (process.env.WHATSAPP_API_ENDPOINT || 'https://app-server.wati.io').replace(/\/$/, '');

        // Common production mistake: leaving the placeholder tenant id in config.
        // This will cause WATI to return 401/404 and the bot won't be able to reply.
        if (/<TENANT_ID>|TENANT_ID|\{TENANT\}|\{tenant\}/i.test(watiHost) || /<[^>]+>/.test(watiHost)) {
          throw new Error(
            'WATI config invalid: WHATSAPP_API_ENDPOINT masih berisi placeholder tenant id. ' +
            'Ganti menjadi format seperti: https://live-mt-server.wati.io/<TENANT_ID> (tanpa tanda <...>), ' +
            'misalnya https://live-mt-server.wati.io/1095849.'
          );
        }

        // Berdasarkan API Docs WATI: POST /{tenantId}/api/v1/sendSessionMessage/{whatsappNumber}
        // Dari error "message text can not be empty", WATI tampaknya
        // mengharapkan teks dikirim sebagai query param `messageText`,
        // bukan di body JSON.
        const encoded = encodeURIComponent(message || '');
        const url = `${watiHost}/api/v1/sendSessionMessage/${normalizedChatId}?messageText=${encoded}`;
        const payload = null;

        try {
          const resp = await this.makeRequest('POST', url, payload, 0, { Authorization: `Bearer ${this.apiKey}` });
          if (envTruthy('WATI_DEBUG_RAW_RESPONSE', false) && shouldLogPII()) {
            logger.debug({ rawResponse: JSON.stringify(resp) }, '[WhatsAppBusiness] WATI raw response');
          }

          if (resp && (resp.result === false || resp.success === false)) {
            const info = resp.info || resp.message || 'Unknown error';
            throw new Error(`WATI send rejected: ${info}`);
          }

          const messageId = resp?.messageId || resp?.id || resp?.data?.id || resp?.data?.message_id || null;
          logger.info({ chatId: maskChatId(normalizedChatId), messageId }, '[WhatsAppBusiness] ✓ Pesan terkirim via WATI.');
          this.emit('sent', { chatId: normalizedChatId, message, ts: Date.now(), messageId, status: 'sent' });

          writeProviderSendAudit({
            timestamp: new Date().toISOString(),
            provider: 'wati',
            chatId: normalizedChatId,
            messageId: messageId || null,
            success: true,
            providerResponse: resp || null
          });

          return { success: true, messageId };
        } catch (err) {
          logger.error({ err: err && err.message ? err.message : String(err), provider: 'wati', chatId: normalizedChatId }, '[WhatsAppBusiness] WATI send failed');
          throw err;
        }
      }

      if (isFonnte) {
        const fonnteUrl = (process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send').replace(/\/$/, '');
        const token = getFonnteToken();

        if (!token) {
          logger.error('[WhatsAppBusiness] Fonnte token belum dikonfigurasi');
          throw new Error('Fonnte belum dikonfigurasi. Isi WHATSAPP_API_KEY dengan token Fonnte.');
        }

        const payload = new URLSearchParams();
        payload.set('target', normalizedChatId);
        payload.set('message', String(message || ''));

        if (options.previewUrl === false) {
          payload.set('preview', 'false');
        }

        const response = await this.makeRequest('POST', fonnteUrl, payload, 0, {
          Authorization: token,
          'Content-Type': 'application/x-www-form-urlencoded'
        });

        if (response && (response.status === false || response.success === false)) {
          const reason = String(response.reason || response.detail || response.message || 'Unknown error').trim();
          throw new Error(`Fonnte send rejected${reason ? `: ${reason}` : ''}`);
        }

        const messageId = Array.isArray(response?.id) ? response.id[0] : (response?.id || response?.requestid || null);
        logger.info({ chatId: maskChatId(normalizedChatId), messageId }, '[WhatsAppBusiness] ✓ Pesan terkirim via Fonnte.');
        this.emit('sent', { chatId: normalizedChatId, message, ts: Date.now(), messageId, status: 'sent' });

        writeProviderSendAudit({
          timestamp: new Date().toISOString(),
          provider: 'fonnte',
          chatId: normalizedChatId,
          messageId: messageId || null,
          success: true,
          providerResponse: response || null
        });

        return { success: true, messageId, provider: 'fonnte', response };
      }

      // Default: Meta Graph API
      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedChatId,
        type: 'text',
        text: {
          preview_url: options.previewUrl !== false,
          body: message
        }
      };

      const response = await this.makeRequest('POST', url, payload);
      const messageId = response.messages?.[0]?.id;

      logger.info({ chatId: maskChatId(normalizedChatId), messageId }, '[WhatsAppBusiness] ✓ Pesan terkirim.');

      this.emit('sent', {
        chatId: normalizedChatId,
        message,
        ts: Date.now(),
        messageId,
        status: 'sent'
      });

      // Persistent audit log for provider send result (Meta Graph)
      writeProviderSendAudit({
        timestamp: new Date().toISOString(),
        provider: 'meta',
        chatId: normalizedChatId,
        messageId: messageId || null,
        success: true,
        providerResponse: response || null
      });

      return { success: true, messageId };
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err), chatId: String(chatId || '') }, '[WhatsAppBusiness] ✗ Error mengirim');
      this.emit('error', { chatId: String(chatId || ''), error: err.message || err });
      throw err;
    }
    }

  /**
   * Kirim pesan gambar (image) via URL publik.
   *
   * - Meta Cloud API: mengirim message type "image" (attachment asli).
   * - WATI: default fallback kirim URL sebagai text (preview biasanya muncul di WhatsApp).
   *   Jika ingin mencoba endpoint media WATI, set `WATI_ENABLE_MEDIA_SEND=true`.
   */
  async sendImage(chatId, imageUrl, caption = '', options = {}) {
    try {
      const isFonnte = isFonnteMode();
      const isWati =
        String(process.env.WHATSAPP_PROVIDER || '').toLowerCase().trim() === 'wati' ||
        (process.env.WHATSAPP_API_ENDPOINT || '').toLowerCase().includes('wati');

      if (!this.apiKey || (!isWati && !isFonnte && !this.phoneNumberId)) {
        logger.error('[WhatsAppBusiness] API key atau phoneNumberId tidak dikonfigurasi');
        throw new Error('WhatsApp API belum dikonfigurasi. Silakan setup credentials.');
      }

      const link = String(imageUrl || '').trim();
      if (!link) throw new Error('imageUrl is required');

      // Normalize chatId to digits-only and ensure it has country code
      let to = String(chatId || '').trim();
      let toDigits = to.replace(/\D/g, '');
      if (toDigits) {
        if (toDigits.startsWith('0')) toDigits = '62' + toDigits.slice(1);
        else if (toDigits.startsWith('8')) toDigits = '62' + toDigits;
      }
      const normalizedChatId = toDigits || to;

      if (isWhatsvaMode()) {
        const textFallback = [safeCaption, link].filter(Boolean).join('\n');
        const resp = await this.sendMessage(normalizedChatId, textFallback, {
          previewUrl: options.previewUrl,
          skipImageAutoDetect: true,
        });
        this.emit('sentImage', {
          chatId: normalizedChatId,
          imageUrl: link,
          caption: safeCaption,
          ts: Date.now(),
          status: 'sent',
          mode: 'whatsva-text-fallback'
        });
        return { ...resp, mode: 'whatsva-text-fallback' };
      }

      if (isFonnte) {
        const token = getFonnteToken();
        if (!token) {
          logger.error('[WhatsAppBusiness] Fonnte token belum dikonfigurasi');
          throw new Error('Fonnte belum dikonfigurasi. Isi WHATSAPP_API_KEY dengan token Fonnte.');
        }

        const enableMediaSend = Boolean(options && options.forceMediaSend) || envTruthy('FONNTE_ENABLE_MEDIA_SEND', false);
        if (!enableMediaSend) {
          const textFallback = [safeCaption, link].filter(Boolean).join('\n');
          const resp = await this.sendMessage(normalizedChatId, textFallback, {
            previewUrl: options.previewUrl,
            skipImageAutoDetect: true,
          });
          this.emit('sentImage', {
            chatId: normalizedChatId,
            imageUrl: link,
            caption: safeCaption,
            ts: Date.now(),
            status: 'sent',
            mode: 'fonnte-text-fallback'
          });
          return { ...resp, mode: 'fonnte-text-fallback' };
        }

        const fonnteUrl = (process.env.WHATSAPP_FONNTE_SEND_URL || 'https://api.fonnte.com/send').replace(/\/$/, '');
        const payload = new URLSearchParams();
        payload.set('target', normalizedChatId);
        payload.set('message', safeCaption || link);
        payload.set('url', link);
        const response = await this.makeRequest('POST', fonnteUrl, payload, 0, {
          Authorization: token,
          'Content-Type': 'application/x-www-form-urlencoded'
        });

        if (response && (response.status === false || response.success === false)) {
          const reason = String(response.reason || response.detail || response.message || 'Unknown error').trim();
          throw new Error(`Fonnte image send rejected${reason ? `: ${reason}` : ''}`);
        }

        const messageId = Array.isArray(response?.id) ? response.id[0] : (response?.id || response?.requestid || null);
        this.emit('sentImage', {
          chatId: normalizedChatId,
          imageUrl: link,
          caption: safeCaption,
          ts: Date.now(),
          messageId,
          status: 'sent',
          mode: 'fonnte'
        });
        return { success: true, messageId, mode: 'fonnte' };
      }

      const captionMaxRaw = parseInt(process.env.WHATSAPP_IMAGE_CAPTION_MAX || '900', 10);
      const captionMax = (Number.isFinite(captionMaxRaw) && captionMaxRaw > 0) ? Math.min(1500, captionMaxRaw) : 900;
      let safeCaption = caption ? String(caption).trim() : '';
      if (safeCaption && safeCaption.length > captionMax) {
        safeCaption = safeCaption.slice(0, Math.max(0, captionMax - 1)) + '…';
      }

      if (isWati) {
        const watiHost = (process.env.WHATSAPP_API_ENDPOINT || 'https://app-server.wati.io').replace(/\/$/, '');
        const watiMediaHost = (process.env.WATI_MEDIA_API_ENDPOINT || watiHost).replace(/\/$/, '');

        if (/<TENANT_ID>|TENANT_ID|\{TENANT\}|\{tenant\}/i.test(watiMediaHost) || /<[^>]+>/.test(watiMediaHost)) {
          throw new Error(
            'WATI config invalid: WHATSAPP_API_ENDPOINT masih berisi placeholder tenant id. ' +
            'Ganti menjadi format seperti: https://live-mt-server.wati.io/<TENANT_ID> (tanpa tanda <...>), ' +
            'misalnya https://live-mt-server.wati.io/1095849.'
          );
        }

        const debugMediaSend = envTruthy('WATI_DEBUG_MEDIA_SEND', false);
        const forceMediaSend = Boolean(options && options.forceMediaSend);
        const enableMediaSend = forceMediaSend || envTruthy('WATI_ENABLE_MEDIA_SEND', false);
        if (!enableMediaSend) {
          // Safe default: send as text (WhatsApp will often show a preview image).
          if (debugMediaSend) {
            logger.debug('[WhatsAppBusiness] WATI media send disabled; sending image URL as text');
          }
          const textFallback = [safeCaption, link].filter(Boolean).join('\n');
          const resp = await this.sendMessage(normalizedChatId, textFallback, {
            previewUrl: options.previewUrl,
            skipImageAutoDetect: true,
          });
          this.emit('sentImage', {
            chatId: normalizedChatId,
            imageUrl: link,
            caption: safeCaption,
            ts: Date.now(),
            status: 'sent',
            mode: 'wati-text-fallback'
          });
          return { ...resp, mode: 'wati-text-fallback' };
        }

        // Best-effort media sending for WATI (endpoint shape varies by tenant/version).
        // We try multiple shapes, then (optional) download+multipart upload fallback.
        // Configure if needed:
        // - WATI_SEND_IMAGE_PATH (default: /api/v1/sendSessionFile)
        // - WATI_MEDIA_URL_PARAM (default: fileUrl)
        // - WATI_MEDIA_CAPTION_PARAM (default: caption)
        // - WATI_MEDIA_TO_PARAM (default: whatsappNumber)
        // - WATI_MEDIA_FORM_FILE_FIELD (default: file)
        const pathRaw = String(process.env.WATI_SEND_IMAGE_PATH || '/api/v1/sendSessionFile').trim();
        const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
        const urlParam = String(process.env.WATI_MEDIA_URL_PARAM || 'fileUrl').trim() || 'fileUrl';
        const captionParam = String(process.env.WATI_MEDIA_CAPTION_PARAM || 'caption').trim() || 'caption';
        const toParam = String(process.env.WATI_MEDIA_TO_PARAM || 'whatsappNumber').trim() || 'whatsappNumber';
        const formFileField = String(process.env.WATI_MEDIA_FORM_FILE_FIELD || 'file').trim() || 'file';

        const extractMessageId = (resp) => resp?.messageId || resp?.id || resp?.data?.id || resp?.data?.message_id || null;
        const looksLikeTextEchoInsteadOfMedia = (resp) => {
          try {
            if (!resp || typeof resp !== 'object') return false;
            const msg = resp.message;
            if (!msg || typeof msg !== 'object') return false;
            const t = String(msg.type || '').toLowerCase();
            const media = msg.media;
            const filePath = msg.filePath;
            const text = typeof msg.text === 'string' ? msg.text.trim() : '';
            const linkTrim = link.trim();
            return t === 'text' && (media == null) && (filePath == null) && Boolean(text) && text === linkTrim;
          } catch {
            return false;
          }
        };
        const watiRespIndicatesFailure = (resp) => {
          try {
            if (!resp || typeof resp !== 'object') return false;
            return resp.result === false || resp.success === false || resp.ok === false;
          } catch {
            return false;
          }
        };
        const watiRespFailureReason = (resp) => {
          try {
            if (!resp || typeof resp !== 'object') return '';
            return String(resp.info || resp.message || resp.error || resp.detail || '').trim();
          } catch {
            return '';
          }
        };
        const debugRespSummary = (resp) => {
          try {
            if (!resp || typeof resp !== 'object') return { raw: String(resp) };
            const msg = resp.message;
            if (msg && typeof msg === 'object') {
              return {
                ok: resp.ok,
                result: resp.result,
                info: resp.info,
                message: {
                  type: msg.type,
                  hasMedia: msg.media != null,
                  filePath: msg.filePath || null,
                  textPreview: typeof msg.text === 'string' ? msg.text.slice(0, 80) : null,
                }
              };
            }
            return { ok: resp.ok, result: resp.result, info: resp.info, keys: Object.keys(resp).slice(0, 20) };
          } catch {
            return { raw: '[unserializable]' };
          }
        };

        const buildQuery = (parts) => {
          const sp = new URLSearchParams();
          Object.entries(parts || {}).forEach(([k, v]) => {
            if (!k) return;
            const val = v == null ? '' : String(v);
            if (!val) return;
            sp.set(String(k), val);
          });
          return sp.toString();
        };

        const urlSendCandidates = (() => {
          const q1 = buildQuery({ [urlParam]: link, ...(safeCaption ? { [captionParam]: safeCaption } : {}) });
          const q2 = buildQuery({ [toParam]: normalizedChatId, [urlParam]: link, ...(safeCaption ? { [captionParam]: safeCaption } : {}) });
          return [
            // Most common: /sendSessionFile/{number}?fileUrl=...
            `${watiMediaHost}${path}/${normalizedChatId}?${q1}`,
            // Alternate: /sendSessionFile?whatsappNumber=...&fileUrl=...
            `${watiMediaHost}${path}?${q2}`
          ];
        })();

        const jsonSendCandidates = (() => {
          const body1 = { [urlParam]: link, ...(safeCaption ? { [captionParam]: safeCaption } : {}) };
          const body2 = { [toParam]: normalizedChatId, [urlParam]: link, ...(safeCaption ? { [captionParam]: safeCaption } : {}) };
          return [
            // Alternate tenants expect payload JSON (no querystring)
            { url: `${watiMediaHost}${path}/${normalizedChatId}`, body: body1 },
            { url: `${watiMediaHost}${path}`, body: body2 },
          ];
        })();

        let lastErr = null;
        let forceUploadNow = false;

        // Attempt 1: pass a public URL to WATI.
        for (const candidateUrl of urlSendCandidates) {
          try {
            if (debugMediaSend) logger.debug({ candidateUrl }, '[WhatsAppBusiness] WATI sendImage attempt url');
            const resp = await this.makeRequest('POST', candidateUrl, null, 0, { Authorization: `Bearer ${this.apiKey}` });
            if (debugMediaSend) logger.debug({ response: debugRespSummary(resp) }, '[WhatsAppBusiness] WATI sendImage url response');

            if (watiRespIndicatesFailure(resp)) {
              const reason = watiRespFailureReason(resp);
              if (/file\s+can\s+not\s+be\s+null/i.test(reason || '')) {
                forceUploadNow = true;
              }
              throw new Error(`WATI sendSessionFile rejected${reason ? `: ${reason}` : ''}`);
            }

            // Some tenants return 200 but actually send a text message containing the URL (media=null).
            // Treat that as failure so we can try multipart upload.
            if (looksLikeTextEchoInsteadOfMedia(resp)) {
              throw new Error('WATI sendSessionFile returned text echo (media missing)');
            }

            const messageId = extractMessageId(resp);
            this.emit('sentImage', {
              chatId: normalizedChatId,
              imageUrl: link,
              caption: safeCaption,
              ts: Date.now(),
              messageId,
              status: 'sent',
              mode: 'wati-media-url'
            });
            return { success: true, messageId, mode: 'wati-media-url' };
          } catch (e) {
            if (debugMediaSend) logger.debug({ candidateUrl, err: e && e.message ? e.message : String(e || '') }, '[WhatsAppBusiness] WATI sendImage attempt url failed');
            lastErr = e;
            if (forceUploadNow) break;
          }
        }

        // Attempt 1b: some tenants expect JSON body, not query params.
        if (!forceUploadNow) {
          for (const candidate of jsonSendCandidates) {
            try {
              if (debugMediaSend) logger.debug({ candidateUrl: candidate.url }, '[WhatsAppBusiness] WATI sendImage attempt json');
              const resp = await this.makeRequest('POST', candidate.url, candidate.body, 0, { Authorization: `Bearer ${this.apiKey}` });
              if (debugMediaSend) logger.debug({ response: debugRespSummary(resp) }, '[WhatsAppBusiness] WATI sendImage json response');

              if (watiRespIndicatesFailure(resp)) {
                const reason = watiRespFailureReason(resp);
                if (/file\s+can\s+not\s+be\s+null/i.test(reason || '')) {
                  forceUploadNow = true;
                }
                throw new Error(`WATI sendSessionFile rejected${reason ? `: ${reason}` : ''}`);
              }

              if (looksLikeTextEchoInsteadOfMedia(resp)) {
                throw new Error('WATI sendSessionFile returned text echo (media missing)');
              }

              const messageId = extractMessageId(resp);
              this.emit('sentImage', {
                chatId: normalizedChatId,
                imageUrl: link,
                caption: safeCaption,
                ts: Date.now(),
                messageId,
                status: 'sent',
                mode: 'wati-media-json'
              });
              return { success: true, messageId, mode: 'wati-media-json' };
            } catch (e) {
              if (debugMediaSend) logger.debug({ candidateUrl: candidate.url, err: e && e.message ? e.message : String(e || '') }, '[WhatsAppBusiness] WATI sendImage attempt json failed');
              lastErr = e;
              if (forceUploadNow) break;
            }
          }
        }

        // Attempt 2 (fallback): download the image then upload as multipart.
        const allowDownloadUpload = envTruthy('WATI_MEDIA_DOWNLOAD_AND_UPLOAD', true);

        if (allowDownloadUpload) {
          try {
            if (debugMediaSend) logger.debug({ link }, '[WhatsAppBusiness] WATI sendImage attempting download+upload');
            const dl = await fetch(link, { method: 'GET' });
            if (!dl.ok) {
              throw new Error(`Failed to download image: HTTP ${dl.status} ${dl.statusText}`);
            }

            const lenHeader = dl.headers.get('content-length');
            const maxBytesRaw = parseInt(process.env.WATI_MEDIA_MAX_DOWNLOAD_BYTES || process.env.MAX_FILE_SIZE || '15728640', 10);
            const maxBytes = Number.isFinite(maxBytesRaw) && maxBytesRaw > 0 ? Math.min(50 * 1024 * 1024, maxBytesRaw) : 15 * 1024 * 1024;
            const contentLen = lenHeader ? parseInt(lenHeader, 10) : null;
            if (contentLen && Number.isFinite(contentLen) && contentLen > maxBytes) {
              throw new Error(`Image too large to upload: ${contentLen} bytes > ${maxBytes}`);
            }

            const contentType = (dl.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
            const arrayBuf = await dl.arrayBuffer();
            const blob = new Blob([arrayBuf], { type: contentType || 'application/octet-stream' });

            const fileName = (() => {
              try {
                const u = new URL(link);
                const p = String(u.pathname || '');
                const base = p.split('/').filter(Boolean).pop() || 'image';
                return base.length > 120 ? base.slice(0, 120) : base;
              } catch {
                return 'image';
              }
            })();

            const uploadCandidates = (() => {
              const qCaption = safeCaption ? `?${buildQuery({ [captionParam]: safeCaption })}` : '';
              const qTo = buildQuery({ [toParam]: normalizedChatId, ...(safeCaption ? { [captionParam]: safeCaption } : {}) });
              return [
                `${watiMediaHost}${path}/${normalizedChatId}${qCaption}`,
                `${watiMediaHost}${path}?${qTo}`,
              ];
            })();

            const parseOkBody = async (res) => {
              const ct = res.headers.get('content-type') || '';
              if (/application\/json/i.test(ct)) {
                try { return await res.json(); } catch { return {}; }
              }
              let text = '';
              try { text = await res.text(); } catch { text = ''; }
              if (!text) return {};
              try { return JSON.parse(text); } catch { return { rawText: text }; }
            };

            const parseErrBody = async (res, requestUrl) => {
              let body = null;
              try { body = await res.json(); } catch {
                try { body = await res.text(); } catch { body = res.statusText; }
              }
              const msg = (typeof body === 'string') ? body : (body && (body.error || body.message || body.info)) ? String(body.error || body.message || body.info) : '';
              throw new Error(JSON.stringify({ status: res.status, url: requestUrl, body, message: msg || undefined }));
            };

            for (const uploadUrl of uploadCandidates) {
              try {
                const makeForm = () => {
                  const fd = new FormData();
                  fd.append(formFileField, blob, fileName);
                  // Try providing caption in form body as well.
                  if (safeCaption) fd.append(captionParam, safeCaption);
                  // Some tenants expect destination number as form field.
                  fd.append(toParam, normalizedChatId);
                  return fd;
                };

                if (debugMediaSend) logger.debug({ uploadUrl, fileName, contentType }, '[WhatsAppBusiness] WATI sendImage upload attempt');
                const res = await fetch(uploadUrl, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${this.apiKey}` },
                  body: makeForm(),
                });

                if (!res.ok) {
                  await parseErrBody(res, uploadUrl);
                }

                const okBody = await parseOkBody(res);
                if (debugMediaSend) logger.debug({ response: debugRespSummary(okBody) }, '[WhatsAppBusiness] WATI sendImage upload response');

                if (watiRespIndicatesFailure(okBody)) {
                  const reason = watiRespFailureReason(okBody);
                  throw new Error(`WATI upload rejected${reason ? `: ${reason}` : ''}`);
                }

                const messageId = extractMessageId(okBody);
                this.emit('sentImage', {
                  chatId: normalizedChatId,
                  imageUrl: link,
                  caption: safeCaption,
                  ts: Date.now(),
                  messageId,
                  status: 'sent',
                  mode: 'wati-media-upload'
                });
                return { success: true, messageId, mode: 'wati-media-upload' };
              } catch (e) {
                if (debugMediaSend) logger.debug({ uploadUrl, err: e && e.message ? e.message : String(e || '') }, '[WhatsAppBusiness] WATI sendImage upload attempt failed');
                lastErr = e;
              }
            }
          } catch (e) {
            if (debugMediaSend) logger.debug({ err: e && e.message ? e.message : String(e || '') }, '[WhatsAppBusiness] WATI sendImage download+upload failed');
            lastErr = e;
          }
        }

        // If WATI media fails, fallback to text so the user still receives something.
        logger.error({ err: lastErr && lastErr.message ? lastErr.message : String(lastErr || '') }, '[WhatsAppBusiness] WATI sendImage media failed; falling back to text');
        const textFallback = [safeCaption, link].filter(Boolean).join('\n');
        const resp = await this.sendMessage(normalizedChatId, textFallback, {
          previewUrl: options.previewUrl,
          skipImageAutoDetect: true,
        });
        this.emit('sentImage', {
          chatId: normalizedChatId,
          imageUrl: link,
          caption: safeCaption,
          ts: Date.now(),
          status: 'sent',
          mode: 'wati-text-fallback-after-error'
        });
        return { ...resp, mode: 'wati-text-fallback-after-error' };
      }

      // Meta Graph API (Cloud API)
      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedChatId,
        type: 'image',
        image: {
          link,
          ...(safeCaption ? { caption: safeCaption } : {})
        }
      };

      const response = await this.makeRequest('POST', url, payload);
      const messageId = response.messages?.[0]?.id;

      this.emit('sentImage', {
        chatId: normalizedChatId,
        imageUrl: link,
        caption: safeCaption,
        ts: Date.now(),
        messageId,
        status: 'sent',
        mode: 'meta'
      });

      return { success: true, messageId, mode: 'meta' };
    } catch (err) {
      logger.error({ chatId: String(chatId || ''), err: err && err.message ? err.message : String(err) }, '[WhatsAppBusiness] ✗ Error mengirim image');
      this.emit('error', { chatId: String(chatId || ''), error: err.message || err });
      throw err;
    }
  }

  /**
   * Kirim generic template message
  async sendTemplate(chatId, templateName, variables = {}) {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to: chatId,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'id' }
        }
      };

      if (Object.keys(variables).length > 0) {
        payload.template.components = [{
          type: 'body',
          parameters: Object.values(variables).map(v => ({ type: 'text', text: String(v) }))
        }];
      }

      logger.info({ chatId, templateName }, `[WhatsAppBusiness] Mengirim template "${templateName}" ke ${chatId}`);
      const response = await this.makeRequest('POST', url, payload);
      
      this.emit('sent', { 
        chatId, 
        template: templateName, 
        messageId: response.messages?.[0]?.id 
      });

      return { success: true, messageId: response.messages?.[0]?.id };
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err), chatId }, '[WhatsAppBusiness] Template Error');
      throw err;
    }
  }

  /**
   * Send interactive button message
   */
  async sendButtons(chatId, text, buttons) {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: chatId,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text },
          action: {
            buttons: buttons.map((btn, idx) => ({
              type: 'reply',
              reply: {
                id: `btn_${idx}`,
                title: btn.label.substring(0, 20)
              }
            }))
          }
        }
      };

      const response = await this.makeRequest('POST', url, payload);
      this.emit('sent', { chatId, buttons, messageId: response.messages?.[0]?.id });
      return { success: true, messageId: response.messages?.[0]?.id };
    } catch (err) {
      logger.error({ err: err && err.message ? err.message : String(err), chatId }, '[WhatsAppBusiness] Buttons Error');
      throw err;
    }
  }

  /**
   * General HTTP request helper dengan retry logic
   */
  async makeRequest(method, url, data = null, retryCount = 0, headersOverride = {}) {
    try {
      const timeoutRaw = parseInt(process.env.WHATSAPP_API_TIMEOUT_MS || process.env.WATI_API_TIMEOUT_MS || '15000', 10);
      const timeoutMs = (Number.isFinite(timeoutRaw) && timeoutRaw > 0) ? timeoutRaw : 15000;
      const isWhatsvaRequest = isWhatsvaMode() || String(url || '').toLowerCase().includes('whatsva.id');
      const isFormBody = typeof FormData !== 'undefined' && data instanceof FormData;
      const isUrlEncodedBody = data instanceof URLSearchParams;
      const isStringBody = typeof data === 'string';
      const hasCustomContentType = Object.prototype.hasOwnProperty.call(headersOverride || {}, 'Content-Type') || Object.prototype.hasOwnProperty.call(headersOverride || {}, 'content-type');

      const options = {
        method,
        headers: {
          ...headersOverride
        }
      };

      if (!hasCustomContentType && !isFormBody && !isUrlEncodedBody && !isStringBody) {
        options.headers['Content-Type'] = 'application/json';
      }

      if (!isWhatsvaRequest && !options.headers.Authorization) {
        options.headers.Authorization = `Bearer ${this.apiKey}`;
      }

      if (data !== null && data !== undefined) {
        if (isFormBody || isUrlEncodedBody || isStringBody) {
          options.body = data;
        } else {
          options.body = JSON.stringify(data);
        }
      }

      // Avoid hanging forever on network/provider issues.
      // Node >= 20 supports AbortSignal.timeout().
      let response;
      try {
        const signal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
          ? AbortSignal.timeout(timeoutMs)
          : undefined;
        response = await fetch(url, { ...options, ...(signal ? { signal } : {}) });
      } catch (err) {
        const name = err && err.name ? String(err.name) : '';
        const msg = err && err.message ? String(err.message) : '';
        const looksLikeTimeout = name === 'AbortError' || /aborted|timeout/i.test(msg);
        if (looksLikeTimeout) {
          throw new Error(`HTTP request timed out after ${timeoutMs}ms`);
        }
        throw err;
      }
      
      if (response.status === 429) {
        // Rate limited - retry dengan backoff
        if (retryCount < this.maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          logger.warn(`[WhatsAppBusiness] Rate limited. Retry in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.makeRequest(method, url, data, retryCount + 1);
        }
      }

      if (!response.ok) {
        // Try to parse JSON body, otherwise fallback to text
        let errorBody = null;
        try {
          errorBody = await response.json();
        } catch (e) {
          try {
            errorBody = await response.text();
          } catch (_e) {
            errorBody = response.statusText;
          }
        }

        const isWatiUrl = String(url || '').toLowerCase().includes('wati');

        // Extract a meaningful error string from various response shapes.
        const pickErrorText = (body) => {
          if (typeof body === 'string') return body;
          if (!body || typeof body !== 'object') return '';
          if (typeof body.error === 'string') return body.error;
          if (typeof body.message === 'string') return body.message;
          if (typeof body.info === 'string') return body.info;
          if (typeof body.detail === 'string') return body.detail;
          if (typeof body.title === 'string') return body.title;
          if (Array.isArray(body.errors) && body.errors.length) {
            const first = body.errors[0];
            if (typeof first === 'string') return first;
            if (first && typeof first === 'object' && typeof first.message === 'string') return first.message;
          }
          return '';
        };

        const errorText = pickErrorText(errorBody);

        // WATI billing restriction: give an actionable message.
        // Example response: { error: 'Due to an outstanding invoice, access to APIs has been temporarily restricted...' }
        const isWatiBillingRestricted =
          response.status === 403 &&
          isWatiUrl &&
          /outstanding invoice|temporarily restricted|clear your dues/i.test(String(errorText || ''));

        if (isWatiBillingRestricted) {
          logger.error({ status: response.status, error: errorText }, '[WATI API Restricted]');
          throw new Error(
            'HTTP 403 - WATI API diblokir karena outstanding invoice/billing restriction. ' +
            'Selesaikan pembayaran/dues di dashboard WATI dulu, lalu coba kirim pesan lagi.'
          );
        }

        // WATI unauthorized: usually wrong API key or wrong tenant/endpoint.
        if (response.status === 401 && isWatiUrl) {
          logger.error({ status: response.status, error: errorText || null }, '[WATI Unauthorized]');
          throw new Error(
            'HTTP 401 - WATI unauthorized. Cek WHATSAPP_API_KEY masih valid, dan WHATSAPP_API_ENDPOINT benar (harus berisi tenant id, contoh: https://live-mt-server.wati.io/1095849).'
          );
        }

        logger.error({ status: response.status, method, url, body: errorBody }, '[WhatsAppBusiness API Error]');
        throw new Error(JSON.stringify({ status: response.status, method, url, body: errorBody }));
      }

      // Success responses are usually JSON, but some endpoints may return empty or plain text.
      const contentType = response.headers.get('content-type') || '';
      if (/application\/json/i.test(contentType)) {
        try {
          return await response.json();
        } catch {
          return {};
        }
      }

      let text = '';
      try {
        text = await response.text();
      } catch {
        text = '';
      }

      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { rawText: text };
      }
    } catch (err) {
      throw err;
    }
  }

  /**
   * Setup webhook untuk receive incoming messages
   */
  setupWebhook(app, verifyToken) {
    logger.info('[WhatsAppBusiness] Setting up webhook...');

    /**
     * GET /webhook - Verification dari Meta saat setup
     * URL harus accessible dari internet (gunakan ngrok untuk dev)
     */
    app.get('/webhook', (req, res) => {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      logger.debug({ mode, tokenMatch: token === verifyToken }, `[WhatsAppBusiness] Webhook verification: mode=${mode}, token_match=${token === verifyToken}`);

      if (mode === 'subscribe' && token === verifyToken) {
        logger.info('[WhatsAppBusiness] ✓ Webhook verified successfully');
        res.status(200).send(challenge);
      } else {
        logger.error('[WhatsAppBusiness] ✗ Webhook verification failed');
        res.status(403).send('Forbidden');
      }
    });

    /**
     * POST /webhook - Receive messages dan status updates
     */
    app.post('/webhook', (req, res) => {
      try {
        const body = req.body;

        // WATI integration: when WHATSAPP_API_ENDPOINT points to WATI, do not
        // rely on HMAC `WHATSAPP_APP_SECRET`. Instead accept WATI-style token
        // verification (header `x-wati-token` or query `token`) or the
        // configured `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. If none provided, accept
        // in non-production but log a warning.
        const isWatiWebhook = (process.env.WHATSAPP_API_ENDPOINT || '').includes('wati');

        if (isWatiWebhook) {
          const tokenHeader = req.headers['x-wati-token'] || req.headers['x-wati-signature'] || null;
          const tokenParam = (req.query && (req.query.token || req.query.verify_token)) || null;
          const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || null;
          const apiKey = process.env.WHATSAPP_API_KEY || null;

          if (tokenHeader && (tokenHeader === apiKey || tokenHeader === verifyToken)) {
            logger.info('[WhatsAppBusiness] ✓ WATI webhook accepted via header token');
          } else if (tokenParam && (tokenParam === apiKey || tokenParam === verifyToken)) {
            logger.info('[WhatsAppBusiness] ✓ WATI webhook accepted via query token');
          } else {
            if (process.env.NODE_ENV === 'production') {
              logger.error('[WhatsAppBusiness] ✗ Missing valid WATI webhook token');
              return res.status(403).send('Forbidden');
            } else {
              logger.warn('[WhatsAppBusiness] Warning: No WATI webhook token provided — accepting in non-production');
            }
          }
        } else {
          // Default behavior for Meta/Cloud: verify HMAC if APP_SECRET provided
          const signatureHeader = req.headers['x-hub-signature-256'] || req.headers['x-hub-signature'];
          const appSecret = process.env.WHATSAPP_APP_SECRET;

          if (appSecret) {
            if (signatureHeader) {
              try {
                const raw = req.rawBody || Buffer.from(JSON.stringify(body));
                const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
                const sigBuf = Buffer.from(signatureHeader);
                const expBuf = Buffer.from(expected);
                if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
                  logger.error('[WhatsAppBusiness] ✗ Webhook signature mismatch');
                  return res.status(403).send('Forbidden');
                }
              } catch (e) {
                logger.error({ err: e && e.message ? e.message : String(e) }, '[WhatsAppBusiness] ✗ Signature verification error');
                if (process.env.NODE_ENV === 'production') return res.status(403).send('Forbidden');
              }
            } else {
              const tokenParam = (req.query && (req.query.token || req.query.verify_token)) || null;
              const tokenHeader = req.headers['x-wati-token'] || req.headers['x-wati-signature'] || null;
              if (tokenParam === appSecret || tokenHeader === appSecret) {
                logger.info('[WhatsAppBusiness] ✓ Webhook accepted via token fallback');
              } else {
                logger.error('[WhatsAppBusiness] ✗ Missing signature header and token mismatch');
                if (process.env.NODE_ENV === 'production') return res.status(403).send('Forbidden');
              }
            }
          } else {
            if (process.env.NODE_ENV === 'production') {
              logger.error('[WhatsAppBusiness] ✗ WHATSAPP_APP_SECRET not configured in production');
              return res.status(403).send('Forbidden');
            } else {
              logger.warn('[WhatsAppBusiness] Warning: WHATSAPP_APP_SECRET not set, skipping signature verification');
            }
          }
        }
        
        // Acknowledge receipt immediately (Meta expects 200 OK within 5 seconds)
        res.status(200).send('ok');

        // If this is Meta/WhatsApp Cloud style payload, process as before.
        if (body.object === 'whatsapp_business_account') {
          const entries = body.entry || [];
          entries.forEach(entry => {
            const changes = entry.changes || [];
            changes.forEach(change => {
              // Handle incoming MESSAGES
              if (change.field === 'messages') {
                this.handleIncomingMessages(change.value);
              }

              // Handle MESSAGE STATUS UPDATES (read, delivered, sent, failed)
              if (change.field === 'message_status') {
                this.handleMessageStatus(change.value);
              }
            });
          });
          return;
        }

        // Fallback: detect WATI internal payload format (flat message object)
        // Example body fields seen: id, whatsappMessageId, conversationId, text, senderName, senderPhone
        if (body && (body.whatsappMessageId || body.id) && (body.text || body.type)) {
          try {
            logger.info('[WhatsAppBusiness] Detected WATI payload format - mapping to internal message format');
            const from = body.waId || body.senderPhone || body.senderPhoneNumber || body.from || body.senderId || body.sender || (body.messageContact && (body.messageContact.waId || body.messageContact.phone)) || null;

            // Jika tidak ada nomor pengirim yang jelas, kemungkinan ini
            // adalah event sistem / pesan keluar milik bot sendiri.
            if (!from) {
              logger.debug('[WhatsAppBusiness] WATI event tanpa sender - diabaikan');
              return;
            }

            // Opsional: abaikan pesan yang jelas-jelas dikirim dari nomor bot
            // sendiri (untuk mencegah looping). Set di .env:
            // WHATSAPP_BOT_NUMBER=62821xxxxxxx
            const botNumber = (process.env.WHATSAPP_BOT_NUMBER || '').replace(/\D/g, '');
            const fromNormalized = String(from).replace(/\D/g, '');
            if (botNumber && fromNormalized === botNumber) {
              logger.debug('[WhatsAppBusiness] WATI event dari nomor bot sendiri - diabaikan');
              return;
            }
            const text = typeof body.text === 'string' ? body.text : (body.messageText || body.text?.body || '');
            const msgId = body.whatsappMessageId || body.id;
            const ts = body.created ? (new Date(body.created).getTime()) : Date.now();

            const messages = [{
              from,
              id: msgId,
              timestamp: Math.floor((ts || Date.now()) / 1000),
              type: body.type || (text ? 'text' : 'unknown'),
              text: { body: text }
            }];

            const contacts = [{ profile: { name: body.senderName || (body.messageContact && body.messageContact.name) || body.sender || from || 'unknown' } }];

            // Call handler with a shape similar to Meta change.value
            this.handleIncomingMessages({ messages, contacts });
            return;
          } catch (e) {
            logger.error({ err: e && e.message ? e.message : String(e) }, '[WhatsAppBusiness] Error mapping WATI payload');
            return;
          }
        }

        logger.debug('[WhatsAppBusiness] Webhook: Not a WhatsApp event');

        const entries = body.entry || [];
        
        entries.forEach(entry => {
          const changes = entry.changes || [];
          
          changes.forEach(change => {
            // Handle incoming MESSAGES
            if (change.field === 'messages') {
              this.handleIncomingMessages(change.value);
            }
            
            // Handle MESSAGE STATUS UPDATES (read, delivered, sent, failed)
            if (change.field === 'message_status') {
              this.handleMessageStatus(change.value);
            }
          });
        });

      } catch (err) {
        logger.error({ err: err && err.message ? err.message : String(err) }, '[WhatsAppBusiness] Webhook Error');
        // Jangan throw - just log. Meta akan retry jika dapat error.
      }
    });
  }

  /**
   * Handle incoming messages dari WhatsApp
   */
  handleIncomingMessages(value) {
    const messages = value.messages || [];
    const contacts = value.contacts || [];

    messages.forEach((msg, idx) => {
      // Anti-looping: jika messageId sudah pernah diproses, abaikan
      if (msg.id && this.seenMessageIds.has(msg.id)) {
        logger.debug({ messageId: msg.id }, '[WhatsAppBusiness] Duplicate messageId diterima, diabaikan');
        return;
      }
      if (msg.id) {
        this.seenMessageIds.add(msg.id);
        // Batasi ukuran set di memori
        if (this.seenMessageIds.size > 1000) {
          this.seenMessageIds.clear();
        }
      }

      const from = msg.from;
      const contact = contacts[idx]?.profile?.name || from;
      const timestamp = parseInt(msg.timestamp) * 1000; // Convert to ms

      logger.info({ chatId: maskChatId(from), type: msg.type }, '[WhatsAppBusiness] Incoming message');

      // Handle TEXT messages
      if (msg.type === 'text') {
        const text = msg.text.body;

        // Anti-looping tambahan: jika dalam waktu singkat menerima
        // pesan TEXT yang sama dari chatId yang sama, abaikan duplikat.
        const prev = this.lastIncomingByChat.get(from);
        if (prev && prev.text === text && Math.abs(timestamp - prev.ts) < 5000) {
          logger.debug({ from: maskChatId(from), len: String(text || '').length }, '[WhatsAppBusiness] Duplicate text dalam window 5s, diabaikan');
          return;
        }
        this.lastIncomingByChat.set(from, { text, ts: timestamp });

        logger.info({ chatId: maskChatId(from), text: safeTextForLog(text, 160) }, '[WhatsAppBusiness] Text received');
        this.emit('message', { 
          chatId: from, 
          text, 
          contact, 
          ts: timestamp,
          messageId: msg.id,
          type: 'text'
        });
      }

      // Handle BUTTON replies
      if (msg.type === 'button') {
        const text = msg.button.text;
        logger.info({ chatId: maskChatId(from), text: safeTextForLog(text, 160) }, '[WhatsAppBusiness] Button reply received');
        this.emit('message', { 
          chatId: from, 
          text, 
          contact, 
          ts: timestamp,
          messageId: msg.id,
          type: 'button_reply'
        });
      }

      // Handle INTERACTIVE list replies
      if (msg.type === 'interactive') {
        const reply = msg.interactive.list_reply || msg.interactive.button_reply;
        if (reply) {
          const text = reply.title || reply.id;
          logger.info({ chatId: maskChatId(from), text: safeTextForLog(text, 160) }, '[WhatsAppBusiness] Interactive reply received');
          this.emit('message', { 
            chatId: from, 
            text, 
            contact, 
            ts: timestamp,
            messageId: msg.id,
            type: 'interactive_reply'
          });
        }
      }

      // Handle MEDIA (image, video, audio, document)
      if (['image', 'video', 'audio', 'document'].includes(msg.type)) {
        logger.info({ chatId: maskChatId(from), mediaType: msg.type }, '[WhatsAppBusiness] Media received');
        this.emit('message', { 
          chatId: from, 
          text: `[${msg.type.toUpperCase()}]`, 
          contact, 
          ts: timestamp,
          messageId: msg.id,
          type: msg.type,
          media: msg[msg.type]
        });
      }
    });
  }

  /**
   * Handle message status updates
   */
  handleMessageStatus(value) {
    const statuses = value.statuses || [];

    statuses.forEach(status => {
      logger.info({ status: status.status, messageId: status.id, chatId: maskChatId(status.recipient_id) }, '[WhatsAppBusiness] Status update received');
      
      this.emit('status', {
        messageId: status.id,
        chatId: status.recipient_id,
        status: status.status, // sent, delivered, read, failed
        timestamp: status.timestamp
      });
    });
  }

  /**
   * Check WhatsApp API connection
   */
  async healthCheck() {
    try {
      if (isWhatsvaMode()) {
        return {
          healthy: Boolean(getWhatsvaInstanceKey()),
          provider: 'whatsva',
          instanceKeyPresent: Boolean(getWhatsvaInstanceKey())
        };
      }

      if (isFonnteMode()) {
        return {
          healthy: Boolean(getFonnteToken()),
          provider: 'fonnte',
          tokenPresent: Boolean(getFonnteToken())
        };
      }

      if (!this.apiKey || !this.phoneNumberId) {
        return { healthy: false, error: 'WhatsApp API not configured' };
      }

      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}`;
      const response = await this.makeRequest('GET', url);
      
      return { 
        healthy: true, 
        phoneNumberId: this.phoneNumberId,
        displayPhoneNumber: response.display_phone_number,
        verifiedName: response.verified_name
      };
    } catch (err) {
      return { healthy: false, error: err.message };
    }
  }
}

module.exports = { WhatsAppBusinessProvider };
