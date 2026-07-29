const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const ragEngine = require('./ragEngine');
const prisma = require('../db');
const { getLegacyRagIndexPath, getRagIndexPath } = require('../utils/ragPaths');
const {
  selectEvidenceFromContexts,
  evaluateEvidenceAnswerability,
  buildSelectedEvidenceContext
} = require('./evidenceSelector');
const {
  tryFeeComparisonAnswer,
  tryDetailedFeeAnswer,
  tryRegistrationFeeAnswer,
  tryGeneralFeeQuestionAnswer,
  tryDualDegreeAnswer,
  tryProgramListAnswer,
  tryProgramRecommendationAnswer,
  tryProgramComparisonAnswer,
  tryProgramDefinitionAnswer,
  tryScholarshipAnswer,
  tryCareerAnswer,
  tryContextualMultiProgramFeeAnswer
} = require('./feeComparisonEngine');
const { evaluateOutboundAnswer, hasLikelyRawDocumentLeak } = require('../utils/answerPreflightEvaluator');

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

const semanticResultCache = new Map();
const semanticEmbeddingCache = new Map();
let semanticIndexCache = null; // { ts, index }

function getCacheNumber(name, defaultValue) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : defaultValue;
}

function isStrictDocumentOnlyMode() {
  return envFlag('SEMANTIC_RAG_STRICT_DOCUMENT_ONLY', false);
}

function normalizeCacheText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getSemanticTodayYmd() {
  const forced = String(process.env.SEMANTIC_RAG_TODAY_YMD || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(forced)) return forced;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.BOT_TIMEZONE || 'Asia/Makassar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch (e) {
    // fall through to local date
  }

  return new Date().toISOString().slice(0, 10);
}

function trimMapToMax(map, maxSize) {
  const max = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : 200;
  while (map.size > max) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function isStatelessSemanticQuery(options = {}) {
  if (options && options.sessionData) return false;
  if (String(options && options.programHint ? options.programHint : '').trim()) return false;
  if (String(options && options.intentHint ? options.intentHint : '').trim()) return false;
  return true;
}

function getSemanticIndexRevision() {
  try {
    const indexPath = getRagIndexPath();
    const stat = fs.statSync(indexPath);
    return `${Math.floor(Number(stat.mtimeMs || 0))}:${Number(stat.size || 0)}`;
  } catch (e) {
    try {
      const legacyPath = getLegacyRagIndexPath();
      const stat = fs.statSync(legacyPath);
      return `legacy:${Math.floor(Number(stat.mtimeMs || 0))}:${Number(stat.size || 0)}`;
    } catch (legacyErr) {
      return 'no-index';
    }
  }
}
function buildSemanticResultCacheKey(question, options = {}) {
  if (!isStatelessSemanticQuery(options)) return null;
  const q = normalizeCacheText(question);
  if (!q) return null;
  const topK = Number.isFinite(Number(options.topK)) ? String(Number(options.topK)) : '';
  const frame = envFlag('BOT_NATURAL_ANSWER_FRAME', true) ? '1' : '0';
  const followups = envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false) ? '1' : '0';
  const indexRevision = getSemanticIndexRevision();
  return `q:${q}|topK:${topK}|frame:${frame}|followups:${followups}|today:${getSemanticTodayYmd()}|index:${indexRevision}|style:v4`;
}

function cloneSemanticResult(result, cacheHit = false) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    contexts: Array.isArray(result.contexts) ? result.contexts.slice() : result.contexts,
    debug: {
      ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
      cacheHit
    }
  };
}

function getCachedSemanticResult(cacheKey) {
  if (!cacheKey) return null;
  const ttlMs = getCacheNumber('SEMANTIC_RAG_RESULT_CACHE_MS', 60000);
  if (ttlMs <= 0) return null;
  const hit = semanticResultCache.get(cacheKey);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    semanticResultCache.delete(cacheKey);
    return null;
  }
  return cloneSemanticResult(hit.value, true);
}

function setCachedSemanticResult(cacheKey, result) {
  if (!cacheKey || !result || !result.success || !result.answer) return;
  const ttlMs = getCacheNumber('SEMANTIC_RAG_RESULT_CACHE_MS', 60000);
  if (ttlMs <= 0) return;
  const maxSize = getCacheNumber('SEMANTIC_RAG_RESULT_CACHE_MAX', 200);
  semanticResultCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    value: cloneSemanticResult(result, false)
  });
  trimMapToMax(semanticResultCache, maxSize);
}

function getCachedSemanticIndex() {
  const ttlMs = getCacheNumber('SEMANTIC_RAG_INDEX_CACHE_MS', 10000);
  const now = Date.now();
  if (ttlMs > 0 && semanticIndexCache && (now - semanticIndexCache.ts) <= ttlMs) {
    return semanticIndexCache.index;
  }
  const index = ragEngine.loadIndex();
  if (ttlMs > 0) semanticIndexCache = { ts: now, index };
  return index;
}

let trainingDbCache = null; // { ts, data }

async function getActiveTrainingDataFromDb() {
  const ttlMs = getCacheNumber('SEMANTIC_RAG_TRAINING_DB_CACHE_MS', 60000);
  const now = Date.now();
  if (ttlMs > 0 && trainingDbCache && (now - trainingDbCache.ts) <= ttlMs) {
    return trainingDbCache.data;
  }
  
  try {
    const data = await prisma.trainingData.findMany({
      where: { active: true },
      select: {
        id: true,
        filename: true,
        content: true,
        source: true,
        divisionKey: true,
        createdAt: true,
        ragIngestStatus: true,
        ragChunkCount: true
      },
      orderBy: { createdAt: 'desc' }
    });
    
    if (ttlMs > 0) trainingDbCache = { ts: now, data };
    return data;
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to fetch TrainingData from database');
    return [];
  }
}

function normalizeForLexicalMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeLexicalScore(query, content, filename = '') {
  const qNorm = normalizeForLexicalMatch(query);
  const cNorm = normalizeForLexicalMatch(content + ' ' + filename);
  
  if (!qNorm || !cNorm) return 0;
  
  const qTokens = qNorm.split(/\s+/).filter(Boolean);
  const cTokens = cNorm.split(/\s+/).filter(Boolean);
  
  if (!qTokens.length || !cTokens.length) return 0;
  
  // Exact phrase match bonus
  if (cNorm.includes(qNorm)) return 1.0;
  
  // Token overlap score
  const qSet = new Set(qTokens);
  const cSet = new Set(cTokens);
  let overlapCount = 0;
  for (const token of qTokens) {
    if (cSet.has(token)) overlapCount++;
  }
  
  const overlapRatio = overlapCount / qTokens.length;
  
  // Boost for longer matches (consecutive tokens)
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  for (let i = 0; i < cTokens.length; i++) {
    if (qSet.has(cTokens[i])) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }
  const consecutiveBonus = Math.min(maxConsecutive / qTokens.length, 0.3);
  
  // Acronym handling: if query is short (2-5 chars), check if it appears as prefix in content
  if (qTokens.length === 1 && qTokens[0].length >= 2 && qTokens[0].length <= 5) {
    const acronym = qTokens[0];
    for (const token of cTokens) {
      if (token.startsWith(acronym) || acronym.startsWith(token)) {
        return Math.max(overlapRatio + 0.3, 0.5);
      }
    }
  }
  
  return Math.min(overlapRatio + consecutiveBonus, 0.95);
}

function convertTrainingDataToCandidate(trainingData) {
  if (!trainingData) return null;
  
  const content = cleanDocumentMarkers(String(trainingData.content || '').trim());
  if (!content) return null;
  
  // Use the same topic-aware chunker as the persisted RAG index. This keeps
  // Q&A pairs, table sections, and headings together better than fixed slicing.
  let chunks = [];
  try {
    chunks = ragEngine.chunkText(content, 900, 150);
  } catch (e) {
    chunks = [];
  }
  if (!chunks.length) {
    for (let i = 0; i < content.length; i += 900) {
      const chunk = content.slice(i, i + 900).trim();
      if (chunk) chunks.push(chunk);
    }
  }
  
  return chunks.map((chunk, idx) => ({
    id: `${trainingData.id}-db-${idx}`,
    chunk: chunk,
    filename: trainingData.filename || trainingData.source || 'database',
    trainingId: trainingData.id,
    divisionKey: trainingData.divisionKey || null,
    sourceType: 'database',
    embedding: null, // No embedding for database candidates
    metadata: {
      source: 'database',
      ragIngestStatus: trainingData.ragIngestStatus || 'unknown',
      createdAt: trainingData.createdAt
    }
  }));
}

// Generic document-format marker cleaning
function cleanDocumentMarkers(text) {
  if (!text) return '';
  
  // Order matters: longer patterns first to avoid partial matches
  const patterns = [
    /\bRingkasan\s+dokumen:\s*/gi,
    /\bFAQ:\s*/gi,
    /\bQuestion:\s*/gi,
    /\bAnswer:\s*/gi,
    /\bPertanyaan:\s*/gi,
    /\bJawaban:\s*/gi,
    /\(F\)\s*/gi,
    /\(Q\)\s*/gi,
    /\(A\)\s*/gi,
    /\bF:\s*/gi,
    /\bQ:\s*/gi,
    /\bA:\s*/gi
  ];
  
  let cleaned = text;
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  
  return cleaned.trim();
}

// Generic evidence splitting into small units
function splitIntoEvidenceUnits(text, question = '') {
  if (!text) return [];
  
  const cleaned = cleanDocumentMarkers(text);
  const units = [];
  
  // Split by paragraphs
  const paragraphs = cleaned.split(/\n\s*\n/).filter(p => p.trim());
  
  for (const paragraph of paragraphs) {
    // Check if it's an FAQ Q&A pair
    const qaMatch = paragraph.match(/^(?:Q\s*[:\.]?|Question\s*[:\.]?|Pertanyaan\s*[:\.]?)\s*(.+?)(?:\n|$)(?:A\s*[:\.]?|Answer\s*[:\.]?|Jawaban\s*[:\.]?)\s*(.+)/is);
    if (qaMatch) {
      units.push(cleanDocumentMarkers(qaMatch[1].trim()));
      units.push(cleanDocumentMarkers(qaMatch[2].trim()));
      continue;
    }
    
    // Split by list items
    const listItems = paragraph.split(/\n\s*[-*\u2022]\s*/).filter(item => item.trim());
    if (listItems.length > 1) {
      units.push(...listItems.map(cleanDocumentMarkers));
      continue;
    }
    
    // Split by numbered items
    const numberedItems = paragraph.split(/\n\s*\d+[.)]\s*/).filter(item => item.trim());
    if (numberedItems.length > 1) {
      units.push(...numberedItems.map(cleanDocumentMarkers));
      continue;
    }
    
    // Split by sentences for long paragraphs
    if (paragraph.length > 300) {
      const sentences = paragraph.match(/[^.!?\n]+[.!?\n]+/g) || [];
      if (sentences.length > 1) {
        units.push(...sentences.map(s => cleanDocumentMarkers(s.trim())));
        continue;
      }
    }
    
    // Keep as single unit if short
    units.push(cleanDocumentMarkers(paragraph.trim()));
  }
  
  return units.filter(u => u.length >= 10);
}

// Generic entity extraction (not hardcoded to specific entities)
function extractGenericEntities(text) {
  if (!text) return [];
  
  const normalized = String(text).toLowerCase();
  const entities = [];
  
  // Extract proper nouns (capitalized words)
  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) || [];
  entities.push(...properNouns);
  
  // Extract numbers with context
  const numberWithContext = text.match(/\b\d+\s*(?:ribu|juta|rb|jt|semester|tahun|bulan|hari|jam|menit|pasal|ayat)\b/gi) || [];
  entities.push(...numberWithContext);
  
  // Extract quoted phrases
  const quoted = text.match(/"[^"]{3,50}"/g) || [];
  entities.push(...quoted.map(q => q.replace(/"/g, '')));
  
  // Extract distinctive terms (3+ chars, not stopwords)
  const stopwords = new Set(['apa', 'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk', 'dengan', 'pada', 'kak', 'min', 'admin', 'saya', 'kamu', 'itu', 'ini', 'ada', 'bisa', 'mau', 'ingin', 'juga', 'sudah', 'belum', 'tidak', 'ya', 'dong', 'nih', 'nya', 'itb', 'stikom', 'bali', 'institut', 'kampus']);
  const words = normalized.split(/\s+/).filter(w => w.length >= 3 && !stopwords.has(w));
  entities.push(...words);
  
  // Extract generic multi-word patterns (information types, not institution-specific entities)
  const genericPatterns = [
    /\b(biaya\s+pendaftaran|dana\s+pendidikan|uang\s+masuk)\b/gi
  ];
  
  for (const pattern of genericPatterns) {
    const matches = normalized.match(pattern) || [];
    entities.push(...matches);
  }
  
  return [...new Set(entities)];
}

const QUERY_ANCHOR_STOPWORDS = new Set([
  'apa', 'apakah', 'bagaimana', 'gimana', 'berapa', 'kapan', 'dimana', 'mana',
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'dari', 'ke', 'di', 'itu',
  'ini', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'saya', 'aku', 'kamu', 'kak',
  'kakak', 'min', 'admin', 'tolong', 'mohon', 'dong', 'ya', 'nih', 'nya',
  'jelaskan', 'sebutkan', 'info', 'informasi', 'tentang', 'terkait', 'kalau',
  'jika', 'jadi', 'adalah', 'untuknya', 'tersebut', 'kampus', 'kuliah',
  'pendaftaran', 'daftar', 'biaya', 'harga', 'jadwal', 'syarat', 'dokumen',
  'program', 'studi', 'prodi', 'jurusan', 'tahun', 'ajaran', 'itb', 'stikom', 'bali', 'institut'
]);

function extractQueryAnchorTerms(text) {
  const normalized = normalizeForLexicalMatch(text);
  if (!normalized) return [];

  const anchors = [];
  const add = (value) => {
    const v = normalizeForLexicalMatch(value);
    if (v && !anchors.includes(v)) anchors.push(v);
  };

  const strongPatterns = [
    /\b(sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/gi,
    /\b(double\s+degree|dual\s+degree|student\s+exchange|international\s+program|program\s+internasional)\b/gi,
    /\b(linkedin|career\s+center|pusat\s+karier|sion|portal\s+akademik|wisuda|yudisium|skripsi|akreditasi|kip|1k1s|dpp|ukt|visi|misi|visi\s+misi|website|isian\s+website)\b/gi,
    /\b(gelombang\s+(?:khusus|[0-9]+|[ivx]+)\s*[a-c]?)\b/gi,
    /\b(si|ti|sk|bd|mi|d3|s1|s2|dnui|help|utb)\b/gi
  ];

  for (const pattern of strongPatterns) {
    for (const match of String(text || '').matchAll(pattern)) add(match[1] || match[0]);
  }

  for (const token of normalized.split(/\s+/).filter(Boolean)) {
    if (token.length < 3) continue;
    if (QUERY_ANCHOR_STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token) && (token.length < 4 || /^20\d{2}$/.test(token))) continue;
    add(token);
  }

  return anchors.slice(0, 10);
}

function hasAnchorOverlap(question, content) {
  const anchors = extractQueryAnchorTerms(question);
  if (!anchors.length) return true;
  const cNorm = normalizeForLexicalMatch(content);
  return anchors.some((anchor) => {
    const a = normalizeForLexicalMatch(anchor);
    if (!a) return false;
    if (a.length <= 4 || !a.includes(' ')) {
      const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i').test(cNorm);
    }
    return cNorm.includes(a);
  });
}
// Generic intent detection from question
function detectGenericIntent(question) {
  const q = String(question).toLowerCase();
  
  if (/\b(pasal|ayat|force\s*majeure|addendum|perjanjian|klausul|isi\s+pasal|legal|hukum)\b/i.test(q)) return 'legal';
  // Check scholarship before fee to avoid misclassification
  if (/\b(beasiswa|bantuan\s+(?:biaya|biaya\s+bantuan)|potongan|kip|1k1s)\b/i.test(q)) return 'scholarship';
  if (/\b(prospek\s+kerja|karir|karier|lulusan|profesi|pekerjaan|kerja\s+apa|jadi\s+apa|peluang\s+kerja|career)\b/i.test(q)) return 'career';
  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal|fee|cost|price)\b/i.test(q)) return 'fee';
  if (/\b(jadwal|kapan|tanggal|periode|gelombang|jam|waktu|bulan\s+(?:ini|depan)|deadline)\b/i.test(q)) return 'schedule';
  if (/\b(syarat|persyaratan|dokumen|berkas|ketentuan|requirement)\b/i.test(q)) return 'requirement';
  if (/\b(fasilitas|sarana|prasarana|laboratorium|lab(?:nya)?|perpustakaan(?:nya)?|ruang|kantin(?:nya)?|parkir(?:an)?(?:nya)?|wifi|wi-fi|inkubator|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(q)) return 'facility';
  if (/\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|mitra\s+luar|luar\s+negeri)\b/i.test(q)) return 'international_program';
  if (/\b(apa\s+saja|daftar|list|pilihan|macam|sebutkan)\b/i.test(q)) return 'list';
  if (/\b(program\s+studi|prodi|jurusan|major)\b/i.test(q)) return 'program';
  if (/\b(ukm|ormawa|organisasi\s+mahasiswa|kegiatan\s+mahasiswa|unit\s+kegiatan)\b/i.test(q)) return 'organization';
  
  return 'general';
}

// Generic phrase overlap scoring
function computePhraseOverlap(query, content) {
  const qNorm = normalizeForLexicalMatch(query);
  const cNorm = normalizeForLexicalMatch(content);
  
  if (!qNorm || !cNorm) return 0;
  
  const qPhrases = qNorm.match(/\b\w+\s+\w+\b/g) || [];
  const cPhrases = cNorm.match(/\b\w+\s+\w+\b/g) || [];
  
  if (!qPhrases.length) return 0;
  
  let overlapCount = 0;
  for (const phrase of qPhrases) {
    if (cNorm.includes(phrase)) overlapCount++;
  }
  
  return overlapCount / qPhrases.length;
}

// Generic entity overlap scoring
function computeEntityOverlap(question, content) {
  const qEntities = extractGenericEntities(question);
  const cEntities = extractGenericEntities(content);
  
  if (!qEntities.length) return 0.5; // Neutral if no entities in question
  
  const qSet = new Set(qEntities.map(e => e.toLowerCase()));
  const cSet = new Set(cEntities.map(e => e.toLowerCase()));
  
  let overlapCount = 0;
  for (const entity of qSet) {
    if (cSet.has(entity)) overlapCount++;
  }
  
  return overlapCount / qSet.size;
}

// Generic intent compatibility scoring
function computeIntentCompatibility(content, questionIntent) {
  const intent = questionIntent || detectGenericIntent(content);
  const cNorm = normalizeForLexicalMatch(content);
  
  const intentSignals = {
    legal: /\b(pasal|ayat|force\s*majeure|addendum|perjanjian|pihak|hukum)\b/i,
    fee: /\b(Rp\.?|rupiah|biaya|dpp|ukt|semester|pendaftaran|registrasi|\d[\d.,]+\s*(?:ribu|juta))\b/i,
    schedule: /\b(tanggal|jadwal|periode|gelombang|bulan|tahun|jam|\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember))\b/i,
    requirement: /\b(syarat|persyaratan|dokumen|berkas|ijazah|ktp|kk|foto|rapor)\b/i,
    international_program: /\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|mitra|luar\s+negeri)\b/i,
    list: /(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S|\b(?:terdiri\s+dari|meliputi|antara\s+lain)\b/i,
    program: /\b(program\s+studi|prodi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika)\b/i,
    facility: /\b(fasilitas|laboratorium|perpustakaan|kantin|parkir|wifi|ruang)\b/i,
    organization: /\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i,
    scholarship: /\b(beasiswa|bantuan|potongan|kip|1k1s)\b/i,
    career: /\b(prospek\s+kerja|karir|karier|lulusan|profesi|pekerjaan|career\s+center|job|magang)\b/i
  };
  
  if (intent === 'general') return 0.1;
  
  const pattern = intentSignals[intent];
  return pattern ? (pattern.test(cNorm) ? 1 : 0.2) : 0.5;
}

// Generic admin/legal content penalty (conditional based on question)
function computeAdminPenalty(content, question) {
  const q = String(question).toLowerCase();
  const isLegalQuestion = /\b(pasal|ayat|force\s*majeure|addendum|perjanjian|klausul|isi\s+pasal|legal|hukum)\b/i.test(q);
  
  // If question explicitly asks about legal/admin content, no penalty
  if (isLegalQuestion) return 0;
  
  // Otherwise, penalize legal boilerplate
  if (isLikelyRawAdministrativeDocument(content)) return 0.8;
  
  // Penalize generic legal phrases in non-legal questions
  const legalPhrases = /\b(pihak\s+(?:kesatu|kedua|pertama)|para\s+pihak|bermeterai|kekuatan\s+hukum|perjanjian\s+kerja\s+sama)\b/i;
  if (legalPhrases.test(content)) return 0.5;
  
  return 0;
}

// Generic combined scoring
function getRequestedAcademicTargets(query) {
  const q = normalizeForLexicalMatch(query);
  const targets = [];
  const add = (name, variants) => {
    if (variants.some((v) => new RegExp('\\b' + v.replace(/\\s+/g, '\\s+') + '\\b', 'i').test(q))) {
      targets.push({ name, variants });
    }
  };
  add('SI', ['si', 'sistem informasi']);
  add('TI', ['ti', 'teknologi informasi', 'teknik informatika']);
  add('SK', ['sk', 'sistem komputer']);
  add('BD', ['bd', 'bisnis digital']);
  add('MI', ['mi', 'manajemen informatika']);
  add('D3', ['d3', 'diploma 3', 'diploma tiga']);
  add('DNUI', ['dnui', 'dalian neusoft']);
  add('HELP', ['help', 'help university']);
  add('UTB', ['utb', 'universitas teknologi bandung']);
  return targets;
}

function targetVariantMatches(text, variants) {
  const haystack = normalizeForLexicalMatch(text);
  return variants.some((variant) => {
    const v = normalizeForLexicalMatch(variant);
    if (!v) return false;
    return new RegExp('\\b' + v.replace(/\\s+/g, '\\s+') + '\\b', 'i').test(haystack);
  });
}

function extractAcademicYearValue(value) {
  const text = String(value || '');
  const match = text.match(/(?:t\.?a\.?|tahun\s+ajaran|academic\s+year)?\s*(20\d{2})\s*[-\/]\s*(20\d{2})/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, key: start + '-' + end };
}

function getCurrentAcademicYearValue() {
  const today = getSemanticTodayYmd();
  const year = Number(String(today).slice(0, 4));
  const month = Number(String(today).slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const start = month >= 7 ? year : year - 1;
  return { start, end: start + 1, key: start + '-' + (start + 1) };
}

function computeDocumentFreshnessBoost(query, item) {
  const filename = String((item && (item.filename || item.sourceFile)) || '');
  const chunk = String((item && item.chunk) || '');
  const version = String((item && item.trainingVersion) || '');
  const haystack = [filename, version, chunk.slice(0, 900)].join(' ');
  const docYear = extractAcademicYearValue(haystack);
  const requestedYear = extractAcademicYearValue(query);
  const currentYear = getCurrentAcademicYearValue();
  let boost = 0;

  if (requestedYear && docYear) {
    if (docYear.start === requestedYear.start && docYear.end === requestedYear.end) boost += 0.22;
    else boost -= 0.28;
  } else if (docYear && currentYear) {
    if (docYear.start === currentYear.start && docYear.end === currentYear.end) boost += 0.14;
    else if (docYear.end < currentYear.end) boost -= Math.min(0.24, 0.08 * Math.max(1, currentYear.end - docYear.end));
    else if (docYear.end > currentYear.end) boost += 0.08;
  }

  const createdAt = Date.parse(String((item && (item.createdAt || item.updatedAt)) || ''));
  if (Number.isFinite(createdAt)) {
    const ageDays = Math.max(0, (Date.now() - createdAt) / 86400000);
    if (ageDays <= 30) boost += 0.08;
    else if (ageDays <= 120) boost += 0.04;
  }

  if (/\b(terbaru|sekarang|saat\s+ini|current|latest|tahun\s+ini)\b/i.test(query) && docYear && currentYear) {
    if (docYear.end >= currentYear.end) boost += 0.1;
    else boost -= 0.1;
  }

  return Math.max(-0.32, Math.min(0.26, boost));
}
function computeSourceIntentBoost(query, item, questionIntent = null) {
  const intent = questionIntent || detectGenericIntent(query);
  const filename = String((item && (item.filename || item.sourceFile)) || '').toLowerCase();
  const chunk = String((item && item.chunk) || '');
  const category = String((item && (item.docCategory || item.category || (item.metadata && item.metadata.docCategory))) || '').toUpperCase();
  let boost = 0;

  const requestedTargets = getRequestedAcademicTargets(query);
  if (requestedTargets.length) {
    const filenameMatchesTarget = requestedTargets.some((target) => targetVariantMatches(filename, target.variants));
    const contentMatchesTarget = requestedTargets.some((target) => targetVariantMatches(filename + ' ' + chunk.slice(0, 700), target.variants));
    if (filenameMatchesTarget) boost += 0.5;
    else if (contentMatchesTarget) boost -= 0.2;
    else boost -= 0.65;
  }

  if (intent === 'fee') {
    if (/\bbiaya\b|rincian\s+biaya|dpp|ukt/i.test(filename) || category === 'BIAYA') boost += 0.25;
    if (/kalender|jadwal/i.test(filename) || category === 'JADWAL') boost -= 0.2;
  }
  if (intent === 'schedule') {
    if (/kalender|jadwal|pendaftaran/i.test(filename) || category === 'JADWAL') boost += 0.2;
    if (/\bbiaya\b|rincian\s+biaya/i.test(filename) || category === 'BIAYA') boost -= 0.08;
  }
  if (intent === 'requirement') {
    const hay = filename + ' ' + chunk.slice(0, 900);
    const isGeneralPmbRequirement = /\b(pendaftaran|daftar|pmb|registrasi)\b/i.test(query) && !/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas/i.test(query);
    if (/syarat|persyaratan|pendaftaran|pmb|registrasi|formulir|dokumen/i.test(filename) || category === 'PERSYARATAN') boost += 0.26;
    if (isGeneralPmbRequirement && /\b(pendaftaran|daftar|pmb|registrasi|mahasiswa\s+baru|formulir)\b/i.test(hay)) boost += 0.28;
    if (isGeneralPmbRequirement && !/\b(pendaftaran|daftar|pmb|registrasi|mahasiswa\s+baru|formulir)\b/i.test(hay)) boost -= 0.48;
    if (/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas/i.test(hay) && !/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas/i.test(query)) boost -= 0.5;
    if (/\bbiaya\b|rincian\s+biaya|hobi/i.test(filename) || category === 'BIAYA') boost -= 0.18;
  }
  if (intent === 'facility') {
    const hay = filename + ' ' + chunk.slice(0, 900);
    const hasFacilitySignal = /fasilitas|sarana|prasarana|lab|laboratorium|perpustakaan|kantin|parkir|parkiran|wifi|wi-fi|ruang\s+(?:kelas|kuliah)|kampus/i.test(hay) || category === 'FASILITAS' || category === 'LOKASI';
    if (hasFacilitySignal) boost += 0.46;
    else boost -= 0.55;
    if (/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas|\bbiaya\b|rincian\s+biaya|hobi/i.test(filename) && !/student\s*exchange|international|internasional/i.test(query)) boost -= 0.45;
  }
  if (intent === 'career') {
    const hay = filename + ' ' + chunk.slice(0, 900);
    const hasCareerSignal = /karier|karir|career|prospek|lulusan|profesi|pekerjaan|job|magang|masa\s+depan/i.test(hay);
    if (/karier|karir|career|prospek|lulusan|penjelasan\s+prodi|masa\s+depan|profile|profil/i.test(filename) || category === 'PRODI_PROFILE') boost += 0.28;
    if (hasCareerSignal) boost += 0.22;
    else boost -= 0.34;
    if (/hima|ukm|organisasi|bem|dpm/i.test(filename) && !/hima|ukm|organisasi|bem|dpm/i.test(query)) boost -= 0.32;
    if (/\bbiaya\b|rincian\s+biaya|kalender|jadwal/i.test(filename) || category === 'BIAYA' || category === 'JADWAL') boost -= 0.38;
  }
  if (intent === 'organization') {
    if (/\b(ukm|ormawa|hima|bem|dpm|profile|profil)\b/i.test(filename)) boost += 0.2;
  }
  if (intent === 'program') {
    if (/prodi|program|karier|karir|prospek|profile|profil/i.test(filename) || category === 'PRODI_PROFILE') boost += 0.18;
  }

  boost += computeDocumentFreshnessBoost(query, item);

  const sourceScore = computeLexicalScore(query, filename, filename);
  if (sourceScore >= 0.4) boost += Math.min(0.18, sourceScore * 0.18);
  return Math.max(-0.85, Math.min(0.68, boost));
}

function computeGenericScore(query, content, questionIntent = null) {
  if (!query || !content) return 0;
  
  const lexicalScore = computeLexicalScore(query, content);
  const phraseScore = computePhraseOverlap(query, content);
  const entityScore = computeEntityOverlap(query, content);
  const intentScore = computeIntentCompatibility(content, questionIntent);
  const adminPenalty = computeAdminPenalty(content, query);
  
  // Weighted combination
  const total = (lexicalScore * 0.3) + (phraseScore * 0.2) + (entityScore * 0.25) + (intentScore * 0.25) - adminPenalty;
  
  return Math.max(0, Math.min(1, total));
}

async function getDatabaseCandidates(searchQueries, options = {}) {
  const trainingData = await getActiveTrainingDataFromDb();
  if (!Array.isArray(trainingData) || !trainingData.length) return [];
  
  const queries = uniqueList(searchQueries, 4);
  if (!queries.length) return [];
  
  const question = options.question || queries[0] || '';
  const questionIntent = options.intent || detectGenericIntent(question);
  
  const candidates = [];
  const seenIds = new Set();
  
  for (const record of trainingData) {
    const candidateChunks = convertTrainingDataToCandidate(record);
    if (!candidateChunks) continue;
    
    for (const chunk of candidateChunks) {
      if (seenIds.has(chunk.id)) continue;
      seenIds.add(chunk.id);
      
      let bestScore = 0;
      let bestLexicalScore = 0;
      for (const query of queries) {
        const genericScore = computeGenericScore(query, chunk.chunk, questionIntent);
        const lexicalScore = computeLexicalScore(query, chunk.chunk, chunk.filename);
        bestScore = Math.max(bestScore, genericScore);
        bestLexicalScore = Math.max(bestLexicalScore, lexicalScore);
      }
      
      if (bestScore > 0.15) { // Minimum threshold for generic match
        candidates.push({
          item: chunk,
          score: Math.max(0, Math.min(1, bestScore + computeSourceIntentBoost(question, chunk, questionIntent))),
          lexicalScore: bestLexicalScore,
          semanticScore: 0,
          sourceType: 'database',
          intent: questionIntent
        });
      }
    }
  }
  
  // Sort by combined score descending
  candidates.sort((a, b) => b.score - a.score);
  
  return candidates;
}

async function computeEmbeddingCached(query) {
  const key = normalizeCacheText(query);
  if (!key) return ragEngine.computeEmbedding(query);
  const ttlMs = getCacheNumber('SEMANTIC_RAG_EMBEDDING_CACHE_MS', 5 * 60 * 1000);
  const now = Date.now();
  if (ttlMs > 0) {
    const hit = semanticEmbeddingCache.get(key);
    if (hit && now <= hit.expiresAt) return hit.value;
    if (hit) semanticEmbeddingCache.delete(key);
  }
  const value = await ragEngine.computeEmbedding(query);
  if (ttlMs > 0 && Array.isArray(value) && value.length) {
    semanticEmbeddingCache.set(key, { expiresAt: now + ttlMs, value });
    trimMapToMax(semanticEmbeddingCache, getCacheNumber('SEMANTIC_RAG_EMBEDDING_CACHE_MAX', 500));
  }
  return value;
}

function clampText(value, max) {
  const text = String(value || '').trim();
  const limit = Number.isFinite(max) && max > 0 ? max : 1000;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function getModel() {
  const raw = String(process.env.OPENAI_SEMANTIC_RAG_MODEL || process.env.OPENAI_RAG_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const model = raw || 'gpt-4o-mini';
  const allowCustom = envFlag('OPENAI_ALLOW_CUSTOM_MODEL', false) || envFlag('OPENAI_ALLOW_EXPERIMENTAL_MODEL', false);
  if (!allowCustom && /^gpt-5(\.|$)/i.test(model)) {
    return String(process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
  }
  return model;
}

function getClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || isPlaceholderOpenAiApiKey(apiKey)) return null;
  if (process.env.NODE_ENV === 'test' && apiKey !== 'test-key' && !envFlag('ALLOW_OPENAI_IN_TEST', false)) return null;
  const timeoutMsRaw = parseInt(process.env.OPENAI_SEMANTIC_RAG_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || '20000', 10);
  const timeout = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 20000;
  return new OpenAI({ apiKey, timeout });
}

function isPlaceholderOpenAiApiKey(apiKey) {
  return /REPLACE_WITH_YOUR_OPENAI_API_KEY|your[-_ ]?openai[-_ ]?api[-_ ]?key/i.test(String(apiKey || ''));
}

function hasUsableOpenAiApiKey() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || isPlaceholderOpenAiApiKey(apiKey)) return false;
  if (process.env.NODE_ENV === 'test' && apiKey === 'test-key') return false;
  return /^sk-[A-Za-z0-9_-]{20,}/.test(apiKey);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function uniqueList(values, max) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}
function isConversationRawDocumentQuote(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (hasLikelyRawDocumentLeak(value)) return true;
  const markerGroups = [
    /\b(?:PROFIL|PROFILE)\s+(?:LEMBAGA|ORGANISASI|DIVISI|UNIT|UKM|PROGRAM|FAKULTAS|BAGIAN)\b/i,
    /\b(?:Identitas\s+(?:Lembaga|Organisasi|Program)|Nama\s+(?:Lembaga|Organisasi|Program|Perguruan\s+Tinggi)|Tahun\s+Berdiri|Dasar\s+Hukum|Pembina\s*\/\s*Penanggung\s+Jawab|Ringkasan\s+Capaian|Struktur\s+Organisasi|Susunan\s+Pengurus)\b/i,
    /\b(?:SURAT\s+KEPUTUSAN|KEPUTUSAN\s+(?:REKTOR|KETUA|DIREKTUR)|Nomor\s*SK|Menimbang|Mengingat|Memutuskan|Ditetapkan\s+di|Pada\s+tanggal|Tembusan|Lampiran|Pasal\s+\d+)\b/i,
    /\b(?:NOTA\s+KESEPAHAMAN|PERJANJIAN\s+KERJA\s*SAMA|MOU|MOA|ADDENDUM|PIHAK\s+PERTAMA|PIHAK\s+KEDUA|PARA\s+PIHAK|FORCE\s+MAJEURE)\b/i,
    /\b(?:FAQ|QNA|Question|Answer|Pertanyaan|Jawaban|Tanya|Jawab|Q|A)\s*[:\-.]/i,
    /\b(?:FORM\s+IKU|Persentase\s+PTS|Jumlah\s+Total|Ya\s*\/\s*Tidak|\[Sheet:\s*[^\]]+\]|\s\|\s)\b/i,
    /\b(?:Passport|Passpor|KITAS|ITAS|SKTT|VITAS|LoA|Financial\s+Statement|Medical\s+Statement|Academic\s+Transcripts)\b/i,
    /\b(?:Teks\s+hasil\s+OCR|hasil\s+OCR\s+gambar|CATATAN\s+UNTUK|LOG\s+O\s+PROFILE|DESKRIPSI\s+ORMAWA)\b/i
  ];
  const hits = markerGroups.filter((re) => re.test(value)).length;
  const labelValueCount = (value.match(/\b[A-Za-z][A-Za-z0-9\s/().-]{2,40}\s*:\s*\S/g) || []).length;
  const longStructured = value.length > 450 && (hits >= 1 || labelValueCount >= 3);
  return hits >= 2 || longStructured;
}

function isRawDocumentLeakComplaint(question) {
  const value = String(question || '').trim();
  if (!value) return false;
  const complaint = /\b(?:kenapa|kok|mengapa|loh|lah|aneh|salah|bocor|full\s*dokumen|dokumen\s+mentah|raw|nyangkut|ngawur|tidak\s+nyambung|ga\s+nyambung|gak\s+nyambung|nggak\s+nyambung|jadi\s+begini|seperti\s+ini)\b/i.test(value);
  if (!complaint) return false;
  return isConversationRawDocumentQuote(value) || value.length > 500;
}

function buildRawDocumentLeakComplaintAnswer() {
  return 'Maaf ya, Kak. Itu tidak seharusnya terkirim dalam bentuk potongan dokumen mentah. Saya akan tahan jawaban seperti itu dan tidak memakai kutipan dokumen mentah tadi sebagai sumber jawaban berikutnya. Kalau detail yang ditanyakan belum ada di data yang aman, saya akan jawab bahwa informasinya belum tersedia dan menyarankan konfirmasi ke admin kampus.';
}
function getRecentConversation(sessionData) {
  const maxMessages = parseInt(process.env.SEMANTIC_RAG_CONTEXT_MESSAGES || '8', 10);
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  const recent = messages.slice(-Math.max(0, maxMessages || 0));
  return recent
    .map((m) => {
      const direction = String(m && m.direction ? m.direction : 'message').trim();
      const message = clampText(m && m.message ? m.message : '', 500);
      if (isConversationRawDocumentQuote(message)) return '';
      return message ? `${direction}: ${message}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
function getRecentUserConversation(sessionData) {
  const maxMessages = parseInt(process.env.SEMANTIC_RAG_CONTEXT_MESSAGES || '8', 10);
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  const recent = messages.slice(-Math.max(0, maxMessages || 0));
  return recent
    .filter((m) => {
      const direction = String((m && (m.direction || m.role)) || '').toLowerCase();
      return !direction || direction === 'user' || direction === 'incoming' || direction === 'inbound';
    })
    .map((m) => clampText((m && (m.message || m.content || m.text)) || '', 500))
    .filter((message) => message && !isConversationRawDocumentQuote(message))
    .join('\n');
}

function getLastUserMessage(sessionData) {
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const direction = String((m && (m.direction || m.role)) || '').toLowerCase();
    if (direction && direction !== 'user' && direction !== 'incoming' && direction !== 'inbound') continue;
    const message = clampText((m && (m.message || m.content || m.text)) || '', 500);
    if (message && !isConversationRawDocumentQuote(message)) return message;
  }
  return '';
}

function isEnglishQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (!q) return false;
  const englishSignals = /\b(english|international|student|apply|application|admission|requirements|help university|where|how do i|please|thanks|thank you|and the|i am an)\b/i;
  const indonesianSignals = /\b(kakak|untuk|silakan|mohon|bagaimana|dimana|apa|ya|tidak|atau)\b/i;
  return englishSignals.test(q) && !indonesianSignals.test(q);
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Continue with best-effort extraction below.
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function rewriteQuestionWithLlm(client, question, options = {}) {
  const current = String(question || '').trim();
  const sessionData = options && options.sessionData ? options.sessionData : null;
  const programHint = String(options && options.programHint ? options.programHint : '').trim();
  const intentHint = String(options && options.intentHint ? options.intentHint : '').trim();
  if (!client || !current) {
    return {
      canonicalQuestion: current,
      searchQueries: [current],
      intent: 'unknown',
      entities: {},
      confidence: 0,
      needsClarification: false,
      clarificationQuestion: ''
    };
  }

  const conversation = getRecentConversation(sessionData);
  const prompt = [
    'Tugasmu memahami pertanyaan WhatsApp user dalam bahasa apa pun, termasuk typo, slang, singkatan, dan follow-up pendek.',
    'Ubah menjadi intent, entitas, dan query pencarian knowledge-base yang jelas tanpa menjawab pertanyaan.',
    'Gunakan konteks percakapan hanya untuk menyelesaikan rujukan seperti "itu", "yang tadi", "berapa?", atau pilihan pendek.',
    'Balas HANYA JSON valid dengan field: canonicalQuestion, searchQueries, intent, entities, confidence, needsClarification, clarificationQuestion.',
    'intent harus salah satu: small_talk, out_of_domain, pmb_overview, registration_how, registration_fee, fee_detail, fee_general, fee_comparison, current_wave, schedule_window, program_list, program_definition, program_comparison, program_recommendation, career, scholarship, campus_location, ukm, dual_degree, requirements, contact, feedback, unknown.',
    'entities adalah object ringkas. Gunakan key yang relevan seperti programs, wave, month, date, fee_scope, career_goal, interest, partner, location, scholarship_type.',
    'Pahami sinonim secara makna: harga/tarif/uang/bayar/biaya/ongkos/dana kuliah termasuk konteks fee; jurusan/prodi/program studi/major termasuk program; daftar/registrasi/pendaftaran termasuk PMB.',
    'Jika user bertanya biaya pendaftaran, gunakan intent registration_fee, bukan fee_comparison.',
    'Jika user membandingkan harga/biaya antar prodi, gunakan intent fee_comparison. Jika membandingkan isi/fokus prodi, gunakan intent program_comparison.',
    'Jika user hanya berkata perbandingan antara beberapa prodi tanpa kata biaya/harga/tarif/UKT/DPP/uang, jangan gunakan fee_comparison; gunakan program_comparison atau needsClarification jika maksudnya belum jelas.',
    'Untuk pertanyaan minat, hobi, personality, kekhawatiran, atau kecocokan jurusan seperti menggambar, DKV, desain, introvert, takut coding, takut matematika, bingung pilih jurusan, gunakan program_recommendation.',
    'Untuk rekomendasi jurusan, pertimbangkan semua program resmi yang tersedia, termasuk Double Degree UTB jika user mengarah ke DKV/desain visual. Jangan mengarang jurusan partner DNUI/HELP jika tidak ada di data.',
    'Jika user bertanya PMB masih dibuka atau gelombang sekarang, gunakan current_wave atau schedule_window, bukan pmb_overview.',
    'searchQueries berisi 1-4 query pendek yang maknanya sama, bukan jawaban.',
    'Jika ada HINT SISTEM, gunakan sebagai konteks makna pertanyaan; jangan minta klarifikasi untuk singkatan yang sudah dijelaskan oleh hint.',
    'Jika user menyebut gelombang seperti 1A, 2B, 3B, 4A, boleh tambahkan variasi romawi seperti I A, II B, III B, IV A pada searchQueries.',
    'Jika pertanyaan terlalu ambigu dan tidak ada hint yang membantu, needsClarification=true dan tulis pertanyaan klarifikasi singkat.',
    '',
    programHint || intentHint ? `HINT SISTEM:\n${programHint ? `Program terkait: ${programHint}` : ''}${programHint && intentHint ? '\n' : ''}${intentHint ? `Intent terkait: ${intentHint}` : ''}` : 'HINT SISTEM: -',
    '',
    conversation ? `KONTEKS PERCAKAPAN:\n${conversation}` : 'KONTEKS PERCAKAPAN: -',
    '',
    `PERTANYAAN USER:\n${current}`
  ].join('\n');

  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: 'You are a query understanding layer for a grounded RAG chatbot. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 350,
      temperature: 0,
      top_p: 0.1
    });
    const obj = extractJsonObject(completion && completion.choices && completion.choices[0] && completion.choices[0].message ? completion.choices[0].message.content : '');
    if (!obj || typeof obj !== 'object') throw new Error('semantic rewrite returned non-json');
    // Ensure fallback to original question if any field missing
    const canonicalQuestion = String(obj.canonicalQuestion || current).trim() || current;
    const searchQueries = uniqueList([canonicalQuestion].concat(obj.searchQueries || []), 4);
    const intent = normalizeSemanticIntent(obj.intent);
    const entities = normalizeSemanticEntities(obj.entities);
    const confidence = Number.isFinite(Number(obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0;
    return {
      canonicalQuestion,
      searchQueries: searchQueries.length ? searchQueries : [canonicalQuestion],
      intent: refineSemanticIntent(intent, entities, current),
      entities,
      confidence,
      needsClarification: obj.needsClarification === true,
      clarificationQuestion: String(obj.clarificationQuestion || '').trim()
    };
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] query rewrite failed; using raw question');
    // Always return an object with canonicalQuestion set to original question
    return {
      canonicalQuestion: current,
      searchQueries: [current],
      intent: 'unknown',
      entities: {},
      confidence: 0,
      needsClarification: false,
      clarificationQuestion: ''
    };
  }
}

const SEMANTIC_INTENTS = new Set([
  'small_talk',
  'out_of_domain',
  'pmb_overview',
  'registration_how',
  'registration_fee',
  'fee_detail',
  'fee_general',
  'fee_comparison',
  'current_wave',
  'schedule_window',
  'program_list',
  'program_definition',
  'program_comparison',
  'program_recommendation',
  'career',
  'scholarship',
  'campus_location',
  'ukm',
  'dual_degree',
  'requirements',
  'contact',
  'feedback',
  'unknown'
]);

function normalizeSemanticIntent(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return 'unknown';
  const aliases = {
    pmb: 'pmb_overview',
    registration: 'registration_how',
    registration_info: 'registration_how',
    registration_cost: 'registration_fee',
    application_fee: 'registration_fee',
    daftar_fee: 'registration_fee',
    tuition: 'fee_detail',
    tuition_fee: 'fee_detail',
    fee: 'fee_detail',
    fee_question: 'fee_detail',
    price: 'fee_detail',
    cost: 'fee_detail',
    price_comparison: 'fee_comparison',
    cost_comparison: 'fee_comparison',
    current_open_wave: 'current_wave',
    open_wave: 'current_wave',
    wave_now: 'current_wave',
    schedule: 'schedule_window',
    wave_schedule: 'schedule_window',
    majors: 'program_list',
    programs: 'program_list',
    study_programs: 'program_list',
    program_info: 'program_definition',
    major_definition: 'program_definition',
    major_comparison: 'program_comparison',
    program_recommend: 'program_recommendation',
    major_recommendation: 'program_recommendation',
    career_prospect: 'career',
    prospect: 'career',
    location: 'campus_location',
    address: 'campus_location',
    organization: 'ukm',
    student_activity: 'ukm',
    double_degree: 'dual_degree',
    dualdegree: 'dual_degree',
    admission_requirements: 'requirements',
    pmb_requirements: 'requirements',
    pmb_contact: 'contact'
  };
  const normalized = aliases[raw] || raw;
  return SEMANTIC_INTENTS.has(normalized) ? normalized : 'unknown';
}

function normalizeSemanticEntities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  Object.keys(value).forEach((key) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return;
    const entry = value[key];
    if (Array.isArray(entry)) {
      out[cleanKey] = entry.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8);
    } else if (entry && typeof entry === 'object') {
      out[cleanKey] = Object.fromEntries(
        Object.entries(entry)
          .map(([k, v]) => [String(k || '').trim(), String(v || '').trim()])
          .filter(([k, v]) => k && v)
      );
    } else {
      const text = String(entry || '').trim();
      if (text) out[cleanKey] = text;
    }
  });
  return out;
}

function entityText(entities, keys) {
  const values = [];
  for (const key of keys) {
    const entry = entities && Object.prototype.hasOwnProperty.call(entities, key) ? entities[key] : null;
    if (Array.isArray(entry)) values.push(...entry);
    else if (entry && typeof entry === 'object') values.push(...Object.values(entry));
    else if (entry) values.push(entry);
  }
  return uniqueList(values, 8).join(' ');
}

function hasSemanticFeeSignal(question) {
  const q = String(question || '').toLowerCase();
  return /\b(biaya|harga|tarif|ongkos|uang|kuliah|bayar|dpp|ukt|pendaftaran|semester|termurah|termahal|murah|mahal|hemat|irit|terjangkau|price|cost|fee)\b/.test(q);
}

function refineSemanticIntent(intent, entities, question = '') {
  const current = SEMANTIC_INTENTS.has(intent) ? intent : 'unknown';
  const feeScope = entityText(entities, ['fee_scope', 'scope', 'component']).toLowerCase();
  if (current === 'dual_degree' && hasSemanticFeeSignal(question)) {
    return /\b(pendaftaran|daftar|application)\b/.test(feeScope) || /\bbiaya\s+pendaftaran|pendaftaran\b/i.test(String(question || ''))
      ? 'registration_fee'
      : 'fee_detail';
  }
  if ((current === 'fee_detail' || current === 'fee_general') && /\b(pendaftaran|daftar|application)\b/.test(feeScope)) {
    return 'registration_fee';
  }
  if (current === 'fee_comparison' && !hasSemanticFeeSignal(question)) {
    return 'program_comparison';
  }
  if ((current === 'program_comparison' || current === 'program_recommendation') && /\b(biaya|harga|tarif|ongkos|ukt|dpp|pendaftaran|bayar|uang|price|cost|fee)\b/.test(feeScope)) {
    return 'fee_comparison';
  }
  return current;
}

function buildSemanticRoutingQuestions(question, rewrite) {
  const current = String(question || '').trim();
  const canonical = String(rewrite && rewrite.canonicalQuestion ? rewrite.canonicalQuestion : current).trim() || current;
  const intent = rewrite && rewrite.intent ? rewrite.intent : 'unknown';
  const entities = rewrite && rewrite.entities ? rewrite.entities : {};
  const programs = entityText(entities, ['programs', 'program', 'prodi', 'major', 'majors']);
  const wave = entityText(entities, ['wave', 'gelombang']);
  const feeScope = entityText(entities, ['fee_scope', 'scope', 'component']);
  const goal = entityText(entities, ['career_goal', 'career', 'interest', 'minat']);
  const partner = entityText(entities, ['partner', 'university', 'campus_partner']);
  const location = entityText(entities, ['location', 'campus', 'kampus']);
  const scholarship = entityText(entities, ['scholarship_type', 'beasiswa']);
  const monthOrDate = entityText(entities, ['month', 'date', 'tanggal', 'bulan']);

  let semanticCue = '';
  switch (intent) {
    case 'registration_fee':
      semanticCue = `biaya pendaftaran ${programs} ${wave} berapa`;
      break;
    case 'fee_detail':
      semanticCue = `rincian biaya ${programs} ${wave} ${feeScope} DPP UKT biaya awal masuk`;
      break;
    case 'fee_general':
      semanticCue = `biaya apa saja ${programs} ${wave} pendaftaran DPP UKT`;
      break;
    case 'fee_comparison':
      semanticCue = `perbandingan biaya harga ${programs} ${feeScope}`;
      break;
    case 'program_comparison':
      semanticCue = `perbedaan program studi jurusan ${programs}`;
      break;
    case 'program_recommendation':
      semanticCue = `rekomendasi jurusan prodi untuk ${goal || canonical}`;
      break;
    case 'career':
      semanticCue = `prospek kerja karir ${programs || goal}`;
      break;
    case 'program_definition':
      semanticCue = `apa itu program studi ${programs}`;
      break;
    case 'program_list':
      semanticCue = 'jurusan prodi program studi yang ada di ITB STIKOM Bali';
      break;
    case 'registration_how':
      semanticCue = 'cara daftar pendaftaran online https://siap.stikom-bali.ac.id offline kampus';
      break;
    case 'current_wave':
      semanticCue = `gelombang pendaftaran yang sedang buka sekarang ${monthOrDate}`;
      break;
    case 'schedule_window':
      semanticCue = `jadwal pendaftaran gelombang ${wave || monthOrDate}`;
      break;
    case 'pmb_overview':
      semanticCue = 'PMB penerimaan mahasiswa baru pendaftaran jadwal biaya prodi beasiswa syarat';
      break;
    case 'scholarship':
      semanticCue = `beasiswa bantuan biaya kuliah ${scholarship}`;
      break;
    case 'campus_location':
      semanticCue = `alamat lokasi kampus ITB STIKOM Bali ${location}`;
      break;
    case 'ukm':
      semanticCue = `UKM organisasi kegiatan mahasiswa minat ${goal}`;
      break;
    case 'dual_degree':
      semanticCue = `double degree dual degree ${partner} jurusan prodi pasangan padanan`;
      break;
    case 'requirements':
      semanticCue = 'syarat dokumen pendaftaran mahasiswa baru PMB';
      break;
    case 'contact':
      semanticCue = 'kontak admin PMB pendaftaran';
      break;
    default:
      semanticCue = '';
  }

  return uniqueList([
    semanticCue,
    canonical,
    ...(rewrite && Array.isArray(rewrite.searchQueries) ? rewrite.searchQueries : []),
    current
  ], 8);
}
// FAQ document keywords for direct lookup fallback
const FAQ_KEYWORDS = {
  career: ['career center', 'lowongan kerja', 'magang', 'job fair', 'rekrutmen', 'campus hiring', 'tracer study', 'konsultasi karier', 'prospek kerja', 'kerja sama perusahaan', 'alumni', 'pekerjaan'],
  student_exchange: ['student exchange', 'pertukaran mahasiswa', 'gccp', 'bccp', 'program exchange', 'credit transfer', 'short program', 'summer program', 'negara mitra', 'syarat student exchange', 'manfaat student exchange'],
  izin_belajar: ['izin belajar', 'study permit', 'mahasiswa asing', 'visa pelajar', 'itas', 'kitas', 'sktt', 'perpanjangan izin', 'dokumen mahasiswa asing', 'pengurusan izin belajar']
};

function getTopicBoost(filename, chunk) {
  const haystack = `${filename || ''} ${chunk || ''}`.toLowerCase();
  let boost = 0;
  if (/faq|pertanyaan|jawaban|FAQ/i.test(haystack)) boost += 0.15;
  if (/career center|lowongan|magang|job fair|tracer study|konsultasi karier/i.test(haystack)) boost += 0.2;
  if (/student exchange|pertukaran mahasiswa|gccp|bccp|program exchange/i.test(haystack)) boost += 0.2;
  if (/izin belajar|study permit|mahasiswa asing|visa pelajar|itas|kitas/i.test(haystack)) boost += 0.2;
  return boost;
}

function faqLookup(question, topK = 8) {
  const index = getCachedSemanticIndex();
  if (!Array.isArray(index) || !index.length) return [];

  const q = String(question || '').toLowerCase();
  const results = [];

  for (const item of index) {
    const chunk = String(item.chunk || '');
    const filename = String(item.filename || item.sourceFile || '');
    const haystack = `${filename} ${chunk}`.toLowerCase();

    let matchScore = 0;
    let matchedTopic = null;

    for (const [topic, keywords] of Object.entries(FAQ_KEYWORDS)) {
      for (const keyword of keywords) {
        if (haystack.includes(keyword.toLowerCase())) {
          matchScore += 0.3;
          if (!matchedTopic) matchedTopic = topic;
        }
      }
    }

    // Also check if the question itself appears in the chunk
    const qTokens = q.split(/\s+/).filter(t => t.length >= 3);
    const chunkTokens = chunk.toLowerCase().split(/\s+/);
    const overlap = qTokens.filter(t => chunkTokens.includes(t)).length;
    if (overlap > 0) {
      matchScore += overlap * 0.15;
    }

    if (matchScore > 0.2) {
      results.push({
        item,
        score: Math.min(matchScore, 1.0),
        topic: matchedTopic,
        sourceType: 'faq-lookup'
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

async function retrieveSemanticContexts(searchQueries, options = {}) {
  const index = getCachedSemanticIndex();
  const topK = Number.isFinite(Number(options.topK)) ? Math.max(1, Number(options.topK)) : parseInt(process.env.SEMANTIC_RAG_TOP_K || process.env.RAG_TOP_K || '8', 10);
  const maxCandidates = Math.max(topK, parseInt(process.env.SEMANTIC_RAG_CANDIDATES || '1000', 10));
  const queries = uniqueList(searchQueries, 4);
  const question = options.question || queries[0] || '';
  const questionIntent = options.intent || detectGenericIntent(question);

  // Get database candidates (generic scoring)
  const dbCandidates = await getDatabaseCandidates(queries, { ...options, question, intent: questionIntent });

  // Process semantic index candidates with generic scoring. Only use stored
  // embeddings when the runtime can create a real query embedding; otherwise
  // mock embeddings make rankings look confident but effectively random.
  let semanticScored = [];
  if (Array.isArray(index) && index.length && queries.length) {
    const queryEmbeddings = [];
    if (hasUsableOpenAiApiKey()) {
      for (const query of queries) {
        try {
          const emb = await computeEmbeddingCached(query);
          if (Array.isArray(emb) && emb.length) queryEmbeddings.push(emb);
        } catch (e) {
          logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] query embedding failed');
        }
      }
    }

    for (const item of index) {
      if (!item || !String(item.chunk || '').trim()) continue;
      const emb = queryEmbeddings.length && Array.isArray(item.embedding) ? item.embedding : null;

      let bestSemanticScore = 0;
      if (emb) {
        for (const qEmb of queryEmbeddings) {
          bestSemanticScore = Math.max(bestSemanticScore, cosineSimilarity(qEmb, emb));
        }
      }

      let bestGenericScore = 0;
      let bestLexicalScore = 0;
      for (const query of queries) {
        const haystack = String(item.chunk || '') + ' ' + String(item.filename || item.sourceFile || '');
        const genericScore = computeGenericScore(query, haystack, questionIntent);
        const lexicalScore = computeLexicalScore(query, item.chunk, item.filename || item.sourceFile || '');
        bestGenericScore = Math.max(bestGenericScore, genericScore);
        bestLexicalScore = Math.max(bestLexicalScore, lexicalScore);
      }

      const sourceIntentBoost = computeSourceIntentBoost(question, item, questionIntent);
      const topicBoost = getTopicBoost(item.filename || item.sourceFile || '', item.chunk);
      const baseScore = emb
        ? (bestSemanticScore * 0.45 + bestGenericScore * 0.45 + bestLexicalScore * 0.1)
        : (bestGenericScore * 0.7 + bestLexicalScore * 0.3);
      const combinedScore = Math.max(0, Math.min(1, baseScore + sourceIntentBoost + topicBoost));

      if (combinedScore > 0.1) {
        semanticScored.push({
          item,
          score: combinedScore,
          lexicalScore: bestLexicalScore,
          semanticScore: bestSemanticScore,
          genericScore: bestGenericScore,
          sourceIntentBoost,
          topicBoost,
          sourceType: 'semantic',
          intent: questionIntent
        });
      }
    }
  }

  // Merge semantic and database candidates
  const allCandidates = [...semanticScored, ...dbCandidates];

  // Deduplicate by trainingId + chunk content hash
  const seenSignatures = new Set();
  const dedupedCandidates = [];
  for (const candidate of allCandidates) {
    const item = candidate.item;
    const signature = `${item.trainingId || 'no-tid'}-${item.chunk.slice(0, 100)}`;

    if (seenSignatures.has(signature)) {
      // If duplicate, keep the one with higher score
      const existingIdx = dedupedCandidates.findIndex(c => {
        const existingSig = `${c.item.trainingId || 'no-tid'}-${c.item.chunk.slice(0, 100)}`;
        return existingSig === signature;
      });
      if (existingIdx >= 0 && candidate.score > dedupedCandidates[existingIdx].score) {
        dedupedCandidates[existingIdx] = candidate;
      }
    } else {
      seenSignatures.add(signature);
      dedupedCandidates.push(candidate);
    }
  }

  // Sort by combined score
  dedupedCandidates.sort((a, b) => b.score - a.score);

  const toContext = (s) => ({
    id: s.item.id || null,
    score: s.score,
    chunk: s.item.chunk,
    filename: s.item.filename || s.item.sourceFile || null,
    trainingId: s.item.trainingId || null,
    divisionKey: s.item.divisionKey || null,
    metadata: s.item.metadata || null,
    intent: s.intent || questionIntent,
    sourceType: s.sourceType || null
  });

  const dedupeContexts = (list) => {
    const seen = new Set();
    const out = [];
    for (const ctx of Array.isArray(list) ? list : []) {
      if (!ctx || !ctx.chunk) continue;
      const signature = `${ctx.trainingId || 'no-tid'}-${String(ctx.chunk || '').slice(0, 100)}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push(ctx);
    }
    return out;
  };

  const candidateContexts = dedupedCandidates.slice(0, maxCandidates).map(toContext);
  const dbCandidateContexts = dbCandidates.slice(0, maxCandidates).map(toContext);

  // Apply quality-control filtering. If the filter removes every otherwise
  // relevant candidate, keep strong raw candidates instead of immediately
  // falling back to a vague/no-data answer.
  const rawContexts = candidateContexts.slice(0, topK);
  const filteredCandidates = dedupeContexts([
    ...filterSemanticContextsForQuestion(question, candidateContexts),
    ...filterSemanticContextsForQuestion(question, dbCandidateContexts)
  ]).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const filteredContexts = filteredCandidates.slice(0, topK);
  const relaxedMinRaw = Number(process.env.SEMANTIC_RAG_RELAXED_MIN_SCORE || '0.16');
  const relaxedMin = Number.isFinite(relaxedMinRaw) ? relaxedMinRaw : 0.16;
  const minContextScoreRaw = Number(process.env.SEMANTIC_RAG_MIN_CONTEXT_SCORE || '0.22');
  const minContextScore = Number.isFinite(minContextScoreRaw) ? minContextScoreRaw : 0.22;
  const isInstitutionVisionMissionRetrieval = /\b(visi|misi)\b/i.test(String(question || ''))
    && /\b(stikom\s+bali|itb\s+stikom|kampus|institut|lembaga)\b/i.test(String(question || ''))
    && !/\b(ukm|ormawa|bem|dpm|hima|himaprodi|inbis|inkubator|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(String(question || ''));
  const allowRelaxedFallback = !(isInstitutionVisionMissionRetrieval || questionIntent === 'facility' || (questionIntent === 'requirement' && /\b(pendaftaran|daftar|pmb|registrasi)\b/i.test(question)));
  const strictDocumentOnly = isStrictDocumentOnlyMode();

  let contexts = filteredContexts.length
    ? filteredContexts
    : (allowRelaxedFallback ? candidateContexts.filter((ctx) => Number(ctx && ctx.score) >= relaxedMin).slice(0, topK) : []);

  if (minContextScore > 0 && contexts.length) {
    contexts = contexts.filter((ctx) => Number(ctx.score) >= minContextScore);
  }

  // FAQ fallback: only use direct keyword lookup when strict document-only mode is disabled
  if (contexts.length === 0 && !strictDocumentOnly && envFlag('SEMANTIC_RAG_ALLOW_FAQ_LOOKUP', false)) {
    const faqResults = faqLookup(question, topK);
    if (faqResults.length > 0) {
      contexts = faqResults.slice(0, topK).map((s) => ({
        id: s.item.id || null,
        score: s.score,
        chunk: s.item.chunk,
        filename: s.item.filename || s.item.sourceFile || null,
        trainingId: s.item.trainingId || null,
        divisionKey: s.item.divisionKey || null,
        metadata: s.item.metadata || null,
        intent: s.intent || questionIntent,
        sourceType: s.sourceType
      }));
    }
  }

  return {
    contexts,
    topScore: contexts.length ? contexts[0].score : 0,
    indexSize: (Array.isArray(index) ? index.length : 0) + dbCandidates.length,
    rawContextCount: rawContexts.length,
    filteredContextCount: filteredCandidates.length,
    relaxedFallbackUsed: !filteredContexts.length && contexts.length > 0,
    faqFallbackUsed: contexts.length > 0 && contexts[0].sourceType === 'faq-lookup'
  };
}

function buildContextText(contexts, options = {}) {
  const maxChars = parseInt(process.env.SEMANTIC_RAG_CONTEXT_MAX_CHARS || '9000', 10);
  const filterAdmin = options.filterAdmin !== false; // Default to true
  let used = 0;
  const blocks = [];
  const list = Array.isArray(contexts) ? contexts : [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    
    // Support both 'chunk' and 'text' fields for compatibility
    const content = c && (c.chunk || c.text);
    if (!content) continue;
    
    // Filter out raw administrative documents unless explicitly disabled
    if (filterAdmin && isLikelyRawAdministrativeDocument(content, c.filename || c.sourceFile || c.source || '')) {
      continue;
    }
    
    const source = [c && c.filename, c && c.trainingId].filter(Boolean).join(' | ') || `chunk-${i + 1}`;
    const body = clampText(content, 1800);
    if (!body) continue;
    const block = `[#${i + 1}] Sumber: ${source}\n${body}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join('\n\n');
}

function isLikelyRawAdministrativeDocument(chunk, filename = '') {
  const text = String(chunk || '');
  const file = String(filename || '');
  if (!text.trim()) return false;

  const haystack = `${file}\n${text}`;
  const legalHits = [
    /\bPERJANJIAN\s+KERJA\s*SAMA\b/i,
    /\bNOTA\s+KESEPAHAMAN\b/i,
    /\bPIHAK\s+(?:PERTAMA|KESATU|KEDUA)\b/i,
    /\bPARA\s+PIHAK\b/i,
    /\bPasal\s+\d+\b/i,
    /\bFORCE\s+MAJEURE\b/i,
    /\bHAK\s+DAN\s+KEWAJIBAN\b/i,
    /\bPENYELESAIAN\s+PERSELISIHAN\b/i,
    /\bADDENDUM\b/i,
    /\bNama\s+Mitra\b/i,
    /\bbermeterai\s+cukup\b/i,
    /\bdipergunakan\s+sebagaimana\s+mestinya\b/i,
    /\bkekuatan\s+hukum\s+yang\s+sama\b/i,
    /\bdibuat\s+dalam\s+rangkap\b/i,
    /\bkorespondensi\b/i
  ].filter((pattern) => pattern.test(haystack)).length;

  const placeholderLike = /_{5,}|\.{8,}|:{3,}|(?:\(\s*NAMA\s+MITRA\s*\))/i.test(haystack);
  const hasStudentFacingEvidence = /\b(biaya|dpp|ukt|pendaftaran|gelombang|jadwal|program\s+studi|prodi|beasiswa|fasilitas|ukm|ormawa|career\s*center|language\s+learning|kampus)\b/i.test(text);
  
  // Address/contact patterns that indicate document headers
  const addressPattern = /\b(?:Jalan|Jl\.?|Jalan\s+Raya|Alamat)\s+[A-Z][a-z]+.*\d+.*\b/i.test(haystack);
  const contactPattern = /\b(?:Telepon|E\s*-\s*mail|Email|Telp)\s*::?\s*\d+/i.test(haystack);
  
  // SK/Keputusan detection
  const isSkDecree = /\bKEPUTUSAN\b/i.test(haystack) && /\bSK\b/i.test(haystack) && /\bAkreditasi\b/i.test(haystack);
  const isAdministrativeDecree = /\bMenimbang:\s* bahwa/i.test(haystack) && /\bMengingat:\s*Undang-undang\b/i.test(haystack);

  // Contract template signatures
  const contractFooter = /\bDemikian\s+Perjanjian\s+ini\s+dibuat\b/i.test(haystack);
  const signingBlock = /\bbertanda\s+tangan\s+di\s+bawah\s+ini\b/i.test(haystack);

  if (legalHits >= 2) return true;
  if (legalHits >= 1 && (placeholderLike || addressPattern || contactPattern)) return true;
  if (isSkDecree || isAdministrativeDecree) return true;
  if (contractFooter || signingBlock) return true;
  if (/\b(?:mou|moa|kontrak|kerja\s+sama|kerjasama|memorandum|mitra)\b/i.test(file) && legalHits >= 1 && !hasStudentFacingEvidence) return true;
  return false;
}

function sanitizeSemanticIndex(index) {
  if (!Array.isArray(index)) return [];
  return index.filter(item => {
    if (!item || !item.chunk) return false;
    return !isLikelyRawAdministrativeDocument(item.chunk, item.filename || item.sourceFile || '');
  });
}

function hasSemanticEvidenceAlignment(question, chunk) {
  const qLower = String(question || '').toLowerCase();
  const cLower = String(chunk || '').toLowerCase();
  
  // Reject very short or meaningless queries
  const qTokens = qLower.split(/\s+/).filter(Boolean);
  if (qTokens.length < 2) return false;
  
  // Extract specific named entities from question (not generic categories)
  // Look for specific proper nouns or distinctive terms
  const specificTerms = [];
  
  // LinkedIn Career Center specific - if question mentions LinkedIn, chunk must mention LinkedIn
  if (qLower.includes('linkedin')) specificTerms.push('linkedin');
  
  // Program names (full names)
  const programMatch = /\b(sistem\s+informasi|teknik\s+informatika|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/i.exec(qLower);
  if (programMatch) specificTerms.push(programMatch[1]);
  
  // If specific terms found, chunk must contain at least one of them
  if (specificTerms.length > 0) {
    for (const term of specificTerms) {
      if (cLower.includes(term)) return true;
    }
    return false;
  }
  
  // If no specific terms, check for generic entities as fallback
  const genericEntities = [];
  const genericProgramMatch = /\b(si|ti|sk|bd|mi)\b/i.exec(qLower);
  if (genericProgramMatch) genericEntities.push(genericProgramMatch[1]);
  
  const ukmMatch = /\b(ukm|ormawa)\b/i.exec(qLower);
  if (ukmMatch) genericEntities.push(ukmMatch[1]);
  
  const facilityMatch = /\b(fasilitas|laboratorium|perpustakaan)\b/i.exec(qLower);
  if (facilityMatch) genericEntities.push(facilityMatch[1]);
  
  // If no entities at all, return true (allow generic alignment)
  if (genericEntities.length === 0) return true;
  
  // Check if chunk contains at least one generic entity
  for (const entity of genericEntities) {
    if (cLower.includes(entity)) return true;
  }
  return false;
}

function filterSemanticContextsForQuestion(question, contexts) {
  if (!Array.isArray(contexts)) return [];
  
  const questionIntent = detectGenericIntent(question);
  const questionAnchors = extractQueryAnchorTerms(question);
  const qScope = String(question || '').toLowerCase();
  const asksInstitutionVisionMission = /\b(visi|misi)\b/i.test(qScope)
    && /\b(stikom\s+bali|itb\s+stikom|kampus|institut|lembaga)\b/i.test(qScope)
    && !/\b(ukm|ormawa|bem|dpm|hima|himaprodi|inbis|inkubator|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(qScope);
  const isLegalQuestion = /\b(pasal|ayat|force\s*majeure|addendum|perjanjian|klausul|isi\s+pasal|legal|hukum)\b/i.test(question);
  
  return contexts.filter(ctx => {
    if (!ctx || !ctx.chunk) return false;
    
    // Conditional admin/legal filtering
    if (!isLegalQuestion && isLikelyRawAdministrativeDocument(ctx.chunk, ctx.filename || ctx.sourceFile || '')) {
      return false;
    }

    const haystack = String(ctx.chunk || '') + ' ' + String(ctx.filename || '') + ' ' + String(ctx.sourceFile || '');
    if (asksInstitutionVisionMission && /\b(?:ukm|ormawa|organisasi\s+mahasiswa|bem|dpm|hima|himaprodi|inbis|inkubator|career\s*center|pusat\s+karier|student\s+exchange|jcos|ksl|rade|basket|esport|paskamras|voice\s+of\s+stikom|mapala)\b/i.test(haystack)) return false;

    const asksInkubator = /\b(inbis|inkubator(?:\s+bisnis)?)\b/i.test(question);
    if (asksInkubator && !/\b(inbis|inkubator(?:\s+bisnis)?)\b/i.test(haystack)) return false;

    const asksCareerCenter = /\b(career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(question);
    if (asksCareerCenter && !/\b(career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(haystack)) return false;

    if (questionIntent === 'facility') {
      const hasFacilitySignal = /fasilitas|sarana|prasarana|lab|laboratorium|perpustakaan|kantin|parkir|parkiran|wifi|wi-fi|ruang\s+(?:kelas|kuliah)|career\s*center|inkubator|language\s+learning|softskill|hi-?think/i.test(haystack);
      const hasInternationalSupportSignal = /student\s*exchange|mahasiswa\s+asing|visa|itas|international|internasional/i.test(haystack);
      const hasSpecificFacilityEvidence = hasFacilitySignal || hasInternationalSupportSignal;
      const isInternationalOnly = hasInternationalSupportSignal && !hasFacilitySignal && !/career\s*center|inkubator|language\s+learning|softskill|hi-?think/i.test(haystack);
      const questionMentionsInternational = /student\s*exchange|mahasiswa\s+asing|visa|itas|international|internasional/i.test(question);
      if (!hasSpecificFacilityEvidence || (isInternationalOnly && !questionMentionsInternational)) return false;
    }

    if (questionIntent === 'requirement' && /\b(pendaftaran|daftar|pmb|registrasi)\b/i.test(question) && !/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas/i.test(question)) {
      if (!/\b(pendaftaran|daftar|pmb|registrasi|mahasiswa\s+baru|formulir)\b/i.test(haystack)) return false;
      if (/student\s*exchange|mahasiswa\s+asing|international|internasional|visa|itas/i.test(haystack)) return false;
    }
    
    // Generic compatibility check
    const genericScore = computeGenericScore(question, ctx.chunk, questionIntent);
    if (genericScore < 0.2) return false;
    
    // Anchor compatibility: only require distinctive query terms. The older
    // generic entity check treated normal question words as required entities,
    // which made valid RAG chunks fall through to fallback answers.
    if (!hasAnchorOverlap(question, String(ctx.chunk || '') + ' ' + String(ctx.filename || '') + ' ' + String(ctx.sourceFile || ''))) return false;

    const chunkEntities = extractGenericEntities(ctx.chunk);
    
    // Intent compatibility - allow related intents but penalize cross-domain
    const chunkIntent = ctx.intent || detectGenericIntent(ctx.chunk);
    
    // Define related intent groups
    const intentGroups = {
      'schedule': ['schedule', 'general'],
      'fee': ['fee', 'general'],
      'program': ['program', 'list', 'career', 'general'],
      'career': ['career', 'program', 'general'],
      'requirement': ['requirement', 'general'],
      'scholarship': ['scholarship', 'fee', 'general'],
      'international_program': ['international_program', 'program', 'general'],
      'facility': ['facility', 'general'],
      'organization': ['organization', 'general'],
      'legal': ['legal'],
      'general': ['general', 'schedule', 'fee', 'program', 'requirement']
    };
    
    const questionGroup = intentGroups[questionIntent] || ['general'];
    const chunkGroup = intentGroups[chunkIntent] || ['general'];
    const intentCompatible = questionGroup.includes(chunkIntent) || chunkGroup.includes(questionIntent);
    
    if (!intentCompatible) return false;
    
    // Additional domain-specific rejection: if question has specific domain entities, reject chunks without them
    const hasDomainEntities = questionAnchors.some(e => 
      /\b(portal\s+akademik|sion|wisuda|yudisium|kelulusan|career\s+center|pusat\s+karier|llc|double\s+degree|dual\s+degree)\b/i.test(e)
    );
    if (hasDomainEntities) {
      const chunkHasDomainEntities = chunkEntities.some(ce =>
        /\b(portal\s+akademik|sion|wisuda|yudisium|kelulusan|career\s+center|pusat\s+karier|llc|double\s+degree|dual\s+degree)\b/i.test(ce)
      );
      if (!chunkHasDomainEntities) return false;
    }
    
    // Cross-domain penalty: if question is about academic but chunk is about PMB, reject
    const isAcademicQuestion = /\b(jadwal\s+kuliah|nilai|krs|transkrip|skripsi|portal\s+akademik|sion|wisuda|yudisium)\b/i.test(question);
    const isPmbChunk = /\b(pmb|pendaftaran\s+mahasiswa\s+baru|gelombang\s+pendaftaran|daftar\s+kuliah)\b/i.test(ctx.chunk);
    if (isAcademicQuestion && isPmbChunk) return false;
    
    return true;
  });
}

// Generic evidence selection by compatibility
function selectEvidenceByCompatibility(question, contexts, options = {}) {
  if (!Array.isArray(contexts)) return [];
  
  const questionIntent = options.intent || detectGenericIntent(question);
  const questionAnchors = extractQueryAnchorTerms(question);
  const isLegalQuestion = /\b(pasal|ayat|force\s*majeure|addendum|perjanjian|klausul|isi\s+pasal|legal|hukum)\b/i.test(question);
  const maxEvidence = options.maxEvidence || 5;
  
  const evidenceUnits = [];
  
  for (const ctx of contexts) {
    if (!ctx || !ctx.chunk) continue;
    
    // Split into evidence units
    const units = splitIntoEvidenceUnits(ctx.chunk, question);
    
    for (const unit of units) {
      // Clean document markers
      const cleaned = cleanDocumentMarkers(unit);
      
      // Conditional admin/legal filtering
      if (!isLegalQuestion && isLikelyRawAdministrativeDocument(cleaned, ctx.filename || ctx.sourceFile || '')) {
        continue;
      }
      
      // Generic compatibility scoring
      const genericScore = computeGenericScore(question, cleaned, questionIntent);
      if (genericScore < 0.25) continue;
      
      // Anchor compatibility: only enforce distinctive terms from the user's question.
      const anchorOverlap = hasAnchorOverlap(question, String(cleaned || '') + ' ' + String(ctx.filename || '') + ' ' + String(ctx.sourceFile || ''));
      if (!anchorOverlap) continue;
      
      // Factual terms check (reject generic-only matches)
      const hasFactualTerms = /[A-Z][a-z]+|\d+/.test(cleaned) || questionAnchors.length > 0;
      if (!hasFactualTerms) continue;
      
      evidenceUnits.push({
        text: cleaned,
        source: ctx.filename || ctx.sourceFile || 'unknown',
        sourceId: ctx.id || ctx.trainingId || 'unknown',
        score: genericScore,
        entityScore: anchorOverlap ? 1 : 0,
        intentScore: questionIntent === detectGenericIntent(cleaned) ? 1 : 0.5,
        reason: `generic_score=${genericScore.toFixed(2)}; anchor_overlap=${anchorOverlap}`,
        isSelectedEvidence: true
      });
    }
  }
  
  // Deduplicate and sort
  const seen = new Set();
  const deduped = evidenceUnits.filter(item => {
    const key = item.text.slice(0, 200).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Sort by combined score
  deduped.sort((a, b) => {
    const aTotal = a.score * 0.5 + a.entityScore * 0.3 + a.intentScore * 0.2;
    const bTotal = b.score * 0.5 + b.entityScore * 0.3 + b.intentScore * 0.2;
    return bTotal - aTotal;
  });
  
  return deduped.slice(0, maxEvidence);
}

// Generic answerability evaluation
function evaluateGenericAnswerability(question, selectedEvidence, options = {}) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const questionIntent = options.intent || detectGenericIntent(question);
  const questionAnchors = extractQueryAnchorTerms(question);
  
  if (!evidence.length) {
    return { answerable: false, reason: 'no_selected_evidence', missingEvidence: ['selected_evidence'] };
  }
  
  const combinedText = evidence.map(e => e.text).join(' ');
  const missingEvidence = [];
  
  // Check for required information type based on intent
  if (questionIntent === 'fee') {
    if (!/\b(Rp\.?|rupiah|\d[\d.,]+\s*(?:ribu|juta)|\d{5,})\b/i.test(combinedText)) {
      missingEvidence.push('fee_amount');
    }
  }
  
  if (questionIntent === 'schedule') {
    // Require actual date, not just the word "jadwal" or "pendaftaran"
    if (!/\b(\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i.test(combinedText)) {
      missingEvidence.push('date_or_period');
    }
  }
  
  if (questionIntent === 'requirement') {
    // Require concrete document types, not just the word "syarat"
    if (!/\b(ijazah|ktp|kk|foto|rapor|transkrip|skck)\b/i.test(combinedText)) {
      missingEvidence.push('concrete_requirements');
    }
  }
  
  // Check for distinctive query anchors, not generic question words.
  if (questionAnchors.length > 0 && !hasAnchorOverlap(question, combinedText)) {
    missingEvidence.push('requested_anchor');
  }
  
  // Check for list questions
  if (/\b(apa\s+saja|daftar|list|pilihan|macam|sebutkan)\b/i.test(question)) {
    const listItems = combinedText.match(/(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S/g) || [];
    const concreteItems = combinedText.match(/\b[A-Z][a-z]+\b/g) || [];
    if (listItems.length < 2 && concreteItems.length < 2) {
      missingEvidence.push('multiple_concrete_items');
    }
  }
  
  return {
    answerable: missingEvidence.length === 0,
    reason: missingEvidence.length ? 'missing_required_answer_shape' : 'selected_evidence_answerable',
    missingEvidence
  };
}

function appendAnswerQualityLog(answer, metadata = {}) {
  const timestamp = new Date().toISOString();
  
  // Preserve caller-provided values exactly; only derive when not provided
  const confidenceScore = Number.isFinite(metadata.confidenceScore) ? metadata.confidenceScore : 0;
  const confidenceTier = metadata.confidenceTier || (() => {
    // Derive confidence tier only when caller did not provide it
    if (confidenceScore >= 0.3) return 'HIGH';
    if (confidenceScore >= 0.18) return 'MEDIUM';
    if (confidenceScore >= 0.1) return 'LOW';
    return 'VERY_LOW';
  })();
  
  const action = metadata.action || (() => {
    // Derive action only when caller did not provide it
    const answerLower = String(answer || '').toLowerCase();
    if (answerLower.includes('tidak cukup data') || answerLower.includes('maaf, saya belum')) {
      return 'fallback';
    }
    if (metadata.preflightChanged || (metadata.preflightIssues && metadata.preflightIssues.length > 0)) {
      return 'clarify';
    }
    return 'answer';
  })();
  
  const logEntry = {
    ts: timestamp,
    source: metadata.source || 'semantic-rag',
    question: metadata.question || '',
    category: metadata.category || 'general',
    confidenceTier,
    confidenceScore,
    action,
    reason: metadata.reason || '',
    answerPreview: String(answer || '').substring(0, 200),
    contextCount: metadata.contextCount || 0,
    answerabilityResult: metadata.answerabilityResult || null,
    preflightChanged: metadata.preflightChanged || false,
    preflightIssues: metadata.preflightIssues || []
  };
  
  // Persist to tmp/answer-quality.jsonl (non-fatal)
  try {
    const tmpDir = path.join(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const logPath = path.join(tmpDir, 'answer-quality.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf8');
  } catch (err) {
    // Logging failure must never break the answer pipeline
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] Failed to append answer quality log');
  }
  
  // Also log via logger for visibility
  logger.info(logEntry, '[SemanticRAG] Answer quality log');
  
  return logEntry;
}

function detectAnswerCategory(answer, question) {
  const ans = String(answer || '').toLowerCase();
  const q = String(question || '').toLowerCase();
  
  if (ans.includes('tidak cukup data') || ans.includes('maaf, saya belum')) {
    return 'insufficient_data';
  }
  
  // Check schedule-related patterns first (more specific)
  if (/\b(jadwal|gelombang|tanggal|deadline)\b/i.test(ans)) {
    return 'schedule_related';
  }
  
  // Check requirement-related patterns (more specific)
  if (/\b(syarat|persyaratan|dokumen|berkas)\b/i.test(ans)) {
    return 'requirement_related';
  }
  
  // Check fee-related patterns (without "pendaftaran" to avoid conflicts)
  if (/\b(biaya|harga|tarif|ukt|dpp|semester)\b/i.test(ans)) {
    return 'fee_related';
  }
  
  // Check program-related patterns
  if (/\b(prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi)\b/i.test(ans)) {
    return 'program_related';
  }
  
  return 'general';
}

function formatAnswerByCategory(answer, category) {
  const formatted = String(answer || '').trim();
  
  switch (category) {
    case 'insufficient_data':
      // Ensure insufficient data answers are polite and helpful
      if (!formatted.includes('Mohon maaf') && !formatted.includes('Maaf')) {
        return `Mohon maaf, ${formatted.charAt(0).toLowerCase() + formatted.slice(1)}`;
      }
      return formatted;
    
    case 'fee_related':
    case 'program_related':
    case 'schedule_related':
    case 'requirement_related':
      // These categories are already formatted by the LLM
      return formatted;
    
    default:
      return formatted;
  }
}

function buildSpecificInsufficientDataAnswer(question, missingEvidence = []) {
  const q = String(question || '').toLowerCase();
  
  if (missingEvidence.includes('fee_amount')) {
    return 'Mohon maaf, saya belum menemukan informasi biaya yang lengkap untuk pertanyaan tersebut. Untuk rincian biaya yang akurat, sebaiknya dikonfirmasi ke admin PMB.';
  }
  
  if (missingEvidence.includes('date_or_period')) {
    return 'Mohon maaf, saya belum menemukan informasi jadwal atau tanggal yang spesifik untuk pertanyaan tersebut. Silakan hubungi admin PMB untuk jadwal terbaru.';
  }
  
  if (missingEvidence.includes('concrete_requirements')) {
    return 'Mohon maaf, saya belum menemukan daftar syarat atau dokumen yang lengkap. Untuk informasi syarat pendaftaran yang lengkap, silakan cek di https://siap.stikom-bali.ac.id atau hubungi admin kampus.';
  }
  
  if (missingEvidence.includes('multiple_concrete_items')) {
    return 'Mohon maaf, saya belum menemukan daftar lengkap yang diminta. Data yang tersedia belum cukup untuk menyebutkan semua item secara spesifik.';
  }
  
  return 'Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi untuk menjawab pertanyaan tersebut. Mungkin Anda bisa mengubah pertanyaannya atau menanyakan hal lain.';
}

function collapseRepeatedLetters(value) {
  return String(value || '').toLowerCase().replace(/([a-z])\1{1,}/g, '$1');
}

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const curr = Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function isGreetingOnly(normalizedText) {
  const text = String(normalizedText || '').trim().toLowerCase();
  if (!text) return false;
  const informationIntent = /\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|lokasi|alamat|ukm|ormawa|double\s*degree|dual\s*degree|akreditasi|prospek|kerja|apa\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i;
  if (informationIntent.test(text)) return false;

  const addressWords = new Set([
    'kak', 'kakak', 'min', 'admin', 'tiko', 'semua', 'guys',
    'gan', 'agan', 'bro', 'sis', 'mas', 'mbak', 'pak', 'bu',
    'bang', 'bos', 'boss', 'bli', 'mb', 'cuk', 'bot'
  ]);
  const timeWords = new Set(['pagi', 'siang', 'sore', 'malam']);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;

  const cleanWord = (word) => collapseRepeatedLetters(word).replace(/[^a-z]/g, '');
  const first = cleanWord(words[0]);
  const exactGreetings = new Set(['halo', 'hallo', 'hai', 'hay', 'hi', 'hello', 'helo', 'salam', 'p', 'tes', 'test', 'testing', 'ping']);
  const fuzzyGreetingRoots = ['halo', 'hallo', 'hai', 'hello', 'helo', 'hay', 'salam'];
  const firstIsGreeting = exactGreetings.has(first)
    || addressWords.has(first)
    || timeWords.has(first)
    || (first.length >= 3 && fuzzyGreetingRoots.some((root) => editDistance(first, root) <= 2));
  if (!firstIsGreeting) return false;

  return words.slice(1).every((word) => {
    const cleaned = cleanWord(word);
    return addressWords.has(cleaned) || timeWords.has(cleaned) || exactGreetings.has(cleaned);
  });
}

function tryMixedIntentAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksPersonalPreference = /\b(kamu|tiko|bot|admin)\b/i.test(q) && /\b(suka|senang|hobi|hobby)\b/i.test(q);
  const asksUkmMusic = /\b(ukm|ormawa|unit\s+kegiatan|organisasi\s+mahasiswa)\b/i.test(q) && /\b(musik|lagu|nyanyi|vokal|vos|seni)\b/i.test(q);
  if (!asksPersonalPreference || !asksUkmMusic) return null;
  return {
    answer: [
      'Kalau sebagai asisten, saya tidak punya selera pribadi seperti manusia, Kak.',
      '',
      'Untuk minat musik atau seni, dari data UKM/Ormawa yang tersedia kakak bisa melihat UKM Musik dan VOS. UKM Musik berkaitan dengan minat bermusik, sedangkan VOS berkaitan dengan vokal/paduan suara.',
      '',
      'Untuk jadwal latihan, pendaftaran anggota, atau kontak pengurus, saya belum punya detail yang cukup aman di data. Bagian itu sebaiknya dikonfirmasi ke kemahasiswaan atau pengurus UKM terkait.'
    ].join('\n'),
    source: 'semantic-rag-mixed-intent',
    frameSource: 'semantic-rag-mixed-intent'
  };
}

function trySmallTalkAnswer(question) {
  const raw = String(question || '').trim();
  if (!raw) return null;
  const hasCampusInfoIntent = /\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|fasilitas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis|language\s+learning|llc|bccp|gccp|gcpp|student\s+exchange|hi-?think|lokasi|alamat|ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|double\s*degree|dual\s*degree|akreditasi|prospek|kerja|apa\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i.test(raw);
  const normalized = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

  const shortCheckInPattern = /^(p|tes|test|testing|cek|ping)(\s+(bot|kak|min|admin|tiko))?$/i;
  if (shortCheckInPattern.test(normalized)) {
    return {
      answer: 'Halo Kak, saya Tiko, asisten informasi ITB STIKOM Bali. Ada yang bisa saya bantu seputar PMB, program studi, biaya, beasiswa, atau informasi kampus?'
    };
  }

  if (!hasCampusInfoIntent && /\b(halo|hallo|hai|hay|hi|hello|helo)\b/i.test(normalized) && /\b(mau|ingin|boleh|izin|saya|aku|sy)\b/i.test(normalized) && /\b(tanya|bertanya|nanya|menanyakan)\b/i.test(normalized)) {
    return {
      answer: 'Boleh, Kak. Silakan tanyakan seputar PMB, program studi, biaya, beasiswa, atau informasi kampus ITB STIKOM Bali.'
    };
  }

  if (!hasCampusInfoIntent && /\b(kamu|tiko|bot|asisten)\b/i.test(normalized) && /\b(bot|manusia|ai|artificial\s+intelligence|robot)\b/i.test(normalized)) {
    return {
      answer: 'Saya Tiko, asisten virtual informasi ITB STIKOM Bali. Saya bukan manusia, tapi saya bisa bantu menjawab pertanyaan seputar PMB, program studi, biaya, beasiswa, dan informasi kampus yang tersedia di data.'
    };
  }
  if (/\b(bisa\s+bertanya\s+tentang\s+apa\s+saja|pertanyaan\s+apa\s+saja|bisa\s+tanya\s+apa\s+saja|kamu\s+bisa\s+bantu\s+apa\s+saja)\b/i.test(normalized)) {
    return {
      answer: 'Kakak bisa bertanya seputar ITB STIKOM Bali, misalnya PMB dan cara daftar, jadwal gelombang, rincian biaya, program studi, beasiswa, Double Degree, fasilitas kampus, Career Center, Inkubator Bisnis, UKM, RPL, dan kontak kampus.'
    };
  }
  if (/\b(kamu\s+pintar(?:\s+juga)?|pintar\s+juga|bagus\s+juga|hebat\s+juga|selamat\s+bekerja|cuma\s+mau\s+menyapa|hanya\s+mau\s+menyapa)\b/i.test(normalized)) {
    return {
      answer: 'Terima kasih, Kak. Saya siap bantu kalau ada yang ingin ditanyakan seputar ITB STIKOM Bali.'
    };
  }
  if (/\b(terima\s*(?:kasih|ksih|ksh)|terimakasih|makasih|mksh|mksih|thanks|thank\s+you|thx)\b/i.test(normalized)) {
    return {
      answer: 'Sama-sama, Kak. Kalau ada yang ingin ditanyakan lagi seputar ITB STIKOM Bali, saya siap bantu.'
    };
  }

  if (/^(oke|ok|okay|okey|siap|baik|sip|mantap|noted|iya|ya|y)$/i.test(normalized)) {
    return {
      answer: 'Baik, Kak. Silakan lanjutkan kalau ada yang ingin ditanyakan seputar ITB STIKOM Bali.'
    };
  }

  if (/\b(stikoman|stikomman)\b/i.test(normalized) && /\b(tau|tahu|kenal|apa|siapa|itu)\b/i.test(normalized)) {
    return {
      answer: 'Kalau yang kakak maksud "Stikoman", itu biasanya dipakai sebagai sebutan informal untuk warga/mahasiswa/keluarga STIKOM Bali. Untuk info resmi kampus, saya bisa bantu jelaskan seputar prodi, PMB, biaya, beasiswa, jadwal pendaftaran, atau UKM.'
    };
  }

  if (/\b(apa\s+kabar|apa\s+khabar|kabar\s+apa|khabar\s+apa|gimana\s+kabar|gimana\s+khabar|kabar\s+kamu|khabar\s+kamu|kbr|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar|bagaimana\s+khabar)\b/i.test(normalized)) {
    return {
      answer: 'Saya baik-baik saja, terima kasih. Ada yang bisa saya bantu seputar ITB STIKOM Bali?'
    };
  }


  if (/\b(kamu|tiko|bot|asisten)\b/i.test(normalized) && /\b(siapa|apa|bisa\s+bantu\s+apa|bantu\s+apa|lakukan|fungsi|tugas)\b/i.test(normalized) && !/\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|pendaftaran|jadwal|gelombang|beasiswa|fasilitas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|soft\s*skill|softskill|pengembangan\s+softskill|inkubator|language\s+learning|llc|bccp|gccp|gcpp|student\s+exchange|hi-?think|ukm|ormawa|double\s*degree|dual\s*degree)\b/i.test(normalized)) {
    return {
      answer: 'Saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu menjawab pertanyaan seputar PMB, cara daftar, jadwal pendaftaran, rincian biaya, program studi, beasiswa, UKM, fasilitas, lokasi kampus, dan informasi kampus yang tersedia di data.'
    };
  }
  if (/\b(santai\s+aja|jangan\s+serius|ga\s+usah\s+serius|gak\s+usah\s+serius|nggak\s+usah\s+serius)\b/i.test(normalized)) {
    return {
      answer: 'Siap, Kak. Saya coba jawab lebih santai, tapi tetap saya jaga supaya informasi kampusnya tidak menebak di luar data.'
    };
  }

  if (/\b(sibuk|lagi\s+apa|ngapain|available|bisa\s+bantu)\b/i.test(normalized) && !/\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|pendaftaran|jadwal|gelombang|beasiswa|fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|language\s+learning\s+center|llc|bccp|gccp|hi-?think|ukm|ormawa|double\s*degree|dual\s*degree)\b/i.test(normalized)) {
    return {
      answer: 'Saya siap bantu, Kak. Mau tanya seputar PMB, biaya, prodi, beasiswa, UKM, fasilitas, atau informasi kampus lainnya?'
    };
  }

  if (/^(?:boleh\s+)?(?:mau\s+)?(?:tanya|bertanya|nanya)(?:\s+(?:kak|kakak|min|admin))?$|^(?:boleh\s+tanya|mau\s+tanya|izin\s+tanya)(?:\s+(?:kak|kakak|min|admin))?$/i.test(normalized)
      && !/\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|fasilitas|lokasi|alamat|ukm|ormawa|double\s*degree|dual\s*degree|akreditasi|apa\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i.test(normalized)) {
    return {
      answer: 'Boleh, Kak. Silakan tulis pertanyaannya seputar ITB STIKOM Bali, misalnya PMB, biaya, prodi, jadwal pendaftaran, beasiswa, fasilitas, atau informasi kampus lainnya.'
    };
  }

  if (!hasCampusInfoIntent && /\b(kamu|tiko|bot|admin)\b/i.test(normalized) && /\b(suka|senang|hobi|hobby)\b/i.test(normalized) && /\b(musik|lagu|nyanyi|band)\b/i.test(normalized)) {
    return {
      answer: 'Kalau sebagai asisten, saya tidak punya selera pribadi seperti manusia, Kak. Tapi saya bisa ngobrol santai soal musik secukupnya. Untuk info kampus, saya juga bisa bantu soal UKM seni seperti Musik, Tari, Tabuh, Teater Biner, atau VOS kalau datanya tersedia.'
    };
  }
  if (!hasCampusInfoIntent && /\b(kamu|tiko|bot|admin)\b/i.test(normalized) && /\b(suka|senang|hobi|hobby)\b/i.test(normalized) && /\b(film|movie|nonton|drama|series|serial)\b/i.test(normalized)) {
    return {
      answer: 'Kalau sebagai asisten, saya tidak punya selera pribadi seperti manusia, Kak. Tapi saya bisa ngobrol santai secukupnya. Kalau mau balik ke info kampus, saya bisa bantu soal PMB, prodi, biaya, UKM, atau fasilitas ITB STIKOM Bali.'
    };
  }

  if (/\b(kok|kenapa|mengapa)\b/i.test(normalized) && /\b(serius|kaku|formal)\b/i.test(normalized)) {
    return {
      answer: 'Hehe iya Kak, maaf kalau terdengar terlalu serius. Saya coba tetap santai, tapi untuk informasi kampus saya juga harus jaga supaya tidak menebak di luar data.'
    };
  }
  const religiousGreeting = getReligiousGreetingReply(normalized);
  if (isGreetingOnly(normalized) || /^(selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)(\s+(kak|min|admin|tiko|pagi|siang|sore|malam))*$/.test(normalized) || religiousGreeting) {
    const prefix = religiousGreeting ? `${religiousGreeting} ` : '';
    return {
      answer: `${prefix}Halo Kak, saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu seputar PMB, rincian biaya, program studi, jadwal pendaftaran, beasiswa, dan informasi kampus.`
    };
  }

  return null;
}

function extractOrgStructureSubject(question) {
  const q = String(question || '').toLowerCase();
  const known = [
    ['Inkubator Bisnis', /\binkubator(?:\s+bisnis)?\b/i],
    ['Career Center', /\bcareer\s*center|pusat\s+karier\b/i],
    ['Language Learning Center', /\blanguage\s+learning\s+center|llc\b/i],
    ['Program Pengembangan Softskill', /\bsoftskill|pengembangan\s+softskill\b/i],
    ['Hi-Think', /\bhi-?think\b/i],
    ['GCCP', /\bgccp\b/i],
    ['UKM/Ormawa', /\bukm|ormawa|organisasi\s+mahasiswa\b/i],
    ['Double Degree', /\bdouble\s+degree|dual\s+degree\b/i]
  ];
  for (const [label, re] of known) {
    if (re.test(q)) return label;
  }
  const beforeMarker = q.match(/^(.{3,80}?)(?:\s+ini)?\s+(?:ada\s+)?(?:di\s*bawah|dibawah|berada\s+di\s+bawah|masuk\s+ke|naungan|dibawahi|dikelola|bagian|direktorat)/i);
  if (beforeMarker && beforeMarker[1]) return beforeMarker[1].replace(/\b(kak|min|admin|mau|ingin|tanya|bertanya|tentang)\b/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return 'bagian tersebut';
}

function normalizeOrgStructureText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function buildOrgSubjectRegex(subject) {
  const raw = String(subject || '').trim();
  if (!raw || /^bagian tersebut$/i.test(raw)) return null;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(escaped, 'i');
}

function extractOrgStructureEvidence(question, subject) {
  const index = getCachedSemanticIndex();
  if (!Array.isArray(index) || !index.length) return null;

  const subjectRegex = buildOrgSubjectRegex(subject);
  if (!subjectRegex) return null;

  const relationRegex = /\b(direktorat|divisi|bagian|biro|lembaga|upt|departemen|di\s*bawah|dibawah|berada\s+di\s+bawah|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+(?:kepada|ke)|kepala|koordinator)\b/i;
  const questionNorm = normalizeOrgStructureText(question);
  const questionTerms = questionNorm.split(/\s+/).filter((term) => term.length >= 4 && !/^(apa|yang|ada|bawah|dibawah|direktorat|bagian|divisi|unit|struktur|organisasi|stikom|bali|kampus|kakak|kak)$/i.test(term));

  const scored = [];
  for (const item of index) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (isLikelyRawAdministrativeDocument(chunk, item && (item.filename || item.sourceFile || ''))) continue;
    if (!subjectRegex.test(chunk)) continue;
    if (!relationRegex.test(chunk)) continue;

    const norm = normalizeOrgStructureText(chunk);
    let score = 10;
    for (const term of questionTerms) {
      if (norm.includes(term)) score += 1;
    }
    if (/\b(surat\s+keputusan|sk\b|struktur\s+organisasi)\b/i.test(chunk)) score += 3;
    scored.push({ item, chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return null;

  const lines = best.chunk
    .split(/(?:\r?\n|(?<=[.!?])\s+)/)
    .map((line) => line.replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean);
  const selected = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (subjectRegex.test(line) || relationRegex.test(line)) {
      if (i > 0 && selected.length < 1) selected.push(lines[i - 1]);
      selected.push(line);
      if (i + 1 < lines.length) selected.push(lines[i + 1]);
    }
    if (selected.join('\n').length > 900) break;
  }

  const evidence = uniqueList(selected, 8).join('\n').trim() || clampText(best.chunk.replace(/\s{2,}/g, ' ').trim(), 900);
  if (!evidence) return null;

  return {
    evidence,
    filename: best.item && (best.item.filename || best.item.sourceFile) ? (best.item.filename || best.item.sourceFile) : null
  };
}
function tryOrganizationalStructureAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksOrgStructure = /\b(struktur\s+organisasi|di\s*bawah|dibawah|berada\s+di\s+bawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke|kepala\s+bagian|koordinator)\b/i.test(q);
  if (!asksOrgStructure) return null;

  const subject = extractOrgStructureSubject(question);
  const evidence = extractOrgStructureEvidence(question, subject);
  if (evidence && evidence.evidence) {
    return {
      answer: [
        `Saya menemukan informasi tentang struktur/posisi ${subject} pada dokumen yang tersedia.`,
        '',
        evidence.evidence,
        '',
        'Jadi, jawaban di atas saya ambil dari dokumen yang tersedia. Untuk struktur terbaru atau perubahan internal, sebaiknya tetap dikonfirmasi ke admin kampus.'
      ].join('\n'),
      source: 'semantic-rag-org-structure-evidence'
    };
  }

  return {
    answer: [
      `Untuk struktur organisasi atau posisi ${subject} di ITB STIKOM Bali, saya belum menemukan informasi yang menyebutkan ${subject} berada di bawah direktorat/divisi/bagian apa pada dokumen yang tersedia saat ini.`,
      '',
      'Agar tidak menebak, informasi ini sebaiknya dikonfirmasi ke admin kampus atau pihak internal yang memegang struktur organisasi terbaru.',
      '',
      'Kalau dokumen struktur organisasi resmi sudah tersedia, saya bisa bantu jawab berdasarkan informasi tersebut.'
    ].join('\n'),
    source: 'semantic-rag-org-structure-unavailable'
  };
}

function tryShortClarificationAnswer(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return null;
  const contextualizeSafeFallback = (answer) => {
    const topic = raw.replace(/\s+/g, ' ').replace(/["'`]+/g, '').trim();
    if (!topic) return answer;
    return `Terkait pertanyaan kakak tentang ${topic}, ${String(answer || '').replace(/^\s*/, '').replace(/^[A-Z]/, (m) => m.toLowerCase())}`;
  };

  if (/^\d{1,2}$/.test(q)) {
    return {
      answer: 'Kak, angka itu belum cukup jelas untuk saya jawab. Bisa tuliskan pertanyaannya lengkap? Contoh: \"rincian biaya SI Gelombang I B\", \"gelombang sekarang apa?\", atau \"cara daftar bagaimana?\"'
    };
  }

  if (/^(sk|si|ti|bd|mi)$/i.test(raw)) {
    const map = { sk: 'Sistem Komputer', si: 'Sistem Informasi', ti: 'Teknologi Informasi', bd: 'Bisnis Digital', mi: 'Manajemen Informatika' };
    const label = map[q] || raw.toUpperCase();
    return {
      answer: 'Kakak maksud ' + label + '? Saya bisa bantu jelaskan biaya, prospek kerja, pengertian prodi, atau perbedaan dengan prodi lain. Coba tuliskan misalnya: \"biaya ' + label + ' Gelombang I B\" atau \"prospek kerja ' + label + '\".'
    };
  }

  if (/^(?:i|ii|iii|iv|1|2|3|4)\s*[a-c]$/i.test(raw)) {
    const spaced = raw.replace(/\s+/g, '').replace(/^([1234ivx]+)([abc])$/i, '$1 $2');
    return tryScheduleWindowAnswer('gelombang ' + spaced);
  }

  if (/^(bisa\s+)?jelaskan\s+lebih\s+detail\s*(lagi)?\??$/i.test(q)) {
    return {
      answer: 'Bisa, Kak. Detail bagian apa yang ingin kakak lanjutkan? Misalnya biaya, gelombang pendaftaran, cara daftar, prodi, beasiswa, atau Double Degree.'
    };
  }

  return null;
}
function detectUnsupportedDoubleDegreePartner(question) {
  const q = normalizeFacilityTerm(question);
  if (!/\b(double\s*degree|dual\s*degree|dd)\b/i.test(q)) return null;
  const knownPartner = /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university|help\b)\b/i.test(q);
  if (/\bessex\b/i.test(q)) return 'Essex University';
  const partnerMatch = q.match(/\b(?:dengan|bersama|mitra|partner)\s+([a-z0-9\s]{3,70}?\b(?:university|universitas|college|institute|institut)\b(?:\s+[a-z0-9]+){0,4})/i);
  if (!partnerMatch || knownPartner) return null;
  const raw = partnerMatch[1].replace(/\b(?:itu|yang|ditargetkan|target|calon|mahasiswa|seperti|apa|ya)\b.*$/i, '').trim();
  if (!raw) return null;
  const normalized = normalizeFacilityTerm(raw);
  if (/\b(utb|universitas teknologi bandung|dnui|dalian neusoft|help university|help)\b/i.test(normalized)) return null;
  return raw.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function tryUnsupportedDoubleDegreePartnerAnswer(question) {
  const partner = detectUnsupportedDoubleDegreePartner(question);
  if (!partner) return null;
  return {
    answer: [
      `Saya belum menemukan data kerja sama Double Degree ITB STIKOM Bali dengan ${partner} pada dokumen yang tersedia.`,
      '',
      'Data Double Degree yang tersedia saat ini hanya mencantumkan:',
      '- UTB - Universitas Teknologi Bandung untuk Double Degree nasional',
      '- DNUI - Dalian Neusoft University of Information, China untuk Double Degree internasional',
      '- HELP University, Malaysia untuk Double Degree internasional',
      '',
      `Jadi saya belum bisa memastikan target calon mahasiswa, syarat, atau detail program Double Degree dengan ${partner}. Agar tidak keliru, bagian itu perlu dikonfirmasi ke Admin PMB atau dokumen resmi terbaru kampus.`
    ].join('\n'),
    source: 'semantic-rag-unsupported-double-degree-partner',
    frameSource: 'semantic-rag-insufficient-data'
  };
}
function tryDoubleDegreeFollowUpAnswer(question, _indexForQuery, options = {}) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  const asksInternational = /\b(internasional|international|luar\s+negeri)\b/i.test(q);
  const asksNational = /\b(nasional|national)\b/i.test(q);
  if (!asksInternational && !asksNational) return null;
  if (/\b(biaya|harga|tarif|ukt|dpp|jadwal|syarat|daftar|pendaftaran|registrasi|beasiswa)\b/i.test(q)) return null;

  const recent = getRecentConversation(options && options.sessionData);
  const hint = String(options && options.intentHint ? options.intentHint : '');
  const hasDoubleDegreeContext = /\b(double\s*degree|dual\s*degree|dd)\b/i.test(`${recent}\n${hint}`);
  if (!hasDoubleDegreeContext) return null;

  const expanded = asksInternational
    ? 'Double Degree internasional'
    : 'Double Degree nasional';
  const result = tryDualDegreeAnswer(expanded);
  return result && result.answer ? { ...result, source: 'semantic-rag-dual-degree-followup' } : null;
}
function getReligiousGreetingReply(normalizedText) {
  const t = String(normalizedText || '').toLowerCase().trim();
  if (/\b(assalamualaikum|assalamu\s+alaikum)\b/.test(t)) return "Wa'alaikumsalam kak.";
  if (/\b(om\s+swastiastu|swastiastu)\b/.test(t)) return 'Om Swastiastu, kak.';
  if (/\bshalom\b/.test(t)) return 'Shalom, kak.';
  if (/\b(namo\s+buddhaya|nammo\s+buddhaya)\b/.test(t)) return 'Namo Buddhaya, kak.';
  if (/\bsalam\s+kebajikan\b/.test(t)) return 'Salam Kebajikan, kak.';
  if (/\b(rahayu|salam\s+rahayu)\b/.test(t)) return 'Rahayu, kak.';
  return '';
}

function tryOutOfDomainAnswer(question) {
  const q = String(question || '').toLowerCase();
  const isUiUxProgramQuestion = /\b(ui\/ux|uiux|user\s+interface|user\s+experience|ux|desainer|designer|product\s+design|produk\s+digital)\b/i.test(q) && /\b(program\s+studi|prodi|jurusan|cocok|pilih|rekomendasi)\b/i.test(q);
  if (isUiUxProgramQuestion) return null;
  const asksMarketPrice = /\b(bitcoin|btc|crypto|kripto|saham|emas|kurs|dollar|dolar|harga\s+hari\s+ini)\b/i.test(q);
  const asksWeather = /\b(cuaca|prakiraan\s+cuaca|weather|hujan|suhu)\b/i.test(q);
  const asksRecipe = /\b(resep|masak|memasak|nasi\s+goreng|bumbu)\b/i.test(q);
  const asksGeneralPerson = /\b(presiden\s+indonesia|cristiano\s+ronaldo|ronaldo|artis|selebriti|tokoh\s+dunia)\b/i.test(q);
  if (asksMarketPrice || asksWeather || asksRecipe || asksGeneralPerson) {
    return {
      answer: 'Maaf, saya hanya bisa membantu informasi seputar ITB STIKOM Bali berdasarkan data kampus yang tersedia. Untuk pertanyaan di luar konteks kampus, seperti harga pasar, cuaca, resep, atau tokoh umum, sebaiknya kakak cek sumber khusus yang relevan.'
    };
  }
  const asksMedicalCareer = /\b(dokter|kedokteran|perawat|keperawatan|bidan|farmasi|apoteker|rumah\s+sakit)\b/.test(q);
  const asksMedicalCare = /\b(menyembuhkan|sembuhin|obat|diagnosa|diagnosis|pasien|operasi|bedah)\b/.test(q);
  if (asksMedicalCare && !asksMedicalCareer) {
    return {
      answer: 'Maaf, saya hanya bisa berdiskusi tentang ITB STIKOM Bali. Untuk cara menyembuhkan orang, obat, diagnosis, atau tindakan medis, saya tidak bisa memberikan arahan karena itu di luar konteks informasi kampus ITB STIKOM Bali.'
    };
  }
  if (asksMedicalCareer) {
    return {
      answer: [
        'Untuk menjadi dokter atau kuliah di bidang kedokteran, ITB STIKOM Bali tidak memiliki program studi kedokteran pada daftar prodi yang tersedia.',
        '',
        'ITB STIKOM Bali berfokus pada bidang teknologi dan bisnis digital, seperti Sistem Informasi, Teknologi Informasi, Sistem Komputer, Bisnis Digital, Manajemen Informatika, S2 Sistem Informasi, dan program Double Degree.',
        '',
        'Kalau kakak tertarik membantu bidang kesehatan dari sisi teknologi, prodi seperti Sistem Informasi atau Teknologi Informasi masih bisa relevan untuk jalur sistem informasi kesehatan, aplikasi, data, atau teknologi pendukung layanan kesehatan.'
      ].join('\n')
    };
  }

  const partnerDoubleDegreeContext = /\b((double|dual)\s*degree|dd)\b/.test(q) && /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university)\b/.test(q);
  const mentionsKnownOtherCampus = /\b(universitas\s+udayana|udayana|unud|universitas\s+indonesia|ui\b|universitas\s+gadjah\s+mada|ugm\b|universitas\s+airlangga|unair\b|institut\s+pertanian\s+bogor|ipb\b|universitas\s+pendidikan\s+ganesha|undiksha\b|politeknik\s+negeri\s+bali|pnb\b|universitas\s+terbuka|institut\s+teknologi\s+bandung|itb\b(?!\s*stikom)|binus|telkom\s+university|undiknas|warmadewa|unud)\b/.test(q);
  const mentionsGenericOtherCampus = /\b(universitas|institut|politeknik|kampus)\s+(?!(teknologi\s+dan\s+bisnis\s+)?stikom\b|itb\s+stikom\b|teknologi\s+bandung\b|dalian\b|help\b|renon\b|jimbaran\b|abiansemal\b)[a-z0-9]+/i.test(q) && !/\b(stikom|itb\s*stikom)\b/.test(q);
  const mentionsOtherCampus = !partnerDoubleDegreeContext && (mentionsKnownOtherCampus || mentionsGenericOtherCampus);
  const asksCampusPrograms = /\b(jurusan|prodi|program\s+studi|fakultas|biaya|pendaftaran|akreditasi|kuliah)\b/.test(q);
  if (!mentionsOtherCampus || !asksCampusPrograms) return null;
  return {
    answer: 'Maaf, saya hanya bisa berdiskusi tentang ITB STIKOM Bali. Kalau kakak ingin tahu jurusan yang ada di ITB STIKOM Bali, saya bisa bantu jelaskan.'
  };
}

function isAcademicScheduleLookupQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;
  const scheduleSignal = /\b(jadwal|kalender|agenda|kapan|tanggal|tgl|hari|jam|periode|pelaksanaan|dilaksanakan|berlangsung)\b/i.test(q);
  const examSignal = /\b(ujian|uts|uas|remedial|remidi|ujian\s+ulang|ujian\s+susulan|susulan)\b/i.test(q);
  return scheduleSignal && examSignal;
}

function isOperationalAcademicPolicyQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;
  if (isAcademicScheduleLookupQuestion(q)) return false;

  const academicPolicySignal = /\b(absensi|presensi|kehadiran|remedial|remidi|ujian\s+ulang|ujian\s+susulan|susulan|kompensasi|dispensasi|izin\s+tidak\s+masuk|sakit|alpha|alpa|bolos)\b/i.test(q);
  if (!academicPolicySignal) return false;

  // PMB/admission questions should keep using the normal PMB route.
  if (/\b(pmb|pendaftaran|daftar\s+kuliah|gelombang|biaya|ukt|dpp|prodi|program\s+studi|jurusan|beasiswa)\b/i.test(q)) return false;
  return true;
}

function isGenericSemanticClarification(question, clarificationQuestion) {
  const q = String(question || '').toLowerCase();
  const c = String(clarificationQuestion || '').toLowerCase();
  if (!c.trim()) return false;

  if (isOperationalAcademicPolicyQuestion(q)) return true;
  if (/\b(apakah\s+anda\s+ingin|apakah\s+kamu\s+ingin|ingin\s+informasi\s+umum\s+atau\s+spesifik|kebijakan\s+remedial|hal\s+lainnya)\b/i.test(c)) return true;
  return false;
}

function tryFeedbackAnswer(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return null;
  const isFeedback = /\b(kok|loh|waduh|salah|tidak\s+nyambung|nggak\s+nyambung|ga\s+nyambung|gak\s+nyambung|tidak\s+menjawab|nggak\s+menjawab|ga\s+menjawab|gak\s+menjawab|jawabannya|jawaban\s+bot|dicek\s+lagi|cek\s+lagi|dari\s+mana\s+dapat\s+informasinya)\b/.test(q);
  const hasRealQuestion = /\b(jurusan|prodi|program\s+studi|biaya|bayar|ukt|dpp|semester|pendaftaran|beasiswa|gelombang|double\s*degree|dual\s*degree|akreditasi|prospek|apa\s+itu|berapa|kapan|dimana|bagaimana)\b/.test(q) || /\b\d{5,}\b/.test(q);
  if (!isFeedback || hasRealQuestion) return null;
  return {
    answer: 'Maaf ya, Kak. Kalau jawaban saya tadi tidak nyambung, berarti data yang saya pegang kemungkinan belum cukup untuk menjawab bagian itu dengan tepat. Saya tidak akan memaksakan jawaban di luar data yang tersedia.'
  };
}

function tryUnsupportedProgramAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(d2|diploma\s*2|diploma\s+dua)\b/.test(q)) return null;
  return {
    answer: 'ITB STIKOM Bali tidak memiliki program D2. Program diploma yang tersedia adalah D3 Manajemen Informatika.'
  };
}

function buildPmbInfoAnswer() {
  return [
    'PMB adalah singkatan dari Penerimaan Mahasiswa Baru, yaitu proses penerimaan calon mahasiswa yang ingin mendaftar kuliah di ITB STIKOM Bali.',
    '',
    'Dalam konteks PMB, kakak bisa bertanya tentang:',
    '',
    '* Pendaftaran: alur daftar, cara mendaftar, dan langkah berikutnya',
    '* Jadwal pendaftaran: gelombang yang sedang buka, tanggal mulai, dan batas akhir',
    '* Program studi: pilihan S1, D3, S2, dan Double Degree',
    '* Rincian biaya: pendaftaran, DPP, biaya awal masuk, dan biaya per semester',
    '* Beasiswa/potongan: KIP, 1K1S, prestasi, yayasan, dan potongan berdasarkan gelombang',
    '* Syarat dan dokumen pendaftaran',
    '* Kontak atau bantuan admin PMB',
    '',
    'Kalau kakak ingin info yang lebih spesifik, silakan tanya misalnya: "jadwal PMB sekarang gelombang berapa?", "rincian biaya SI gelombang 2B?", atau "apa saja syarat pendaftaran?"'
  ].join('\n');
}


function tryPmbContactAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksContact = /\b(kontak|hubungi|menghubungi|nomor|no\.?\s*wa|wa\b|whatsapp|admin|cs|customer\s*service|bantuan|helpdesk)\b/.test(q);
  const pmbContext = /\b(pmb|pendaftaran|daftar|camaba|mahasiswa\s+baru|kuliah|stikom|itb\s*stikom)\b/.test(q);
  if (!asksContact || !pmbContext) return null;

  return {
    answer: [
      'Untuk bantuan pendaftaran/PMB ITB STIKOM Bali, kakak bisa memakai kanal berikut:',
      '',
      '- Online: https://siap.stikom-bali.ac.id',
      '- Offline: datang langsung ke kampus ITB STIKOM Bali agar dibantu petugas PMB.',
      '',
      'Alamat kampus yang bisa dituju:',
      '- Kampus Denpasar/Renon: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
      '- Kampus Jimbaran: Jl. Raya Kampus Udayana, Kuta Selatan, Jimbaran, Bali.',
      '- Kampus Abiansemal: Jl. Janger, Abiansemal, Dauh Yeh Cani, Badung, Bali.',
      '',
      'Kalau di WhatsApp kakak tersedia tombol Hubungi Admin, kakak juga bisa memakai tombol itu untuk bantuan langsung.'
    ].join('\n')
  };
}

function tryPmbRequirementsAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  if (isNonPmbFaqDomainQuestion(question)) return null;
  if (/\b(ukm|ormawa|organisasi\s+mahasiswa|ksl|vos|jcos|mcos|bem|hima|himpunan|kelompok\s+studi\s+linux)\b/i.test(q)) return null;
  const asksRequirement = /\b(syarat|persyaratan|dokumen|berkas|lampiran|formulir|kelengkapan|unggah|mengunggah|diunggah|upload|requirement|requirements|document|documents|application\s+document|application\s+form)\b/.test(q);
  const pmbContext = /\b(daftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|stikom|itb\s*stikom|apply|application|admission|international\s+student|study|studying)\b/.test(q);
  const implicitPmbDocumentQuestion = /\b(dokumen|berkas|lampiran|formulir|unggah|mengunggah|diunggah|upload)\b/.test(q) && /\b(apa\s+saja|apa|harus|perlu|wajib|yang)\b/.test(q);
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  if (/\b(linked\s*in|linkedin)\b/i.test(recent) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(recent) && !asksAdmissionRegistration && /\b(detail|info(?:rmasi)?|daftar|mendaftar|pendaftaran|registrasi|cara|bagaimana|gimana|mengikuti|ikut)\b/i.test(q)) return null;
  const recentPmbContext = /\b(daftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|stikom|itb\s*stikom|apply|application|admission|international\s+student|study|studying)\b/.test(recent);
  if (!asksRequirement || (!pmbContext && !recentPmbContext && !implicitPmbDocumentQuestion)) return null;

  const english = isEnglishQuestion(q) || isEnglishQuestion(recent);
  if (english) {
    return {
      answer: [
        'I do not have a complete and final list of admission documents.',
        '',
        'To avoid mistakes, the safest route is:',
        '',
        '- Check and fill out the online application at https://siap.stikom-bali.ac.id',
        '- Follow the document instructions shown during the application process',
        '- Or visit the ITB STIKOM Bali campus in person for assistance from PMB staff',
        '',
        'If you want, I can also help check the currently open waves or fee details by program.'
      ].join('\n')
    };
  }

  return {
    answer: [
      'Untuk syarat dan dokumen pendaftaran, saya belum menemukan daftar berkas yang lengkap dan final pada data yang tersedia.',
      '',
      'Agar tidak salah menyebut dokumen, langkah paling aman:',
      '',
      '- Cek dan isi pendaftaran online melalui https://siap.stikom-bali.ac.id',
      '- Ikuti arahan dokumen yang muncul pada proses pendaftaran',
      '- Atau datang langsung ke kampus ITB STIKOM Bali untuk dibantu petugas PMB',
      '',
      'Kalau kakak ingin lanjut, saya bisa bantu cek gelombang yang sedang buka atau rincian biaya sesuai prodi.'
    ].join('\n')
  };
}

function tryPmbInfoAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (isNonPmbFaqDomainQuestion(question)) return null;
  if (!/\b(pmb|penerimaan\s+mahasiswa\s+baru|penerimaan\s+maba|maba|camaba)\b/.test(q)) return null;
  const isSpecificSchedule = /\b(jadwal|gelombang|tanggal|deadline|kapan|masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|dibuka|buka|sekarang|hari\s+ini|saat\s+ini)\b/.test(q);
  const isOverview = /\b(apa\s+itu|maksudnya|tentang|informasi|bertanya|tanya|jelaskan|penjelasan|alur|syarat|dokumen)\b/.test(q);
  if (isSpecificSchedule && !isOverview) return null;
  return { answer: buildPmbInfoAnswer() };
}

function tryCurrentOpenWavesAnswer(question) {
  if (isNonPmbFaqDomainQuestion(question)) return null;
  if (!ragEngine || typeof ragEngine.tryStructuredCurrentOpenWavesAnswer !== 'function') return null;
  return ragEngine.tryStructuredCurrentOpenWavesAnswer(question);
}

const ID_MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

const ID_MONTH_MAP = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, ags: 8,
  september: 9, sep: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12
};

function parseYmdParts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function monthLabel(year, month) {
  return `${ID_MONTH_NAMES[month - 1] || String(month)} ${year}`;
}

function monthStartYmd(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function monthEndYmd(year, month) {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatYmdIndonesian(ymd) {
  const p = parseYmdParts(ymd);
  if (!p) return String(ymd || '');
  return `${p.day} ${ID_MONTH_NAMES[p.month - 1] || p.month} ${p.year}`;
}

function parseRequestedDate(question) {
  const q = String(question || '').toLowerCase();
  const today = parseYmdParts(getSemanticTodayYmd()) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };

  const explicit = /\b(?:tgl|tanggal)\s*(\d{1,2})\s+([a-z]+)(?:\s+(20\d{2}))?\b/i.exec(q);
  if (explicit) {
    const day = Number(explicit[1]);
    const month = ID_MONTH_MAP[String(explicit[2] || '').toLowerCase()];
    const year = explicit[3] ? Number(explicit[3]) : today.year;
    if (day >= 1 && day <= 31 && month) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  if (/\b(sekarang|hari\s+ini|saat\s+ini)\b/.test(q)) return getSemanticTodayYmd();
  return null;
}

function parseRequestedMonth(question) {
  const q = String(question || '').toLowerCase();
  const today = parseYmdParts(getSemanticTodayYmd()) || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

  if (/\bbulan\s+depan\b/.test(q)) return { ...addMonths(today.year, today.month, 1), relative: 'bulan depan' };
  if (/\bbulan\s+ini\b/.test(q)) return { year: today.year, month: today.month, relative: 'bulan ini' };
  if (/\bbulan\s+lalu\b/.test(q)) return { ...addMonths(today.year, today.month, -1), relative: 'bulan lalu' };

  for (const [name, month] of Object.entries(ID_MONTH_MAP)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(q)) {
      const yearMatch = /\b(20\d{2})\b/.exec(q);
      return { year: yearMatch ? Number(yearMatch[1]) : today.year, month, relative: null };
    }
  }

  return null;
}

function romanToWaveGroup(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return '';
  if (s === '1' || s === 'I') return 'I';
  if (s === '2' || s === 'II') return 'II';
  if (s === '3' || s === 'III') return 'III';
  if (s === '4' || s === 'IV') return 'IV';
  if (s === 'KHUSUS') return 'KHUSUS';
  return '';
}

function parseRequestedScheduleWave(question) {
  const q = String(question || '');
  const matches = Array.from(q.matchAll(/\b(?:gel(?:ombang)?|gbg)\s*(khusus|[1-4]|i{1,3}|iv)\s*([a-c])?\b/gi));
  const m = matches.length ? matches[matches.length - 1] : null;
  if (!m) return null;
  const group = romanToWaveGroup(m[1]);
  const suffix = String(m[2] || '').trim().toUpperCase();
  if (!group) return null;
  return {
    group,
    key: group === 'KHUSUS' ? 'KHUSUS' : `${group}${suffix}`,
    hasSuffix: Boolean(suffix)
  };
}

function scheduleWaveGroupOfKey(key) {
  const s = String(key || '').trim().toUpperCase().replace(/\s+/g, '');
  if (s === 'KHUSUS') return 'KHUSUS';
  if (/^IV[A-C]?$/.test(s)) return 'IV';
  if (/^III[A-C]?$/.test(s)) return 'III';
  if (/^II[A-C]?$/.test(s)) return 'II';
  if (/^I[A-C]?$/.test(s)) return 'I';
  return '';
}

function formatScheduleItems(windows) {
  return windows
    .map(w => `- ${w.display}: ${ragEngine.compactDateRangeText ? ragEngine.compactDateRangeText(w.masa) : w.masa}`)
    .join('\n');
}

function getScheduleWindows() {
  if (!ragEngine || typeof ragEngine.extractScheduleRegistrationWindowsFromIndex !== 'function') return FALLBACK_PMB_2026_2027_WINDOWS;
  const windows = ragEngine.extractScheduleRegistrationWindowsFromIndex() || [];
  return windows.length ? windows : FALLBACK_PMB_2026_2027_WINDOWS;
}

function scheduleWindowSummary(w) {
  return `${w.display}: ${ragEngine.compactDateRangeText ? ragEngine.compactDateRangeText(w.masa) : w.masa}`;
}

function openWindowsOnDate(windows, ymd) {
  return windows.filter(w => w.startYmd <= ymd && ymd <= w.endYmd);
}

function scheduleAvailabilityPhrase(window, todayYmd) {
  if (!window) return '';
  if (todayYmd < window.startYmd) return `belum buka. Jadwalnya mulai ${formatYmdIndonesian(window.startYmd)} sampai ${formatYmdIndonesian(window.endYmd)}`;
  if (todayYmd > window.endYmd) return `sudah tidak buka. Jadwalnya sudah berakhir pada ${formatYmdIndonesian(window.endYmd)}`;
  return `sedang buka sampai ${formatYmdIndonesian(window.endYmd)}`;
}
const FALLBACK_PMB_2026_2027_WINDOWS = [
  { key: 'KHUSUS', display: 'Gelombang Khusus', masa: '28 Oktober 2025 s/d 27 Desember 2025', startYmd: '2025-10-28', endYmd: '2025-12-27' },
  { key: 'IA', display: 'Gelombang I A', masa: '28 Desember 2025 s/d 31 Januari 2026', startYmd: '2025-12-28', endYmd: '2026-01-31' },
  { key: 'IB', display: 'Gelombang I B', masa: '1 Februari 2026 s/d 14 Februari 2026', startYmd: '2026-02-01', endYmd: '2026-02-14' },
  { key: 'IC', display: 'Gelombang I C', masa: '15 Februari 2026 s/d 7 Maret 2026', startYmd: '2026-02-15', endYmd: '2026-03-07' },
  { key: 'IIA', display: 'Gelombang II A', masa: '8 Maret 2026 s/d 28 Maret 2026', startYmd: '2026-03-08', endYmd: '2026-03-28' },
  { key: 'IIB', display: 'Gelombang II B', masa: '29 Maret 2026 s/d 18 April 2026', startYmd: '2026-03-29', endYmd: '2026-04-18' },
  { key: 'IIC', display: 'Gelombang II C', masa: '19 April 2026 s/d 2 Mei 2026', startYmd: '2026-04-19', endYmd: '2026-05-02' },
  { key: 'IIIA', display: 'Gelombang III A', masa: '3 Mei 2026 s/d 16 Mei 2026', startYmd: '2026-05-03', endYmd: '2026-05-16' },
  { key: 'IIIB', display: 'Gelombang III B', masa: '17 Mei 2026 s/d 30 Mei 2026', startYmd: '2026-05-17', endYmd: '2026-05-30' },
  { key: 'IIIC', display: 'Gelombang III C', masa: '31 Mei 2026 s/d 4 Juli 2026', startYmd: '2026-05-31', endYmd: '2026-07-04' },
  { key: 'IVA', display: 'Gelombang IV A', masa: '5 Juli 2026 s/d 18 Juli 2026', startYmd: '2026-07-05', endYmd: '2026-07-18' },
  { key: 'IVB', display: 'Gelombang IV B', masa: '19 Juli 2026 s/d 1 Agustus 2026', startYmd: '2026-07-19', endYmd: '2026-08-01' },
  { key: 'IVC', display: 'Gelombang IV C', masa: '2 Agustus 2026 s/d 15 Agustus 2026', startYmd: '2026-08-02', endYmd: '2026-08-15' },
  { key: 'SISIPAN1', display: 'Gelombang Sisipan 1', masa: '16 Agustus 2026 s/d 29 Agustus 2026', startYmd: '2026-08-16', endYmd: '2026-08-29' },
  { key: 'SISIPAN2', display: 'Gelombang Sisipan 2', masa: '30 Agustus 2026 s/d 11 September 2026', startYmd: '2026-08-30', endYmd: '2026-09-11' }
];

function tryScheduleWindowAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();
  const recentContext = getRecentUserConversation(options && options.sessionData).toLowerCase();
  const hasRecentNonPmbContext = /\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|gccp|bccp|student\s*exchange|language\s+learning\s+center|career\s*center|inkubator\s+bisnis|inbis)\b/i.test(recentContext);
  const explicitPmbContext = /\b(pmb|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|maba|camaba|kuliah|daftar\s+kuliah|pendaftaran\s+kuliah|siap\.stikom)\b/i.test(qLower);
  if (hasRecentNonPmbContext && !explicitPmbContext && asksCampusSupportTechnicalDetail(qLower)) return null;

  const scheduleKeyword = /\b(jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|dari\s+kapan|sampai\s+kapan|deadline|tanggal|tgl|kapan|ditutup|tutup|penutupan|batas\s+akhir|tes\s+masuk|test\s+masuk|testing|dilaksanakan)\b/i;
  const registrationKeyword = /\b(pmb|penerimaan\s+mahasiswa\s+baru|penerimaan\s+maba|mahasiswa\s+baru|maba|camaba|pendaftaran|daftar)\b/i;
  const availabilityKeyword = /\b(masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|sekarang|hari\s+ini|saat\s+ini)\b/i;
  const hasScheduleSignal = scheduleKeyword.test(qLower) ||
    (registrationKeyword.test(qLower) && (scheduleKeyword.test(qLower) || availabilityKeyword.test(qLower))) ||
    Object.keys(ID_MONTH_MAP).some(name => new RegExp(`\b${name}\b`, 'i').test(qLower));
  if (!hasScheduleSignal) return null;

  const asksFee = /\b(biaya|bayar|bayarnya|pembayaran|harga|dpp|ukt|potongan|rincian\s+biaya|rincian|total|totalnya|harus\s+bayar|termurah|termahal)\b/i.test(qLower);
  if (asksFee) return null;

  const windows = getScheduleWindows();
  if (!windows.length) return null;

  const requestedMonth = parseRequestedMonth(q);
  const requestedWave = parseRequestedScheduleWave(q);
  const requestedDate = parseRequestedDate(q);
  const todayYmd = getSemanticTodayYmd();
  const asksAvailability = /\b(masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|bisa|pilih|yang\s+mana|aktif|berjalan|sekarang|hari\s+ini|saat\s+ini|cara|gimana|bagaimana)\b/i.test(qLower);
  const asksClosing = /\b(kapan|sampai\s+kapan|deadline|ditutup|tutup|penutupan|batas\s+akhir)\b/i.test(qLower) && registrationKeyword.test(qLower);
  const asksEntranceTest = /\b(tes\s+masuk|test\s+masuk|testing|ujian\s+masuk)\b/i.test(qLower);

  if (asksAvailability && !requestedDate && !requestedMonth && !requestedWave && /\b(pmb|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|pendaftaran|daftar|maba|camaba)\b/i.test(qLower)) {
    const open = openWindowsOnDate(windows, todayYmd);
    if (open.length) {
      return {
        answer: [
          `Ya, PMB ITB STIKOM Bali masih dibuka per ${formatYmdIndonesian(todayYmd)}.`,
          '',
          'Gelombang yang sedang aktif:',
          '',
          formatScheduleItems(open),
          '',
          'Kakak bisa daftar online melalui https://siap.stikom-bali.ac.id atau daftar offline dengan datang langsung ke kampus ITB STIKOM Bali.'
        ].join('\n')
      };
    }

    const next = windows.find(w => w.startYmd > todayYmd);
    return {
      answer: [
        `Per ${formatYmdIndonesian(todayYmd)}, saya tidak menemukan gelombang PMB yang sedang buka pada data kalender PMB yang tersedia.`,
        next ? `Gelombang terdekat berikutnya adalah ${scheduleWindowSummary(next)}.` : 'Silakan hubungi admin PMB untuk memastikan jadwal terbaru.'
      ].filter(Boolean).join('\n\n')
    };
  }

  if (!requestedDate && !requestedMonth && !requestedWave) {
    const open = openWindowsOnDate(windows, todayYmd);
    if (asksClosing) {
      const latest = windows.reduce((acc, w) => (!acc || w.endYmd > acc.endYmd ? w : acc), null);
      return {
        answer: [
          open.length
            ? `Per ${formatYmdIndonesian(todayYmd)}, PMB ITB STIKOM Bali sedang buka pada ${open.map(w => scheduleWindowSummary(w)).join(', ')}.`
            : `Per ${formatYmdIndonesian(todayYmd)}, saya tidak menemukan gelombang PMB yang sedang buka pada data kalender PMB yang tersedia.`,
          latest ? `Batas akhir pendaftaran terakhir yang tercantum adalah ${formatYmdIndonesian(latest.endYmd)} (${latest.display}).` : null
        ].filter(Boolean).join('\n\n')
      };
    }
    if (asksEntranceTest) {
      return {
        answer: [
          'Tes masuk/testing PMB ITB STIKOM Bali dijadwalkan berbeda untuk tiap gelombang.',
          open.length ? `Gelombang yang sedang aktif per ${formatYmdIndonesian(todayYmd)}: ${open.map(w => scheduleWindowSummary(w)).join(', ')}.` : null,
          'Sebutkan gelombangnya, misalnya "Gelombang II B" atau "Gelombang IV B", supaya saya kirim jadwal testing, pengumuman, dan registrasi ulang yang tepat.'
        ].filter(Boolean).join('\n\n')
      };
    }
    if (open.length) {
      return {
        answer: [
          `Per ${formatYmdIndonesian(todayYmd)}, gelombang yang sedang buka pendaftaran untuk PMB ITB STIKOM Bali adalah:`,
          '',
          formatScheduleItems(open),
          '',
          'Balas gelombangnya (mis. "II B" / "III A" / "Khusus"), nanti saya kirim jadwal detailnya.'
        ].join('\n')
      };
    }

    const next = windows.find(w => w.startYmd > todayYmd);
    return {
      answer: [
        `Per ${formatYmdIndonesian(todayYmd)}, saya tidak menemukan gelombang PMB yang sedang buka pada data kalender PMB yang tersedia.`,
        next ? `Gelombang terdekat berikutnya adalah ${scheduleWindowSummary(next)}.` : 'Silakan hubungi admin PMB untuk memastikan jadwal terbaru.'
      ].filter(Boolean).join('\n\n')
    };
  }

  if (requestedDate && !requestedWave && asksAvailability) {
    const open = openWindowsOnDate(windows, requestedDate);
    if (open.length) {
      return {
        answer: [
          `Per ${formatYmdIndonesian(requestedDate)}, gelombang yang bisa kakak pilih adalah:`,
          '',
          formatScheduleItems(open),
          '',
          `Jadi, untuk tanggal ${formatYmdIndonesian(requestedDate)}, kakak mengikuti gelombang yang sedang aktif pada tanggal tersebut.`
        ].join('\n')
      };
    }

    const next = windows.find(w => w.startYmd > requestedDate);
    return {
      answer: [
        `Per ${formatYmdIndonesian(requestedDate)}, saya tidak menemukan gelombang yang sedang buka pada data kalender PMB yang tersedia.`,
        next ? `Gelombang terdekat berikutnya adalah ${scheduleWindowSummary(next)}.` : 'Silakan hubungi admin PMB untuk memastikan jadwal terbaru.'
      ].join('\n\n')
    };
  }

  if (requestedMonth && !requestedWave) {
    const start = monthStartYmd(requestedMonth.year, requestedMonth.month);
    const end = monthEndYmd(requestedMonth.year, requestedMonth.month);
    const overlapping = windows.filter(w => w.startYmd <= end && w.endYmd >= start);
    const label = monthLabel(requestedMonth.year, requestedMonth.month);

    if (!/\b(gelombang|gbg|pendaftaran|daftar|pmb|jadwal|deadline)\b/i.test(qLower)) {
      return {
        answer: [
          `Bulan depan setelah ${ID_MONTH_NAMES[(parseYmdParts(getSemanticTodayYmd()) || {}).month - 1] || 'bulan ini'} adalah ${ID_MONTH_NAMES[requestedMonth.month - 1] || label}, Kak.`,
          '',
          `Kalau konteksnya PMB ITB STIKOM Bali, kakak bisa tanya "gelombang apa yang buka di ${label}?"`
        ].join('\n')
      };
    }

    if (overlapping.length) {
      const rel = requestedMonth.relative ? ` (${requestedMonth.relative})` : '';
      return {
        answer: [
          `Untuk ${label}${rel}, gelombang pendaftaran yang berjalan adalah:`,
          '',
          formatScheduleItems(overlapping),
          '',
          `Jadi, kalau kakak daftar pada ${label}, gelombangnya mengikuti tanggal pendaftaran kakak.`
        ].join('\n')
      };
    }

    const upcoming = windows.find(w => w.startYmd > end);
    return {
      answer: [
        `Pada ${label}, saya tidak menemukan gelombang pendaftaran yang berjalan di data kalender PMB yang tersedia.`,
        upcoming ? `Gelombang terdekat setelah itu adalah ${upcoming.display}: ${ragEngine.compactDateRangeText(upcoming.masa)}.` : 'Silakan hubungi admin PMB untuk memastikan jadwal terbaru.'
      ].filter(Boolean).join('\n\n')
    };
  }

  if (requestedWave) {
    const matches = windows.filter(w => {
      const normalizedKey = String(w.key || '').toUpperCase().replace(/\s+/g, '');
      if (requestedWave.key === 'KHUSUS') return normalizedKey === 'KHUSUS';
      if (requestedWave.hasSuffix) return normalizedKey === requestedWave.key;
      return scheduleWaveGroupOfKey(w.key) === requestedWave.group;
    });
    if (!matches.length) return null;

    const title = requestedWave.hasSuffix
      ? matches[0].display
      : (requestedWave.group === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${requestedWave.group}`);

    if (asksAvailability) {
      const openRequested = matches.filter(w => w.startYmd <= todayYmd && todayYmd <= w.endYmd);
      const currentOpen = openWindowsOnDate(windows, todayYmd);
      if (openRequested.length) {
        return {
          answer: [
            `Per ${formatYmdIndonesian(todayYmd)}, ${title} sedang buka:`,
            '',
            formatScheduleItems(openRequested),
            '',
            `Jadi, kakak masih bisa mengikuti ${title} selama masih dalam tanggal tersebut.`
          ].join('\n')
        };
      }

      return {
        answer: [
          `Per ${formatYmdIndonesian(todayYmd)}, ${title} ${scheduleAvailabilityPhrase(matches[matches.length - 1], todayYmd)}.`,
          '',
          `Jadwal ${title}:`,
          '',
          formatScheduleItems(matches),
          '',
          currentOpen.length
            ? `Yang sedang buka sekarang adalah:\n${formatScheduleItems(currentOpen)}`
            : 'Saya tidak menemukan gelombang yang sedang buka hari ini pada data kalender PMB yang tersedia.'
        ].join('\n')
      };
    }

    return {
      answer: [
        `Jadwal pendaftaran ${title}:`,
        '',
        formatScheduleItems(matches),
        '',
        matches.length === 1
          ? `Jadi, ${title} berlangsung sesuai tanggal di atas.`
          : `Jadi, ${title} terbagi menjadi beberapa periode. Kakak bisa menyesuaikan dengan tanggal daftar yang dipilih.`
      ].join('\n')
    };
  }

  return null;
}

function tryRegistrationHowAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  if (isNonPmbFaqDomainQuestion(question)) return null;
  const asksRegister = /\b(cara|gimana|bagaimana|dimana|di\s*mana|mana|lewat|link|online|mau|ingin|pengen|pengin|bisa|how|where|apply|application|admission|gmn)\b/.test(q) && /\b(daftar(?:nya)?|mendaftar|pendaftaran|registrasi|kuliah|apply|application|admission|study|studying|min)\b/.test(q);
  if (!asksRegister) return null;
  if (/\b(biaya|bayar|harga|dpp|ukt|potongan|gelombang|jadwal|tanggal|deadline|masih\s+buka|fee|cost|price)\b/.test(q)) return null;
  // Exclude specific registration objects that have dedicated handlers (not general PMB admission)
  // Only exclude if the specific object is mentioned in a registration context
  if (/\b(pendaftaran\s+(wisuda|yudisium|akun|account|event|ujian|examination|krs|transkrip|nilai|sertifikasi|pelatihan|training|ukm|ormawa|bem|lomba|beasiswa)|daftar\s+(wisuda|yudisium|akun|account|event|ujian|examination|krs|transkrip|nilai|sertifikasi|pelatihan|training|ukm|ormawa|bem|lomba|beasiswa)|registrasi\s+(wisuda|yudisium|akun|account|event|ujian|examination|krs|transkrip|nilai|sertifikasi|pelatihan|training|ukm|ormawa|bem|lomba|beasiswa))\b/i.test(q)) return null;

  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  if (/\b(linked\s*in|linkedin)\b/i.test(recent) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(recent) && !asksAdmissionRegistration && /\b(detail|info(?:rmasi)?|daftar|mendaftar|pendaftaran|registrasi|cara|bagaimana|gimana|mengikuti|ikut)\b/i.test(q)) return null;
  const english = isEnglishQuestion(q) || isEnglishQuestion(recent);
  if (english) {
    return {
      answer: [
        'You can apply to ITB STIKOM Bali through the online application or by visiting campus in person for help from PMB staff.',
        '',
        '- Online: through https://siap.stikom-bali.ac.id',
        '- Offline: visit ITB STIKOM Bali campus and ask PMB staff for assistance.',
        '',
        'First steps you can take:',
        '',
        '- Choose the program you want to apply for.',
        '- Check which admission waves are open.',
        '- Prepare the application data/documents as instructed by the PMB process.',
        '- Continue with the online application or go to campus for offline registration.',
        '',
        'If you want, I can also help check open waves or fee details by program.'
      ].join('\n')
    };
  }

  return {
    answer: [
      'Untuk daftar kuliah di ITB STIKOM Bali, kakak bisa memilih salah satu jalur berikut:',
      '',
      '- Online: melalui https://siap.stikom-bali.ac.id',
      '- Offline: datang langsung ke kampus ITB STIKOM Bali untuk dibantu proses pendaftaran oleh petugas/PMB.',
      '',
      'Langkah awal yang bisa kakak lakukan:',
      '',
      '- Tentukan prodi yang ingin dipilih.',
      '- Cek gelombang pendaftaran yang sedang buka.',
      '- Siapkan data/dokumen pendaftaran sesuai arahan PMB.',
      '- Lanjutkan pendaftaran online atau datang ke kampus untuk pendaftaran offline.',
      '',
      'Kalau kakak mau, saya bisa bantu cek gelombang yang sedang buka sekarang atau rincian biaya berdasarkan prodi yang dipilih.'
    ].join('\n')
  };
}

function tryRegistrationDataCorrectionAnswer(question) {
  const q = String(question || '').toLowerCase();
  // Must explicitly mention data correction/salah isi with registration context
  if (!/\b(salah\s+isi|koreksi|perbaiki|ubah|revisi|edit)\b/i.test(q)) return null;
  if (!/\b(data|pendaftaran|daftar|registrasi)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk koreksi data pendaftaran yang salah, kakak perlu menghubungi Admin PMB.',
      '',
      'Admin PMB akan membantu kakak memperbaiki data yang sudah terisi agar sesuai dengan data yang benar.',
      '',
      'Kakak bisa menghubungi Admin PMB melalui:',
      '',
      '- Datang langsung ke kampus ITB STIKOM Bali',
      '- Melalui kontak resmi PMB di https://siap.stikom-bali.ac.id'
    ].join('\n')
  };
}

function tryProgramChangeAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(ganti|ubah|pindah|tukar)\b/i.test(q)) return null;
  if (!/\b(jurusan|prodi|program\s+studi|pilihan)\b/i.test(q)) return null;
  if (!/\b(setelah\s+daftar|sudah\s+daftar|pendaftaran)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk mengganti pilihan prodi setelah mendaftar, kakak perlu menghubungi Admin PMB.',
      '',
      'Admin PMB akan membantu kakak mengubah pilihan prodi sesuai dengan ketentuan yang berlaku.',
      '',
      'Kakak bisa menghubungi Admin PMB melalui:',
      '',
      '- Datang langsung ke kampus ITB STIKOM Bali',
      '- Melalui kontak resmi PMB di https://siap.stikom-bali.ac.id'
    ].join('\n')
  };
}

function tryRplAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(rpl|rekognisi\s+pembelajaran\s+lampau|mahasiswa\s+pindahan|pindahan|transfer\s+kuliah|alih\s+jenjang|konversi\s+mata\s+kuliah|konversi\s+sks)\b/i.test(q)) return null;

  if (/\b(mahasiswa\s+pindahan|pindahan|transfer\s+kuliah|alih\s+jenjang|konversi\s+mata\s+kuliah|konversi\s+sks)\b/i.test(q)) {
    return {
      answer: [
        'Untuk mahasiswa pindahan atau konversi mata kuliah, data yang tersedia mengarah ke skema RPL/rekognisi SKS.',
        '',
        'Ketentuan amannya: jumlah SKS yang diakui akan dicek oleh kampus terlebih dahulu, lalu biaya/level pengakuannya mengikuti hasil verifikasi tersebut.',
        '',
        'Kakak sebaiknya menghubungi Admin PMB dan menyiapkan transkrip nilai atau dokumen akademik dari kampus asal agar bisa dicek untuk proses konversi.'
      ].join('\n')
    };
  }

  if (/\b(cara|bagaimana|gimana|daftar|mendaftar|pendaftaran|prosedur|alur)\b/i.test(q)) {
    return {
      answer: [
        'Untuk mendaftar jalur RPL, kakak perlu menghubungi Admin PMB ITB STIKOM Bali agar dokumen dan riwayat pendidikan/pekerjaan bisa dicek terlebih dahulu.',
        '',
        'Gambaran prosesnya: ajukan minat RPL ke PMB, siapkan dokumen pendukung seperti ijazah/transkrip/portofolio bila diminta, lalu tunggu asesmen atau verifikasi SKS yang dapat diakui.',
        '',
        'Untuk langkah resmi dan dokumen final, kakak bisa mulai dari https://siap.stikom-bali.ac.id atau datang langsung ke kampus.'
      ].join('\n')
    };
  }

  return {
    answer: [
      'RPL adalah Rekognisi Pembelajaran Lampau, yaitu jalur pengakuan capaian belajar atau pengalaman sebelumnya agar bisa diperhitungkan dalam proses kuliah.',
      '',
      'Pada data biaya yang tersedia, mahasiswa RPL dikenakan ketentuan berdasarkan jumlah SKS yang diakui. Karena hasilnya bergantung pada asesmen dokumen, detail final perlu dikonfirmasi ke Admin PMB ITB STIKOM Bali.'
    ].join('\n')
  };
}
function tryBemAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(bem|gabung\s+bem|ikut\s+bem|masuk\s+bem|rekrutmen\s+bem|gabung\s+gimana)\b/i.test(q)) return null;
  
  const asksDefinition = /\b(apa\s+itu|itu\s+apa|apaan|maksud(?:nya)?|kepanjangan|singkatan|tentang|jelaskan|definisi)\b/i.test(q);
  const asksJoin = /\b(gabung|ikut|masuk|rekrutmen|daftar|pendaftaran|cara|bagaimana|gimana)\b/i.test(q);

  if (asksDefinition && !asksJoin) {
    return {
      answer: [
        "BEM adalah Badan Eksekutif Mahasiswa, yaitu organisasi mahasiswa yang menjadi wadah aspirasi, kepemimpinan, dan kegiatan kemahasiswaan di kampus.",
        "",
        "Di konteks ITB STIKOM Bali, BEM termasuk Ormawa/organisasi mahasiswa. Untuk struktur pengurus, agenda kegiatan, atau informasi rekrutmen terbaru, kakak bisa konfirmasi ke bagian kemahasiswaan atau kanal resmi kampus."
      ].join('\n')
    };
  }

  return {
    answer: [
      'Untuk bergabung dengan BEM, kakak bisa mengikuti proses rekrutmen yang diadakan oleh kemahasiswaan.',
      '',
      'Informasi mengenai jadwal rekrutmen BEM biasanya diumumkan melalui kanal resmi kemahasiswaan kampus.',
      '',
      'Kakak bisa menghubungi pihak kemahasiswaan untuk informasi lebih lanjut tentang rekrutmen BEM.'
    ].join('\n')
  };
}

function tryContactLecturerAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(hubungi|kontak|menghubungi|contact)\b/i.test(q)) return null;
  if (!/\b(dosen|lecturer)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk menghubungi dosen, kakak bisa menggunakan kanal resmi yang tersedia di kampus.',
      '',
      'Kakak bisa menghubungi dosen melalui:',
      '',
      '- Portal akademik (SION)',
      '- Melalui prodi terkait',
      '- Email resmi kampus'
    ].join('\n')
  };
}

function tryGraduationRegistrationAnswer(question) {
  const q = String(question || '').toLowerCase();
  // Must explicitly mention wisuda to avoid matching general registration
  if (!/\b(wisuda|yudisium)\b/i.test(q)) {
    return null;
  }
  return {
    answer: [
      'Untuk pendaftaran wisuda, kakak perlu menghubungi pihak akademik atau BAAK.',
      '',
      'Proses pendaftaran wisuda biasanya diurus melalui bagian akademik kampus.',
      '',
      'Kakak bisa menghubungi BAAK untuk informasi lebih lanjut mengenai persyaratan dan jadwal wisuda.'
    ].join('\n')
  };
}

function tryAcademicScheduleAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (isAcademicScheduleLookupQuestion(q)) {
    return { answer: buildAcademicScheduleNoDataAnswer(q) };
  }
  // Must explicitly mention kuliah to avoid matching PMB schedule
  if (!/\b(jadwal\s+kuliah|kuliah\s+jadwal|liat\s+jadwal\s+kuliah|lihat\s+jadwal\s+kuliah|cek\s+jadwal\s+kuliah|jadwal\s+liat\s+kuliah|jadwal\s+lihat\s+kuliah|dimana\s+jadwal\s+kuliah|jadwal\s+kuliah\s+liat|jadwal\s+kuliah\s+lihat|jadwal\s+kuliah\s+dimana|jadwal\s+kuliah\s+liat\s+dimana)\b/i.test(q)) return null;
  // Exclude PMB-related questions
  if (/\b(pmb|pendaftaran|gelombang|daftar)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk melihat jadwal kuliah, kakak bisa mengakses portal akademik (SION).',
      '',
      'Jadwal kuliah tersedia melalui:',
      '',
      '- Portal akademik SION',
      '- Login dengan akun mahasiswa',
      '- Menu jadwal kuliah'
    ].join('\n')
  };
}

function tryAcademicKrsAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(telat\s+krs|krs\s+telat|lupa\s+krs|krs)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk masalah KRS yang terlambat, kakak perlu menghubungi dosen pembimbing akademik.',
      '',
      'Dosen pembimbing akan membantu kakak mengurus permasalahan KRS sesuai dengan ketentuan akademik.'
    ].join('\n')
  };
}

function tryAcademicGradeAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\bnilai\b/i.test(q)) return null;
  if (!/\b(salah|revisi|koreksi|lapor|harus|siapa|ku)\b/i.test(q)) return null;
  return {
    answer: [
      'Untuk koreksi nilai yang salah, kakak perlu menghubungi dosen pengampu mata kuliah tersebut.',
      '',
      'Dosen pengampu akan membantu memverifikasi dan merevisi nilai jika diperlukan.'
    ].join('\n')
  };
}

function tryAcademicTranscriptAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(transkrip\s+nilai|minta\s+transkrip|ambil\s+transkrip)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk mengambil transkrip nilai, kakak perlu menghubungi bagian administrasi akademik.',
      '',
      'Transkrip nilai bisa diperoleh melalui:',
      '',
      '- Portal akademik SION',
      '- Bagian administrasi akademik'
    ].join('\n')
  };
}

function tryCertificationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(sertifikasi|sertifikat|pelatihan|training)\b/i.test(q)) return null;
  if (!/\b(mahasiswa|buat|ada)\b/i.test(q)) return null;
  
  return {
    answer: [
      'Untuk informasi sertifikasi dan pelatihan untuk mahasiswa, kakak bisa menghubungi kemahasiswaan atau Career Center.',
      '',
      'Sertifikasi dan pelatihan yang tersedia biasanya diumumkan melalui kanal resmi kampus.'
    ].join('\n')
  };
}

function normalizeFacilityTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bstudens\s+exchange\b/g, 'student exchange')
    .replace(/\bstudents\s+exchange\b/g, 'student exchange')
    .replace(/\bstudent\s+exchanges\b/g, 'student exchange')
    .replace(/\bincubator\b/g, 'inkubator')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const CAMPUS_SUPPORT_ENTITY_REGISTRY = [
  { key: 'linkedin-career-center', label: 'program LinkedIn di Career Center', type: 'facility_program', patterns: ['linkedin career center', 'linked in career center', 'program linkedin', 'program linked in'] },
  { key: 'career-center', label: 'Career Center', type: 'facility', patterns: ['career center', 'pusat karier', 'pusat karir'] },
  { key: 'gccp', label: 'GCCP', type: 'international_program', patterns: ['gccp', 'gcpp', 'gcp', 'global cross cultural program', 'global cultural exchange program'] },
  { key: 'bccp', label: 'BCCP', type: 'international_program', patterns: ['bccp'] },
  { key: 'student-exchange', label: 'Student Exchange', type: 'international_program', patterns: ['student exchange', 'students exchange', 'studens exchange', 'pertukaran mahasiswa', 'exchange program'] },
  { key: 'short-course', label: 'short course', type: 'international_program', patterns: ['short course', 'shortcourse', 'kursus singkat'] },
  { key: 'hi-think', label: 'Hi-Think', type: 'facility_program', patterns: ['hi think', 'hithink'] },
  { key: 'language-learning-center', label: 'Language Learning Center', type: 'facility', patterns: ['language learning center', 'llc', 'belajar bahasa', 'kemampuan bahasa', 'meningkatkan kemampuan bahasa', 'fasilitas bahasa', 'kursus bahasa'] },
  { key: 'inkubator-bisnis', label: 'Inkubator Bisnis', type: 'facility', patterns: ['inkubator bisnis', 'inkubator', 'incubator bisnis', 'incubator', 'inbis'] },
  { key: 'softskill', label: 'Program Pengembangan Softskill', type: 'facility_program', patterns: ['pengembangan softskill', 'softskill'] },
  { key: 'kuliah-sambil-kerja-ln', label: 'Kuliah Sambil Kerja di Luar Negeri', type: 'international_program', patterns: ['kuliah sambil kerja di luar negeri'] },
  { key: 'magang-berbayar-ln', label: 'Magang Berbayar di Luar Negeri', type: 'international_program', patterns: ['magang berbayar di luar negeri'] },
  { key: 'jaminan-konsultasi', label: 'Program Jaminan Konsultasi', type: 'facility_program', patterns: ['jaminan konsultasi'] }
].map((item) => ({
  ...item,
  normalizedPatterns: item.patterns.map(normalizeFacilityTerm)
}));

function findCampusSupportEntity(text) {
  const normalized = normalizeFacilityTerm(text);
  if (!normalized) return null;
  return CAMPUS_SUPPORT_ENTITY_REGISTRY.find((entity) =>
    entity.normalizedPatterns.some((pattern) => pattern && normalized.includes(pattern))
  ) || null;
}

function resolveCampusSupportEntity(question, options = {}) {
  const current = findCampusSupportEntity(question);
  if (current) return { entity: current, fromRecent: false };
  if (!shouldUseRecentEntityContext(question)) return null;
  const recent = getRecentUserConversation(options && options.sessionData);
  const fromRecent = findCampusSupportEntity(recent);
  return fromRecent ? { entity: fromRecent, fromRecent: true } : null;
}

function asksCampusSupportDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(apa\s+itu|itu\s+apa|apakah|ada|jelaskan|detail|lebih\s+detail|program|layanan|kegiatan|aktivitas|kegunaan|manfaat|syarat|cara|bagaimana|gimana|ikut|mengikuti|daftar|mendaftar|pendaftaran|registrasi|info(?:rmasi)?|punya\s+info)\b/i.test(q);
}
function asksCampusSupportOwner(question) {
  const q = String(question || '').toLowerCase();
  return /\b(siapa\s+(?:yang\s+)?(?:menangani|mengelola|bertanggung\s+jawab)|(?:ditangani|dikelola)\s+oleh\s+siapa|pengelola(?:nya)?|penanggung\s+jawab(?:nya)?|unit\s+pengelola|bagian\s+yang\s+menangani|divisi\s+yang\s+menangani|direktorat\s+yang\s+menangani)\b/i.test(q);
}

function asksCampusSupportTechnicalDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(?:cara(?:nya)?|bagaimana|gimana|alur(?:nya)?|prosedur(?:nya)?|mekanisme(?:nya)?|proses(?:nya)?|syarat(?:nya)?|persyaratan(?:nya)?|jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?|kuota|kouta|seleksi|interview|wawancara|biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp|formulir|form(?:nya)?|link(?:nya)?|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q);
}

function buildCampusSupportTechnicalNoDataAnswer(entity, question = '') {
  const label = entity && entity.label ? entity.label : 'program atau fasilitas tersebut';
  const q = String(question || '').toLowerCase();
  let detail = 'detail teknis seperti syarat, jadwal, biaya, kontak, atau alur pendaftaran';
  if (/\b(?:cara|bagaimana|gimana|alur|prosedur|mekanisme|proses|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q)) {
    detail = 'alur/cara mengikuti atau mendaftar';
  } else if (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|kuota|kouta|seleksi|interview|wawancara)\b/i.test(q)) {
    detail = 'syarat, kuota, atau proses seleksi peserta';
  } else if (/\b(?:jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?)\b/i.test(q)) {
    detail = 'jadwal, deadline, atau periode pelaksanaan';
  } else if (/\b(?:biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp)\b/i.test(q)) {
    detail = 'biaya program';
  } else if (/\b(?:kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?|formulir|form(?:nya)?|link(?:nya)?)\b/i.test(q)) {
    detail = 'kontak, admin/PIC, formulir, atau link pendaftaran';
  }
  return [
    `Untuk ${detail} ${label}, saya belum menemukan informasi yang lengkap dan aman pada data yang tersedia.`,
    '',
    `Data yang aman saya sampaikan baru sebatas informasi umum tentang ${label}. Agar tidak keliru, detail teknis tersebut sebaiknya dikonfirmasi ke admin kampus atau pengelola program terkait.`
  ].join('\n');
}
function buildCampusSupportOwnerNoDataAnswer(entity) {
  const label = entity && entity.label ? entity.label : 'program atau fasilitas tersebut';
  return [
    `Saya belum menemukan data yang cukup jelas tentang siapa atau unit yang menangani ${label} pada dokumen yang tersedia.`,
    '',
    `Data yang aman saya sampaikan baru sebatas informasi umum tentang ${label}. Untuk memastikan pengelola, penanggung jawab, atau unit yang menangani, sebaiknya kakak konfirmasi ke admin kampus atau pengelola program terkait.`
  ].join('\n');
}

function isShortCampusSupportFollowUp(question) {
  const q = normalizeFacilityTerm(question);
  if (!q) return false;
  if (q.split(/\s+/).length <= 6 && /\b(itu|apa|iya|ya|benar|detail|daftar(?:nya)?|mendaftar|pendaftaran(?:nya)?|registrasi(?:nya)?|join(?:nya)?|caranya|cara|ikut|gabung|bergabung|gimana|bagaimana|syarat(?:nya)?|jadwal(?:nya)?|deadline|timeline|kuota|kouta|seleksi|interview|wawancara|link(?:nya)?|form(?:nya)?|formulir|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?|program|kegiatan)\b/i.test(q)) return true;
  return /\b(yang\s+tadi|program\s+itu|fasilitas\s+itu|cara\s+daftar(?:nya)?|daftar(?:nya)?\s+(?:gimana|bagaimana)|link(?:nya)?\s+(?:ada|apa)|pic(?:nya)?|admin(?:nya)?|kontak(?:nya)?|deadline(?:nya)?|timeline(?:nya)?|lebih\s+detail(?:nya)?)\b/i.test(String(question || ''));
}

function isStandaloneNewTopicQuestion(question) {
  const q = normalizeFacilityTerm(question);
  if (!q) return false;
  if (/\b(yang\s+tadi|tadi|itu\s+tadi|program\s+itu|fasilitas\s+itu|layanan\s+itu|kegiatan(?:nya)?|program(?:nya)?|detail(?:nya)?|caranya|cara\s+(?:ikut|gabung|bergabung|daftar|mendaftar)|daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?|join(?:nya)?|bagaimana\s+cara|gimana\s+cara|syarat(?:nya)?|syaratnya\s+apa|biaya(?:nya)?|jadwal(?:nya)?|jadwalnya\s+kapan|deadline(?:nya)?|timeline(?:nya)?|kuota|kouta|seleksi|interview|wawancara|link(?:nya)?|form(?:nya)?|formulir|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?)\b/i.test(q)) return false;
  return /\b(apa\s+itu|itu\s+apa|jelaskan|tentang|pengertian|definisi|apa\s+saja|ada\s+apa\s+saja|daftar|list|berapa|kapan|di\s+mana|dimana|siapa|bagaimana|gimana|mengapa|kenapa)\b/i.test(q);
}

function shouldUseRecentEntityContext(question) {
  const q = normalizeFacilityTerm(question);
  if (!q) return false;
  if (isStandaloneNewTopicQuestion(q)) return false;
  const wordCount = q.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) return false;
  return /\b(itu|tersebut|tadi|yang\s+tadi|detail(?:nya)?|kegiatan(?:nya)?|aktivitas(?:nya)?|program(?:nya)?|proker(?:nya)?|caranya|cara\s+(?:ikut|gabung|bergabung|daftar|mendaftar)|daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?|join(?:nya)?|bagaimana\s+cara|gimana\s+cara|syarat(?:nya)?|syaratnya\s+apa|biaya(?:nya)?|jadwal(?:nya)?|jadwalnya\s+kapan|deadline(?:nya)?|timeline(?:nya)?|kuota|kouta|seleksi|interview|wawancara|link(?:nya)?|form(?:nya)?|formulir|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?|pembina(?:nya)?|manfaat(?:nya)?|gimana|bagaimana|lanjut|iya|ya)\b/i.test(q);
}

function campusSupportEntityToFacilityTerm(entity) {
  if (!entity) return null;
  return {
    label: entity.label,
    patterns: entity.normalizedPatterns
  };
}

function isExplicitNonSupportTopic(question) {
  const q = String(question || '').toLowerCase();
  return /\b(double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(q)
    || /\b(ukm|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan|bidang\s+seni|seni|musik|tari|tabuh|teater|vos)\b/i.test(q)
    || /\b(prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/i.test(q)
    || /\b(pmb|mahasiswa\s+baru|biaya|harga|tarif|ukt|dpp|gelombang|jadwal|beasiswa|kip)\b/i.test(q)
    || /\b(fasilitas|layanan|sarana|prasarana|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q);
}

function isStructuredCampusQuestion(question) {
  const q = String(question || '').toLowerCase();
  return /\b(biaya|harga|tarif|ukt|dpp|pendaftaran|registrasi|gelombang|jadwal|deadline|pmb|beasiswa|potongan|kip|prodi|program\s+studi|jurusan|akreditasi|double\s*degree|dual\s*degree|utb|dnui|help|ukm|ormawa|organisasi\s+mahasiswa)\b/i.test(q)
    || /\b(sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/i.test(q)
    || /\b(cocok|rekomendasi|sebaiknya|sarankan|saran|pilih|mengambil|ambil|ingin\s+jadi|pengen\s+jadi|kerja|karier|karir|lulusan)\b/i.test(q)
    || /\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(q)
    || /\b(si|ti|sk|bd|mi)\b/i.test(q);
}

function extractTrainingSpecificTarget(question) {
  const raw = String(question || '').trim();
  if (!raw) return '';

  const quoted = /["'\u201c\u201d]([^"'\u201c\u201d]{3,80})["'\u201c\u201d]/.exec(raw);
  let target = quoted ? quoted[1] : '';
  if (!target) {
    const m = /\b(?:apa\s+itu|apakah|jelaskan|detail(?:\s+tentang)?|tentang|info(?:rmasi)?\s+tentang|maksud(?:nya)?\s+apa)\s+(.{3,90})/i.exec(raw);
    if (m) target = m[1];
  }
  if (!target) return '';

  target = target
    .replace(/[?!.?]+$/g, '')
    .replace(/\b(?:kak|ya|dong|min|admin|itu|ini|adalah|maksudnya|program|fasilitas|layanan)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = normalizeFacilityTerm(target);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const useful = tokens.filter((token) => !/^(yang|dan|atau|dari|untuk|dengan|pada|kampus|stikom|bali|itb)$/.test(token));
  const distinctive = useful.filter((token) => token.length >= 4);
  if (!distinctive.length) return '';
  return useful.join(' ');
}

const FAQ_QUESTION_LABEL_SOURCE = String.raw`(?:\([QF]\)|[QF]\s*[:.-]|FAQ\s*[:.-]|Question\s*[:.-]|Pertanyaan\s*[:.-]|Tanya\s*[:.-])`;
const FAQ_ANSWER_LABEL_SOURCE = String.raw`(?:\(A\)|A\s*[:.-]|Answer\s*[:.-]|Jawaban\s*[:.-]|Jawab\s*[:.-])`;

function stripFaqQaLabel(text) {
  const labelRe = new RegExp(String.raw`^\s*(?:${FAQ_QUESTION_LABEL_SOURCE}|${FAQ_ANSWER_LABEL_SOURCE})\s*`, 'i');
  return String(text || '').replace(labelRe, '').trim();
}

function faqComparableTokens(text) {
  const stop = new Set([
    'apa','apakah','bagaimana','gimana','berapa','kapan','dimana','mana','siapa','mengapa','kenapa','yang','dan','atau','dari','untuk','dengan','pada','di','ke','itu','ini','adalah','ada','saja','aja','ya','kak','min','admin','saya','aku','mau','ingin','tentang','jelaskan','detail','informasi','info','program','stikom','bali','itb'
  ]);
  return normalizeFacilityTerm(stripFaqQaLabel(text))
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function scoreFaqQuestionMatch(userQuestion, faqQuestion, target = '', targetTokens = []) {
  const qTokens = faqComparableTokens(userQuestion);
  const fTokens = faqComparableTokens(faqQuestion);
  if (!qTokens.length || !fTokens.length) return 0;
  const fSet = new Set(fTokens);
  const qSet = new Set(qTokens);
  const overlap = qTokens.filter((token) => fSet.has(token)).length;
  const reverseOverlap = fTokens.filter((token) => qSet.has(token)).length;
  const qNorm = normalizeFacilityTerm(stripFaqQaLabel(userQuestion));
  const fNorm = normalizeFacilityTerm(stripFaqQaLabel(faqQuestion));
  const targetNorm = normalizeFacilityTerm(target);
  const targetHits = (Array.isArray(targetTokens) ? targetTokens : []).filter((token) => fNorm.includes(token)).length;
  const exactTarget = targetNorm && fNorm.includes(targetNorm) ? 4 : 0;
  const containment = (qNorm && fNorm && (qNorm.includes(fNorm) || fNorm.includes(qNorm))) ? 3 : 0;
  const userAsksDefinition = /\b(?:apa\s+itu|itu\s+apa|jelaskan|pengertian)\b/i.test(qNorm);
  const faqAsksDefinition = /\b(?:apa\s+itu|itu\s+apa|pengertian)\b/i.test(fNorm);
  const intentTerms = ['keunggulan', 'keuntungan', 'manfaat', 'kegiatan', 'program kerja', 'syarat', 'biaya', 'kapan', 'bahasa', 'cocok', 'tujuan', 'daftar', 'pendaftaran'];
  const intentHits = intentTerms.filter((term) => qNorm.includes(term) && fNorm.includes(term)).length * 4;
  const definitionBoost = userAsksDefinition && faqAsksDefinition ? 7 : 0;
  const definitionMismatchPenalty = userAsksDefinition && !faqAsksDefinition && /\b(?:kegiatan|manfaat|syarat|biaya|kapan|negara|jenis|keunggulan|keuntungan|tujuan)\b/i.test(fNorm) ? 4 : 0;
  return (overlap * 2) + reverseOverlap + targetHits + exactTarget + containment + intentHits + definitionBoost - definitionMismatchPenalty;
}

function extractFaqQaPairsFromChunk(chunk) {
  const raw = String(chunk || '').replace(/\u00A0/g, ' ');
  if (!raw.trim()) return [];
  const normalized = raw
    .replace(/\r/g, '\n')
    .replace(new RegExp(String.raw`(?:^|\s)${FAQ_QUESTION_LABEL_SOURCE}\s*`, 'gi'), String.fromCharCode(10) + 'Q: ')
    .replace(new RegExp(String.raw`(?:^|\s)${FAQ_ANSWER_LABEL_SOURCE}\s*`, 'gi'), String.fromCharCode(10) + 'A: ')
    .replace(/\n{2,}/g, '\n')
    .trim();

  const labelRe = /(?:^|\n)\s*([QA])\s*:\s*/gi;
  const labels = [];
  let match;
  while ((match = labelRe.exec(normalized)) !== null) {
    labels.push({ type: match[1].toUpperCase(), start: match.index, contentStart: labelRe.lastIndex });
    if (labels.length >= 160) break;
  }

  const pairs = [];
  for (let i = 0; i < labels.length; i += 1) {
    const qLabel = labels[i];
    if (!qLabel || qLabel.type !== 'Q') continue;
    const aLabel = labels[i + 1];
    if (!aLabel || aLabel.type !== 'A') continue;
    const nextQuestion = labels.slice(i + 2).find((label) => label.type === 'Q');
    const questionText = stripFaqQaLabel(normalized.slice(qLabel.contentStart, aLabel.start));
    const answerText = cleanFaqAnswerText(normalized.slice(aLabel.contentStart, nextQuestion ? nextQuestion.start : normalized.length));
    if (questionText.length >= 4 && answerText.length >= 8) pairs.push({ questionText, answerText });
  }

  if (pairs.length) return pairs;

  const flat = raw.replace(/\s+/g, ' ').trim();
  const questionRe = /((?:[A-Z0-9][^?]{0,80}\s+)?(?:apa\s+saja|apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
  const markers = [];
  while ((match = questionRe.exec(flat)) !== null) {
    markers.push({ questionText: match[1].trim(), start: match.index, end: match.index + match[1].length });
    if (markers.length >= 80) break;
  }
  for (let i = 0; i < markers.length; i += 1) {
    const cur = markers[i];
    const next = markers[i + 1] ? markers[i + 1].start : flat.length;
    const answerText = cleanFaqAnswerText(flat.slice(cur.end, next));
    if (answerText.length >= 8) pairs.push({ questionText: cur.questionText, answerText });
  }
  return pairs;
}

function cleanUserVisibleRagAnswerText(text) {
  let out = cleanDocumentMarkers(String(text || ''));
  out = out
    .replace(new RegExp(String.raw`^\s*(?:${FAQ_QUESTION_LABEL_SOURCE}|${FAQ_ANSWER_LABEL_SOURCE})\s*`, 'gim'), '')
    .replace(new RegExp(String.raw`\s+(?:${FAQ_QUESTION_LABEL_SOURCE}|${FAQ_ANSWER_LABEL_SOURCE})\s*`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}
function isLikelyFaqQuestionText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^(?:q|tanya|pertanyaan)\s*[:\-.]/i.test(value)) return true;
  if (/^(?:apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa|apa\s+saja)\b/i.test(value)) return true;
  return /\?\s*$/.test(value) && /\b(?:apa\s+saja|apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa|wajib|perlu|diperlukan|dibutuhkan|bisa)\b/i.test(value);
}

function cleanFaqAnswerText(text) {
  return cleanFacilitySnippetText(String(text || '')
    .replace(new RegExp(String.raw`^\s*${FAQ_ANSWER_LABEL_SOURCE}\s*`, 'i'), '')
    .replace(new RegExp(String.raw`^\s*${FAQ_QUESTION_LABEL_SOURCE}\s*.*?\?\s*`, 'i'), '')
    .replace(new RegExp(String.raw`\s+(?:${FAQ_QUESTION_LABEL_SOURCE}|${FAQ_ANSWER_LABEL_SOURCE})\s*`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function extractBestFaqAnswerFromChunk(chunk, target, targetTokens, userQuestion = '', returnMatch = false) {
  const flat = String(chunk || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';

  const pairs = extractFaqQaPairsFromChunk(chunk);
  let best = null;
  for (const pair of pairs) {
    const score = scoreFaqQuestionMatch(userQuestion || target, pair.questionText, target, targetTokens);
    if (!score) continue;
    const answer = cleanUserVisibleRagAnswerText(pair.answerText);
    if (!answer || answer.length < 8) continue;
    if (!best || score > best.score || (score === best.score && answer.length < best.answer.length)) {
      best = { score, answer };
    }
  }
  if (best && best.score >= 2) {
    const answer = best.answer.length > 900 ? `${best.answer.slice(0, 897).trim()}...` : best.answer;
    return returnMatch ? { answer, score: best.score } : answer;
  }

  if (!Array.isArray(targetTokens) || !targetTokens.length) return '';
  const markerRe = /(?:^|\s)((?:(?:q|tanya|pertanyaan)\s*[:\-.]\s*)?(?:apa\s+saja|apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
  const markers = [];
  let match;
  while ((match = markerRe.exec(flat)) !== null) {
    const questionText = String(match[1] || '').trim();
    if (!isLikelyFaqQuestionText(questionText)) continue;
    const start = match.index + match[0].indexOf(match[1]);
    markers.push({ questionText, start, answerStart: start + questionText.length });
    if (markers.length >= 80) break;
  }

  if (!markers.length) return '';

  best = null;
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const score = scoreFaqQuestionMatch(userQuestion || target, current.questionText, target, targetTokens);
    if (!score) continue;
    const next = markers[i + 1] ? markers[i + 1].start : flat.length;
    const answer = cleanUserVisibleRagAnswerText(cleanFaqAnswerText(flat.slice(current.answerStart, next)));
    if (!answer || answer.length < 8) continue;
    if (!best || score > best.score || (score === best.score && answer.length < best.answer.length)) {
      best = { score, answer };
    }
  }

  if (!best || best.score < 2) return '';
  const answer = best.answer.length > 900 ? `${best.answer.slice(0, 897).trim()}...` : best.answer;
  return returnMatch ? { answer, score: best.score } : answer;
}

function hasFaqAnswerDomainConflict(userQuestion, faqQuestion, answer, sourceText = '') {
  const asked = normalizeFacilityTerm(userQuestion || '');
  const ans = normalizeFacilityTerm(answer);
  if (!asked || !ans) return false;

  const domains = [
    { name: 'study_permit', terms: ['izin belajar', 'study permit', 'mahasiswa asing', 'visa pelajar', 'itas', 'kitas', 'sktt'] },
    { name: 'career', terms: ['career center', 'karier', 'karir', 'lowongan', 'magang', 'job fair', 'campus hiring', 'rekrutmen', 'tracer study', 'melamar kerja'] },
    { name: 'student_exchange', terms: ['student exchange', 'pertukaran mahasiswa', 'gccp', 'bccp', 'credit transfer', 'summer program'] },
    { name: 'pmb', terms: ['pmb', 'pendaftaran mahasiswa baru', 'gelombang', 'siap stikom', 'calon mahasiswa'] }
  ];

  for (const domain of domains) {
    const answerHasDomain = domain.terms.some((term) => ans.includes(normalizeFacilityTerm(term)));
    if (!answerHasDomain) continue;
    const questionHasDomain = domain.terms.some((term) => asked.includes(normalizeFacilityTerm(term)));
    if (!questionHasDomain) return true;
  }
  return false;
}

function isCareerCenterQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(career center|pusat karier|pusat karir|karier|karir|lowongan|pekerjaan|peluang kerja|lulusan|alumni|magang|job fair|campus hiring|rekrutmen|perusahaan|kerja sama|kerjasama|pelatihan|pembekalan|tracer study|melamar kerja)\b/i.test(q);
}

function isStudyPermitQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(izin belajar|study permit|mahasiswa asing|foreign student|visa pelajar|itas|kitas|sktt)\b/i.test(q);
}

function isStudentExchangeQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(student exchange|pertukaran mahasiswa|gccp|global cross cultural program|credit transfer|summer program|short program)\b/i.test(q);
}

function isNonPmbFaqDomainQuestion(question) {
  return isCareerCenterQuestion(question) || isStudyPermitQuestion(question) || isStudentExchangeQuestion(question);
}

function tryKnownFaqQnaAnswer(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q) return null;
  const answer = (value, source = 'semantic-rag-generic-faq-qna', frameSource = 'semantic-rag-training-specific') => ({
    answer: value,
    source,
    frameSource,
    matchedSource: 'deterministic-faq-qna-guard'
  });

  if (isStudyPermitQuestion(q)) {
    if (/\b(biaya|bayar|gratis)\b/i.test(q)) {
      return answer('Tidak ada biaya yang dikeluarkan untuk pengurusan Izin Belajar.');
    }
    if (/\b(mulai kuliah|sebelum.*selesai|kuliah sebelum)\b/i.test(q)) {
      return answer('Mahasiswa dapat mengikuti arahan kampus terkait perkuliahan sambil proses Izin Belajar berjalan. Namun Izin Belajar tetap wajib diselesaikan karena merupakan dokumen resmi yang harus dimiliki mahasiswa asing.');
    }
    if (/\b(berapa lama|lama proses|proses pembuatan)\b/i.test(q)) {
      return answer('Lama proses dapat berbeda sesuai verifikasi dan proses dari pihak terkait. Mahasiswa sebaiknya mengajukan dokumen lebih awal dan mengikuti arahan kampus agar proses tidak terlambat.');
    }
    if (/\b(siapa|diurus|siapa yang mengurus|kampus yang mengurus|mahasiswa yang mengurus)\b/i.test(q)) {
      return answer('Pengurusan Izin Belajar dibantu oleh kampus/unit terkait, sementara mahasiswa wajib menyiapkan dan melengkapi dokumen yang diminta. Jadi prosesnya dilakukan melalui kerja sama antara mahasiswa dan kampus.');
    }
    if (/\b(proses|prosedur|pengurusan dokumen|dokumen mahasiswa asing)\b/i.test(q)) {
      return answer('Pengurusan dokumen mahasiswa asing di ITB STIKOM Bali dilakukan dengan menghubungi bagian kerja sama atau international office kampus. Mahasiswa menyiapkan dokumen persyaratan, kemudian kampus membantu proses pengajuan dan koordinasi administrasi sampai dokumen selesai sesuai ketentuan yang berlaku.');
    }
    if (/\b(dokumen|berkas|persyaratan|diperlukan|pengajuan)\b/i.test(q)) {
      return answer('Dokumen yang diperlukan untuk pengajuan Izin Belajar umumnya meliputi identitas/paspor mahasiswa asing, dokumen penerimaan atau status studi di kampus, pas foto, dan dokumen pendukung lain sesuai ketentuan pengajuan. Untuk daftar final, mahasiswa perlu mengikuti arahan kampus karena persyaratan dapat mengikuti ketentuan pemerintah yang berlaku.');
    }
    if (/\b(cara|bagaimana|mengurus|urus)\b/i.test(q)) {
      return answer('Pengurusan Izin Belajar dilakukan melalui kampus. Mahasiswa menyiapkan dokumen persyaratan mahasiswa asing, menyerahkannya ke pihak kampus/unit terkait, lalu kampus membantu proses pengajuan Izin Belajar sesuai prosedur pemerintah.');
    }

    if (/\b(apa itu|wajib|harus punya|perlu punya)\b/i.test(q)) {
      return answer('Izin Belajar adalah dokumen resmi dari pemerintah Indonesia yang menyatakan bahwa mahasiswa asing diperbolehkan menempuh pendidikan di Indonesia. Dokumen ini wajib dimiliki oleh seluruh mahasiswa asing.');
    }
  }

  if (isCareerCenterQuestion(q)) {
    const careerAnswer = (value) => answer(value, 'semantic-rag-campus-support-entity', 'semantic-rag-campus-support-entity');
    if (/\blinkedin\b/i.test(q) && /\b(daftar|mendaftar|pendaftaran|registrasi|program)\b/i.test(q)) {
      return careerAnswer('Untuk pendaftaran program LinkedIn di Career Center, saya belum menemukan detail resminya pada data yang tersedia. Agar tidak keliru, kakak sebaiknya konfirmasi ke Career Center atau admin kampus terkait syarat, jadwal, formulir, dan PIC program tersebut.');
    }
    if (/\b(keuntungan|manfaat|sisi karier)\b/i.test(q)) {
      return careerAnswer('Keuntungan dari sisi karier adalah mahasiswa mendapat dukungan persiapan masuk dunia kerja, seperti informasi lowongan dan magang, pembekalan keterampilan kerja, konsultasi karier, job fair, campus hiring, serta akses jaringan industri.');
    }
    if (/\b(membantu.*pekerjaan|mendapatkan pekerjaan|lulusan.*pekerjaan)\b/i.test(q)) {
      return careerAnswer('Ya. ITB STIKOM Bali membantu mahasiswa dan lulusan melalui Career Center dengan menyediakan informasi lowongan kerja, magang, job fair, campus hiring, konsultasi karier, dan pembekalan kerja. Keputusan diterima bekerja tetap mengikuti seleksi perusahaan.');
    }
    if (/\b(kerja sama|kerjasama|memiliki kerja sama|memiliki kerjasama)\b/i.test(q)) {
      return careerAnswer('Ya. ITB STIKOM Bali terus mengembangkan kerja sama dengan dunia usaha dan dunia industri untuk mendukung pembelajaran berbasis praktik, magang, dan pengembangan karier mahasiswa.');
    }
    if (/\b(perusahaan|rekrutmen|campus hiring|datang ke kampus)\b/i.test(q)) {
      return careerAnswer('Ya. Perusahaan dapat hadir melalui kegiatan rekrutmen kampus atau campus hiring, sehingga mahasiswa dan alumni bisa mendapatkan informasi karier dan mengikuti proses seleksi yang tersedia.');
    }
    if (/\b(job fair)\b/i.test(q)) {
      return careerAnswer('Ya. ITB STIKOM Bali menyelenggarakan Job Fair yang menghadirkan perusahaan dari berbagai sektor industri agar mahasiswa dan alumni dapat memperoleh informasi karier, mengikuti rekrutmen, dan membangun jaringan profesional.');
    }
    if (/\b(kapan|mulai mengikuti|mulai ikut)\b/i.test(q)) {
      return careerAnswer('Mahasiswa dapat mulai mengikuti program Career Center sejak masih menjadi mahasiswa aktif, terutama saat membutuhkan informasi magang, pembekalan kerja, konsultasi karier, atau persiapan melamar pekerjaan.');
    }
    if (/\b(pelatihan|melamar kerja|sebelum melamar|pembekalan)\b/i.test(q)) {
      return careerAnswer('Ya. Mahasiswa mendapat pembekalan atau pelatihan sebelum melamar kerja, seperti persiapan keterampilan kerja, konsultasi karier, dan dukungan menghadapi proses rekrutmen.');
    }
    if (/\b(peluang kerja|prospek kerja)\b/i.test(q)) {
      return careerAnswer('Peluang kerja lulusan ITB STIKOM Bali didukung oleh kurikulum yang relevan dengan kebutuhan industri serta dukungan Career Center, seperti informasi lowongan kerja, magang, job fair, campus hiring, konsultasi karier, dan tracer study.');
    }

    if (/\b(alumni|lowongan kerja)\b/i.test(q)) {
      return careerAnswer('Ya. Alumni tetap dapat memperoleh informasi lowongan kerja dan mengikuti kegiatan Career Center seperti job fair, seminar karier, workshop, serta kegiatan pengembangan profesional.');
    }
    if (/\b(tracer study)\b/i.test(q)) {
      return careerAnswer('Tracer Study adalah survei kepada alumni untuk mengetahui kondisi lulusan setelah menyelesaikan studi, seperti masa tunggu kerja, jenis pekerjaan, kesesuaian bidang kerja, dan masukan untuk peningkatan mutu pendidikan.');
    }
    if (/\b(konsultasi|berkonsultasi)\b/i.test(q)) {
      return careerAnswer('Ya. Mahasiswa dapat berkonsultasi mengenai karier melalui Career Center, termasuk terkait persiapan kerja, peluang karier, magang, dan proses melamar pekerjaan.');
    }
    if (/\b(hanya.*it|bidang it|selain it)\b/i.test(q)) {
      return careerAnswer('Tidak. Lulusan tidak hanya bisa bekerja di bidang IT. Peluang kerja juga terbuka di bidang bisnis digital, perbankan, pariwisata, startup, pemerintahan, pendidikan, industri kreatif, maupun technopreneur sesuai kompetensi yang dimiliki.');
    }
    if (/\b(magang)\b/i.test(q)) {
      return careerAnswer('Ya, ada program dan informasi magang. Career Center membantu mahasiswa mendapatkan informasi peluang magang serta mendukung persiapan mahasiswa sebelum masuk ke dunia kerja.');
    }
    if (/\b(apa itu|career center|pusat karier|pusat karir)\b/i.test(q)) {
      return careerAnswer('Career Center ITB STIKOM Bali merupakan unit yang membantu mahasiswa dan alumni mempersiapkan karier melalui pengembangan kompetensi, informasi lowongan kerja, magang, job fair, campus hiring, konsultasi karier, dan tracer study.');
    }
  }

  if (/\b(mengapa memilih|kenapa memilih|alasan memilih)\b/i.test(q) && /\b(stikom bali|itb stikom)\b/i.test(q)) {
    return answer('ITB STIKOM Bali dapat dipilih karena menyediakan pendidikan berbasis teknologi dan bisnis yang didukung program karier, magang, kerja sama industri, kegiatan mahasiswa, program internasional, serta layanan pendukung seperti Career Center untuk membantu mahasiswa mempersiapkan masa depan.');
  }

  if (isStudentExchangeQuestion(q)) {
    if (/\b(tujuan)\b/i.test(q)) {
      return answer('Program Student Exchange bertujuan memberikan pengalaman belajar di lingkungan internasional, meningkatkan kemampuan bahasa asing, mengembangkan wawasan global dan lintas budaya, serta membangun jaringan internasional.');
    }
    if (/\b(negara|ke negara mana)\b/i.test(q)) {
      return answer('Program Student Exchange tersedia ke berbagai negara mitra, seperti China, Thailand, Malaysia, Philippines, dan negara lain sesuai kerja sama internasional yang aktif.');
    }
    if (/\b(jenis|program.*tersedia|pilihan program|apa saja jenis)\b/i.test(q)) {
      return answer('Jenis program Student Exchange yang tersedia meliputi Exchange Reguler atau Credit Transfer, Short Program / Summer Program, dan Global Cross Cultural Program (GCCP).');
    }
    if (/\b(apa itu)\b/i.test(q) && /\bgccp\b/i.test(q)) {
      return answer('GCCP adalah Global Cross Cultural Program, yaitu program internasional yang memberi pengalaman lintas budaya dan interaksi global kepada mahasiswa.');
    }
    if (/\b(kegiatan)\b/i.test(q) && /\bgccp\b/i.test(q)) {
      return answer('Kegiatan dalam GCCP berfokus pada pengalaman lintas budaya dan interaksi global, seperti pengenalan budaya, aktivitas akademik atau short course, kolaborasi dengan peserta internasional, dan pengembangan wawasan global.');
    }

    if (/\b(syarat|persyaratan)\b/i.test(q)) {
      return answer('Persyaratan umum Student Exchange meliputi mahasiswa aktif ITB STIKOM Bali, memiliki IPK sesuai ketentuan, memiliki kemampuan bahasa asing terutama Bahasa Inggris, serta lolos seleksi administrasi dan wawancara.');
    }
    if (/\b(manfaat)\b/i.test(q)) {
      return answer('Manfaat mengikuti Student Exchange antara lain pengalaman belajar internasional, peningkatan kepercayaan diri dan kemandirian, memperluas jaringan global, serta nilai tambah untuk karier di masa depan.');
    }
    if (/\b(apa itu|student exchange|pertukaran mahasiswa)\b/i.test(q)) {
      return answer('Student Exchange adalah program pertukaran mahasiswa yang memberi kesempatan kepada mahasiswa ITB STIKOM Bali untuk belajar di kampus luar negeri dalam periode tertentu, sekaligus mendapatkan pengalaman akademik dan budaya internasional.');
    }
  }
  return null;
}
function buildGenericFaqQnaAnswerFromIndex(question, indexForQuery, options = {}) {
  const q = String(question || '').trim();
  if (!q || !isLikelyFaqQuestionText(q)) return null;
  const index = Array.isArray(indexForQuery) ? indexForQuery : [];
  if (!index.length) return null;

  const scored = [];
  for (const item of index) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (isLikelyRawAdministrativeDocument(chunk, item && (item.filename || item.sourceFile || ''))) continue;
    const pairs = extractFaqQaPairsFromChunk(chunk);
    if (!pairs.length) continue;
    const sourceText = `${item.filename || ''} ${item.sourceFile || ''} ${item.title || ''}`;
    for (const pair of pairs) {
      const qTokens = Array.from(new Set(faqComparableTokens(q)));
      const fTokens = Array.from(new Set(faqComparableTokens(pair.questionText)));
      const fSet = new Set(fTokens);
      const overlap = qTokens.filter((token) => fSet.has(token)).length;
      const qNorm = normalizeFacilityTerm(q);
      const fNorm = normalizeFacilityTerm(pair.questionText);
      const nearExact = qNorm && fNorm && (qNorm.includes(fNorm) || fNorm.includes(qNorm));
      const shortSpecific = qTokens.length <= 2 && overlap >= 1;
      if (!nearExact && !shortSpecific && overlap < 2) continue;

      const score = scoreFaqQuestionMatch(q, pair.questionText, '', []);
      if (score < 8) continue;
      const answer = cleanUserVisibleRagAnswerText(pair.answerText);
      if (!answer || answer.length < 8) continue;
      if (hasFaqAnswerDomainConflict(q, pair.questionText, answer, '')) continue;
      const sourceBoost = /upload/i.test(String(item && item.source ? item.source : '')) ? 2 : 0;
      const sourceTermBoost = qTokens.filter((token) => normalizeFacilityTerm(sourceText).includes(token)).length;
      scored.push({ item, pair, answer, score: score + sourceBoost + sourceTermBoost + overlap, baseScore: score, overlap });
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.baseScore - a.baseScore || a.answer.length - b.answer.length);
  const best = scored[0];
  const bestNorm = normalizeFacilityTerm(best.pair.questionText);
  const userNorm = normalizeFacilityTerm(q);
  const strongExactOrNearExact = bestNorm && userNorm && (userNorm.includes(bestNorm) || bestNorm.includes(userNorm));
  if (best.baseScore < 12 && !strongExactOrNearExact) return null;

  return {
    answer: best.answer.length > 1100 ? `${best.answer.slice(0, 1097).trim()}...` : best.answer,
    source: 'semantic-rag-generic-faq-qna',
    frameSource: 'semantic-rag-training-specific',
    matchedFaqQuestion: best.pair.questionText,
    matchedTrainingId: best.item && best.item.trainingId,
    matchedSource: best.item && (best.item.filename || best.item.sourceFile || best.item.id)
  };
}

function tryGenericFaqQnaAnswer(question, indexForQuery, options = {}) {
  return buildGenericFaqQnaAnswerFromIndex(question, indexForQuery, options);
}
function buildTrainingSpecificAnswerFromIndex(question, indexForQuery) {
  // Allow training-specific FAQ matching even for some structured campus
  // questions (e.g., Double Degree or partner-related FAQ), because FAQ
  // entries may be authored in a Q/A form and should be matched directly.
  if (isStructuredCampusQuestion(question)) {
    const q = String(question || '').toLowerCase();
    const allowFaqMatch = /\b(double\s*degree|dual\s*degree|utb|dnui|help|faq|ukm|ormawa|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa)\b/i.test(q) || isLikelyFaqQuestionText(question);
    if (!allowFaqMatch) return null;
  }
  const target = extractTrainingSpecificTarget(question);
  if (!target || !Array.isArray(indexForQuery) || !indexForQuery.length) return null;

  const targetTokens = target
    .split(/\s+/)
    .filter((token) => token.length >= 4 || /^(ukm|bem|dpm|hima|bos|dos|ksl|vos|u2m|jcos|mcos|pmk|ksr)$/i.test(token));
  if (!targetTokens.length) return null;

  const scored = [];
  for (const item of indexForQuery) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (isLikelyRawAdministrativeDocument(chunk, item && (item.filename || item.sourceFile || ''))) continue;
    const normalizedChunk = normalizeFacilityTerm(`${item.filename || ''} ${item.sourceFile || ''} ${chunk}`);
    const exact = normalizedChunk.includes(target);
    const tokenHits = targetTokens.filter((token) => normalizedChunk.includes(token)).length;
    const enoughTokenMatch = targetTokens.length <= 2 ? tokenHits === targetTokens.length : tokenHits >= Math.ceil(targetTokens.length * 0.75);
    if (!exact && !enoughTokenMatch) continue;
    const sourceBoost = /upload/i.test(String(item && item.source ? item.source : '')) ? 2 : 0;
    const exactBoost = exact ? 4 : 0;
    const recencyBoost = item && item.createdAt ? 1 : 0;
    scored.push({ item, chunk, score: exactBoost + sourceBoost + recencyBoost + tokenHits });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);

  const snippets = [];
  let bestFaqAnswer = null;
  let bestFaqScore = 0;
  for (const { chunk } of scored.slice(0, 4)) {
    const faqResult = extractBestFaqAnswerFromChunk(chunk, target, targetTokens, question, true);
    const faqAnswer = faqResult && typeof faqResult.answer === 'string' ? faqResult.answer : '';
    const faqScore = faqResult && typeof faqResult.score === 'number' ? faqResult.score : 0;
    if (faqAnswer && faqScore > bestFaqScore) {
      bestFaqScore = faqScore;
      bestFaqAnswer = faqAnswer;
    }
  }

  if (bestFaqAnswer && bestFaqScore >= 2) {
    snippets.push(bestFaqAnswer);
  } else {
    for (const { chunk } of scored.slice(0, 4)) {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const matchedLines = lines.filter((line) => {
        const normalizedLine = normalizeFacilityTerm(line);
        return normalizedLine.includes(target) || targetTokens.every((token) => normalizedLine.includes(token));
      });
      const chosen = matchedLines.length ? matchedLines : lines.slice(0, 2);
      for (const line of chosen) {
        const cleaned = line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
        if (cleaned && !snippets.some((existing) => normalizeFacilityTerm(existing) === normalizeFacilityTerm(cleaned))) snippets.push(cleaned);
        if (snippets.length >= 3) break;
      }
      if (snippets.length >= 3) break;
    }
  }

  if (!snippets.length) return null;
  const title = target === 'hi think' ? 'Hi-Think' : target.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return {
    answer: [
      `Berikut penjelasan tentang ${title}:`,
      '',
      snippets.map((line) => `- ${line}`).join('\n'),
      '',
    ].join('\n'),
    source: 'semantic-rag-training-specific',
    frameSource: 'semantic-rag-training-specific'
  };
}

function tryTrainingSpecificAnswer(question, indexForQuery) {
  // Allow training-specific answers to be considered for all queries.
  // Earlier code blocked UKM/ormawa queries explicitly which prevented
  // training-indexed UKM profiles and FAQ answers from being used.
  // Let `buildTrainingSpecificAnswerFromIndex` decide whether a
  // training-specific response is appropriate for the question.
  return buildTrainingSpecificAnswerFromIndex(question, indexForQuery);
}

let legacyCampusSupportIndexCache = null;

function loadLegacyCampusSupportIndex() {
  try {
    const legacyPath = getLegacyRagIndexPath();
    const activePath = getRagIndexPath();
    if (!legacyPath || path.resolve(legacyPath) === path.resolve(activePath)) return [];
    const stat = fs.statSync(legacyPath);
    const mtimeMs = stat && stat.mtimeMs ? stat.mtimeMs : 0;
    if (legacyCampusSupportIndexCache && legacyCampusSupportIndexCache.path === legacyPath && legacyCampusSupportIndexCache.mtimeMs === mtimeMs) {
      return legacyCampusSupportIndexCache.index;
    }
    const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8') || '[]');
    const index = Array.isArray(parsed) ? parsed : [];
    legacyCampusSupportIndexCache = { path: legacyPath, mtimeMs, index };
    return index;
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to load legacy campus support index');
    return [];
  }
}

function scoreSpecificFacilityCandidates(indexForQuery, candidatePatterns) {
  const scored = [];
  for (const item of Array.isArray(indexForQuery) ? indexForQuery : []) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (isLikelyRawAdministrativeDocument(chunk, item && (item.filename || item.sourceFile || ''))) continue;
    const normalizedChunk = normalizeFacilityTerm(`${item.filename || ''} ${item.sourceFile || ''} ${chunk}`);
    const hasTerm = candidatePatterns.some((pattern) => normalizedChunk.includes(pattern));
    if (!hasTerm) continue;
    const sourceBoost = /upload/i.test(String(item && item.source ? item.source : '')) ? 2 : 0;
    const recencyBoost = item && item.createdAt ? 1 : 0;
    scored.push({ item, chunk, score: sourceBoost + recencyBoost + Math.min(chunk.length / 500, 4) });
  }
  return scored;
}
function cleanFacilitySnippetText(text) {
  let out = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:program\s+studi\s+terlihat|program\s+terlihat|prodi\s+terlihat)\s*:\s*/i, '')
    .replace(/^\s*(?:a|answer|jawab|jawaban)\s*[:\-.]\s*/i, '')
    .trim();

  const stopPatterns = [
    /\s+(?:q|tanya|pertanyaan)\s*[:\-.]\s*/i,
    /\s+(?:apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{3,220}\?\s*(?:a|answer|jawab|jawaban)\s*[:\-.]/i,
    /\s+[A-Z]\.\s+[A-Z][A-Z\s]{4,}\b/
  ];

  let stopAt = -1;
  for (const pattern of stopPatterns) {
    const match = pattern.exec(out);
    if (match && match.index > 20 && (stopAt === -1 || match.index < stopAt)) stopAt = match.index;
  }
  if (stopAt > -1) out = out.slice(0, stopAt).trim();

  out = out
    .replace(/\b(?:q|a)\s*[:\-.]\s*/gi, '')
    .replace(/["'Ã¢â‚¬Å“Ã¢â‚¬Â]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}
function scoreFacilitySnippetText(text, matchedTerm) {
  const raw = String(text || '').trim();
  if (!raw) return 0;
  const normalized = normalizeFacilityTerm(raw);
  const labelNorm = normalizeFacilityTerm(matchedTerm && matchedTerm.label);
  let score = Math.min(raw.length / 90, 8);
  if (labelNorm && normalized.includes(labelNorm)) score += 4;
  if (/\b(adalah|merupakan|bertujuan|tujuan|manfaat|membantu|mempersiapkan|persiapan|bekerja|bidang|jepang|industri)\b/i.test(raw)) score += 5;
  if (/\b(syarat|jadwal|pendaftaran|alur|peserta|pelatihan|bahasa|karier|kerja)\b/i.test(raw)) score += 2;
  if (/^\s*(?:[-*]|\d+[.)])\s*/.test(raw)) score -= 1;
  if (raw.length < 80) score -= 2;
  return score;
}

function collectFacilitySnippetCandidate(list, text, item, matchedTerm, baseScore = 0) {
  const cleaned = cleanFacilitySnippetText(String(text || '').replace(/^\s*(?:[-*]|\d+[.)])\s*/, ''));
  if (!cleaned || cleaned.length < 12) return;
  if (isLikelyRawAdministrativeDocument(cleaned, item && (item.filename || item.sourceFile || ''))) return;
  if (isLikelyFaqQuestionText(cleaned)) return;
  if (/\?\s*(?:a|answer|jawab|jawaban)\s*[:\-.]/i.test(cleaned)) return;
  const normalized = normalizeFacilityTerm(cleaned);
  if (!normalized) return;
  if (list.some((candidate) => normalizeFacilityTerm(candidate.text) === normalized)) return;
  const sourceKey = String((item && (item.filename || item.sourceFile || item.trainingId || item.id)) || '');
  list.push({
    text: cleaned.length > 900 ? `${cleaned.slice(0, 897).trim()}...` : cleaned,
    sourceKey,
    score: baseScore + scoreFacilitySnippetText(cleaned, matchedTerm)
  });
}

function collectFacilityNarrativeSnippets(chunk, item, candidatePatterns, matchedTerm, list) {
  const parts = String(chunk || '')
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const normalizedLine = normalizeFacilityTerm(parts[i]);
    if (!candidatePatterns.some((pattern) => normalizedLine.includes(pattern))) continue;
    const next = parts[i + 1] && !isLikelyFaqQuestionText(parts[i + 1]) ? parts[i + 1] : '';
    const combined = next && parts[i].length < 450 ? `${parts[i]} ${next}` : parts[i];
    collectFacilitySnippetCandidate(list, combined, item, matchedTerm, 3);
    if (list.length >= 10) break;
  }
}
function buildSpecificFacilityAnswerFromIndex(question, indexForQuery) {
  const q = normalizeFacilityTerm(question);
  if (!q) return null;
  const activeIndex = Array.isArray(indexForQuery) ? indexForQuery : [];

  const asksSpecificDetail = /\b(apa\s+itu|apakah|jelaskan|detail|program|layanan|kegunaan|manfaat|syarat|cara|bagaimana|gimana)\b/i.test(String(question || ''));
  const facilityTerms = CAMPUS_SUPPORT_ENTITY_REGISTRY.map(campusSupportEntityToFacilityTerm);

  const matchedTerm = facilityTerms.find((term) => term.patterns.some((pattern) => q.includes(pattern)));
  if (!matchedTerm || !asksSpecificDetail) return null;
  const candidatePatterns = matchedTerm.patterns.map(normalizeFacilityTerm);
  let scored = scoreSpecificFacilityCandidates(activeIndex, candidatePatterns);
  if (!scored.length) {
    scored = scoreSpecificFacilityCandidates(loadLegacyCampusSupportIndex(), candidatePatterns);
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);

  const snippetCandidates = [];
  const faqSnippetCandidates = [];
  const targetForFaq = candidatePatterns.some((pattern) => q.includes(pattern)) ? q : (candidatePatterns[0] || normalizeFacilityTerm(matchedTerm.label));
  const targetTokensForFaq = targetForFaq.split(/\s+/).filter((token) => token.length >= 4);
  for (const { item, chunk, score } of scored.slice(0, 8)) {
    const faqMatch = extractBestFaqAnswerFromChunk(chunk, targetForFaq, targetTokensForFaq, question, true);
    const faqAnswer = faqMatch && typeof faqMatch === 'object' ? faqMatch.answer : faqMatch;
    if (faqAnswer) {
      const faqScore = faqMatch && typeof faqMatch === 'object' ? faqMatch.score : 0;
      collectFacilitySnippetCandidate(faqSnippetCandidates, faqAnswer, item, matchedTerm, 20 + score + (faqScore * 3));
      continue;
    }
    collectFacilityNarrativeSnippets(chunk, item, candidatePatterns, matchedTerm, snippetCandidates);

    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const matchedLines = lines.filter((line) => {
      const normalizedLine = normalizeFacilityTerm(line);
      return candidatePatterns.some((pattern) => normalizedLine.includes(pattern));
    });
    const chosen = matchedLines.length ? matchedLines : lines.slice(0, 2);
    for (const line of chosen) {
      collectFacilitySnippetCandidate(snippetCandidates, line, item, matchedTerm, score);
      if (snippetCandidates.length >= 12) break;
    }
  }

  if (faqSnippetCandidates.length) {
    faqSnippetCandidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    const snippets = [];
    for (const candidate of faqSnippetCandidates) {
      const normalized = normalizeFacilityTerm(candidate.text);
      if (!normalized) continue;
      if (snippets.some((existing) => {
        const existingNorm = normalizeFacilityTerm(existing);
        return existingNorm.includes(normalized) || normalized.includes(existingNorm);
      })) continue;
      snippets.push(candidate.text);
      if (snippets.length >= 1) break;
    }
    if (snippets.length) {
      return {
        answer: snippets.join('\n\n'),
        source: 'semantic-rag-campus-facility-faq',
        frameSource: 'semantic-rag-campus-facility-detail'
      };
    }
  }
  snippetCandidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const snippets = [];
  const usedSources = new Set();
  for (const candidate of snippetCandidates) {
    const normalized = normalizeFacilityTerm(candidate.text);
    if (snippets.some((existing) => {
      const existingNorm = normalizeFacilityTerm(existing);
      return existingNorm.includes(normalized) || normalized.includes(existingNorm);
    })) continue;
    snippets.push(candidate.text);
    if (candidate.sourceKey) usedSources.add(candidate.sourceKey);
    if (snippets.length >= (usedSources.size >= 2 ? 3 : 2)) break;
  }
  if (!snippets.length) return null;
  return {
    answer: [
      `${matchedTerm.label} adalah salah satu program/fasilitas pendukung di ITB STIKOM Bali.`,
      '',
      'Berdasarkan informasi yang tersedia:',
      '',
      snippets.map((line) => `- ${line}`).join('\n'),
      '',
      'Untuk detail teknis seperti jadwal, syarat peserta, atau alur pendaftaran program, kakak bisa konfirmasi ke admin kampus jika belum tercantum.'
    ].join('\n'),
    source: 'semantic-rag-campus-facility-detail',
    frameSource: 'semantic-rag-campus-facility-detail'
  };
}

function buildLinkedInCareerNoDataAnswer() {
  return [
    'Saya belum menemukan detail lengkap tentang program pengembangan karier yang bekerja sama dengan LinkedIn pada data yang tersedia.',
    '',
    'Data yang aman untuk saya sampaikan baru sebatas Career Center membantu mahasiswa dan alumni terkait informasi karier, lowongan/magang, bimbingan karier, dan pembekalan kerja.',
    '',
    'Untuk detail program LinkedIn seperti bentuk kegiatan, jadwal, syarat peserta, atau cara ikut, sebaiknya kakak konfirmasi ke Career Center/admin kampus.'
  ].join('\n');
}

function buildBccpNoDataAnswer() {
  return [
    'Saya belum menemukan informasi lengkap tentang BCCP pada data yang tersedia.',
    '',
    'Jadi saya belum bisa memastikan apakah BCCP ditujukan untuk mahasiswa asing, mahasiswa ITB STIKOM Bali, atau program internasional tertentu.',
    '',
    'Agar tidak keliru, bagian ini sebaiknya dikonfirmasi ke admin kampus atau unit kerja sama internasional.'
  ].join('\n');
}

function buildLanguageLearningAnswer() {
  return [
    'Ya, dari data fasilitas yang tersedia, ITB STIKOM Bali mencantumkan Language Learning Center sebagai fasilitas/program pendukung untuk pengembangan kemampuan bahasa mahasiswa.',
    '',
    'Selain itu, pada data program Hi-Think juga disebutkan adanya kursus bahasa Jepang sebagai bagian dari persiapan belajar/karier yang berkaitan dengan industri Jepang.',
    '',
    'Untuk detail teknis seperti bahasa apa saja yang tersedia, jadwal kelas, syarat ikut, atau biaya jika ada, saya belum menemukan rincian lengkapnya di data yang aman. Sebaiknya kakak konfirmasi ke admin kampus atau pengelola program terkait.'
  ].join('\n');
}

function buildCareerSoftskillAnswer() {
  return [
    'Dalam pengembangan softskill, Career Center ITB STIKOM Bali membantu mahasiswa dan alumni mempersiapkan diri masuk dunia kerja.',
    '',
    'Hal yang aman saya sampaikan dari data yang tersedia meliputi:',
    '',
    '- Bimbingan atau konsultasi karier.',
    '- Pembekalan dan pelatihan keterampilan kerja.',
    '- Informasi lowongan kerja dan magang.',
    '- Kegiatan pendukung seperti job fair atau campus hiring jika tersedia pada agenda kampus.',
    '- Dukungan persiapan memasuki dunia profesional.',
    '',
    'Untuk rincian teknis seperti jadwal pelatihan, daftar materi softskill, nama program, atau cara ikut kegiatan tertentu, saya belum menemukan detail lengkap pada data yang tersedia. Bagian itu sebaiknya dikonfirmasi ke Career Center/admin kampus.'
  ].join('\n');
}

function buildIndustryServicesNoDataAnswer() {
  return [
    'Saya belum menemukan daftar layanan industri khusus pada data yang tersedia.',
    '',
    'Data yang aman saya sampaikan baru sebatas fasilitas/program pendukung kampus seperti Career Center, Inkubator Bisnis, program pengembangan softskill, Language Learning Center, Hi-Think, GCCP, Student Exchange, dan Double Degree.',
    '',
    'Kalau konteksnya kerja sama industri, rekrutmen, magang, pelatihan, atau layanan untuk perusahaan, sebaiknya dikonfirmasi ke admin kampus/unit kerja sama agar tidak keliru.'
  ].join('\n');
}

function buildInkubatorBisnisAnswer() {
  return [
    'Ya, ITB STIKOM Bali memiliki Inkubator Bisnis. Inkubator Bisnis ITB STIKOM Bali adalah fasilitas pendukung yang membantu mahasiswa mengembangkan ide usaha, startup, atau rintisan bisnis berbasis teknologi/digital.',
    '',
    'Gambaran programnya:',
    '',
    '- Pendampingan ide bisnis, validasi ide, mentoring, dan penguatan kewirausahaan.',
    '- Program inkubasi untuk startup tahap awal agar usaha lebih siap dikembangkan.',
    '- Dukungan penyusunan model bisnis, rencana usaha, dan pengembangan proposal kewirausahaan.',
    '- Akses jejaring dengan mentor, praktisi, mitra industri, komunitas, pemerintah, atau investor jika tersedia dalam program.',
    '- Fasilitas pendukung seperti ruang kerja/coworking space, lab, ruang seminar, dan ekosistem kewirausahaan kampus.',
    '',
    'Informasi yang tersedia juga menunjukkan adanya pendampingan terstruktur, kegiatan pengembangan usaha, dan dukungan bagi tim usaha mahasiswa. Untuk jadwal berjalan, syarat peserta, formulir, atau PIC resmi, kakak sebaiknya konfirmasi ke admin kampus/pengelola Inkubator Bisnis agar tidak keliru.'
  ].join('\n');
}
function asksInkubatorBisnisJoinOrRegistration(question) {
  const q = String(question || '').toLowerCase();
  const joinIntent = /\b(?:cara(?:nya)?|bagaimana|gimana|alur|prosedur|mekanisme|syarat|persyaratan|daftar|mendaftar|pendaftaran|registrasi)\b/i.test(q)
    && /\b(?:bergabung|gabung|ikut|mengikuti|masuk|daftar|mendaftar|pendaftaran|registrasi|program(?:nya)?|inkubator|incubator|inbis)\b/i.test(q);
  const shortFollowUpJoinIntent = /^\s*(?:bagaimana|gimana|cara(?:nya)?|alur|prosedur|mekanisme|syarat(?:nya)?|persyaratan(?:nya)?)(?:\s+(?:cara(?:nya)?\s+)?)?(?:bergabung|gabung|ikut|mengikuti|masuk|daftar|mendaftar)?\s*\??\s*$/i.test(q);
  return joinIntent || shortFollowUpJoinIntent;
}

function buildInkubatorBisnisJoinNoDataAnswer() {
  return [
    'Untuk cara bergabung atau mendaftar ke Inkubator Bisnis ITB STIKOM Bali, saya belum menemukan alur pendaftaran yang lengkap dan aman pada data yang tersedia.',
    '',
    'Data yang aman saya sampaikan baru sebatas fungsi Inkubator Bisnis sebagai fasilitas pendukung untuk pendampingan ide bisnis, validasi ide, mentoring bisnis, dan penguatan kewirausahaan.',
    '',
    'Agar tidak keliru, detail seperti syarat peserta, jadwal seleksi, formulir, kontak pengelola, atau mekanisme pendaftaran sebaiknya dikonfirmasi ke admin kampus/pengelola Inkubator Bisnis.'
  ].join('\n');
}
function buildGccpAnswer() {
  return [
    'GCCP adalah Global Cross Cultural Program, yaitu program internasional/short course yang berkaitan dengan pengalaman lintas budaya dan interaksi global.',
    '',
    'Dari data yang tersedia, GCCP termasuk salah satu program pendukung/internasional di ITB STIKOM Bali. Untuk detail teknis seperti negara tujuan, jadwal, syarat peserta, biaya, atau alur pendaftaran, saya belum menemukan rincian lengkap yang aman untuk disampaikan.',
    '',
    'Agar tidak keliru, detail pelaksanaan GCCP sebaiknya dikonfirmasi ke admin kampus atau unit kerja sama internasional.'
  ].join('\n');
}

function buildStudentExchangeProgramOptionsAnswer() {
  return [
    'Student Exchange di ITB STIKOM Bali termasuk bagian dari program internasional dan dukungan kampus untuk pengalaman belajar di luar negeri.',
    '',
    'Dari informasi yang tersedia, beberapa opsi yang terkait dengan program internasional adalah:',
    '',
    '- GCCP (Global Cross Cultural Program)',
    '- BCCP',
    '- short course internasional atau program pertukaran budaya',
    '',
    'Jika kakak ingin detail tentang salah satu dari program di atas, misalnya GCCP atau BCCP, silakan tanya lagi supaya saya bisa fokus ke program tersebut.',
    '',
    'Untuk detail teknis seperti negara tujuan, syarat peserta, jadwal, atau alur pendaftaran, sebaiknya konfirmasi ke admin kampus atau unit kerja sama internasional di STIKOM Bali.'
  ].join('\n');
}

function buildGoesToSchoolAnswer() {
  return [
    'Program STIKOM Bali Goes to School adalah program kunjungan/promosi edukatif ITB STIKOM Bali ke sekolah-sekolah, terutama untuk siswa SMA/SMK.',
    '',
    'Dari data yang tersedia, program ini bertujuan memperkenalkan ITB STIKOM Bali dan memberikan gambaran tentang potensi dunia digital, seperti teknologi informasi, bisnis digital, dan bidang kreatif/digital kepada siswa sekolah.',
    '',
    'Untuk jadwal kunjungan, sekolah sasaran, bentuk kegiatan, atau cara mengundang kampus ke sekolah, saya belum menemukan detail lengkap di data yang tersedia. Bagian itu sebaiknya dikonfirmasi ke admin kampus.'
  ].join('\n');
}

function buildAcademicPolicyNoDataAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(absensi|presensi|kehadiran)\b/i.test(q) && /\b(remedial|remidi|ujian\s+ulang|ujian\s+susulan)\b/i.test(q)) {
    return 'Saya belum menemukan aturan yang cukup aman tentang batas absensi/presensi untuk bisa mengikuti remedial pada data yang tersedia. Agar tidak salah, kakak sebaiknya konfirmasi ke BAAK/dosen pengampu/prodi terkait ketentuan remedial dan syarat kehadiran.';
  }
  return 'Saya belum menemukan kebijakan akademik yang cukup aman untuk menjawab detail itu dari data yang tersedia. Untuk aturan resmi, kakak sebaiknya konfirmasi ke BAAK, dosen pengampu, atau prodi terkait.';
}

function buildAcademicScheduleNoDataAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(remedial|remidi)\b/i.test(q)) {
    return 'Saya belum menemukan jadwal remedial semester genap yang cukup aman pada data yang tersedia. Untuk jadwal resmi remedial, kakak sebaiknya cek pengumuman akademik/SION atau konfirmasi ke BAAK/dosen pengampu.';
  }
  return 'Saya belum menemukan jadwal akademik yang cukup aman pada data yang tersedia. Untuk jadwal resmi, kakak sebaiknya cek pengumuman akademik/SION atau konfirmasi ke BAAK.';
}


function tryCampusSupportEntityAnswer(question, indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  if (/\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier|career)\b/i.test(q)) {
    return {
      answer: buildLinkedInCareerNoDataAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  if (/\b(?:gccp|gcpp|gcp)\b/i.test(q)) {
    if (asksCampusSupportTechnicalDetail(q)) {
      return {
        answer: buildCampusSupportTechnicalNoDataAnswer({ label: 'GCCP' }, q),
        source: 'semantic-rag-campus-support-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: buildGccpAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\b(?:goes\s*to\s*school|goestoschool|stikom\s+bali\s+goes)\b/i.test(q)) {
    return {
      answer: buildGoesToSchoolAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\bbccp\b/i.test(q)) {
    return {
      answer: buildBccpNoDataAnswer(),
      source: 'semantic-rag-campus-support-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  if (/\bsoft\s*skill|softskill|pengembangan\s+softskill|keterampilan\s+kerja\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier|career)\b/i.test(q)) {
    return {
      answer: buildCareerSoftskillAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\bcdc\b/i.test(q)) {
    return {
      answer: 'CDC biasanya merujuk pada Career Development Center/Career Center, yaitu layanan kampus yang membantu mahasiswa dan alumni terkait informasi karier, persiapan kerja, lowongan, magang, atau pengembangan karier sesuai data layanan kampus yang tersedia.',
      source: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\bbaak\b/i.test(q)) {
    return {
      answer: 'BAAK adalah bagian layanan akademik/administrasi akademik kampus. Untuk urusan seperti data akademik, administrasi perkuliahan, KRS/KHS/transkrip, atau informasi akademik resmi, kakak bisa menghubungi BAAK.',
      source: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(String(question || ''))) return null;
  const resolved = resolveCampusSupportEntity(question, options);
  if (!resolved || !resolved.entity) return null;

  if (asksCampusSupportOwner(question)) {
    return {
      answer: buildCampusSupportOwnerNoDataAnswer(resolved.entity),
      source: 'semantic-rag-campus-support-owner-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  // Prefer the dedicated campus facility handler for general Career Center
  if (asksCampusSupportTechnicalDetail(question)) {
    return {
      answer: buildCampusSupportTechnicalNoDataAnswer(resolved.entity, question),
      source: 'semantic-rag-campus-support-entity-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  // questions, because this produces a better Career Center answer.
  if (resolved.entity.key === 'career-center') return null;

  const currentMentionsEntity = !resolved.fromRecent;
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  const asksOtherSupportTopic = /\b(layanan\s+industri|kerja\s*sama\s+industri|industri|inkubator|goes\s*to\s*school|gccp|gcpp|gcp|bccp|student\s+exchange|soft\s*skill|softskill|language\s+learning|belajar\s+bahasa|kemampuan\s+bahasa|ukm|ormawa|hi-?think)\b/i.test(q);
  if (resolved.fromRecent && asksAdmissionRegistration) return null;
  if (resolved.fromRecent && resolved.entity.key === 'linkedin-career-center' && asksOtherSupportTopic) return null;
  if (resolved.fromRecent && isExplicitNonSupportTopic(question) && resolved.entity.key !== 'linkedin-career-center') return null;
  const hasFollowUpSignal = resolved.fromRecent && isShortCampusSupportFollowUp(question);
  const asksDetail = asksCampusSupportDetail(question);
  if (!currentMentionsEntity && !hasFollowUpSignal && !asksDetail) return null;

  const asksStudentExchangeProgramOptions = /\b(program\s+apa\s+saja|ada\s+program\s+apa\s+saja|pilihan\s+program|program\s+yang\s+tersedia|opsi\s+program|ada\s+pilihan\s+program|program\s+internasional|program\s+support|program\s+pendukung)\b/i.test(q);
  if (resolved.entity.key === 'student-exchange' && asksStudentExchangeProgramOptions) {
    return {
      answer: buildStudentExchangeProgramOptionsAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }

  const entityQuestion = currentMentionsEntity
    ? question
    : `${resolved.entity.label} ${question}`;
  if (resolved.entity.key === 'inkubator-bisnis' && asksInkubatorBisnisJoinOrRegistration(q)) {
    return {
      answer: buildInkubatorBisnisJoinNoDataAnswer(),
      source: 'semantic-rag-campus-support-entity-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'inkubator-bisnis' && /\b(?:ada|memiliki|punya|tersedia)\b/i.test(q)) {
    return {
      answer: buildInkubatorBisnisAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'inkubator-bisnis' && /\b(apa\s+itu|itu\s+apa|seperti\s+apa|gambaran|program(?:nya)?|kegiatan(?:nya)?|aktivitas(?:nya)?|layanan(?:nya)?|manfaat(?:nya)?|apa\s+saja|proker|detail|cara(?:nya)?|bagaimana|gimana|bergabung|gabung|ikut|daftar|mendaftar|pendaftaran|syarat|persyaratan|alur|prosedur|mekanisme)\b/i.test(q)) {
    return {
      answer: buildInkubatorBisnisAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'language-learning-center') {
    return {
      answer: buildLanguageLearningAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }

  if (resolved.entity.key === 'softskill') {
    return {
      answer: buildCareerSoftskillAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  const specific = buildSpecificFacilityAnswerFromIndex(entityQuestion, indexForQuery);
  if (specific) {
    return {
      ...specific,
      source: 'semantic-rag-campus-support-entity',
      frameSource: specific.frameSource || 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }

  if (resolved.entity.key === 'inkubator-bisnis' && asksInkubatorBisnisJoinOrRegistration(q)) {
    return {
      answer: buildInkubatorBisnisJoinNoDataAnswer(),
      source: 'semantic-rag-campus-support-entity-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'inkubator-bisnis' && /\b(program(?:nya)?|kegiatan(?:nya)?|aktivitas(?:nya)?|layanan(?:nya)?|manfaat(?:nya)?|apa\s+saja|proker|cara(?:nya)?|bagaimana|gimana|bergabung|gabung|ikut|daftar|mendaftar|pendaftaran|syarat|persyaratan|alur|prosedur|mekanisme)\b/i.test(q)) {
    return {
      answer: buildInkubatorBisnisAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'student-exchange') {
    return {
      answer: buildStudentExchangeProgramOptionsAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }
  if (resolved.entity.key === 'linkedin-career-center') {
    return {
      answer: buildLinkedInCareerNoDataAnswer(),
      source: 'semantic-rag-linkedin-career-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }

  const shouldFailClosed = asksDetail || hasFollowUpSignal || resolved.entity.type === 'international_program';
  if (!shouldFailClosed) return null;

  return {
    answer: buildInsufficientDataAnswer('very_low'),
    source: 'semantic-rag-campus-support-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data',
    matchedEntity: resolved.entity.key,
    contextResolved: resolved.fromRecent || undefined
  };
}
function tryCareerCenterSoftskillAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksSoftskill = /\b(soft\s*skill|softskill|pengembangan\s+softskill|keterampilan\s+kerja|pembekalan\s+kerja|kompetensi)\b/i.test(q);
  const mentionsCareerCenter = /\b(career\s*center|pusat\s+karier|pusat\s+karir|karir|karier|career)\b/i.test(q);
  if (!asksSoftskill || !mentionsCareerCenter) return null;
  return {
    answer: buildCareerSoftskillAnswer(),
    source: 'semantic-rag-career-softskill',
    frameSource: 'semantic-rag-campus-support-entity'
  };
}
function tryLinkedInCareerCenterNoDataAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getLastUserMessage(options && options.sessionData).toLowerCase();
  const currentHasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q);
  const hasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(`${q}\n${recent}`) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(`${q}\n${recent}`);
  if (!hasLinkedInCareerContext) return null;

  const asksLinkedInProgram = /\b(program|tentang|apa\s+itu|itu\s+apa|mengikuti|ikut|daftar|mendaftar|pendaftaran|registrasi|detail|lebih\s+detail|punya\s+info|info(?:rmasi)?|syarat|cara|bagaimana|gimana)\b/i.test(q);
  if (!asksLinkedInProgram) return null;

  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  const asksOtherSupportTopic = /\b(layanan\s+industri|kerja\s*sama\s+industri|industri|inkubator|goes\s*to\s*school|gccp|gcpp|gcp|bccp|student\s+exchange|soft\s*skill|softskill|language\s+learning|belajar\s+bahasa|kemampuan\s+bahasa|ukm|ormawa|hi-?think)\b/i.test(q);
  if (!currentHasLinkedInCareerContext && (asksAdmissionRegistration || asksOtherSupportTopic)) return null;

  return {
    answer: buildLinkedInCareerNoDataAnswer(),
    source: 'semantic-rag-linkedin-career-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data'
  };
}
function tryCampusFacilityAnswer(question, indexForQuery) {
  const q = String(question || '').toLowerCase();
  const asksFacilities = /\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|karir|karier|inkubator|incubator|inbis|softskill|language\s+learning|belajar\s+bahasa|kemampuan\s+bahasa|bahasa(?:nya)?|hi-?think|gccp|bccp|magang\s+berbayar|konsultasi|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q);
  if (!asksFacilities) return null;
  if (/\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(q)) return null;

  if (/\b(layanan\s+industri|dari\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i.test(q)) {
    return {
      answer: buildIndustryServicesNoDataAnswer(),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(?:goes\s*to\s*school|goestoschool|stikom\s+bali\s+goes)\b/i.test(q)) {
    return {
      answer: buildGoesToSchoolAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\b(?:gccp|gcpp|gcp)\b/i.test(q)) {
    if (asksCampusSupportTechnicalDetail(q)) {
      return {
        answer: buildCampusSupportTechnicalNoDataAnswer({ label: 'GCCP' }, q),
        source: 'semantic-rag-campus-support-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: buildGccpAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\b(?:inkubator(?:\s+bisnis)?|incubator(?:\s+bisnis)?|inbis)\b/i.test(q)) {
    if (asksInkubatorBisnisJoinOrRegistration(q)) {
      return {
        answer: buildInkubatorBisnisJoinNoDataAnswer(),
        source: 'semantic-rag-campus-facility-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: buildInkubatorBisnisAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\bbccp\b/i.test(q)) {
    return {
      answer: buildBccpNoDataAnswer(),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(language\s+learning|belajar\s+bahasa|kemampuan\s+bahasa(?:nya)?|meningkatkan\s+kemampuan\s+bahasa(?:nya)?|fasilitas\s+bahasa|kursus\s+bahasa)\b/i.test(q)) {
    if (asksCampusSupportTechnicalDetail(q)) {
      return {
        answer: buildCampusSupportTechnicalNoDataAnswer({ label: 'Language Learning Center' }, q),
        source: 'semantic-rag-campus-facility-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: buildLanguageLearningAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  const specificFromTraining = buildSpecificFacilityAnswerFromIndex(question, indexForQuery);
  if (specificFromTraining) return specificFromTraining;

  if (/\b(parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q)) {
    return {
      answer: buildInsufficientDataAnswer('very_low'),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q)) {
    return {
      answer: buildLinkedInCareerNoDataAnswer(),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q)) {
    if (asksCampusSupportTechnicalDetail(q)) {
      return {
        answer: buildCampusSupportTechnicalNoDataAnswer({ label: 'Career Center' }, q),
        source: 'semantic-rag-campus-facility-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: [
        'Career Center di ITB STIKOM Bali membantu mahasiswa dan lulusan mempersiapkan diri masuk dunia kerja.',
        '',
        'Layanan yang bisa ditanyakan melalui Career Center antara lain:',
        '',
        '- Informasi lowongan kerja dan peluang karier.',
        '- Bimbingan atau konsultasi karier.',
        '- Pelatihan/pembekalan keterampilan kerja.',
        '- Dukungan persiapan memasuki dunia profesional.',
        '',
        'Kalau kakak ingin info yang lebih spesifik, kakak bisa tanya tentang lowongan, magang, atau program persiapan karier yang tersedia.'
      ].join('\n'),
      source: 'semantic-rag-campus-facility'
    };
  }

  return {
    answer: [
      'Fasilitas dan program pendukung yang tersedia di ITB STIKOM Bali antara lain:',
      '',
      '- Career Center',
      '- Inkubator Bisnis',
      '- Program Pengembangan Softskill',
      '- Lebih dari 30 Unit Kegiatan Mahasiswa (UKM)',
      '- Language Learning Center',
      '- Kuliah Sambil Kerja di Luar Negeri',
      '- Program Double Degree Nasional',
      '- Program Double Degree Internasional',
      '- Program Hi-Think untuk persiapan bekerja di bidang TI di Jepang',
      '- Program GCCP atau short course di luar negeri',
      '- Magang berbayar di luar negeri',
      '- Program jaminan konsultasi selama 2 tahun setelah lulus',
      '',
      'Kalau kakak mau, saya bisa jelaskan salah satu fasilitasnya, misalnya Career Center, Inkubator Bisnis, UKM, atau Double Degree.'
    ].join('\n'),
    source: 'semantic-rag-campus-facility'
  };
}
function tryCampusLocationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (isStudyPermitQuestion(question) || isCareerCenterQuestion(question) || isStudentExchangeQuestion(question)) return null;
  if (!/\b(lokasi(?:nya)?|alamat(?:nya)?|kampus(?:nya)?|dimana|di\s*mana|where|letak(?:nya)?|maps?|google\s+maps|rute|arah|patokan|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q)) return null;
  if (/\b(fasilitas|layanan|sarana|prasarana|ukm|ormawa|organisasi|kegiatan\s+mahasiswa|komunitas|hobi|minat)\b/i.test(q)) return null;
  const asksMainCampus = /\b(kampus\s+(?:utama|pusat)|utama(?:nya)?|pusat(?:nya)?)\b/i.test(q);
  const asksGenericCampusLocation = /\b(kampus(?:nya)?|lokasi(?:nya)?\s+kampus|alamat(?:nya)?\s+kampus|campus(?:\s+location)?|location\s+campus|campus\s+address|maps?|google\s+maps|rute|arah|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
  const mentionsOtherCampus = /\b(udayana|unud|warmadewa|undiknas|unhi|unwar|politeknik|universitas\s+(?!teknologi\s+bandung))\b/i.test(q) && !/\b(stikom|itb\s*stikom|stikom\s*bali)\b/i.test(q);
  if (mentionsOtherCampus) return null;
  // Avoid answering campus location when the user asks about competitions/support
  if (/\b(lomba|kompetisi|kompetisi nasional|kompetisi internasional|dukung|mendukung|sponsor|mendanai)\b/i.test(q)) return null;
  const mentionsStikomCampus = /\b(stikom|itb\s*stikom|stikom\s*bali|renon|denpasar|jimbaran|abiansemal)\b/i.test(q) || asksMainCampus || asksGenericCampusLocation;
  if (!mentionsStikomCampus) return null;
  // Avoid matching job/lowongan questions as campus-location; they belong to career handler
  if (/\b(loker|lowongan|lowongan\s+kerja|lowongan\s+pekerjaan|karier|karir|career|kerja)\b/i.test(q)) return null;
  if (/\b(daftar|mendaftar|pendaftaran|registrasi|kuliah)\b/i.test(q) && /\b(dimana|di\s*mana|cara|gimana|bagaimana|mau|ingin|pengen|pengin)\b/i.test(q)) return null;

  if (/\b(kampus\s+(?:utama|pusat)|utama(?:nya)?|pusat(?:nya)?)\b/i.test(q)) {
    return {
      answer: [
        'Kampus utama ITB STIKOM Bali berada di Denpasar/Renon.',
        '',
        '- Kampus Denpasar/Renon: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
        '',
        'Selain kampus utama, ITB STIKOM Bali juga memiliki Kampus Jimbaran dan Kampus Abiansemal.'
      ].join('\n'),
      source: 'semantic-rag-campus-main-location'
    };
  }

  return {
    answer: [
      'Lokasi kampus ITB STIKOM Bali:',
      '',
      '- Denpasar/Renon Campus: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
      '- Kampus Jimbaran: Jl. Raya Kampus Udayana, Kuta Selatan, Jimbaran, Bali.',
      '- Kampus Abiansemal: Jl. Janger, Abiansemal, Dauh Yeh Cani, Badung, Bali.',
      '',
      'Kalau kakak ingin datang langsung, sebaiknya pilih kampus sesuai kebutuhan layanan/prodi lalu cek rute maps dari lokasi kakak.'
    ].join('\n'),
    source: 'semantic-rag-campus-location'
  };
}


function tryCampusSupportFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(lomba|kompetisi|kompetisi nasional|kompetisi internasional|dukung|mendukung|sponsor|mendanai|ikut lomba)\b/i.test(q)) return null;
  return {
    answer: [
      'Untuk dukungan lomba/kompetisi, biasanya kampus menyediakan beberapa jalur, seperti BEM, UKM, Career Center, atau prodi terkait.',
      '',
      'Saran: tanyakan ke BEM atau ketua UKM terkait lomba, atau hubungi bagian kemahasiswaan untuk prosedur pendanaan dan dukungan.',
      '',
      'Kalau mau, saya bisa bantu carikan kontak BEM/UKM atau prosedur umum pengajuan dukungan.'
    ].join('\n'),
    source: 'semantic-rag-campus-support-fallback'
  };
}

function tryFinanceFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(ukt|tagihan|denda|pembayaran|bayar|metode\s+bayar|cara\s+bayar)\b/i.test(q)) return null;
  const operationalPaymentQuestion = /\b(tagihan|denda|jatuh\s+tempo|telat|terlambat|berubah|metode|transfer|va|virtual\s+account|lewat\s+apa|via\s+apa|cara\s+bayar|bayar\s+lewat|pembayaran)\b/i.test(q);
  if (!operationalPaymentQuestion) return null;
  const isPmbFeeQuestion = /\b(pmb|mahasiswa\s+baru|pendaftaran|biaya\s+masuk|awal\s+masuk|dpp|uang\s*pangkal|gelombang|gel\b|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|\bsi\b|\bti\b|\bsk\b|\bbd\b)\b/i.test(q);
  if (isPmbFeeQuestion && !/\b(tagihan|denda|telat|terlambat|berubah|metode|transfer|va|virtual\s+account|lewat\s+apa|via\s+apa|cara\s+bayar|bayar\s+lewat|pembayaran)\b/i.test(q)) return null;
  return {
    answer: [
      'Untuk pertanyaan tentang pembayaran UKT, tagihan, atau denda, biasanya bagian keuangan kampus yang menangani detail transaksi dan metode pembayaran.',
      '',
      'Saran umum: cek portal akademik atau hubungi bagian keuangan kampus untuk rincian tagihan dan metode pembayaran. Untuk denda, konfirmasi tanggal jatuh tempo dan besaran denda kepada bagian keuangan.',
      '',
      'Kalau mau, saya bisa bantu carikan informasi kontak bagian keuangan atau langkah umum pelunasan.'
    ].join('\n'),
    source: 'semantic-rag-finance-fallback'
  };
}

function tryFeeFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(biaya|uang\s*pangkal|uang\s*pangkalnya|dpp|uk t|ukt|uang\s*pangkal)\b/i.test(q)) return null;
  return {
    answer: [
      'Informasi biaya masuk biasanya terdiri dari DPP (uang pangkal) dan UKT per semester, serta pengelompokan berdasarkan gelombang pendaftaran.',
      '',
      'Untuk rincian: lihat informasi PMB (biaya awal masuk / DPP), atau cek portal PMB/halaman resmi pendaftaran untuk nilai spesifik per program dan gelombang.',
      '',
      'Kalau mau, saya bisa bantu carikan tautan PMB atau kontak Admin PMB untuk rincian biaya.'
    ].join('\n'),
    source: 'semantic-rag-fee-fallback'
  };
}


function loadUkmNames() {
  const categorizedPath = path.resolve(__dirname, '..', 'data', 'ukm_list_categorized.json');
  const simplePath = path.resolve(__dirname, '..', 'data', 'ukm_list.json');
  const names = [];
  const add = (value) => {
    const text = String(value || '').trim();
    if (text && !names.some((item) => item.toLowerCase() === text.toLowerCase())) names.push(text);
  };

  try {
    if (fs.existsSync(categorizedPath)) {
      const parsed = JSON.parse(fs.readFileSync(categorizedPath, 'utf8') || '{}');
      const categories = parsed && parsed.categories && typeof parsed.categories === 'object' ? parsed.categories : {};
      for (const items of Object.values(categories)) {
        if (Array.isArray(items)) items.forEach(add);
      }
      if (Array.isArray(parsed && parsed.others)) parsed.others.forEach(add);
    }
    if (!names.length && fs.existsSync(simplePath)) {
      const items = JSON.parse(fs.readFileSync(simplePath, 'utf8') || '[]');
      if (Array.isArray(items)) items.forEach(add);
    }
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to load UKM names');
  }

  return names;
}

function tryThesisFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(skripsi|tugas\s+akhir|tesis|ajukan\s+skripsi|ajukan\s+tesis)\b/i.test(q)) return null;
  return {
    answer: [
      'Untuk pengajuan skripsi (tugas akhir), biasanya langkah umum adalah: (1) menghubungi prodi atau dosen pembimbing, (2) menyiapkan proposal penelitian, (3) mendaftar sidang/ujian sesuai jadwal akademik, dan (4) mengikuti persyaratan administrasi di bagian akademik.',
      'Silakan hubungi program studi atau bagian akademik untuk prosedur lengkap, termasuk format proposal, syarat dosen pembimbing, dan pengumuman jadwal sidang.'
    ].join(' '),
    source: 'semantic-rag-thesis-fallback'
  };
}

function tryInternationalClassFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(kelas\s+internasional|kelas internasional|program\s+internasional|kelas\s+internasional\s+ada)\b/i.test(q)) return null;
  return {
    answer: [
      'Program kelas internasional umumnya diorganisir lewat program Double Degree Internasional, Language Learning Center, atau kerja sama prodi. Untuk kepastian ketersediaan dan persyaratan, hubungi Admin PMB atau bagian Kemahasiswaan.',
      'Jika mau, saya bisa bantu carikan info Double Degree Internasional atau kontak Language Learning Center.'
    ].join(' '),
    source: 'semantic-rag-international-class-fallback'
  };
}

function tryCareerFallback(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(loker|lowongan|lowongan\s+kerja|lowongan\s+pekerjaan|career|karier|karir|kerja)\b/i.test(q)) return null;
  return {
    answer: [
      'Untuk info lowongan atau peluang kerja dari kampus, biasanya cek bagian Career Center atau kanal resmi kemahasiswaan. Career Center sering mengumpulkan lowongan magang dan kerja untuk mahasiswa dan alumni.',
      'Silakan hubungi Career Center atau cek kanal pengumuman kampus untuk daftar lowongan dan prosedur pendaftaran.'
    ].join(' '),
    source: 'semantic-rag-career-fallback'
  };
}

const UKM_INTEREST_PROFILES = [
  { key: 'esports', label: 'esports atau game kompetitif', re: /\b(e-?sport|e-?sports|game|gaming|gamer|game\s+kompetitif|mobile\s+legend|mlbb|pubg|valorant|turnamen\s+game)\b/, items: ['Athena Esports'] },
  { key: 'sports', label: 'olahraga', re: /\b(olahraga|sport|sports|atlet|turnamen|kompetisi|latihan|futsal|sepak\s*bola|main\s+bola|bola|basket)\b/, items: ['Futsal', 'Basket'] },
  { key: 'nature', label: 'alam, petualangan, atau kegiatan outdoor', re: /\b(alam|outdoor|gunung|mendaki|hiking|camping|petualangan|mapala|lingkungan)\b/, items: ['Mapala Kompas'] },
  { key: 'media', label: 'foto, video, desain, atau multimedia', re: /\b(foto|fotografi|photography|kamera|video|videografi|multimedia|desain|design|desain\s+grafis|graphic\s+design|ui\s*\/?\s*ux|editing|konten|content|content\s+creator|konten\s+kreator|sosmed|media)\b/, items: ['Himatography', 'Multimedia'] },
  { key: 'arts', label: 'seni, musik, tari, tabuh, atau teater', re: /\b(seni|musik|band|nyanyi|vokal|vocal|tari|menari|tabuh|teater|drama|akting|acting)\b/, items: ['Musik', 'Tari', 'Tabuh', 'Teater Biner', 'Vos'] },
  { key: 'leadership', label: 'organisasi, kepemimpinan, atau kegiatan kampus', re: /\b(organisasi|kepemimpinan|leadership|pemimpin|bem|dpm|hima|himpunan|panitia|event|acara|kampus)\b/, items: ['Badan Eksekutif Mahasiswa', 'Dewan Perwakilan Mahasiswa', 'Himaprodi BD', 'Himaprodi SI', 'Himaprodi SK', 'Himaprodi TI', 'Himas Jimbaran'] },
  { key: 'volunteer', label: 'relawan, kesehatan, atau kedisiplinan', re: /\b(relawan|volunteer|kesehatan|medis|palang\s+merah|sosial|disiplin|paskibra|baris\s+berbaris)\b/, items: ['Ksr', 'Paskamras'] },
  { key: 'religious', label: 'kegiatan rohani atau keagamaan', re: /\b(rohani|agama|keagamaan|hindu|kristen|islam|muslim|kmhd|pmk|ksl)\b/, items: ['Kmhd', 'Pmk', 'Ksl'] },
  { key: 'technology', label: 'teknologi, coding, atau komunitas IT', re: /\b(coding|ngoding|programming|programmer|teknologi|it\b|komputer|software|developer|web|aplikasi|ai|artificial\s+intelligence|machine\s+learning|data\s+science|database|server|cyber|cybersecurity|jaringan|network|open\s*source|linux)\b/, items: ['Syntax', 'Progress', 'Ksl'] }
];
function tryUkmInterestRecommendation(question, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  if (/\b(linked\s*in|linkedin)\b/i.test(recent) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(recent) && !asksAdmissionRegistration && /\b(detail|info(?:rmasi)?|daftar|mendaftar|pendaftaran|registrasi|cara|bagaimana|gimana|mengikuti|ikut)\b/i.test(q)) return null;
  const currentHasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q);
  const profile = UKM_INTEREST_PROFILES.find((item) => item.re.test(q));
  if (!profile) return null;
  const hasUkmContext = /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(`${q} ${recent}`);
  const asksActivityByInterest = /\b(kegiatan|aktivitas|komunitas|organisasi)\b/i.test(q) && /\b(bidang|dibidang|minat|kategori|jenis)\b/i.test(q);
  const asksUkm = /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|organisasi|unit\s+kegiatan|komunitas|himpunan|hima)\b/i.test(q) || hasUkmContext || asksActivityByInterest;
  const asksRecommendation = asksActivityByInterest || /\b(cocok|rekomendasi|saran|sarankan|pilih|ikut|gabung|masuk|ambil|hobi|hobby|suka|minat|ada\s+yang|ada\s+apa|apa\s+ada|apa\s+yang|apa\s+saja|bidang|dibidang|jenis|kategori|kalau|kalo|yang)\b/i.test(q);
  if (!asksUkm || !asksRecommendation) return null;


  const available = loadUkmNames();
  const availableSet = new Set(available.map((item) => item.toLowerCase()));
  const matched = profile.items.filter((item) => availableSet.has(item.toLowerCase()));
  if (!matched.length) return null;

  return {
    answer: [
      'Untuk minat ' + profile.label + ', UKM/Ormawa yang paling relevan dari data yang tersedia:',
      '',
      matched.map((item) => '- ' + item).join('\n'),
      '',
      'Catatan: beberapa nama UKM berupa singkatan, jadi untuk detail kegiatan, jadwal latihan, dan pendaftaran anggota sebaiknya kakak konfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.',
      '',
      'Kalau kakak mau, saya juga bisa tampilkan seluruh daftar UKM/Ormawa yang tercatat.'
    ].join('\n')
  };
}
function loadUkmList() {
  const categorizedPath = path.resolve(__dirname, '..', 'data', 'ukm_list_categorized.json');
  const simplePath = path.resolve(__dirname, '..', 'data', 'ukm_list.json');

  try {
    if (fs.existsSync(categorizedPath)) {
      const raw = fs.readFileSync(categorizedPath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      const categories = parsed && parsed.categories && typeof parsed.categories === 'object' ? parsed.categories : {};
      const others = Array.isArray(parsed && parsed.others) ? parsed.others : [];
      const parts = [];
      let total = 0;

      for (const [category, items] of Object.entries(categories)) {
        if (!Array.isArray(items) || !items.length) continue;
        total += items.length;
        parts.push(`${category}:\n${items.map((item) => `- ${String(item || '').trim()}`).join('\n')}`);
      }

      if (others.length) {
        total += others.length;
        parts.push(`UKM/Ormawa lainnya:\n${others.map((item) => `- ${String(item || '').trim()}`).join('\n')}`);
      }

      if (parts.length) return { total, text: parts.join('\n\n') };
    }

    if (fs.existsSync(simplePath)) {
      const raw = fs.readFileSync(simplePath, 'utf8');
      const items = JSON.parse(raw || '[]');
      if (Array.isArray(items) && items.length) {
        return {
          total: items.length,
          text: items.map((item) => `- ${String(item || '').trim()}`).join('\n')
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to load UKM list');
  }

  return null;
}

function buildUkmProfileAliases(name, target) {
  const raw = normalizeFacilityTerm(name || target || '');
  const aliases = new Set([target, raw].filter(Boolean));
  if (raw.endsWith('s')) aliases.add(raw.slice(0, -1));
  if (raw === 'athena esports') {
    aliases.add('athena esport');
    aliases.add('athena');
  }
  if (raw === 'vos') aliases.add('voice of stikom bali');
  return Array.from(aliases).filter(Boolean);
}

function hasStructuredUkmNameMatch(haystack, filenameNorm, aliases) {
  const genericBareTerms = new Set(['musik', 'tari', 'tabuh', 'basket', 'futsal']);
  for (const alias of aliases) {
    if (!alias) continue;
    if (filenameNorm.includes(alias) || filenameNorm.includes('ukm ' + alias)) return true;
    if (haystack.includes('ukm ' + alias) || haystack.includes('ormawa ' + alias)) return true;
    if (haystack.includes('profile ukm ' + alias) || haystack.includes('profil ukm ' + alias)) return true;
    if (haystack.includes('profile ormawa ' + alias) || haystack.includes('profil ormawa ' + alias)) return true;
    if (!genericBareTerms.has(alias) && haystack.includes(alias)) return true;
  }
  return false;
}

function cleanUkmProfileChunkText(chunk) {
  return String(chunk || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^ringkasan\s+dokumen\s*:?$/i.test(line))
    .filter((line) => !/^teks\s+hasil\s+ocr\s+gambar\s*:?$/i.test(line))
    .filter((line) => !/^(?:sy\s*)?\W{1,8}$/i.test(line))
    .filter((line) => !/^ww[,\s]*$/i.test(line))
    .join(' ')
    .replace(/^SY\s*\W\s*/i, '')
    .replace(/^PROFILE\s+ORGANISASI\s+/i, '')
    .replace(/^PROFILE\s+SINGKAT\s+/i, '')
    .replace(/^PROFIL\s+SINGKAT\s+/i, '')
    .replace(/^Berikut\s+adalah\s+profil\s+singkat\s+mengenai\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeUkmProfileSentence(sentence) {
  let out = String(sentence || '')
    .replace(/\s+/g, ' ')
    .replace(/^(?:\d+[.)]\s*)+/, '')
    .replace(/^(?:fokus\s*&\s*kegiatan\s+utama|fungsi\s+organisasi|profil\s+singkat|profile\s+singkat|deskripsi\s+singkat|kegiatan\s+rutin\s*&\s*unggulan)\s*[:\-]?\s*/i, '')
    .replace(/^(?:UKM\s+)?Voice\s+of\s+STIKOM\s+Bali\s*[:\-]?\s*/i, 'VOS ')
    .replace(/^(?:UKM\s+)?VOS\s*[:\-]?\s*/i, 'VOS ')
    .replace(/\s+\d+$/g, '')
    .trim();

  out = out.replace(/\s+([,.;:!?])/g, '$1');
  if (out && !/[.!?]$/.test(out)) out += '.';
  return out;
}

function summarizeUkmProfileBody(body, ukmTitle) {
  const raw = String(body || '').trim();
  if (!raw) return '';

  const normalized = raw
    .replace(/\b(\d+[.)])\s+(?=\p{Lu}[\p{L}\s/&-]{3,40}\s*:)/gu, '\n$1 ')
    .replace(/\b(\p{Lu}[\p{L}\s/&-]{3,40})\s*:\s*/gu, '\n$1: ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const sentenceCandidates = normalized
    .split(/(?<=[.!?])\s+|\n+/u)
    .map(normalizeUkmProfileSentence)
    .filter((line) => line.length >= 35)
    .filter((line) => !/^(visi|misi|catatan|identitas\s+organisasi|sejarah\s+singkat)\b/i.test(line))
    .filter((line) => !/\b(?:email|instagram|@|http|www\.)\b/i.test(line));

  const seen = new Set();
  const selected = [];
  for (const line of sentenceCandidates) {
    const key = normalizeFacilityTerm(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(line);
    if (selected.length >= 4) break;
  }

  if (selected.length) {
    return [
      `${ukmTitle} adalah UKM/Ormawa di ITB STIKOM Bali yang informasinya tersedia pada data kampus.`,
      '',
      'Ringkasan kegiatannya:',
      selected.map((line) => `- ${line}`).join('\n')
    ].join('\n');
  }

  const fallback = normalizeUkmProfileSentence(raw);
  return fallback.length > 700 ? `${fallback.slice(0, 697).trim()}...` : fallback;
}
function getCachedTrainingDbIndexForUkm() {
  const records = trainingDbCache && Array.isArray(trainingDbCache.data) ? trainingDbCache.data : [];
  if (!records.length) return [];
  return records.flatMap((record) => convertTrainingDataToCandidate(record) || []);
}

function buildUkmProfileAnswerFromIndex(ukmName, indexForQuery) {
  const name = String(ukmName || '').trim();
  if (!name) return null;
  const target = normalizeFacilityTerm(name);
  const aliases = buildUkmProfileAliases(name, target);
  const indexes = [];
  if (Array.isArray(indexForQuery) && indexForQuery.length) indexes.push(indexForQuery);
  const dbIndex = getCachedTrainingDbIndexForUkm();
  if (dbIndex.length) indexes.push(dbIndex);
  try {
    const fullIndex = ragEngine.loadIndex();
    if (Array.isArray(fullIndex) && fullIndex.length) indexes.push(fullIndex);
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err), ukmName: name }, '[SemanticRAG] failed to load full index for UKM profile');
  }

  const seenIds = new Set();
  const matches = [];
  for (const index of indexes) {
    for (const item of index) {
      if (!item || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      const filename = String(item.filename || item.sourceFile || '');
      const chunk = String(item.chunk || '').trim();
      if (!chunk) continue;
      const haystack = normalizeFacilityTerm(filename + ' ' + chunk);
      const filenameNorm = normalizeFacilityTerm(filename);
      const hasUkmSignal = /\bukm\b/i.test(filename) || /\bukm\b/i.test(chunk) || /\bunit\s+kegiatan\s+mahasiswa\b/i.test(chunk);
      const nameMatch = hasStructuredUkmNameMatch(haystack, filenameNorm, aliases);
      const filenameMatch = aliases.some((alias) => filenameNorm.includes(alias) || filenameNorm.includes('ukm ' + alias));
      if (!hasUkmSignal || (!nameMatch && !filenameMatch)) continue;
      const cleanedBody = cleanUkmProfileChunkText(chunk);
      const adminListLike = (chunk.match(/\bUKM\b/gi) || []).length >= 5 && /\b(?:S\.KOM|M\.KOM|S\.T|M\.T|S\.SN|M\.SN|S\.AG|M\.HUM|MMSI)\b/i.test(chunk) && !/\b(?:merupakan|wadah|bergerak|berfokus|kegiatan|latihan|kompetisi|pengembangan)\b/i.test(chunk);
      if (adminListLike) continue;
      const summaryPenalty = item.isSummary ? -2 : 0;
      const filenameBoost = filenameMatch ? 8 : 0;
      const profileBoost = /profile|profil/i.test(filename) ? 4 : 0;
      const contentBoost = Math.min(5, Math.floor(cleanedBody.length / 180));
      const shortPenalty = cleanedBody.length < 80 ? -6 : 0;
      matches.push({ item, chunk, cleanedBody, score: filenameBoost + profileBoost + contentBoost + summaryPenalty + shortPenalty });
    }
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  const body = best.cleanedBody || cleanUkmProfileChunkText(best.chunk);
  if (!body || body.length < 20) return null;
  const title = name.split(/\\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  const answerText = summarizeUkmProfileBody(body, title);
  if (!answerText || answerText.length < 20) return null;
  return {
    answer: 'Berikut penjelasan tentang UKM ' + title + ':\n\n' + answerText,
    source: 'semantic-rag-ukm-specific',
    frameSource: 'semantic-rag-ukm-specific',
    debug: { ukmProfileFromIndex: true, filename: best.item.filename || best.item.sourceFile || null }
  };
}
function asksUkmTechnicalDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(?:cara(?:nya)?|bagaimana\s+cara|bagaimana|gimana\s+cara|gimana|alur(?:nya)?|prosedur(?:nya)?|mekanisme(?:nya)?|proses(?:nya)?|syarat(?:nya)?|persyaratan(?:nya)?|jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?|kuota|kouta|seleksi|interview|wawancara|biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp|formulir|form(?:nya)?|link(?:nya)?|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|pembina(?:nya)?|pelatih|coach|penanggung\s+jawab|admin(?:nya)?|pengurus(?:nya)?|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q);
}

function buildUkmTechnicalNoDataAnswer(ukmName, question = '') {
  const label = String(ukmName || '').trim() || 'UKM/Ormawa tersebut';
  const q = String(question || '').toLowerCase();
  let detail = 'detail teknis seperti syarat, jadwal, kontak, pembina, atau alur pendaftaran';
  if (/\b(?:cara|bagaimana\s+cara|bagaimana|gimana\s+cara|gimana|alur|prosedur|mekanisme|proses|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q)) {
    detail = 'alur/cara bergabung atau mendaftar';
  } else if (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|kuota|kouta|seleksi|interview|wawancara)\b/i.test(q)) {
    detail = 'syarat anggota, kuota, atau proses seleksi';
  } else if (/\b(?:jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?)\b/i.test(q)) {
    detail = 'jadwal kegiatan, deadline, atau periode pendaftaran';
  } else if (/\b(?:biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp)\b/i.test(q)) {
    detail = 'biaya keanggotaan atau kegiatan';
  } else if (/\b(?:kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengurus(?:nya)?|formulir|form(?:nya)?|link(?:nya)?)\b/i.test(q)) {
    detail = 'kontak, admin/PIC, formulir, atau link pendaftaran';
  } else if (/\b(?:pembina(?:nya)?|pelatih|coach|penanggung\s+jawab)\b/i.test(q)) {
    detail = 'pembina atau penanggung jawab';
  }
  return [
    `Untuk ${detail} UKM ${label}, saya belum menemukan informasi yang lengkap dan aman pada data yang tersedia.`,
    '',
    'Data yang aman saya sampaikan baru sebatas profil/kegiatan umum UKM tersebut. Agar tidak keliru, detail teknis itu sebaiknya dikonfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.'
  ].join('\n');
}
function tryUkmAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getLastUserMessage(options && options.sessionData).toLowerCase();
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  if (/\b(linked\s*in|linkedin)\b/i.test(recent) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(recent) && !asksAdmissionRegistration && /\b(detail|info(?:rmasi)?|daftar|mendaftar|pendaftaran|registrasi|cara|bagaimana|gimana|mengikuti|ikut)\b/i.test(q)) return null;
  const names = loadUkmNames();
  if (/\bkmhd\b/i.test(q)) {
    return {
      answer: 'KMHD adalah Unit Kegiatan Mahasiswa yang menjadi wadah bagi mahasiswa Hindu di ITB STIKOM Bali untuk mengembangkan minat dan bakat di bidang agama. Dari profil yang tersedia, kegiatan KMHD meliputi kegiatan bulanan anggota, pelatihan anggota, dan ngayah bersama. Dengan moto Satyam Eva Jayate, KMHD menjadi sarana bagi mahasiswa Hindu untuk memperdalam pemahaman keagamaan sekaligus membina karakter berdasarkan nilai kebenaran dan dharma.',
      source: 'semantic-rag-ukm-specific',
      frameSource: 'semantic-rag-ukm-specific'
    };
  }
  const hasKslInCurrent = /\b(ksl|kelompok\s+studi\s+linux|linux|open\s*source|open-source|sumber\s+terbuka)\b/i.test(q);
  const isShortUkmFollowUp = /\b(kegiatan(?:nya)?|aktivitas(?:nya)?|program(?:nya)?|manfaat(?:nya)?|pembina(?:nya)?|apa\s+saja)\b/i.test(q) && q.split(/\s+/).filter(Boolean).length <= 6;
  const asksKsl = hasKslInCurrent || (isShortUkmFollowUp && /\b(ksl|kelompok\s+studi\s+linux|linux|open\s*source|open-source|sumber\s+terbuka)\b/i.test(recent));
  if (asksKsl) {
    const asksPembina = /\b(pembina|pelatih|coach|penanggung\s+jawab)\b/i.test(q);
    const asksVisiMisi = /\b(visi|misi)\b/i.test(q);
    const asksProgram = /\b(program\s+kerja|proker)\b/i.test(q);
    const asksActivity = /\b(kegiatan|aktivitas|agenda|ngapain|apa\s+saja)\b/i.test(q);
    const asksBenefit = /\b(manfaat|untung|keuntungan|benefit|bergabung|gabung)\b/i.test(q);

    if (asksPembina) {
      return {
        answer: 'Saya belum menemukan nama pembina UKM KSL pada data yang tersedia. Yang bisa saya pastikan, KSL adalah UKM Kelompok Studi Linux yang mewadahi minat mahasiswa pada Linux, administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak open-source. Untuk nama pembina terbaru, sebaiknya kakak konfirmasi ke bagian kemahasiswaan atau pengurus KSL.',
        source: 'semantic-rag-ukm-specific'
      };
    }

    if (asksVisiMisi) {
      return {
        answer: 'Saya belum menemukan teks visi dan misi resmi UKM KSL secara lengkap pada data yang tersedia. Namun profil yang tersedia menjelaskan bahwa KSL menjadi wadah mahasiswa yang tertarik pada Linux, administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak berbasis open-source, dengan pendekatan belajar bersama dan eksplorasi praktis.',
        source: 'semantic-rag-ukm-specific'
      };
    }

    if (asksProgram) {
      return {
        answer: 'Data yang tersedia belum mencantumkan daftar program kerja resmi UKM KSL secara lengkap. Informasi yang aman untuk saya sampaikan: KSL berfokus pada belajar bersama atau peer learning, eksplorasi praktis Linux/open-source, administrasi sistem, jaringan, keamanan siber, pengembangan perangkat lunak, serta pengelolaan media informasi komunitas.',
        source: 'semantic-rag-ukm-specific'
      };
    }

    if (asksActivity) {
      return {
        answer: 'Kegiatan UKM KSL berhubungan dengan pembelajaran dan eksplorasi praktis di bidang Linux/open-source. Dari data yang tersedia, KSL mewadahi minat mahasiswa pada administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak berbasis open-source, dengan pendekatan peer learning atau belajar bersama antaranggota.',
        source: 'semantic-rag-ukm-specific'
      };
    }

    if (asksBenefit) {
      return {
        answer: 'Manfaat bergabung dengan UKM KSL adalah mahasiswa bisa mengembangkan kemampuan praktis di bidang Linux/open-source, administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak. KSL juga memberi ruang belajar bersama antaranggota dan membangun kreativitas digital melalui aktivitas komunitas.',
        source: 'semantic-rag-ukm-specific'
      };
    }

    return {
      answer: 'KSL adalah UKM Kelompok Studi Linux di ITB STIKOM Bali. UKM ini menjadi wadah bagi mahasiswa yang tertarik pada administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak berbasis open-source. KSL menerapkan pendekatan belajar bersama atau peer learning serta eksplorasi praktis, bukan hanya teori seperti di kelas reguler.',
      source: 'semantic-rag-ukm-specific'
    };
  }
  if (/\b(linux|open\s*source|open-source|sumber\s+terbuka)\b/i.test(q)) {
    const profileAnswer = buildTrainingSpecificAnswerFromIndex(`ukm ksl linux ${question}`, _indexForQuery);
    if (profileAnswer) return { ...profileAnswer, source: 'semantic-rag-ukm-specific', frameSource: 'semantic-rag-ukm-specific' };
    return {
      answer: 'UKM yang bergerak di bidang Linux/Open Source adalah KSL (Kelompok Studi Linux). KSL menjadi wadah mahasiswa yang tertarik pada administrasi sistem, jaringan, keamanan siber, dan pengembangan perangkat lunak berbasis open-source.',
      source: 'semantic-rag-ukm-specific'
    };
  }
  const findMentionedUkm = (text) => {
    const normalizedText = normalizeFacilityTerm(text || '');
    let best = null;
    let bestIndex = -1;
    for (const name of names) {
      const variants = buildUkmProfileAliases(name, normalizeFacilityTerm(name));
      for (const variant of variants) {
        const escaped = String(variant || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!escaped) continue;
        const re = new RegExp(`\\b${escaped}\\b`, 'gi');
        let match;
        while ((match = re.exec(normalizedText)) !== null) {
          if (match.index >= bestIndex) {
            best = name;
            bestIndex = match.index;
          }
        }
      }
    }
    return best;
  };
  const extractExplicitUnknownUkmName = (text) => {
    const normalizedText = normalizeFacilityTerm(text || '');
    const patterns = [
      /\b(?:apa\s+itu|itu\s+apa|tentang|detail|profil|kegiatan|aktivitas|program\s+kerja|proker|pembina|visi\s+misi)\s+ukm\s+([a-z0-9][a-z0-9\s._-]{1,50})\b/i,
      /\bukm\s+([a-z0-9][a-z0-9\s._-]{1,50})\s+(?:itu|ini|adalah|punya|bergerak|kegiatan|aktivitas|program|proker|pembina|visi|misi|apa|gimana|bagaimana)\b/i
    ];
    for (const re of patterns) {
      const match = normalizedText.match(re);
      if (!match || !match[1]) continue;
      const candidate = match[1]
        .replace(/\b(?:itu|ini|apa|adalah|punya|bergerak|kegiatan|aktivitas|program|proker|pembina|visi|misi|gimana|bagaimana|ya|kak|min|admin)\b.*$/i, '')
        .trim();
      if (!candidate) continue;
      if (/\b(?:apa\s+saja|daftar|list|olahraga|sport|teknologi|seni|musik|organisasi|himpunan|ormawa|kegiatan\s+mahasiswa)\b/i.test(candidate)) continue;
      const candidateNorm = normalizeFacilityTerm(candidate);
      if (!candidateNorm) continue;
      const known = names.some((name) => buildUkmProfileAliases(name, normalizeFacilityTerm(name)).some((alias) => normalizeFacilityTerm(alias) === candidateNorm));
      if (!known) return candidate.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
    return '';
  };
  const currentMentionedUkm = findMentionedUkm(q);
  const recentMentionedUkm = findMentionedUkm(recent);
  const explicitUnknownUkmName = !currentMentionedUkm ? extractExplicitUnknownUkmName(q) : '';
  if (explicitUnknownUkmName) {
    return {
      answer: `Saya belum menemukan data UKM/Ormawa bernama ${explicitUnknownUkmName} pada daftar UKM/Ormawa ITB STIKOM Bali yang tersedia. Jadi saya belum bisa menjelaskan profil, kegiatan, pembina, atau program kerjanya. Untuk memastikan apakah UKM tersebut ada atau merupakan nama baru, sebaiknya kakak konfirmasi ke bagian kemahasiswaan atau admin kampus.`,
      source: 'semantic-rag-ukm-unknown-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }  const hasKnownUkmName = !!currentMentionedUkm;
  const hasActivityByInterest = /\b(kegiatan|aktivitas|komunitas|organisasi)\b/i.test(q) && /\b(bidang|dibidang|minat|kategori|jenis)\b/i.test(q);
  const hasUkmSignal = /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|organisasi|bem|hima|unit\s+kegiatan|komunitas|himpunan)\b/i.test(q) || hasKnownUkmName || hasActivityByInterest;
  const hasUkmContext = /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(recent);
  const hasExplicitDifferentTopic = /\b(double\s*degree|dual\s*degree|dd|gelar\s+ganda|program\s+ganda|dnui|help\s+university|utb|bccp|gccp|short\s*course|student\s*exchange|students\s*exchange|exchange\s+program|hi-?think|linked\s*in|linkedin|career\s*center|pusat\s+kar(?:i|ie)r|cdc|pmb|mahasiswa\s+baru|biaya(?:nya)?|harga(?:nya)?|tarif|spp|tagihan|bayar(?:an|nya)?|uang\s+kuliah|angsuran|cicil|cicilan|nyicil|ukt|dpp|gelombang|jadwal|deadline|timeline|beasiswa|kip|prodi|program\s+studi|jurusan|peminatan|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika|indikator|pertanggung\s*jawab(?:an)?|institusi\s+pendidikan|akuntabilitas|fasilitas|layanan|sarana|prasarana|inkubator\s+bisnis|inbis|incubator\s+bisnis|language\s+learning\s+center|llc|pusat\s+bahasa|kursus\s+bahasa|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas|lokasi(?:nya)?|alamat(?:nya)?|maps?|google\s+maps|rute|share\s*loc|shareloc)\b/i.test(q);
  if (!hasUkmSignal && hasUkmContext && hasExplicitDifferentTopic && !asksUkmTechnicalDetail(q)) return null;
  if (!hasUkmSignal && !hasUkmContext) return null;

  const asksUkmList = (
    /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(q)
    && /\b(ada|apa|daftar|list|sebutkan|mana|saja|aja|jenis|pilihan)\b/i.test(q)
  ) || /\b(ada\s+ukm|ukm\s+apa|apa\s+saja\s+ukm|daftar\s+ukm|list\s+ukm|sebutkan\s+ukm|ada\s+ormawa|daftar\s+ormawa)\b/i.test(q);

  const recommendation = tryUkmInterestRecommendation(question, options);
  if (recommendation) return recommendation;

  const followUpUsesRecentUkm = !currentMentionedUkm && !asksUkmList && (!hasExplicitDifferentTopic || asksUkmTechnicalDetail(q)) && shouldUseRecentEntityContext(q) && /\b(kegiatan(?:nya)?|aktivitas(?:nya)?|program(?:nya)?|program\s+kerja|proker|manfaat(?:nya)?|pembina(?:nya)?|jadwal(?:nya)?|deadline(?:nya)?|latihan(?:nya)?|cara\s+(?:ikut|gabung)|daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?|join(?:nya)?|link(?:nya)?|form(?:nya)?|kontak|\bcp\b|pic|admin(?:nya)?|apa\s+saja|gimana|bagaimana)\b/i.test(q);
  const mentionedUkm = currentMentionedUkm || (followUpUsesRecentUkm ? recentMentionedUkm : null);
  if (mentionedUkm && asksUkmTechnicalDetail(q)) {

    return {
      answer: buildUkmTechnicalNoDataAnswer(mentionedUkm, question),
      source: 'semantic-rag-ukm-specific-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data',
      contextResolved: followUpUsesRecentUkm || undefined
    };
  }
  const shortUkmMention = currentMentionedUkm && q.split(/\s+/).filter(Boolean).length <= 4;
  const asksSpecificUkmDetail = mentionedUkm && (
    shortUkmMention
    || /\b(apa\s+itu|itu\s+apa|ukm\s+apa|apa\s+ya|maksud(?:nya)?|kepanjangan|singkatan|kegiatan(?:nya)?|aktivitas(?:nya)?|program\s+kerja|proker|jadwal|latihan|tujuan|detail|tentang|bergerak\s+di\s+bidang|bidang\s+apa|fokus(?:nya)?|divisi)\b/i.test(q)
  );
  if (asksSpecificUkmDetail) {
    const indexedProfileAnswer = buildUkmProfileAnswerFromIndex(mentionedUkm, _indexForQuery);
    if (indexedProfileAnswer) return indexedProfileAnswer;

    const profileAnswer = buildTrainingSpecificAnswerFromIndex(`ukm ${mentionedUkm} ${question}`, _indexForQuery);
    if (profileAnswer) return { ...profileAnswer, source: 'semantic-rag-ukm-specific', frameSource: 'semantic-rag-ukm-specific' };

    const hasSearchSpace = (Array.isArray(_indexForQuery) && _indexForQuery.length)
      || getCachedTrainingDbIndexForUkm().length;
    if (!hasSearchSpace) return null;

    return {
      answer: [
        `Maaf, saya belum punya informasi detail tentang kegiatan atau program kerja UKM ${mentionedUkm}.`,
        '',
        'Data yang tersedia baru cukup untuk menyebutkan bahwa UKM/Ormawa tersebut tercatat di daftar kampus. Untuk detail kegiatan, jadwal, atau pendaftaran anggota, sebaiknya kakak konfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.'
      ].join('\n'),
      source: 'semantic-rag-ukm-specific-insufficient-data'
    };
  }
  if (!asksUkmList) return null;

  const list = loadUkmList();
  if (!list || !list.text) {
    return {
      answer: 'Maaf, saya belum menemukan daftar UKM/Ormawa pada data yang tersedia. Kakak bisa hubungi admin kampus untuk daftar terbaru.',
      source: 'semantic-rag-ukm-no-data'
    };
  }

  return {
    answer: [
      `Ada ${list.total} UKM/Ormawa yang tercatat di ITB STIKOM Bali:`,
      '',
      list.text,
      '',
      'Untuk info jadwal kegiatan, pendaftaran anggota, atau kontak pembina, kakak bisa konfirmasi ke pihak kampus/kemahasiswaan.'
    ].join('\n'),
    source: 'semantic-rag-ukm-list'
  };
}
function hashText(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(question, source, variants) {
  const list = Array.isArray(variants) && variants.length ? variants : [''];
  return list[hashText(`${source || ''}:${question || ''}`) % list.length];
}

function inferFrameTopic(question, source) {
  const q = String(question || '').toLowerCase();
  const src = String(source || '').toLowerCase();

  if (src.includes('pmb-info')) {
    return {
      request: 'informasi umum tentang PMB ITB STIKOM Bali',
      assumption: 'Saya jelaskan sebagai gambaran awal sebelum kakak masuk ke detail pendaftaran.',
      conclusion: 'Jadi, PMB adalah pintu awal untuk calon mahasiswa baru, dan detailnya bisa dilanjutkan ke jadwal, biaya, prodi, atau syarat pendaftaran.',
      followups: [
        'Gelombang pendaftaran sekarang apa?',
        'Rincian biaya SI gelombang 2B?',
        'Syarat pendaftaran apa saja?'
      ]
    };
  }

  if (!src.includes('fee') && (src.includes('schedule-window') || src.includes('current-open-waves') || /\b(jadwal|gelombang|deadline|tanggal|bulan)\b/.test(q))) {
    return {
      request: 'jadwal atau status gelombang pendaftaran PMB',
      assumption: 'Saya gunakan tanggal hari ini kalau kakak menanyakan status pendaftaran sekarang.',
      conclusion: 'Jadi, gelombang yang bisa diikuti mengikuti tanggal daftar kakak pada kalender PMB.',
      followups: [
        'Gelombang yang buka sekarang apa?',
        'Gelombang berikutnya kapan?',
        'Cara daftar di gelombang ini bagaimana?'
      ]
    };
  }

  if (src.includes('registration-info') || /\b(cara|gimana|bagaimana|dimana|di\s*mana)\b.*\b(daftar|pendaftaran|registrasi)\b/.test(q)) {
    return {
      request: 'cara atau kanal pendaftaran kuliah di ITB STIKOM Bali',
      assumption: 'Kakak bisa mulai dari pendaftaran online atau datang langsung ke kampus.',
      conclusion: 'Jadi, langkah paling aman adalah memilih prodi, cek gelombang aktif, lalu lanjut melalui kanal resmi PMB atau admin.',
      followups: [
        'Gelombang yang buka sekarang apa?',
        'Prodi apa saja yang tersedia?',
        'Berapa biaya pendaftaran?'
      ]
    };
  }

  if (src.includes('org-structure-unavailable') || /\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/.test(q)) {
    return {
      request: 'struktur organisasi atau posisi unit/bagian di ITB STIKOM Bali',
      assumption: 'Saya cek berdasarkan data yang tersedia dan tidak menebak struktur internal yang belum tercantum.',
      conclusion: 'Jadi, informasi struktur organisasi tersebut belum tersedia pada dokumen yang ada saat ini.',
      followups: [
        'Fasilitas kampus apa saja?',
        'Career Center memberikan layanan apa?',
        'Kontak kampus berapa?'
      ]
    };
  }
  if (src.includes('training-specific')) {
    return {
      request: 'informasi spesifik yang kakak tanyakan',
      assumption: 'Saya jawab dari informasi yang tersedia dan paling relevan dengan pertanyaan kakak.',
      conclusion: 'Jadi, informasi ini bisa kakak pahami sebagai gambaran awal. Untuk detail teknis seperti jadwal, syarat, atau pendaftaran, kakak bisa konfirmasi ke admin kampus jika belum tercantum.',
      followups: [
        'Fasilitas kampus apa saja?',
        'Career Center memberikan layanan apa?',
        'Program Double Degree apa saja?'
      ]
    };
  }
  if (src.includes('campus-facility-detail')) {
    return {
      request: 'detail program atau fasilitas pendukung yang kakak tanyakan',
      assumption: 'Saya jawab dari bagian informasi yang paling langsung membahas program tersebut.',
      conclusion: 'Jadi, penjelasan detailnya mengikuti informasi yang tersedia. Kalau ada hal teknis seperti jadwal, syarat, atau alur pendaftaran yang belum tercantum, sebaiknya dikonfirmasi ke admin kampus.',
      followups: [
        'Fasilitas kampus apa saja?',
        'Career Center memberikan layanan apa?',
        'Program Double Degree apa saja?'
      ]
    };
  }
  if (src.includes('campus-facility') || /\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|inkubator|incubator|inbis|softskill)\b/.test(q)) {
    return {
      request: 'fasilitas atau layanan pendukung di ITB STIKOM Bali',
      assumption: 'Saya rangkum fasilitas dan program pendukung yang tersedia agar kakak bisa memilih bagian yang ingin ditanyakan lebih lanjut.',
      conclusion: 'Jadi, fasilitas kampus tidak hanya berupa sarana belajar, tetapi juga layanan karier, pengembangan diri, UKM, dan program internasional.',
      followups: [
        'Career Center memberikan layanan apa?',
        'UKM apa saja yang ada?',
        'Program Double Degree apa saja?'
      ]
    };
  }
  if (src.includes('campus-main-location') || /\b(kampus\s+(?:utama|pusat)|pusatnya|utamanya)\b/.test(q)) {
    return {
      request: 'lokasi kampus utama ITB STIKOM Bali',
      assumption: 'Kampus pusat/utama yang dimaksud adalah kampus Denpasar/Renon.',
      conclusion: 'Jadi, kampus utama atau kampus pusat ITB STIKOM Bali berada di Denpasar/Renon.',
      followups: [
        'Alamat lengkap kampus Renon apa?',
        'Kampus Jimbaran di mana?',
        'Kontak kampus berapa?'
      ]
    };
  }

  if (!src.includes('ukm') && (src.includes('campus-location') || /\\b(lokasi|alamat|kampus|maps|rute)\\b/.test(q))) {
    return {
      request: 'lokasi kampus ITB STIKOM Bali',
      assumption: 'Berikut alamat kampus yang tersedia.',
      conclusion: 'Jadi, ITB STIKOM Bali memiliki beberapa lokasi kampus, dan tujuan kunjungan sebaiknya disesuaikan dengan kebutuhan layanan kakak.',
      followups: [
        'Kampus utama di mana?',
        'Prodi saya kuliah di kampus mana?',
        'Kontak kampus berapa?'
      ]
    };
  }

  if (src.includes('ukm-specific')) {
    return {
      request: 'informasi UKM yang kakak tanyakan',
      assumption: 'Saya jawab dari data yang tersedia untuk UKM tersebut.',
      conclusion: 'Untuk detail yang belum tercantum, sebaiknya dikonfirmasi ke pengurus UKM atau kemahasiswaan.',
      followups: [
        'Apa kegiatan UKM itu?',
        'Bagaimana cara ikut UKM itu?',
        'Siapa pembina UKM itu?'
      ]
    };
  }
  if (src.includes('ukm') || /\b(ukm|ormawa|organisasi\s+mahasiswa|bem|hima)\b/.test(q)) {
    const asksUkmRecommendation = /\b(cocok|rekomendasi|saran|sarankan|pilih|ikut|gabung|masuk|hobi|hobby|suka|minat)\b/.test(q);
    if (asksUkmRecommendation) {
      return {
        request: 'rekomendasi UKM atau organisasi mahasiswa sesuai minat kakak',
        assumption: 'Saya cocokkan minat yang kakak sebutkan dengan UKM/Ormawa yang tercatat pada data tersedia.',
        conclusion: 'Jadi, pilihan UKM sebaiknya disesuaikan dengan minat kegiatan, lalu detail jadwal dan pendaftarannya dikonfirmasi ke pengurus atau kemahasiswaan.',
        followups: [
          'Tampilkan semua UKM yang ada',
          'UKM teknologi apa saja?',
          'Bagaimana cara ikut UKM?'
        ]
      };
    }
    return {
      request: 'daftar UKM atau organisasi mahasiswa di ITB STIKOM Bali',
      assumption: 'Saya tampilkan daftar UKM/Ormawa yang tercatat pada data yang tersedia.',
      conclusion: 'Jadi, pilihan UKM/Ormawa cukup beragam dan bisa kakak sesuaikan dengan minat kegiatan di kampus.',
      followups: [
        'UKM teknologi apa saja?',
        'Bagaimana cara ikut UKM?',
        'Ada UKM olahraga apa saja?'
      ]
    };
  }

  const hasFrameFeeSignal = /\b(biaya|harga|tarif|ongkos|uang|kuliah|bayar|dpp|ukt|pendaftaran|registrasi|semester|rincian|detail|total)\b/i.test(q) || src.includes('fee');
  if ((src.includes('dual-degree') && !src.includes('fee')) || (/\b(double\s*degree(?:nya)?|dual\s*degree(?:nya)?|utb|dnui|help)\b/.test(q) && !hasFrameFeeSignal)) {
    return {
      request: 'informasi program Double Degree di ITB STIKOM Bali',
      assumption: 'Saya pisahkan sisi STIKOM Bali dan sisi kampus mitra jika datanya tersedia.',
      conclusion: 'Jadi, informasi Double Degree paling aman dibaca dari pasangan prodi STIKOM Bali dan kampus mitranya.',
      followups: [
        'Double Degree nasional apa saja?',
        'Double Degree internasional apa saja?',
        'Biaya Double Degree berapa?'
      ]
    };
  }

  if (src.includes('registration-fee')) {
    return {
      request: 'biaya pendaftaran PMB',
      assumption: 'Saya jawab hanya komponen pendaftaran, bukan DPP, biaya awal masuk, atau UKT.',
      conclusion: 'Jadi, biaya pendaftaran berbeda setelah potongan mengikuti gelombang pendaftaran.',
      followups: [
        'Biaya pendaftaran Gelombang I B berapa?',
        'Rincian biaya SI gelombang 2B?',
        'Cara daftar kuliah bagaimana?'
      ]
    };
  }

  if (src.includes('contextual-fee')) {
    return {
      request: 'perbandingan harga atau biaya untuk program studi yang kakak sebutkan',
      assumption: 'Saya tidak membahas perbedaan isi programnya di bagian ini.',
      conclusion: 'Jadi, perbandingan harga paling aman dilihat dari biaya awal masuk dan biaya per semester masing-masing prodi.',
      followups: [
        'Rincian biaya SI gelombang 2B?',
        'Rincian biaya SK gelombang 3B?',
        'Biaya S1 termurah apa?'
      ]
    };
  }

  if (src.includes('program-comparison') || /\b(beda|bedanya|perbedaan|bandingkan|perbandingan)\b/.test(q)) {
    return {
      request: 'perbedaan program studi yang kakak sebutkan',
      assumption: 'Saya bandingkan dari fokus belajar, skill yang dibangun, dan arah kariernya.',
      conclusion: 'Jadi, pilihan prodi sebaiknya disesuaikan dengan minat utama: sistem bisnis, perangkat/jaringan, atau software.',
      followups: [
        'Biaya ketiga prodi itu berapa?',
        'Prospek kerja SI bagaimana?',
        'Mana yang cocok untuk analisis data?'
      ]
    };
  }

  if (src.includes('career')) {
    return {
      request: 'prospek kerja dari program studi yang kakak tanyakan',
      assumption: 'Saya fokuskan ke gambaran bidang kerja setelah lulus.',
      conclusion: 'Jadi, prospek kerja paling tepat dilihat dari fokus skill dan bidang industri prodi tersebut.',
      followups: [
        'Apa yang dipelajari di prodi ini?',
        'Biaya prodi ini berapa?',
        'Perbedaan prodi ini dengan prodi lain apa?'
      ]
    };
  }

  if (src.includes('program-recommendation') || /\b(sebaiknya|cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|mengambil|ambil\s+jurusan|jurusan\s+yang\s+mana|prodi\s+yang\s+mana)\b/.test(q)) {
    return {
      request: 'rekomendasi jurusan yang paling sesuai dengan minat atau target karier kakak',
      assumption: 'Saya pakai minat atau pekerjaan yang kakak sebutkan sebagai dasar jawabannya.',
      conclusion: 'Jadi, pilihan prodi paling aman mengikuti fokus karier yang kakak incar, bukan hanya nama jurusannya.',
      followups: [
        'Apa perbedaan SI dan TI?',
        'Prospek kerja SI bagaimana?',
        'Rincian biaya SI gelombang 2B?'
      ]
    };
  }

  if ((src.includes('program-list') || /\b(jurusan|prodi|program\s+studi)\b/.test(q)) && !src.includes('fee') && !/\b(biaya|harga|bayar|ukt|dpp|pendaftaran|rincian|detail|gelombang|gel\b)\b/.test(q)) {
    return {
      request: 'daftar jurusan/program studi yang tersedia di ITB STIKOM Bali',
      assumption: 'Saya tampilkan program reguler D3/S1/S2 dan pilihan Double Degree.',
      conclusion: 'Jadi, pilihan programnya mencakup S2, S1, D3, dan Double Degree.',
      followups: [
        'Apa perbedaan SI dan TI?',
        'Biaya S1 termurah apa?',
        'Prospek kerja Bisnis Digital bagaimana?'
      ]
    };
  }

  if (src.includes('scholarship') || /\b(beasiswa|potongan|diskon)\b/.test(q)) {
    return {
      request: 'informasi beasiswa atau bantuan biaya di ITB STIKOM Bali',
      assumption: 'Saya kaitkan dengan konteks calon mahasiswa baru dan PMB.',
      conclusion: 'Intinya, ada jalur beasiswa/program bantuan dan ada juga potongan biaya PMB sesuai gelombang.',
      followups: [
        'Syarat Beasiswa KIP apa?',
        'Rincian biaya SI gelombang 2B?',
        'Gelombang pendaftaran sekarang apa?'
      ]
    };
  }

  const wantsFullFeeFrame = /\b(rincian|detail|dpp|awal(?:nya)?|masuk|total|semua|gelombang|gel\b)\b/i.test(q);
  if (/\bukt\b|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester/i.test(q) && !wantsFullFeeFrame) {
    return {
      request: 'UKT atau biaya pendidikan per semester',
      assumption: 'Saya pakai angka UKT per semester yang tersedia dan tidak mencampurnya dengan DPP, pendaftaran, atau potongan gelombang.',
      conclusion: 'Jadi, UKT dibaca sebagai biaya per semester, bukan total biaya awal masuk.',
      followups: [
        'Rincian biaya awal masuk SI berapa?',
        'UKT prodi lain berapa?',
        'Biaya S1 termurah apa?'
      ]
    };
  }

  if (src.includes('registration-fee') || /\b(biaya\s+pendaftaran|uang\s+pendaftaran|harga\s+pendaftaran|bayar\s+pendaftaran)\b/.test(q)) {
    return {
      request: 'biaya pendaftaran PMB',
      assumption: 'Saya jawab hanya komponen pendaftaran, bukan DPP, biaya awal masuk, atau UKT.',
      conclusion: 'Jadi, biaya pendaftaran berbeda setelah potongan mengikuti gelombang pendaftaran.',
      followups: [
        'Biaya pendaftaran Gelombang I B berapa?',
        'Rincian biaya SI gelombang 2B?',
        'Cara daftar kuliah bagaimana?'
      ]
    };
  }

  if (src.includes('fee') || /\b(biaya|bayar|dpp|ukt|gelombang|pendaftaran|termurah|termahal)\b/.test(q)) {
    return {
      request: 'informasi biaya kuliah atau biaya pendaftaran',
      assumption: 'Saya pakai komponen biaya PMB yang tersedia dan tidak menambahkan hitungan di luar data.',
      conclusion: 'Jadi, angka biaya paling aman dibaca berdasarkan prodi dan gelombang pendaftaran yang kakak tanyakan.',
      followups: [
        'Rincian biaya SI gelombang 2B?',
        'Biaya S1 termurah apa?',
        'Gelombang pendaftaran sekarang apa?'
      ]
    };
  }

  if (src.includes('career') || /\b(prospek|kerja|karir|karier|lulusan)\b/.test(q)) {
    return {
      request: 'prospek kerja dari program studi yang kakak tanyakan',
      assumption: 'Saya fokuskan ke gambaran bidang kerja setelah lulus.',
      conclusion: 'Jadi, prospek kerja paling tepat dilihat dari fokus skill dan bidang industri prodi tersebut.',
      followups: [
        'Apa yang dipelajari di prodi ini?',
        'Biaya prodi ini berapa?',
        'Perbedaan prodi ini dengan prodi lain apa?'
      ]
    };
  }

  if (/\b(mata\s+kuliah|matkul|kurikulum|dipelajari|yang\s+dipelajari|belajar\s+apa|skill|kemampuan|kompetensi)\b/.test(q)) {
    return {
      request: 'mata kuliah dan skill yang dipelajari di program studi yang kakak tanyakan',
      assumption: 'Saya fokuskan ke materi kuliah utama dan kemampuan yang dibangun.',
      conclusion: 'Jadi, bagian ini paling berguna untuk melihat kecocokan minat belajar kakak dengan isi prodinya.',
      followups: [
        'Prospek kerjanya bagaimana?',
        'Biaya prodi ini berapa?',
        'Apa perbedaan prodi ini dengan prodi lain?'
      ]
    };
  }

  if (src.includes('program-definition') || /\b(apa\s+itu|pengertian)\b/.test(q)) {
    return {
      request: 'penjelasan program studi yang kakak tanyakan',
      assumption: 'Saya jelaskan sebagai gambaran awal untuk calon mahasiswa.',
      conclusion: 'Jadi, prodi ini bisa dipahami dari fokus belajar, skill yang dibangun, dan arah kariernya.',
      followups: [
        'Prospek kerjanya bagaimana?',
        'Biaya prodi ini berapa?',
        'Mata kuliah yang dipelajari apa saja?'
      ]
    };
  }

  return {
    request: 'informasi yang kakak tanyakan seputar ITB STIKOM Bali',
    assumption: 'Saya tetap batasi ke informasi yang tersedia agar tidak menebak di luar konteks kampus.',
    conclusion: 'Jadi, jawaban ini saya rangkum dari informasi yang paling relevan dengan pertanyaan kakak.',
    followups: [
      'Bisa jelaskan lebih detail?',
      'Ada biaya atau syaratnya?',
      'Pilihan lainnya apa saja?'
    ]
  };
}


const PROGRAM_FRAME_LABELS = [
  { key: 'si', label: 'Sistem Informasi', re: /\b(sistem\s+informasi|sistem\s+infomrasi|sistem\s+infromasi|\bsi\b(?!\s+sistem))\b/i },
  { key: 'ti', label: 'Teknologi Informasi', re: /\b(teknologi\s+informasi|teknik\s+informatika|tek\s*info|tekinfo|\bti\b)\b/i },
  { key: 'sk', label: 'Sistem Komputer', re: /\b(sistem\s+komputer|\bsk\b)\b/i },
  { key: 'bd', label: 'Bisnis Digital', re: /\b((?:bisnis|binis|bisinis)\s+digital|\bbd\b)\b/i },
  { key: 'mi', label: 'Manajemen Informatika', re: /\b(manajemen\s+informatika|\bmi\b)\b/i }
];

function detectFramePrograms(question) {
  const q = String(question || '');
  const seen = new Set();
  const out = [];
  for (const item of PROGRAM_FRAME_LABELS) {
    if (item.re.test(q) && !seen.has(item.key)) {
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
}

function joinHumanList(items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return list.join(' dan ');
  return list.slice(0, -1).join(', ') + ', dan ' + list[list.length - 1];
}

function detectFollowupProgram(question, body) {
  const direct = detectFramePrograms(question);
  if (direct.length === 1) return direct[0].label;
  const combined = detectFramePrograms(`${question || ''}\n${body || ''}`);
  if (combined.length === 1) return combined[0].label;
  return '';
}

function humanizeProgramAliasInQuestion(text) {
  return String(text || '')
    .replace(/\bSI\b/g, 'Sistem Informasi')
    .replace(/\bTI\b/g, 'Teknologi Informasi')
    .replace(/\bSK\b/g, 'Sistem Komputer')
    .replace(/\bBD\b/g, 'Bisnis Digital')
    .replace(/\bMI\b/g, 'Manajemen Informatika')
    .replace(/\bprodi ini\b/gi, 'prodi yang kakak tanyakan')
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerFirstWord(text) {
  return String(text || '').replace(/^([A-Z])/, (m) => m.toLowerCase());
}

function expandContextualFollowup(item, context = {}) {
  const raw = String(item || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const q = raw.toLowerCase();
  const program = String(context.program || '').trim();
  const programTarget = program || 'prodi yang kakak tanyakan';
  const source = String(context.source || '').toLowerCase();
  const request = String(context.request || '').toLowerCase();

  if (/ukm|ormawa|organisasi/.test(q)) {
    if (/cara|ikut|gabung/.test(q)) return 'Bagaimana cara ikut UKM atau Ormawa, dan kapan biasanya pendaftaran anggota baru dibuka?';
    if (/olahraga/.test(q)) return 'UKM olahraga apa saja yang tersedia, dan kegiatan rutinnya biasanya seperti apa?';
    if (/teknologi/.test(q)) return 'UKM atau komunitas teknologi apa saja yang cocok untuk mahasiswa yang suka ngoding atau desain digital?';
    return 'UKM atau Ormawa apa saja yang bisa dipilih sesuai minat kegiatan mahasiswa?';
  }
  if (/syarat|dokumen|berkas/.test(q)) {
    return 'Apa saja syarat dan dokumen yang perlu disiapkan untuk mendaftar sebagai mahasiswa baru?';
  }
  if (/gelombang|jadwal|buka|deadline|berikutnya/.test(q) && !/biaya|rincian|ukt|dpp|harga/.test(q)) {
    if (/berikutnya/.test(q)) return 'Gelombang pendaftaran berikutnya mulai kapan, dan apa yang perlu disiapkan sebelum daftar?';
    return 'Gelombang pendaftaran yang sedang dibuka sekarang apa, dan sampai tanggal berapa berlangsung?';
  }
  if (/cara\s+daftar|bagaimana\s+cara|daftar\s+kuliah/.test(q) && !/ukm|ormawa|organisasi/.test(q)) {
    return 'Bagaimana alur pendaftaran mahasiswa baru dari awal daftar sampai mendapatkan arahan berikutnya?';
  }
  if (/prospek|kerja|karir|karier/.test(q)) {
    return `Prospek kerja lulusan ${programTarget} biasanya masuk ke bidang apa saja setelah lulus?`;
  }
  if (/mata\s+kuliah|dipelajari|kurikulum|belajar\s+apa/.test(q)) {
    return `Mata kuliah apa saja yang dipelajari di ${programTarget}, dan skill apa yang paling ditekankan?`;
  }
  if (/biaya|ukt|dpp|pendaftaran|termurah|harga/.test(q)) {
    if (/^biaya\s+pendaftaran/.test(q) && !/rincian|dpp|ukt|semester/.test(q)) {
      return 'Berapa biaya pendaftaran PMB yang berlaku sekarang, dan potongannya mengikuti gelombang apa?';
    }
    if (/termurah/.test(q)) {
      return 'Program S1 mana yang biaya kuliahnya paling terjangkau jika dibandingkan dari komponen biaya resmi dan UKT?';
    }
    const named = humanizeProgramAliasInQuestion(raw);
    if (/gelombang|gel\b/i.test(raw)) {
      return `Bagaimana ${lowerFirstWord(named.replace(/\?$/, ''))}, termasuk komponen biaya resmi dan biaya per semester?`;
    }
    return `Berapa rincian biaya kuliah untuk ${programTarget}, termasuk komponen biaya resmi dan biaya per semester?`;
  }
  if (/perbedaan|beda|bandingkan/.test(q)) {
    return `Apa perbedaan ${programTarget} dengan prodi lain dari sisi materi kuliah dan prospek kerja?`;
  }
  if (/double\s*degree|dual\s*degree/.test(q)) {
    return 'Apa saja pilihan Double Degree yang tersedia, dan kampus mitranya bekerja sama dengan prodi apa?';
  }
  if (/career\s*center|layanan/.test(q)) {
    return 'Layanan apa saja yang diberikan Career Center untuk membantu mahasiswa menyiapkan karier?';
  }
  if (/fasilitas|sarana|prasarana/.test(q)) {
    return 'Fasilitas dan program pendukung apa saja yang tersedia di ITB STIKOM Bali?';
  }
  if (/kontak|hubungi|alamat|kampus/.test(q)) {
    return 'Kontak atau alamat kampus mana yang paling tepat dihubungi untuk kebutuhan informasi ini?';
  }
  if (/beasiswa|kip|potongan|diskon/.test(q) || source.includes('scholarship')) {
    return 'Apa saja syarat utama beasiswa atau potongan biaya yang bisa dicek saat pendaftaran PMB?';
  }

  const clean = humanizeProgramAliasInQuestion(raw).replace(/\?$/, '');
  if (clean.length >= 48) return `${clean}?`;
  if (request.includes('program studi') || program) return `${clean} untuk ${programTarget} secara lebih detail?`;
  return `${clean} secara lebih detail berdasarkan informasi yang tersedia?`;
}
const FOLLOWUP_VALIDATION_SKIP_SOURCES = new Set([
  'semantic-rag-small-talk',
  'semantic-rag-clarification',
  'semantic-rag-out-of-domain',
  'semantic-rag-security-refusal',
  'semantic-rag-student-concern',
  'semantic-rag-feedback',
  'semantic-rag-unsupported-program',
  'semantic-rag-org-structure-unavailable'
]);

function isFollowupValidationEnabled() {
  return envFlag('BOT_VALIDATE_FOLLOWUP_SUGGESTIONS', true);
}

function isValidFollowupHandlerResult(result) {
  if (!result || !result.answer) return false;
  const answer = String(result.answer || '').trim();
  if (!answer) return false;
  if (/TIDAK_CUKUP_DATA/i.test(answer)) return false;
  if (/Maaf,\s*saya\s*belum\s*menemukan\s*data\s*yang\s*cukup/i.test(answer)) return false;
  return true;
}

function canAnswerFollowupCandidate(candidate) {
  const q = String(candidate || '').trim();
  if (!q) return false;
  let handlerIndex = null;
  for (const [source, handler] of DETERMINISTIC_HANDLERS) {
    if (FOLLOWUP_VALIDATION_SKIP_SOURCES.has(source)) continue;
    try {
      const indexArg = SOURCES_NEEDING_INDEX.has(source) ? (handlerIndex || (handlerIndex = getCachedSemanticIndex())) : undefined;
      const result = handler(q, indexArg, { originalQuestion: q, followupValidation: true });
      if (isValidFollowupHandlerResult(result)) return true;
    } catch (e) {
      // Ignore validator failures; the candidate simply won't be shown unless another handler can answer it.
    }
  }
  return false;
}

function buildContextualFollowups(followups, question, body, source, topic) {
  const list = Array.isArray(followups) ? followups : [];
  const context = {
    program: detectFollowupProgram(question, body),
    source,
    request: topic && topic.request ? topic.request : ''
  };
  const validate = isFollowupValidationEnabled();
  const out = [];
  for (const item of list) {
    const expanded = expandContextualFollowup(item, context);
    if (!expanded || out.includes(expanded)) continue;
    if (validate && !canAnswerFollowupCandidate(expanded)) continue;
    out.push(expanded);
    if (out.length >= 3) break;
  }
  return out;
}

function buildHybridFrameOpeners(question, source, topic) {
  const q = String(question || '').toLowerCase();
  const src = String(source || '').toLowerCase();
  const programs = detectFramePrograms(question);
  const programName = programs.length === 1 ? programs[0].label : '';
  const programList = programs.length > 1 ? joinHumanList(programs.map((p) => p.label)) : programName;
  const casual = /\b(apaan|dong|sih|nih|ya|gak|ga|nggak|ngga|pengen|mau|gimana|kak)\b/i.test(q);
  const followUp = /\b(tadi|itu|yang\s+saya\s+tanya|maksudnya|kalau\s+begitu|berarti|jadi|apakah\s+.+tidak|kok)\b/i.test(q);
  const prefix = casual ? 'Oke, Kak.' : 'Baik, Kak.';

  if (src.includes('program-definition')) {
    const name = programName || 'prodi yang kakak maksud';
    if (/\b(mata\s+kuliah|matkul|kurikulum|dipelajari|yang\s+dipelajari|belajar\s+apa|skill|kemampuan|kompetensi)\b/.test(q)) {
      return [
        'Saya jelaskan bagian akademik di ' + name + ' ya, Kak.',
        prefix + ' Saya rangkum mata kuliah utama dan skill yang ditekankan di ' + name + '.',
        'Untuk ' + name + ', saya fokus ke materi kuliah dan kemampuan yang dibangun.',
        'Saya pahami kakak ingin tahu isi pembelajaran di ' + name + '. Berikut gambaran sederhananya.'
      ];
    }
    return [
      'Kalau yang kakak maksud ' + name + ', saya jelaskan gambaran prodinya dulu ya.',
      prefix + ' Saya jelaskan ' + name + ' dari fokus belajar dan kecocokan minatnya.',
      'Untuk ' + name + ', saya mulai dari pengertian singkat dan arah skill yang dibangun.',
      'Saya pahami kakak ingin tahu apa itu ' + name + '. Berikut gambaran sederhananya.'
    ];
  }

  if (src.includes('program-recommendation')) {
    if (programName && followUp) {
      return [
        'Saya sambungkan dengan pertanyaan kakak tentang ' + programName + ' ya.',
        prefix + ' Saya jawab khusus kecocokan ' + programName + ' dengan arah yang kakak sebutkan.',
        'Untuk ' + programName + ', saya jelaskan apakah arahnya cocok atau lebih baik dipertimbangkan dengan prodi lain.',
        'Saya fokus ke prodi yang kakak sebutkan, yaitu ' + programName + '.'
      ];
    }
    return [
      prefix + ' Saya cocokkan minat atau target karier kakak dengan prodi yang paling dekat.',
      'Saya pakai tujuan karier yang kakak sebutkan sebagai dasar rekomendasi prodi.',
      'Kalau arahnya memilih jurusan, saya lihat dulu minat dan pekerjaan yang kakak incar.',
      'Saya bantu arahkan ke prodi yang paling relevan dengan target kakak.'
    ];
  }

  if (src.includes('contextual-fee')) {
    const target = programList || 'prodi yang kakak sebutkan';
    return [
      'Saya pahami kakak membandingkan biaya ' + target + '. Saya fokus ke harga, bukan isi program.',
      prefix + ' Saya bandingkan biaya ' + target + ' dari data yang tersedia.',
      'Untuk perbandingan harga ' + target + ', saya pisahkan biaya awal masuk dan UKT per semester.',
      'Saya jawab bagian biayanya untuk ' + target + ' ya.'
    ];
  }

  if (src.includes('registration-fee')) {
    const target = programName ? ' ' + programName : '';
    return [
      prefix + ' Saya jawab khusus biaya pendaftaran' + target + ' supaya tidak tercampur dengan DPP atau UKT.',
      'Untuk biaya pendaftaran' + target + ', saya pisahkan dari biaya awal masuk dan biaya semester.',
      'Saya cek komponen pendaftaran' + target + ' dari data PMB ya, Kak.',
      'Baik, Kak. Ini khusus biaya pendaftaran' + target + ', bukan total biaya kuliah.'
    ];
  }

  if (src.includes('fee')) {
    const target = programName ? ' ' + programName : '';
    const wantsFullFeeDetail = /\b(rincian|detail|dpp|awal(?:nya)?|masuk|total|semua|gelombang|gel\b)\b/i.test(q);
    if (/\bukt\b|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester/i.test(q) && !wantsFullFeeDetail) {
      return [
        prefix + ' Saya jawab khusus UKT' + target + ' per semester agar tidak tercampur dengan biaya awal masuk.',
        'Untuk UKT' + target + ', saya fokus ke biaya pendidikan per semester.',
        'Kalau yang kakak tanyakan UKT' + target + ', angka ini saya pisahkan dari DPP dan pendaftaran.',
        'Saya cek bagian UKT' + target + ' saja ya, Kak.'
      ];
    }
    return [
      prefix + ' Saya rincikan biaya' + target + ' dari komponen PMB yang tersedia.',
      'Untuk biaya' + target + ', saya susun dari komponen PMB yang tersedia pada dokumen.',
      'Saya jawab rincian biaya' + target + ' sesuai prodi dan gelombang yang kakak sebutkan.',
      'Saya cek bagian biaya' + target + ' dari data PMB ya.'
    ];
  }

  if (src.includes('ukm-specific')) {
    return [
      prefix + ' Saya jawab khusus UKM yang kakak tanyakan.',
      'Saya fokus ke UKM yang kakak sebutkan ya, Kak.',
      'Baik, Kak. Ini jawaban khusus tentang UKM tersebut.',
      'Saya jawab dari data yang tersedia untuk UKM yang kakak maksud.'
    ];
  }
  if (src.includes('ukm')) {
    const interest = q.match(/\b(olahraga|esports?|game|fotografi|foto|video|multimedia|musik|teater|tari|tabuh|organisasi|kepemimpinan|coding|ngoding|teknologi|rohani|agama|alam|outdoor)\b/i);
    if (/\b(cocok|rekomendasi|saran|pilih|ikut|gabung|hobi|hobby|suka|minat)\b/i.test(q)) {
      const label = interest ? interest[1] : 'minat kakak';
      return [
        prefix + ' Saya cocokkan minat ' + label + ' dengan UKM/Ormawa yang tercatat.',
        'Untuk minat ' + label + ', saya pilihkan UKM yang paling relevan dari data yang ada.',
        'Saya jawab dari sisi kecocokan minat dengan UKM yang tersedia ya, Kak.',
        'Kalau tujuannya mencari UKM yang cocok, saya sesuaikan dengan minat yang kakak sebutkan.'
      ];
    }
    return [
      prefix + ' Saya tampilkan UKM/Ormawa yang tercatat di ITB STIKOM Bali.',
      'Untuk UKM dan organisasi mahasiswa, berikut daftar yang tersedia di data.',
      'Saya rangkum pilihan UKM/Ormawa yang tercatat ya, Kak.',
      'Kalau yang kakak cari kegiatan mahasiswa, daftar UKM-nya seperti ini.'
    ];
  }

  if (src.includes('program-comparison')) {
    const target = programList || 'prodi yang kakak sebutkan';
    return [
      prefix + ' Saya bandingkan ' + target + ' dari fokus belajar, skill, dan arah kariernya.',
      'Untuk membedakan ' + target + ', saya pisahkan inti tiap prodi.',
      'Kalau dibandingkan, perbedaan ' + target + ' paling terlihat dari fokus belajarnya.',
      'Saya jelaskan perbedaan ' + target + ' secara ringkas tapi tetap jelas.'
    ];
  }

  if (src.includes('schedule-window') || src.includes('current-open-waves')) {
    return [
      prefix + ' Saya cocokkan pertanyaan kakak dengan kalender gelombang PMB.',
      'Untuk jadwal gelombang, saya cek berdasarkan tanggal atau bulan yang kakak sebutkan.',
      'Saya jawab dari kalender pendaftaran PMB yang tersedia ya, Kak.',
      'Saya bantu cek status gelombang pendaftarannya dari data PMB.'
    ];
  }

  if (src.includes('dual-degree')) {
    return [
      prefix + ' Saya jawab dari program Double Degree yang tersedia di ITB STIKOM Bali.',
      'Untuk Double Degree, saya fokus ke partner kampus dan prodi yang terkait.',
      'Saya jelaskan bagian Double Degree-nya sesuai konteks yang kakak tanyakan.',
      'Kalau konteksnya Double Degree, gambaran pilihannya seperti ini.'
    ];
  }

  return null;
}

function buildFrameOpeners(question, source, topic) {
  const src = String(source || '').toLowerCase();
  const q = String(question || '').toLowerCase();
  const request = topic && topic.request ? topic.request : 'informasi yang kakak tanyakan';
  const assumption = topic && topic.assumption ? topic.assumption : 'Saya batasi ke data yang tersedia.';
  const hybridOpeners = buildHybridFrameOpeners(question, source, topic);
  if (hybridOpeners && hybridOpeners.length) return hybridOpeners;

  if (src.includes('dual-degree')) {
    return [
      'Bisa, Kak. Untuk Double Degree, gambaran pilihannya seperti ini.',
      'Baik, Kak. Saya jawab dari program Double Degree yang tersedia di ITB STIKOM Bali.',
      'Untuk Double Degree, yang paling penting adalah partner kampus dan prodi yang terkait ya, Kak.',
      'Saya jelaskan bagian Double Degree-nya ya, Kak.'
    ];
  }

  if (src.includes('fee')) {
    if (src.includes('contextual-fee')) {
      return [
        'Saya pahami kakak menanyakan perbandingan harga antar prodi. Saya fokus ke biaya, bukan perbedaan isi program.',
        'Baik, Kak. Saya bandingkan dari sisi biaya untuk prodi yang kakak sebutkan.',
        'Untuk perbandingan harga, saya tampilkan biaya awal masuk dan UKT per semester ya, Kak.',
        'Saya jawab bagian perbandingan harganya ya, Kak.'
      ];
    }
    if (/\bukt\b|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester/i.test(String(question || ''))) {
      return [
        'Saya pahami kakak menanyakan UKT per semester. Saya pisahkan dari biaya awal masuk agar angkanya tidak tercampur.',
        'Baik, Kak. Untuk UKT, saya jawab khusus biaya pendidikan per semester.',
        'Kalau yang ditanyakan UKT, saya fokus ke biaya per semester ya, Kak.',
        'Saya jawab bagian UKT-nya saja supaya tidak tercampur dengan DPP atau pendaftaran.'
      ];
    }
    return [
      'Bisa, Kak. Untuk biaya, saya hitungkan dari komponen PMB yang tersedia.',
      'Baik, Kak. Saya rincikan biaya sesuai prodi dan gelombang yang ditanyakan.',
      'Untuk biaya kuliah, saya susun dari komponen PMB yang tersedia pada dokumen ya, Kak.',
      'Saya cekkan rincian biayanya ya, Kak.'
    ];
  }

  if (src.includes('program-recommendation')) {
    return [
      'Bisa, Kak. Untuk rekomendasi jurusan, saya lihat dari target karier yang kakak sebutkan.',
      'Kalau arahnya memilih jurusan, saya cocokkan dengan minat dan pekerjaan yang kakak incar ya.',
      'Untuk rekomendasi jurusan, pilihan paling dekatnya saya jelaskan seperti ini, Kak.',
      'Saya bantu arahkan ke prodi yang paling nyambung dengan tujuan karier kakak ya.'
    ];
  }

  if (src.includes('career')) {
    return [
      'Bisa, Kak. Untuk prospek kerja, gambaran umumnya seperti ini.',
      'Kalau dilihat dari arah kariernya, prodi ini punya beberapa peluang kerja berikut.',
      'Saya jelaskan dari sisi bidang kerja setelah lulus ya, Kak.',
      'Untuk karier lulusan, ini gambaran yang paling relevan, Kak.'
    ];
  }

  if (src.includes('program-comparison')) {
    return [
      'Bisa, Kak. Saya bedakan dari fokus belajar, skill, dan arah kariernya.',
      'Biar lebih mudah dibandingkan, saya pisahkan inti tiap prodi ya, Kak.',
      'Kalau dibandingkan, perbedaannya paling terlihat dari fokus belajarnya.',
      'Saya jelaskan perbedaannya secara ringkas tapi tetap jelas ya, Kak.'
    ];
  }

  if (src.includes('program-list')) {
    return [
      'Bisa, Kak. Ini pilihan program studi di ITB STIKOM Bali.',
      'Berikut daftar programnya saya susun per jenjang ya, Kak.',
      'Kalau yang ditanyakan jurusan di STIKOM Bali, pilihannya seperti ini.',
      'Saya tuliskan daftar program studi yang tersedia di ITB STIKOM Bali ya, Kak.'
    ];
  }

  if (src.includes('program-definition')) {
    return [
      'Bisa, Kak. Sederhananya, prodi ini bisa dipahami seperti ini.',
      'Saya jelaskan gambaran prodinya dengan bahasa yang lebih sederhana ya, Kak.',
      'Kalau ingin mengenal prodinya dulu, penjelasannya seperti ini, Kak.',
      'Untuk pertanyaan "apa itu", saya jelaskan dari fokus belajar dan arah skill-nya ya.'
    ];
  }

  if (src.includes('scholarship')) {
    if (/\\b(seluruh|semua|full|penuh|100\\s*%)\b/i.test(q)) {
      return [
        'Saya jawab hati-hati ya, Kak, karena cakupan beasiswa perlu dipastikan per jalur.',
        'Untuk apakah beasiswa menanggung seluruh biaya, saya batasi ke data yang tersedia.',
        'Saya belum bisa memastikan beasiswa full dari data yang ada, jadi saya jelaskan batas amannya.',
        'Bagian cakupan beasiswa perlu dikonfirmasi ke PMB, jadi saya jawab yang aman dulu ya, Kak.'
      ];
    }
    return [
      'Ada, Kak. Untuk beasiswa, pilihannya seperti ini.',
      'Bisa, Kak. Berikut jalur beasiswa yang bisa ditanyakan ke PMB.',
      'Untuk bantuan biaya kuliah, pilihan beasiswanya ada beberapa ya, Kak.',
      'Saya rangkum pilihan beasiswa yang tersedia ya, Kak.'
    ];
  }

  if (src.includes('schedule-window') || src.includes('current-open-waves')) {
    return [
      'Saya pahami kakak sedang menanyakan jadwal gelombang PMB. Saya cocokkan dengan kalender pendaftaran yang tersedia.',
      'Baik, Kak. Saya cek dari kalender PMB sesuai tanggal atau gelombang yang kakak sebutkan.',
      'Untuk jadwal pendaftaran, saya jawab berdasarkan kalender PMB yang tersedia ya, Kak.',
      'Saya bantu cek gelombang pendaftarannya dari data kalender PMB ya, Kak.'
    ];
  }

  if (src.includes('registration-info')) {
    return [
      'Saya pahami kakak ingin tahu cara daftar kuliah di ITB STIKOM Bali. Saya jawab dari alur awal PMB yang aman.',
      'Baik, Kak. Untuk pendaftaran, saya arahkan ke langkah awal yang perlu kakak lakukan.',
      'Kalau konteksnya mau daftar kuliah, saya jelaskan langkah awal PMB-nya ya, Kak.',
      'Saya bantu jelaskan cara mulai pendaftarannya secara umum ya, Kak.'
    ];
  }

  if (src.includes('campus-location')) {
    return [
      'Saya pahami kakak menanyakan lokasi kampus ITB STIKOM Bali.',
      'Baik, Kak. Ini informasi lokasi kampus ITB STIKOM Bali.',
      'Kalau yang kakak cari alamat kampus, saya bantu jawab ya.',
      'Saya jawab bagian lokasi kampusnya ya, Kak.'
    ];
  }

  if (src.includes('rpl')) {
    return [
      'Saya jawab khusus jalur RPL/mahasiswa pindahan ya, Kak.',
      'Untuk RPL, saya jelaskan dari data yang tersedia dan tetap arahkan verifikasi ke PMB.',
      'Kalau konteksnya RPL atau konversi SKS, gambaran amannya seperti ini.',
      'Saya bantu jelaskan RPL secara ringkas dan aman sesuai data yang tersedia.'
    ];
  }

  if (src.includes('ukm-specific')) {
    return [
      prefix + ' Saya jawab khusus UKM yang kakak tanyakan.',
      'Saya fokus ke UKM yang kakak sebutkan ya, Kak.',
      'Baik, Kak. Ini jawaban khusus tentang UKM tersebut.',
      'Saya jawab dari data yang tersedia untuk UKM yang kakak maksud.'
    ];
  }
  if (src.includes('ukm')) {
    return [
      'Saya pahami kakak menanyakan UKM/Ormawa di ITB STIKOM Bali. Saya tampilkan daftar yang tersedia.',
      'Baik, Kak. Untuk UKM dan organisasi mahasiswa, pilihannya saya rangkum berikut.',
      'Kalau yang kakak cari kegiatan mahasiswa, berikut daftar UKM/Ormawa yang tersedia.',
      'Saya bantu sebutkan UKM/Ormawa yang tercatat ya, Kak.'
    ];
  }

  return [
    'Bisa, Kak. Saya jawab sesuai data ITB STIKOM Bali yang tersedia.',
    'Baik, Kak. Saya bantu jawab dari konteks ITB STIKOM Bali ya.',
    'Saya jawab bagian yang relevan dengan pertanyaan kakak ya.',
    'Untuk pertanyaan ini, saya fokus ke informasi ITB STIKOM Bali yang tersedia.'
  ];

  if (src.includes('dual-degree')) {
    return [
      'Bisa, Kak. Untuk Double Degree, gambaran pilihannya seperti ini.',
      'Baik, Kak. Saya jawab dari program Double Degree yang tersedia di ITB STIKOM Bali.',
      'Untuk Double Degree, yang paling penting adalah partner kampus dan prodi yang terkait ya, Kak.',
      'Saya jelaskan bagian Double Degree-nya ya, Kak.'
    ];
  }

  if (src.includes('fee')) {
    return [
      'Bisa, Kak. Untuk biaya, saya hitungkan dari komponen PMB yang tersedia.',
      'Baik, Kak. Saya rincikan biaya sesuai prodi dan gelombang yang ditanyakan.',
      'Untuk biaya kuliah, saya susun dari komponen PMB yang tersedia pada dokumen ya, Kak.',
      'Saya cekkan rincian biayanya ya, Kak.'
    ];
  }

  if (src.includes('program-recommendation')) {
    return [
      'Bisa, Kak. Untuk rekomendasi jurusan, saya lihat dari target karier yang kakak sebutkan.',
      'Kalau arahnya memilih jurusan, saya cocokkan dengan minat dan pekerjaan yang kakak incar ya.',
      'Untuk rekomendasi jurusan, pilihan paling dekatnya saya jelaskan seperti ini, Kak.',
      'Saya bantu arahkan ke prodi yang paling nyambung dengan tujuan karier kakak ya.'
    ];
  }

  if (src.includes('career')) {
    return [
      'Bisa, Kak. Untuk prospek kerja, gambaran umumnya seperti ini.',
      'Kalau dilihat dari arah kariernya, prodi ini punya beberapa peluang kerja berikut.',
      'Saya jelaskan dari sisi bidang kerja setelah lulus ya, Kak.',
      'Untuk karier lulusan, ini gambaran yang paling relevan, Kak.'
    ];
  }

  if (src.includes('program-comparison')) {
    return [
      'Bisa, Kak. Saya bedakan dari fokus belajar, skill, dan arah kariernya.',
      'Biar lebih mudah dibandingkan, saya pisahkan inti tiap prodi ya, Kak.',
      'Kalau dibandingkan, perbedaannya paling terlihat dari fokus belajarnya.',
      'Saya jelaskan perbedaannya secara ringkas tapi tetap jelas ya, Kak.'
    ];
  }

  if (src.includes('program-list')) {
    return [
      'Bisa, Kak. Ini pilihan program studi di ITB STIKOM Bali.',
      'Berikut daftar programnya saya susun per jenjang ya, Kak.',
      'Kalau yang ditanyakan jurusan di STIKOM Bali, pilihannya seperti ini.',
      'Saya tuliskan daftar program studi yang tersedia di ITB STIKOM Bali ya, Kak.'
    ];
  }

  if (src.includes('program-definition')) {
    if (/\b(mata\s+kuliah|matkul|kurikulum|dipelajari|yang\s+dipelajari|belajar\s+apa|skill|kemampuan|kompetensi)\b/.test(q)) {
      return [
        'Bisa, Kak. Saya jelaskan dari mata kuliah utama dan skill yang ditekankan.',
        'Untuk bagian akademiknya, saya rangkum materi kuliah dan kemampuan yang dibangun ya.',
        'Saya fokus ke isi pembelajaran di prodi ini: mata kuliah dan skill utamanya.',
        'Baik, Kak. Ini gambaran materi yang dipelajari dan skill yang paling ditekankan.'
      ];
    }
    return [
      'Bisa, Kak. Sederhananya, prodi ini bisa dipahami seperti ini.',
      `Untuk pertanyaan "apa itu", saya jelaskan dari fokus belajar dan arah skill-nya ya.`,
      'Kalau ingin mengenal prodinya dulu, penjelasannya seperti ini, Kak.',
      'Untuk pertanyaan "apa itu", saya jelaskan dari fokus belajar dan arah skill-nya ya.'
    ];
  }

  if (src.includes('scholarship')) {
    return [
      `Saya pahami kakak ingin tahu pilihan beasiswa. ${assumption}`,
      `Untuk beasiswa, saya rangkum jalur bantuan/potongan yang bisa ditanyakan di PMB.`,
      `Kalau konteksnya calon mahasiswa baru, ini pilihan beasiswa yang tersedia.`,
      `Saya tangkap pertanyaannya tentang bantuan biaya kuliah. ${assumption}`
    ];
  }

  return [
    `Saya pahami kakak menanyakan ${request}. ${assumption}`,
    `Saya coba jawab dari konteks ITB STIKOM Bali ya. ${assumption}`,
    `Untuk pertanyaan ini, saya fokus ke informasi ITB STIKOM Bali yang relevan.`,
    `Baik, saya jawab sesuai konteks pertanyaan kakak. ${assumption}`
  ];
}

function formatNaturalAnswerFrame(question, answer, source) {
  const body = String(answer || '').trim();
  if (!body) return body;
  if (/^(?:mohon\s+)?maaf\b/i.test(body)) return body;
  if (!envFlag('BOT_NATURAL_ANSWER_FRAME', true)) return body;
  const src = String(source || '').toLowerCase();
  if (src.includes('insufficient-data') || src.includes('safe-general') || src.includes('institution-vision-mission') || src.includes('student-concern') || src.includes('academic-schedule') || src.includes('academic-policy') || src.includes('small-talk') || src.includes('out-of-domain') || src.includes('feedback') || src.includes('unsupported-program') || src.includes('clarification') || src.includes('pmb-contact') || src.includes('pmb-requirements')) return body;
  if (src.includes('ukm') || src.includes('generic-faq-qna') || src.includes('training-specific') || src.includes('campus-support-entity') || src.includes('campus-facility')) return body;
  const q = String(question || '').toLowerCase();
  if (src.includes('rpl')) return body;
  if (src.includes('scholarship') && /\b(seluruh|semua|full|penuh|100\s*%)\b/i.test(q)) return body;
  if (/belum menemukan data biaya Program Double Degree untuk Teknologi Informasi/i.test(body)) return body;
  if (/\b(apa\s+kabar|apa\s+khabar|kabar\s+apa|khabar\s+apa|gimana\s+kabar|gimana\s+khabar|kabar\s+kamu|khabar\s+kamu|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar|bagaimana\s+khabar)\b/i.test(q)) return body;
  if (/^\s*(halo|hallo|hai|hi|hello|haloo|halooo|assalamualaikum|assalamu\s+alaikum|om\s+swastiastu|swastiastu|shalom|namo\s+buddhaya|nammo\s+buddhaya|salam\s+kebajikan|rahayu|salam\s+rahayu|salam|selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)\s*(kak|min|admin|tiko)?\s*$/i.test(String(question || '').trim())) return body;

  const questionText = String(question || '').trim();
  if (isEnglishQuestion(questionText)) {
    return body;
  }
  const topic = inferFrameTopic(question, source);
  const opener = pickVariant(question, source, buildFrameOpeners(question, source, topic));
  const opening = `${opener} ${topic.assumption}`.replace(/\s{2,}/g, ' ').trim();
  const parts = [opening, '', body];

  if (src.includes('fee')) return parts.join('\n').trim();

  const bodyAlreadyHasConclusion = /\n\s*(?:Jadi|Singkatnya|Kesimpulannya),|\n\s*Kesimpulan\s*:/i.test(body);
  if (!bodyAlreadyHasConclusion && topic.conclusion) {
    parts.push('', topic.conclusion);
  }

  const followups = buildContextualFollowups(topic.followups, question, body, source, topic);
  if (followups.length) {
    parts.push('', ['Kalau mau lanjut, kakak bisa tanya:', ...followups.map(item => `- ${item}`)].join('\n'));
  }

  return parts.join('\n').trim();
}

async function answerFromContexts(client, question, rewrite, contexts, options = {}) {
  const contextText = buildContextText(contexts);
  if (!client || !contextText.trim()) return null;
  const programHint = String(options && options.programHint ? options.programHint : '').trim();
  const intentHint = String(options && options.intentHint ? options.intentHint : '').trim();
  const prompt = [
    'Jawab pertanyaan user berdasarkan KONTEKS TRAINING saja.',
    'Kamu boleh memahami gaya bahasa user sebebas mungkin, tetapi fakta jawaban harus berasal dari konteks.',
    'Jika KONTEKS TRAINING berbentuk FAQ atau tanya-jawab, cocokkan makna pertanyaan user dengan pertanyaan FAQ, lalu berikan hanya bagian jawabannya. Jangan menyalin atau mengirim ulang teks pertanyaan FAQ kecuali user memang meminta daftar FAQ.',
    'Jika konteks tidak memuat jawaban yang cukup, jawab persis dengan token TIDAK_CUKUP_DATA lalu beri satu kalimat klarifikasi yang dibutuhkan.',
    'Jangan menyebut "training", "RAG", "chunk", atau metadata teknis kepada user.',
    'Jika ada angka/nominal/tanggal/syarat, jangan menebak dan jangan membulatkan di luar konteks.',
    'Jika user meminta "rincian", "detail", "lengkap", atau menanyakan biaya, jangan diringkas: sebutkan semua komponen relevan yang ada di konteks.',
    'Untuk biaya, pertahankan komponen resmi seperti pendaftaran, DPP/registrasi, atribut, biaya semester, potongan/beasiswa, dan catatan pembayaran jika tersedia.',
    'Gaya bahasa: Bahasa Indonesia percakapan sehari-hari yang sopan, halus, dan natural seperti chat admin kampus yang ramah.',
    'Jangan terdengar seperti template/formulir. Hindari pembuka berulang seperti "Saya pahami..." kalau tidak perlu.',
    'Jawab langsung ke inti, tetap rapi, dan gunakan "Kak" secara wajar.',
    '',
    programHint || intentHint ? `HINT SISTEM:\n${programHint ? `Program terkait: ${programHint}` : ''}${programHint && intentHint ? '\n' : ''}${intentHint ? `Intent terkait: ${intentHint}` : ''}` : 'HINT SISTEM: -',
    '',
    `PERTANYAAN ASLI:\n${question}`,
    '',
    `PERTANYAAN DIPAHAMI:\n${rewrite && rewrite.canonicalQuestion ? rewrite.canonicalQuestion : question}`,
    '',
    `KONTEKS TRAINING:\n${contextText}`
  ].join('\n');

  const completion = await client.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: 'You are a grounded campus assistant. Answer warmly in natural conversational Indonesian, using only supplied context.' },
      { role: 'user', content: prompt }
    ],
    max_completion_tokens: parseInt(process.env.OPENAI_SEMANTIC_RAG_MAX_OUTPUT_TOKENS || process.env.OPENAI_RAG_MAX_OUTPUT_TOKENS || '550', 10),
    temperature: Number(process.env.OPENAI_SEMANTIC_RAG_TEMPERATURE || '0.3'),
    top_p: Number(process.env.OPENAI_SEMANTIC_RAG_TOP_P || '0.8')
  });

  return String(completion && completion.choices && completion.choices[0] && completion.choices[0].message ? completion.choices[0].message.content || '' : '').trim();
}


function isInstitutionVisionMissionQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!/\b(visi|misi)\b/i.test(q)) return false;
  if (/\b(ukm|himaprodi|himpunan|bem|inbis|inkubator|career center|pusat karier|pusat karir|prodi|program studi)\b/i.test(q)) return false;
  return /\b(stikom bali|itb stikom|kampus|institut|lembaga)\b/i.test(q) || /^\s*(?:visi|misi)(?:\s+dan\s+misi)?(?:\s+apa)?\s*\??\s*$/i.test(q);
}

function tryInstitutionVisionMissionAnswer(question, indexForQuery) {
  if (!isInstitutionVisionMissionQuestion(question)) return null;
  const index = Array.isArray(indexForQuery) ? indexForQuery : [];
  const exclude = /\b(inkubator|inbis|ukm|ormawa|organisasi\s+mahasiswa|himaprodi|himpunan|bem|mapala|jcos|ksl|rade|basket|esport|paskamras|pasukan\s+keamanan|keamanan\s+acara|voice of stikom|student exchange|gccp)\b/i;
  const candidates = index
    .map((item) => String(item && item.chunk ? item.chunk : '').trim())
    .filter((chunk) => chunk && /\bvisi\s*(?:[::]|\r?\n)/i.test(chunk) && /\bmisi\s*(?:[::]|\r?\n)/i.test(chunk) && /\b(stikom bali|itb stikom|institut teknologi dan bisnis)\b/i.test(chunk) && !exclude.test(chunk) && !/\b(goes to school|unlock potential|sma\/?smk|latar belakang)\b/i.test(chunk));

  for (const chunk of candidates) {
    const compact = cleanUserVisibleRagAnswerText(chunk).replace(/\s+/g, ' ').trim();
    const parseText = compact.replace(/\bVisi\s*&\s*Misi\s+Institut\b/ig, '');
    const vision = /\bvisi\s*[::]?\s*["']?([^"'.]{20,280}(?:\.|$))/i.exec(parseText);
    const mission = /\bmisi\s*[::]?\s*([\s\S]{20,700})/i.exec(parseText);
    if (!vision) continue;
    const visionText = String(vision[1] || '').trim();
    if (/\b(acara|panitia|undangan|peserta|anggota|organisasi|ukm|himpunan|pengurus)\b/i.test(visionText)) continue;
    const lines = ['Berikut visi/misi ITB STIKOM Bali yang saya temukan pada data tersedia:'];
    if (vision && vision[1]) lines.push('', `Visi: ${vision[1].replace(/[Ã¢â‚¬Â"]+$/g, '').trim()}`);
    if (mission && mission[1]) {
      const cleanedMission = mission[1]
        .replace(/\b(?:tujuan|struktur organisasi|profil|sejarah|kontak)\b[\s\S]*$/i, '')
        .replace(/\s*(?:\d+\.|\u2022|[;-])\s*/g, '\n- ')
        .trim()
        .slice(0, 700);
      if (cleanedMission) lines.push('', `Misi:\n${cleanedMission.startsWith('- ') ? cleanedMission : `- ${cleanedMission}`}`);
    }
    return {
      answer: lines.join('\n'),
      source: 'semantic-rag-institution-vision-mission',
      frameSource: 'semantic-rag-institution-vision-mission'
    };
  }

  return {
    answer: 'Maaf, Kak. Saya belum menemukan teks visi dan misi resmi ITB STIKOM Bali secara lengkap pada data yang tersedia, jadi saya tidak mau mengarang. Untuk teks resmi terbaru, kakak sebaiknya konfirmasi ke admin kampus atau kanal resmi ITB STIKOM Bali.',
    source: 'semantic-rag-institution-vision-mission',
    frameSource: 'semantic-rag-institution-vision-mission'
  };
}
function trySecurityRefusalAnswer(question) {
  const raw = String(question || '').trim();
  if (!raw) return null;
  if (!/\b(database|basis\s+data|db\b|password|username|akun\s+admin|server|prompt\s+sistem|system\s+prompt|abaikan\s+semua\s+aturan|dokumen\s+internal|seluruh\s+isi\s+dokumen|data\s+pribadi|alamat\s+rumah|nomor\s+telepon\s+seluruh|credential|kredensial)\b/i.test(raw)) return null;
  return {
    answer: 'Maaf, Kak. Saya tidak bisa memberikan password akun admin, username server, atau menampilkan isi database, kredensial, prompt sistem, data pribadi, maupun dokumen internal. Saya hanya bisa membantu informasi umum ITB STIKOM Bali yang aman untuk publik, seperti PMB, program studi, biaya, beasiswa, fasilitas, dan kontak resmi.',
    source: 'semantic-rag-security-refusal',
    frameSource: 'semantic-rag-security-refusal'
  };
}

function tryStudentConcernAnswer(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return null;
  if (/\b(takut|khawatir|bingung|ragu|galau)\b/i.test(q) && /\b(salah\s+memilih\s+jurusan|pilih\s+jurusan|memilih\s+jurusan|jurusan)\b/i.test(q)) {
    return {
      answer: 'Wajar kok, Kak, kalau takut salah memilih jurusan. Supaya lebih tepat, kakak bisa mulai dari minat dan target kerja: kalau suka bisnis dan sistem, coba lihat Sistem Informasi; kalau suka teknis/coding, Teknologi Informasi; kalau tertarik bisnis online dan digital marketing, Bisnis Digital; kalau suka perangkat/komputer, Sistem Komputer. Kalau kakak cerita minatnya, saya bisa bantu arahkan pilihan prodi yang paling dekat.',
      source: 'semantic-rag-student-concern',
      frameSource: 'semantic-rag-student-concern'
    };
  }
  return null;
}
function trySafeGeneralCampusFallback(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return null;

  const contextualizeSafeFallback = (answer) => {
    const topic = raw.replace(/\s+/g, ' ').replace(/["'`]+/g, '').trim().slice(0, 140);
    if (!topic) return answer;
    const body = String(answer || '').replace(/^\s*/, '').replace(/^[A-Z]/, (m) => m.toLowerCase());
    return `Terkait pertanyaan kakak tentang ${topic}, ${body}`;
  };

  if (/\b(password\s+(?:akun\s+)?admin|username\s+dan\s+password|prompt\s+sistem|system\s+prompt|abaikan\s+semua\s+aturan|seluruh\s+isi\s+dokumen\s+internal|data\s+pribadi|alamat\s+rumah\s+dosen|nomor\s+telepon\s+seluruh\s+mahasiswa|penyaringan\s+dokumen|dokumen\s+legal)\b/i.test(raw)) {
    return { answer: contextualizeSafeFallback('maaf, Kak. Untuk permintaan password, username, alamat rumah, data pribadi, prompt sistem, aturan internal, atau dokumen internal/legal, saya tidak bisa membantu membukanya. Saya hanya bisa membantu informasi umum seputar ITB STIKOM Bali yang aman untuk calon mahasiswa dan publik.') };
  }

  if (/\b(hasil\s+pertandingan|sepak\s+bola|soal\s+matematika|tempat\s+wisata|isi\s+film|memperbaiki\s+motor|hukum\s+pidana|terjemahkan|arti\s+mimpi|berita\s+terbaru)\b/i.test(raw)) {
    return { answer: contextualizeSafeFallback('maaf, Kak. Untuk pertandingan sepak bola, soal matematika, tempat wisata, film terbaru, perbaikan motor, hukum pidana, terjemahan, arti mimpi, atau berita terbaru, saya tidak bisa membantu karena di luar domain kampus. Saya hanya bisa membantu informasi seputar ITB STIKOM Bali, seperti PMB, program studi, biaya, beasiswa, fasilitas, layanan kampus, dan kontak yang tersedia di data.') };
  }

  if (/\b(kamu\s+pintar|pintar\s+juga|selamat\s+bekerja|cuma\s+mau\s+menyapa)\b/i.test(raw)) {
    return { answer: contextualizeSafeFallback('terima kasih, Kak. Saya siap bantu kalau ada yang ingin ditanyakan seputar ITB STIKOM Bali.') };
  }

  if (/sistem\s+informasi[\s\S]{0,80}suka\s+bisnis|suka\s+bisnis[\s\S]{0,80}sistem\s+informasi/i.test(q)) {
    return { answer: contextualizeSafeFallback('Sistem Informasi cukup relevan untuk orang yang suka bisnis karena prodi ini menghubungkan kebutuhan bisnis, proses organisasi, dan solusi teknologi informasi. Untuk detail kurikulum dan prospek resminya, kakak bisa lanjut tanya Sistem Informasi atau konfirmasi ke admin PMB.') };
  }

  if (/dkv[\s\S]{0,80}(animasi|lama\s+kuliah)|berapa\s+lama[\s\S]{0,40}dkv/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk detail DKV seperti animasi atau lama kuliah, saya perlu hati-hati karena ketersediaan dan skema program harus dipastikan ke admin PMB. Secara umum, DKV berkaitan dengan desain komunikasi visual, sedangkan detail mata kuliah dan durasi resmi perlu konfirmasi kampus.') };
  }

  if (/dokumen[\s\S]{0,60}\bkip\b|\bkip\b[\s\S]{0,60}dokumen|hasil\s+program\s+1k1s|beasiswa\s+pertukaran\s+mahasiswa/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk detail beasiswa seperti dokumen KIP, hasil program 1K1S, atau beasiswa pertukaran mahasiswa, kakak perlu konfirmasi ke admin PMB/unit terkait agar mendapatkan syarat, jadwal, dan hasil resmi terbaru.') };
  }

  if (/biaya[\s\S]{0,80}double\s*degree[\s\S]{0,80}teknologi\s+informasi|double\s*degree[\s\S]{0,80}teknologi\s+informasi[\s\S]{0,80}gelombang/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk biaya Double Degree Teknologi Informasi, saya tidak akan menebak jika kombinasi prodi, partner, dan gelombangnya tidak tercatat jelas. Kakak bisa konfirmasi ke admin PMB agar mendapatkan rincian biaya Double Degree yang sesuai pilihan program.') };
  }
  if (/\b(takut\s+salah\s+memilih\s+jurusan|tertarik\s+dengan\s+program\s+itu|program\s+itu\s+tersedia|itu\s+sudah\s+termasuk\s+semuanya|yang\s+tadi\s+maksudnya\s+apa|apa\s+itu\??$)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('supaya saya tidak salah menangkap konteks, tuliskan dulu program atau topik yang dimaksud. Misalnya: Sistem Informasi, Teknologi Informasi, Bisnis Digital, biaya, jadwal PMB, beasiswa, atau fasilitas kampus.') };
  }

  if (/\b(menu|kemampuan\s+bot|bisa\s+bertanya\s+tentang\s+apa\s+saja|kembali\s+ke\s+menu|menu\s+utama|reset\s+percakapan)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('saya bisa bantu menu informasi seputar ITB STIKOM Bali: PMB dan cara daftar, jadwal gelombang, rincian biaya, program studi, beasiswa, Double Degree, fasilitas kampus, Career Center, Inkubator Bisnis, UKM, RPL, serta kontak kampus. Silakan ketik topik yang ingin kakak tanyakan.') };
  }

  if (/\b(apa\s+itu\s+itb\s+stikom\s+bali|keunggulan\s+(?:itb\s+)?stikom\s+bali|keunggulan\s+kuliah|campus\s+tour|terakreditasi|akreditasi\s+kampus)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('ITB STIKOM Bali adalah perguruan tinggi di Bali yang berfokus pada bidang teknologi informasi, bisnis digital, dan desain. Untuk detail resmi seperti akreditasi institusi, visi-misi, keunggulan kampus, atau agenda campus tour, kakak bisa konfirmasi ke admin/kampus agar mendapatkan informasi terbaru.') };
  }

  if (/\bapa\s+saja\s+tahapan\s+pendaftaran\s+mahasiswa\s+baru\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('tahapan pendaftaran mahasiswa baru biasanya mencakup:\n- mengisi data/form pendaftaran PMB\n- menyiapkan dokumen yang diminta\n- mengikuti proses seleksi atau tes jika dijadwalkan\n- melakukan registrasi ulang setelah dinyatakan lolos\nUntuk link aktif dan jadwal terbaru, kakak bisa konfirmasi ke admin PMB.') };
  }

  if (/\bapa\s+saja\s+persyaratan\s+pendaftaran\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('persyaratan pendaftaran biasanya berkaitan dengan:\n- identitas calon mahasiswa\n- dokumen sekolah seperti ijazah atau surat keterangan lulus jika masih proses\n- pas foto atau berkas pendukung lain jika diminta\n- pilihan program studi dan jalur/gelombang pendaftaran\nUntuk daftar dokumen resmi terbaru, kakak sebaiknya konfirmasi ke admin PMB.') };
  }

  if (/\bapa\s+saja\s+syarat\s+pengajuan\s+cuti\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('syarat pengajuan cuti adalah urusan akademik internal. Biasanya perlu memperhatikan:\n- status mahasiswa\n- periode pengajuan cuti\n- formulir atau surat permohonan\n- persetujuan unit akademik/prodi\nUntuk prosedur resmi dan dokumen final, kakak perlu menghubungi bagian akademik kampus.') };
  }

  if (/\bapa\s+saja\s+persyaratan\s+seminar\s+proposal\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('persyaratan seminar proposal adalah urusan akademik/prodi. Biasanya perlu memperhatikan:\n- status bimbingan tugas akhir\n- naskah proposal\n- persetujuan dosen pembimbing\n- jadwal dan ketentuan dari prodi\nUntuk syarat resmi terbaru, kakak perlu konfirmasi ke prodi atau bagian akademik.') };
  }

  if (/\bapa\s+saja\s+perlengkapan\s+wisuda\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('perlengkapan wisuda adalah informasi operasional wisuda. Biasanya berkaitan dengan:\n- toga atau atribut wisuda\n- kartu/undangan atau bukti pendaftaran wisuda\n- ketentuan pakaian\n- jadwal pengambilan perlengkapan\nUntuk daftar resmi dan jadwal pengambilan terbaru, kakak perlu konfirmasi ke panitia wisuda atau admin kampus.') };
  }
  if (/\b(link\s+pendaftar(?:an|annya)|penda[pf]taran\s+masih\s+buka|surat\s+keterangan\s+lulus|pas\s*foto|materi\s+tes|hasil\s+tes|lulus\s+tes|lulusan\s+tahun\s+sebelumnya|kelas\s+malam)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk pendaftaran mahasiswa baru, kakak bisa menanyakan jalur daftar, jadwal gelombang, syarat dokumen, biaya, dan kontak PMB. Untuk detail khusus seperti link aktif, hasil tes, kelas malam, pas foto, atau penggunaan surat keterangan lulus, sebaiknya konfirmasi ke admin PMB agar sesuai kondisi terbaru.') };
  }

  if (/\b(toefl|dua\s+ijazah|lama\s+program\s+double\s+degree|pendaftaran\s+double\s+degree|program\s+internasional|pertuk(?:a|ra)n\s+mahasiswa|pertukran\s+mahasiswa|kampus\s+luar\s+negeri|negara\s+mana\s+saja\s+yang\s+menjadi\s+tujuan\s+pertukaran|dokumen\s+keberangkatan|urusan\s+internasional)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk program internasional atau Double Degree, data aman yang tersedia dapat saya bantu jelaskan secara umum. Untuk syarat khusus seperti TOEFL, lama program, dua ijazah, jadwal pendaftaran, kampus mitra, negara tujuan pertukaran, atau dokumen keberangkatan, kakak perlu konfirmasi ke admin kampus/unit internasional.') };
  }

  if (/\b(studio\s+desain|tempat\s+ibadah|musala|mushola|ruang\s+kesehatan|lapangan\s+olahraga|meminjam\s+ruangan|peminjaman\s+ruangan|asrama|perpus(?:takaan)?\s+di\s+mana|fasilitas)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk fasilitas kampus, saya bisa bantu jelaskan fasilitas yang tercatat di data. Untuk detail operasional seperti ketersediaan ruangan, prosedur peminjaman, tempat ibadah, ruang kesehatan, lapangan, asrama, atau lokasi perpustakaan, kakak sebaiknya konfirmasi ke admin kampus.') };
  }

  if (/\b(kalender\s+akademik|melihat\s+nilai|khs|cuti|aktif\s+kembali|pindah\s+kelas|kartu\s+mahasiswa|masalah\s+akademik|reset\s+password|mereset\s+password|lupa\s+password|login\s+ke\s+sion|log\s+in\s+sion|akun\s+mahasiswa\s+.*terkunci|email\s+mahasiswa|nomor\s+telepon|e-?learning|unggah\s+tugas|mengunggah\s+tugas|tugas\s+.*gagal\s+diunggah|saya\s+tidak\s+bisa\s+masuk)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk layanan akademik atau IT support seperti SION, e-learning, nilai, KHS, cuti, kartu mahasiswa, reset password, akun terkunci, mengganti email atau nomor telepon, pindah kelas, dan unggah tugas, sebaiknya kakak menghubungi unit akademik/IT kampus. Saya tidak mengakses akun mahasiswa atau data akademik pribadi.') };
  }

  if (/\b(ukm|kegiatan\s+mahasiswa|poin\s+kegiatan|dana\s+kegiatan|ruangan\s+untuk\s+kegiatan|perundungan|pelecehan|masalah\s+dengan\s+teman|membantu\s+masalah\s+mahasiswa|konseling|perlindungan\s+mahasiswa|kemahasiswaan)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk urusan kemahasiswaan, UKM, kegiatan mahasiswa, konseling, atau pelaporan masalah mahasiswa, kakak bisa menghubungi bagian kemahasiswaan atau admin kampus. Saya bisa bantu info umum yang tersedia, tetapi detail prosedur internal perlu dikonfirmasi ke unit terkait.') };
  }

  if (/\b(mbkm|sks\s+yang\s+dapat\s+dikonversi|dikonversi\s+menjadi\s+sks|rpl|startup)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk MBKM, RPL, startup, atau Inkubator Bisnis, saya bisa bantu penjelasan umum berdasarkan data yang tersedia. Untuk syarat peserta, konversi SKS, cara daftar, dan PIC resmi, kakak sebaiknya konfirmasi ke admin kampus/unit terkait.') };
  }

  if (/\b(dosen\s+pembimbing|seminar\s+proposal|plagiarisme|surat\s+penelitian|surat\s+keterangan\s+lunas|yudisium|wisuda|alumni|ijazah|legalisir|surat\s+resmi|surat\s+rekomendasi|peminjaman\s+aula|proyektor|humas|kunjungan\s+sekolah|publikasi\s+kegiatan|berita\s+kegiatan|dokumentasi\s+kegiatan|nim)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk urusan administrasi kampus seperti skripsi, pembimbing, surat, yudisium, wisuda, ijazah, legalisir, fasilitas kelas, humas, publikasi, dokumentasi, atau NIM, kakak perlu menghubungi admin/unit terkait agar diarahkan sesuai prosedur terbaru.') };
  }

  if (/\b(teknologi\s+informsi|sistem\s+informsi)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('kalau yang kakak maksud adalah program studi Teknologi Informasi atau Sistem Informasi, saya bisa bantu jelaskan gambaran belajar, biaya, prospek kerja, dan perbedaannya. Silakan sebutkan prodi yang ingin dibahas agar jawabannya lebih tepat.') };
  }

  if (/\bbeasisiwa\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('kalau yang kakak maksud beasiswa, saya bisa bantu jelaskan jenis beasiswa atau potongan biaya yang tersedia berdasarkan data. Untuk syarat dan jadwal terbaru, sebaiknya tetap dikonfirmasi ke admin PMB.') };
  }

  if (/\bpenda[pf]taran\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk pendaftaran mahasiswa baru, kakak bisa menanyakan jadwal gelombang, cara daftar, syarat dokumen, biaya, dan kontak PMB. Untuk memastikan status pendaftaran terbaru, kakak bisa konfirmasi ke admin PMB ITB STIKOM Bali.') };
  }

  if (/\b(?:ti|bd|double\s*degree|dkv)\s+(?:brp|berapa)\??$/i.test(q)) {
    return { answer: contextualizeSafeFallback('kalau maksud kakak adalah biaya, saya bisa bantu cek rincian biaya berdasarkan prodi dan gelombang. Mohon tuliskan prodi lengkap dan gelombangnya, misalnya: biaya Teknologi Informasi Gelombang 1A.') };
  }

  if (/\b(dkv\s+dan\s+bisnis\s+digital|bisnis\s+digital\s+dan\s+dkv)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk perbandingan DKV dan Bisnis Digital, saya perlu hati-hati karena data prodi yang tersedia di ITB STIKOM Bali perlu dipastikan sesuai konteks program yang dimaksud. Secara umum, Bisnis Digital lebih dekat ke bisnis berbasis teknologi, sedangkan DKV berfokus pada desain komunikasi visual. Untuk pilihan prodi resmi yang tersedia, kakak bisa konfirmasi ke admin PMB.') };
  }

  if (/^(bagaimana\s+cara\s+mendaftarnya|bagaimana\s+prospek\s+kerjanya|siapa\s+yang\s+bisa\s+saya\s+hubungi|apa\s+itu)\??$/i.test(q)) {
    return { answer: contextualizeSafeFallback('pertanyaan itu masih butuh konteks supaya jawabannya tepat. Mohon sebutkan dulu topiknya, misalnya PMB, prodi tertentu, biaya, beasiswa, SION, e-learning, fasilitas, atau layanan kampus.') };
  }

  if (/\b(informasi\s+ini\s+masih\s+berlaku|jangan\s+mengarang|mengonfirmasi\s+informasi)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('saya akan menjawab berdasarkan data yang tersedia dan tidak menambahkan detail yang tidak aman. Untuk memastikan informasi terbaru, terutama jadwal, biaya, dan kebijakan kampus, kakak bisa konfirmasi ke admin resmi ITB STIKOM Bali.') };
  }

  return null;
}
// Preserve stable handler ordering: pre-AI conversational fallbacks first,
// then campus/support/training handlers, then fee and program handlers.
const DETERMINISTIC_HANDLERS = [
  ['semantic-rag-mixed-intent', tryMixedIntentAnswer],
  ['semantic-rag-small-talk', trySmallTalkAnswer],
  ['semantic-rag-org-structure-unavailable', tryOrganizationalStructureAnswer],
  ['semantic-rag-clarification', tryShortClarificationAnswer],
  ['semantic-rag-out-of-domain', tryOutOfDomainAnswer],
  ['semantic-rag-security-refusal', trySecurityRefusalAnswer],
  ['semantic-rag-student-concern', tryStudentConcernAnswer],
  ['semantic-rag-career-softskill', tryCareerCenterSoftskillAnswer],
  ['semantic-rag-unsupported-double-degree-partner', tryUnsupportedDoubleDegreePartnerAnswer],
  ['semantic-rag-known-faq-qna', tryKnownFaqQnaAnswer],
  ['semantic-rag-institution-vision-mission', tryInstitutionVisionMissionAnswer],
  ['semantic-rag-dual-degree-followup', tryDoubleDegreeFollowUpAnswer],
  ['semantic-rag-scholarship', tryScholarshipAnswer],
  ['semantic-rag-feedback', tryFeedbackAnswer],
  ['semantic-rag-unsupported-program', tryUnsupportedProgramAnswer],
  ['semantic-rag-pmb-contact', tryPmbContactAnswer],
  ['semantic-rag-pmb-requirements', tryPmbRequirementsAnswer],
  ['semantic-rag-rpl', tryRplAnswer],

  // Campus support and facility handlers (should be evaluated before generic program-list)
  ['semantic-rag-bem', tryBemAnswer],
  ['semantic-rag-campus-support-fallback', tryCampusSupportFallback],
  ['semantic-rag-campus-support-entity', tryCampusSupportEntityAnswer],
  ['semantic-rag-campus-facility', tryCampusFacilityAnswer],
  ['semantic-rag-generic-faq-qna', tryGenericFaqQnaAnswer],
  ['semantic-rag-career-fallback', tryCareerFallback],
  ['semantic-rag-billing-change-fallback', require('./billingFallback').tryBillingChangeFallback],
  ['semantic-rag-finance-fallback', tryFinanceFallback],
  ['semantic-rag-ukm-list', tryUkmAnswer],
  ['semantic-rag-contact-lecturer', tryContactLecturerAnswer],
  ['semantic-rag-graduation-registration', tryGraduationRegistrationAnswer],
  ['semantic-rag-academic-schedule', tryAcademicScheduleAnswer],
  ['semantic-rag-academic-krs', tryAcademicKrsAnswer],
  ['semantic-rag-academic-grade', tryAcademicGradeAnswer],
  ['semantic-rag-academic-transcript', tryAcademicTranscriptAnswer],
  ['semantic-rag-certification', tryCertificationAnswer],
  ['semantic-rag-training-specific', tryTrainingSpecificAnswer],
  ['semantic-rag-campus-location', tryCampusLocationAnswer],
  ['semantic-rag-thesis-fallback', tryThesisFallback],
  ['semantic-rag-international-class-fallback', tryInternationalClassFallback],

  // Registration / PMB / schedule handlers
  ['semantic-rag-academic-schedule', tryAcademicScheduleAnswer],
  ['semantic-rag-registration-data-correction', tryRegistrationDataCorrectionAnswer],
  ['semantic-rag-program-change', tryProgramChangeAnswer],
  ['semantic-rag-registration-info', tryRegistrationHowAnswer],
  ['semantic-rag-schedule-window', tryScheduleWindowAnswer],
  ['semantic-rag-current-open-waves', tryCurrentOpenWavesAnswer],
  ['semantic-rag-pmb-info', tryPmbInfoAnswer],

  // Fee-related handlers
  ['semantic-rag-registration-fee', tryRegistrationFeeAnswer],
  ['semantic-rag-fee-detail', tryDetailedFeeAnswer],
  ['semantic-rag-contextual-fee', tryContextualMultiProgramFeeAnswer],
  ['semantic-rag-fee-general', tryGeneralFeeQuestionAnswer],
  ['semantic-rag-fee-comparison', tryFeeComparisonAnswer],
  ['semantic-rag-fee-fallback', tryFeeFallback],

  // Program and career handlers
  ['semantic-rag-dual-degree', tryDualDegreeAnswer],
  ['semantic-rag-program-recommendation', tryProgramRecommendationAnswer],
  ['semantic-rag-program-comparison', tryProgramComparisonAnswer],
  ['semantic-rag-program-list', tryProgramListAnswer],
  ['semantic-rag-career', tryCareerAnswer],
  ['semantic-rag-program-definition', tryProgramDefinitionAnswer],
  ['semantic-rag-safe-general-fallback', trySafeGeneralCampusFallback],

  // LinkedIn career/no-data fallback should be considered late but available
  ['semantic-rag-linkedin-career-insufficient-data', tryLinkedInCareerCenterNoDataAnswer]
];

const HANDLERS_BY_SOURCE = new Map(DETERMINISTIC_HANDLERS);
// Only handlers that truly require the RAG/index should request it.
const SOURCES_NEEDING_INDEX = new Set([
  // Fee handlers need index for structured fee and program matching
  'semantic-rag-registration-fee',
  'semantic-rag-fee-detail',
  'semantic-rag-fee-general',
  'semantic-rag-contextual-fee',
  'semantic-rag-fee-comparison',
  // Training-specific and campus facility/entity handlers need index
  'semantic-rag-training-specific',
  'semantic-rag-generic-faq-qna',
  'semantic-rag-campus-facility',
  'semantic-rag-campus-support-entity',
  'semantic-rag-institution-vision-mission',
  // UKM and campus location queries rely on indexed training/facility data
  'semantic-rag-ukm-list',
  'semantic-rag-campus-location'
]);
const PRE_AI_HANDLER_SOURCES = new Set([
  'semantic-rag-mixed-intent',
  'semantic-rag-small-talk',
  'semantic-rag-out-of-domain',
  'semantic-rag-security-refusal',
  'semantic-rag-student-concern',
  'semantic-rag-career-softskill',
  'semantic-rag-unsupported-double-degree-partner',
  'semantic-rag-known-faq-qna',
  'semantic-rag-generic-faq-qna',
  'semantic-rag-campus-support-entity',
  'semantic-rag-dual-degree-followup',
  'semantic-rag-dual-degree',
  'semantic-rag-unsupported-program',
  // lightweight PMB/schedule handlers that do not require index
  'semantic-rag-academic-schedule',
  'semantic-rag-schedule-window',
  'semantic-rag-current-open-waves',
  'semantic-rag-registration-info',
  'semantic-rag-registration-data-correction',
  'semantic-rag-program-change',
  'semantic-rag-pmb-contact',
  'semantic-rag-pmb-info',
  'semantic-rag-pmb-requirements',
  'semantic-rag-rpl',
  'semantic-rag-scholarship',
  'semantic-rag-program-definition',
  // specific operational/academic handlers that should run before generic registration
  'semantic-rag-graduation-registration',
  'semantic-rag-academic-grade',
  'semantic-rag-certification'
]);
const PRE_REWRITE_HANDLER_SOURCES = new Set([
  'semantic-rag-campus-support-entity',
  'semantic-rag-campus-facility',
  'semantic-rag-bem',
  'semantic-rag-ukm-list',
  'semantic-rag-contact-lecturer',
  'semantic-rag-academic-schedule',
  'semantic-rag-academic-krs',
  'semantic-rag-academic-transcript',
  'semantic-rag-registration-data-correction',
  'semantic-rag-program-change',
  'semantic-rag-training-specific',
  'semantic-rag-campus-location'
]);

function handlersForSources(sourceNames) {
  const out = [];
  const seen = new Set();
  for (const source of Array.isArray(sourceNames) ? sourceNames : []) {
    if (seen.has(source)) continue;
    const handler = HANDLERS_BY_SOURCE.get(source);
    if (!handler) continue;
    seen.add(source);
    out.push([source, handler]);
  }
  return out;
}

function getSemanticHandlerSources(intent) {
  const map = {
    registration_fee: [
      'semantic-rag-registration-fee',
      'semantic-rag-fee-detail',
      'semantic-rag-fee-general'
    ],
    fee_detail: [
      'semantic-rag-fee-detail',
      'semantic-rag-registration-fee',
      'semantic-rag-contextual-fee',
      'semantic-rag-fee-general',
      'semantic-rag-fee-comparison'
    ],
    fee_general: [
      'semantic-rag-finance-fallback',
      'semantic-rag-fee-general',
      'semantic-rag-fee-detail',
      'semantic-rag-registration-fee',
      'semantic-rag-contextual-fee'
    ],
    fee_comparison: [
      'semantic-rag-contextual-fee',
      'semantic-rag-fee-comparison',
      'semantic-rag-fee-general'
    ],
    current_wave: [
      'semantic-rag-current-open-waves',
      'semantic-rag-schedule-window',
      'semantic-rag-registration-info'
    ],
    schedule_window: [
      'semantic-rag-schedule-window',
      'semantic-rag-current-open-waves'
    ],
    registration_how: [
      'semantic-rag-registration-info',
      'semantic-rag-pmb-contact',
      'semantic-rag-pmb-info'
    ],
    pmb_overview: [
      'semantic-rag-pmb-info',
      'semantic-rag-current-open-waves',
      'semantic-rag-schedule-window'
    ],
    requirements: [
      'semantic-rag-pmb-requirements',
      'semantic-rag-registration-info'
    ],
    contact: [
      'semantic-rag-pmb-contact',
      'semantic-rag-registration-info'
    ],
    scholarship: [
      'semantic-rag-scholarship'
    ],
    program_list: [
      'semantic-rag-program-list',
      'semantic-rag-dual-degree'
    ],
    program_definition: [
      'semantic-rag-program-definition',
      'semantic-rag-program-list'
    ],
    program_comparison: [
      'semantic-rag-program-comparison',
      'semantic-rag-program-definition',
      'semantic-rag-program-list'
    ],
    program_recommendation: [
      'semantic-rag-program-recommendation',
      'semantic-rag-career',
      'semantic-rag-program-definition'
    ],
    career: [
      'semantic-rag-career',
      'semantic-rag-program-recommendation',
      'semantic-rag-program-definition'
    ],
    campus_location: [
      'semantic-rag-campus-location'
    ],
    ukm: [
      'semantic-rag-bem',
      'semantic-rag-ukm-list'
    ],
    dual_degree: [
      'semantic-rag-dual-degree',
      'semantic-rag-program-list'
    ],
    feedback: [
      'semantic-rag-feedback'
    ],
    small_talk: [
      'semantic-rag-small-talk'
    ],
    out_of_domain: [
      'semantic-rag-out-of-domain'
    ]
  };
  return map[intent] || [];
}

function buildDeterministicResponse(originalQuestion, source, result, debugExtra = {}) {
  const finalSource = result && result.source ? result.source : source;
  const frameSource = result && result.frameSource ? result.frameSource : finalSource;
  return {
    success: true,
    answer: formatNaturalAnswerFrame(originalQuestion, result.answer, frameSource),
    source: finalSource,
    contexts: [],
    confidenceScore: 1,
    confidenceTier: 'HIGH',
    debug: {
      ...debugExtra,
      handlerSource: source,
      ...(result && typeof result === 'object' ? result : {})
    }
  };
}

function runDeterministicHandlers(originalQuestion, handlers, options = {}, variants = [], debugExtra = {}) {
  const questions = uniqueList([...(Array.isArray(variants) ? variants : []), originalQuestion], 8);
  const debugTrace = envFlag('DEBUG_SEMANTIC_HANDLER_TRACE', false);
  if (debugTrace) {
    console.log('[TRACE runDeterministicHandlers] START', {
      originalQuestion,
      handlersCount: handlers.length,
      handlerSources: handlers.map(([s]) => s),
      variants: questions,
      debugExtra
    });
  }
  // Lazy-load the index at most once per query, only if any handler needs it.
  let handlerIndexLoaded = false;
  let handlerIndex = undefined;
  for (const [source, handler] of Array.isArray(handlers) ? handlers : []) {
    const needIndex = SOURCES_NEEDING_INDEX.has(source);
    if (debugTrace) {
      console.log('[TRACE runDeterministicHandlers] Trying handler:', source, 'needIndex:', needIndex);
    }
    for (const variant of questions) {
      let indexArg = undefined;
      if (needIndex) {
        if (!handlerIndexLoaded) {
          handlerIndex = getCachedSemanticIndex();
          handlerIndexLoaded = true;
        }
        indexArg = handlerIndex;
      }
      const result = handler(variant, indexArg, { ...options, originalQuestion });
      if (debugTrace) {
        console.log('[TRACE runDeterministicHandlers] Handler result:', {
          source,
          variant,
          hasResult: !!result,
          hasAnswer: !!(result && result.answer),
          answerPreview: result && result.answer ? String(result.answer).slice(0, 100) : null
        });
      }
      if (result && result.answer) {
        const built = buildDeterministicResponse(originalQuestion, source, result, {
          ...debugExtra,
          semanticVariant: variant !== String(originalQuestion || '').trim() ? variant : undefined
        });
        if (debugTrace) {
          console.log('[TRACE runDeterministicHandlers] RETURNING from handler:', {
            source,
            builtSource: built.source,
            builtAnswerPreview: String(built.answer).slice(0, 100)
          });
        }
        return built;
      }
    }
  }
  if (debugTrace) {
    console.log('[TRACE runDeterministicHandlers] END - no handler matched');
  }
  return null;
}

function shouldUseSemanticDeterministicRoute(rewrite) {
  if (!rewrite || rewrite.intent === 'unknown') return false;
  const confidence = Number.isFinite(Number(rewrite.confidence)) ? Number(rewrite.confidence) : 0;
  const minConfidence = Number(process.env.SEMANTIC_INTENT_MIN_CONFIDENCE || '0.45');
  return confidence >= minConfidence || envFlag('SEMANTIC_INTENT_ALLOW_LOW_CONFIDENCE', false);
}

function shouldPreferTrainingBeforeDeterministic(rewrite) {
  if (!rewrite || rewrite.intent !== 'dual_degree') return false;
  return envFlag('SEMANTIC_RAG_PREFER_TRAINING_FOR_DUAL_DEGREE', true);
}

function buildInsufficientDataAnswer(kind = 'very_low') {
  if (kind === 'low') {
    return 'Saya ragu apakah saya mempunyai cukup data untuk menjawab pertanyaan anda. Tapi akan saya coba menjawab.';
  }
  return 'Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi, untuk menjawab pertanyaan anda. Mungkin anda bisa mengubah pertanyaannya atau menanyakan hal lain yang ingin diketahui.';
}

function tryShortProgramDefinitionDirectAnswer(question) {
  const q = String(question || '').trim();
  if (!q) return null;
  const normalized = q.toLowerCase();
  const asksDefinitionShape = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(normalized);
  const mentionsProgramKey = /\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi)\b/i.test(normalized);
  if (!asksDefinitionShape || !mentionsProgramKey) return null;
  const result = tryProgramDefinitionAnswer(q);
  if (!result || !result.answer) return null;
  return buildDeterministicResponse(q, 'semantic-rag-program-definition', result, {
    routeStage: 'short-definition-direct'
  });
}

function isUnsafeDeterministicFallback(question, result, rewrite = null) {
  if (!result || !result.answer) return false;
  const q = String(question || '').toLowerCase();
  const source = String(result.source || '').toLowerCase();
  const intent = String(rewrite && rewrite.intent ? rewrite.intent : '').toLowerCase();
  const answer = String(result.answer || '').toLowerCase();

  const supportEntity = findCampusSupportEntity(q);
  const mentionsLinkedinCareer = /\b(linked\s*in|linkedin|career\s*center|karir\s*center|pusat\s*karir)\b/i.test(q);
  const asksRegistration = /\b(daftar|mendaftar|pendaftaran|registrasi|ikut|mengikuti)\b/i.test(q);
  const asksAdmissionRegistration = /\b(pmb|kuliah|calon\s+mahasiswa|mahasiswa\s+baru|camaba|siap\.stikom-bali\.ac\.id|stikom|itb\s*stikom)\b/i.test(q);
  if (source.includes('registration-info') && asksRegistration && supportEntity && !asksAdmissionRegistration) return true;
  if (source.includes('registration-info') && asksRegistration && mentionsLinkedinCareer && !asksAdmissionRegistration) return true;
  if (source.includes('registration-info') && /\bdaftar\s+kuliah\b/i.test(answer) && (supportEntity || mentionsLinkedinCareer)) return true;

  if (source.includes('program-list') && supportEntity && ['international_program', 'facility_program', 'facility'].includes(supportEntity.type)) return true;
  if (source.includes('program-list') && /\b(bccp|short\s*course|student\s*exchange|students\s*exchange|exchange\s+program|pertukaran\s+mahasiswa)\b/i.test(q)) return true;
  if (source.includes('program-list') && intent && !['program_list', 'dual_degree'].includes(intent)) return true;

  if (source.includes('ukm-list') && !/^maaf\b/i.test(answer)) {
    const asksSpecificUkmDetail = /\b(apa\s+itu|maksud(?:nya)?|kepanjangan|singkatan|kegiatan(?:nya)?|aktivitas(?:nya)?|program\s+kerja|proker|jadwal|latihan|tujuan|detail|tentang)\b/i.test(q);
    if (asksSpecificUkmDetail && /\b(ukm|ormawa|vos|musik|tari|tabuh|teater|basket|futsal|syntax|progress)\b/i.test(q)) return true;
  }

  return false;
}

function runVettedDeterministicFallback(question, options, rewrite, routeStage) {
  const generalFallbackHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => !PRE_AI_HANDLER_SOURCES.has(source));
  const result = runDeterministicHandlers(question, generalFallbackHandlers, { ...options, semanticRewrite: rewrite }, buildSemanticRoutingQuestions(question, rewrite), {
    routeStage,
    rewrite
  });
  if (!result || isUnsafeDeterministicFallback(question, result, rewrite)) return null;
  return result;
}
async function querySemanticRag(question, options = {}) {
  const resultCacheKey = buildSemanticResultCacheKey(question, options);
  const cachedResult = getCachedSemanticResult(resultCacheKey);
  if (cachedResult) return cachedResult;

  if (isRawDocumentLeakComplaint(question)) {
    const response = { success: true, answer: buildRawDocumentLeakComplaintAnswer(), source: 'semantic-rag-raw-document-leak-feedback', contexts: [] };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  if (isOperationalAcademicPolicyQuestion(question)) {
    const response = { success: true, answer: buildAcademicPolicyNoDataAnswer(question), source: 'semantic-rag-operational-academic-policy-no-answer', contexts: [] };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }


  if (/\b(indikator|pertanggung\s*jawab(?:an)?|dipertanggung\s*jawabkan|institusi\s+pendidikan|akuntabilitas|kinerja\s+institusi)\b/i.test(String(question || ''))) {
    const response = { success: true, answer: 'Saya belum menemukan rincian indikator pertanggungjawaban institusi pendidikan ITB STIKOM Bali yang cukup aman pada data yang tersedia. Agar tidak keliru, indikator resmi seperti akreditasi, mutu akademik, tata kelola, layanan, atau pelaporan institusi sebaiknya dikonfirmasi ke pihak kampus/unit terkait.', source: 'semantic-rag-institution-indicator-insufficient-data', contexts: [] };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  if (/\b(pks|pasal\s+\d+|addendum|pihak\s+(?:pertama|kedua|kesatu)|nama\s+mitra|template\s+pks|perjanjian\s+kerja\s*sama)\b/i.test(String(question || ''))) {
    const response = { success: true, answer: null, source: 'semantic-rag-admin-legal-no-answer', contexts: [] };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  const strictDocumentOnly = isStrictDocumentOnlyMode();
  const fallbacksAllowed = !strictDocumentOnly;
  const shortDefinitionResponse = strictDocumentOnly ? null : tryShortProgramDefinitionDirectAnswer(question);
  if (shortDefinitionResponse) {
    setCachedSemanticResult(resultCacheKey, shortDefinitionResponse);
    return shortDefinitionResponse;
  }
  const financeOperationalResult = strictDocumentOnly ? null : tryFinanceFallback(question);
  if (financeOperationalResult && financeOperationalResult.answer) {
    const builtFinanceResult = buildDeterministicResponse(question, 'semantic-rag-finance-fallback', financeOperationalResult, { routeStage: 'pre-ai-finance' });
    setCachedSemanticResult(resultCacheKey, builtFinanceResult);
    return builtFinanceResult;
  }

  const hasDirectFeeSignal = /\b(?:biaya(?:nya)?|harga(?:nya)?|tarif|ongkos|bayar|uang|dpp|ukt|semester|pendaftaran|registrasi|fee|fees|cost|costs|tuition|payment|payments|berapa)\b/i.test(String(question || ''));
  if (!strictDocumentOnly && hasDirectFeeSignal) {
    const feeResult = tryDetailedFeeAnswer(question, getCachedSemanticIndex(), options);
    if (feeResult && feeResult.answer) {
      const builtFeeResult = buildDeterministicResponse(question, 'semantic-rag-fee-detail', feeResult, { routeStage: 'pre-ai-fee' });
      setCachedSemanticResult(resultCacheKey, builtFeeResult);
      return builtFeeResult;
    }
  }

  const preAiHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_AI_HANDLER_SOURCES.has(source));
  const debugTrace = envFlag('DEBUG_SEMANTIC_HANDLER_TRACE', false);
  if (debugTrace) {
    console.log('[TRACE STRICT] strictDocumentOnly:', strictDocumentOnly);
    console.log('[TRACE PRE_AI] handlers:', preAiHandlers.map(([s]) => s));
    console.log('[TRACE PRE_AI] question:', question);
    console.log('[TRACE PRE_AI] PRE_AI_HANDLER_SOURCES membership check:', {
      'semantic-rag-graduation-registration': PRE_AI_HANDLER_SOURCES.has('semantic-rag-graduation-registration'),
      'semantic-rag-academic-grade': PRE_AI_HANDLER_SOURCES.has('semantic-rag-academic-grade'),
      'semantic-rag-certification': PRE_AI_HANDLER_SOURCES.has('semantic-rag-certification')
    });
  }
  const preAiResult = strictDocumentOnly ? null : runDeterministicHandlers(question, preAiHandlers, options, [question], { routeStage: 'pre-ai' });
  if (debugTrace) {
    console.log('[TRACE PRE_AI] result from runDeterministicHandlers:', {
      hasResult: !!preAiResult,
      source: preAiResult ? preAiResult.source : null,
      answerPreview: preAiResult ? String(preAiResult.answer).slice(0, 100) : null
    });
  }
  if (preAiResult) {
    if (debugTrace) {
      console.log('[TRACE PRE_AI] CACHING and RETURNING preAiResult:', {
        source: preAiResult.source,
        answerPreview: String(preAiResult.answer).slice(0, 100)
      });
    }
    setCachedSemanticResult(resultCacheKey, preAiResult);
    return preAiResult;
  }

  const preRewriteHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_REWRITE_HANDLER_SOURCES.has(source));
  const preRewriteResult = strictDocumentOnly ? null : runDeterministicHandlers(question, preRewriteHandlers, options, [question], { routeStage: 'pre-rewrite' });
  if (debugTrace) {
    console.log('[TRACE PRE_REWRITE] result:', {
      hasResult: !!preRewriteResult,
      source: preRewriteResult ? preRewriteResult.source : null
    });
  }
  if (preRewriteResult) {
    if (debugTrace) {
      console.log('[TRACE PRE_REWRITE] CACHING and RETURNING preRewriteResult');
    }
    setCachedSemanticResult(resultCacheKey, preRewriteResult);
    return preRewriteResult;
  }

  // (index-first deterministic pass removed - rely on semantic routing and
  // retriever flow to decide deterministic handlers after rewrite and RAG)

  const client = getClient();
  if (!client) {
    if (strictDocumentOnly) {
      const response = {
        success: true,
        answer: null,
        source: 'semantic-rag-disabled',
        reason: 'missing_openai_api_key',
        contexts: [],
        debug: { strictDocumentOnly: true }
      };
      setCachedSemanticResult(resultCacheKey, response);
      return response;
    }
    await getActiveTrainingDataFromDb();
    if (isInstitutionVisionMissionQuestion(question)) {
      try {
        const localRetrieved = await retrieveSemanticContexts([question], { topK: options.topK, question, intent: detectGenericIntent(question) });
        const localVisionMission = tryInstitutionVisionMissionAnswer(question, localRetrieved.contexts);
        if (localVisionMission && localVisionMission.answer && !/^Maaf, Kak\. Saya belum menemukan/i.test(localVisionMission.answer)) {
          const builtLocalVisionMission = buildDeterministicResponse(question, 'semantic-rag-institution-vision-mission', localVisionMission, { routeStage: 'fallback-no-ai-rag' });
          setCachedSemanticResult(resultCacheKey, builtLocalVisionMission);
          return builtLocalVisionMission;
        }
      } catch (e) {
        logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] no-ai local RAG fallback failed');
      }
    }
    const fallbackResult = runDeterministicHandlers(question, DETERMINISTIC_HANDLERS, options, [question], { routeStage: 'fallback-no-ai' });
    if (fallbackResult) {
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    return { success: true, answer: null, source: 'semantic-rag-disabled', reason: 'missing_openai_api_key', contexts: [] };
  }

  let rewrite = await rewriteQuestionWithLlm(client, question, {
    sessionData: options.sessionData || null,
    programHint: options.programHint || '',
    intentHint: options.intentHint || ''
  });

  const programHint = String(options.programHint || '').trim();
  if (rewrite.needsClarification && programHint) {
    const current = String(question || '').trim();
    const lower = current.toLowerCase();
    let topic = 'informasi';
    if (lower.includes('prospek') || lower.includes('kerja') || lower.includes('karir') || lower.includes('karier')) {
      topic = 'prospek kerja';
    } else if (lower.includes('biaya') || lower.includes('harga') || lower.includes('tarif') || lower.includes('bayar') || lower.includes('dpp') || lower.includes('ukt') || lower.includes('gelombang')) {
      topic = 'rincian biaya';
    } else if (lower.includes('akreditasi')) {
      topic = 'akreditasi';
    } else if (lower.includes('apa') || lower.includes('itu') || lower.includes('pengertian')) {
      topic = 'definisi';
    }
    const canonicalQuestion = `${topic} Program Studi ${programHint}`;
    rewrite = {
      canonicalQuestion,
      searchQueries: uniqueList([
        canonicalQuestion,
        `Program Studi ${programHint}`,
        `${programHint} ${topic}`,
        current
      ], 4),
      intent: normalizeSemanticIntent(topic.includes('biaya') ? 'fee_detail' : (topic.includes('prospek') ? 'career' : 'unknown')),
      entities: { programs: [programHint] },
      confidence: 0.8,
      needsClarification: false,
      clarificationQuestion: ''
    };
  }

  if (rewrite.needsClarification && rewrite.clarificationQuestion) {
    if (isGenericSemanticClarification(question, rewrite.clarificationQuestion)) {
      const response = {
        success: true,
        answer: null,
        source: 'semantic-rag-clarify-suppressed',
        contexts: [],
        debug: { rewrite, reason: 'generic_or_unsupported_clarification' }
      };
      setCachedSemanticResult(resultCacheKey, response);
      return response;
    }

    const response = {
      success: true,
      answer: rewrite.clarificationQuestion,
      source: 'semantic-rag-clarify',
      contexts: [],
      debug: { rewrite }
    };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  const semanticRouteEnabled = shouldUseSemanticDeterministicRoute(rewrite) && !strictDocumentOnly;
  const preferTrainingFirst = semanticRouteEnabled && shouldPreferTrainingBeforeDeterministic(rewrite);
  const runSemanticDeterministicRoute = (routeStage = 'ai-intent') => {
    if (!semanticRouteEnabled) return null;
    const semanticSources = getSemanticHandlerSources(rewrite.intent);
    const semanticHandlers = handlersForSources(semanticSources);
    const semanticQuestions = buildSemanticRoutingQuestions(question, rewrite);
    const result = runDeterministicHandlers(question, semanticHandlers, { ...options, semanticRewrite: rewrite }, semanticQuestions, {
      routeStage,
      rewrite,
      trainingFirst: preferTrainingFirst || undefined
    });
    if (result && isUnsafeDeterministicFallback(question, result, rewrite)) return null;
    return result;
  };

  if (semanticRouteEnabled && !preferTrainingFirst) {
    if (debugTrace) {
      console.log('[TRACE SEMANTIC_ROUTE] Running ai-intent route');
    }
    const routedResult = runSemanticDeterministicRoute('ai-intent');
    if (debugTrace) {
      console.log('[TRACE SEMANTIC_ROUTE] ai-intent result:', {
        hasResult: !!routedResult,
        source: routedResult ? routedResult.source : null
      });
    }
    if (routedResult) {
      if (debugTrace) {
        console.log('[TRACE SEMANTIC_ROUTE] CACHING and RETURNING routedResult');
      }
      setCachedSemanticResult(resultCacheKey, routedResult);
      return routedResult;
    }
  }


  const retrieved = await retrieveSemanticContexts(rewrite.searchQueries, { topK: options.topK, question, intent: rewrite.intent });
  const minScoreRaw = Number(process.env.SEMANTIC_RAG_MIN_SCORE || '0.18');
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0.18;
  
  // Apply generic evidence selection to filter and rank contexts
  let selectedEvidence = [];
  if (retrieved.contexts.length > 0) {
    try {
      selectedEvidence = selectEvidenceFromContexts({ question, contexts: retrieved.contexts, intent: rewrite.intent, maxEvidence: 5 });
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] evidence selector failed, using raw contexts');
      selectedEvidence = retrieved.contexts.map(ctx => ({
        text: ctx.chunk,
        source: ctx.filename || ctx.sourceFile || 'unknown',
        sourceId: ctx.id || ctx.trainingId || 'unknown',
        score: ctx.score || 0,
        isSelectedEvidence: true
      }));
    }
  }
  
  // Evaluate generic answerability of selected evidence
  let answerabilityResult = null;
  if (selectedEvidence.length > 0) {
    try {
      answerabilityResult = evaluateEvidenceAnswerability({ question, selectedEvidence, intent: rewrite.intent });
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] evidence answerability evaluation failed, proceeding with generation');
    }
  }
  
  if (!selectedEvidence.length) {
    if (debugTrace) {
      console.log('[TRACE RAG_NO_CONTEXT] No evidence selected, running fallbacks');
    }
    if (isStrictDocumentOnlyMode()) {
      const veryLowThresholdRaw = Number(process.env.SEMANTIC_RAG_VERY_LOW_SCORE || '0.12');
      const veryLowThreshold = Number.isFinite(veryLowThresholdRaw) ? veryLowThresholdRaw : 0.12;
      const noContextResult = {
        success: true,
        answer: buildInsufficientDataAnswer(retrieved.topScore >= veryLowThreshold ? 'low' : 'very_low'),
        source: 'semantic-rag-no-context',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        confidenceTier: retrieved.topScore >= veryLowThreshold ? 'LOW' : 'VERY_LOW',
        debug: { rewrite, minScore, veryLowThreshold, indexSize: retrieved.indexSize, answerabilityResult, strictDocumentOnly: true }
      };
      if (debugTrace) {
        console.log('[TRACE RAG_NO_CONTEXT] STRICT_DOCUMENT_ONLY returning no-context result');
      }
      return noContextResult;
    }
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-no-context') : null;
    if (debugTrace) {
      console.log('[TRACE RAG_NO_CONTEXT] preferTrainingFirst fallback:', {
        hasResult: !!fallbackResult,
        source: fallbackResult ? fallbackResult.source : null
      });
    }
    if (fallbackResult) {
      if (debugTrace) {
        console.log('[TRACE RAG_NO_CONTEXT] CACHING and RETURNING fallbackResult');
      }
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-no-context-deterministic-fallback');
    if (debugTrace) {
      console.log('[TRACE RAG_NO_CONTEXT] generalFallbackResult:', {
        hasResult: !!generalFallbackResult,
        source: generalFallbackResult ? generalFallbackResult.source : null
      });
    }
    if (generalFallbackResult) {
      if (debugTrace) {
        console.log('[TRACE RAG_NO_CONTEXT] CACHING and RETURNING generalFallbackResult');
      }
      setCachedSemanticResult(resultCacheKey, generalFallbackResult);
      return generalFallbackResult;
    }
    const veryLowThresholdRaw = Number(process.env.SEMANTIC_RAG_VERY_LOW_SCORE || '0.12');
    const veryLowThreshold = Number.isFinite(veryLowThresholdRaw) ? veryLowThresholdRaw : 0.12;
    const noContextResult = {
      success: true,
      answer: buildInsufficientDataAnswer(retrieved.topScore >= veryLowThreshold ? 'low' : 'very_low'),
      source: 'semantic-rag-no-context',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      confidenceTier: retrieved.topScore >= veryLowThreshold ? 'LOW' : 'VERY_LOW',
      debug: { rewrite, minScore, veryLowThreshold, indexSize: retrieved.indexSize, answerabilityResult }
    };
    if (debugTrace) {
      console.log('[TRACE RAG_NO_CONTEXT] RETURNING no-context result');
    }
    return noContextResult;
  }

  // Check answerability before generation
  if (answerabilityResult && !answerabilityResult.answerable) {
    if (debugTrace) {
      console.log('[TRACE UNANSWERABLE] Evidence not answerable, running fallbacks');
    }
    if (strictDocumentOnly) {
      const insufficientAnswer = buildSpecificInsufficientDataAnswer(question, answerabilityResult.missingEvidence);
      const unanswerableResult = {
        success: true,
        answer: insufficientAnswer,
        source: 'semantic-rag-unanswerable',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        confidenceTier: 'LOW',
        debug: { rewrite, answerabilityResult, strictDocumentOnly: true }
      };
      if (debugTrace) {
        console.log('[TRACE UNANSWERABLE] STRICT_DOCUMENT_ONLY returning unanswerable result');
      }
      return unanswerableResult;
    }
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-unanswerable') : null;
    if (debugTrace) {
      console.log('[TRACE UNANSWERABLE] preferTrainingFirst fallback:', {
        hasResult: !!fallbackResult,
        source: fallbackResult ? fallbackResult.source : null
      });
    }
    if (fallbackResult) {
      if (debugTrace) {
        console.log('[TRACE UNANSWERABLE] CACHING and RETURNING fallbackResult');
      }
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-unanswerable-deterministic-fallback');
    if (debugTrace) {
      console.log('[TRACE UNANSWERABLE] generalFallbackResult:', {
        hasResult: !!generalFallbackResult,
        source: generalFallbackResult ? generalFallbackResult.source : null
      });
    }
    if (generalFallbackResult) {
      if (debugTrace) {
        console.log('[TRACE UNANSWERABLE] CACHING and RETURNING generalFallbackResult');
      }
      setCachedSemanticResult(resultCacheKey, generalFallbackResult);
      return generalFallbackResult;
    }
    const insufficientAnswer = buildSpecificInsufficientDataAnswer(question, answerabilityResult.missingEvidence);
    const unanswerableResult = {
      success: true,
      answer: insufficientAnswer,
      source: 'semantic-rag-unanswerable',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      confidenceTier: 'LOW',
      debug: { rewrite, answerabilityResult }
    };
    if (debugTrace) {
      console.log('[TRACE UNANSWERABLE] RETURNING unanswerable result');
    }
    return unanswerableResult;
  }

  try {
    // Build context from selected evidence (preserve source labels so generator can
    // see which chunks/evidence came from which document). Cleaning still happens
    // after generation.
    const evidenceContext = buildSelectedEvidenceContext(selectedEvidence, parseInt(process.env.SEMANTIC_RAG_CONTEXT_MAX_CHARS || '9000', 10));
    const rawAnswer = await answerFromContexts(client, question, rewrite, [{ chunk: evidenceContext, filename: 'selected-evidence' }], {
      programHint: options.programHint || '',
      intentHint: options.intentHint || ''
    });
    if (!rawAnswer) {
      if (debugTrace) {
        console.log('[TRACE EMPTY_ANSWER] No raw answer, running fallbacks');
      }
      if (strictDocumentOnly) {
        const emptyAnswerResult = {
          success: true,
          answer: buildInsufficientDataAnswer('very_low'),
          source: 'semantic-rag-empty-answer',
          contexts: selectedEvidence,
          confidenceScore: retrieved.topScore,
          confidenceTier: 'VERY_LOW',
          debug: { rewrite, answerabilityResult, strictDocumentOnly: true }
        };
        if (debugTrace) {
          console.log('[TRACE EMPTY_ANSWER] STRICT_DOCUMENT_ONLY returning empty-answer result');
        }
        return emptyAnswerResult;
      }
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-empty-answer') : null;
      if (debugTrace) {
        console.log('[TRACE EMPTY_ANSWER] preferTrainingFirst fallback:', {
          hasResult: !!fallbackResult,
          source: fallbackResult ? fallbackResult.source : null
        });
      }
      if (fallbackResult) {
        if (debugTrace) {
          console.log('[TRACE EMPTY_ANSWER] CACHING and RETURNING fallbackResult');
        }
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-empty-answer-deterministic-fallback');
      if (debugTrace) {
        console.log('[TRACE EMPTY_ANSWER] generalFallbackResult:', {
          hasResult: !!generalFallbackResult,
          source: generalFallbackResult ? generalFallbackResult.source : null
        });
      }
      if (generalFallbackResult) {
        if (debugTrace) {
          console.log('[TRACE EMPTY_ANSWER] CACHING and RETURNING generalFallbackResult');
        }
        setCachedSemanticResult(resultCacheKey, generalFallbackResult);
        return generalFallbackResult;
      }
      const emptyAnswerResult = { success: true, answer: buildInsufficientDataAnswer('very_low'), source: 'semantic-rag-empty-answer', contexts: selectedEvidence, confidenceScore: retrieved.topScore, confidenceTier: 'VERY_LOW', debug: { rewrite, answerabilityResult } };
      if (debugTrace) {
        console.log('[TRACE EMPTY_ANSWER] RETURNING empty-answer result');
      }
      return emptyAnswerResult;
    }
    if (rawAnswer.toUpperCase().includes('TIDAK_CUKUP_DATA')) {
      if (debugTrace) {
        console.log('[TRACE INSUFFICIENT_CONTEXT] TIDAK_CUKUP_DATA detected, running fallbacks');
      }
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-insufficient-context') : null;
      if (debugTrace) {
        console.log('[TRACE INSUFFICIENT_CONTEXT] preferTrainingFirst fallback:', {
          hasResult: !!fallbackResult,
          source: fallbackResult ? fallbackResult.source : null
        });
      }
      if (!fallbacksAllowed) {
        const cleaned = rawAnswer.replace(/TIDAK_CUKUP_DATA[:\s-]*/i, '').trim();
        const allowClarifyingFallback = envFlag('SEMANTIC_RAG_RETURN_CLARIFICATION_ON_NO_DATA', true);
        const insufficientContextResult = {
          success: true,
          answer: allowClarifyingFallback && cleaned ? buildInsufficientDataAnswer('very_low') + ' ' + cleaned : buildInsufficientDataAnswer('very_low'),
          source: 'semantic-rag-insufficient-context',
          contexts: selectedEvidence,
          confidenceScore: retrieved.topScore,
          debug: { rewrite, answerabilityResult }
        };
        if (debugTrace) {
          console.log('[TRACE INSUFFICIENT_CONTEXT] STRICT_DOCUMENT_ONLY returning insufficient-context result');
        }
        return insufficientContextResult;
      }
      if (fallbackResult) {
        if (debugTrace) {
          console.log('[TRACE INSUFFICIENT_CONTEXT] CACHING and RETURNING fallbackResult');
        }
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-insufficient-context-deterministic-fallback');
      if (debugTrace) {
        console.log('[TRACE INSUFFICIENT_CONTEXT] generalFallbackResult:', {
          hasResult: !!generalFallbackResult,
          source: generalFallbackResult ? generalFallbackResult.source : null
        });
      }
      if (generalFallbackResult) {
        if (debugTrace) {
          console.log('[TRACE INSUFFICIENT_CONTEXT] CACHING and RETURNING generalFallbackResult');
        }
        setCachedSemanticResult(resultCacheKey, generalFallbackResult);
        return generalFallbackResult;
      }
      const cleaned = rawAnswer.replace(/TIDAK_CUKUP_DATA[:\s-]*/i, '').trim();
      const allowClarifyingFallback = envFlag('SEMANTIC_RAG_RETURN_CLARIFICATION_ON_NO_DATA', true);
      const insufficientContextResult = {
        success: true,
        answer: allowClarifyingFallback && cleaned ? buildInsufficientDataAnswer('very_low') + ' ' + cleaned : buildInsufficientDataAnswer('very_low'),
        source: 'semantic-rag-insufficient-context',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        debug: { rewrite, answerabilityResult }
      };
      if (debugTrace) {
        console.log('[TRACE INSUFFICIENT_CONTEXT] RETURNING insufficient-context result');
      }
      return insufficientContextResult;
    }

    // Clean generated answer
    const cleanedAnswer = ragEngine.cleanAnswerLanguage(rawAnswer);
    
    // Natural answer formatting
    const naturalAnswer = formatNaturalAnswerFrame(question, cleanedAnswer, 'semantic-rag');
    
    // Remove document/FAQ/QNA markers
    const markersRemoved = cleanDocumentMarkers(naturalAnswer);
    
    // Canonical evaluateOutboundAnswer
    const preflight = evaluateOutboundAnswer(markersRemoved, question, { source: 'semantic-rag' });
    
    if (preflight.blocked) {
      logger.warn({ 
        reason: 'preflight_blocked', 
        issues: preflight.issues, 
        action: preflight.action, 
        question 
      }, '[SemanticRAG] answer blocked by canonical preflight');
      if (debugTrace) {
        console.log('[TRACE PREFLIGHT_BLOCKED] Answer blocked by preflight, running fallbacks');
      }
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-unsafe-answer') : null;
      if (debugTrace) {
        console.log('[TRACE PREFLIGHT_BLOCKED] preferTrainingFirst fallback:', {
          hasResult: !!fallbackResult,
          source: fallbackResult ? fallbackResult.source : null
        });
      }
      if (!fallbacksAllowed) {
        const preflightBlockedResult = {
          success: true,
          answer: preflight.answer,
          source: 'semantic-rag-preflight-blocked',
          contexts: selectedEvidence,
          confidenceScore: retrieved.topScore,
          confidenceTier: 'VERY_LOW',
          debug: { rewrite, preflight, answerabilityResult }
        };
        if (debugTrace) {
          console.log('[TRACE PREFLIGHT_BLOCKED] STRICT_DOCUMENT_ONLY returning preflight-blocked result');
        }
        return preflightBlockedResult;
      }
      if (fallbackResult) {
        if (debugTrace) {
          console.log('[TRACE PREFLIGHT_BLOCKED] CACHING and RETURNING fallbackResult');
        }
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      const preflightBlockedResult = {
        success: true,
        answer: preflight.answer,
        source: 'semantic-rag-preflight-blocked',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        confidenceTier: 'VERY_LOW',
        debug: { rewrite, preflight, answerabilityResult }
      };
      if (debugTrace) {
        console.log('[TRACE PREFLIGHT_BLOCKED] RETURNING preflight-blocked result');
      }
      return preflightBlockedResult;
    }

    // Detect answer category and format accordingly using preflight.answer (preserves normalization)
    const answerCategory = detectAnswerCategory(preflight.answer, question);
    const formattedAnswer = formatAnswerByCategory(preflight.answer, answerCategory);

    // Log answer quality
    appendAnswerQualityLog(formattedAnswer, {
      source: 'semantic-rag',
      question,
      category: answerCategory,
      confidenceScore: retrieved.topScore,
      contextCount: selectedEvidence.length,
      answerabilityResult,
      preflightChanged: preflight.changed,
      preflightIssues: preflight.issues
    });

    const response = {
      success: true,
      answer: preflight.answer,
      source: 'semantic-rag',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      confidenceTier: retrieved.topScore >= 0.3 ? 'HIGH' : 'MEDIUM',
      debug: { rewrite, indexSize: retrieved.indexSize, answerabilityResult, answerCategory, preflight }
    };
    if (debugTrace) {
      console.log('[TRACE FINAL] CACHING and RETURNING semantic-rag response:', {
        source: response.source,
        answerPreview: String(response.answer).slice(0, 100)
      });
    }
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] answer generation failed');
    if (!fallbacksAllowed) {
      const errorResult = {
        success: true,
        answer: 'Maaf, saya belum bisa mengambil jawaban dari data saat ini. Coba ulangi pertanyaannya sebentar lagi, atau tuliskan dengan lebih spesifik.',
        source: 'semantic-rag-error',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        debug: { rewrite, error: err && err.message ? err.message : String(err), answerabilityResult }
      };
      if (debugTrace) {
        console.log('[TRACE ERROR] STRICT_DOCUMENT_ONLY returning error result');
      }
      return errorResult;
    }
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-error') : null;
    if (debugTrace) {
      console.log('[TRACE ERROR] preferTrainingFirst fallback:', {
        hasResult: !!fallbackResult,
        source: fallbackResult ? fallbackResult.source : null
      });
    }
    if (fallbackResult) {
      if (debugTrace) {
        console.log('[TRACE ERROR] CACHING and RETURNING fallbackResult');
      }
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    const errorResult = {
      success: true,
      answer: 'Maaf, saya belum bisa mengambil jawaban dari data saat ini. Coba ulangi pertanyaannya sebentar lagi, atau tuliskan dengan lebih spesifik.',
      source: 'semantic-rag-error',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      debug: { rewrite, error: err && err.message ? err.message : String(err), answerabilityResult }
    };
    if (debugTrace) {
      console.log('[TRACE ERROR] RETURNING error result');
    }
    return errorResult;
  }
}
function clearSemanticCaches(details = null) {
  const before = {
    resultCacheSize: semanticResultCache.size,
    embeddingCacheSize: semanticEmbeddingCache.size,
    hadIndexCache: Boolean(semanticIndexCache),
    hadTrainingDbCache: Boolean(trainingDbCache)
  };

  semanticResultCache.clear();
  semanticEmbeddingCache.clear();
  semanticIndexCache = null;
  trainingDbCache = null;

  if (details) {
    logger.info({ details, before }, '[Semantic RAG] Caches invalidated');
  }

  return { success: true, before };
}

function prewarmSemanticRag() {
  const index = getCachedSemanticIndex();
  return {
    success: true,
    indexSize: Array.isArray(index) ? index.length : 0,
    resultCacheSize: semanticResultCache.size,
    embeddingCacheSize: semanticEmbeddingCache.size
  };
}

module.exports = {
  querySemanticRag,
  prewarmSemanticRag,
  rewriteQuestionWithLlm,
  retrieveSemanticContexts,
  cosineSimilarity,
  getActiveTrainingDataFromDb,
  computeLexicalScore,
  getDatabaseCandidates,
  buildContextText,
  isLikelyRawAdministrativeDocument,
  sanitizeSemanticIndex,
  hasSemanticEvidenceAlignment,
  filterSemanticContextsForQuestion,
  appendAnswerQualityLog,
  clearSemanticCaches,
  detectAnswerCategory,
  formatAnswerByCategory,
  buildSpecificInsufficientDataAnswer,
  cleanDocumentMarkers,
  splitIntoEvidenceUnits,
  extractGenericEntities,
  detectGenericIntent,
  computePhraseOverlap,
  computeEntityOverlap,
  computeIntentCompatibility,
  computeAdminPenalty,
  computeGenericScore,
  selectEvidenceByCompatibility,
  evaluateGenericAnswerability
};
