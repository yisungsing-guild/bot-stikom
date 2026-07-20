function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (typeof raw === 'undefined') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function normalizeOutboundAnswerText(text) {
  let out = String(text || '');
  if (!out.trim()) return '';

  out = out.replace(/\u00A0/g, ' ');
  out = out.replace(/([A-Za-z0-9)\]])\s*(?:\u2026|\.{3})(?=\s*(?:\n|$))/g, '$1.');
  out = out.replace(/\b(per|pendaftar|pertanyaan|informasi|program|fasilitas|dokumen|syarat|jadwal|gelombang)(?:\u2026|\.{3})\s*$/i, '$1.');
  out = out.replace(/\n\s*Kalau mau lanjut, kakak bisa tanya:\s*$/i, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function stripOptionalFollowupSuggestions(text) {
  let out = String(text || '').trim();
  if (envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) return out;
  out = out.replace(/\n\s*(?:Kalau mau lanjut, kakak bisa tanya|Rekomendasi pertanyaan berikutnya):[\s\S]*$/i, '');
  out = out.replace(/(?:^|\n)\s*Kalau kakak mau, saya bisa (?:jelaskan|bantu jelaskan)[^\n]*\.?\s*/gi, '\n');
  out = out.replace(/\n\s*Agar saya bisa membantu lebih baik, coba tuliskan pertanyaan dengan lebih spesifik\.?\s*$/i, '');
  return out.trim();
}

function hasRawTechnicalLeak(text) {
  const out = String(text || '');
  return /\b(?:SOURCE_CHUNKS|CONFIDENCE|CONTEXT:|ASSIST_HINTS|TRACE_|relevance_audit|trainingId|docCategory|embedding)\b/i.test(out);
}

function hasLikelyRawDocumentLeak(text) {
  const out = String(text || '');
  const lower = out.toLowerCase();
  const legalMarkers = [
    /\bpasal\s+\d+/i,
    /\bpihak\s+pertama\b/i,
    /\bpihak\s+kedua\b/i,
    /\baddendum\b/i,
    /\bperjanjian\s+kerja\s+sama\b/i,
    /\bpara\s+pihak\b/i
  ];
  const faqMarkerCount = (out.match(/(?:^|\n)\s*(?:FAQ|Q|A|F|Question|Answer|Pertanyaan|Jawaban)\s*[:\-.]/gi) || []).length;
  const legalMarkerCount = legalMarkers.filter((re) => re.test(out)).length;
  return faqMarkerCount >= 3 || legalMarkerCount >= 2 || (lower.includes('pasal') && lower.includes('pihak pertama') && lower.includes('pihak kedua'));
}

function buildPreflightFallback(userQuery, reason) {
  const q = String(userQuery || '').toLowerCase();
  if (/\b(bccp|linkedin|career\s*center|softskill|bahasa|gccp)\b/i.test(q)) {
    return 'Mohon maaf, data yang saya pegang belum cukup lengkap untuk menjawab detail pertanyaan tersebut dengan aman. Jadi saya tidak akan menebak di luar informasi yang tersedia. Untuk detail resminya, kakak bisa konfirmasi ke admin kampus terkait.';
  }
  if (/\b(biaya|jadwal|gelombang|pendaftaran|beasiswa|syarat)\b/i.test(q)) {
    return 'Mohon maaf, jawaban yang tersedia belum cukup aman untuk dikirim sebagai informasi resmi. Kakak bisa konfirmasi ke admin PMB agar detail biaya, jadwal, atau syaratnya tidak keliru.';
  }
  return 'Mohon maaf, saya belum mempunyai jawaban yang cukup aman dan lengkap untuk pertanyaan itu berdasarkan data yang tersedia.';
}

function evaluateOutboundAnswer(answer, userQuery = '', meta = {}) {
  const original = String(answer || '');
  let text = normalizeOutboundAnswerText(stripOptionalFollowupSuggestions(original));
  const issues = [];

  if (!text.trim()) {
    issues.push('empty_answer');
    text = buildPreflightFallback(userQuery, 'empty_answer');
  }

  if (hasRawTechnicalLeak(text)) {
    issues.push('technical_leak');
    text = buildPreflightFallback(userQuery, 'technical_leak');
  } else if (hasLikelyRawDocumentLeak(text)) {
    issues.push('raw_document_leak');
    text = buildPreflightFallback(userQuery, 'raw_document_leak');
  }

  if (/\b(?:\w{2,})(?:\u2026|\.\.\.)\s*$/i.test(text)) {
    issues.push('dangling_ellipsis');
    text = normalizeOutboundAnswerText(text);
  }

  const maxSoftLen = parseInt(process.env.BOT_PREFLIGHT_SOFT_MAX_CHARS || '3200', 10);
  if (Number.isFinite(maxSoftLen) && maxSoftLen > 0 && text.length > maxSoftLen) issues.push('long_answer_split_expected');

  return {
    answer: text,
    changed: text !== original,
    issues,
    blocked: issues.includes('technical_leak') || issues.includes('raw_document_leak') || issues.includes('empty_answer'),
    meta: {
      source: meta && meta.source ? meta.source : null,
      originalLength: original.length,
      finalLength: text.length
    }
  };
}

module.exports = {
  evaluateOutboundAnswer,
  normalizeOutboundAnswerText,
  stripOptionalFollowupSuggestions,
  hasRawTechnicalLeak,
  hasLikelyRawDocumentLeak
};