const DEFAULT_MAX_EVIDENCE = 5;
const { truncateEvidenceSafely } = require('../utils/contextTruncation');
const { getEvidenceRequirements, isScholarshipAligned, containsCurrency } = require('../utils/evidenceRequirements');
const { verifyAnswerAgainstContract } = require('./semanticContract');

const STOPWORDS = new Set([
  'yang', 'dengan', 'dalam', 'oleh', 'dari', 'itu', 'ini', 'kak', 'kakak', 'min',
  'saya', 'aku', 'mau', 'ingin', 'punya', 'mempunyai', 'memiliki', 'ada', 'saja',
  'admin', 'tolong', 'dong', 'ya', 'nih', 'nya', 'dan', 'atau', 'di', 'ke', 'se',
  'bisa', 'dapat', 'mohon', 'dimiliki'
]);

const ENTITY_RULES = [
  { key: 'sistem informasi', aliases: ['sistem informasi', 'si'] },
  { key: 'teknologi informasi', aliases: ['teknologi informasi', 'ti'] },
  { key: 'bisnis digital', aliases: ['bisnis digital', 'bd'] },
  { key: 'sistem komputer', aliases: ['sistem komputer', 'sk'] },
  { key: 'manajemen informatika', aliases: ['manajemen informatika', 'mi'] },
  { key: 'double degree', aliases: ['double degree', 'dual degree', 'gelar ganda'] },
  { key: 'utb', aliases: ['utb', 'universitas teknologi bandung'] },
  { key: 'dnui', aliases: ['dnui', 'dalian neusoft'] },
  { key: 'help', aliases: ['help university', 'help'] },
  { key: 'akreditasi', aliases: ['akreditasi', 'ban pt', 'ban-pt', 'baik sekali'] },
  { key: 'rpl', aliases: ['rpl', 'rekognisi pembelajaran lampau'] },
  { key: 'beasiswa', aliases: ['beasiswa', 'kip', '1k1s', 'skss', 'potongan biaya'] },
  { key: 'visa study', aliases: ['visa study', 'visa studi', 'visa pelajar', 'izin belajar', 'study permit', 'itas', 'kitas', 'sktt'] },
  { key: 'inbis', aliases: ['inbis', 'inkubator bisnis', 'business incubator'] },
  { key: 'cdc', aliases: ['cdc', 'career development center', 'career center', 'pusat karier', 'pusat karir'] },
  { key: 'faq', aliases: ['faq', 'qna', 'pertanyaan jawaban', 'tanya jawab'] },
  { key: 'gccp', aliases: ['gccp'] },
  { key: 'bccp', aliases: ['bccp'] },
  { key: 'career center', aliases: ['career center', 'pusat karier', 'pusat karir'] },
  { key: 'language learning center', aliases: ['language learning center', 'llc', 'belajar bahasa'] },
  { key: 'bem', aliases: ['bem', 'badan eksekutif mahasiswa'] },
  { key: 'ukm', aliases: ['ukm', 'unit kegiatan mahasiswa', 'kelompok studi'] }
];

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value) {
  return String(value || '')
    .replace(/[\u00a0]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanFaqMarkers(value) {
  return compactText(value)
    .replace(/\b(?:FAQ|QNA)\s*[:.-]\s*/gi, '')
    .replace(/\b(?:Question|Pertanyaan|Tanya|Q|F)\s*[:.-]\s*/gi, '')
    .replace(/\b(?:Answer|Jawaban|Jawab|A)\s*[:.-]\s*/gi, '')
    .replace(/\((?:F|Q|A)\)\s*/gi, '')
    .trim();
}

function getContentTerms(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((term) => term.length >= 2 && !STOPWORDS.has(term));
}

function includesAlias(normalized, alias) {
  const target = normalizeText(alias);
  if (!target) return false;
  if (target.length <= 3) return new RegExp(`(^|\\s)${target}(\\s|$)`, 'i').test(normalized);
  return normalized.includes(target);
}

function detectEntities(value) {
  const normalized = normalizeText(value);
  const entities = [];
  for (const rule of ENTITY_RULES) {
    if (rule.aliases.some((alias) => includesAlias(normalized, alias))) entities.push(rule.key);
  }
  const pasal = String(value || '').match(/\bpasal\s+(\d+[a-z]?)\b/i);
  if (pasal) entities.push(`pasal ${pasal[1].toLowerCase()}`);
  return entities;
}

function detectIntent(question, intent) {
  const q = String(question || '');
  const explicit = String(intent || '').trim().toLowerCase();
  if (explicit && explicit !== 'unknown' && explicit !== 'general') return explicit;
  if (/\b(pasal|ayat|force\s+majeure|addendum|perjanjian|klausul|isi\s+pasal)\b/i.test(q)) return 'legal';
  if (/\b(beasiswa|bantuan\s+biaya|potongan|kip|1k1s|skss)\b/i.test(q)) return 'scholarship';
  if (/\b(akreditasi|ban\s*-?\s*pt|peringkat)\b/i.test(q)) return 'accreditation';
  if (/\b(rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(q)) return 'rpl';
  if (/\b(visa\s+(?:study|studi|pelajar)|izin\s+belajar|study\s+permit|itas|kitas|sktt|mahasiswa\s+asing)\b/i.test(q)) return 'visa_study';
  if (/\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|study\s+exchange|mitra\s+luar|luar\s+negeri|gccp|bccp|utb|dnui|help)\b/i.test(q)) return 'international_program';
  if (/\b(inbis|inkubator\s+bisnis|career\s*(?:development\s*)?center|cdc|pusat\s+karier|pusat\s+karir)\b/i.test(q)) return 'campus_service';
  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal)\b/i.test(q)) return 'fee';
  if (/\b(jadwal|kapan|tanggal|periode|gelombang|jam|waktu|bulan\s+(?:ini|depan))\b/i.test(q)) return 'schedule';
  if (/\b(syarat|persyaratan|dokumen|berkas|ketentuan)\b/i.test(q)) return 'requirement';
  if (/\b(apa\s+saja|daftar|list|pilihan|macam)\b/i.test(q)) return 'list';
  if (/\b(program\s+studi|prodi|jurusan)\b/i.test(q)) return 'program';
  return 'general';
}

function isExplicitLegalQuestion(question, intent) {
  return detectIntent(question, intent) === 'legal'
    || /\b(pasal|ayat|force\s+majeure|addendum|klausul|isi\s+perjanjian|isi\s+pasal)\b/i.test(String(question || ''));
}

function isPlaceholderOrOcrNoise(text) {
  const value = String(text || '');
  const normalized = normalizeText(value);
  if (!normalized || normalized.length < 18) return true;
  if (/_{4,}|\.{6,}|:{3,}|â€¦{2,}|(?:\(\s*nama\s+mitra\s*\))|(?:nomor\s*:\s*(?:\.{4,}|â€¦+))/i.test(value)) return true;
  if (/\b(?:left|right)\s+-?\d{3,}\b/i.test(value) || /\blogo\s+mitra\b/i.test(value)) return true;
  const alpha = (value.match(/[a-zA-Z\p{L}]/gu) || []).length;
  const punct = (value.match(/[._:;,\-â€“â€”â€¦]/g) || []).length;
  return alpha > 0 && punct / Math.max(alpha, 1) > 0.7;
}

function isLegalBoilerplate(text) {
  return /\b(?:pasal\s+\d+|ayat\s*\(\d+\)|pihak\s+kesatu|pihak\s+pertama|pihak\s+kedua|para\s+pihak|force\s+majeure|addendum|bermeterai|mempunyai\s+kekuatan\s+hukum|nomor\s*:|alamat\s+telepon\s+e\s*-?\s*mail|tanda\s+tangan|perjanjian\s+kerja\s+sama|nota\s+kesepahaman|korespondensi)\b/i.test(String(text || ''));
}

// Deteksi dokumen mentaw yang lebih ketat â€” pola yang menandakan chunk berisi
// dokumen hukum/administratif mentaw (bukan ringkasan yang sudah diproses).
// Digunakan di lax fallback dan sebagai lapisan pertahanan tambahan.
function isLikelyRawDocument(text) {
  const value = String(text || '');
  if (!value || value.length < 40) return false;

  // Hitung jumlah marker dokumen mentaw
  const markers = [
    /\bpasal\s+\d+[a-z]?\b/i,
    /\bayat\s*\(\s*\d+\s*\)/i,
    /\bpihak\s+(?:kesatu|pertama|kedua)\b/i,
    /\bpara\s+pihak\b/i,
    /\bperjanjian\s+kerja\s+sama\b/i,
    /\bnota\s+kesepahaman\b/i,
    /\bforce\s+majeure\b/i,
    /\baddendum\b/i,
    /\bbermeterai\b/i,
    /\bmempunyai\s+kekuatan\s+hukum\s+yang\s+sama\b/i,
    /\b(?:menimbang|mengingat|memutuskan|ditetapkan|dipertimbulkan)\s*:/i,
    /\bnomor\s*:\s*\d+\s*\/\s*SK\b/i,
    /\b(?:tanda\s+tangan|berstempel|stempel|tembusan|lampiran|perihal)\b/i,
    /\balamat\s+telepon\s+e\s*-?\s*mail\b/i,
    /\btemplate\s+(?:PKS|kontrak|perjanjian)\b/i,
    /\b(?:nama|logo)\s+mitra\s*(?:\.{4,}|\?{4,})?\b/i,
    /\bJalan\s+Raya\s+Puputan\s+Nomor\s+86\b/i
  ];

  const markerCount = markers.filter((re) => re.test(value)).length;
  if (markerCount >= 2) return true;

  // Jika ada satu marker kuat + placeholder noise, anggap dokumen mentaw
  const placeholderLike = /_{5,}|\.{6,}|:{3,}|â€¦{2,}|(?:nomor\s*:\s*(?:\.{4,}|â€¦+))/i.test(value);
  if (markerCount >= 1 && placeholderLike) return true;

  // Deteksi dokumen mentaw dengan pola "Pasal X ... PIHAK KESATU ... PIHAK KEDUA"
  if (/\bpasal\b/i.test(value) && /\bpihak\s+(?:kesatu|pertama|kedua)\b/i.test(value)) return true;


  return false;
}

function shouldRejectEvidenceUnit(text, question, intent) {
  const allowLegal = isExplicitLegalQuestion(question, intent);
  if (isPlaceholderOrOcrNoise(text)) return { reject: true, reason: 'placeholder_or_ocr_noise' };
  if (!allowLegal && isLegalBoilerplate(text)) return { reject: true, reason: 'legal_boilerplate_not_requested' };
  if (/\b(?:demikian|dibuat\s+dan\s+ditandatangani|dipergunakan\s+sebagaimana\s+mestinya)\b/i.test(text) && !allowLegal) {
    return { reject: true, reason: 'document_footer_boilerplate' };
  }
  return { reject: false, reason: '' };
}

function splitSentences(paragraph) {
  const value = compactText(paragraph);
  if (!value) return [];
  if (value.length <= 420) return [value];
  return value
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(compactText)
    .filter((part) => part.length >= 18);
}

function extractRequestedLegalSection(text, question) {
  const match = String(question || '').match(/\bpasal\s+(\d+[a-z]?)\b/i);
  if (!match) return [];
  const number = match[1].toLowerCase();
  const source = String(text || '');
  const re = new RegExp(`\\bPasal\\s+${number}\\b[\\s\\S]*?(?=\\bPasal\\s+\\d+[a-z]?\\b|$)`, 'i');
  const found = source.match(re);
  return found && found[0] ? [compactText(found[0])] : [];
}

function splitFaqEvidenceUnits(text) {
  const source = compactText(text);
  if (!source) return [];

  const pairRegex = /(?:^|\n)\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]\s*([\s\S]*?)(?:\n\s*(?:\(?A\)?|Answer|Jawaban|Jawab)\s*[:.-]\s*)([\s\S]*?)(?=\n\s*(?:(?:FAQ|QNA)\s*[:.-]\s*)?(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]|$)/gi;
  const units = [];
  let match;
  while ((match = pairRegex.exec(source)) !== null) {
    const questionPart = cleanFaqMarkers(match[1]);
    const answerPart = cleanFaqMarkers(match[2]);
    const unit = compactText([questionPart, answerPart].filter(Boolean).join(' '));
    if (unit.length >= 18) units.push(unit);
  }

  const inlinePairRegex = /(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]\s*([^?\n]{3,260}\?)\s*(?:\(?A\)?|Answer|Jawaban|Jawab)\s*[:.-]\s*([\s\S]*?)(?=(?:\(?[QF]\)?|Question|Pertanyaan|Tanya)\s*[:.-]|$)/gi;
  while ((match = inlinePairRegex.exec(source)) !== null) {
    const questionPart = cleanFaqMarkers(match[1]);
    const answerPart = cleanFaqMarkers(match[2]);
    const unit = compactText([questionPart, answerPart].filter(Boolean).join(' '));
    if (unit.length >= 18) units.push(unit);
  }

  const seen = new Set();
  return units.filter((unit) => {
    const key = normalizeText(unit).slice(0, 260);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitEvidenceUnits(text, question, intent) {
  const source = compactText(text);
  if (!source) return [];
  if (isExplicitLegalQuestion(question, intent)) {
    const legalSection = extractRequestedLegalSection(source, question);
    if (legalSection.length) return legalSection;
  }
  const faqUnits = splitFaqEvidenceUnits(source);
  if (faqUnits.length) return faqUnits;
  const paragraphs = source
    .split(/\n\s*\n|(?:\r?\n){2,}|(?=\bPasal\s+\d+\b)/i)
    .map(compactText)
    .filter(Boolean);
  const units = [];
  for (const paragraph of paragraphs) {
    const lineUnits = paragraph
      .split(/\r?\n+/)
      .map(compactText)
      .filter(Boolean);
    if (lineUnits.length > 1) {
      for (const line of lineUnits) units.push(...splitSentences(line));
      continue;
    }
    units.push(...splitSentences(paragraph));
  }
  return units.length ? units : splitSentences(source);
}

function getSourceLabel(context, index) {
  return String((context && (context.filename || context.source || context.sourceFile || context.title)) || '').trim()
    || String((context && context.trainingId) || '').trim()
    || `context-${index + 1}`;
}

function getSourceId(context, index) {
  return String((context && (context.id || context.sourceId || context.trainingId || context.filename)) || `context-${index + 1}`);
}

function scoreIntentAlignment(text, detectedIntent) {
  const value = String(text || '');
  const checks = {
    legal: /\b(pasal|ayat|force\s+majeure|addendum|pihak|perjanjian)\b/i,
    fee: /\b(Rp\.?|rupiah|biaya|dpp|ukt|semester|pendaftaran|registrasi|\d[\d.,]+\s*(?:ribu|juta)?)\b/i,
    schedule: /\b(tanggal|jadwal|periode|gelombang|bulan|tahun|jam|\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember))\b/i,
    requirement: /\b(syarat|persyaratan|dokumen|berkas|ijazah|ktp|kk|foto|rapor)\b/i,
    international_program: /\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|study\s+exchange|mitra|luar\s+negeri|utb|dnui|help|gccp|bccp)\b/i,
    list: /(?:^|\n)\s*(?:[-*â€¢]|\d+\.)\s+\S|\b(?:terdiri\s+dari|meliputi|antara\s+lain)\b/i,
    program: /\b(program\s+studi|prodi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/i,
    scholarship: /\b(beasiswa|bantuan\s+biaya|potongan|kip|1k1s|skss)\b/i,
    accreditation: /\b(akreditasi|ban\s*-?\s*pt|baik\s+sekali|unggul|terakreditasi)\b/i,
    rpl: /\b(rpl|rekognisi\s+pembelajaran\s+lampau|alih\s+jenjang|konversi\s+sks)\b/i,
    visa_study: /\b(visa\s+(?:study|studi|pelajar)|izin\s+belajar|study\s+permit|itas|kitas|sktt|mahasiswa\s+asing)\b/i,
    campus_service: /\b(inbis|inkubator\s+bisnis|career\s*(?:development\s*)?center|cdc|career\s+center|pusat\s+karier|pusat\s+karir)\b/i
  };
  if (!detectedIntent || detectedIntent === 'general') return 0.35;
  return checks[detectedIntent] && checks[detectedIntent].test(value) ? 1 : 0;
}

function scoreRelevance(text, question) {
  const terms = Array.from(new Set(getContentTerms(question)));
  if (!terms.length) return 0;
  const normalized = normalizeText(text);
  const hits = terms.filter((term) => normalized.includes(term));
  return hits.length / Math.max(terms.length, 1);
}

function scoreEntities(text, requiredEntities) {
  if (!requiredEntities.length) return 0.5;
  const present = new Set(detectEntities(text));
  const hits = requiredEntities.filter((entity) => present.has(entity));
  return hits.length / requiredEntities.length;
}

function hasRequiredTopicEntityAlignment(text, requiredEntities) {
  const required = (Array.isArray(requiredEntities) ? requiredEntities : [])
    .filter((entity) => !['faq'].includes(entity));
  if (!required.length) return true;

  const present = new Set(detectEntities(text));
  const strictFamilies = [
    'double degree', 'utb', 'dnui', 'help', 'gccp', 'bccp',
    'akreditasi', 'rpl', 'beasiswa', 'visa study', 'inbis', 'cdc'
  ];
  const requestedStrict = required.filter((entity) => strictFamilies.includes(entity));
  if (!requestedStrict.length) return true;

  return requestedStrict.every((entity) => present.has(entity));
}

function hasRequiredPasalAlignment(text, question) {
  const match = String(question || '').match(/\bpasal\s+(\d+[a-z]?)\b/i);
  if (!match) return true;
  return new RegExp(`\\bpasal\\s+${match[1]}\\b`, 'i').test(String(text || ''));
}

const { createEvidenceDedupKey, deduplicateEvidence } = require('../utils/evidenceDedup');

function dedupeKey(text) {
  return normalizeText(text).slice(0, 260);
}

function selectEvidenceFromContexts({ question, contexts, intent, maxEvidence, semanticContract } = {}) {
  const list = Array.isArray(contexts) ? contexts : [];
  const detectedIntent = detectIntent(question, intent);
  const requiredEntities = detectEntities(question);
  const limit = Math.min(6, Math.max(3, Number.isFinite(Number(maxEvidence)) ? Number(maxEvidence) : DEFAULT_MAX_EVIDENCE));
  const candidates = [];
  const rejected = [];
  // Early lax whole-context scoring: consider entire chunks before splitting units.
  // This helps long/structured FAQ or QnA chunks survive over-aggressive unit-splitting.
  // Only apply for non-legal, non-fee intents (controlled list) to avoid changing
  // deterministic fee behavior.
  const earlyLaxAllowedIntents = new Set(['international_program', 'program', 'list', 'general', 'scholarship', 'accreditation', 'rpl', 'visa_study', 'campus_service']);
  if (earlyLaxAllowedIntents.has(detectedIntent)) {
    list.forEach((context, index) => {
      const rawText = String((context && (context.chunk || context.text || context.content)) || '');
      if (splitFaqEvidenceUnits(rawText).length) return;
      const fullText = cleanFaqMarkers(rawText);
      if (!fullText) return;
      const rejection = shouldRejectEvidenceUnit(fullText, question, detectedIntent);
      if (rejection.reject) return;
      const relevance = scoreRelevance(fullText, question);
      const ent = scoreEntities(fullText, requiredEntities);
      const intentSc = scoreIntentAlignment(fullText, detectedIntent);
      if (!hasRequiredTopicEntityAlignment(fullText, requiredEntities)) return;
      const contractCheck = semanticContract ? verifyAnswerAgainstContract(semanticContract, fullText, [context]) : { ok: true };
      if (contractCheck && contractCheck.ok === false) {
        rejected.push({ source: getSourceLabel(context, index), reason: 'contract_' + contractCheck.reason, preview: fullText.slice(0, 180) });
        return;
      }
      const total = relevance * 0.6 + ent * 0.2 + intentSc * 0.2;
      if (total > 0.20) { // slightly higher early threshold than the fallback later
        candidates.push({
          text: fullText,
          source: getSourceLabel(context, index),
          sourceId: getSourceId(context, index),
          chunkId: context && context.chunkId ? context.chunkId : null,
          documentId: context && context.documentId ? context.documentId : null,
          pageNumber: context && context.pageNumber ? context.pageNumber : null,
          sectionTitle: context && context.sectionTitle ? context.sectionTitle : null,
          relevanceScore: Number(relevance.toFixed(3)),
          entityScore: Number(ent.toFixed(3)),
          intentScore: Number(intentSc.toFixed(3)),
          totalScore: Number(total.toFixed(3)),
          reason: 'early_lax_fallback',
          isSelectedEvidence: true,
          _total: total
        });
      }
    });
  }

  // Proceed with normal unit-splitting and scoring
  list.forEach((context, index) => {
    const chunk = String((context && (context.chunk || context.text || context.content)) || '');
    const units = splitEvidenceUnits(chunk, question, detectedIntent);
    units.forEach((unit) => {
      const text = cleanFaqMarkers(unit);
      const rejection = shouldRejectEvidenceUnit(text, question, detectedIntent);
      if (rejection.reject) {
        rejected.push({ source: getSourceLabel(context, index), reason: rejection.reason, preview: text.slice(0, 180) });
        return;
      }
      if (!hasRequiredPasalAlignment(text, question)) {
        rejected.push({ source: getSourceLabel(context, index), reason: 'requested_pasal_not_found', preview: text.slice(0, 180) });
        return;
      }
      const relevanceScore = scoreRelevance(text, question);
      if (!hasRequiredTopicEntityAlignment(text, requiredEntities)) {
        rejected.push({ source: getSourceLabel(context, index), reason: 'missing_required_topic_entity', preview: text.slice(0, 180) });
        return;
      }
      const contractCheck = semanticContract ? verifyAnswerAgainstContract(semanticContract, text, [context]) : { ok: true };
      if (contractCheck && contractCheck.ok === false) {
        rejected.push({ source: getSourceLabel(context, index), reason: 'contract_' + contractCheck.reason, preview: text.slice(0, 180) });
        return;
      }
      const entityScore = scoreEntities(text, requiredEntities);
      const intentScore = scoreIntentAlignment(text, detectedIntent);
      const total = relevanceScore * 0.45 + entityScore * 0.25 + intentScore * 0.3;
      const minScore = detectedIntent === 'legal' ? 0.25 : 0.32;
      if (total < minScore || (requiredEntities.length && entityScore <= 0)) {
        rejected.push({ source: getSourceLabel(context, index), reason: 'low_alignment', preview: text.slice(0, 180) });
        return;
      }
      candidates.push({
        text,
        source: getSourceLabel(context, index),
        sourceId: getSourceId(context, index),
        chunkId: context && context.chunkId ? context.chunkId : null,
        documentId: context && context.documentId ? context.documentId : null,
        pageNumber: context && context.pageNumber ? context.pageNumber : null,
        sectionTitle: context && context.sectionTitle ? context.sectionTitle : null,
        relevanceScore: Number(relevanceScore.toFixed(3)),
        entityScore: Number(entityScore.toFixed(3)),
        intentScore: Number(intentScore.toFixed(3)),
        totalScore: Number(total.toFixed(3)),
        reason: `intent=${detectedIntent}; relevance=${relevanceScore.toFixed(2)}; entity=${entityScore.toFixed(2)}; intentScore=${intentScore.toFixed(2)}`,
        isSelectedEvidence: true,
        _total: total
      });
    });
  });

  // Lax fallback: jika tidak ada kandidat yang lolos dan intent masuk dalam kategori non-legal,
  // coba padukan konteks penuh dengan threshold longga agar dokumen yang relevan di indeks
  // tidak dikosongkan oleh aturan split/unit yang terlalu ketat.
  // WASPADA: tetap filter dokumen mentaw (pasal, legal boilerplate, OCR noise)
  // agar tidak pernah masuk sebagai evidence, bahkan di lax mode.
  if (candidates.length === 0 && ['international_program', 'program', 'list', 'general', 'scholarship', 'accreditation', 'rpl', 'visa_study', 'campus_service'].includes(detectedIntent)) {
    const lax = [];
    list.forEach((context, index) => {
      const rawText = String((context && (context.chunk || context.text || context.content)) || '');
      if (splitFaqEvidenceUnits(rawText).length) return;
      const text = cleanFaqMarkers(rawText);
      if (!text) return;
      // CRITICAL: filter dokumen mentaw juga di lax fallback â€” jangan pernah pilih
      // chunks yang berisi pasal, legal boilerplate, atau OCR noise.
      const rejection = shouldRejectEvidenceUnit(text, question, detectedIntent);
      if (rejection.reject) return;
      if (isLikelyRawDocument(text)) return;
      const relevance = scoreRelevance(text, question);
      const ent = scoreEntities(text, requiredEntities);
      const intentSc = scoreIntentAlignment(text, detectedIntent);
      if (!hasRequiredTopicEntityAlignment(text, requiredEntities)) return;
      const contractCheck = semanticContract ? verifyAnswerAgainstContract(semanticContract, text, [context]) : { ok: true };
      if (contractCheck && contractCheck.ok === false) return;
      const total = relevance * 0.6 + ent * 0.2 + intentSc * 0.2;
      // threshold dinaikkan dari 0.18 ke 0.25 untuk mengurangi noise
      if (total > 0.25) {
        lax.push({
          text,
          source: getSourceLabel(context, index),
          sourceId: getSourceId(context, index),
          chunkId: context && context.chunkId ? context.chunkId : null,
          documentId: context && context.documentId ? context.documentId : null,
          pageNumber: context && context.pageNumber ? context.pageNumber : null,
          sectionTitle: context && context.sectionTitle ? context.sectionTitle : null,
          relevanceScore: Number(relevance.toFixed(3)),
          entityScore: Number(ent.toFixed(3)),
          intentScore: Number(intentSc.toFixed(3)),
          totalScore: Number(total.toFixed(3)),
          reason: 'lax_fallback',
          isSelectedEvidence: true,
          _total: total
        });
      }
    });

    if (lax.length) {
      lax.sort((a, b) => b._total - a._total || b.text.length - a.text.length);
      for (const item of lax.slice(0, Math.min(lax.length, 6))) candidates.push(item);
    }
  }

  const seen = new Set();
  // Use centralized dedup helper but preserve original ordering and limit
  const sorted = candidates.filter((item) => item.text).sort((a, b) => b._total - a._total || b.text.length - a.text.length);
  const { items: dedupedItems, meta } = deduplicateEvidence(sorted, {
    keep: 'highest-score',
    keyMode: 'text-only',
    textField: 'text',
    scoreField: '_total',
    prefixLength: 240
  });
  const selected = dedupedItems.slice(0, limit).map(({ _total, ...item }) => item);
  // Attach dedup meta for debug if needed
  if (selected && selected.audit === undefined) Object.defineProperty(selected, 'dedupMeta', { value: meta, enumerable: false });

  Object.defineProperty(selected, 'audit', {
    value: {
      detectedIntent,
      rejectedContextCount: rejected.length,
      rejected,
      semanticContract: semanticContract || null
    },
    enumerable: false
  });
  return selected;
}

function hasConcreteList(text) {
  const value = String(text || '');
  const bulletCount = (value.match(/(?:^|\n)\s*(?:[-*â€¢]|\d+\.)\s+\S/g) || []).length;
  const namedPrograms = (value.match(/\b(?:GCCP|BCCP|Double\s*Degree|Dual\s*Degree|Student\s+Exchange|UTB|DNUI|HELP|Language\s+Learning\s+Center|Career\s+Center)\b/gi) || []).length;
  const commaItems = value.split(/[,;]/).filter((part) => getContentTerms(part).length >= 1).length;
  return bulletCount >= 2 || namedPrograms >= 2 || commaItems >= 3;
}

function evaluateEvidenceAnswerability({ question, selectedEvidence, intent, semanticContract } = {}) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item) => item && item.isSelectedEvidence === true) : [];
  const text = evidence.map((item) => item.text).join('\n');
  const detectedIntent = detectIntent(question, intent);
  const missingEvidence = [];
  const terms = getContentTerms(question);
  const q = String(question || '').trim().toLowerCase();
  const rules = getEvidenceRequirements(detectedIntent, question);
  const contractAnswerability = semanticContract ? verifyAnswerAgainstContract(semanticContract, text, evidence) : { ok: true };
  if (contractAnswerability && contractAnswerability.ok === false) {
    return { answerable: false, reason: 'contract_incompatible_evidence', missingEvidence: [contractAnswerability.reason], contractAnswerability };
  }

  // Check for no content
  if (!terms.length && !isExplicitLegalQuestion(question, detectedIntent)) {
    return { answerable: false, reason: 'ambiguous_question', missingEvidence: ['question_object'] };
  }
  if (!evidence.length || !text.trim()) {
    return { answerable: false, reason: 'no_selected_evidence', missingEvidence: ['selected_evidence'] };
  }

  // STRICT CHECKS: Specific query types that need structural validation
  if (rules.requireCurrency || detectedIntent === 'fee') {
    if (!containsCurrency(text)) missingEvidence.push('fee_amount');
    const requestedEntities = detectEntities(question).filter((entity) => /sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika/.test(entity));
    if (requestedEntities.length && requestedEntities.some((entity) => !detectEntities(text).includes(entity))) missingEvidence.push('requested_program_entity');
  }
  if (detectedIntent === 'legal' && !hasRequiredPasalAlignment(text, question)) {
    missingEvidence.push('requested_legal_section');
  }
  if (detectedIntent === 'schedule') {
    const hasConcreteDateOrPeriod = /\b\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*20\d{2}\b/i.test(text)
      || /\b(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*20\d{2}\b/i.test(text)
      || /\b20\d{2}\s*(?:sampai|hingga|s\.d\.?|sd|-)\s*20\d{2}\b/i.test(text)
      || /\b(?:mulai|dibuka|periode|masa\s+pendaftaran)\b[\s\S]{0,120}\b\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i.test(text);
    if (!hasConcreteDateOrPeriod) missingEvidence.push('date_or_period');
  }
  // List queries must have concrete multiple items
  if (/\bapa\s+saja\b/i.test(q) && detectedIntent !== 'legal' && !hasConcreteList(text)) {
    missingEvidence.push('multiple_concrete_items');
  }

  // If strict checks found issues, reject
  if (missingEvidence.length > 0) {
    return {
      answerable: missingEvidence.length === 0,
      reason: 'missing_required_answer_shape',
      missingEvidence
    };
  }

  // GENERIC RAG MODE: For other intents, if evidence exists and has content, trust it
  // RAG retrieval already filtered for relevance, don't over-verify structure
  if (evidence.length > 0 && text.trim()) {
    // Special case: definition-like questions keep their specific reason for backwards compatibility
    const asksDefinitionLikeQuestion = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(q);
    if (asksDefinitionLikeQuestion) {
      return { answerable: true, reason: 'definition_like_question_with_evidence', missingEvidence: [] };
    }
    return { answerable: true, reason: 'rag_retrieved_evidence_sufficient', missingEvidence: [] };
  }

  // Fallback
  return {
    answerable: false,
    reason: 'no_selected_evidence',
    missingEvidence: ['selected_evidence']
  };
}

function getEvidenceScores(item) {
  const scoreKeys = [
    'score',
    'semanticScore',
    'lexicalScore',
    'bm25Score',
    'bm25Contribution',
    'relevanceScore',
    'entityScore',
    'intentScore',
    'totalScore',
    '_total',
    'finalScore',
    'compositeScore',
    'attributeScore',
    'metadataBoost'
  ];
  const scores = {};

  for (const key of scoreKeys) {
    if (item && Object.prototype.hasOwnProperty.call(item, key)) {
      const value = item[key];
      if (value !== undefined && value !== null) {
        scores[key] = value;
      }
    }
  }

  return scores;
}

function buildStructuredEvidenceContext(selectedEvidence, options = {}) {
  const list = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item) => item && item.isSelectedEvidence === true) : [];
  let used = 0;
  const blocks = [];
  const evidenceMap = {};
  const maxChars = Number.isFinite(Number(options.maxChars)) ? Number(options.maxChars) : 9000;

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {};
    const evidenceKey = `E${i + 1}`;
    const evidenceId = item.id ?? item.sourceId ?? item.chunkId ?? item.trainingId ?? null;
    const sourceId = item.sourceId ?? null;
    const sourceLabel = item.source ?? item.sourceLabel ?? item.filename ?? null;
    const documentId = item.documentId ?? (item.metadata && item.metadata.documentId) ?? item.trainingId ?? null;
    const chunkId = item.chunkId ?? null;
    const pageNumber = item.pageNumber ?? (item.metadata && item.metadata.pageNumber) ?? null;
    const sectionTitle = item.sectionTitle ?? (item.metadata && item.metadata.sectionTitle) ?? null;
    const text = compactText(item.text ?? item.chunk ?? item.content ?? '');
    const scores = getEvidenceScores(item);

    evidenceMap[evidenceKey] = {
      evidenceId,
      sourceId,
      sourceLabel,
      documentId,
      chunkId,
      pageNumber: pageNumber === undefined ? null : pageNumber,
      sectionTitle,
      text,
      scores
    };

    if (!text) continue;

    const sourceLine = sourceLabel || sourceId || evidenceId || `evidence-${i + 1}`;
    const sectionLine = sectionTitle ? `Bagian: ${sectionTitle}` : 'Bagian: -';
    const block = `[${evidenceKey}]\nSumber: ${sourceLine}\n${sectionLine}\nIsi: ${text}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }

  return {
    contextText: blocks.join('\n\n'),
    evidenceMap
  };
}

function buildSelectedEvidenceContext(selectedEvidence, maxChars = 9000) {
  const list = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item) => item && item.isSelectedEvidence === true) : [];
  let used = 0;
  const blocks = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const source = [item.source, item.sourceId].filter(Boolean).join(' | ') || `evidence-${i + 1}`;
    const header = `[E${i + 1}] Sumber: ${source}\nEvidence: `;
    const remaining = Number.isFinite(Number(maxChars)) ? Number(maxChars) - used : maxChars;
    const separatorAllowance = blocks.length > 0 ? 2 : 0; // for \n\n between blocks
    const available = remaining - header.length - separatorAllowance;
    if (available <= 0) break;
    const safeLimit = Math.min(1600, available);
    const bodySource = String(item.text || item.chunk || item.content || '');
    const body = truncateEvidenceSafely(bodySource, safeLimit).truncatedText;
    if (!body) break;
    const block = header + body;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length + separatorAllowance;
  }
  return blocks.join('\n\n');
}

module.exports = {
  selectEvidenceFromContexts,
  evaluateEvidenceAnswerability,
  buildSelectedEvidenceContext,
  buildStructuredEvidenceContext,
  detectEvidenceIntent: detectIntent,
  isExplicitLegalQuestion
};



