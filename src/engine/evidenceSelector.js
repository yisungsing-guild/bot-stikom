const DEFAULT_MAX_EVIDENCE = 5;

const STOPWORDS = new Set([
  'apa', 'apakah', 'bagaimana', 'gimana', 'kalau', 'terkait', 'tentang', 'untuk',
  'yang', 'dengan', 'dalam', 'oleh', 'dari', 'itu', 'ini', 'kak', 'kakak', 'min',
  'saya', 'aku', 'mau', 'ingin', 'menanyakan', 'bertanya', 'baik', 'oke', 'ok',
  'punya', 'mempunyai', 'memiliki', 'ada', 'saja', 'admin', 'tolong', 'jelaskan',
  'info', 'informasi', 'detail', 'lengkap', 'dong', 'ya', 'nih', 'nya', 'dan',
  'atau', 'di', 'ke', 'se', 'bisa', 'dapat', 'mohon', 'kampus', 'dimiliki'
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
  { key: 'gccp', aliases: ['gccp'] },
  { key: 'bccp', aliases: ['bccp'] },
  { key: 'career center', aliases: ['career center', 'pusat karier', 'pusat karir'] },
  { key: 'language learning center', aliases: ['language learning center', 'llc', 'belajar bahasa'] }
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

function getContentTerms(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
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
  if (explicit && explicit !== 'unknown') return explicit;
  if (/\b(pasal|ayat|force\s+majeure|addendum|perjanjian|klausul|isi\s+pasal)\b/i.test(q)) return 'legal';
  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal)\b/i.test(q)) return 'fee';
  if (/\b(jadwal|kapan|tanggal|periode|gelombang|jam|waktu|bulan\s+(?:ini|depan))\b/i.test(q)) return 'schedule';
  if (/\b(syarat|persyaratan|dokumen|berkas|ketentuan)\b/i.test(q)) return 'requirement';
  if (/\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|mitra\s+luar|luar\s+negeri|gccp|bccp|utb|dnui|help)\b/i.test(q)) return 'international_program';
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
  if (/_{4,}|\.{6,}|:{3,}|…{2,}|(?:\(\s*nama\s+mitra\s*\))|(?:nomor\s*:\s*(?:\.{4,}|…+))/i.test(value)) return true;
  if (/\b(?:left|right)\s+-?\d{3,}\b/i.test(value) || /\blogo\s+mitra\b/i.test(value)) return true;
  const alpha = (value.match(/[a-zA-Z\p{L}]/gu) || []).length;
  const punct = (value.match(/[._:;,\-–—…]/g) || []).length;
  return alpha > 0 && punct / Math.max(alpha, 1) > 0.7;
}

function isLegalBoilerplate(text) {
  return /\b(?:pasal\s+\d+|ayat\s*\(\d+\)|pihak\s+kesatu|pihak\s+pertama|pihak\s+kedua|para\s+pihak|force\s+majeure|addendum|bermeterai|mempunyai\s+kekuatan\s+hukum|nomor\s*:|alamat\s+telepon\s+e\s*-?\s*mail|tanda\s+tangan|perjanjian\s+kerja\s+sama|nota\s+kesepahaman|korespondensi)\b/i.test(String(text || ''));
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
    .split(/(?<=[.!?])\s+(?=[A-Z0-9A-ZÀ-ÖØ-Þ\u00c0-\u024f])/u)
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

function splitEvidenceUnits(text, question, intent) {
  const source = compactText(text);
  if (!source) return [];
  if (isExplicitLegalQuestion(question, intent)) {
    const legalSection = extractRequestedLegalSection(source, question);
    if (legalSection.length) return legalSection;
  }
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
    international_program: /\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|mitra|luar\s+negeri|utb|dnui|help|gccp|bccp)\b/i,
    list: /(?:^|\n)\s*(?:[-*•]|\d+\.)\s+\S|\b(?:terdiri\s+dari|meliputi|antara\s+lain)\b/i,
    program: /\b(program\s+studi|prodi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/i
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

function hasRequiredPasalAlignment(text, question) {
  const match = String(question || '').match(/\bpasal\s+(\d+[a-z]?)\b/i);
  if (!match) return true;
  return new RegExp(`\\bpasal\\s+${match[1]}\\b`, 'i').test(String(text || ''));
}

function dedupeKey(text) {
  return normalizeText(text).slice(0, 260);
}

function selectEvidenceFromContexts({ question, contexts, intent, maxEvidence } = {}) {
  const list = Array.isArray(contexts) ? contexts : [];
  const detectedIntent = detectIntent(question, intent);
  const requiredEntities = detectEntities(question);
  const limit = Math.min(6, Math.max(3, Number.isFinite(Number(maxEvidence)) ? Number(maxEvidence) : DEFAULT_MAX_EVIDENCE));
  const candidates = [];
  const rejected = [];

  list.forEach((context, index) => {
    const chunk = String((context && (context.chunk || context.text || context.content)) || '');
    const units = splitEvidenceUnits(chunk, question, detectedIntent);
    units.forEach((unit) => {
      const text = compactText(unit);
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
        relevanceScore: Number(relevanceScore.toFixed(3)),
        entityScore: Number(entityScore.toFixed(3)),
        intentScore: Number(intentScore.toFixed(3)),
        reason: `intent=${detectedIntent}; relevance=${relevanceScore.toFixed(2)}; entity=${entityScore.toFixed(2)}; intentScore=${intentScore.toFixed(2)}`,
        isSelectedEvidence: true,
        _total: total
      });
    });
  });

  const seen = new Set();
  const selected = candidates
    .filter((item) => item.text)
    .sort((a, b) => b._total - a._total || b.text.length - a.text.length)
    .filter((item) => {
      const key = dedupeKey(item.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ _total, ...item }) => item);

  Object.defineProperty(selected, 'audit', {
    value: {
      detectedIntent,
      rejectedContextCount: rejected.length,
      rejected
    },
    enumerable: false
  });
  return selected;
}

function hasConcreteList(text) {
  const value = String(text || '');
  const bulletCount = (value.match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s+\S/g) || []).length;
  const namedPrograms = (value.match(/\b(?:GCCP|BCCP|Double\s*Degree|Dual\s*Degree|Student\s+Exchange|UTB|DNUI|HELP|Language\s+Learning\s+Center|Career\s+Center)\b/gi) || []).length;
  const commaItems = value.split(/[,;]/).filter((part) => getContentTerms(part).length >= 1).length;
  return bulletCount >= 2 || namedPrograms >= 2 || commaItems >= 3;
}

function evaluateEvidenceAnswerability({ question, selectedEvidence, intent } = {}) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item) => item && item.isSelectedEvidence === true) : [];
  const text = evidence.map((item) => item.text).join('\n');
  const detectedIntent = detectIntent(question, intent);
  const missingEvidence = [];
  const terms = getContentTerms(question);
  const q = String(question || '').trim().toLowerCase();
  const asksShortProgramDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(q)
    && /\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi)\b/i.test(q);

  if (asksShortProgramDefinition) {
    return { answerable: true, reason: 'short_program_definition_direct_answer', missingEvidence: [] };
  }
  if (!terms.length && !isExplicitLegalQuestion(question, detectedIntent)) {
    return { answerable: false, reason: 'ambiguous_question', missingEvidence: ['question_object'] };
  }
  if (!evidence.length || !text.trim()) {
    return { answerable: false, reason: 'no_selected_evidence', missingEvidence: ['selected_evidence'] };
  }
  if (detectedIntent === 'fee') {
    if (!/\b(?:Rp\.?|rupiah|\d[\d.,]+\s*(?:ribu|juta)|\d{5,})\b/i.test(text)) missingEvidence.push('fee_amount');
    const requestedEntities = detectEntities(question).filter((entity) => /sistem informasi|teknologi informasi|bisnis digital|sistem komputer|manajemen informatika/.test(entity));
    if (requestedEntities.length && requestedEntities.some((entity) => !detectEntities(text).includes(entity))) missingEvidence.push('requested_program_entity');
  }
  if (detectedIntent === 'schedule' && !/\b(?:tanggal|periode|gelombang|bulan|tahun|jam|\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i.test(text)) {
    missingEvidence.push('date_or_period');
  }
  if (detectedIntent === 'requirement' && !/\b(?:syarat|persyaratan|dokumen|berkas|ijazah|ktp|kk|foto|rapor|formulir)\b/i.test(text)) {
    missingEvidence.push('concrete_requirements');
  }
  if (detectedIntent === 'international_program' && !/\b(?:GCCP|BCCP|Double\s*Degree|Dual\s*Degree|Student\s+Exchange|UTB|DNUI|HELP|mitra|luar\s+negeri|internasional)\b/i.test(text)) {
    missingEvidence.push('international_program_name_or_partner');
  }
  if (/\bapa\s+saja\b/i.test(String(question || '')) && detectedIntent !== 'legal' && !hasConcreteList(text)) {
    missingEvidence.push('multiple_concrete_items');
  }
  if (detectedIntent === 'legal' && !hasRequiredPasalAlignment(text, question)) {
    missingEvidence.push('requested_legal_section');
  }

  return {
    answerable: missingEvidence.length === 0,
    reason: missingEvidence.length ? 'missing_required_answer_shape' : 'selected_evidence_answerable',
    missingEvidence
  };
}

function buildSelectedEvidenceContext(selectedEvidence, maxChars = 9000) {
  const list = Array.isArray(selectedEvidence) ? selectedEvidence.filter((item) => item && item.isSelectedEvidence === true) : [];
  let used = 0;
  const blocks = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const source = [item.source, item.sourceId].filter(Boolean).join(' | ') || `evidence-${i + 1}`;
    const body = compactText(item.text).slice(0, 1600);
    if (!body) continue;
    const block = `[E${i + 1}] Sumber: ${source}\nEvidence: ${body}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join('\n\n');
}

module.exports = {
  selectEvidenceFromContexts,
  evaluateEvidenceAnswerability,
  buildSelectedEvidenceContext,
  detectEvidenceIntent: detectIntent,
  isExplicitLegalQuestion
};
