const nodemailer = require('nodemailer');

function parseCsvEmails(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,\s]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.includes('@'));
}

function getEmailConfig() {
  const webhookUrl = String(process.env.EMAIL_WEBHOOK_URL || '').trim();
  const webhookSecret = String(process.env.EMAIL_WEBHOOK_SECRET || '').trim();
  const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = parseInt(String(process.env.SMTP_PORT || ''), 10) || null;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const from = String(process.env.RESEND_FROM || process.env.EMAIL_FROM || process.env.SMTP_FROM || '').trim();
  const recipients = parseCsvEmails(process.env.SUPERADMIN_NOTIFICATION_EMAILS || process.env.NOTIFICATION_EMAILS || '');
  const webhookEnabled = Boolean(webhookUrl && recipients.length);
  const resendEnabled = Boolean(resendApiKey && from && recipients.length);
  const smtpEnabled = Boolean(host && port && user && pass && from && recipients.length);

  return {
    enabled: webhookEnabled || resendEnabled || smtpEnabled,
    provider: webhookEnabled ? 'webhook' : (resendEnabled ? 'resend' : (smtpEnabled ? 'smtp' : 'none')),
    webhookUrl,
    webhookSecret,
    resendApiKey,
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true',
    auth: { user, pass },
    from,
    recipients,
  };
}

let transport;
function getTransport() {
  if (transport) return transport;
  const cfg = getEmailConfig();
  if (cfg.provider !== 'smtp') return null;

  transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
  });

  return transport;
}

function formatTrainingUploadMessage(payload) {
  const filename = payload.filename || 'Unknown file';
  const trainingId = payload.trainingDataId || '(not available)';
  const uploader = payload.uploaderDisplayName || payload.uploaderUsername || payload.uploaderRole || 'Unknown uploader';
  const divisionKey = payload.divisionKey || 'unknown';
  const source = payload.source || 'upload';
  const createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString();
  const link = payload.link || '';
  const fileSize = payload.fileSize != null ? `${payload.fileSize} bytes` : 'unknown size';

  const textLines = [
    `Dokumen training baru telah diupload oleh ${uploader}.`,
    '',
    `File: ${filename}`,
    `Training ID: ${trainingId}`,
    `Sumber: ${source}`,
    `Divisi: ${divisionKey}`,
    `Ukuran: ${fileSize}`,
    `Waktu upload: ${createdAt}`,
    '',
    `Link review: ${link || 'tidak tersedia'}`,
  ];

  if (payload.contentPreview) {
    textLines.push('', 'Preview isi dokumen (potongan):', payload.contentPreview);
  }

  return textLines.join('\n');
}

function buildTrainingUploadHtml(payload) {
  return `
    <p>Dokumen training baru telah diupload oleh <strong>${escapeHtml(payload.uploaderDisplayName || payload.uploaderUsername || 'Admin')}</strong>.</p>
    <ul>
      <li><strong>File</strong>: ${escapeHtml(payload.filename || 'Unknown file')}</li>
      <li><strong>Training ID</strong>: ${escapeHtml(payload.trainingDataId || '(not available)')}</li>
      <li><strong>Divisi</strong>: ${escapeHtml(payload.divisionKey || 'unknown')}</li>
      <li><strong>Ukuran</strong>: ${escapeHtml(payload.fileSize != null ? `${payload.fileSize} bytes` : 'unknown size')}</li>
      <li><strong>Waktu upload</strong>: ${escapeHtml(payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString())}</li>
    </ul>
    ${payload.link ? `<p><a href="${escapeHtml(payload.link)}">Klik untuk review di panel admin</a></p>` : ''}
    ${payload.contentPreview ? `<p><strong>Preview isi dokumen:</strong><br/><pre style="white-space: pre-wrap;">${escapeHtml(payload.contentPreview)}</pre></p>` : ''}
  `;
}

function getEmailTimeoutMs() {
  return parseInt(String(process.env.EMAIL_SEND_TIMEOUT_MS || '15000'), 10) || 15000;
}

async function readJsonResponse(response) {
  const raw = await response.text().catch(() => '');
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { raw, data };
}

async function sendViaWebhook(cfg, message, payload) {
  if (typeof fetch !== 'function') {
    return { ok: false, provider: 'webhook', error: 'Global fetch is not available in this Node.js runtime' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getEmailTimeoutMs());

  try {
    const response = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'whatsapp-bot-system/0.1.0',
      },
      body: JSON.stringify({
        secret: cfg.webhookSecret || null,
        to: cfg.recipients,
        subject: message.subject,
        text: message.text,
        html: message.html,
        payload,
      }),
      signal: controller.signal,
    });

    const { raw, data } = await readJsonResponse(response);
    const scriptOk = data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'ok')
      ? !!data.ok
      : response.ok;

    if (!response.ok || !scriptOk) {
      return {
        ok: false,
        provider: 'webhook',
        status: response.status,
        error: typeof data === 'object' && data && (data.error || data.message) ? (data.error || data.message) : raw || response.statusText,
        details: data,
      };
    }

    return { ok: true, provider: 'webhook', info: data || { status: response.status } };
  } catch (err) {
    return { ok: false, provider: 'webhook', error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaResend(cfg, message) {
  if (typeof fetch !== 'function') {
    return { ok: false, provider: 'resend', error: 'Global fetch is not available in this Node.js runtime' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getEmailTimeoutMs());

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.resendApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'whatsapp-bot-system/0.1.0',
      },
      body: JSON.stringify({
        from: cfg.from,
        to: cfg.recipients,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: controller.signal,
    });

    const { raw, data } = await readJsonResponse(response);
    if (!response.ok) {
      return {
        ok: false,
        provider: 'resend',
        status: response.status,
        error: typeof data === 'object' && data && data.message ? data.message : raw || response.statusText,
        details: data,
      };
    }

    return { ok: true, provider: 'resend', info: data };
  } catch (err) {
    return { ok: false, provider: 'resend', error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaSmtp(cfg, message) {
  const transporter = getTransport();
  if (!transporter) {
    return { ok: false, disabled: true, provider: 'smtp', reason: 'Failed to create email transport' };
  }

  const info = await transporter.sendMail({
    from: cfg.from,
    to: cfg.recipients.join(','),
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  return { ok: true, provider: 'smtp', info };
}

async function sendTrainingUploadNotification(payload = {}) {
  try {
    const cfg = getEmailConfig();
    if (!cfg.enabled) {
      return { ok: false, disabled: true, provider: 'none', reason: 'Email notification is not configured' };
    }

    const message = {
      subject: `Notifikasi Upload Training: ${payload.filename || 'dokumen baru'}`,
      text: formatTrainingUploadMessage(payload),
      html: buildTrainingUploadHtml(payload),
    };

    if (cfg.provider === 'webhook') {
      return await sendViaWebhook(cfg, message, payload);
    }

    if (cfg.provider === 'resend') {
      return await sendViaResend(cfg, message);
    }

    return await sendViaSmtp(cfg, message);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  sendTrainingUploadNotification,
  getEmailConfig,
};