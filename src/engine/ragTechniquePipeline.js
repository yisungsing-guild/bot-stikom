const { normalizeUserQuery } = require('../utils/queryNormalizer');

const PROGRAM_ALIASES = {
  'sistem informasi': ['si', 'sif', 'sisfo', 'information system'],
  'teknologi informasi': ['ti', 'it', 'tekinfo', 'information technology'],
  'sistem komputer': ['sk', 'komputer', 'computer system'],
  'bisnis digital': ['bd', 'bisdig', 'digital business']
};

const INTENT_TERMS = {
  fee: ['biaya', 'harga', 'ukt', 'dpp', 'bayar', 'cicilan', 'pendaftaran'],
  schedule: ['jadwal', 'tanggal', 'gelombang', 'deadline', 'buka', 'tutup'],
  scholarship: ['beasiswa', 'kip', '1k1s', 'prestasi', 'bantuan'],
  program: ['prodi', 'jurusan', 'program', 'kuliah', 'belajar'],
  career: ['karir', 'kerja', 'prospek', 'lulusan', 'pekerjaan'],
  requirement: ['syarat', 'dokumen', 'berkas', 'ketentuan'],
  location: ['alamat', 'lokasi', 'kampus', 'dimana'],
  ukm: ['ukm', 'ormawa', 'organisasi', 'komunitas']
};

const SOURCE_PRIORITY = [
  /knowledge_domains/i,
  /tuition|fee|biaya/i,
  /pmb|admission|pendaftaran/i,
  /program_studi|prodi/i,
  /scholarship|beasiswa/i,
  /database|training/i
];

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value) {
  return compactText(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
}

function uniqueList(items, max = 12) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = compactText(item);
    const key = normalizeForMatch(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function extractAliasEntities(text) {
  const norm = ` ${normalizeForMatch(text)} `;
  const programs = [];
  const aliases = [];

  for (const [canonical, variants] of Object.entries(PROGRAM_ALIASES)) {
    const all = [canonical, ...variants];
    for (const alias of all) {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(norm)) {
        programs.push(canonical);
        if (alias !== canonical) aliases.push({ alias, canonical });
        break;
      }
    }
  }

  const waveMatch = norm.match(/\b(?:gelombang\s*)?([1-4]|i{1,3}|iv)\s*([ab])?\b/i);
  const money = Array.from(String(text || '').matchAll(/(?:rp\.?\s*)?\d[\d.\s]*(?:juta|jt|rb|ribu)?/gi)).map((m) => compactText(m[0])).slice(0, 8);
  const dates = Array.from(String(text || '').matchAll(/\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|agustus|sep|okt|nov|des)[a-z]*\s+\d{4}\b/gi)).map((m) => compactText(m[0])).slice(0, 6);

  return {
    programs: uniqueList(programs, 6),
    aliases,
    wave: waveMatch ? compactText(waveMatch[0]) : '',
    money,
    dates
  };
}

function inferLexicalIntent(text) {
  const norm = normalizeForMatch(text);
  let best = { intent: 'unknown', score: 0 };
  for (const [intent, terms] of Object.entries(INTENT_TERMS)) {
    const hits = terms.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(norm)).length;
    if (hits > best.score) best = { intent, score: hits };
  }
  return best.intent;
}

function buildQueryUnderstanding(rawQuestion, rewrite = {}, options = {}) {
  const normalized = normalizeUserQuery(rawQuestion);
  const canonical = compactText(rewrite.canonicalQuestion || normalized.normalizedText || rawQuestion);
  const entities = extractAliasEntities(`${rawQuestion} ${canonical}`);
  const rewriteQueries = Array.isArray(rewrite.searchQueries) ? rewrite.searchQueries : [];
  const aliasExpansions = [];
  for (const program of entities.programs) {
    aliasExpansions.push(program, `program studi ${program}`);
  }
  if (entities.wave) aliasExpansions.push(`gelombang ${entities.wave}`);

  const followUpSignals = /\b(itu|tadi|yang\s+mana|berapa|gimana|lanjut|detailnya|bedanya)\b/i.test(String(rawQuestion || ''))
    || compactText(rawQuestion).split(/\s+/).length <= 3;

  const intent = rewrite.intent && rewrite.intent !== 'unknown'
    ? rewrite.intent
    : (options.intentHint || inferLexicalIntent(`${rawQuestion} ${canonical}`));

  const searchQueries = uniqueList([
    canonical,
    normalized.normalizedText,
    ...rewriteQueries,
    ...aliasExpansions
  ], 8);

  return {
    rawQuestion: String(rawQuestion || ''),
    normalizedText: normalized.normalizedText,
    normalization: {
      changed: normalized.changed,
      replacements: normalized.replacements || []
    },
    intent,
    entities,
    followUp: followUpSignals,
    canonicalQuestion: canonical,
    searchQueries,
    needsClarification: rewrite.needsClarification === true,
    clarificationQuestion: compactText(rewrite.clarificationQuestion || '')
  };
}

function termOverlapScore(a, b) {
  const aTerms = normalizeForMatch(a).split(/\s+/).filter((t) => t.length >= 3);
  const bNorm = normalizeForMatch(b);
  if (!aTerms.length || !bNorm) return 0;
  const hits = aTerms.filter((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(bNorm)).length;
  return Math.min(1, hits / Math.max(1, Math.min(aTerms.length, 8)));
}

function scoreSourcePriority(ctx) {
  const source = `${ctx && (ctx.filename || ctx.sourceFile || ctx.source || '')} ${ctx && ctx.sourceType || ''} ${JSON.stringify(ctx && ctx.metadata || {})}`;
  for (let i = 0; i < SOURCE_PRIORITY.length; i += 1) {
    if (SOURCE_PRIORITY[i].test(source)) return Math.max(0.05, 0.3 - i * 0.035);
  }
  return 0;
}

function scoreFreshness(ctx) {
  const metadata = ctx && ctx.metadata && typeof ctx.metadata === 'object' ? ctx.metadata : {};
  const raw = metadata.updatedAt || metadata.createdAt || metadata.date || (ctx && ctx.updatedAt) || (ctx && ctx.createdAt);
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return 0;
  const ageDays = Math.max(0, (Date.now() - ts) / 86400000);
  if (ageDays <= 90) return 0.15;
  if (ageDays <= 365) return 0.08;
  if (ageDays <= 730) return 0.03;
  return 0;
}

function scoreEntityAlignment(ctx, understanding) {
  const text = `${ctx && (ctx.chunk || ctx.text || '')} ${ctx && (ctx.filename || ctx.sourceFile || '')} ${JSON.stringify(ctx && ctx.metadata || {})}`;
  const programs = understanding && understanding.entities ? understanding.entities.programs : [];
  if (!programs.length) return 0.5;
  const hits = programs.filter((program) => normalizeForMatch(text).includes(normalizeForMatch(program))).length;
  return hits ? Math.min(1, hits / programs.length) : 0;
}

function scoreIntentAlignment(ctx, understanding) {
  const intent = String(understanding && understanding.intent || '').toLowerCase();
  if (!intent || intent === 'unknown') return 0.5;
  const text = `${ctx && (ctx.chunk || ctx.text || '')} ${ctx && (ctx.filename || ctx.sourceFile || '')}`;
  const lexicalIntent = inferLexicalIntent(text);
  if (lexicalIntent === intent) return 1;
  if (intent.includes(lexicalIntent) || lexicalIntent.includes(intent)) return 0.75;
  return 0.35;
}

function rerankContexts(contexts, understanding, options = {}) {
  const list = Array.isArray(contexts) ? contexts : [];
  const seen = new Map();
  const question = understanding && (understanding.canonicalQuestion || understanding.normalizedText || understanding.rawQuestion) || '';

  const scored = list.map((ctx, index) => {
    const text = ctx && (ctx.chunk || ctx.text || '');
    const duplicateKey = normalizeForMatch(text).slice(0, 220);
    const duplicatePenalty = duplicateKey && seen.has(duplicateKey) ? 0.18 : 0;
    if (duplicateKey && !seen.has(duplicateKey)) seen.set(duplicateKey, index);

    const semanticScore = Number(ctx && (ctx.semanticScore ?? ctx.score)) || 0;
    const lexicalScore = Number(ctx && (ctx.lexicalScore ?? ctx.bm25Score ?? ctx.bm25Contribution)) || termOverlapScore(question, text);
    const entityScore = scoreEntityAlignment(ctx, understanding);
    const intentScore = scoreIntentAlignment(ctx, understanding);
    const metadataScore = Number(ctx && (ctx.metadataBoost || ctx.sourceIntentBoost || 0)) || 0;
    const freshnessScore = scoreFreshness(ctx);
    const sourcePriorityScore = scoreSourcePriority(ctx);

    const rerankScore = (semanticScore * 0.28)
      + (Math.min(1, lexicalScore) * 0.22)
      + (entityScore * 0.18)
      + (intentScore * 0.16)
      + (Math.min(1, metadataScore) * 0.07)
      + freshnessScore
      + sourcePriorityScore
      - duplicatePenalty;

    return {
      ...ctx,
      score: Math.max(Number(ctx && ctx.score) || 0, rerankScore),
      rerankScore,
      rerank: {
        semanticScore,
        lexicalScore: Math.min(1, lexicalScore),
        entityScore,
        intentScore,
        metadataScore,
        freshnessScore,
        sourcePriorityScore,
        duplicatePenalty
      }
    };
  });

  scored.sort((a, b) => Number(b.rerankScore || b.score || 0) - Number(a.rerankScore || a.score || 0));
  const topK = Number.isFinite(Number(options.topK)) ? Number(options.topK) : scored.length;
  return scored.slice(0, Math.max(0, topK));
}

function detectEvidenceConflicts(selectedEvidence, understanding = {}) {
  const list = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const text = list.map((item) => item && item.text || item && item.chunk || '').join('\n');
  const money = Array.from(text.matchAll(/rp\.?\s*\d[\d.\s]*(?:juta|jt|rb|ribu)?/gi)).map((m) => compactText(m[0]).toLowerCase());
  const dates = Array.from(text.matchAll(/\b\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|agustus|sep|okt|nov|des)[a-z]*\s+\d{4}\b/gi)).map((m) => compactText(m[0]).toLowerCase());
  const intent = String(understanding.intent || '').toLowerCase();
  const conflicts = [];

  const uniqueMoney = uniqueList(money, 12);
  const uniqueDates = uniqueList(dates, 12);
  if (/fee|biaya|registration_fee|fee_detail|fee_general/.test(intent) && uniqueMoney.length > 6) {
    conflicts.push({ type: 'many_distinct_amounts', values: uniqueMoney.slice(0, 8) });
  }
  if (/schedule|current_wave|window|pmb/.test(intent) && uniqueDates.length > 5) {
    conflicts.push({ type: 'many_distinct_dates', values: uniqueDates.slice(0, 8) });
  }

  return conflicts;
}

function processEvidence(selectedEvidence, answerability, understanding = {}) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const selectedCount = evidence.filter((item) => item && item.isSelectedEvidence === true).length || evidence.length;
  const conflicts = detectEvidenceConflicts(evidence, understanding);
  const answerable = Boolean(answerability && answerability.answerable);
  const sufficient = answerable && selectedCount > 0 && conflicts.length === 0;

  return {
    selectedCount,
    sufficient,
    answerable,
    answerabilityReason: answerability && answerability.reason || null,
    missingEvidence: answerability && answerability.missingEvidence || [],
    conflicts,
    safeCompression: {
      enabled: true,
      mode: 'selected-evidence-context',
      selectedCount
    }
  };
}

module.exports = {
  buildQueryUnderstanding,
  rerankContexts,
  processEvidence,
  detectEvidenceConflicts
};
