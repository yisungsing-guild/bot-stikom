function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (typeof raw === 'undefined') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function normalizeOutboundAnswerText(text) {
  let out = String(text || '');
  if (!out.trim()) return '';

  out = out.replace(/\u00A0/g, ' ');
  out = out.replace(/\u00e2\u20ac\u00a6/g, '...');
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
    /\bimplementation\s+arrangement\b/i,
    /\bnota\s+kesepahaman\b/i,
    /\bpara\s+pihak\b/i,
    /\bforce\s+majeure\b/i,
    /\bmempunyai\s+kekuatan\s+hukum\s+yang\s+sama\b/i,
    /\b(?:nama|logo)\s+mitra\b/i
  ];
  const faqMarkerCount = (out.match(/(?:^|\n)\s*(?:FAQ|Q|A|F|Question|Answer|Pertanyaan|Jawaban)\s*[:\-.]/gi) || []).length;
  const legalMarkerCount = legalMarkers.filter((re) => re.test(out)).length;
  const placeholderLike = /_{5,}|\.{8,}|:{3,}|�{2,}|(?:nomor\s*:\s*(?:\.{4,}|�+|\([^)]*\)))/i.test(out);
  return faqMarkerCount >= 3 || legalMarkerCount >= 2 || (legalMarkerCount >= 1 && placeholderLike) || (lower.includes('pasal') && lower.includes('pihak pertama') && lower.includes('pihak kedua'));
}


const INTENT_PATTERNS = {
  fee: [/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal|potongan\s+biaya)\b/i],
  schedule: [/\b(jadwal|kapan|tanggal|periode|gelombang|dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan))\b/i],
  ukm: [/\b(ukm(?:nya)?|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|athena(?:\s+esports?)?|ghost|esports?|musik|futsal|basket|teater\s+biner|vos|kegiatan\s+mahasiswa)\b/i],
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

function normalizeForAlignment(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getContentTerms(text) {
  const stopwords = new Set([
    'apa', 'apakah', 'bagaimana', 'gimana', 'kalau', 'terkait', 'tentang', 'untuk',
    'yang', 'dengan', 'dalam', 'oleh', 'dari', 'itu', 'ini', 'kak', 'kakak', 'min',
    'saya', 'aku', 'mau', 'ingin', 'menanyakan', 'bertanya', 'baik', 'oke', 'ok',
    'punya', 'mempunyai', 'ada', 'saja', 'admin', 'tolong', 'jelaskan', 'info',
    'informasi', 'detail', 'lengkap', 'dong', 'ya', 'nih', 'nya', 'dan', 'atau',
    'di', 'ke', 'se', 'bisa', 'dapat', 'mohon'
  ]);
  const importantShortTerms = new Set([
    'ti', 'si', 'bd', 'sk', 'mi', 'llc', 'd3', 's1', 's2', 'dkv', 'trpl', 'tk',
    'mm', 'an', 'dg', 'rpl', 'utb', 'dnui', 'help', 'bccp', 'gccp'
  ]);
  return normalizeForAlignment(text)
    .split(/\s+/)
    .filter((term) => {
      const cleaned = String(term || '').toLowerCase();
      if (!cleaned) return false;
      return (cleaned.length >= 3 || importantShortTerms.has(cleaned)) && !stopwords.has(cleaned);
    });
}

function detectRequiredEntities(text) {
  const value = String(text || '').toLowerCase();
  const entities = [];
  const rules = [
    { key: 'gccp', patterns: [/\bgccp\b/i] },
    { key: 'bccp', patterns: [/\bbccp\b/i] },
    { key: 'linkedin', patterns: [/\blinked\s*in\b/i, /\blinkedin\b/i] },
    { key: 'language learning center', patterns: [/\blanguage\s+learning\s+center\b/i, /\bllc\b/i, /belajar\s+bahasa/i, /kemampuan\s+bahasa/i] },
    { key: 'career center', patterns: [/\bcareer\s*center\b/i, /pusat\s+kar(?:ir|ier)/i] },
    { key: 'softskill', patterns: [/\bsoft\s*skill\b/i, /\bsoftskill\b/i] },
    { key: 'ukm', patterns: [/\bukm\b/i, /ormawa/i, /unit\s+kegiatan\s+mahasiswa/i, /organisasi\s+mahasiswa/i] },
    { key: 'ksl', patterns: [/\bksl\b/i, /kelompok\s+studi\s+linux/i] },
    { key: 'athena', patterns: [/\bathena\b/i, /athena\s+esports?/i] },
    { key: 'ghost', patterns: [/\bghost\b/i] },
    { key: 'esport', patterns: [/\besports?\b/i, /athena\s+esports?/i] },
    { key: 'double degree', patterns: [/double\s*degree/i, /dual\s*degree/i, /gelar\s+ganda/i] },
    { key: 'dnui', patterns: [/\bdnui\b/i, /dalian\s+neusoft/i] },
    { key: 'utb', patterns: [/\butb\b/i, /universitas\s+teknologi\s+bandung/i] },
    { key: 'help', patterns: [/\bhelp\b/i, /help\s+university/i] },
    { key: 'sistem informasi', patterns: [/sistem\s+informasi/i, /\bsi\b/i] },
    { key: 'teknologi informasi', patterns: [/teknologi\s+informasi/i, /\bti\b/i] },
    { key: 'bisnis digital', patterns: [/bisnis\s+digital/i, /\bbd\b/i] },
    { key: 'sistem komputer', patterns: [/sistem\s+komputer/i, /\bsk\b/i] },
    { key: 'manajemen informatika', patterns: [/manajemen\s+informatika/i, /\bmi\b/i] }
  ];
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(value))) entities.push(rule.key);
  }
  return entities;
}

function answerMentionsEntity(answer, entity) {
  const value = normalizeForAlignment(answer);
  const aliases = {
    'language learning center': ['language learning center', 'llc', 'belajar bahasa', 'kemampuan bahasa'],
    'career center': ['career center', 'pusat karier', 'pusat karir'],
    ukm: ['ukm', 'ormawa', 'unit kegiatan mahasiswa', 'organisasi mahasiswa', 'kegiatan mahasiswa', 'wadah mahasiswa', 'komunitas mahasiswa', 'himpunan mahasiswa', 'kelompok studi'],
    athena: ['athena', 'athena esport', 'athena esports'],
    esport: ['esport', 'esports', 'athena esport', 'athena esports', 'kompetisi game', 'gaming'],
    ghost: ['ghost'],
    ksl: ['ksl', 'kelompok studi linux'],
    'double degree': ['double degree', 'dual degree', 'gelar ganda'],
    'sistem informasi': ['sistem informasi', 'si'],
    'teknologi informasi': ['teknologi informasi', 'ti'],
    'bisnis digital': ['bisnis digital', 'bd'],
    'sistem komputer': ['sistem komputer', 'sk'],
    'manajemen informatika': ['manajemen informatika', 'mi']
  };
  const terms = aliases[entity] || [entity];
  return terms.some((term) => value.includes(normalizeForAlignment(term)));
}

function detectAnswerQueryMismatch(answer, userQuery = '') {
  const queryTerms = getContentTerms(userQuery);
  const answerNorm = normalizeForAlignment(answer);
  const queryNorm = normalizeForAlignment(userQuery);
  const requestedEntities = detectRequiredEntities(userQuery);
  const missingEntities = requestedEntities.filter((entity) => !answerMentionsEntity(answer, entity));
  if (missingEntities.length) {
    return { mismatch: true, reason: 'missing_requested_entity', missingEntities, queryTerms };
  }

  const isVeryShortOrVague = queryNorm.length > 0 && queryTerms.length === 0 && queryNorm.split(/\s+/).filter(Boolean).length <= 3;
  if (isVeryShortOrVague && answerNorm.length > 80 && !/\b(?:halo|terima kasih|sama sama|baik)\b/i.test(answerNorm)) {
    return { mismatch: true, reason: 'ambiguous_short_query', missingEntities: [], queryTerms };
  }

  if (queryTerms.length >= 2) {
    const hits = queryTerms.filter((term) => answerNorm.includes(term));
    const hasIntentOverlap = detectIntentConflict(answer, userQuery).conflict === false
      && hasAnyIntent(detectIntentSet(answer), Array.from(detectIntentSet(userQuery)));
    if (!hits.length && !hasIntentOverlap && !requestedEntities.length) {
      return { mismatch: true, reason: 'no_query_term_overlap', missingEntities: [], queryTerms };
    }
  }

  return { mismatch: false, reason: null, missingEntities: [], queryTerms };
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

function hasExcessiveRawQuotation(answer) {
  const text = String(answer || '');
  const longLines = text.split(/\n+/).filter((line) => line.trim().length > 220).length;
  const quotedLines = text.split(/\n+/).filter((line) => /^\s*(?:>|"|�|')/.test(line.trim())).length;
  return longLines >= 2 || quotedLines >= 3;
}

function hasPlaceholderOrOcrNoise(answer) {
  const text = String(answer || '');
  return /_{4,}|\.{6,}|:{3,}|�{2,}|\b(?:left|right)\s+-?\d{3,}\b|\blogo\s+mitra\b|\(\s*nama\s+mitra\s*\)/i.test(text);
}

function isTooLongForQuestion(answer, userQuery) {
  const qWords = String(userQuery || '').trim().split(/\s+/).filter(Boolean).length;
  const answerLen = String(answer || '').length;
  if (qWords <= 3 && answerLen > 650) return true;
  if (qWords <= 8 && answerLen > 1800) return true;
  return false;
}

function lacksConcreteItemsForApaSaja(answer, userQuery) {
  if (!/\bapa\s+saja\b/i.test(String(userQuery || ''))) return false;
  const text = String(answer || '');
  const bulletCount = (text.match(/(?:^|\n)\s*(?:[-*�]|\d+\.)\s+\S/g) || []).length;
  const namedItems = (text.match(/\b(?:GCCP|BCCP|Double\s*Degree|Dual\s*Degree|Student\s+Exchange|UTB|DNUI|HELP|KIP|Prestasi|Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer)\b/gi) || []).length;
  const hasListLanguage = /\b(?:antara\s+lain|meliputi|terdiri\s+dari|tersedia|pilihan|program\s+mitra|beasiswa|program)\b/i.test(text);
  return bulletCount < 2 && namedItems < 2 && !hasListLanguage;
}

function decidePreflightAction(issues, meta = {}) {
  const hardIssues = new Set([
    'technical_leak',
    'raw_document_leak',
    'empty_answer',
    'intent_conflict',
    'missing_requested_entity',
    'ambiguous_short_query',
    'no_query_term_overlap',
    'placeholder_or_ocr_noise',
    'answer_query_mismatch',
    'apa_saja_without_concrete_items'
  ]);
  if (issues.some((issue) => hardIssues.has(issue))) {
    const regenerationCount = Number(meta.regenerationCount || meta.regenCount || 0);
    return regenerationCount < 2 ? 'regenerate' : 'fallback';
  }
  if (issues.includes('excessive_raw_quotation') || issues.includes('too_long_for_query') || issues.includes('long_answer_split_expected')) {
    return 'compress';
  }
  return 'send';
}
function evaluateOutboundAnswer(answer, userQuery = '', meta = {}) {
  const original = String(answer || '');
  let text = normalizeOutboundAnswerText(stripOptionalFollowupSuggestions(original));
  const issues = [];

  if (!text.trim()) {
    issues.push('empty_answer');
    text = buildPreflightFallback(userQuery, 'empty_answer');
  }

  if (!issues.length) {
    if (hasRawTechnicalLeak(text)) {
      issues.push('technical_leak');
      text = buildPreflightFallback(userQuery, 'technical_leak');
    } else if (hasLikelyRawDocumentLeak(text)) {
      issues.push('raw_document_leak');
      text = buildPreflightFallback(userQuery, 'raw_document_leak');
    } else if (hasPlaceholderOrOcrNoise(text)) {
      issues.push('placeholder_or_ocr_noise');
      text = buildPreflightFallback(userQuery, 'raw_document_leak');
    } else if (lacksConcreteItemsForApaSaja(text, userQuery)) {
      issues.push('apa_saja_without_concrete_items');
      text = buildPreflightFallback(userQuery, 'intent_conflict');
    } else {
      const alignmentAudit = detectAnswerQueryMismatch(text, userQuery);
      if (alignmentAudit.mismatch) {
        issues.push(alignmentAudit.reason || 'answer_query_mismatch');
        text = buildPreflightFallback(userQuery, 'intent_conflict');
      } else {
        const intentAudit = detectIntentConflict(text, userQuery);
        if (intentAudit.conflict) {
          issues.push('intent_conflict');
          text = buildPreflightFallback(userQuery, 'intent_conflict');
        }
      }
    }
  }

  if (/\b(?:\w{2,})(?:\u2026|\.\.\.)\s*$/i.test(text)) {
    issues.push('dangling_ellipsis');
    text = normalizeOutboundAnswerText(text);
  }

  const maxSoftLen = parseInt(process.env.BOT_PREFLIGHT_SOFT_MAX_CHARS || '3200', 10);
  if (Number.isFinite(maxSoftLen) && maxSoftLen > 0 && text.length > maxSoftLen) issues.push('long_answer_split_expected');
  if (hasExcessiveRawQuotation(original)) issues.push('excessive_raw_quotation');
  if (isTooLongForQuestion(original, userQuery)) issues.push('too_long_for_query');

  const action = decidePreflightAction(issues, meta);
  const blocked = action === 'regenerate' || action === 'fallback';

  return {
    answer: text,
    changed: text !== original,
    issues,
    action,
    blocked,
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
  detectIntentConflict,
  detectAnswerQueryMismatch
};
