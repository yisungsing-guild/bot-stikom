const nodemailer = require('nodemailer');

function parseCsvEmails(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[;,\s]+/)
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.includes('@'));
}

function getEmailConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = parseInt(String(process.env.SMTP_PORT || ''), 10) || null;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  const from = String(process.env.EMAIL_FROM || process.env.SMTP_FROM || '').trim();
  const recipients = parseCsvEmails(process.env.SUPERADMIN_NOTIFICATION_EMAILS || process.env.NOTIFICATION_EMAILS || '');
  const enabled = Boolean(host && port && user && pass && from && recipients.length);

  return {
    enabled,
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
  if (!cfg.enabled) return null;

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

async function sendTrainingUploadNotification(payload = {}) {
  try {
    const cfg = getEmailConfig();
    if (!cfg.enabled) {
      return { ok: false, disabled: true, reason: 'Email notification is not configured' };
    }

    const transporter = getTransport();
    if (!transporter) {
      return { ok: false, disabled: true, reason: 'Failed to create email transport' };
    }

    const subject = `Notifikasi Upload Training: ${payload.filename || 'dokumen baru'}`;
    const html = `
      <p>Dokumen training baru telah diupload oleh <strong>${payload.uploaderDisplayName || payload.uploaderUsername || 'Admin'}</strong>.</p>
      <ul>
        <li><strong>File</strong>: ${payload.filename || 'Unknown file'}</li>
        <li><strong>Training ID</strong>: ${payload.trainingDataId || '(not available)'}</li>
        <li><strong>Divisi</strong>: ${payload.divisionKey || 'unknown'}</li>
        <li><strong>Ukuran</strong>: ${payload.fileSize != null ? `${payload.fileSize} bytes` : 'unknown size'}</li>
        <li><strong>Waktu upload</strong>: ${payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString()}</li>
      </ul>
      ${payload.link ? `<p><a href="${payload.link}">Klik untuk review di panel admin</a></p>` : ''}
      ${payload.contentPreview ? `<p><strong>Preview isi dokumen:</strong><br/><pre style="white-space: pre-wrap;">${escapeHtml(payload.contentPreview)}</pre></p>` : ''}
    `;

    const info = await transporter.sendMail({
      from: cfg.from,
      to: cfg.recipients.join(','),
      subject,
      text: formatTrainingUploadMessage(payload),
      html,
    });

    return { ok: true, info };
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
