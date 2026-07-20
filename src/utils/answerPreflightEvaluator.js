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
  out = out.replace(/\n\s*Kalau Kakak ingin tahu lebih lanjut, mungkin pertanyaan berikut(?:nya)? juga bisa membantu:[\s\S]*$/i, '');
  out = out.replace(/(?:^|\n)\s*Kalau kakak mau, saya (?:juga )?bisa (?:tampilkan|jelaskan|bantu jelaskan)[^\n]*\.?\s*/gi, '\n');
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


const INTENT_PATTERNS = {
  fee: [/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal|potongan\s+biaya)\b/i],
  schedule: [/\b(jadwal|kapan|tanggal|periode|gelombang|dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan))\b/i],
  ukm: [/\b(ukm(?:nya)?|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|athena\s+esports?|esports?|musik|futsal|basket|teater\s+biner|vos|kegiatan\s+mahasiswa)\b/i],
  scholarship: [/\b(beasiswa|kip|1k1s|bantuan\s+biaya|potongan\s+dpp|prestasi)\b/i],
  double_degree: [/\b(double\s*degree|dual\s*degree|utb|dnui|help\s+university|gelar\s+ganda)\b/i],
  facility: [/\b(fasilitas|layanan|sarana|prasarana|career\s*center|inkubator\s+bisnis|language\s+learning\s+center|softskill|gccp|bccp|belajar\s+bahasa|kemampuan\s+bahasa)\b/i],
  program: [/\b(prodi|program\s+studi|jurusan|s1|d3|s2|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/i],
  registration: [/\b(cara\s+daftar|mendaftar|registrasi|pendaftaran\s+online|syarat\s+(?:daftar|pendaftaran)|dokumen\s+pendaftaran)\b/i]
};

const OFF_TOPIC_INTENTS = {
  ukm: ['fee', 'schedule', 'scholarship', 'double_degree', 'registration'],
  fee: ['ukm', 'facility', 'double_degree'],
  schedule: ['ukm', 'facility', 'double_degree', 'scholarship'],
  scholarship: ['ukm', 'facility', 'double_degree'],
  double_degree: ['ukm', 'fee', 'scholarship'],
  facility: ['fee', 'schedule', 'scholarship', 'double_degree'],
  registration: ['ukm', 'facility', 'double_degree']
};

function detectIntentSet(text) {
  const out = new Set();
  const value = String(text || '');
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some((re) => re.test(value))) out.add(intent);
  }
  return out;
}

function hasAnyIntent(intentSet, intents) {
  return intents.some((intent) => intentSet.has(intent));
}

function detectIntentConflict(answer, userQuery = '') {
  const requested = detectIntentSet(userQuery);
  const answered = detectIntentSet(answer);
  if (!requested.size || !answered.size) {
    return { conflict: false, requested: Array.from(requested), answered: Array.from(answered) };
  }

  const compatible = new Map([
    ['scholarship', ['fee']],
    ['fee', ['scholarship']],
    ['double_degree', ['program', 'facility']],
    ['program', ['double_degree', 'career']],
    ['facility', ['ukm']]
  ]);

  for (const intent of requested) {
    const accepted = new Set([intent, ...(compatible.get(intent) || [])]);
    if (Array.from(accepted).some((item) => answered.has(item))) continue;
    const offTopic = OFF_TOPIC_INTENTS[intent] || [];
    if (hasAnyIntent(answered, offTopic)) {
      return {
        conflict: true,
        requested: Array.from(requested),
        answered: Array.from(answered),
        missingIntent: intent
      };
    }
  }

  return { conflict: false, requested: Array.from(requested), answered: Array.from(answered) };
}
function extractFallbackTopicLabel(userQuery) {
  const q = String(userQuery || '').toLowerCase();
  if (!q.trim()) return '';
  const topics = [
    { label: 'BCCP', re: /\bbccp\b/i },
    { label: 'GCCP', re: /\bgccp\b/i },
    { label: 'program LinkedIn di Career Center', re: /\blinked\s*in|linkedin\b/i },
    { label: 'Career Center', re: /\bcareer\s*center|pusat\s+karier|pusat\s+karir\b/i },
    { label: 'pengembangan softskill', re: /\bsoftskill|pengembangan\s+soft\s*skill\b/i },
    { label: 'fasilitas belajar bahasa atau Language Learning Center', re: /\bbahasa|belajar\s+bahasa|kemampuan\s+bahasa|language\s+learning\s+center|llc\b/i },
    { label: 'UKM atau Ormawa', re: /\bukm(?:nya)?|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|esport|esports|musik|futsal|basket|teater|vos\b/i },
    { label: 'rincian biaya kuliah', re: /\bbiaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal\b/i },
    { label: 'jadwal pendaftaran PMB', re: /\bjadwal|kapan|tanggal|periode|gelombang|masih\s+dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan)\b/i },
    { label: 'beasiswa atau potongan biaya', re: /\bbeasiswa|kip|1k1s|bantuan\s+biaya|potongan|diskon|prestasi\b/i },
    { label: 'pendaftaran mahasiswa baru', re: /\bcara\s+daftar|mendaftar|registrasi|pendaftaran\s+online|syarat\s+(?:daftar|pendaftaran)|pmb|mahasiswa\s+baru|camaba\b/i },
    { label: 'kebijakan akademik', re: /\bremedial|remidi|absensi|presensi|kehadiran|ujian\s+susulan|ujian\s+ulang|dispensasi|izin\b/i },
    { label: 'program Double Degree', re: /\bdouble\s*degree|dual\s*degree|gelar\s+ganda|utb|dnui|help\s+university\b/i },
    { label: 'program studi atau jurusan', re: /\bprodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer\b/i },
    { label: 'fasilitas kampus', re: /\bfasilitas|layanan|sarana|prasarana|parkir|kantin|perpustakaan|wifi|laboratorium|ruang\s+kelas\b/i }
  ];
  const found = topics.find((item) => item.re.test(q));
  if (found) return found.label;
  const named = String(userQuery || '').match(/\b(?:program|fasilitas|layanan|ukm)\s+([A-Za-z0-9][A-Za-z0-9 ._-]{2,50}?)(?:\s+(?:itu|ini|apa|bagaimana|gimana|ya|kak|min|admin)|[?.!,]|$)/i);
  return named && named[0] ? named[0].replace(/[?.!,]+$/g, '').trim() : '';
}

function buildGenericPreflightFallback(userQuery, reason) {
  const topic = extractFallbackTopicLabel(userQuery);
  if (!topic) return '';
  if (reason === 'intent_conflict') {
    return 'Mohon maaf, jawaban yang terbentuk belum sesuai dengan pertanyaan kakak tentang ' + topic + ', jadi saya tahan agar tidak mengirim informasi yang keliru. Boleh kirim ulang pertanyaannya dengan topik yang lebih spesifik?';
  }
  return 'Untuk ' + topic + ', data yang saya pegang belum cukup lengkap atau belum cukup aman untuk menjawab detailnya. Jadi saya tidak akan menebak di luar informasi yang tersedia. Untuk detail resminya, kakak bisa konfirmasi ke admin kampus/PMB terkait.';
}
function buildPreflightFallback(userQuery, reason) {
  const topicFallback = buildGenericPreflightFallback(userQuery, reason);
  if (topicFallback) return topicFallback;
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
  } else {
    const intentAudit = detectIntentConflict(text, userQuery);
    if (intentAudit.conflict) {
      issues.push('intent_conflict');
      text = buildPreflightFallback(userQuery, 'intent_conflict');
    }
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
    blocked: issues.includes('technical_leak') || issues.includes('raw_document_leak') || issues.includes('empty_answer') || issues.includes('intent_conflict'),
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
  hasLikelyRawDocumentLeak,
  detectIntentConflict
};
