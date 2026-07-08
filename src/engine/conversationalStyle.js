const { buildWhatsappConversationalReply } = require('../utils/whatsappFormatter');

// Conversational humanizer: one-paragraph natural opening, short interpretation, main answer, clear conclusion, and intent-specific follow-ups.
function decorateBotAnswerText(rawAnswerText, inboundUserText) {
  const raw = String(rawAnswerText || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return raw;

  const normalized = String(raw)
    .replace(/^\s*[-–—]{2,}\s*$/gm, '')
    .replace(/^\s*[-–—]{2,}\s*\n/gm, '')
    .replace(/^\s*(?:- --|--+|---+)\s*$/gm, '')
    .replace(/^\s*-\s*--\s*$/gm, '')
    .replace(/^\s*--+\s*$/gm, '')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/^\s*💡.*$/gm, '')
    .replace(/^\s*\*\*+\s*$/gm, '')
    .replace(/^\s*\uFE0F?\s*$/gm, '')
    .replace(/[ΓÇó•·◦⁃‣]/g, '-')
    .replace(/^\s*[🎓📚🧭💡].{0,6}\s*Kamu\s+ingin\s+tahu[^\n]*\n?/i, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(l => l.replace(/[\t ]+$/g, '').trimStart())
    .join('\n')
    .replace(/^\s*Kamu\s+ingin\s+tahu[^\n]*\n?/i, '')
    .trim();

  const skipWrap = /^(silakan|ketik|balas|pilih|maaf|terima kasih|sudah selesai|tunggu|admin|untuk melihat|klik|saya tidak|saya hanya bisa|jika|kalau)\b/i.test(normalized);
  if (skipWrap && normalized.length < 120) {
    return normalized;
  }

  try {
    return buildWhatsappConversationalReply({
      rawMainAnswer: normalized,
      userQuery: inboundUserText,
      includeMeta: true
    });
  } catch (e) {
    return normalized;
  }
}

module.exports = { decorateBotAnswerText };