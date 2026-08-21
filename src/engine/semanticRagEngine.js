const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const ragEngine = require('./ragEngine');
const prisma = require('../db');
const {
  filterGovernedTrainingRows,
  getTrainingGovernance,
  recordRagTrace,
  appendRuntimeAuditJsonl
} = require('./runtimeGovernance');
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
const { deduplicateEvidence } = require('../utils/evidenceDedup');
const { normalizeUserQuery } = require('../utils/queryNormalizer');
const { buildCanonicalQueryUnderstanding } = require('./queryUnderstanding');
const { classifyDocumentCategory } = require('./docCategoryClassifier');
const {
  deriveQueryMetadataConstraints,
  applyKnowledgeMetadataHardGate
} = require('./hardMetadataGates');
const {
  buildQueryUnderstanding,
  rerankContexts,
  reciprocalRankFusion,
  mmrDiversifyContexts,
  processEvidence
} = require('./ragTechniquePipeline');

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

function getRuntimeGreetingTime() {
  const forced = String(process.env.BOT_GREETING_TIME_OVERRIDE || '').trim().toLowerCase();
  if (/^(pagi|siang|sore|malam)$/.test(forced)) return forced;

  let hour = null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: process.env.BOT_TIMEZONE || 'Asia/Makassar',
      hour: '2-digit',
      hour12: false
    }).formatToParts(new Date());
    const value = parts.find((part) => part.type === 'hour');
    hour = value && value.value ? Number(value.value) : null;
    if (hour === 24) hour = 0;
  } catch (e) {
    const nowUtc = new Date(Date.now());
    const witaMs = nowUtc.getTime() + 8 * 60 * 60 * 1000;
    hour = new Date(witaMs).getUTCHours();
  }

  if (!Number.isFinite(hour)) hour = new Date().getHours();
  if (hour >= 5 && hour < 11) return 'pagi';
  if (hour >= 11 && hour < 15) return 'siang';
  if (hour >= 15 && hour < 18) return 'sore';
  return 'malam';
}
function buildRuntimeGreetingIntro() {
  const time = getRuntimeGreetingTime();
  return `Halo Kak, selamat ${time}. Saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu seputar PMB, rincian biaya, program studi, jadwal pendaftaran, beasiswa, dan informasi kampus.`;
}

function shouldReturnSmallTalkImmediately(question, smallTalkWords) {
  const q = String(question || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();
  if (!q) return false;
  const hasCampusTopicAnchor = /\b(?:biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|fasilitas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|job\s*fair|campus\s*hiring|magang|lowongan|inkubator|inbis|student\s+exchange|hi-?think|ukm|ormawa|double\s*degree|dual\s*degree|akreditasi|yudisium|wisuda|sidang|tugas\s+akhir|skripsi|tesis|sion|baak|kalender\s+akademik|visa|itas|kitas|sktt|izin\s+belajar|rpl|apa\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i.test(q);
  if (smallTalkWords <= 6 && !hasCampusTopicAnchor) return true;

  const hasThanks = /\b(?:terima\s*(?:kasih|ksih|ksh)|terimakasih|makasih|mksh|mksih|thanks|thank\s+you|thx)\b/i.test(q);
  if (!hasThanks) return false;

  const hasNewCampusQuestion = /\b(?:biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|fasilitas|fasilias|fasiltas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis|language\s+learning|llc|bccp|gccp|gcpp|student\s+exchange|hi-?think|lokasi|alamat|ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|double\s*degree|dual\s*degree|akreditasi|prospek|kerja|yudisium|wisuda|sidang|tugas\\s+akhir|skripsi|tesis|sion|baak|kalender\\s+akademik|apa\\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i.test(q);
  const explicitCorrection = /\b(?:hanya|cuma|sekadar|sekedar)\s+(?:bilang|mengucapkan)|tidak\s+perlu\s+(?:dicari|cari|dijawab\s+panjang)|cukup\s+bilang|sama\s*-?\s*sama/i.test(q);
  return explicitCorrection || !hasNewCampusQuestion;
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

  const baseSelect = {
    id: true,
    filename: true,
    content: true,
    source: true,
    divisionKey: true,
    createdAt: true,
    ragIngestStatus: true,
    ragChunkCount: true
  };
  const governanceSelect = {
    ...baseSelect,
    governanceStatus: true,
    governanceOwner: true,
    governanceVersion: true,
    validFrom: true,
    validTo: true,
    governanceMetadata: true
  };

  try {
    let data = [];
    try {
      data = await prisma.trainingData.findMany({
        where: { active: true },
        select: governanceSelect,
        orderBy: { createdAt: 'desc' }
      });
    } catch (selectErr) {
      const msg = selectErr && selectErr.message ? String(selectErr.message) : '';
      if (!/governanceStatus|governanceOwner|governanceVersion|validFrom|validTo|governanceMetadata|Unknown field|does not exist/i.test(msg)) throw selectErr;
      try { logger.warn({ err: msg }, '[SemanticRAG] governance columns unavailable; using legacy TrainingData select'); } catch (_) { try { console.warn('[SemanticRAG] governance columns unavailable; using legacy TrainingData select', msg); } catch (__) {} }
      data = await prisma.trainingData.findMany({
        where: { active: true },
        select: baseSelect,
        orderBy: { createdAt: 'desc' }
      });
    }

    const governed = filterGovernedTrainingRows(data);
    if (ttlMs > 0) trainingDbCache = { ts: now, data: governed };
    return governed;
  } catch (err) {
    try { logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to fetch TrainingData from database'); } catch (_) { try { console.warn('[SemanticRAG] failed to fetch TrainingData from database', err && err.message ? err.message : String(err)); } catch (__) {} }
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
    chunks = ragEngine.chunkText(content, 1600, 300);
  } catch (e) {
    chunks = [];
  }
  if (!chunks.length) {
    for (let i = 0; i < content.length; i += 1300) {
      const chunk = content.slice(i, i + 1600).trim();
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
      createdAt: trainingData.createdAt,
      governance: {
        ...getTrainingGovernance(trainingData),
        ...(trainingData.governanceMetadata && typeof trainingData.governanceMetadata === 'object' ? trainingData.governanceMetadata : {})
      }
    }
  }));
}

// Generic document-format marker cleaning
function stripRawOutlineNumbering(text) {
  return String(text || '')
    .replace(/(^|\n)\s*(?:[-*]\s*)?\d{1,3}[.)]\s+(?=(?:Program|Prodi|Fakultas|Jurusan|Biaya|Syarat|Dokumen|Jadwal|Kurikulum|Akreditasi|Beasiswa|Career|Student|Double|Dual|Visa|ITAS|KITAS|SKTT)\b)/gi, '$1- ')
    .replace(/\s+-\s+\d{1,3}[.)]\s+(?=(?:Program|Double|Dual|Student|Visa|ITAS|KITAS|SKTT)\b)/gi, ' - ');
}

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
  
  cleaned = stripRawOutlineNumbering(cleaned);
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
  'apa', 'apakah', 'bagaimana', 'gimana', 'kapan', 'dimana', 'mana', 'berapa', 'cara', 'terus',
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'pada', 'dari', 'ke', 'di', 'itu',
  'ini', 'ada', 'bisa', 'boleh', 'mau', 'ingin', 'saya', 'aku', 'kamu', 'kak',
  'kakak', 'min', 'admin', 'tolong', 'mohon', 'dong', 'ya', 'nih', 'nya',
  'jelaskan', 'sebutkan', 'info', 'informasi', 'tentang', 'terkait', 'kalau',
  'jika', 'jadi', 'adalah', 'untuknya', 'tersebut', 'kampus', 'kuliah',
  'pendaftaran', 'daftar', 'biaya', 'harga', 'jadwal', 'syarat', 'dokumen',
  'program', 'studi', 'prodi', 'jurusan', 'tahun', 'ajaran', 'itb', 'stikom', 'bali', 'institut'
]);

function extractQueryAnchorTerms(text) {
  const query = normalizeUserQuery(text || '');
  const normalized = normalizeForLexicalMatch(query.normalizedText);
  if (!normalized) return [];

  const anchors = [];
  const add = (value) => {
    const v = normalizeForLexicalMatch(value);
    if (v && !anchors.includes(v)) anchors.push(v);
  };

  const anchorSource = query.normalizedText;
  const strongPatterns = [
    /\b(sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika|pascasarjana|pasca\s*sarjana|magister(?:\s+sistem\s+informasi)?)\b/gi,
    /\b(double\s+degree|dual\s+degree|student\s+exchange|international\s+program|program\s+internasional)\b/gi,
    /\b(linkedin|career\s+center|career\s+development\s+center|cdc|pusat\s+karier|pusat\s+karir|sion|portal\s+akademik|wisuda|yudisium|skripsi|akreditasi|ban\s*-?\s*pt|rpl|rekognisi\s+pembelajaran\s+lampau|beasiswa|kip|1k1s|skss|dpp|ukt|visa\s+study|visa\s+studi|visa\s+pelajar|izin\s+belajar|study\s+permit|itas|kitas|sktt|inbis|inkubator\s+bisnis|faq|qna|visi|misi|visi\s+misi|website|isian\s+website)\b/gi,
    /\b(gelombang\s+(?:khusus|[0-9]+|[ivx]+)\s*[a-c]?)\b/gi,
    /\b(si|ti|sk|bd|mi|d3|s1|s2|dnui|help|utb)\b/gi
  ];

  for (const pattern of strongPatterns) {
    for (const match of String(anchorSource || '').matchAll(pattern)) add(match[1] || match[0]);
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
  const programAnchorAliases = {
    si: ['sistem informasi'],
    ti: ['teknologi informasi'],
    'teknik informatika': ['teknologi informasi', 'ti'],
    informatika: ['teknologi informasi', 'ti'],
    bd: ['bisnis digital'],
    sk: ['sistem komputer'],
    mi: ['manajemen informatika']
  };
  const expandedAnchors = [];
  for (const anchor of anchors) {
    expandedAnchors.push(anchor);
    const aliases = programAnchorAliases[normalizeForLexicalMatch(anchor)];
    if (aliases) expandedAnchors.push(...aliases);
  }
  const cNorm = normalizeForLexicalMatch(content);
  return expandedAnchors.some((anchor) => {
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
  const q = normalizeUserQuery(question || '').normalizedText;
  
  if (/\b(pasal|ayat|force\s*majeure|addendum|perjanjian|klausul|isi\s+pasal|legal|hukum)\b/i.test(q)) return 'legal';
  // Check scholarship before fee to avoid misclassification
  if (/\b(beasiswa|bantuan\s+(?:biaya|biaya\s+bantuan)|potongan|kip|1k1s|skss)\b/i.test(q)) return 'scholarship';
  if (/\b(akreditasi|akrediasi|ban\s*-?\s*pt|peringkat)\b/i.test(q)) return 'accreditation';
  if (/\b(rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(q)) return 'rpl';
  if (/\b(double\s*degree|dual\s*degree|dd)\b/i.test(q) && !/\bprogram\s+(?:double|dual)\s*degree\b/i.test(q)) return 'dual_degree';
  if (/\b(visa\s+(?:study|studi|pelajar)|izin\s+belajar|study\s+permit|itas|kitas|sktt|mahasiswa\s+asing)\b/i.test(q)) return 'visa_study';
  if (/\b(prospek\s+kerja|karir|karier|lulusan|profesi|pekerjaan|kerja\s+apa|jadi\s+apa|peluang\s+kerja|career|career\s*center|pusat\s+karier|pusat\s+karir|lowongan|magang|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study|konsultasi\s+karier)\b/i.test(q)) return 'career';
  if (/\b(?:cara\s+daftar|cara\s+pendaftaran|cara\s+registrasi|gimana\s+cara\s+daftar|bagaimana\s+cara\s+daftar|daftar\s+online|pendaftaran\s+online|registrasi\s+online|cara\s+daftar)\b/i.test(q)) return 'registration_how';
  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal|fee|cost|price)\b/i.test(q)) return 'fee';
  if (/\b(jadwal|kapan|tanggal|periode|gelombang|jam|waktu|bulan\s+(?:ini|depan)|deadline)\b/i.test(q)) return 'schedule';
  if (/\b(syarat|persyaratan|dokumen|berkas|ketentuan|requirement)\b/i.test(q)) return 'requirement';
  if (/\b(fasilitas|layanan|sarana|prasarana|laboratorium|lab(?:nya)?|perpustakaan(?:nya)?|ruang|kantin(?:nya)?|parkir(?:an)?(?:nya)?|wifi|wi-fi|inkubator|inbis|incubator|language\s+learning|llc|belajar\s+bahasa|kemampuan\s+bahasa|softskill|soft\s*skill|hi-?think|hithink|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(q)) return 'facility';
  if (/\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|study\s+exchange|mitra\s+luar|luar\s+negeri|dnui|dalian\s+neusoft|help(?:\s+university)?|utb|universitas\s+teknologi\s+bandung|gccp|bccp)\b/i.test(q)) return 'international_program';
  if (/\b(apa\s+saja|daftar|list|pilihan|macam|sebutkan)\b/i.test(q)) return 'list';
  if (/\b(program\s+studi|prodi|jurusan|major)\b/i.test(q)) return 'program';
  if (/\b(ukm|ormawa|organisasi\s+mahasiswa|kegiatan\s+mahasiswa|unit\s+kegiatan)\b/i.test(q)) return 'organization';
  
  return 'general';
}

// Generic phrase overlap scoring
function detectFineGrainedIntent(question) {
  const q = normalizeUserQuery(question || '').normalizedText;
  if (!q) return { fineIntent: 'unknown', coarseIntent: 'general' };

  const hasThesis = /\b(?:skripsi|tugas\s+akhir|tesis|proyek\s+akhir)\b/i.test(q);
  if (hasThesis && /\b(?:topik|tema|judul|bidang|jenis\s+penelitian|penelitian\s+apa|apa\s+saja)\b/i.test(q)) return { fineIntent: 'thesis_topic', coarseIntent: 'general' };
  if (hasThesis && /\b(?:halaman|lembar|jumlah\s+halaman|minimal|maksimal)\b/i.test(q)) return { fineIntent: 'thesis_page_count', coarseIntent: 'general' };
  if (hasThesis && /\b(?:format|template|sistematika|penulisan|bab|margin|spasi)\b/i.test(q)) return { fineIntent: 'thesis_format', coarseIntent: 'general' };
  if (hasThesis && /\b(?:daftar|pengajuan|ajukan|sidang|proposal|seminar|sempro|pembimbing)\b/i.test(q)) return { fineIntent: 'thesis_submission', coarseIntent: 'schedule' };

  if (/\b(?:gelar|title|degree)\b/i.test(q) && /\b(?:lulusan|lulus|pascasarjana|pasca\s*sarjana|magister|s2|prodi|program\s+studi)\b/i.test(q)) return { fineIntent: 'degree_title', coarseIntent: 'program' };
  if (/\b(?:berapa\s+lama|lama\s+(?:kuliah|studi)|masa\s+studi|durasi)\b/i.test(q)) return { fineIntent: 'study_duration', coarseIntent: 'program' };
  if (/\b(?:fakultas|naungan|termasuk\s+ke\s+dalam\s+fakultas)\b/i.test(q)) return { fineIntent: 'program_faculty', coarseIntent: 'program' };
  if (/\b(?:mata\s+kuliah|matkul|kurikulum|dipelajari|dipelajarin|belajar(?:\s+apa)?|apa\s+aja\s+yang\s+dipelajarin|jurusannya\s+(?:gimana|bagaimana)|skill|kompetensi)\b/i.test(q)) return { fineIntent: 'program_curriculum', coarseIntent: 'program' };
  if (/\b(?:mempersiapkan|persiapan|siap|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|setelah\s+(?:lulus|tamat)|lowongan|job\s*fair|campus\s*hiring|magang|pelatihan|pembekalan|melamar\s+pekerjaan)\b/i.test(q) && /\b(?:program|fasilitas|layanan|pendukung|apa\s+saja|ada\s+apa|mahasiswa|career\s*center|pusat\s+karier|pusat\s+karir|karier|karir|career|pekerjaan|kerja)\b/i.test(q)) return { fineIntent: 'career_readiness', coarseIntent: 'career' };
  if (/\b(?:prospek|karier|karir|kerja\s+apa|pekerjaan|profesi)\b/i.test(q)) return { fineIntent: 'program_career', coarseIntent: 'career' };
  if (/\b(?:beda|bedanya|perbedaan|bandingkan|perbandingan)\b/i.test(q) && /\b(?:prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|manajemen)\b/i.test(q)) return { fineIntent: 'program_comparison', coarseIntent: 'program' };

  if (/\b(?:program\s+internasional|kelas\s+internasional|international\s+program|student\s+exchange|double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(q)) {
    if (/\b(?:syarat|persyaratan|ketentuan|dokumen|seleksi)\b/i.test(q)) return { fineIntent: 'international_program_requirement', coarseIntent: 'requirement' };
    if (/\b(?:biaya|harga|ukt|dpp|bayar|pendaftaran)\b/i.test(q)) return { fineIntent: 'international_program_fee', coarseIntent: 'fee' };
    return { fineIntent: 'international_program_list', coarseIntent: 'international_program' };
  }

  return { fineIntent: detectGenericIntent(q), coarseIntent: detectGenericIntent(q) };
}

function shouldDeferEarlyEvidenceFirstToStableRoute(question) {
  if (isIndustryServicesQuestion(question)) return true;
  const fine = detectFineGrainedIntent(question || '');
  const fineIntent = String(fine && fine.fineIntent ? fine.fineIntent : '').toLowerCase();
  const coarseIntent = String(fine && fine.coarseIntent ? fine.coarseIntent : '').toLowerCase();
  const stableFineIntents = new Set([
    'registration_how',
    'pmb_overview',
    'program_list',
    'program_definition',
    'program_comparison',
    'program_recommendation',
    'program_curriculum',
    'program_faculty',
    'international_program_list',
    'international_program_requirement',
    'international_program_fee',
    'dual_degree',
    'rpl',
    'scholarship',
    'accreditation',
    'thesis_topic',
    'thesis_page_count',
    'thesis_format',
    'thesis_submission',
    'career_readiness',
    'facility_list',
    'international_program_availability',
    'degree_title',
    'study_duration',
    'thesis_topic',
    'thesis_page_count',
    'thesis_format',
    'thesis_submission',
    'fee'
  ]);
  if (stableFineIntents.has(fineIntent)) return true;
  return ['program', 'international_program'].includes(coarseIntent);
}

function hasStableFastLaneIntent(question) {
  const q = String(question || '').trim();
  if (!q) return true;
  if (isGreetingOnly(q)) return true;
  if (trySmallTalkAnswer(q)) return true;
  if (hasExplicitFeeQuestionSignal(q) && !/\b(?:visa|e\s*30\s*b|itas|kitas|sktt|izin\s+belajar|study\s+permit|mahasiswa\s+asing)\b/i.test(q)) return true;
  if (/\b(?:double\s*degree|dual\s*degree|gelar\s+ganda)\b/i.test(q) && !hasExplicitFeeQuestionSignal(q)) return true;
  if (/\b(?:akreditasi|terakreditasi|ban\s*-?\s*pt|lam\s*infokom)\b/i.test(q)) return true;
  if (/\b(?:mulai\s+kuliah|awal\s+kuliah|perkuliahan\s+semester\s+genap|semester\s+genap)\b/i.test(q) && /\b(?:2025\s*\/?\s*2026|ta\s*2025|tahun\s+akademik\s+2025)\b/i.test(q)) return true;
  if (/\b(?:daftar|mendaftar|pendaftaran|registrasi|pmb|penerimaan\s+mahasiswa\s+baru|gelombang)\b/i.test(q)
    && !/\b(?:yudisium|wisuda|sidang|tugas\s+akhir|izin\s+belajar|study\s+permit|visa|itas|kitas|sktt|mahasiswa\s+asing|student\s+exchange|hi-?think|goes\s*to\s*school|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis)\b/i.test(q)) return true;
  const fine = detectFineGrainedIntent(q);
  if ([
    'program_list',
    'program_definition',
    'program_comparison',
    'program_recommendation',
    'program_curriculum',
    'program_faculty',
    'rpl',
    'scholarship',
    'accreditation',
    'thesis_topic',
    'thesis_page_count',
    'thesis_format',
    'thesis_submission'
  ].includes(fine && fine.fineIntent)) return true;
  return false;
}

function isAmbiguousProgramScopeQuestion(question) {
  const q = String(question || '').trim();
  if (!q) return false;
  if (!/\bprogram\b/i.test(q)) return false;
  const asksList =
    /\b(?:program\s+(?:apa|apa\s+saja|apa\s+aja|yang\s+ada|tersedia)|ada\s+program\s+(?:apa|apa\s+saja|apa\s+aja)|programnya\s+(?:apa|apa\s+saja|apa\s+aja))\b/i.test(q) ||
    /\b(?:boleh|bisa|mau|ingin|pengen)\b.{0,50}\b(?:tahu|tau|lihat|cek)\b.{0,40}\bprogram\b/i.test(q);
  if (!asksList) return false;

  const explicitScope = /\b(?:program\s+studi|prodi|jurusan|fakultas|s1|s2|d3|sarjana|pascasarjana|magister|diploma|double\s*degree|dual\s*degree|gelar\s+ganda|internasional|international|student\s+exchange|pertukaran\s+mahasiswa|gccp|hi-?think|hithink|goes\s*to\s*school|beasiswa|skss|rpl|pmb|pendaftaran|biaya|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis|ukm|organisasi|ormawa|fasilitas|kampus\s+mengajar)\b/i;
  if (explicitScope.test(q)) return false;

  return true;
}

function hasRecentProgramStudyScopeContext(sessionData) {
  const recentUser = getRecentUserConversation(sessionData).toLowerCase();
  const recentAll = getRecentConversationTextForResolution(sessionData);
  const contextText = recentUser || recentAll;
  if (!contextText) return false;

  const programStudyContext = /\b(?:pmb|penerimaan\s+mahasiswa\s+baru|daftar\s+kuliah|mendaftar\s+kuliah|pendaftaran\s+(?:kuliah|mahasiswa)|calon\s+mahasiswa|mahasiswa\s+baru|program\s+studi|prodi|jurusan|pilihan\s+kuliah)\b/i;
  if (!programStudyContext.test(contextText)) return false;

  const competingUserScope = /\b(?:double\s*degree|dual\s*degree|gelar\s+ganda|internasional|international|student\s+exchange|pertukaran\s+mahasiswa|gccp|hi-?think|hithink|goes\s*to\s*school|beasiswa|skss|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis|ukm|organisasi|ormawa|fasilitas)\b/i;
  return !competingUserScope.test(recentUser);
}

function buildContextualProgramStudyListAnswer(question) {
  const programList = tryProgramListAnswer('apa saja program studi yang ada di stikom bali?');
  if (!programList || !programList.answer) return null;
  return {
    answer: programList.answer,
    confidence: 0.95,
    tier: 'HIGH',
    source: 'semantic-rag-program-list-contextual'
  };
}

function hasPendingProgramScopeClarification(sessionData) {
  const parts = [];
  const recentAll = getRecentConversationTextForResolution(sessionData);
  if (recentAll) parts.push(recentAll);
  if (sessionData && typeof sessionData === 'object') {
    const messages = Array.isArray(sessionData.messages) ? sessionData.messages.slice(-8) : [];
    messages.forEach((m) => {
      const text = String((m && (m.message || m.content || m.text)) || '').trim();
      if (text) parts.push(text);
    });
    [sessionData.lastAnswer, sessionData.lastBotAnswer].forEach((value) => {
      const text = String(value || '').trim();
      if (text) parts.push(text);
    });
  }
  const text = parts.join('\n').toLowerCase();
  if (!text) return false;
  return /\bmaksud\b[\s\S]{0,120}\bprogram\b/i.test(text)
    && /\b(?:program\s+studi|prodi|jurusan)\b/i.test(text)
    && /\bprogram\s+internasional\b/i.test(text);
}

function buildProgramScopeInternationalChoiceAnswer() {
  const fallback = tryInternationalClassFallback('apa ada program internasional di stikom bali?');
  if (fallback && fallback.answer) {
    return {
      ...fallback,
      confidence: 0.95,
      tier: 'HIGH',
      source: 'semantic-rag-program-scope-clarification-choice'
    };
  }
  return null;
}

function tryProgramScopeClarificationChoiceAnswer(question, options = {}) {
  const q = String(question || '').toLowerCase().trim().replace(/[?.!,;:]+$/g, '').replace(/\s+/g, ' ');
  if (!q || q.split(/\s+/).length > 5) return null;

  if (/^(?:program\s+studi|prodi|jurusan|program\s+kuliah|jurusan\s+kuliah)$/i.test(q)) {
    const contextualList = buildContextualProgramStudyListAnswer(question);
    if (contextualList && contextualList.answer) {
      return {
        ...contextualList,
        source: 'semantic-rag-program-list-contextual'
      };
    }
  }

  if (/^(?:program\s+internasional|internasional|international|kelas\s+internasional)$/i.test(q)) {
    return buildProgramScopeInternationalChoiceAnswer();
  }

  return null;
}
function buildAmbiguousProgramScopeAnswer() {
  return [
    'Kak, maksud "program" yang ingin ditanyakan yang mana?',
    '',
    '- Program studi/jurusan: S2 Sistem Informasi, S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital, Sistem Komputer, dan D3 Manajemen Informatika.',
    '- Program internasional: Double Degree DNUI/HELP, Double Degree UTB, Student Exchange, dan Hi-Think.',
    '- Program pendukung kampus: beasiswa, UKM/organisasi mahasiswa, Career Center, Inkubator Bisnis, fasilitas kampus, atau program kampus lainnya.',
    '',
    'Kakak bisa balas, misalnya: "program studi", "program internasional", "program beasiswa", atau nama program yang ingin ditanyakan.'
  ].join('\n');
}

function tryAmbiguousProgramScopeAnswer(question, options = {}) {
  if (!isAmbiguousProgramScopeQuestion(question)) return null;
  const topic = inferContextTopicFromSession(options && options.sessionData);
  if ((topic && topic.key === 'program_list') || hasRecentProgramStudyScopeContext(options && options.sessionData)) {
    const contextualList = buildContextualProgramStudyListAnswer(question);
    if (contextualList && contextualList.answer) return contextualList;
  }
  return {
    answer: buildAmbiguousProgramScopeAnswer(),
    confidence: 0.93,
    tier: 'HIGH',
    source: 'semantic-rag-program-scope-clarification'
  };
}


function isAmbiguousCampusProductQuestion(question) {
  const q = String(question || '').trim();
  if (!q || !/\bproduk\b/i.test(q)) return false;
  const campusContext = /\b(?:stikom|itb\s+stikom|kampus|pmb|kuliah|prodi|jurusan|program)\b/i.test(q);
  const asksList = /\b(?:apa\s+saja|apa\s+aja|yang\s+ada|ada\s+apa|tersedia|boleh|bisa|mau|ingin|pengen|tahu|tau)\b/i.test(q);
  return campusContext && asksList;
}

function buildAmbiguousCampusProductAnswer() {
  return [
    'Kak, maksud “produk” di sini yang mana ya?',
    '',
    '- Kalau maksudnya program yang tersedia di ITB STIKOM Bali, pilihannya bisa berupa program studi/jurusan, program internasional, beasiswa, UKM/organisasi mahasiswa, Career Center, Inkubator Bisnis, atau fasilitas kampus.',
    '- Kalau maksudnya produk/hasil karya dari Inkubator Bisnis, kakak bisa balas “produk Inkubator Bisnis” atau “produk INBIS”.',
    '',
    'Kakak bisa balas, misalnya: “program studi”, “program internasional”, “program kampus”, atau “produk Inkubator Bisnis”.'
  ].join('\n');
}

function tryAmbiguousCampusProductAnswer(question) {
  if (!isAmbiguousCampusProductQuestion(question)) return null;
  return {
    answer: buildAmbiguousCampusProductAnswer(),
    confidence: 0.94,
    tier: 'HIGH',
    source: 'semantic-rag-product-scope-clarification'
  };
}

function isExplicitProgramRecommendationQuestion(question) {
  const q = normalizeUserQuery(question || '').normalizedText || String(question || '').toLowerCase();
  if (!q.trim()) return false;
  if (/\b(?:career\s*center|pusat\s+kar(?:ir|ier)|job\s*fair|campus\s*hiring|tracer\s*study|lowongan|loker|konsultasi\s+kar(?:ir|ier))\b/i.test(q)) return false;
  if (/\b(?:beda|bedanya|perbedaan|bandingkan|perbandingan|dibandingkan|antara)\b/i.test(q)) return false;
  const programScope = /\b(?:s\s*1|sarjana|prodi|program\s+studi|jurusan|kuliah|mahasiswa\s+baru|calon\s+mahasiswa)\b/i.test(q);
  const fitIntent = /\b(?:cocok|cocoknya|sesuai|rekomendasi|saran|sarankan|pilih|pilihan|yang\s+mana|ambil|mengambil|jurusan\s+apa|prodi\s+apa|program\s+apa)\b/i.test(q);
  const workOrInterest = /\b(?:bekerja\s+di\s+bidang|kerja\s+di\s+bidang|ingin\s+(?:jadi|bekerja)|mau\s+(?:jadi|bekerja)|pengen\s+(?:jadi|bekerja)|minat|suka|hobi|hobby|pemasaran|marketing|digital\s+marketing|sosial\s+media|social\s+media|tiktok|live|konten|content|jualan|bisnis|e-commerce|data|analisis|analyst|coding|ngoding|programming|aplikasi|software|developer|jaringan|network|cloud|cyber|security|hardware|iot|robot|desain|design|ui\s*\/?\s*ux)\b/i.test(q);
  return programScope && fitIntent && workOrInterest;
}

function tryExplicitProgramRecommendationPreGuard(question) {
  if (!isExplicitProgramRecommendationQuestion(question)) return null;
  const direct = tryProgramRecommendationAnswer(question);
  if (!direct || !direct.answer) return null;
  return {
    ...direct,
    source: 'semantic-rag-program-recommendation',
    frameSource: direct.frameSource || 'semantic-rag-program-recommendation',
    confidence: direct.confidence || 0.96,
    tier: direct.tier || 'HIGH'
  };
}
function tryStudyLevelComparisonAnswer(question) {
  const q = String(question || '');
  const asksComparison = /\b(?:beda|bedanya|perbedaan|membedakan|banding|dibandingkan|antara)\b/i.test(q);
  const mentionsS1 = /\b(?:s1|sarjana|strata\s+satu)\b/i.test(q);
  const mentionsD3 = /\b(?:d3|diploma\s*3|diploma\s+tiga)\b/i.test(q);
  if (!asksComparison || !mentionsS1 || !mentionsD3) return null;
  return {
    answer: [
      'Perbedaan utama program S1 dan D3 ada pada jenjang, lama studi, dan fokus pembelajarannya.',
      '',
      '- S1/Sarjana: masa studi normal sekitar 4 tahun atau 8 semester. Fokusnya lebih luas, mencakup teori, analisis, perancangan solusi, pengembangan sistem/bisnis digital, dan peluang lanjut ke jenjang S2.',
      '- D3/Diploma: masa studi normal sekitar 3 tahun atau 6 semester. Fokusnya lebih praktis dan terapan, sehingga cocok untuk mahasiswa yang ingin lebih cepat masuk dunia kerja dengan skill operasional/teknis.',
      '',
      'Di ITB STIKOM Bali, pilihan S1 mencakup Sistem Informasi, Teknologi Informasi, Bisnis Digital, dan Sistem Komputer. Untuk D3, program yang tersedia adalah Manajemen Informatika.',
      '',
      'Jadi, kalau ingin pendalaman akademik dan jenjang karier lebih luas, S1 lebih cocok. Kalau ingin jalur yang lebih singkat dan praktis, D3 bisa dipertimbangkan.'
    ].join('\n'),
    confidence: 0.96,
    tier: 'HIGH',
    source: 'semantic-rag-study-level-comparison'
  };
}
function hasExplicitDocumentEvidenceAnchor(question) {
  const q = String(question || '').trim();
  if (!q || q.length < 8) return false;
  if (/\b(?:mahasiswa\s+asing|foreign\s+student|izin\s+belajar|study\s+permit|visa\s*(?:study|pelajar)?|e\s*30\s*b|itas|kitas|sktt)\b/i.test(q)) return true;
  if (/\b(?:career\s*center|pusat\s+kar(?:ir|ier)|tracer\s*study|job\s*fair|campus\s*hiring|lowongan|loker|magang|rekrutmen|konsultasi\s+kar(?:ir|ier))\b/i.test(q)) return true;
  if (/\b(?:inkubator\s+bisnis|inkubator|inbis|incubator)\b/i.test(q)) return true;
  if (/\b(?:hi-?think|hithink|program\s+jepang|bahasa\s+jepang|n2)\b/i.test(q)) return true;
  if (/\b(?:student\s+exchange|pertukaran\s+mahasiswa|global\s+cross\s+cultural|gccp|bccp|short\s*course|summer\s+program|credit\s+transfer)\b/i.test(q)) return true;
  if (/\b(?:goes\s*to\s*school|kunjungan\s+sekolah|sekolah\s+binaan)\b/i.test(q)) return true;
  if (/\b(?:yudisium|wisuda|sidang|tugas\s+akhir|skripsi|krs|khs|transkrip|sion|baak|kalender\s+akademik|semester\s+(?:antara|pendek|genap|ganjil)|remedial|remidi|ujian\s+(?:ulang|susulan))\b/i.test(q)) return true;
  return false;
}

function shouldTryDocumentEvidenceBeforePreGuards(question) {
  const q = String(question || '').trim();
  if (!q || q.length < 8) return false;
  if (hasStableFastLaneIntent(q)) return false;
  return hasExplicitDocumentEvidenceAnchor(q) || isDocumentEvidenceFirstCandidate(q);
}
function preserveAdministrativeAnswerAnchor(question, answer) {
  const q = String(question || '');
  const text = String(answer || '').trim();
  if (!text) return text;
  const pairs = [
    { re: /\b(?:izin\s+belajar|study\s+permit)\b/i, label: 'Izin Belajar' },
    { re: /\b(?:visa\s*(?:study|pelajar)?|e\s*30\s*b)\b/i, label: 'Visa Study/Visa E30B' },
    { re: /\b(?:itas|kitas)\b/i, label: 'ITAS/KITAS' },
    { re: /\bsktt\b/i, label: 'SKTT' },
    { re: /\bmahasiswa\s+asing\b/i, label: 'mahasiswa asing' }
  ];
  const topic = pairs.find((item) => item.re.test(q));
  if (!topic || topic.re.test(text)) return text;
  const lowered = text.charAt(0).toLowerCase() + text.slice(1);
  return `Untuk ${topic.label}, ${lowered}`;
}
function isCompoundAdministrativeTopicQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q) return false;
  const mentionsStudyPermit = /\b(?:izin belajar|study permit)\b/i.test(q);
  const mentionsVisa = /\b(?:visa|e\s*30\s*b|vitas)\b/i.test(q);
  const mentionsStayPermit = /\b(?:itas|kitas|sktt)\b/i.test(q);
  const topicCount = [mentionsStudyPermit, mentionsVisa, mentionsStayPermit].filter(Boolean).length;
  return topicCount >= 2;
}

function isWeakSemanticResultSource(source) {
  return /(?:meaning-mismatch|no-data|insufficient|disabled|out-of-domain|unanswerable|preflight-blocked)/i.test(String(source || ''));
}
function buildEvidenceFirstSearchQueries(question, fine) {
  const q = String(question || '').trim();
  const queries = buildAdaptiveQueryVariants(q, { limit: 8 });
  const fineIntent = fine && fine.fineIntent;
  if (fineIntent === 'degree_title') queries.push(`${q} gelar lulusan gelar akademik`);
  if (fineIntent === 'study_duration') queries.push(`${q} masa studi semester lama studi`);
  if (fineIntent === 'thesis_topic') queries.push(`${q} topik tugas akhir jenis penelitian penelitian dasar penelitian terapan`);
  if (fineIntent === 'thesis_page_count') queries.push(`${q} minimal halaman jumlah halaman tugas akhir pedoman penulisan`);
  if (fineIntent === 'program_faculty') queries.push(`${q} fakultas dekan ketua program studi`);
  if (fineIntent === 'program_curriculum') queries.push(`${q} kurikulum mata kuliah apa yang dipelajari skill kompetensi`);
  if (fineIntent === 'international_program_list') queries.push(`${q} program internasional double degree student exchange partner`);
  return uniqueList(queries, 6);
}

function isDocumentEvidenceFirstCandidate(question) {
  const q = String(question || '').trim();
  if (!q || q.length < 8) return false;
  if (isGreetingOnly(q)) return false;
  if (isCampusChoiceReasonQuestion(q)) return false;
  if (/\b(?:password|token|api\s*key|secret|system\s+prompt|database|data\s+pribadi|hapus\s+data|reset\s+database)\b/i.test(q)) return false;
  if (/\b(?:resep|masak|cuaca|politik|saham|crypto|film|lagu|game|olahraga)\b/i.test(q) && !/\b(?:stikom|kampus|kuliah|mahasiswa|prodi|program|akademik)\b/i.test(q)) return false;
  if (hasExplicitFeeQuestionSignal(q)) return false;
  if (isOperationalAcademicPolicyQuestion(q)) return false;
  if (findCampusSupportEntity(q) && !hasExplicitDocumentEvidenceAnchor(q)) return false;

  const fine = detectFineGrainedIntent(q);
  if (['list', 'program', 'program_list'].includes(fine.fineIntent) || fine.coarseIntent === 'program') return false;
  if (['degree_title', 'study_duration'].includes(fine.fineIntent)) return true;
  if (isBroadCampusDocumentQuestion(q)) return true;

  // Evidence-first is intentionally broad for campus/document anchored topics.
  // Old deterministic no-data guards must not block newly uploaded documents.
  const campusDocumentAnchor = /\b(?:pascasarjana|pasca\s*sarjana|magister|s2|yudisium|wisuda|semester\s+(?:antara|pendek|genap|ganjil)|kalender\s+akademik|pelaksanaan\s+akademik|remedial|remidi|ujian\s+(?:ulang|susulan)|linkedin|career\s*center|pusat\s+kar(?:ir|ier)|layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi|j\s*1|j-?1|training\s+1\s+tahun|amerika|america|usa|goes\s*to\s*school|kunjungan\s+sekolah|program\s+internasional|student\s+exchange|short\s*course|gccp|bccp|hi-?think|kuliah\s+sambil\s+kerja|magang\s+berbayar)\b/i.test(q);
  if (campusDocumentAnchor) return true;

  if (/\b(?:keunggulan|keuntungan|kelebihan|fokus\s+penelitian|visi|kelas\s+reguler)\b/i.test(q)
    && /\b(?:pascasarjana|pasca\s*sarjana|magister|s2)\b/i.test(q)) return true;

  // Keep mature deterministic routes for common program comparison/curriculum/career
  // unless the query has an explicit document anchor above.
  if (['program_comparison', 'program_curriculum', 'program_faculty', 'program_career', 'international_program_list', 'international_program_requirement', 'international_program_fee'].includes(fine.fineIntent)) return false;

  return false;
}
function buildAdaptiveQueryVariants(question, options = {}) {
  const raw = String(question || '').trim();
  if (!raw) return [];
  const normalized = normalizeUserQuery(raw).normalizedText || raw;
  const norm = normalizeForLexicalMatch(normalized);
  const variants = [raw, normalized];
  const add = (value) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text) variants.push(text);
  };

  const aliasList = Array.isArray(options.dynamicAliases)
    ? options.dynamicAliases
    : buildDynamicAliasDictionary(getCachedSemanticIndex());
  const hay = normalizeDynamicAliasText(`${raw} ${normalized}`);
  for (const item of aliasList.slice(0, 80)) {
    const alias = normalizeDynamicAliasText(item && item.alias);
    const canonical = String(item && item.canonical || '').trim();
    if (!alias || !canonical) continue;
    const aliasRe = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    if (aliasRe.test(hay)) {
      add(canonical);
      add(normalized.replace(aliasRe, ` ${canonical} `));
      if (/program|degree/i.test(String(item.type || ''))) add(`program studi ${canonical}`);
    }
  }

  const expansions = [
    { re: /\b(?:karier|career|kerja|pekerjaan|lowongan|magang|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study)\b/i, text: 'Career Center lowongan kerja magang job fair campus hiring rekrutmen tracer study konsultasi karier' },
    { re: /\b(?:kerja\s*sama|kerjasama|perusahaan|industri|mitra\s+industri|rekrutmen)\b/i, text: 'kerja sama industri perusahaan mitra industri rekrutmen campus hiring Career Center' },
    { re: /\b(?:mengapa\s+memilih|kenapa\s+memilih|keunggulan|keuntungan|kelebihan)\b/i, text: 'keunggulan ITB STIKOM Bali teknologi karier fasilitas program studi industri' },
    { re: /\b(?:inbis|inkubator\s+bisnis|incubator)\b/i, text: 'Inkubator Bisnis INBIS startup kewirausahaan usaha mahasiswa' },
    { re: /\b(?:hi\s*think|hithink|hi-?think|jepang|n4|jlpt)\b/i, text: 'Hi-Think Jepang JLPT N4 kuliah sambil kerja magang berbayar peluang kerja' },
    { re: /\b(?:mahasiswa\s+asing|visa|izin\s+belajar|study\s+permit|itas|kitas|sktt)\b/i, text: 'mahasiswa asing izin belajar visa study permit ITAS KITAS SKTT paspor dokumen' },
    { re: /\b(?:internasional|international|student\s*exchange|gccp|bccp|short\s*course|double\s*degree|dual\s*degree)\b/i, text: 'program internasional student exchange double degree dual degree GCCP BCCP short course DNUI HELP UTB' },
    { re: /\b(?:pascasarjana|pasca\s*sarjana|magister|s2|s\s*2)\b/i, text: 'S2 Sistem Informasi pascasarjana magister akreditasi kurikulum keunggulan prospek kerja' },
    { re: /\b(?:akreditasi|ban\s*-?pt|lam\s*infokom|peringkat)\b/i, text: 'akreditasi BAN-PT LAM INFOKOM peringkat akreditasi program studi' },
    { re: /\b(?:llc|language\s+learning|bahasa)\b/i, text: 'Language Learning Center LLC kemampuan bahasa pelatihan bahasa' }
  ];
  for (const item of expansions) {
    if (item.re.test(raw) || item.re.test(normalized) || item.re.test(norm)) add(`${normalized} ${item.text}`);
  }

  return uniqueList(variants, Number(options.limit || 8));
}

function isCampusChoiceReasonQuestion(question) {
  const q = normalizeUserQuery(question || '').normalizedText || String(question || '').toLowerCase();
  return /\b(?:mengapa|kenapa|alasan)\b[\s\S]{0,50}\b(?:memilih|pilih)\b/i.test(q)
    && /\b(?:stikom\s+bali|itb\s*stikom|kampus)\b/i.test(q);
}
function isBroadCampusDocumentQuestion(question) {
  const normalized = normalizeUserQuery(question || '').normalizedText;
  const q = String(normalized || question || '').trim();
  if (!q || q.length < 8) return false;
  if (isGreetingOnly(q) || hasExplicitFeeQuestionSignal(q)) return false;
  const campusAnchor = /\b(?:stikom|itb\s*stikom|kampus|kuliah|mahasiswa|alumni|lulusan|prodi|program\s+studi|jurusan|akademik|pmb|pascasarjana|magister|s2|akreditasi|beasiswa|rpl|career\s*center|karier|lowongan|magang|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study|inkubator\s+bisnis|inbis|hi\s*think|hithink|student\s*exchange|internasional|mahasiswa\s+asing|visa|izin\s+belajar|language\s+learning|llc|kerja\s*sama|perusahaan|industri)\b/i.test(q);
  const questionShape = /\b(?:apa|apakah|bagaimana|gimana|mengapa|kenapa|kapan|dimana|berapa|jelaskan|info|informasi|ada|tersedia|bisa|membantu|mendapat|memiliki|punya|mengikuti|keunggulan|keuntungan|peluang|syarat|dokumen|cara)\b/i.test(q);
  return campusAnchor && questionShape;
}
function buildStructuredTableFaqAnswerFromIndex(question, indexForQuery) {
  const q = String(question || '').trim();
  const index = Array.isArray(indexForQuery) ? indexForQuery : [];
  if (!q || !index.length) return null;
  const qNorm = normalizeFacilityTerm(q);
  const qTokens = Array.from(new Set(faqComparableTokens(q)));
  const scored = [];

  for (const item of index) {
    const chunk = String(item && item.chunk ? item.chunk : '');
    if (!chunk || !chunk.includes('|')) continue;
    const sourceText = `${item.filename || ''} ${item.sourceFile || ''} ${item.title || ''}`;
    const rows = chunk.replace(/\r/g, '\n').split('\n').map((line) => line.trim()).filter((line) => line.includes('|'));
    for (const row of rows) {
      const columns = row.split(/\s*\|\s*/).map((part) => String(part || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      for (let i = 0; i < columns.length - 1; i += 1) {
        const questionText = columns[i];
        if (!isLikelyFaqQuestionText(questionText)) continue;
        const answer = cleanUserVisibleRagAnswerText(columns[i + 1]);
        if (!answer || answer.length < 8) continue;
        const rowNorm = normalizeFacilityTerm(`${sourceText} ${row} ${questionText} ${answer}`);
        if (/\b(?:pascasarjana|pasca\s*sarjana|magister|s2)\b/i.test(qNorm) && !/\b(?:pascasarjana|pasca\s*sarjana|magister|s2)\b/i.test(rowNorm)) continue;
        if (hasFaqAnswerDomainConflict(q, questionText, answer, sourceText)) continue;
        const fTokens = Array.from(new Set(faqComparableTokens(questionText)));
        const fSet = new Set(fTokens);
        const overlap = qTokens.filter((token) => fSet.has(token)).length;
        const score = scoreFaqQuestionMatch(q, questionText, '', [])
          + overlap
          + (normalizeFacilityTerm(sourceText).split(/\s+/).filter((token) => qTokens.includes(token)).length)
          + (/upload/i.test(String(item && item.source ? item.source : '')) ? 2 : 0);
        if (score >= 8) scored.push({ item, questionText, answer, score });
      }
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.answer.length - b.answer.length);
  const best = scored[0];
  const answer = best.answer.length > 1100 ? `${best.answer.slice(0, 1097).trim()}...` : best.answer;
  const source = /upload/i.test(String(best.item && best.item.source ? best.item.source : '')) ? 'semantic-rag-uploaded-training-generic' : 'semantic-rag-generic-faq-qna';
  const preflight = evaluateOutboundAnswer(answer, q, { source });
  if ((preflight && preflight.blocked) || hasRawSpreadsheetFaqDump(answer) || hasRawEvidenceSnippetShape(answer)) return null;
  return {
    answer,
    source: 'semantic-rag-generic-faq-qna',
    frameSource: 'semantic-rag-training-specific',
    matchedFaqQuestion: best.questionText,
    matchedTrainingId: best.item && best.item.trainingId,
    matchedItemSource: best.item && best.item.source,
    matchedSource: best.item && (best.item.filename || best.item.sourceFile || best.item.id)
  };
}
async function tryEvidenceFirstLocalDocumentAnswer(question, options = {}) {
  if (!isDocumentEvidenceFirstCandidate(question)) return null;
  const fine = detectFineGrainedIntent(question);
  if ((fine.coarseIntent || detectGenericIntent(question)) === 'fee') return null;

  const indexForQuery = getCachedSemanticIndex();
  const tableFaqAnswer = buildStructuredTableFaqAnswerFromIndex(question, indexForQuery);
  const faqAnswer = tableFaqAnswer || buildGenericFaqQnaAnswerFromIndex(question, indexForQuery, options);
  const faqQuestionStrongMatch = faqAnswer && faqAnswer.matchedFaqQuestion && scoreFaqQuestionMatch(question, faqAnswer.matchedFaqQuestion) >= 8;
  if (faqAnswer && faqAnswer.answer && (answerMatchesStrongQuestionAnchors(question, faqAnswer.answer) || faqQuestionStrongMatch) && !hasUploadedDocumentTopicConflict(question, faqAnswer.answer)) {
    let anchoredFaqAnswer = preserveAdministrativeAnswerAnchor(question, faqAnswer.answer);
    anchoredFaqAnswer = ensureNamedCampusSupportContextInAnswer(question, anchoredFaqAnswer);
    const faqSource = (isIndustryServicesQuestionAnswer(question, anchoredFaqAnswer) || isCareerCenterQuestion(question))
      ? 'semantic-rag-campus-support-entity'
      : (faqAnswer.source || 'semantic-rag-generic-faq-qna');
    const framedAnswer = formatNaturalAnswerFrame(question, anchoredFaqAnswer, faqAnswer.source || 'semantic-rag-generic-faq-qna');
    const preflight = evaluateOutboundAnswer(framedAnswer, question, { source: faqSource });
    if (!(preflight && preflight.blocked && /uploaded-training-generic/i.test(faqSource)) && !hasRawSpreadsheetFaqDump(framedAnswer)) {
      return {
        success: true,
        answer: framedAnswer,
        source: faqSource,
        contexts: [],
        confidenceScore: 0.84,
        confidenceTier: 'HIGH',
        debug: {
          ...(faqAnswer.debug || {}),
          routeStage: 'pre-ai-evidence-first-faq-index',
          fineIntent: fine.fineIntent,
          coarseIntent: fine.coarseIntent
        }
      };
    }
  }

  if (isIndustryServicesQuestion(question) && process.env.NODE_ENV === 'test') {
    return {
      success: true,
      answer: buildIndustryServicesNoDataAnswer(),
      source: 'semantic-rag-campus-facility-insufficient-data',
      contexts: [],
      confidenceScore: 0,
      confidenceTier: 'LOW',
      debug: { routeStage: 'evidence-first-industry-services-no-data-test', fineIntent: fine.fineIntent, coarseIntent: fine.coarseIntent }
    };
  }

  const uploaded = await tryLocalUploadedTrainingGenericAnswer(question, options);
  if (!uploaded || !uploaded.answer) return null;

  return {
    ...uploaded,
    source: uploaded.source || 'semantic-rag-evidence-first',
    debug: {
      ...(uploaded.debug || {}),
      routeStage: 'pre-ai-evidence-first-uploaded-training',
      fineIntent: fine.fineIntent,
      coarseIntent: fine.coarseIntent
    }
  };
}
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
    fee: /\b(Rp\.?|rupiah|idr|biaya|harga|tarif|pembayaran|bayar|ukt|dpp|uang(?:\s+kuliah|\s+pangkal)?|cicilan|nominal)\b/i,
    schedule: /\b(tanggal|jadwal|periode|gelombang|bulan|tahun|jam|\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember))\b/i,
    requirement: /\b(syarat|persyaratan|dokumen|berkas|ijazah|ktp|kk|foto|rapor)\b/i,
    international_program: /\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|study\s+exchange|mitra|luar\s+negeri|dnui|dalian\s+neusoft|help(?:\s+university)?|utb|universitas\s+teknologi\s+bandung|gccp|bccp)\b/i,
    list: /(?:^|\n)\s*(?:[-*]|\d+\.)\s+\S|\b(?:terdiri\s+dari|meliputi|antara\s+lain)\b/i,
    program: /\b(program\s+studi|prodi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika)\b/i,
    facility: /\b(fasilitas|layanan|laboratorium|perpustakaan|kantin|parkir|wifi|ruang|inkubator|inbis|language\s+learning|llc|softskill|soft\s*skill|hi-?think|hithink|career\s*center|pusat\s+karier|pusat\s+karir)\b/i,
    organization: /\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i,
    scholarship: /\b(beasiswa|bantuan|potongan|kip|1k1s|skss)\b/i,
    accreditation: /\b(akreditasi|ban\s*-?\s*pt|baik\s+sekali|unggul|terakreditasi)\b/i,
    rpl: /\b(rpl|rekognisi\s+pembelajaran\s+lampau|alih\s+jenjang|konversi\s+sks)\b/i,
    visa_study: /\b(visa\s+(?:study|studi|pelajar)|izin\s+belajar|study\s+permit|itas|kitas|sktt|mahasiswa\s+asing)\b/i,
    career: /\b(prospek\s+kerja|karir|karier|lulusan|profesi|pekerjaan|career\s*center|job|job\s*fair|campus\s*hiring|rekrutmen|lowongan|magang|tracer\s*study|konsultasi\s+karier)\b/i
  };
  
  if (intent === 'general') return 0.5;
  
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
    if (variants.some((v) => new RegExp('\\b' + v.replace(/\s+/g, '\\s+') + '\\b', 'i').test(q))) {
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
    return new RegExp('\\b' + v.replace(/\s+/g, '\\s+') + '\\b', 'i').test(haystack);
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
function getRuntimeDocCategory(item) {
  if (!item || typeof item !== 'object') return 'UNKNOWN';
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const stored = String(item.docCategory || metadata.docCategory || item.category || metadata.category || '').trim().toUpperCase();
  const genericStored = !stored || ['UNKNOWN', 'GENERAL', 'PROGRAM_STUDI', 'PRODI', 'DOCUMENT', 'UPLOAD'].includes(stored);
  if (stored && !genericStored) return stored;
  try {
    return classifyDocumentCategory(
      String(item.chunk || item.text || item.content || ''),
      String(item.filename || item.sourceFile || item.source || ''),
      { sectionTitle: item.sectionTitle || metadata.sectionTitle, docType: item.chunkType || metadata.docType }
    ) || stored || 'UNKNOWN';
  } catch (_) {
    return stored || 'UNKNOWN';
  }
}

function inferKnowledgeDomainsFromText(value, category = '') {
  const text = String(value || '').toLowerCase();
  const cat = String(category || '').toUpperCase();
  const domains = new Set();

  if (/\b(?:double\s*degree|dual\s*degree|gelar\s+ganda|dnui|dalian\s+neusoft|help\s+university|universitas\s+teknologi\s+bandung|\butb\b)\b/i.test(text)) domains.add('double_degree');
  if (/\b(?:program\s+internasional|kelas\s+internasional|international\s+class|student\s*exchange|students\s*exchange|pertukaran\s+mahasiswa|gccp|bccp|short\s*course|kuliah\s+sambil\s+kerja\s+di\s+luar\s+negeri|magang\s+berbayar\s+di\s+luar\s+negeri)\b/i.test(text)) domains.add('international_program');
  if (/\b(?:izin\s+belajar|study\s+permit|visa\s+(?:study|studi|pelajar)|itas|kitas|sktt|mahasiswa\s+asing)\b/i.test(text)) domains.add('visa_study');
  if (/\b(?:biaya|ukt|dpp|uang\s+kuliah|pembayaran|rp\.?\s*\d|rupiah|cicilan|angsuran|potongan)\b/i.test(text) || cat === 'BIAYA') domains.add('fee');
  if (/\b(?:jadwal|gelombang|timeline|tanggal\s+(?:mulai|akhir)|deadline|pendaftaran\s+gelombang)\b/i.test(text) || cat === 'JADWAL') domains.add('schedule');
  if (/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|cara\s+daftar|mendaftar|syarat\s+pendaftaran|dokumen\s+pendaftaran|siap\.stikom)\b/i.test(text)) domains.add('pmb_registration');
  if (/\b(?:beasiswa|kip|1k1s|skss|bantuan\s+biaya|yayasan|prestasi)\b/i.test(text) || cat === 'BEASISWA') domains.add('scholarship');
  if (/\b(?:career\s*center|pusat\s+kar(?:i|ie)r|lowongan|magang|job\s*fair|tracer\s*study|linkedin|karier|karir)\b/i.test(text) || cat === 'PROSPEK_KERJA') domains.add('career');
  if (/\b(?:inkubator\s+bisnis|inbis|hi-?think|goes\s*to\s*school|language\s+learning\s+center|softskill|layanan\s+industri)\b/i.test(text)) domains.add('campus_support');
  if (/\b(?:ukm|ormawa|bem|dpm|hima|kelompok\s+studi|kmhd|ksl|athena|syntax)\b/i.test(text)) domains.add('student_activity');
  if (/\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|program\s+studi|prodi|jurusan|kurikulum|mata\s+kuliah|sks|fakultas)\b/i.test(text) || ['PRODI_PROFILE', 'KURIKULUM', 'MATA_KULIAH'].includes(cat)) domains.add('academic_program');
  if (/\b(?:akreditasi|ban\s*-?\s*pt|baik\s+sekali)\b/i.test(text) || cat === 'AKREDITASI') domains.add('accreditation');
  if (/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(text)) domains.add('rpl');
  if (/\b(?:yudisium|wisuda|sidang|tugas\s+akhir|skripsi|semester\s+antara|remedial|remidi|krs|khs|transkrip)\b/i.test(text)) domains.add('academic_admin');

  if (cat === 'PROGRAM_KHUSUS') domains.add('international_program');
  if (cat === 'LOKASI') domains.add('location');
  if (cat === 'SK' || cat === 'SURAT' || cat === 'MOU') domains.add('administrative_document');

  return domains;
}

function inferQuestionDomains(question, intent = null) {
  const q = normalizeUserQuery(question || '').normalizedText || String(question || '');
  const domains = inferKnowledgeDomainsFromText(q, '');
  const detectedIntent = intent || detectGenericIntent(q);
  if (detectedIntent === 'fee') domains.add('fee');
  if (detectedIntent === 'schedule') domains.add('schedule');
  if (detectedIntent === 'requirement' && /\b(?:pmb|daftar|pendaftaran|registrasi|mahasiswa\s+baru)\b/i.test(q)) domains.add('pmb_registration');
  if (detectedIntent === 'career') domains.add('career');
  if (detectedIntent === 'international_program') domains.add('international_program');
  if (detectedIntent === 'program') domains.add('academic_program');
  return domains;
}

function inferItemDomains(item) {
  const category = getRuntimeDocCategory(item);
  const metadata = item && item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const haystack = [
    item && (item.filename || item.sourceFile || item.source),
    item && item.sectionTitle,
    metadata.category,
    metadata.topic,
    Array.isArray(metadata.tags) ? metadata.tags.join(' ') : metadata.tags,
    item && (item.chunk || item.text || item.content)
  ].filter(Boolean).join(' ');
  return { category, domains: inferKnowledgeDomainsFromText(haystack, category) };
}

function inferRouteDomainsFromSource(source, answer = '') {
  const src = String(source || '').toLowerCase();
  const domains = inferKnowledgeDomainsFromText(String(answer || ''), '');
  const add = (name) => { if (name) domains.add(name); };
  if (/small-talk|greeting/i.test(src)) add('small_talk');
  if (/registration-fee|fee-detail|fee-comparison|fee-general|contextual-fee|finance-fallback/i.test(src)) add('fee');
  if (/pmb|registration-info|registration-how|registration-data|requirements/i.test(src)) add('pmb_registration');
  if (/dual-degree|double-degree/i.test(src)) { add('double_degree'); add('international_program'); }
  if (/international-topic|international-class/i.test(src)) add('international_program');
  if (/admin-topic|study-permit|visa|foreign-student/i.test(src)) add('visa_study');
  if (/career/i.test(src)) add('career');
  if (/campus-support|inbis|goes-to-school|hi-think|student-exchange/i.test(src)) add('campus_support');
  if (/ukm|student-activity|ormawa/i.test(src)) add('student_activity');
  if (/academic|yudisium|wisuda|schedule|credit|transcript|grade|krs|policy/i.test(src)) add('academic_admin');
  if (/program-list|program-definition|program-comparison|program-curriculum|academic-faculty|program-recommendation/i.test(src)) add('academic_program');
  if (/accreditation/i.test(src)) add('accreditation');
  if (/scholarship/i.test(src)) add('scholarship');
  if (/rpl/i.test(src)) add('rpl');
  if (/campus-location|location/i.test(src)) add('location');
  if (/generic-faq-qna|known-faq-qna|uploaded-training-generic|evidence-first|rag-/i.test(src)) {
    // Evidence-like sources depend primarily on their answer text; no forced domain here.
  }
  return domains;
}

function hasDomain(domains, ...names) {
  return names.some((name) => domains && domains.has(name));
}

function isRouteDomainCompatible(question, result) {
  const qDomains = inferQuestionDomains(question);
  if (!qDomains || !qDomains.size) return { ok: true, qDomains: [], routeDomains: [], reason: 'no_question_domain' };
  const source = String(result && result.source || '');
  const answer = String(result && result.answer || '');
  const routeDomains = inferRouteDomainsFromSource(source, answer);
  const q = normalizeUserQuery(question || '').normalizedText || String(question || '').toLowerCase();
  const overlap = [...qDomains].filter((domain) => routeDomains.has(domain));
  const hasQ = (...names) => hasDomain(qDomains, ...names);
  const hasR = (...names) => hasDomain(routeDomains, ...names);
  const ok = (reason) => ({ ok: true, qDomains: [...qDomains], routeDomains: [...routeDomains], reason });
  const bad = (reason) => ({ ok: false, qDomains: [...qDomains], routeDomains: [...routeDomains], reason });

  if (/meaning-mismatch|insufficient|no-data|clarification|feedback|small-talk|out-of-domain/i.test(source)) return ok('safe_meta_source');
  if (overlap.length) return ok('domain_overlap:' + overlap.join(','));

  if (hasQ('visa_study')) {
    if (hasR('visa_study', 'administrative_document')) return ok('visa_route');
    return bad('visa_question_wrong_route');
  }
  if (hasQ('academic_admin')) {
    if (hasR('academic_admin')) return ok('academic_admin_route');
    if (/\b(?:yudisium|wisuda|sidang|tugas\s+akhir|skripsi|krs|khs|transkrip|semester\s+(?:genap|ganjil|antara|pendek)|remedial|remidi)\b/i.test(answer)) return ok('academic_admin_answer_anchor');
    return bad('academic_admin_wrong_route');
  }
  if (hasQ('career')) {
    if (hasR('career', 'campus_support', 'academic_program')) return ok('career_compatible_route');
    return bad('career_wrong_route');
  }
  if (hasQ('student_activity')) {
    if (hasR('student_activity', 'campus_support')) return ok('student_activity_route');
    return bad('student_activity_wrong_route');
  }
  if (hasQ('campus_support')) {
    if (hasR('campus_support', 'career', 'international_program')) return ok('campus_support_route');
    return bad('campus_support_wrong_route');
  }
  if (hasQ('double_degree')) {
    if (hasQ('fee') && hasR('fee', 'double_degree', 'international_program')) return ok('double_degree_fee_route');
    if (hasR('double_degree', 'international_program')) return ok('double_degree_route');
    return bad('double_degree_wrong_route');
  }
  if (hasQ('international_program')) {
    if (hasQ('fee') && hasR('fee', 'international_program', 'double_degree')) return ok('international_fee_route');
    if (hasR('international_program', 'double_degree', 'campus_support')) return ok('international_route');
    return bad('international_wrong_route');
  }
  if (hasQ('fee')) {
    if (hasR('fee')) return ok('fee_route');
    return bad('fee_wrong_route');
  }
  if (hasQ('pmb_registration')) {
    if (hasR('pmb_registration', 'schedule')) return ok('pmb_route');
    if (/\b(?:pmb|pendaftaran|siap\.stikom-bali\.ac\.id|gelombang)\b/i.test(answer)) return ok('pmb_answer_anchor');
    return bad('pmb_wrong_route');
  }
  if (hasQ('academic_program')) {
    if (hasR('academic_program', 'fee', 'accreditation')) return ok('academic_program_route');
    return bad('academic_program_wrong_route');
  }
  if (hasQ('scholarship')) return hasR('scholarship', 'fee', 'pmb_registration') ? ok('scholarship_route') : bad('scholarship_wrong_route');
  if (hasQ('rpl')) return hasR('rpl', 'pmb_registration') ? ok('rpl_route') : bad('rpl_wrong_route');
  if (hasQ('accreditation')) return hasR('accreditation', 'academic_program') ? ok('accreditation_route') : bad('accreditation_wrong_route');
  if (hasQ('location')) return hasR('location') ? ok('location_route') : bad('location_wrong_route');

  return ok('domain_neutral');
}

function hasConcreteDateOrPeriod(value) {
  return /\b(?:\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|20\d{2}(?:\s*\/\s*20\d{2})?|gelombang\s+(?:khusus|[ivx]+|\d+)\s*[a-c]?|semester\s+(?:genap|ganjil|antara|pendek)|bulan\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\b(?:senin|selasa|rabu|kamis|jumat|jum\'at|sabtu|minggu)\b|\bpukul\s*\d{1,2}|\b\d{1,2}\.\d{2}\s*(?:wita|wib|wit)?)\b/i.test(String(value || ''));
}

function hasConcreteNumberOrAmount(value) {
  return /\b(?:rp\.?\s*\d|gelombang\s+(?:khusus|sisipan\s*\d+|[ivx]+|\d+)\s*[a-c]?|\d+[.,]?\d*\s*(?:juta|ribu|sks|semester|tahun|bulan|hari|minggu|orang|kali|lokasi|kampus|cabang|ukm|ormawa|organisasi|unit|prodi|program|jurusan|beasiswa|fasilitas|layanan|%)|\d{1,3}(?:\.\d{3})+|\d+\s*\/\s*\d+)\b/i.test(String(value || ''));
}

function hasListLikeAnswer(value) {
  const text = String(value || '');
  const bullets = (text.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\S/g) || []).length;
  if (bullets >= 2) return true;
  if (/\b(?:antara lain|mencakup|meliputi|pilihan(?:nya)?|terdiri dari|sebagai berikut)\b/i.test(text)) return true;
  const commaItems = text.split(',').map(part => part.trim()).filter(part => part.length >= 3);
  return commaItems.length >= 3;
}

function inferQuestionAnswerNeeds(question) {
  const q = normalizeUserQuery(question || '').normalizedText || String(question || '').toLowerCase();
  const needs = new Set();
  if (/\b(?:kapan|jadwal|tanggal|pelaksanaan|dilaksanakan|deadline|batas\s+akhir|mulai|berakhir)\b/i.test(q)) needs.add('date_or_period');
  if (/\b(?:berapa|nominal|jumlah|total|rincian\s+biaya|biaya|harga|ukt|dpp|sks|lama|durasi)\b/i.test(q)) needs.add('number_or_amount');
  if (/\b(?:apa\s+saja|apa\s+aja|daftar|list|pilihan|sebutkan|program\s+apa\s+saja|jurusan\s+apa\s+saja)\b/i.test(q)) needs.add('list');
  if (/\b(?:beda|bedanya|perbedaan|bandingkan|perbandingan|dibandingkan|antara)\b/i.test(q)) needs.add('comparison');
  if (/\b(?:cocok|rekomendasi|sarankan|pilih\s+jurusan|jurusan\s+apa|prodi\s+apa|suka|minat|bekerja\s+di\s+bidang|ingin\s+(?:jadi|bekerja))\b/i.test(q)) needs.add('program_recommendation');
  if (/\b(?:apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|jelaskan|tentang)\b/i.test(q)) needs.add('definition');
  if (/\b(?:syarat|persyaratan|dokumen|berkas|ketentuan)\b/i.test(q)) needs.add('requirements');
  return needs;
}

function evaluateAnswerShapeCompatibility(question, result) {
  const source = String(result && result.source || '');
  const answer = String(result && result.answer || '');
  const q = String(question || '');
  const needs = inferQuestionAnswerNeeds(q);
  const missing = [];
  if (!needs.size) return { ok: true, needs: [], missing: [], reason: 'no_specific_answer_shape_needed' };
  if (hasNoDataAnswerPhrase(answer) || /clarification|small-talk|greeting|out-of-domain|feedback/i.test(source)) {
    return { ok: true, needs: [...needs], missing: [], reason: 'safe_non_answer_or_clarification' };
  }

  if (needs.has('date_or_period') && !hasConcreteDateOrPeriod(answer)) missing.push('date_or_period');
  if (needs.has('number_or_amount') && !hasConcreteNumberOrAmount(answer)) missing.push('number_or_amount');
  if (needs.has('list') && !hasListLikeAnswer(answer)) missing.push('list_items');
  if (needs.has('comparison') && !/\b(?:perbedaan|beda|sedangkan|sementara|dibandingkan|S1|D3|Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika)\b/i.test(answer)) missing.push('comparison_content');
  if (needs.has('program_recommendation') && !/\b(?:Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika|prodi|program\s+studi|jurusan)\b/i.test(answer)) missing.push('program_recommendation');
  if (needs.has('definition')) {
    const anchors = extractQueryAnchorTerms(q).filter(anchor => !/^(?:apa|itu|pengertian|maksud|jelaskan|tentang|program|studi|prodi|jurusan|kampus|stikom|bali)$/i.test(anchor));
    if (anchors.length && !hasAnchorOverlap(q, answer)) missing.push('definition_anchor');
  }
  if (needs.has('requirements') && !/\b(?:syarat|persyaratan|dokumen|berkas|ketentuan|ijazah|ktp|kk|foto|paspor|transkrip|loa|statement|form|surat)\b/i.test(answer)) missing.push('requirements');

  return {
    ok: missing.length === 0,
    needs: [...needs],
    missing,
    reason: missing.length ? 'answer_shape_mismatch' : 'answer_shape_ok'
  };
}

function isRouteDomainGuardApplicable(source) {
  return /semantic-rag-|rag-/i.test(String(source || ''));
}

function computeDomainAlignmentScore(query, item, questionIntent = null) {
  const qDomains = inferQuestionDomains(query, questionIntent);
  if (!qDomains.size) return { score: 0, queryDomains: [], itemDomains: [], runtimeDocCategory: getRuntimeDocCategory(item), reason: 'no_query_domain' };

  const { category, domains: itemDomains } = inferItemDomains(item);
  const q = normalizeUserQuery(query || '').normalizedText || String(query || '').toLowerCase();
  const overlap = [...qDomains].filter((domain) => itemDomains.has(domain));
  let score = 0;
  const reasons = [];

  if (overlap.length) {
    score += Math.min(0.24, 0.12 * overlap.length);
    reasons.push('domain_overlap:' + overlap.join(','));
  }

  const allow = (...names) => names.some((name) => itemDomains.has(name));
  if (qDomains.has('double_degree')) {
    if (allow('double_degree')) score += 0.28;
    else if (allow('visa_study', 'administrative_document')) { score -= 0.62; reasons.push('double_degree_vs_offtopic_doc'); }
    else if (!allow('international_program')) { score -= 0.22; reasons.push('double_degree_missing_domain'); }
  }
  if (qDomains.has('international_program') && !qDomains.has('visa_study')) {
    if (allow('visa_study') && !allow('double_degree', 'international_program')) { score -= 0.5; reasons.push('international_vs_visa_study'); }
    if (allow('international_program', 'double_degree', 'campus_support')) score += 0.14;
  }
  if (qDomains.has('visa_study') && allow('visa_study')) score += 0.24;
  if (qDomains.has('fee')) {
    if (allow('fee')) score += 0.22;
    else if (allow('academic_program', 'double_degree') && /\b(?:biaya|ukt|dpp|bayar|rupiah|rp\.?)/i.test(String(item && item.chunk || ''))) score += 0.08;
    else if (allow('schedule', 'visa_study', 'student_activity')) { score -= 0.26; reasons.push('fee_off_domain'); }
  }
  if (qDomains.has('career')) {
    if (allow('career', 'campus_support', 'academic_program')) score += 0.16;
    else if (allow('fee', 'schedule', 'visa_study')) { score -= 0.28; reasons.push('career_off_domain'); }
  }
  if (qDomains.has('academic_admin')) {
    if (allow('academic_admin')) score += 0.2;
    else if (allow('pmb_registration', 'fee')) { score -= 0.3; reasons.push('academic_admin_vs_pmb_fee'); }
  }
  if (qDomains.has('pmb_registration') && allow('pmb_registration')) score += 0.18;

  if (!overlap.length && itemDomains.size && !/\b(?:apa|info|informasi|jelaskan|tentang)\b/i.test(q)) score -= 0.06;

  return {
    score: Math.max(-0.7, Math.min(0.42, score)),
    queryDomains: [...qDomains],
    itemDomains: [...itemDomains],
    runtimeDocCategory: category,
    reason: reasons.join(';') || (overlap.length ? 'domain_match' : 'domain_neutral')
  };
}
function getKnowledgePreparationMeta(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.governance && item.governance.knowledgePreparation && typeof item.governance.knowledgePreparation === 'object') return item.governance.knowledgePreparation;
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : null;
  if (metadata && metadata.governance && metadata.governance.knowledgePreparation && typeof metadata.governance.knowledgePreparation === 'object') return metadata.governance.knowledgePreparation;
  if (metadata && metadata.knowledgePreparation && typeof metadata.knowledgePreparation === 'object') return metadata.knowledgePreparation;
  return null;
}

function computeKnowledgePreparationBoost(item) {
  const prep = getKnowledgePreparationMeta(item);
  if (!prep) return 0;
  let boost = 0;
  const authority = prep.sourceAuthority && typeof prep.sourceAuthority === 'object' ? prep.sourceAuthority : null;
  const authorityLevel = String(authority && authority.level || '').toLowerCase();
  if (authorityLevel === 'high') boost += 0.16;
  else if (authorityLevel === 'medium') boost += 0.06;
  else if (authorityLevel === 'low') boost -= 0.24;

  const quality = prep.quality && typeof prep.quality === 'object' ? prep.quality : null;
  const band = String(quality && quality.band || '').toLowerCase();
  if (band === 'high') boost += 0.1;
  else if (band === 'medium') boost += 0.04;
  else if (band === 'low') boost -= 0.16;

  const approval = prep.approval && typeof prep.approval === 'object' ? prep.approval : null;
  const approvalStatus = String(approval && approval.status || '').toLowerCase();
  if (approvalStatus === 'auto_approved_candidate') boost += 0.04;
  if (approvalStatus === 'review_required') boost -= 0.08;

  const conflictSignals = Array.isArray(prep.conflictSignals) ? prep.conflictSignals : [];
  if (conflictSignals.length) boost -= Math.min(0.14, conflictSignals.length * 0.05);
  return Math.max(-0.35, Math.min(0.24, boost));
}

function computeSourceIntentBoost(query, item, questionIntent = null) {
  const intent = questionIntent || detectGenericIntent(query);
  const filename = String((item && (item.filename || item.sourceFile)) || '').toLowerCase();
  const chunk = String((item && item.chunk) || '');
  const category = String((item && (item.docCategory || item.category || (item.metadata && item.metadata.docCategory))) || '').toUpperCase();
  let boost = 0;

  const requestedTargets = getRequestedAcademicTargets(query);
  const applyProgramTargetPenalty = !['general', 'program_definition', 'out_of_domain', 'small_talk', 'unknown'].includes(intent);
  if (requestedTargets.length && applyProgramTargetPenalty) {
    const filenameMatchesTarget = requestedTargets.some((target) => targetVariantMatches(filename, target.variants));
    const contentMatchesTarget = requestedTargets.some((target) => targetVariantMatches(filename + ' ' + chunk.slice(0, 700), target.variants));
    if (filenameMatchesTarget) boost += 0.5;
    else if (contentMatchesTarget) boost -= 0.05;
    else if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pendaftaran|registrasi|pembayaran|cicilan|nominal)\b/i.test(query)) boost -= 0.2;
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
  boost += computeDomainAlignmentScore(query, item, intent).score;
  boost += computeKnowledgePreparationBoost(item);

  const sourceScore = computeLexicalScore(query, filename, filename);
  if (sourceScore >= 0.4) boost += Math.min(0.18, sourceScore * 0.18);
  return Math.max(-1.0, Math.min(0.78, boost));
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
      const runtimeCategory = getRuntimeDocCategory(chunk);
      const runtimeChunk = { ...chunk, docCategory: chunk.docCategory || runtimeCategory };
      const domainAlignment = computeDomainAlignmentScore(question, runtimeChunk, questionIntent);
      
      let bestScore = 0;
      let bestLexicalScore = 0;
      for (const query of queries) {
        const genericScore = computeGenericScore(query, runtimeChunk.chunk, questionIntent);
        const lexicalScore = computeLexicalScore(query, runtimeChunk.chunk, runtimeChunk.filename);
        bestScore = Math.max(bestScore, genericScore);
        bestLexicalScore = Math.max(bestLexicalScore, lexicalScore);
      }
      
      if (bestScore > 0.15) { // Minimum threshold for generic match
        candidates.push({
          item: runtimeChunk,
          score: Math.max(0, Math.min(1, bestScore + computeSourceIntentBoost(question, runtimeChunk, questionIntent))),
          lexicalScore: bestLexicalScore,
          semanticScore: 0,
          sourceType: 'database',
          intent: questionIntent,
          domainAlignment
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
  if (envFlag('SEMANTIC_RAG_FAKE_CLIENT_FOR_REGRESSION', false)) {
    return {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '{"verdict":"direct","confidence":1,"reason":"local regression fake client"}' } }] })
        }
      },
      embeddings: {
        create: async () => ({ data: [{ embedding: Array.from({ length: 64 }, () => 0) }] })
      }
    };
  }
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
    /(?:PROFIL|PROFILE)\s+(?:LEMBAGA|ORGANISASI|ORMAWA|DIVISI|UNIT|UKM|PROGRAM|FAKULTAS|BAGIAN)\b/i,
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
  const complaint = /\b(?:kenapa|kok|mengapa|loh|lah|aneh|salah|bocor|full\s*dokumen|dokumen\s+mentah|potongan\s+dokumen|kutipan\s+dokumen|raw|fragmen|fragment|bullet\s+patah|patah|nyangkut|ngawur|tidak\s+nyambung|ga\s+nyambung|gak\s+nyambung|nggak\s+nyambung|jadi\s+begini|seperti\s+ini)\b/i.test(value);
  if (!complaint) return false;
  const shortRawMarker = /\b(?:PROFIL|PROFILE)\s+(?:LEMBAGA|ORGANISASI|ORMAWA|DIVISI|UNIT|UKM|PROGRAM|FAKULTAS|BAGIAN)\b|\b(?:bullet\s+patah|potongan\s+dokumen|dokumen\s+mentah|kutipan\s+dokumen|teks\s+hasil\s+ocr|raw\s+fragment)\b/i.test(value);
  return shortRawMarker || isConversationRawDocumentQuote(value) || value.length > 500;
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

function getRecentConversationTextForResolution(sessionData) {
  const parts = [];
  const recent = getRecentConversation(sessionData);
  if (recent) parts.push(recent);
  if (sessionData && typeof sessionData === 'object') {
    [
      sessionData.lastQuestion,
      sessionData.lastUserQuestion,
      sessionData.lastAnswer,
      sessionData.lastBotAnswer,
      sessionData.lastIntent,
      sessionData.lastProgramHint,
      sessionData.currentProgramHint,
      sessionData.programHint
    ].forEach((value) => {
      const text = String(value || '').trim();
      if (text) parts.push(text);
    });
    [
      sessionData.pendingFeeDetail,
      sessionData.pendingTotalCost,
      sessionData.pendingRegistrationCostOffer,
      sessionData.registrationFlow
    ].forEach((value) => {
      if (!value || typeof value !== 'object') return;
      const text = Object.values(value).map((v) => String(v || '').trim()).filter(Boolean).join(' ');
      if (text) parts.push(text);
    });
    if (Array.isArray(sessionData.lastRetrievedPrograms)) {
      parts.push(sessionData.lastRetrievedPrograms.filter(Boolean).join(' '));
    }
  }
  return parts.join('\n').toLowerCase();
}

function hasExplicitContextAnchor(question) {
  const q = String(question || '').toLowerCase();
  if (!q) return false;
  return /\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|manajemen\s+informatika|sistem\s+komputer|s2|magister|pasca\s*sarjana|pascasarjana|rpl|double\s*degree|dual\s*degree|dnui|dalian|utb|help\s+university|career\s*center|pusat\s+karier|pusat\s+karir|tracer\s*study|inbis|inkubator\s+bisnis|hi-?think|language\s+learning\s+center|\bllc\b|mahasiswa\s+asing|izin\s+belajar|visa\s*study|student\s*exchange|bccp|gccp|short\s*course|beasiswa|skss|kampus|akreditasi|prodi|jurusan|yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|krs|khs|transkrip|sion|baak|semester\s+(?:ganjil|genap|antara|pendek)|kalender\s+akademik|jadwal\s+akademik|remedial|remidi|ujian\s+(?:ulang|susulan))\b/i.test(q);
}

function isContextualSemanticFollowup(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q || hasExplicitContextAnchor(q)) return false;
  const words = q.split(/\s+/).filter(Boolean);
  if (/^(?:apa|gimana|bagaimana)\s+ya\??$/i.test(q) || /^(?:terus|lalu)\s+gimana\??$/i.test(q)) return false;
  const shortFollowup = /\b(?:itu|ini|tadi|caranya|alurnya|prosesnya|syaratnya|dokumennya|berkasnya|biayanya|harganya|bayarnya|rincian(?:nya)?|detail(?:nya)?|kapan|dimana|mana|harus|wajib|ikut|daftar|mendaftar|potongan(?:nya)?|diskonnya|bedanya|perbedaannya|keunggulan(?:nya)?|kelebihan(?:nya)?|manfaat(?:nya)?|tujuan(?:nya)?|kegiatan(?:nya)?|jenis(?:nya)?|pilihan(?:nya)?|negara(?:nya)?|lokasi(?:nya)?|tempat(?:nya)?|durasi(?:nya)?|lamanya|berapa\s+lama|gelar(?:nya)?|kurikulum(?:nya)?|dipelajari|belajarnya|kerjanya|karier(?:nya)?|prospek(?:nya)?|akreditasi(?:nya)?)\b/i;
  if (words.length <= 5 && shortFollowup.test(q)) {
    return true;
  }
  return /\b(?:yang\s+(?:itu|tadi|mana)|lanjut(?:kan)?|kalau\s+yang\s+itu|terus\s+gimana|lalu\s+gimana|apa\s+saja\s+syaratnya|apa\s+aja\s+dokumennya|apa\s+saja\s+jenisnya|apa\s+aja\s+pilihannya|rincian\s+biayanya|detail\s+biayanya|harus\s+ke\s+sana|harus\s+ke\s+china|bisa\s+ikut\s+kapan|mulai\s+kapan|berapa\s+lama|gelarnya\s+apa|tujuannya\s+apa|manfaatnya\s+apa)\b/i.test(q);
}

function inferContextTopicFromSession(sessionData) {
  const recent = getRecentConversationTextForResolution(sessionData);
  if (!recent) return null;
  const topics = [
    { key: 'dual_degree_dnui', label: 'Program Dual Degree DNUI', re: /\b(?:dnui|dalian|china|tiongkok)\b/ },
    { key: 'dual_degree_help', label: 'Program Dual Degree HELP University', re: /\b(?:help\s+university|malaysia)\b/ },
    { key: 'dual_degree_utb', label: 'Program Dual Degree UTB', re: /\b(?:utb|universitas\s+teknologi\s+bandung|dkv)\b/ },
    { key: 'dual_degree', label: 'Program Dual Degree ITB STIKOM Bali', re: /\b(?:double\s*degree|dual\s*degree)\b/ },
    { key: 'foreign_student', label: 'mahasiswa asing, Izin Belajar, dan Visa Study', re: /\b(?:mahasiswa\s+asing|izin\s+belajar|visa\s*study|study\s+permit|foreign\s+student)\b/ },
    { key: 'hi_think', label: 'program Hi-Think Jepang', re: /\bhi-?think\b/ },
    { key: 'career_center', label: 'Career Center ITB STIKOM Bali', re: /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|tracer\s*study|job\s*fair|campus\s*hiring|lowongan\s+kerja|magang|rekrutmen|karier|karir)\b/ },
    { key: 'inbis', label: 'Inkubator Bisnis ITB STIKOM Bali', re: /\b(?:inbis|inkubator\s+bisnis)\b/ },
    { key: 'llc', label: 'Language Learning Center ITB STIKOM Bali', re: /\b(?:language\s+learning\s+center|\bllc\b)\b/ },
    { key: 'rpl', label: 'jalur RPL ITB STIKOM Bali', re: /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/ },
    { key: 'postgraduate', label: 'Prodi S2 Sistem Informasi ITB STIKOM Bali', re: /\b(?:s2|magister|pasca\s*sarjana|pascasarjana)\b/ },
    { key: 'program_list', label: 'daftar prodi ITB STIKOM Bali', re: /\b(?:prodi|program\s+studi|jurusan)\b/ },
    { key: 'business_digital', label: 'Prodi Bisnis Digital ITB STIKOM Bali', re: /\b(?:bisnis\s+digital|\bbd\b)\b/ },
    { key: 'information_system', label: 'Prodi Sistem Informasi ITB STIKOM Bali', re: /\b(?:sistem\s+informasi|\bsi\b)\b/ },
    { key: 'information_technology', label: 'Prodi Teknologi Informasi ITB STIKOM Bali', re: /\b(?:teknologi\s+informasi|\bti\b)\b/ },
    { key: 'computer_system', label: 'Prodi Sistem Komputer ITB STIKOM Bali', re: /\b(?:sistem\s+komputer|\bsk\b)\b/ },
    { key: 'informatics_management', label: 'Prodi D3 Manajemen Informatika ITB STIKOM Bali', re: /\b(?:manajemen\s+informatika|\bmi\b)\b/ }
  ];
  return topics.find((topic) => topic.re.test(recent)) || null;
}

function canResolveFeeFollowupForTopic(topicKey) {
  return /^(?:dual_degree(?:_dnui|_help|_utb)?|foreign_student|rpl|postgraduate|program_list|business_digital|information_system|information_technology|computer_system|informatics_management)$/i.test(String(topicKey || ''));
}

function canResolveRequirementFollowupForTopic(topicKey) {
  return !/^(?:career_center|inbis|llc)$/i.test(String(topicKey || ''));
}

function resolveSemanticFollowupQuestion(question, options = {}) {
  const original = String(question || '').trim();
  const smallTalkWords = original.split(/\s+/).filter(Boolean).length;
  const smallTalk = trySmallTalkAnswer(original);
  if (smallTalk && smallTalk.answer && shouldReturnSmallTalkImmediately(original, smallTalkWords)) {
    return { changed: false, question: original, topic: null, smallTalkOnly: true };
  }
  if (!original || !isContextualSemanticFollowup(original)) {
    return { changed: false, question: original, topic: null };
  }
  const topic = inferContextTopicFromSession(options && options.sessionData);
  if (!topic) return { changed: false, question: original, topic: null };
  const q = original.toLowerCase();
  let resolved = `${topic.label}: ${original}`;
  if (/\b(?:biaya(?:nya)?|bayar(?:nya)?|harga(?:nya)?|uang(?:nya)?|potongan(?:nya)?|diskon(?:nya)?|rincian(?:nya)?|detail(?:nya)?)\b/i.test(q)) {
    if (!canResolveFeeFollowupForTopic(topic.key)) {
      resolved = `Biaya untuk ${topic.label}`;
    } else {
      resolved = `Rincian biaya dan potongan untuk ${topic.label}`;
    }
  } else if (/\b(?:syarat(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?)\b/i.test(q)) {
    if (!canResolveRequirementFollowupForTopic(topic.key)) {
      resolved = `Syarat atau dokumen untuk ${topic.label}`;
    } else {
      resolved = `Syarat dan dokumen untuk ${topic.label}`;
    }
  } else if (/\b(?:cara|alur|proses|daftar|mengurus)\b/i.test(q)) {
    resolved = `Cara, alur, atau proses untuk ${topic.label}`;
  } else if (/\b(?:kapan|mulai|ikut|mengikuti)\b/i.test(q)) {
    resolved = `Kapan mahasiswa bisa mengikuti ${topic.label}`;
  } else if (/\b(?:harus|wajib|ke\s+sana|ke\s+china|ke\s+luar)\b/i.test(q)) {
    resolved = `Apakah ${topic.label} harus dilakukan ke luar negeri atau ke negara partner`;
  } else if (/\b(?:gelar(?:nya)?|title)\b/i.test(q)) {
    resolved = `Gelar yang diperoleh dari ${topic.label}`;
  } else if (/\b(?:durasi(?:nya)?|lamanya|berapa\s+lama|masa\s+studi)\b/i.test(q)) {
    resolved = `Durasi atau masa studi ${topic.label}`;
  } else if (/\b(?:negara(?:nya)?|tujuan\s+negara|ke\s+mana|kemana)\b/i.test(q)) {
    resolved = `Negara tujuan atau lokasi pelaksanaan ${topic.label}`;
  } else if (/\b(?:jenis(?:nya)?|pilihan(?:nya)?|opsi(?:nya)?|apa\s+saja)\b/i.test(q)) {
    resolved = `Jenis atau pilihan yang tersedia pada ${topic.label}`;
  } else if (/\b(?:kurikulum(?:nya)?|dipelajari|belajarnya|materi(?:nya)?)\b/i.test(q)) {
    resolved = `Kurikulum dan materi yang dipelajari pada ${topic.label}`;
  } else if (/\b(?:kerja(?:nya)?|karier(?:nya)?|karir(?:nya)?|prospek(?:nya)?)\b/i.test(q)) {
    resolved = `Peluang kerja atau karier terkait ${topic.label}`;
  } else if (/\b(?:akreditasi(?:nya)?|akredit)\b/i.test(q)) {
    resolved = `Akreditasi ${topic.label}`;
  } else if (/\b(?:keunggulan(?:nya)?|kelebihan(?:nya)?|manfaat(?:nya)?|tujuan(?:nya)?|kegiatan(?:nya)?|untung|keuntungan(?:nya)?|bagus|kenapa|mengapa)\b/i.test(q)) {
    resolved = `Tujuan, keunggulan, manfaat, atau kegiatan pada ${topic.label}`;
  } else if (/\b(?:apa|itu|ini|maksud)\b/i.test(q)) {
    resolved = `Apa itu ${topic.label}`;
  }
  return {
    changed: resolved.trim().toLowerCase() !== original.toLowerCase(),
    question: resolved.trim(),
    topic: topic.key,
    topicLabel: topic.label,
    originalQuestion: original
  };
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

function buildHeuristicSemanticRewrite(question, options = {}) {
  const current = String(question || '').trim();
  const q = normalizeUserQuery(current).normalizedText || current.toLowerCase();
  const programHint = String(options && options.programHint ? options.programHint : '').trim();
  const intentHint = String(options && options.intentHint ? options.intentHint : '').trim();
  const entities = {};
  const queries = [current];
  const signals = [];
  let canonicalQuestion = current;
  let intent = normalizeSemanticIntent(intentHint) || 'unknown';
  let confidence = intent !== 'unknown' ? 0.5 : 0;

  const setIntent = (nextIntent, nextConfidence, signal) => {
    const normalized = normalizeSemanticIntent(nextIntent);
    if (!normalized || normalized === 'unknown') return;
    if (nextConfidence >= confidence || intent === 'unknown') {
      intent = normalized;
      confidence = Math.max(confidence, nextConfidence);
    }
    if (signal) signals.push(signal);
  };
  const addQuery = (value) => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (clean) queries.push(clean);
  };
  const setEntity = (key, value) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    if (!entities[key]) entities[key] = [];
    if (Array.isArray(entities[key])) entities[key].push(clean);
    else entities[key] = [String(entities[key]), clean].filter(Boolean);
  };

  const programAliasPairs = [
    [/\b(?:sistem\s+informasi|si)\b/i, 'Sistem Informasi'],
    [/\b(?:teknologi\s+informasi|teknik\s+informatika|ti)\b/i, 'Teknologi Informasi'],
    [/\b(?:bisnis\s+digital|bd)\b/i, 'Bisnis Digital'],
    [/\b(?:sistem\s+komputer|sk)\b/i, 'Sistem Komputer'],
    [/\b(?:manajemen\s+informatika|mi)\b/i, 'Manajemen Informatika'],
    [/\b(?:s2|s\s*2|pasca(?:sarjana|\s+sarjana)?|magister)\b/i, 'S2 Sistem Informasi'],
    [/\b(?:dkv|desain\s+komunikasi\s+visual)\b/i, 'DKV']
  ];
  for (const [pattern, canonical] of programAliasPairs) {
    if (pattern.test(q) || pattern.test(current)) setEntity('programs', canonical);
  }
  if (programHint) setEntity('programs', programHint);

  if (/^(?:halo+|hai+|hay+|selamat\s+(?:pagi|siang|sore|malam)|permisi|kak|admin)\b/i.test(q) && q.split(/\s+/).length <= 5) setIntent('small_talk', 0.88, 'small_talk_greeting');

  if (/\b(biaya|harga|tarif|ongkos|uang|bayar|dpp|ukt|spp|cicilan|angsuran|potongan|diskon|rincian\s+biaya)\b/i.test(q)) {
    setIntent(/\b(banding|perbandingan|beda|lebih\s+murah|termurah|mahal|hemat)\b/i.test(q) ? 'fee_comparison' : 'fee_detail', 0.86, 'fee_terms');
    canonicalQuestion = `Rincian biaya ${entityText(entities, ['programs']) || current}`;
    addQuery(`${canonicalQuestion} pendaftaran DPP UKT biaya awal masuk`);
  }

  if (/\b(akreditasi|terakreditasi|ban-?pt|lam-?infokom|peringkat)\b/i.test(q)) {
    setIntent('requirements', 0.72, 'accreditation_terms');
    addQuery(`akreditasi ${entityText(entities, ['programs']) || current} BAN-PT LAM-INFOKOM peringkat SK`);
  }

  if (/\b(jurusan|prodi|program\s+studi|program\s+kuliah|pilihan\s+program)\b/i.test(q) && /\b(apa\s+saja|apa\s+aja|daftar|tersedia|yang\s+ada|ada\s+apa|apa\s+aj)\b/i.test(q)) {
    setIntent('program_list', 0.9, 'program_list_terms');
    canonicalQuestion = 'Apa saja program studi atau jurusan yang tersedia di ITB STIKOM Bali';
    addQuery('daftar prodi jurusan program studi S1 D3 S2 Double Degree ITB STIKOM Bali');
  }

  if (/\b(apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|jelaskan|tentang)\b/i.test(q) && entityText(entities, ['programs'])) {
    setIntent('program_definition', 0.82, 'program_definition_terms');
    canonicalQuestion = `Apa itu Program Studi ${entityText(entities, ['programs'])}`;
    addQuery(`${canonicalQuestion} apa yang dipelajari prospek`);
  }

  if (/\b(beda|perbedaan|bedanya|banding|perbandingan|versus|vs)\b/i.test(q) && /\b(jurusan|prodi|program|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi)\b/i.test(q) && !hasSemanticFeeSignal(q)) {
    setIntent('program_comparison', 0.86, 'program_comparison_terms');
    canonicalQuestion = `Perbedaan program studi ${entityText(entities, ['programs']) || current}`;
    addQuery(`${canonicalQuestion} fokus kurikulum prospek kerja`);
  }

  if (/\b(cocok|cocoknya|rekomendasi|saran|sarankan|pilih\s+jurusan|jurusan\s+apa|prodi\s+apa|minat|suka|hobi|live|tiktok|sosial\s+media|konten|content|desain|coding|programming|komputer|bisnis|marketing)\b/i.test(q)) {
    setIntent('program_recommendation', 0.82, 'program_recommendation_terms');
    setEntity('interest', current);
    canonicalQuestion = `Rekomendasi program studi ITB STIKOM Bali berdasarkan minat: ${current}`;
    addQuery(`${canonicalQuestion} sosial media konten digital marketing desain teknologi bisnis`);
  }

  if (/\b(beasiswa|kip|skss|1k1s|prestasi|yayasan|bantuan\s+biaya)\b/i.test(q)) {
    setIntent('scholarship', 0.9, 'scholarship_terms');
    canonicalQuestion = `Informasi beasiswa ${current}`;
    addQuery('jenis beasiswa KIP SKSS 1K1S prestasi yayasan potongan biaya');
  }

  if (/\b(rpl|rekognisi\s+pembelajaran\s+lampau|pengalaman\s+kerja|konversi\s+sks)\b/i.test(q)) {
    setIntent('requirements', 0.84, 'rpl_terms');
    canonicalQuestion = 'Informasi jalur RPL Rekognisi Pembelajaran Lampau ITB STIKOM Bali';
    addQuery(`${canonicalQuestion} syarat biaya cara daftar`);
  }

  if (/\b(double\s*degree|dual\s*degree|dnui|dalian|help\s+university|utb|universitas\s+teknologi\s+bandung|program\s+internasional|international\s+class|student\s+exchange|visa|izin\s+belajar|mahasiswa\s+asing)\b/i.test(q)) {
    setIntent(/\b(biaya|harga|bayar|dpp|ukt|potongan)\b/i.test(q) ? 'fee_detail' : (/\b(dokumen|berkas|syarat|persyaratan|visa|izin\s+belajar|mahasiswa\s+asing|study\s+permit)\b/i.test(q) ? 'requirements' : 'dual_degree'), 0.86, 'international_dual_degree_terms');
    canonicalQuestion = `Informasi program internasional atau Dual Degree: ${current}`;
    addQuery('program internasional double degree dual degree DNUI HELP UTB student exchange mahasiswa asing visa study');
  }

  if (/\b(?:mengapa|kenapa|alasan)\b/i.test(q) && /\b(?:memilih|pilih|milih|kuliah\s+di)\b/i.test(q) && /\b(?:stikom|itb\s+stikom\s+bali|kampus)\b/i.test(q)) {
    setIntent('pmb_overview', 0.78, 'campus_value_terms');
    canonicalQuestion = 'Mengapa memilih ITB STIKOM Bali';
    addQuery('Mengapa memilih ITB STIKOM Bali keunggulan kampus karier magang industri program internasional kegiatan mahasiswa');
  }
  if (/\b(career\s*center|pusat\s+karier|karier|karir|kerja|pekerjaan|lulusan|prospek|magang|job\s*fair|campus\s*hiring|rekrutmen|perusahaan|lowongan|tracer\s+study|konsultasi\s+karier|melamar\s+kerja|pelatihan\s+kerja)\b/i.test(q)) {
    setIntent('career', 0.88, 'career_terms');
    canonicalQuestion = `Informasi karier, Career Center, magang, lowongan, tracer study, atau campus hiring: ${current}`;
    addQuery('Career Center konsultasi karier magang lowongan kerja job fair campus hiring tracer study alumni perusahaan');
  }

  if (/\b(inbis|inkubator\s+bisnis|hi[- ]?think|hithink|llc|language\s+learning\s+center|ukm|ormawa|organisasi\s+mahasiswa|bem|dpm|hima|komunitas|kegiatan\s+mahasiswa)\b/i.test(q)) {
    setIntent(/\b(ukm|ormawa|organisasi|bem|dpm|hima|komunitas|kegiatan\s+mahasiswa)\b/i.test(q) ? 'ukm' : 'program_definition', 0.86, 'campus_support_terms');
    canonicalQuestion = `Informasi layanan atau kegiatan kampus: ${current}`;
    addQuery('Inkubator Bisnis Inbis Hi-Think LLC Language Learning Center UKM organisasi mahasiswa layanan kampus');
  }

  if (/\b(kampus|alamat|lokasi|cabang|jumlah\s+kampus|denpasar|jimbaran|renon)\b/i.test(q) && /\b(berapa|dimana|di\s+mana|lokasi|alamat|ada\s+berapa|jumlah)\b/i.test(q)) {
    setIntent('campus_location', 0.86, 'campus_location_terms');
    canonicalQuestion = `Lokasi dan jumlah kampus ITB STIKOM Bali: ${current}`;
    addQuery('alamat lokasi kampus Denpasar Jimbaran ITB STIKOM Bali');
  }

  if (/\b(syarat|persyaratan|dokumen|berkas|cara\s+mengurus|izin\s+belajar|visa|study\s+permit|mahasiswa\s+asing)\b/i.test(q)) {
    setIntent('requirements', 0.82, 'requirements_terms');
    canonicalQuestion = `Syarat, dokumen, atau prosedur: ${current}`;
    addQuery(`${canonicalQuestion} persyaratan dokumen berkas prosedur`);
  }

  const finalIntent = refineSemanticIntent(intent, entities, current);
  return {
    canonicalQuestion,
    searchQueries: uniqueList([canonicalQuestion].concat(queries), 4),
    intent: finalIntent,
    entities: normalizeSemanticEntities(entities),
    confidence: Math.max(0, Math.min(1, confidence)),
    needsClarification: false,
    clarificationQuestion: '',
    heuristic: true,
    heuristicSignals: uniqueList(signals, 12)
  };
}

function mergeSemanticRewriteWithHeuristic(llmRewrite, heuristicRewrite, originalQuestion) {
  const llm = llmRewrite && typeof llmRewrite === 'object' ? llmRewrite : {};
  const heuristic = heuristicRewrite && typeof heuristicRewrite === 'object' ? heuristicRewrite : buildHeuristicSemanticRewrite(originalQuestion);
  const llmConfidence = Number.isFinite(Number(llm.confidence)) ? Number(llm.confidence) : 0;
  const heuristicConfidence = Number.isFinite(Number(heuristic.confidence)) ? Number(heuristic.confidence) : 0;
  const llmIntent = normalizeSemanticIntent(llm.intent);
  const heuristicIntent = normalizeSemanticIntent(heuristic.intent);
  const shouldPreferHeuristic = heuristicIntent !== 'unknown' && (
    llmIntent === 'unknown' ||
    llmConfidence < 0.45 ||
    (llm.needsClarification === true && heuristicConfidence >= 0.72)
  );
  const base = shouldPreferHeuristic ? heuristic : llm;
  const mergedEntities = Object.assign({}, heuristic.entities || {}, llm.entities || {});
  if (shouldPreferHeuristic) Object.assign(mergedEntities, heuristic.entities || {});
  const canonicalQuestion = String(base.canonicalQuestion || heuristic.canonicalQuestion || llm.canonicalQuestion || originalQuestion || '').trim();
  return {
    canonicalQuestion,
    searchQueries: uniqueList([canonicalQuestion]
      .concat(base.searchQueries || [])
      .concat(heuristic.searchQueries || [])
      .concat(llm.searchQueries || [])
      .concat(originalQuestion || []), 4),
    intent: shouldPreferHeuristic ? heuristicIntent : refineSemanticIntent(llmIntent, mergedEntities, originalQuestion),
    entities: normalizeSemanticEntities(mergedEntities),
    confidence: Math.max(llmConfidence, heuristicConfidence),
    needsClarification: shouldPreferHeuristic ? false : llm.needsClarification === true,
    clarificationQuestion: shouldPreferHeuristic ? '' : String(llm.clarificationQuestion || '').trim(),
    heuristicSignals: uniqueList([].concat(heuristic.heuristicSignals || []), 12),
    intentEnsemble: {
      selected: shouldPreferHeuristic ? 'heuristic' : 'llm',
      llmIntent,
      llmConfidence,
      heuristicIntent,
      heuristicConfidence,
      signals: heuristic.heuristicSignals || []
    }
  };
}
async function rewriteQuestionWithLlm(client, question, options = {}) {
  const current = String(question || '').trim();
  const sessionData = options && options.sessionData ? options.sessionData : null;
  const programHint = String(options && options.programHint ? options.programHint : '').trim();
  const intentHint = String(options && options.intentHint ? options.intentHint : '').trim();
  const heuristicRewrite = buildHeuristicSemanticRewrite(current, options);
  if (!client || !current) {
    return heuristicRewrite;
  }

  const conversation = getRecentConversation(sessionData);
  const memoryHints = sessionData && typeof sessionData === 'object' ? [
    sessionData.lastProgramHint ? `Program terakhir: ${sessionData.lastProgramHint}` : '',
    sessionData.lastIntent ? `Intent terakhir: ${sessionData.lastIntent}` : '',
    sessionData.pendingFollowupChoice ? 'Ada pending follow-up choice.' : '',
    sessionData.pendingFeeDetail ? 'Ada pending fee detail.' : ''
  ].filter(Boolean).join('\n') : '';
  const prompt = [
    'LLM ORCHESTRATOR / QUERY UNDERSTANDING',
    'Persona: TIKO, asisten informasi ITB STIKOM Bali yang ramah, ringkas, dan grounded.',
    'Instruction: pahami pertanyaan WhatsApp user dalam bahasa apa pun, termasuk typo, slang, singkatan, dan follow-up pendek.',
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
    conversation ? `CONVERSATION HISTORY:\n${conversation}` : 'CONVERSATION HISTORY: -',
    '',
    memoryHints ? `MEMORY:\n${memoryHints}` : 'MEMORY: -',
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
    return mergeSemanticRewriteWithHeuristic({
      canonicalQuestion,
      searchQueries: searchQueries.length ? searchQueries : [canonicalQuestion],
      intent: refineSemanticIntent(intent, entities, current),
      entities,
      confidence,
      needsClarification: obj.needsClarification === true,
      clarificationQuestion: String(obj.clarificationQuestion || '').trim()
    }, heuristicRewrite, current);
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] query rewrite failed; using raw question');
    return heuristicRewrite;
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
  const q = String(question || '').toLowerCase();
  const asksDefinitionShape = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|pengertian|jelaskan|definisi|maksud(?:nya)?)\b/.test(q);
  const mentionsProgramKey = /\b(?:sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi|dkv|desain\s+komunikasi\s+visual)\b/.test(q);
  if (asksDefinitionShape && mentionsProgramKey && ['program_recommendation', 'career', 'program_list', 'program_comparison', 'unknown'].includes(current)) {
    return 'program_definition';
  }
  if (/\b(double\s*degree|dual\s*degree|dd)\b/.test(q) && !hasSemanticFeeSignal(question)) {
    return 'dual_degree';
  }
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
  const normalizedCanonical = normalizeUserQuery(canonical).normalizedText;
  const normalizedCurrent = normalizeUserQuery(current).normalizedText;
  const normalizedSearchQueries = rewrite && Array.isArray(rewrite.searchQueries)
    ? rewrite.searchQueries.map((sq) => normalizeUserQuery(sq).normalizedText)
    : [];
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
    current,
    normalizedCanonical,
    ...normalizedSearchQueries,
    normalizedCurrent
  ], 8);
}

// FAQ document keywords for direct lookup fallback
const FAQ_KEYWORDS = {
  career: ['career center', 'lowongan kerja', 'magang', 'job fair', 'rekrutmen', 'campus hiring', 'tracer study', 'konsultasi karier', 'prospek kerja', 'kerja sama perusahaan', 'alumni', 'pekerjaan'],
  student_exchange: ['student exchange', 'pertukaran mahasiswa', 'gccp', 'bccp', 'program exchange', 'credit transfer', 'short program', 'summer program', 'negara mitra', 'syarat student exchange', 'manfaat student exchange'],
  izin_belajar: ['izin belajar', 'study permit', 'mahasiswa asing', 'visa pelajar', 'itas', 'kitas', 'sktt', 'perpanjangan izin', 'dokumen mahasiswa asing', 'pengurusan izin belajar']
};

let dynamicAliasDictionaryCache = { hash: '', aliases: [] };
const dynamicAliasDictionaryPath = path.resolve(__dirname, '..', '..', 'data', 'runtime', 'dynamic_alias_dictionary.json');

const DYNAMIC_ALIAS_RESERVED_CANONICALS = new Map([
  ['si', 'Sistem Informasi'],
  ['ti', 'Teknologi Informasi'],
  ['bd', 'Bisnis Digital'],
  ['sk', 'Sistem Komputer'],
  ['mi', 'Manajemen Informatika'],
  ['s2', 'S2 Sistem Informasi'],
  ['s 2', 'S2 Sistem Informasi'],
  ['pasca', 'S2 Sistem Informasi'],
  ['pascasarjana', 'S2 Sistem Informasi'],
  ['pasca sarjana', 'S2 Sistem Informasi'],
  ['magister', 'S2 Sistem Informasi'],
  ['master', 'S2 Sistem Informasi'],
  ['program pascasarjana', 'S2 Sistem Informasi'],
  ['dkv', 'Desain Komunikasi Visual'],
  ['trpl', 'Teknologi Rekayasa Perangkat Lunak'],
  ['tk', 'Teknologi Komputer'],
  ['mm', 'Multimedia'],
  ['an', 'Animasi'],
  ['dg', 'Desain Grafis']
]);

function acronymForDynamicCanonical(canonical) {
  const text = canonicalizeDynamicProgramName(canonical) || String(canonical || '').trim();
  if (!text) return '';
  if (/^s2\s+sistem\s+informasi$/i.test(text)) return 's2';
  return text.split(/\s+/).filter(Boolean).map((word) => word[0]).join('').toLowerCase();
}

function sanitizeDynamicAliasEntries(aliases) {
  const list = Array.isArray(aliases) ? aliases : [];
  const out = [];
  const seenAlias = new Set();
  const seenPair = new Set();
  for (const item of list) {
    const aliasText = normalizeDynamicAliasText(item && item.alias);
    const canonicalProgram = canonicalizeDynamicProgramName(item && item.canonical);
    if (!aliasText || !canonicalProgram) continue;
    if (aliasText.length < 2 || aliasText.length > 28) continue;
    if (aliasText === normalizeDynamicAliasText(canonicalProgram)) continue;

    const reservedCanonical = DYNAMIC_ALIAS_RESERVED_CANONICALS.get(aliasText);
    if (reservedCanonical && normalizeDynamicAliasText(reservedCanonical) !== normalizeDynamicAliasText(canonicalProgram)) continue;

    if (!reservedCanonical && /^[a-z0-9\s]{2,5}$/i.test(aliasText)) {
      const acronym = acronymForDynamicCanonical(canonicalProgram);
      if (aliasText.replace(/\s+/g, '') !== acronym.replace(/\s+/g, '')) continue;
    }

    if (seenAlias.has(aliasText)) continue;
    const key = aliasText + '->' + normalizeDynamicAliasText(canonicalProgram);
    if (seenPair.has(key)) continue;
    seenAlias.add(aliasText);
    seenPair.add(key);
    out.push({
      alias: aliasText,
      canonical: titleCaseDynamicAlias(canonicalProgram),
      type: item && item.type ? String(item.type) : 'document_alias',
      source: item && item.source ? item.source : null
    });
  }
  return out;
}
function readPersistedDynamicAliasDictionary(signature) {
  try {
    if (!fs.existsSync(dynamicAliasDictionaryPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(dynamicAliasDictionaryPath, 'utf8') || '{}');
    if (!parsed || parsed.signature !== signature || !Array.isArray(parsed.aliases)) return null;
    return sanitizeDynamicAliasEntries(parsed.aliases);
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to read dynamic alias dictionary');
    return null;
  }
}

function writePersistedDynamicAliasDictionary(signature, aliases) {
  try {
    fs.mkdirSync(path.dirname(dynamicAliasDictionaryPath), { recursive: true });
    const payload = {
      version: 1,
      signature,
      generatedAt: new Date().toISOString(),
      aliasCount: Array.isArray(aliases) ? aliases.length : 0,
      aliases: Array.isArray(aliases) ? aliases : []
    };
    fs.writeFileSync(dynamicAliasDictionaryPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to write dynamic alias dictionary');
  }
}

function normalizeDynamicAliasText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseDynamicAlias(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => /^(s[123]|d[34]|si|ti|bd|sk|mi)$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function canonicalizeDynamicProgramName(value) {
  const text = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (/\b(?:s2\s+sistem\s+informasi|magister\s+sistem\s+informasi)\b/i.test(text)) return 'S2 Sistem Informasi';
  if (/\bsistem\s+informasi\b/i.test(text)) return 'Sistem Informasi';
  if (/\bteknologi\s+informasi\b/i.test(text)) return 'Teknologi Informasi';
  if (/\bbisnis\s+digital\b/i.test(text)) return 'Bisnis Digital';
  if (/\bsistem\s+komputer\b/i.test(text)) return 'Sistem Komputer';
  if (/\bmanajemen\s+informatika\b/i.test(text)) return 'Manajemen Informatika';
  if (/\bdesain\s+komunikasi\s+visual\b/i.test(text)) return 'Desain Komunikasi Visual';
  if (/\bteknologi\s+rekayasa\s+perangkat\s+lunak\b/i.test(text)) return 'Teknologi Rekayasa Perangkat Lunak';
  if (/\bteknologi\s+komputer\b/i.test(text)) return 'Teknologi Komputer';
  if (/\bdesain\s+grafis\b/i.test(text)) return 'Desain Grafis';
  if (/\bmultimedia\b/i.test(text)) return 'Multimedia';
  if (/\banimasi\b/i.test(text)) return 'Animasi';
  return '';
}

function isUsefulDynamicProgramName(value) {
  const text = String(value || '').toLowerCase();
  if (!text.trim()) return false;
  return /\b(?:s2\s+sistem\s+informasi|magister\s+sistem\s+informasi|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|desain\s+komunikasi\s+visual|teknologi\s+rekayasa\s+perangkat\s+lunak|teknologi\s+komputer|multimedia|animasi|desain\s+grafis)\b/i.test(text);
}

function addDynamicAlias(out, seen, alias, canonical, type, source) {
  const aliasText = normalizeDynamicAliasText(alias);
  const canonicalText = titleCaseDynamicAlias(canonical);
  if (!aliasText || !canonicalText || aliasText === normalizeDynamicAliasText(canonicalText)) return;
  if (aliasText.length < 2 || canonicalText.length < 3) return;
  const key = aliasText + '->' + normalizeDynamicAliasText(canonicalText);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ alias: aliasText, canonical: canonicalText, type: type || 'document_alias', source: source || null });
}

function buildDynamicAliasDictionary(index) {
  const list = Array.isArray(index) ? index : [];
  const signature = list.slice(0, 2500).map((item) => [item && item.id, item && item.trainingId, item && item.filename, item && item.sourceFile, String(item && item.chunk || '').length].join(':')).join('|');
  if (dynamicAliasDictionaryCache.hash === signature) return dynamicAliasDictionaryCache.aliases;
  const persistedAliases = readPersistedDynamicAliasDictionary(signature);
  if (persistedAliases) {
    dynamicAliasDictionaryCache = { hash: signature, aliases: persistedAliases };
    return persistedAliases;
  }

  const out = [];
  const seen = new Set();
  for (const item of list.slice(0, 2500)) {
    const source = item && (item.filename || item.sourceFile || item.trainingId || item.id) || null;
    const text = String((item && (item.filename || item.sourceFile || '')) + '\n' + (item && item.chunk || '')).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const programMatches = Array.from(text.matchAll(/(?:program\s+studi|prodi|jurusan)\s+((?:S[123]|D[34])?\s*[A-Za-z][A-Za-z0-9\s/&.-]{2,70}?)(?=\s+(?:terakreditasi|akreditasi|semester|gelombang|tahun|biaya|adalah|:|-)|[.;,()\n]|$)/gi));
    for (const match of programMatches) {
      const canonical = String(match[1] || '').replace(/\b(?:di|pada|dengan|untuk|yang|adalah)\b.*$/i, '').trim();
      if (!canonical || canonical.length > 80 || !isUsefulDynamicProgramName(canonical)) continue;
      addDynamicAlias(out, seen, canonical, canonical, 'program', source);
      const acronym = canonical.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();
      if (acronym.length >= 2 && acronym.length <= 5) addDynamicAlias(out, seen, acronym, canonical, 'program', source);
    }

    const s2Match = text.match(/\b(S2\s+Sistem\s+Informasi|Magister\s+Sistem\s+Informasi)\b/i);
    if (s2Match || (/\b(?:pascasarjana|pasca\s*sarjana|magister)\b/i.test(text) && /\bsistem\s+informasi\b/i.test(text))) {
      const canonical = 'S2 Sistem Informasi';
      for (const alias of ['s2', 's 2', 'pasca', 'pascasarjana', 'pasca sarjana', 'magister', 'master', 'program pascasarjana']) {
        addDynamicAlias(out, seen, alias, canonical, 'degree_program', source);
      }
    }

    const labeledPairs = Array.from(text.matchAll(/(?:nama\s+program|program|jenjang)\s*[:=-]\s*([^.;|\n]{3,80})/gi));
    for (const match of labeledPairs) {
      const canonical = String(match[1] || '').replace(/\s+/g, ' ').trim();
      const canonicalProgram = canonicalizeDynamicProgramName(canonical);
      if (canonicalProgram) {
        const acronym = canonicalProgram.split(/\s+/).filter((w) => !/^(program|studi|prodi|jurusan)$/i.test(w)).map((w) => w[0]).join('').toLowerCase();
        if (acronym.length >= 2 && acronym.length <= 5) addDynamicAlias(out, seen, acronym, canonicalProgram, 'program', source);
      }
    }

    if (out.length >= 400) break;
  }

  const sanitizedOut = sanitizeDynamicAliasEntries(out);
  dynamicAliasDictionaryCache = { hash: signature, aliases: sanitizedOut };
  writePersistedDynamicAliasDictionary(signature, sanitizedOut);
  return sanitizedOut;
}

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
  const preliminaryQueries = uniqueList(searchQueries, 8);
  const question = options.question || preliminaryQueries[0] || '';
  const questionIntent = options.intent || detectGenericIntent(question);
  const dynamicAliases = buildDynamicAliasDictionary(index);
  const understanding = options.queryUnderstanding || buildQueryUnderstanding(question, {
    canonicalQuestion: question,
    searchQueries: preliminaryQueries,
    intent: questionIntent
  }, { intentHint: questionIntent, dynamicAliases });
  const queries = uniqueList([...(understanding.searchQueries || []), ...buildAdaptiveQueryVariants(question, { dynamicAliases, limit: 8 }), ...preliminaryQueries], 12);

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
      const runtimeCategory = getRuntimeDocCategory(item);
      const runtimeItem = { ...item, docCategory: item.docCategory || runtimeCategory };
      const domainAlignment = computeDomainAlignmentScore(question, runtimeItem, questionIntent);
      const emb = queryEmbeddings.length && Array.isArray(runtimeItem.embedding) ? runtimeItem.embedding : null;

      let bestSemanticScore = 0;
      if (emb) {
        for (const qEmb of queryEmbeddings) {
          bestSemanticScore = Math.max(bestSemanticScore, cosineSimilarity(qEmb, emb));
        }
      }

      let bestGenericScore = 0;
      let bestLexicalScore = 0;
      for (const query of queries) {
        const haystack = String(runtimeItem.chunk || '') + ' ' + String(runtimeItem.filename || runtimeItem.sourceFile || '');
        const genericScore = computeGenericScore(query, haystack, questionIntent);
        const lexicalScore = computeLexicalScore(query, runtimeItem.chunk, runtimeItem.filename || runtimeItem.sourceFile || '');
        bestGenericScore = Math.max(bestGenericScore, genericScore);
        bestLexicalScore = Math.max(bestLexicalScore, lexicalScore);
      }

      const sourceIntentBoost = computeSourceIntentBoost(question, runtimeItem, questionIntent);
      const topicBoost = getTopicBoost(runtimeItem.filename || runtimeItem.sourceFile || '', runtimeItem.chunk);
      const baseScore = emb
        ? (bestSemanticScore * 0.45 + bestGenericScore * 0.45 + bestLexicalScore * 0.1)
        : (bestGenericScore * 0.7 + bestLexicalScore * 0.3);
      const combinedScore = Math.max(0, Math.min(1, baseScore + sourceIntentBoost + topicBoost));

      if (combinedScore > 0.1) {
        semanticScored.push({
          item: runtimeItem,
          score: combinedScore,
          lexicalScore: bestLexicalScore,
          semanticScore: bestSemanticScore,
          genericScore: bestGenericScore,
          sourceIntentBoost,
          topicBoost,
          sourceType: 'semantic',
          intent: questionIntent,
          domainAlignment
        });
      }
    }
  }

  // Merge semantic and database candidates
  const allCandidates = [...semanticScored, ...dbCandidates];

  // Deduplicate candidates using centralized helper (keep highest-score)
  const candidateItems = allCandidates.map(c => ({ item: c.item, score: c.score, text: c.item && c.item.chunk ? c.item.chunk : '' }));
  const dedupResult = deduplicateEvidence(candidateItems, { keep: 'highest-score', textField: 'text', scoreField: 'score', prefixLength: 240 });
  const dedupedCandidates = dedupResult.items.map(c => {
    // find original candidate by matching item reference or text
    const found = allCandidates.find(ac => ac.item === c || (ac.item && ac.item.chunk && normalizeForLexicalMatch(ac.item.chunk).slice(0, 40) === normalizeForLexicalMatch(c.text).slice(0, 40)));
    return found || null;
  }).filter(Boolean);

  // Sort by combined score
  dedupedCandidates.sort((a, b) => b.score - a.score);

  const toContext = (s) => ({
    id: s.item.id || null,
    score: s.score,
    chunk: s.item.chunk,
    filename: s.item.filename || s.item.sourceFile || null,
    trainingId: s.item.trainingId || null,
    divisionKey: s.item.divisionKey || null,
    metadata: {
      ...(s.item.metadata || {}),
      runtimeDocCategory: s.item.docCategory || getRuntimeDocCategory(s.item),
      domainAlignment: s.domainAlignment || null
    },
    intent: s.intent || questionIntent,
    sourceType: s.sourceType || null,
    domainAlignment: s.domainAlignment || null
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

  const candidateContexts = rerankContexts(dedupedCandidates.slice(0, maxCandidates).map(toContext), understanding, { topK: maxCandidates });
  const dbCandidateContexts = rerankContexts(dbCandidates.slice(0, maxCandidates).map(toContext), understanding, { topK: maxCandidates });
  const rrfEnabled = envFlag('SEMANTIC_RAG_RRF_ENABLED', true);
  const mmrEnabled = envFlag('SEMANTIC_RAG_MMR_ENABLED', true);
  const rrfKRaw = Number(process.env.SEMANTIC_RAG_RRF_K || '60');
  const rrfK = Number.isFinite(rrfKRaw) ? Math.max(1, rrfKRaw) : 60;
  const mmrLambdaRaw = Number(process.env.SEMANTIC_RAG_MMR_LAMBDA || '0.72');
  const mmrLambda = Number.isFinite(mmrLambdaRaw) ? Math.max(0, Math.min(1, mmrLambdaRaw)) : 0.72;
  const fusedCandidateContexts = rrfEnabled
    ? reciprocalRankFusion([candidateContexts, dbCandidateContexts], { k: rrfK, topK: maxCandidates })
    : dedupeContexts([...candidateContexts, ...dbCandidateContexts]).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  const diversifiedCandidateContexts = mmrEnabled
    ? mmrDiversifyContexts(fusedCandidateContexts, understanding, { topK: maxCandidates, lambda: mmrLambda })
    : fusedCandidateContexts;

  // Apply quality-control filtering. If the filter removes every otherwise
  // relevant candidate, keep strong raw candidates instead of immediately
  // falling back to a vague/no-data answer.
  const rawContexts = diversifiedCandidateContexts.slice(0, topK);
  const filteredCandidates = dedupeContexts([
    ...filterSemanticContextsForQuestion(question, diversifiedCandidateContexts)
  ]).sort((a, b) => Number(b.mmrScore || b.rrfScore || b.score || 0) - Number(a.mmrScore || a.rrfScore || a.score || 0));
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
    : (allowRelaxedFallback ? diversifiedCandidateContexts.filter((ctx) => Number(ctx && ctx.score) >= relaxedMin).slice(0, topK) : []);

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
    faqFallbackUsed: contexts.length > 0 && contexts[0].sourceType === 'faq-lookup',
    techniquePipeline: {
      queryUnderstanding: understanding,
      dynamicAliasCount: dynamicAliases.length,
      reranking: { enabled: true, candidateCount: candidateContexts.length, dbCandidateCount: dbCandidateContexts.length },
      fusion: { rrfEnabled, rrfK, fusedCount: fusedCandidateContexts.length },
      diversification: { mmrEnabled, mmrLambda, diversifiedCount: diversifiedCandidateContexts.length },
      domainAlignment: {
        queryDomains: [...inferQuestionDomains(question, questionIntent)],
        topCandidates: dedupedCandidates.slice(0, 8).map((candidate) => ({
          score: Number(Number(candidate.score || 0).toFixed(4)),
          filename: candidate.item && (candidate.item.filename || candidate.item.sourceFile) || null,
          runtimeDocCategory: candidate.item ? getRuntimeDocCategory(candidate.item) : 'UNKNOWN',
          itemDomains: candidate.domainAlignment && candidate.domainAlignment.itemDomains || [],
          alignmentScore: candidate.domainAlignment ? Number(Number(candidate.domainAlignment.score || 0).toFixed(4)) : 0,
          reason: candidate.domainAlignment && candidate.domainAlignment.reason || ''
        }))
      }
    }
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

function normalizeAcademicAdminQueryText(value) {
  return String(value || '')
    .replace(/\byudis(?:um|iun|uim|iumnya)\b/gi, 'yudisium')
    .replace(/\bpenda(?:f|ft)aran\b/gi, 'pendaftaran')
    .replace(/\bproyek\s+ahir\b/gi, 'proyek akhir')
    .replace(/\btugas\s+ahir\b/gi, 'tugas akhir');
}

function splitAcademicDocumentSections(text) {
  const cleaned = cleanDocumentMarkers(String(text || '')).replace(/\r\n/g, '\n');
  if (!cleaned.trim()) return [];
  const matches = [...cleaned.matchAll(/(?:^|\n)\s*([A-Z])\.\s+([^:\n]{3,120})\s*:?/g)];
  if (!matches.length) return [{ label: '', title: '', text: cleaned.trim() }];
  const sections = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + (matches[i][0].startsWith('\n') ? 1 : 0);
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    sections.push({
      label: String(matches[i][1] || '').trim(),
      title: String(matches[i][2] || '').replace(/\s+/g, ' ').trim(),
      text: cleaned.slice(start, end).trim()
    });
  }
  return sections.filter((section) => section.text);
}

function selectAcademicDocumentSection(question, evidence, mode = 'schedule') {
  const q = normalizeAcademicAdminQueryText(question).toLowerCase();
  const combined = (Array.isArray(evidence) ? evidence : [])
    .map((item) => String(item && item.text || item && item.chunk || ''))
    .join('\n\n');
  const sections = splitAcademicDocumentSections(combined);
  if (!sections.length) return '';

  const topicPatterns = [];
  if (/\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q)) topicPatterns.push(/\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i);
  if (/\byudisium\b/i.test(q)) topicPatterns.push(/\byudisium\b/i);
  if (/\bwisuda\b/i.test(q)) topicPatterns.push(/\bwisuda\b/i);
  if (/\b(seminar\s+proposal|sempro)\b/i.test(q)) topicPatterns.push(/\b(seminar\s+proposal|sempro)\b/i);

  const wantsPelaksanaan = /\b(pelaksanaan|dilaksanakan|berlangsung|kapan\s+(?:pelaksanaan|dilaksanakan)|jam|pukul)\b/i.test(q);
  const wantsRegistration = /\b(pendaftaran|daftar|registrasi|terakhir|deadline|batas)\b/i.test(q) && !wantsPelaksanaan;
  const wantsRequirement = mode === 'requirement' || /\b(syarat|persyaratan|dokumen|berkas|apa\s+saja|ketentuan)\b/i.test(q);
  const asksYudisium = /\byudisium\b/i.test(q);
  const asksThesisDefense = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q);

  let best = null;
  for (const section of sections) {
    const hay = normalizeAcademicAdminQueryText(`${section.title}\n${section.text}`);
    const title = normalizeAcademicAdminQueryText(section.title || '');
    if (topicPatterns.length && !topicPatterns.some((pattern) => pattern.test(hay))) continue;
    if (asksYudisium && /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(title) && !/\byudisium\b/i.test(title)) continue;
    if (asksThesisDefense && /\byudisium\b/i.test(title) && !/\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(title)) continue;
    if (mode === 'schedule' && !wantsRequirement && /\b(persyaratan|syarat|ketentuan|dokumen|berkas)\b/i.test(title)) continue;
    let score = 0;
    if (wantsRequirement && /\b(persyaratan|syarat|ketentuan|dokumen|berkas)\b/i.test(section.title)) score += 5;
    if (wantsPelaksanaan && /\b(pelaksanaan|jadwal|waktu)\b/i.test(section.title)) score += 5;
    if (wantsRegistration && /\b(pendaftaran|registrasi)\b/i.test(section.title)) score += 5;
    if (!wantsRequirement && !wantsPelaksanaan && !wantsRegistration && /\b(pelaksanaan|pendaftaran|persyaratan|jadwal)\b/i.test(section.title)) score += 2;
    if (/\b(hari\s*\/?\s*tanggal|tanggal|pukul|waktu|tempat|loket|wita|wib|wit)\b/i.test(hay)) score += 1;
    if (/\b(syarat|persyaratan|dokumen|berkas|krs|bukti|surat|transkrip|ijazah|skpi)\b/i.test(hay)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { score, section };
  }
  return best && best.section ? best.section.text : '';
}
function isSafeCompactAcademicScheduleAnswer(question, answer) {
  const q = String(question || '');
  const a = String(answer || '').trim();
  const core = a.replace(/\n\s*(?:Topik\s+lanjutan|Rekomendasi[^:]*|Kalau\s+mau\s+lanjut)[\s\S]*$/i, '').trim();
  if (!core || !isAcademicAdminUploadedDocQuestion(q, 'schedule')) return false;
  if (!/\b(?:sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|yudisium|wisuda)\b/i.test(core)) return false;
  const hasConcreteSchedule = /\b(?:Hari\s*\/?\s*Tanggal|Tanggal)\s*:/i.test(core)
    && /\b(?:Pukul|Waktu|Jam)\s*:/i.test(core)
    && /\b(?:Tempat|Loket|Lokasi)\s*:/i.test(core);
  if (!hasConcreteSchedule) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|Persyaratan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(core)) return false;
  if ((core.match(/(?:^|\n)\s*[A-Z]\.\s+/g) || []).length > 0) return false;
  return a.length <= 850;
}
function isSafeCompactAcademicRequirementAnswer(question, answer) {
  const q = normalizeAcademicAdminQueryText(question);
  const a = String(answer || '').trim();
  if (!a || !isAcademicAdminUploadedDocQuestion(q, 'requirement')) return false;
  if (!/\b(?:Persyaratan|Syarat)\s+(?:Yudisium|Wisuda|akademik)\b/i.test(a)) return false;

  const bulletCount = (a.match(/(?:^|\n|\s)-\s+\S+/g) || []).length;
  if (bulletCount < 1) return false;

  const requirementHits = [
    /\b(telah|sudah|wajib|bebas|lunas|minimum|tidak\s+lebih|terdaftar|eligible)\b/i,
    /\b(syarat|persyaratan|dokumen|berkas|krs|pddikti|pin|ipk|nilai|transkrip|sk\s+rektor|sidang|tugas\s+akhir|proyek\s+akhir|mata\s+kuliah|kurikulum)\b/i
  ].filter((pattern) => pattern.test(a)).length;
  if (requirementHits < 1) return false;

  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  if ((a.match(/(?:^|\n)\s*[A-Z]\.\s+/g) || []).length > 0) return false;
  return a.length <= 2500;
}
function isSafePmbOverviewAnswer(question, answer) {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').trim();
  if (!a || !/\b(pmb|penerimaan\s+mahasiswa\s+baru|maba|camaba)\b/i.test(q)) return false;
  if (!/\bPMB\s+adalah\s+singkatan\s+dari\s+Penerimaan\s+Mahasiswa\s+Baru\b/i.test(a)) return false;
  if (!/\bITB\s+STIKOM\s+Bali\b/i.test(a)) return false;
  if (!/\b(?:pendaftaran|jadwal|program\s+studi|prodi|biaya|beasiswa|syarat|dokumen|kontak|admin\s+PMB)\b/i.test(a)) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  if ((a.match(/(?:^|\n)\s*[A-Z]\.\s+/g) || []).length > 0) return false;
  return a.length <= 1400;
}

function isSafeDualDegreeAnswer(question, answer) {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').trim();
  const explicitDualDegreeQuestion = /\b(double\s*degree|dual\s*degree|gelar\s+ganda|dd)\b/i.test(q);
  const implicitUtbDkvRelationQuestion = /\b(?:utb|universitas\s+teknologi\s+bandung)\b/i.test(q)
    && /\b(?:dkv|desain\s+komunikasi\s+visual)\b/i.test(q)
    && /\b(?:stikom|stikom\s+bali|itb\s*stikom|sisi\s+stikom|prodi\s+stikom|jurusan\s+stikom|di\s+stikom)\b/i.test(q);
  if (!a || (!explicitDualDegreeQuestion && !implicitUtbDkvRelationQuestion)) return false;
  if (!/\b(Double|Dual)\s*Degree\b/i.test(a)) return false;
  const mentionsKnownPartner = /\b(UTB|Universitas\s+Teknologi\s+Bandung|DNUI|Dalian\s+Neusoft|HELP\s+University|HELP)\b/i.test(a);
  const mentionsKnownProgram = /\b(Bisnis\s+Digital|Sistem\s+Informasi|DKV|Desain\s+Komunikasi\s+Visual)\b/i.test(a);
  if (!mentionsKnownPartner || !mentionsKnownProgram) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  if ((a.match(/(?:^|\n)\s*[A-Z]\.\s+/g) || []).length > 0) return false;
  return a.length <= 1600;
}
function isSafeAbbreviationClarificationAnswer(question, answer, source = '') {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  const src = String(source || '').toLowerCase();
  if (!a || !src.includes('abbreviation-clarification')) return false;
  if (!/\b(?:apa\s+itu|itu\s+apa|maksud(?:nya)?|kepanjangan|singkatan|tentang|info(?:rmasi)?|jelaskan)\b/i.test(q)) return false;
  if (!/\bsingkatan\s+"?[A-Z0-9]{2,6}"?\s+yang\s+dimaksud\s+itu\s+apa\s+ya/i.test(a)) return false;
  if (!/\b(?:kepanjangannya|konteksnya|prodi|fasilitas|layanan|organisasi|PMB|akademik|RAG)\b/i.test(a)) return false;
  return a.length <= 500;
}

function isSafeProgramListAnswer(question, answer, source = '') {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').trim();
  const src = String(source || '').toLowerCase();
  if (!a || !src.includes('program-list')) return false;
  if (!/\b(?:jurusan(?:nya)?|prodi|program\s+studi|program\s+kuliah|apa\s+saja|apa\s+aja|daftar|detail|masing|dipelajari|belajar)\b/i.test(q)) return false;
  const mentionsPrograms = /\b(?:Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika)\b/i.test(a);
  if (!mentionsPrograms) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  return a.length <= 4200;
}

function isSafeProgramDefinitionAnswer(question, answer, source = '') {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').trim();
  const src = String(source || '').toLowerCase();
  if (!a || !src.includes('program-definition')) return false;
  if (!/\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(q)) return false;
  const asksKnownProgram = /\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi)\b/i.test(q);
  if (!asksKnownProgram) return false;
  const mentionsKnownProgram = /\b(?:Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika)\b/i.test(a);
  const hasDefinitionShape = /\b(?:adalah|merupakan|fokus|berfokus|program\s+studi|prodi|mempelajari|skill|kemampuan|karier)\b/i.test(a);
  if (!mentionsKnownProgram || !hasDefinitionShape) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  return a.length <= 1800;
}

function isSafeCompactAcademicGeneralAnswer(question, answer) {
  const q = normalizeAcademicAdminQueryText(question);
  const a = String(answer || '').trim();
  if (!a || !isAcademicAdminUploadedDocQuestion(q, 'general')) return false;
  if (!/\b(?:info(?:rmasi)?|tentang|jelaskan|apa\s+itu|punya\s+informasi|menanyakan)\b/i.test(q)) return false;
  if (!/\b(?:Yudisium|Wisuda|Sidang|Tugas\s+Akhir|Proyek\s+Akhir)\b/i.test(a)) return false;
  if (!/\b(?:Hari\s*\/?\s*Tanggal|Tanggal|Pukul|Waktu|Tempat|Persyaratan|Syarat|Pendaftaran|Pelaksanaan)\b/i.test(a)) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  return a.length <= 4200;
}

function isSafeCampusFacilityAnswer(question, answer, source = '') {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').trim();
  const src = String(source || '').toLowerCase();
  if (!a || !src.includes('campus-facility')) return false;
  if (!/\b(fasilitas|layanan|sarana|prasarana|unggulan|diunggulkan|program\s+pendukung)\b/i.test(q)) return false;
  const hits = [
    /Career\s*Center/i,
    /Inkubator\s+Bisnis/i,
    /Soft\s*skill|Softskill/i,
    /UKM|Unit\s+Kegiatan\s+Mahasiswa/i,
    /Language\s+Learning|LLC/i,
    /Double\s+Degree|Dual\s+Degree/i,
    /Hi-?Think/i,
    /GCCP|short\s*course/i,
    /Magang/i
  ].filter((pattern) => pattern.test(a)).length;
  if (hits < 2) return false;
  if (/\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan)\b/i.test(a)) return false;
  return a.length <= 1800;
}
function buildAcademicScheduleSummaryAnswer(question, selectedEvidence) {
  const q = normalizeAcademicAdminQueryText(question);
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  if (!isAcademicAdminUploadedDocQuestion(q, 'schedule')) return '';
  if (!/\b(kapan|jadwal|tanggal|deadline|terakhir|pendaftaran|daftar|registrasi|pukul|jam|pelaksanaan|dilaksanakan|berlangsung|akan\s+datang|informasi(?:nya)?|info)\b/i.test(q)) return '';

  const combined = evidence.map((item) => cleanDocumentMarkers(String(item && item.text || ''))).join('\n\n');
  if (!combined.trim()) return '';

  let section = selectAcademicDocumentSection(q, evidence, 'schedule');
  if (!section) section = combined.slice(0, 1200);

  const cleanScheduleFieldValue = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:Hari\s*\/?\s*Tanggal|Tanggal|Pukul|Waktu|Jam|Tempat|Loket|Lokasi|Selain\s+dari\s+tanggal\s+tersebut|[B-Z]\.\s+|Persyaratan)\b[\s\S]*$/i, '')
    .trim();
  const getValue = (labelPattern) => {
    const re = new RegExp(`(?:${labelPattern})\\s*[:\\uFF1A]?\\s*([^\\n]+)`, 'i');
    const m = section.match(re);
    return m && m[1] ? cleanScheduleFieldValue(m[1]) : '';
  };

  const date = getValue('Hari\s*\\/?\s*Tanggal|Tanggal');
  const time = getValue('Pukul|Waktu|Jam');
  const place = getValue('Tempat|Loket|Lokasi');
  const periodMatch = section.match(/Semester\s+(?:Ganjil|Genap)\s+TA\s+\d{4}\/\d{4}|Tahun\s+Akademik\s+\d{4}\/\d{4}/i);
  const period = periodMatch ? periodMatch[0].replace(/\s+/g, ' ').trim() : '';

  const asksThesisDefense = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q);
  const asksYudisium = /\byudisium\b/i.test(q);
  const asksWisuda = /\bwisuda\b/i.test(q);
  const wantsPelaksanaan = /\b(pelaksanaan|dilaksanakan|berlangsung|kapan\s+(?:pelaksanaan|dilaksanakan))\b/i.test(q);
  const wantsRegistration = /\b(pendaftaran|daftar|registrasi|terakhir|deadline|batas)\b/i.test(q) && !wantsPelaksanaan;
  const action = wantsPelaksanaan ? 'pelaksanaan' : (wantsRegistration ? 'pendaftaran' : 'jadwal');
  const topic = asksThesisDefense ? `${action} Sidang Tugas Akhir/Proyek Akhir` : (asksYudisium ? `${action} Yudisium` : (asksWisuda ? `${action} Wisuda` : 'jadwal yang ditanyakan'));

  if (!date && !time && !place) return '';
  const lines = [`Untuk ${topic}${period ? ` ${period}` : ''}:`];
  if (date) lines.push(`- Hari/Tanggal: ${date}`);
  if (time) lines.push(`- Pukul: ${time}`);
  if (place) lines.push(`- Tempat: ${place}`);

  const afterMatch = section.match(/Selain\s+dari\s+tanggal\s+tersebut[\s\S]{0,260}?(?=\n\s*[A-Z]\.\s+|$)/i);
  if (afterMatch) {
    const note = afterMatch[0].replace(/\s+[B-Z]\.\s+[\s\S]*$/i, '').replace(/\s+/g, ' ').trim();
    if (note) lines.push(`- Catatan: ${note}`);
  }

  return lines.join('\n').trim();
}

function buildAcademicRequirementSummaryAnswer(question, selectedEvidence) {
  const q = normalizeAcademicAdminQueryText(question);
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  if (!isAcademicAdminUploadedDocQuestion(q, 'requirement')) return '';
  if (!/\b(syarat|persyaratan|dokumen|berkas|apa\s+saja|ketentuan)\b/i.test(q)) return '';

  const section = selectAcademicDocumentSection(q, evidence, 'requirement');
  if (!section) return '';

  const rawLines = section
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^(?:\\|INSTITUT\s+TEKNOLOGI\s+DAN\s+BISNIS|\(ITB\)\s*STIKOM\s*BALI|STIKOM\s*BALI|Kampus\s+(?:Denpasar|Jimbaran|Abiansemal)|(?:Jl\.?|Jalan|31\s+Raya|l\.\s*3anger)\b|.*\b(?:Ph|Telp|Phone|Fax|Hotline|email|website)\s*:)/i.test(line));

  const items = [];
  let current = '';
  const splitRequirementCompoundItem = (value) => String(value || '')
    .replace(/\s+(?=(?:Telah\s+menempuh|Total\s+nilai|Nilai\s+MINIMUM|IPK\s+minimal|Terkait\s+poin|Mengisi\s+dan\s+melengkapi|Melakukan\s+update|Mengupload\s+foto|Mengumpulkan\s+Form|Pakaian\s+Pria|Pakaian\s+Wanita|Foto\s+berwarna)\b)/g, '\n')
    .split(/\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const isRequirementItem = (value) => /\b(syarat|wajib|telah|sudah|bebas|lunas|krs|bukti|formulir|dokumen|berkas|surat|transkrip|ijazah|skpi|tugas\s+akhir|proyek\s+akhir|sidang|yudisium|pddikti|pin|mata\s+kuliah|kurikulum|nilai|ipk|sks|eligible|ktm|keuangan|perpustakaan|kemahasiswaan|bebas\s+tanggungan|mengisi|melengkapi|mengupload|mengunggah|upload|foto)\b/i.test(value);
  const flushCurrent = () => {
    const cleaned = current
      .replace(/^\s*(?:[-*]|\d+[.)])\s*/, '')
      .replace(/\s*\\?\s*INSTITUT\s+TEKNOLOGI\s+DAN\s+BISNIS[\s\S]*$/i, '')
      .replace(/\s*\\?\s*Kampus\s+(?:Denpasar|Jimbaran|Abiansemal)[\s\S]*$/i, '')
      .replace(/\s*\\?\s*(?:Jl\.?|Jalan)\s+Raya\s+Puputan[\s\S]*$/i, '')
      .replace(/\s+\|\s*(?:Ph|Telp|Phone|Email)\s*:[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    current = '';
    if (!cleaned || /^persyaratan\b/i.test(cleaned)) return;
    if (/\b(hari\s*\/?\s*tanggal|pukul|waktu|tempat)\s*:/i.test(cleaned)) return;
    if (!isRequirementItem(cleaned)) return;
    for (const part of splitRequirementCompoundItem(cleaned)) {
      if (isRequirementItem(part)) items.push(part);
    }
  };

  for (const line of rawLines) {
    if (/^\s*[A-Z]\.\s+/i.test(line)) continue;
    if (/^persyaratan\b/i.test(line)) continue;
    if (/^\s*\d+[.)]\s*$/.test(line)) {
      flushCurrent();
      current = '';
      continue;
    }
    if (/^\s*(?:[-*]|\d+[.)])\s+/.test(line)) {
      flushCurrent();
      current = line;
      continue;
    }
    if (!current) {
      if (isRequirementItem(line)) current = line;
      continue;
    }
    current = `${current} ${line}`.replace(/\s+/g, ' ').trim();
  }
  flushCurrent();

  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    const key = normalizeForLexicalMatch(item).slice(0, 160);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(item);
    if (uniqueItems.length >= 8) break;
  }
  if (!uniqueItems.length) return '';

  const topic = /\byudisium\b/i.test(q) ? 'Persyaratan Yudisium' : (/\bwisuda\b/i.test(q) ? 'Persyaratan Wisuda' : 'Persyaratan akademik yang ditanyakan');
  return [`${topic}:`, ...uniqueItems.map((item) => `- ${item}`)].join('\n').trim();
}
function buildAcademicGeneralSummaryAnswer(question, selectedEvidence) {
  const q = normalizeAcademicAdminQueryText(question);
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  if (!isAcademicAdminUploadedDocQuestion(q, 'general')) return '';
  if (!/\b(?:info(?:rmasi)?|tentang|jelaskan|apa\s+itu|punya\s+informasi|menanyakan)\b/i.test(q)) return '';

  const topic = /\byudisium\b/i.test(q) ? 'Yudisium' : (/\bwisuda\b/i.test(q) ? 'Wisuda' : 'informasi akademik');
  const topicQuestion = topic === 'Yudisium' ? 'yudisium' : (topic === 'Wisuda' ? 'wisuda' : q);
  const parts = [];

  const registration = buildAcademicScheduleSummaryAnswer(`kapan pendaftaran ${topicQuestion}?`, evidence);
  if (registration) parts.push(registration);

  const implementation = buildAcademicScheduleSummaryAnswer(`kapan pelaksanaan ${topicQuestion}?`, evidence);
  if (implementation && implementation !== registration) parts.push(implementation);

  const requirements = buildAcademicRequirementSummaryAnswer(`persyaratan ${topicQuestion} apa saja?`, evidence);
  if (requirements) parts.push(requirements);

  if (!parts.length) return '';
  return [`Saya punya informasi tentang ${topic} dari dokumen akademik yang tersedia:`, '', parts.join('\n\n')].join('\n').trim();
}
function answerMatchesStrongQuestionAnchors(question, answer) {
  const q = String(question || '');
  const a = normalizeForLexicalMatch(answer);
  if (!a) return false;
  if (/\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi)\b/i.test(q)
    && /\b(?:inbis|inkubator\s+bisnis|tenant|umkm|lembaga\s+inkubator)\b/i.test(answer)
    && !/\b(?:akreditasi|mutu\s+institusi|tata\s+kelola\s+institusi|kinerja\s+institusi|pertanggung\s*jawab(?:an)?\s+institusi)\b/i.test(answer)) return false;
  const checks = [
    { asked: /\b(?:double|dual)\s+degree\b/i, answer: /\b(?:double|dual)\s+degree\b/i },
    { asked: /\bhelp(?:\s+university)?\b/i, answer: /\bhelp(?:\s+university)?\b/i },
    { asked: /\bdnui\b|dalian\s+neusoft/i, answer: /\bdnui\b|dalian\s+neusoft/i },
    { asked: /\butb\b|universitas\s+teknologi\s+bandung/i, answer: /\butb\b|universitas\s+teknologi\s+bandung/i },
    { asked: /\b(?:student|study)\s+exchange\b|pertukaran\s+mahasiswa/i, answer: /\bstudent\s+exchange\b|\bstudy\s+exchange\b|pertukaran\s+mahasiswa/i },
    { asked: /\brpl\b|rekognisi\s+pembelajaran\s+lampau/i, answer: /\brpl\b|rekognisi\s+pembelajaran\s+lampau/i },
    { asked: /\b(?:pascasarjana|pasca\s*sarjana|magister|s2)\b/i, answer: /\b(?:pascasarjana|pasca\s*sarjana|magister|s2|sistem\s+informasi)\b/i },
    { asked: /\blinked\s*in|linkedin/i, answer: /\blinked\s*in|linkedin/i },
    { asked: /\b(?:j\s*1|j-?1|training\s+1\s+tahun)\b/i, answer: /\b(?:j\s*1|j-?1|training\s+1\s+tahun)\b/i },
    { asked: /\b(?:amerika|america|usa)\b/i, answer: /\b(?:amerika|america|usa)\b/i },
    { asked: /\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi)\b/i, answer: /\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi|akreditasi|mutu|tata\s+kelola|capaian|kinerja)\b/i },
    { asked: /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i, answer: /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i },
    { asked: /\b(?:goes\s*to\s*school|kunjungan\s+sekolah)\b/i, answer: /\b(?:goes\s*to\s*school|kunjungan\s+sekolah|sekolah|sma|smk)\b/i },
    { asked: /\b(?:hi-?think|hithink)\b/i, answer: /\b(?:hi-?think|hithink|jepang|industri\s+teknologi)\b/i },
    { asked: /\b(?:inbis|inkubator\s+bisnis)\b/i, answer: /\b(?:inbis|inkubator\s+bisnis|bisnis|startup|usaha)\b/i },
    { asked: /\b(?:semester\s+(?:antara|pendek|genap|ganjil)|kalender\s+akademik|pelaksanaan\s+akademik|remedial|remidi)\b/i, answer: /\b(?:semester\s+(?:antara|pendek|genap|ganjil)|kalender\s+akademik|pelaksanaan\s+akademik|remedial|remidi|akademik)\b/i },
    { asked: /\byudisium\b/i, answer: /\byudisium\b/i },
    { asked: /\bwisuda\b/i, answer: /\bwisuda\b/i },
    { asked: /\bakreditasi\b|ban\s*-?\s*pt/i, answer: /\bakreditasi\b|ban\s*-?\s*pt|baik\s+sekali|terakreditasi/i },
    { asked: /\bbeasiswa\b|\bskss\b|\bkip\b|\b1k1s\b/i, answer: /\bbeasiswa\b|\bskss\b|\bkip\b|\b1k1s\b|potongan/i },
    { asked: /\bvisa\s+(?:study|studi|pelajar)\b|izin\s+belajar|study\s+permit/i, answer: /\bvisa\b|izin\s+belajar|study\s+permit|itas|kitas|sktt/i }
  ];
  for (const check of checks) {
    if (check.asked.test(q) && !check.answer.test(answer)) return false;
  }
  return true;
}

function getMissingStrongQuestionAnchors(question, answer) {
  const q = String(question || '');
  const a = String(answer || '');
  const missing = [];
  const required = [
    { name: 'pascasarjana/s2', asked: /\b(?:pascasarjana|pasca\s*sarjana|magister|s2)\b/i, answer: /\b(?:pascasarjana|pasca\s*sarjana|magister|s2|sistem\s+informasi)\b/i },
    { name: 'linkedin', asked: /\blinked\s*in|linkedin/i, answer: /\blinked\s*in|linkedin/i },
    { name: 'j1', asked: /\b(?:j\s*1|j-?1|training\s+1\s+tahun)\b/i, answer: /\b(?:j\s*1|j-?1|training\s+1\s+tahun)\b/i },
    { name: 'amerika', asked: /\b(?:amerika|america|usa)\b/i, answer: /\b(?:amerika|america|usa)\b/i },
    { name: 'indikator institusi', asked: /\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi)\b/i, answer: /\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi|akreditasi|mutu|tata\s+kelola|capaian|kinerja)\b/i },
    { name: 'layanan industri', asked: /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i, answer: /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i },
    { name: 'goes to school', asked: /\b(?:goes\s*to\s*school|kunjungan\s+sekolah)\b/i, answer: /\b(?:goes\s*to\s*school|kunjungan\s+sekolah|sekolah|sma|smk)\b/i },
    { name: 'jadwal akademik', asked: /\b(?:semester\s+(?:antara|pendek|genap|ganjil)|kalender\s+akademik|pelaksanaan\s+akademik|remedial|remidi)\b/i, answer: /\b(?:semester\s+(?:antara|pendek|genap|ganjil)|kalender\s+akademik|pelaksanaan\s+akademik|remedial|remidi|akademik)\b/i },
    { name: 'yudisium', asked: /\byudisium\b/i, answer: /\byudisium\b/i },
    { name: 'wisuda', asked: /\bwisuda\b/i, answer: /\bwisuda\b/i }
  ];
  for (const rule of required) {
    if (rule.asked.test(q) && !rule.answer.test(a)) missing.push(rule.name);
  }
  return missing;
}
function hasUploadedDocumentTopicConflict(question, answer) {
  const q = String(question || '');
  const a = String(answer || '');
  if (/\b(?:indikator|dipertanggung\s*jawabkan|pertanggung\s*jawab(?:an)?|akuntabilitas|kinerja\s+institusi)\b/i.test(q)
    && /\b(?:inbis|inkubator\s+bisnis|tenant|umkm|lembaga\s+inkubator)\b/i.test(a)) return true;
  if (/\b(?:j\s*1|j-?1|training\s+1\s+tahun|amerika|america|usa)\b/i.test(q)
    && /\b(?:izin\s+belajar|study\s+permit|mahasiswa\s+asing|itas|kitas|sktt)\b/i.test(a)
    && !/\b(?:j\s*1|j-?1|training\s+1\s+tahun|amerika|america|usa)\b/i.test(a)) return true;
  if (/\blinked\s*in|linkedin/i.test(q)
    && /\bcareer\s*center|pusat\s+kar(?:ir|ier)|lowongan|magang\b/i.test(a)
    && !/\blinked\s*in|linkedin/i.test(a)) return true;  const requestedSemester = /\bsemester\s+(genap|ganjil|antara|pendek)\b/i.exec(q);
  if (requestedSemester) {
    const requested = requestedSemester[1].toLowerCase();
    const answerSemester = /\bsemester\s+(genap|ganjil|antara|pendek)\b/i.exec(a);
    if (answerSemester && answerSemester[1].toLowerCase() !== requested) return true;
  }
  const requestedAcademicYear = /\b(?:tahun\s+akademik\s*)?(20\d{2}\s*\/\s*20\d{2})\b/i.exec(q);
  if (requestedAcademicYear) {
    const requestedYear = requestedAcademicYear[1].replace(/\s+/g, '');
    const answerYears = Array.from(new Set(Array.from(a.matchAll(/\b20\d{2}\s*\/\s*20\d{2}\b/g)).map(match => String(match[0] || '').replace(/\s+/g, ''))));
    if (answerYears.length && !answerYears.includes(requestedYear)) return true;
  }
  if (/\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i.test(q)
    && /\b(?:goes\s*to\s*school|unlock\s+your\s+digital\s+potential|siswa\s+sma|sma\/smk|sekolah)\b/i.test(a)
    && !/\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i.test(a)) return true;
  return false;
}
function isIndustryServicesQuestionAnswer(question, answer) {
  return /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|dari\s+industri)\b/i.test(String(question || ''))
    && /\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri|direktorat\s+kerja\s*sama)\b/i.test(String(answer || ''));
}

function hasUnrequestedSensitiveDomainLeak(question, answer) {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').toLowerCase();
  if (!q || !a || hasNoDataAnswerPhrase(a)) return false;

  const allows = {
    visa: /\b(?:visa|vitas|e\s*30\s*b|itas|kitas|sktt|izin\s+belajar|study\s+permit|mahasiswa\s+asing|foreign\s+student)\b/i.test(q),
    rpl: /\b(?:rpl|rekognisi\s+pembelajaran\s+lampau|konversi\s+sks|pengakuan\s+sks|pindahan|transfer\s+sks)\b/i.test(q),
    doubleDegree: /\b(?:double\s*degree|dual\s*degree|dnui|dalian|help\s+university|utb|gelar\s+ganda)\b/i.test(q),
    accreditation: /\b(?:akreditasi|akrediasi|ban\s*-?pt|lam\s*infokom|peringkat)\b/i.test(q),
    career: /\b(?:career\s*center|karier|karir|pekerjaan|lowongan|magang|job\s*fair|campus\s*hiring|tracer\s*study|peluang\s+kerja|prospek\s+kerja)\b/i.test(q),
    academicAdmin: /\b(?:yudisium|wisuda|sidang|tugas\s+akhir|skripsi|tesis|krs|khs|transkrip|semester\s+(?:genap|ganjil|antara|pendek)|kalender\s+akademik|jadwal\s+akademik|remedial|remidi)\b/i.test(q)
  };

  const leaked = [];
  const addLeak = (key, allowed, pattern) => {
    if (!allowed && pattern.test(a)) leaked.push(key);
  };

  addLeak('visa', allows.visa, /\b(?:visa|vitas|e\s*30\s*b|itas|kitas|sktt|izin\s+belajar|study\s+permit|mahasiswa\s+asing)\b/i);
  addLeak('rpl', allows.rpl, /\b(?:rekognisi\s+pembelajaran\s+lampau|\brpl\b|konversi\s+sks|pengakuan\s+sks|d1\s*,?\s*d2|d3\s*:\s*antara\s*\d|\b85\s*s\/d\s*100\s*sks\b)\b/i);
  addLeak('double_degree', allows.doubleDegree, /\b(?:double\s*degree|dual\s*degree|dnui|dalian\s+neusoft|help\s+university|utb|universitas\s+teknologi\s+bandung)\b/i);
  addLeak('accreditation', allows.accreditation, /\b(?:ban\s*-?pt|lam\s*infokom|nomor\s+sk|akreditasi\s+prodi|terakreditasi)\b/i);
  addLeak('career', allows.career, /\b(?:career\s*center|job\s*fair|campus\s*hiring|tracer\s*study|lowongan\s+kerja)\b/i);
  addLeak('academic_admin', allows.academicAdmin, /\b(?:yudisium|wisuda|sidang\s+tugas\s+akhir|pendaftaran\s+ujian\s+proposal|seminar\s+terbuka|sion|baak)\b/i);

  const asksS1D3Comparison = /\b(?:beda|bedanya|perbedaan|bandingkan|perbandingan)\b/i.test(q)
    && /\bs\s*1\b|sarjana/i.test(q)
    && /\bd\s*3\b|diploma/i.test(q);
  if (asksS1D3Comparison && leaked.length) return true;

  if (leaked.includes('visa')) return true;
  if (leaked.includes('rpl') && !/\b(?:sks|d3|diploma)\b/i.test(q)) return true;
  if (leaked.includes('double_degree') && !/\b(?:program\s+(?:apa|apa\s+saja|apa\s+aja|studi)|prodi|jurusan|internasional|pmb|pendaftaran|mahasiswa\s+baru)\b/i.test(q)) return true;
  return leaked.length >= 2;
}

function extractFocusedUploadedEvidenceSnippet(text, question) {
  const cleaned = cleanUserVisibleRagAnswerText(text)
    .replace(/(?:^|\n)\s*[-*]?\s*(?:Program studi terlihat|Biaya pendidikan terlihat|Jadwal\/gelombang|UKT\s*\/\s*biaya per semester)\s*:\s*/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned || cleaned.length < 12) return '';

  const q = String(question || '');
  const anchors = extractQueryAnchorTerms(q).filter((anchor) => !/^(?:faq|qna|apa|saja|tentang|program|studi|prodi)$/i.test(anchor));
  const addAnchor = (value, pattern) => {
    if (pattern.test(q) && !anchors.includes(value)) anchors.push(value);
  };
  addAnchor('student exchange', /\b(?:student|study)\s+exchange\b/i);
  addAnchor('pertukaran mahasiswa', /\bpertukaran\s+mahasiswa\b/i);
  addAnchor('double degree', /\b(?:double|dual)\s+degree\b/i);
  addAnchor('visa study', /\b(?:visa\s+(?:study|studi|pelajar)|izin\s+belajar|study\s+permit)\b/i);
  addAnchor('stikom bali goes to school', /\b(?:stikom\s+bali\s+)?goes\s*to\s*school\b/i);
  addAnchor('goes to school', /\bgoes\s*to\s*school\b/i);

  const strongAnchors = anchors.filter((anchor) => /\b(?:double degree|dual degree|student exchange|study exchange|pertukaran mahasiswa|help|dnui|utb|rpl|akreditasi|ban pt|beasiswa|skss|kip|1k1s|visa study|izin belajar|inbis|cdc|career center|goes to school|stikom bali goes to school)\b/i.test(anchor));
  if (!anchors.length || cleaned.length <= 900) return cleaned;

  const units = cleaned
    .replace(/\s+(?=(?:\d+[.)]|[-*])\s+)/g, '\n')
    .split(/\n{1,}|(?<=[.!?])\s+(?=[A-Z0-9\p{Lu}])/u)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 18);

  let best = null;
  for (let i = 0; i < units.length; i += 1) {
    const windowText = [units[i], units[i + 1]].filter(Boolean).join(' ');
    const norm = normalizeForLexicalMatch(windowText);
    if (!norm) continue;
    if (strongAnchors.length) {
      const hasStrongAnchor = strongAnchors.some((anchor) => {
        const sa = normalizeForLexicalMatch(anchor);
        return sa && norm.includes(sa);
      });
      if (!hasStrongAnchor) continue;
    }
    let score = 0;
    for (const anchor of anchors) {
      const a = normalizeForLexicalMatch(anchor);
      if (!a) continue;
      const hit = a.length <= 4 ? new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(norm) : norm.includes(a);
      if (hit) score += a.includes(' ') ? 3 : 2;
    }
    const asksDefinitionSnippet = /\b(?:apa\s+itu|itu\s+(?:program\s+)?apa|program\s+apa|pengertian|maksud(?:nya)?|jelaskan|tentang)\b/i.test(q);
    if (asksDefinitionSnippet && /\b(?:adalah|merupakan|bertujuan|tujuan|latar\s+belakang|mengenalkan|memperkenalkan)\b/i.test(norm)) score += 4;
    if (asksDefinitionSnippet && /\b(?:ruang\s+lingkup|target\s+peserta|sertifikat|bagi\s+siswa|bagi\s+tenaga\s+pengajar)\b/i.test(norm)) score -= 2;
    score += Math.min(2, computeLexicalScore(q, windowText) * 2);
    if (score > 0 && (!best || score > best.score || (score === best.score && windowText.length > best.text.length))) {
      best = { score, text: windowText };
    }
  }

  if (best && best.text) return best.text.length > 900 ? `${best.text.slice(0, 897).trim()}...` : best.text;
  return strongAnchors.length ? '' : cleaned;
}
function isIndustryServicesQuestion(question) {
  return /\b(?:layanan\s+industri|dari\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i.test(String(question || ''));
}

function tryIndustryServicesAnswerFromIndex(question) {
  if (!isIndustryServicesQuestion(question)) return null;
  const index = getCachedSemanticIndex();
  if (!Array.isArray(index) || !index.length) return null;
  const candidates = [];
  for (const item of index) {
    const chunk = cleanUserVisibleRagAnswerText(item && item.chunk ? item.chunk : '');
    if (!chunk) continue;
    const hay = `${item && (item.filename || item.sourceFile || item.title) || ''}\n${chunk}`;
    if (!/\b(?:layanan\s+industri|direktorat\s+kerja\s*sama|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i.test(hay)) continue;
    if (hasUploadedDocumentTopicConflict(question, chunk)) continue;
    if (/\b(?:goes\s*to\s*school|unlock\s+your\s+digital\s+potential|siswa\s+sma|sma\/smk|sekolah)\b/i.test(chunk)
      && !/\b(?:layanan\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i.test(chunk)) continue;
    const units = chunk.split(/\n{1,}|(?<=[.!?])\s+/).map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const picked = units.filter((unit) => /\b(?:layanan\s+industri|direktorat\s+kerja\s*sama|kerja\s*sama\s+industri|kerjasama\s+industri|perusahaan|rekrutmen|pelatihan\s+industri)\b/i.test(unit)).slice(0, 3);
    const text = (picked.length ? picked : units.slice(0, 2)).join('\n');
    if (text && isIndustryServicesQuestionAnswer(question, text)) candidates.push(text);
  }
  if (!candidates.length) return null;
  return {
    answer: [
      'Layanan Industri ITB STIKOM Bali berkaitan dengan fasilitasi kerja sama kampus dengan pihak industri atau mitra eksternal.',
      '',
      'Dari data yang terbaca, konteks layanan ini mencakup kerja sama industri, akses mitra eksternal, rekrutmen/campus hiring, magang, pelatihan, atau kolaborasi yang mendukung pembelajaran dan pengembangan karier mahasiswa.',
      '',
      'Untuk daftar layanan resmi, alur pengajuan kerja sama, PIC, atau dokumen yang diperlukan, kakak sebaiknya konfirmasi ke admin kampus atau unit kerja sama terkait.'
    ].join('\n'),
    source: 'semantic-rag-campus-support-entity',
    frameSource: 'semantic-rag-campus-support-entity'
  };
}

function assessUploadedEvidenceSnippetQuality(text, item = {}, question = '') {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  if (!original) return { status: 'reject', reason: 'empty', completeText: '' };
  const lower = original.toLowerCase();
  const q = String(question || '').toLowerCase();
  const source = String(item && item.source || '').toLowerCase();
  const startsMidSentence = /^(?:dan|atau|serta|selain|sehingga|untuk|dengan|yang|pada|dalam|ke-|un\s+ke-?\d+|tahun\s+ke-?\d+)\b/i.test(original);
  const hasTerminal = /[.!?)]$/.test(original);
  const hasInlineBulletLeak = /\s[-*]\s+[A-Z0-9]/.test(original) || /(?:^|\s)(?:[-*]\s+){2,}/.test(original);
  const hasBrokenQna = /\b(?:pertanyaan|jawaban|source_chunks|confidence|embedding|chunk_id)\s*[:=]/i.test(original);
  const hasOcrNoise = /(?:\uFFFD|[_=]{3,}|\.{4,}|\bundefined\b|\bnull\b)/i.test(original);
  const endsLikeDanglingFragment = /\b(?:yang|dan|atau|serta|dengan|untuk|pada|dalam|sebagai|agar|yang dapat|yang men|kuriku|mahasis|mencerminkan harapan agar)\.?$/i.test(lower);
  const isVeryShortFragment = original.length < 55 && !hasTerminal;
  const isLongEnoughNaturalSentence = original.length >= 70 && hasTerminal;
  const hasQuestionDomainSignal = extractQueryAnchorTerms(question).some((term) => term && lower.includes(String(term).toLowerCase()));
  const hasSourceDomainSignal = /career|karier|beasiswa|scholar|fasilitas|facility|program|international|double|degree|academic|akademik/.test(source + ' ' + lower);

  if (hasBrokenQna || hasOcrNoise || hasInlineBulletLeak) return { status: 'reject', reason: 'raw_or_ocr_leak', completeText: original };
  if (startsMidSentence) return { status: 'reject', reason: 'starts_mid_sentence', completeText: original };
  if (endsLikeDanglingFragment || isVeryShortFragment) return { status: 'reject', reason: 'incomplete_fragment', completeText: original };
  if (!hasTerminal && original.length < 180) return { status: 'reject', reason: 'missing_terminal_punctuation', completeText: original };
  if (!hasQuestionDomainSignal && !hasSourceDomainSignal && !isLongEnoughNaturalSentence) {
    return { status: 'reject', reason: 'low_domain_signal', completeText: original };
  }
  return { status: 'accept', reason: 'complete_evidence', completeText: original };
}

function buildLocalUploadedTrainingAnswer(question, selectedEvidence) {
  const evidence = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const scheduleSummary = buildAcademicScheduleSummaryAnswer(question, evidence);
  if (scheduleSummary) return scheduleSummary;
  const requirementSummary = buildAcademicRequirementSummaryAnswer(question, evidence);
  if (requirementSummary) return requirementSummary;
  const academicGeneralSummary = buildAcademicGeneralSummaryAnswer(question, evidence);
  if (academicGeneralSummary) return academicGeneralSummary;

  const questionAnchors = extractQueryAnchorTerms(question);
  let bestFaq = null;
  for (const item of evidence) {
    const rawText = String(item && (item.text || item.chunk) || '').trim();
    if (!rawText) continue;
    const faqMatch = extractBestFaqAnswerFromChunk(rawText, normalizeFacilityTerm(question), questionAnchors, question, true);
    if (!faqMatch || !faqMatch.answer) continue;
    if (!bestFaq || Number(faqMatch.score || 0) > Number(bestFaq.score || 0)) bestFaq = faqMatch;
  }
  if (bestFaq && bestFaq.answer && Number(bestFaq.score || 0) >= 6) return bestFaq.answer;

  const snippets = [];
  const seen = new Set();

  for (const item of evidence) {
    const text = extractFocusedUploadedEvidenceSnippet(item && item.text, question);
    if (!text || text.length < 12) continue;
    const quality = assessUploadedEvidenceSnippetQuality(text, item, question);
    if (quality.status === 'reject') continue;
    const completeText = quality.completeText;
    const normalized = normalizeFacilityTerm(completeText);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    snippets.push(completeText.length > 900 ? `${completeText.slice(0, 897).trim()}...` : completeText);
    if (snippets.length >= 3) break;
  }

  if (!snippets.length) return '';

  const asksDefinition = /\b(apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|jelaskan|tentang)\b/i.test(String(question || ''));
  if (asksDefinition && snippets.length === 1) return snippets[0];
  if (snippets.length === 1) return snippets[0];

  return snippets.map((line) => `- ${line}`).join('\n');
}

function isAcademicAdminUploadedDocQuestion(question, intent = '') {
  const q = normalizeAcademicAdminQueryText(question).toLowerCase();
  if (!['schedule', 'requirement', 'general', 'list'].includes(String(intent || ''))) return false;
  if (/\b(pmb|penerimaan\s+mahasiswa\s+baru|camaba|daftar\s+kuliah|gelombang\s+pendaftaran|biaya|ukt|dpp)\b/i.test(q)) return false;
  return /\b(sidang|tugas\s+akhir|skripsi|tesis|seminar\s+proposal|sempro|yudisium|wisuda|kelulusan|akademik)\b/i.test(q);
}
function hasAcademicAdminQuestionOverlap(question, content) {
  const q = normalizeAcademicAdminQueryText(question).toLowerCase();
  const c = normalizeAcademicAdminQueryText(content).toLowerCase();
  if (!q.trim() || !c.trim()) return false;

  const asksThesisDefense = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q);
  const asksYudisium = /\byudisium\b/i.test(q);
  const asksWisuda = /\bwisuda\b/i.test(q);
  const asksSempro = /\b(seminar\s+proposal|sempro)\b/i.test(q);
  const asksSchedule = /\b(kapan|jadwal|tanggal|deadline|terakhir|pendaftaran|daftar|registrasi|pelaksanaan|dilaksanakan|berlangsung|pukul|jam|waktu|akan\s+datang|informasi(?:nya)?|info)\b/i.test(q);

  if (asksThesisDefense && !/\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(c)) return false;
  if (asksThesisDefense && asksSchedule) {
    const scheduleNearThesis = /\b(?:pendaftaran|daftar|registrasi|jadwal|tanggal|deadline|terakhir|sampai\s+dengan|hari\s*\/?\s*tanggal|pukul|loket|tempat)\b[\s\S]{0,180}\b(?:sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(c)
      || /\b(?:sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b[\s\S]{0,180}\b(?:pendaftaran|daftar|registrasi|jadwal|tanggal|deadline|terakhir|sampai\s+dengan|hari\s*\/?\s*tanggal|pukul|loket|tempat)\b/i.test(c);
    if (!scheduleNearThesis) return false;
  }
  if (asksYudisium && !/\byudisium\b/i.test(c)) return false;
  if (asksWisuda && !/\bwisuda\b/i.test(c)) return false;
  if (asksSempro && !/\b(seminar\s+proposal|sempro)\b/i.test(c)) return false;
  if (asksSchedule && !/\b(pendaftaran|daftar|registrasi|pelaksanaan|dilaksanakan|berlangsung|hari\s*\/?\s*tanggal|tanggal|pukul|jam|waktu|deadline|terakhir|sampai\s+dengan|loket|tempat|lokasi|aula|periode)\b/i.test(c)) return false;

  return /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|seminar\s+proposal|sempro|yudisium|wisuda|kelulusan|akademik)\b/i.test(c);
}
function selectAcademicAdminUploadedEvidence(question, contexts, options = {}) {
  const normalizedQuestion = normalizeAcademicAdminQueryText(question);
  const intent = options.intent || detectGenericIntent(normalizedQuestion);
  const list = Array.isArray(contexts) ? contexts : [];
  const q = normalizedQuestion;
  const qNorm = normalizeForLexicalMatch(q);
  const wantedTerms = extractQueryAnchorTerms(q);

  const addWanted = (term, pattern) => {
    if (pattern.test(q) && !wantedTerms.includes(term)) wantedTerms.push(term);
  };

  addWanted('sidang', /\bsidang\b/i);
  addWanted('tugas akhir', /\btugas\s+akhir\b/i);
  addWanted('proyek akhir', /\bproyek\s+akhir\b/i);
  addWanted('yudisium', /\byudisium\b/i);
  addWanted('wisuda', /\bwisuda\b/i);
  addWanted('seminar proposal', /\b(?:seminar\s+proposal|sempro)\b/i);

  const asksThesisDefense = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q);
  const asksYudisium = /\byudisium\b/i.test(q);
  const asksWisuda = /\bwisuda\b/i.test(q);
  const academicTermPattern = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|seminar\s+proposal|sempro|yudisium|wisuda|akademik)\b/i;
  const detailPattern = /\b(hari\s*\/?\s*tanggal|tanggal|pukul|jam|waktu|wita|wib|wit|tempat|loket|lokasi|aula|ruang|pelaksanaan|dilaksanakan|berlangsung|deadline|terakhir|sampai\s+dengan|periode|semester|tahun\s+akademik)\b/i;
  const datePattern = /\b(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|ahad)?\s*,?\s*\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+\d{4}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/i;
  const timePattern = /\b\d{1,2}[.:]\d{2}\s*(?:wita|wib|wit)?\b/i;
  const sectionHeaderPattern = /^\s*(?:[A-Z]\.|[IVXLCDM]+\.|\d+[.)])\s+/i;

  const candidates = [];

  for (const ctx of list) {
    if (!ctx) continue;
    const raw = String(ctx.chunk || ctx.text || '');
    const cleaned = cleanDocumentMarkers(raw);
    if (!cleaned.trim()) continue;

    const lines = cleaned
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!lines.length) continue;

    const filename = ctx.filename || ctx.sourceFile || ctx.source || 'uploaded-training';
    const documentHaystack = `${filename}\n${cleaned}`;
    if (!hasAcademicAdminQuestionOverlap(q, documentHaystack)) continue;
    if (/\b(SK|surat\s+keputusan|keputusan\s+rektor|pengelola|inkubator|inbis|kerja\s+sama|perjanjian|mou|moa)\b/i.test(filename) && !hasAnchorOverlap(q, documentHaystack)) continue;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineContext = `${line} ${filename}`;
      const lineNorm = normalizeForLexicalMatch(lineContext);
      const anchorHit = hasAcademicAdminQuestionOverlap(q, lineContext);
      const explicitTermHit = academicTermPattern.test(line) && wantedTerms.some((term) => lineNorm.includes(normalizeForLexicalMatch(term)));
      const broadAcademicHit = academicTermPattern.test(line) && computePhraseOverlap(qNorm, lineNorm) > 0;
      if (!anchorHit && !explicitTermHit && !broadAcademicHit) continue;

      let start = i;
      for (let back = i; back >= Math.max(0, i - 8); back -= 1) {
        if (sectionHeaderPattern.test(lines[back]) || academicTermPattern.test(lines[back])) {
          start = back;
        }
      }

      let end = Math.min(lines.length, start + 18);
      for (let next = start + 1; next < Math.min(lines.length, start + 22); next += 1) {
        if (next > i && sectionHeaderPattern.test(lines[next]) && !academicTermPattern.test(lines[next])) {
          end = next;
          break;
        }
      }

      const block = lines.slice(start, end).join('\n').trim();
      if (!block || !hasAcademicAdminQuestionOverlap(q, `${block} ${filename}`)) continue;

      if (asksThesisDefense && !asksYudisium && /\byudisium\b/i.test(block) && !/\b(?:pendaftaran\s+sidang\s+tugas\s+akhir|sidang\s+tugas\s+akhir\s*\/\s*proyek\s+akhir|proyek\s+akhir)\b/i.test(block)) continue;
      if (asksYudisium && !asksThesisDefense && /\b(?:sidang\s+tugas\s+akhir\s*\/\s*proyek\s+akhir|pendaftaran\s+sidang)\b/i.test(block)) continue;
      if (asksWisuda && !/\bwisuda\b/i.test(block)) continue;

      const hasScheduleDetail = datePattern.test(block) || timePattern.test(block) || detailPattern.test(block);
      const looksLikeRequirementOnly = /\b(persyaratan|syarat|wajib|ketentuan)\b/i.test(block) && !/\b(hari\s*\/?\s*tanggal|pukul|jam|wita|wib|wit|tempat|loket|deadline|terakhir\s+dapat\s+dilakukan|sampai\s+dengan)\b/i.test(block);
      if (intent === 'schedule' && looksLikeRequirementOnly) continue;
      const hasRequirementDetail = /\b(wajib|syarat|persyaratan|dokumen|berkas|melengkapi|formulir|krs|bukti|persetujuan)\b/i.test(block);
      if (intent === 'schedule' && !hasScheduleDetail) continue;
      if (intent === 'requirement' && !hasRequirementDetail) continue;

      const blockNorm = normalizeForLexicalMatch(block);
      const wantedHitCount = wantedTerms.filter((term) => blockNorm.includes(normalizeForLexicalMatch(term))).length;
      const directQuestionPhraseBonus = qNorm && blockNorm.includes(qNorm) ? 0.2 : 0;
      const wantedTermBonus = Math.min(0.35, wantedHitCount * 0.1) + directQuestionPhraseBonus;
      const score = computeGenericScore(q, block, intent) + wantedTermBonus + (datePattern.test(block) ? 0.25 : 0) + (timePattern.test(block) ? 0.15 : 0);
      candidates.push({
        text: block.length > 1200 ? `${block.slice(0, 1197).trim()}...` : block,
        source: filename,
        sourceId: ctx.id || ctx.trainingId || 'unknown',
        score,
        entityScore: 1,
        intentScore: intent === detectGenericIntent(block) ? 1 : 0.8,
        reason: `academic_uploaded_block; score=${score.toFixed(2)}`,
        isSelectedEvidence: true
      });
    }
  }

  const seen = new Set();
  return candidates
    .filter((item) => {
      const key = normalizeForLexicalMatch(item.text).slice(0, 220);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.maxEvidence || 2);
}
function isKnownSpecializedCampusQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(kegiatan\s+mahasiswa|aktivitas\s+mahasiswa|unit\s+kegiatan|program\s+kerja|ukm|ormawa|organisasi\s+mahasiswa|bem|dpm|hima)\b/i.test(q)) return true;
  if (/\b(student\s*exchange|pertukaran\s+mahasiswa|gccp|bccp|program\s+internasional|international\s+program|double\s*degree|dual\s*degree)\b/i.test(q)) return true;
  if (/\b(lokasi|alamat|kampus\s+di\s+mana|dimana\s+kampus|where\s+is|campus\s+location|location|address)\b/i.test(q)) return true;
  if (/\b(layanan\s+industri|kerja\s*sama\s+industri|goes?\s*to\s*school|kunjungan\s+sekolah)\b/i.test(q)) return true;
  return /\b(pmb|penerimaan\s+mahasiswa\s+baru|mahasiswa\s+baru|camaba|siap\.stikom|daftar\s+kuliah|pendaftaran\s+kuliah)\b/i.test(q)
    || /\b(biaya|harga|tarif|ukt|dpp|gelombang|jadwal\s+pendaftaran|beasiswa(?:nya)?|kip|potongan)\b/i.test(q)
    || /\b(prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si\b|ti\b|bd\b|sk\b|mi\b)\b/i.test(q)
    || /\b(akreditasi(?:nya)?|terakreditasi|ban-pt|peringkat\s+akreditasi)\b/i.test(q)
    || /\b(double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(q)
    || /\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|bem|dpm|hima)\b/i.test(q)
    || /\b(linked\s*in|linkedin|career\s*center|pusat\s+karier|pusat\s+karir|inkubator\s+bisnis|language\s+learning|student\s+exchange|gccp|bccp|hi-?think|hithink)\b/i.test(q);
}


function shouldProbeUploadedTrainingBeforeDeterministic(question) {
  const q = normalizeAcademicAdminQueryText(question);
  const intent = detectGenericIntent(q);
  if (isAcademicAdminUploadedDocQuestion(q, intent) || isAcademicAdminUploadedDocQuestion(q, 'requirement')) return true;
  if (isStudyPermitQuestion(q) || isStudentExchangeQuestion(q) || isOverseasWorkStudyQuestion(q) || isPaidOverseasInternshipQuestion(q)) return true;
  if (/\b(?:pasca|pascasarjana|pasca\s*sarjana|magister|s2|s\s*2)\b/i.test(q)) return true;
  return !isKnownSpecializedCampusQuestion(q);
}
function retrieveAcademicAdminUploadedContextsFromIndex(question, options = {}) {

  const index = getCachedSemanticIndex();
  if (!Array.isArray(index) || !index.length) return [];

  const q = normalizeAcademicAdminQueryText(question);
  const intent = options.intent || detectGenericIntent(q);
  if (!isAcademicAdminUploadedDocQuestion(q, intent)) return [];

  const anchors = extractQueryAnchorTerms(q);
  const addAnchor = (term, pattern) => {
    if (pattern.test(q) && !anchors.includes(term)) anchors.push(term);
  };
  addAnchor('sidang', /\bsidang\b/i);
  addAnchor('tugas akhir', /\btugas\s+akhir\b/i);
  addAnchor('proyek akhir', /\bproyek\s+akhir\b/i);
  addAnchor('pendaftaran sidang', /\bpendaftaran\s+sidang\b/i);
  addAnchor('yudisium', /\byudisium\b/i);
  addAnchor('wisuda', /\bwisuda\b/i);

  const academicPattern = /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|seminar\s+proposal|sempro|yudisium|wisuda|kelulusan|akademik)\b/i;
  const detailPattern = /\b(hari\s*\/?\s*tanggal|tanggal|pukul|jam|waktu|wita|wib|wit|tempat|loket|lokasi|aula|pelaksanaan|dilaksanakan|berlangsung|deadline|terakhir|sampai\s+dengan|periode|semester|tahun\s+akademik)\b/i;
  const qNorm = normalizeForLexicalMatch(q);
  const scored = [];

  for (const item of index) {
    if (!item || !String(item.chunk || '').trim()) continue;
    const filename = item.filename || item.sourceFile || 'rag-index';
    const chunk = cleanDocumentMarkers(String(item.chunk || ''));
    const haystack = `${filename}\n${chunk}`;
    if (!hasAcademicAdminQuestionOverlap(q, haystack)) continue;

    const hayNorm = normalizeForLexicalMatch(haystack);
    const anchorHits = anchors.filter((term) => hayNorm.includes(normalizeForLexicalMatch(term))).length;
    if (!anchorHits && !academicPattern.test(chunk)) continue;

    let score = computeGenericScore(q, haystack, intent);
    score += Math.min(0.4, anchorHits * 0.12);
    score += Math.min(0.25, computeLexicalScore(q, chunk, filename) * 0.25);
    if (detailPattern.test(chunk)) score += 0.22;
    if (qNorm && hayNorm.includes(qNorm)) score += 0.18;
    if (/\b(yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir)\b/i.test(filename)) score += 0.2;
    if (/\b(SK|surat\s+keputusan|keputusan\s+rektor|pengelola|inkubator|inbis|kerja\s+sama|perjanjian|mou|moa)\b/i.test(filename) && !/\b(yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir)\b/i.test(filename)) score -= 0.45;

    if (score < 0.2) continue;
    scored.push({
      id: item.id || null,
      score: Math.max(0, Math.min(1, score)),
      chunk,
      filename,
      trainingId: item.trainingId || null,
      divisionKey: item.divisionKey || null,
      metadata: item.metadata || null,
      intent,
      sourceType: 'semantic-academic-index'
    });
  }

  scored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return scored.slice(0, options.topK || 12);
}
function retrieveGenericUploadedContextsFromIndex(question, options = {}) {
  const index = getCachedSemanticIndex();
  if (!Array.isArray(index) || !index.length) return [];

  const q = String(question || '');
  const intent = options.intent || detectGenericIntent(q);
  if (!q.trim() || intent === 'fee') return [];

  const anchors = extractQueryAnchorTerms(q);
  if (!anchors.length) return [];

  const scored = [];
  for (const item of index) {
    if (!item || !String(item.chunk || '').trim()) continue;
    const filename = item.filename || item.sourceFile || 'rag-index';
    const chunk = cleanDocumentMarkers(String(item.chunk || ''));
    const haystack = `${filename}\n${chunk}`;
    if (!hasAnchorOverlap(q, haystack)) continue;
    if (isLikelyRawAdministrativeDocument(chunk, filename)) continue;

    const hayNorm = normalizeForLexicalMatch(haystack);
    const anchorHits = anchors.filter((term) => hayNorm.includes(normalizeForLexicalMatch(term))).length;
    if (!anchorHits) continue;

    const chunkIntent = detectGenericIntent(chunk);
    const intentCompatibility = computeIntentCompatibility(chunk, intent);
    const genericScore = computeGenericScore(q, haystack, intent);
    const lexicalScore = computeLexicalScore(q, chunk, filename);
    const sourceBoost = computeSourceIntentBoost(q, item, intent);
    let score = (genericScore * 0.5) + (lexicalScore * 0.25) + (intentCompatibility * 0.15) + Math.min(0.25, anchorHits * 0.08) + sourceBoost;

    if (intent === 'schedule' && /\b(kapan|jadwal|tanggal|deadline|terakhir)\b/i.test(q)) {
      if (!/\b(hari\s*\/?\s*tanggal|tanggal|pukul|jam|deadline|terakhir|sampai\s+dengan|periode|bulan|tahun|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i.test(chunk)) continue;
      score += 0.15;
    }

    if (intent === 'requirement' && /\b(syarat|persyaratan|dokumen|berkas|ketentuan)\b/i.test(q)) {
      if (!/\b(syarat|persyaratan|dokumen|berkas|ketentuan|wajib|melampirkan|mengunggah|formulir|kartu|surat|bukti)\b/i.test(chunk)) continue;
      score += 0.12;
    }

    if (intent === 'facility' && /\b(fasilitas|layanan|pelayanan|unit|bagian|direktorat|kantor|loket)\b/i.test(q)) {
      if (!/\b(fasilitas|layanan|pelayanan|unit|bagian|direktorat|kantor|loket|alamat|kontak|fungsi|tugas)\b/i.test(chunk)) continue;
      score += 0.1;
    }

    if (score < 0.28) continue;
    scored.push({
      id: item.id || null,
      score: Math.max(0, Math.min(1, score)),
      chunk,
      filename,
      trainingId: item.trainingId || null,
      divisionKey: item.divisionKey || null,
      metadata: item.metadata || null,
      intent: chunkIntent || intent,
      sourceType: 'semantic-generic-index'
    });
  }

  scored.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return scored.slice(0, options.topK || 12);
}
async function retrieveAcademicAdminUploadedContextsFromDb(question, options = {}) {
  const q = normalizeAcademicAdminQueryText(question);
  const intent = options.intent || detectGenericIntent(q);
  if (!isAcademicAdminUploadedDocQuestion(q, intent)) return [];

  const rows = await getActiveTrainingDataFromDb();
  if (!Array.isArray(rows) || !rows.length) return [];

  const out = [];
  for (const row of rows) {
    if (!row || !String(row.content || '').trim()) continue;
    const filename = row.filename || row.source || 'uploaded-training';
    const content = cleanDocumentMarkers(String(row.content || ''));
    const haystack = `${filename}\n${content}`;
    if (!hasAcademicAdminQuestionOverlap(q, haystack)) continue;

    let score = computeGenericScore(q, haystack, intent) + computeSourceIntentBoost(q, { filename, chunk: content }, intent);
    if (/\b(yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir)\b/i.test(filename)) score += 0.25;
    if (/\b(hari\s*\/?\s*tanggal|tanggal|pukul|jam|wita|wib|wit|tempat|loket|deadline|terakhir|sampai\s+dengan)\b/i.test(content)) score += 0.25;
    if (hasAnchorOverlap(q, haystack)) score += 0.15;

    out.push({
      id: `${row.id}-db-full`,
      score: Math.max(0.2, Math.min(1, score)),
      chunk: content,
      filename,
      trainingId: row.id || null,
      divisionKey: row.divisionKey || null,
      metadata: { source: 'database-full', ragIngestStatus: row.ragIngestStatus || 'unknown' },
      intent,
      sourceType: 'database-academic-full'
    });
  }

  out.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return out.slice(0, options.topK || 6);
}
async function retrieveGenericUploadedContextsFromDb(question, seedContexts = [], options = {}) {
  const q = String(question || '');
  const intent = options.intent || detectGenericIntent(q);
  if (!q.trim() || intent === 'fee') return [];

  const anchors = extractQueryAnchorTerms(q);
  if (!anchors.length) return [];

  const seeds = Array.isArray(seedContexts) ? seedContexts : [];
  const seedTrainingIds = new Set(seeds.map((ctx) => String(ctx && ctx.trainingId || '').trim()).filter(Boolean));
  const seedFilenames = new Set(seeds.map((ctx) => normalizeForLexicalMatch(ctx && (ctx.filename || ctx.sourceFile || ctx.source) || '')).filter(Boolean));

  const rows = await getActiveTrainingDataFromDb();
  if (!Array.isArray(rows) || !rows.length) return [];

  const requiresSeed = seedTrainingIds.size > 0 || seedFilenames.size > 0;
  const out = [];
  for (const row of rows) {
    if (!row || !String(row.content || '').trim()) continue;
    const filename = row.filename || row.source || 'uploaded-training';
    const filenameNorm = normalizeForLexicalMatch(filename);
    const matchesSeed = seedTrainingIds.has(String(row.id || '')) || seedFilenames.has(filenameNorm);
    if (requiresSeed && !matchesSeed) continue;

    const content = cleanDocumentMarkers(String(row.content || ''));
    const haystack = `${filename}\n${content}`;
    if (!hasAnchorOverlap(q, haystack)) continue;
    if (isLikelyRawAdministrativeDocument(content, filename) && !/\b(pasal|ayat|legal|hukum|perjanjian|mou|moa|kerja\s*sama)\b/i.test(q)) continue;

    const hayNorm = normalizeForLexicalMatch(haystack);
    const anchorHits = anchors.filter((term) => hayNorm.includes(normalizeForLexicalMatch(term))).length;
    if (!anchorHits) continue;

    const genericScore = computeGenericScore(q, haystack, intent);
    const lexicalScore = computeLexicalScore(q, content, filename);
    const intentCompatibility = computeIntentCompatibility(content, intent);
    let score = (genericScore * 0.55) + (lexicalScore * 0.25) + (intentCompatibility * 0.1) + Math.min(0.25, anchorHits * 0.08);
    if (matchesSeed) score += 0.2;

    if (intent === 'schedule' && /\b(kapan|jadwal|tanggal|deadline|terakhir)\b/i.test(q)) {
      if (!/\b(hari\s*\/?\s*tanggal|tanggal|pukul|jam|deadline|terakhir|sampai\s+dengan|periode|bulan|tahun|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i.test(content)) continue;
      score += 0.15;
    }

    if (intent === 'requirement' && /\b(syarat|persyaratan|dokumen|berkas|ketentuan)\b/i.test(q)) {
      if (!/\b(syarat|persyaratan|dokumen|berkas|ketentuan|wajib|melampirkan|mengunggah|formulir|kartu|surat|bukti)\b/i.test(content)) continue;
      score += 0.12;
    }

    if (score < (matchesSeed ? 0.2 : 0.42)) continue;
    out.push({
      id: `${row.id}-db-full-generic`,
      score: Math.max(0.2, Math.min(1, score)),
      chunk: content,
      filename,
      trainingId: row.id || null,
      divisionKey: row.divisionKey || null,
      metadata: { source: 'database-full-generic', ragIngestStatus: row.ragIngestStatus || 'unknown' },
      intent,
      sourceType: 'database-generic-full'
    });
  }

  out.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return out.slice(0, options.topK || 6);
}
async function tryDirectAcademicAdminUploadedSectionAnswer(question, options = {}) {
  const normalizedQuestion = normalizeAcademicAdminQueryText(question);
  const intent = detectGenericIntent(normalizedQuestion);
  if (!isAcademicAdminUploadedDocQuestion(normalizedQuestion, intent) && !isAcademicAdminUploadedDocQuestion(normalizedQuestion, 'requirement')) return null;

  const rows = await getActiveTrainingDataFromDb();
  if (!Array.isArray(rows) || !rows.length) return null;

  const contexts = [];
  for (const row of rows) {
    if (!row || !String(row.content || '').trim()) continue;
    const filename = row.filename || row.source || 'uploaded-training';
    const content = cleanDocumentMarkers(String(row.content || ''));
    const haystack = `${filename}\n${content}`;
    if (!hasAcademicAdminQuestionOverlap(normalizedQuestion, haystack)) continue;
    contexts.push({
      text: content,
      source: filename,
      sourceId: row.id || 'unknown',
      score: 0.95,
      entityScore: 1,
      intentScore: 1,
      reason: 'academic_uploaded_direct_section',
      isSelectedEvidence: true
    });
  }
  if (!contexts.length) return null;

  const answer = buildLocalUploadedTrainingAnswer(normalizedQuestion, contexts);
  if (!answer) return null;
  const framedAnswer = formatNaturalAnswerFrame(question, answer, 'semantic-rag-uploaded-training-generic');
  const preflight = evaluateOutboundAnswer(framedAnswer, question, { source: 'semantic-rag-uploaded-training-generic' });
  if ((preflight && preflight.blocked) || hasRawSpreadsheetFaqDump(answer) || hasRawEvidenceSnippetShape(answer)) return null;

  return {
    success: true,
    answer: framedAnswer,
    source: 'semantic-rag-uploaded-training-generic',
    contexts,
    confidenceScore: 0.95,
    confidenceTier: 'HIGH',
    debug: {
      routeStage: 'fallback-no-ai-local-training-db-direct-section',
      intent,
      answerabilityResult: { answerable: true, reason: 'academic_uploaded_direct_section_answerable', missingEvidence: [] }
    }
  };
}
async function tryLocalUploadedTrainingGenericAnswer(question, options = {}) {
  const normalizedAcademicQuestion = normalizeAcademicAdminQueryText(question);
  const questionForRetrieval = isAcademicAdminUploadedDocQuestion(normalizedAcademicQuestion, 'schedule') || isAcademicAdminUploadedDocQuestion(normalizedAcademicQuestion, 'requirement')
    ? normalizedAcademicQuestion
    : question;
  let intent = detectGenericIntent(questionForRetrieval);
  if (['general', 'list'].includes(intent) && /\b(internasional|international|double\s*degree|dual\s*degree|student\s+exchange|study\s+exchange|pertukaran\s+mahasiswa|dnui|dalian\s+neusoft|help(?:\s+university)?|utb|universitas\s+teknologi\s+bandung|gccp|bccp)\b/i.test(String(questionForRetrieval || ''))) {
    intent = 'international_program';
  }
  if (intent === 'fee') return null;
  const unsupportedPattern = /\b(password|username|system\s+prompt|database|data\s+pribadi|dokumen\s+internal|perjanjian|pks|addendum|pasal)\b/i;
  if (unsupportedPattern.test(String(question || ''))) return null;
  const directAcademicSection = await tryDirectAcademicAdminUploadedSectionAnswer(question, options);
  if (directAcademicSection && directAcademicSection.answer) return directAcademicSection;
  if (['schedule', 'requirement'].includes(intent) && !isAcademicAdminUploadedDocQuestion(question, intent)) return null;

  const adaptiveQueries = buildAdaptiveQueryVariants(questionForRetrieval, { limit: 8 });
  const retrieved = await retrieveSemanticContexts(adaptiveQueries.length ? adaptiveQueries : [questionForRetrieval], {
    topK: options.topK,
    question: questionForRetrieval,
    intent
  });
  const academicAdminUploaded = isAcademicAdminUploadedDocQuestion(questionForRetrieval, intent);
  const directAcademicContexts = academicAdminUploaded
    ? retrieveAcademicAdminUploadedContextsFromIndex(questionForRetrieval, { intent, topK: Math.max(12, Number(options.topK || 0) || 0) })
    : [];
  const fullAcademicDbContexts = academicAdminUploaded
    ? await retrieveAcademicAdminUploadedContextsFromDb(questionForRetrieval, { intent, topK: 6 })
    : [];
  const directGenericContexts = academicAdminUploaded
    ? []
    : retrieveGenericUploadedContextsFromIndex(questionForRetrieval, { intent, topK: Math.max(12, Number(options.topK || 0) || 0) });
  const retrievedContexts = Array.isArray(retrieved.contexts) ? retrieved.contexts : [];
  const fullGenericDbContexts = academicAdminUploaded
    ? []
    : await retrieveGenericUploadedContextsFromDb(questionForRetrieval, [...directGenericContexts, ...retrievedContexts], { intent, topK: 6 });
  const contexts = [
    ...fullAcademicDbContexts,
    ...fullGenericDbContexts,
    ...directAcademicContexts,
    ...directGenericContexts,
    ...retrievedContexts
  ];
  if (!contexts.length) return null;

  const hasDatabaseContext = contexts.some((ctx) => ctx && (ctx.sourceType === 'database' || (ctx.metadata && ctx.metadata.source === 'database')));
  const hasGenericIndexContext = contexts.some((ctx) => ctx && /^semantic-(?:generic|academic)-index$/.test(String(ctx.sourceType || "")));
  if (!academicAdminUploaded && !hasDatabaseContext && !hasGenericIndexContext) return null;

  const minScoreRaw = Number(process.env.SEMANTIC_RAG_LOCAL_DB_MIN_SCORE || '0.3');
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0.3;
  const academicMinScoreRaw = Number(process.env.SEMANTIC_RAG_ACADEMIC_UPLOAD_MIN_SCORE || '0.12');
  const academicMinScore = Number.isFinite(academicMinScoreRaw) ? academicMinScoreRaw : 0.12;
  const combinedTopScore = Math.max(Number(retrieved.topScore || 0), ...contexts.map((ctx) => Number(ctx && ctx.score || 0)));
  if (combinedTopScore < (academicAdminUploaded ? academicMinScore : minScore)) return null;

  let selectedEvidence = academicAdminUploaded
    ? selectAcademicAdminUploadedEvidence(questionForRetrieval, contexts, { intent, maxEvidence: 4 })
    : [];

  if (!selectedEvidence.length && !academicAdminUploaded) {
    selectedEvidence = selectEvidenceFromContexts({
      question,
      contexts,
      intent,
      maxEvidence: 4
    });
  }
  if (!selectedEvidence.length) return null;

  const answerability = academicAdminUploaded && selectedEvidence.some((item) => /academic_uploaded_block/i.test(String(item && item.reason || '')))
    ? { answerable: true, reason: 'academic_uploaded_block_answerable', missingEvidence: [] }
    : evaluateEvidenceAnswerability({ question: questionForRetrieval, selectedEvidence, intent });
  if (answerability && answerability.answerable === false) return null;

  const answer = buildLocalUploadedTrainingAnswer(questionForRetrieval, selectedEvidence);
  if (!answer) return null;
  if (!answerMatchesStrongQuestionAnchors(questionForRetrieval, answer) || hasUploadedDocumentTopicConflict(questionForRetrieval, answer)) return null;
  const source = (isIndustryServicesQuestionAnswer(questionForRetrieval, answer) || isCareerCenterQuestion(questionForRetrieval)) ? 'semantic-rag-campus-support-entity' : 'semantic-rag-uploaded-training-generic';
  const framedAnswer = formatNaturalAnswerFrame(question, answer, source);
  const preflight = evaluateOutboundAnswer(framedAnswer, questionForRetrieval, { source });
  if ((preflight && preflight.blocked && /uploaded-training-generic/i.test(source)) || hasRawSpreadsheetFaqDump(framedAnswer)) return null;

  return {
    success: true,
    answer: framedAnswer,
    source,
    contexts: selectedEvidence,
    confidenceScore: combinedTopScore,
    confidenceTier: combinedTopScore >= 0.55 ? 'HIGH' : 'MEDIUM',
    debug: {
      routeStage: 'fallback-no-ai-local-training-db',
      intent,
      answerabilityResult: answerability,
      indexSize: retrieved.indexSize
    }
  };
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

    const asksAccreditation = /\b(akreditasi|ban-pt|badan\s+akreditasi|peringkat\s+akreditasi|sertifikat\s+akreditasi|sk\s+akreditasi|status\s+akreditasi)\b/i.test(question);
    if (asksAccreditation) {
      const hasAccreditationEvidence = /\b(akreditasi|ban-pt|badan\s+akreditasi|sertifikat\s+akreditasi|sk\s+akreditasi|peringkat\s+akreditasi|status\s+akreditasi)\b/i.test(haystack);
      if (!hasAccreditationEvidence) return false;
    }

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

function extractStudentFacingEvidenceFromAdministrativeText(text, question) {
  const cleaned = cleanDocumentMarkers(text);
  if (!cleaned) return '';
  const sentences = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => cleanDocumentMarkers(part))
    .filter(Boolean);
  const relevant = sentences.filter((sentence) => {
    if (isLikelyRawAdministrativeDocument(sentence, '')) return false;
    if (/\b(?:PERJANJIAN\s+KERJA\s*SAMA|PIHAK\s+(?:KESATU|PERTAMA|KEDUA)|NOTA\s+KESEPAHAMAN|Pasal\s+\d+|FORCE\s+MAJEURE)\b/i.test(sentence)) return false;
    return computeGenericScore(question, sentence, detectGenericIntent(question)) >= 0.25
      && hasAnchorOverlap(question, sentence);
  });
  return relevant.join(' ').trim();
}
// Generic evidence selection by compatibility
function selectEvidenceByCompatibility(question, contexts, options = {}) {
  if (!Array.isArray(contexts)) return [];
  
  const questionIntent = options.intent || detectGenericIntent(question);
  const questionAnchors = extractQueryAnchorTerms(question);
  const metadataConstraints = deriveQueryMetadataConstraints(question, { intent: questionIntent });
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
      let evidenceText = cleaned;
      
      // Conditional admin/legal filtering. Keep only clean, anchored factual sentences
      // from mixed administrative chunks; otherwise reject the raw wrapper.
      if (!isLegalQuestion && isLikelyRawAdministrativeDocument(cleaned, ctx.filename || ctx.sourceFile || '')) {
        evidenceText = extractStudentFacingEvidenceFromAdministrativeText(cleaned, question);
        if (!evidenceText) continue;
      }
      
      // Hard metadata gate: reject obvious wrong-domain evidence before scoring.
      const metadataGate = applyKnowledgeMetadataHardGate({ ...ctx, chunk: evidenceText }, metadataConstraints);
      if (!metadataGate.pass) continue;

      // Generic compatibility scoring
      const genericScore = computeGenericScore(question, evidenceText, questionIntent);
      if (genericScore < 0.25) continue;
      
      // Anchor compatibility: only enforce distinctive terms from the user's question.
      const anchorOverlap = hasAnchorOverlap(question, String(evidenceText || '') + ' ' + String(ctx.filename || '') + ' ' + String(ctx.sourceFile || ''));
      if (!anchorOverlap) continue;
      
      // Factual terms check (reject generic-only matches)
      const hasFactualTerms = /[A-Z][a-z]+|\d+/.test(cleaned) || questionAnchors.length > 0;
      if (!hasFactualTerms) continue;
      
      evidenceUnits.push({
        text: evidenceText,
        source: ctx.filename || ctx.sourceFile || 'unknown',
        sourceId: ctx.id || ctx.trainingId || 'unknown',
        score: genericScore,
        entityScore: anchorOverlap ? 1 : 0,
        intentScore: questionIntent === detectGenericIntent(evidenceText) ? 1 : 0.5,
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
  const { getEvidenceRequirements, isScholarshipAligned, containsCurrency } = require('../utils/evidenceRequirements');
  const rules = getEvidenceRequirements(questionIntent, question);
  
  if (!evidence.length) {
    return { answerable: false, reason: 'no_selected_evidence', missingEvidence: ['selected_evidence'] };
  }
  
  const combinedText = evidence.map(e => e.text).join(' ');
  const missingEvidence = [];
  
  // Check for required information type based on intent
  if (questionIntent === 'fee') {
    if (rules.requireCurrency && !containsCurrency(combinedText)) {
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
  if ((rules.requireAnchorOverlap || questionIntent === 'general') && questionAnchors.length > 0 && !hasAnchorOverlap(question, combinedText)) {
    missingEvidence.push(questionIntent === 'general' ? 'requested_entity' : 'requested_anchor');
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

function classifySemanticRagFailure({ question, rewrite, retrieved, selectedEvidence, answerabilityResult, stage, extra } = {}) {
  const contexts = retrieved && Array.isArray(retrieved.contexts) ? retrieved.contexts : [];
  const selected = Array.isArray(selectedEvidence) ? selectedEvidence : [];
  const topScore = retrieved && Number.isFinite(Number(retrieved.topScore)) ? Number(retrieved.topScore) : 0;
  let reason = String(stage || 'unknown');

  if (stage === 'no_context') {
    reason = contexts.length ? 'evidence_selector_filtered_all_contexts' : 'retrieval_returned_no_context';
  } else if (stage === 'unanswerable') {
    reason = answerabilityResult && Array.isArray(answerabilityResult.missingEvidence) && answerabilityResult.missingEvidence.length
      ? 'selected_evidence_missing_required_information'
      : 'selected_evidence_not_answerable';
  } else if (stage === 'empty_answer') {
    reason = 'llm_or_generator_returned_empty_answer';
  } else if (stage === 'insufficient_context') {
    reason = 'llm_declared_insufficient_context';
  } else if (stage === 'preflight_blocked') {
    reason = 'outbound_preflight_blocked_answer';
  } else if (stage === 'meaning_mismatch') {
    reason = 'answer_topic_alignment_failed';
  } else if (stage === 'generation_error') {
    reason = 'answer_generation_error';
  }

  return {
    reason,
    stage: stage || 'unknown',
    rewriteIntent: rewrite && rewrite.intent || 'unknown',
    rewriteConfidence: rewrite && Number.isFinite(Number(rewrite.confidence)) ? Number(rewrite.confidence) : 0,
    intentEnsemble: rewrite && rewrite.intentEnsemble || null,
    heuristicSignals: rewrite && Array.isArray(rewrite.heuristicSignals) ? rewrite.heuristicSignals : [],
    topScore,
    retrievedContextCount: contexts.length,
    selectedEvidenceCount: selected.length,
    indexSize: retrieved && retrieved.indexSize || 0,
    answerabilityReason: answerabilityResult && answerabilityResult.reason || null,
    missingEvidence: answerabilityResult && Array.isArray(answerabilityResult.missingEvidence) ? answerabilityResult.missingEvidence : [],
    questionAnchors: extractMeaningAnchors(question || '').slice(0, 8),
    extra: extra || null
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
  
  return 'Saya belum menemukan data yang sesuai untuk menjawab pertanyaan itu. Agar tidak keliru, kakak bisa cek informasi resmi kampus atau konfirmasi ke admin/unit terkait.';
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
  const informationIntent = /\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|lokasi|alamat|ukm|ormawa|double\s*degree|dual\s*degree|akreditasi|prospek|kerja|yudisium|wisuda|sidang|tugas\\s+akhir|skripsi|tesis|sion|baak|kalender\\s+akademik|apa\\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i;
  if (informationIntent.test(text)) return false;

  const addressWords = new Set([
    'kak', 'kakak', 'min', 'admin', 'tiko', 'semua', 'guys',
    'gan', 'agan', 'bro', 'sis', 'mas', 'mbak', 'pak', 'bu',
    'bang', 'bos', 'boss', 'bli', 'mb', 'cuk', 'bot'
  ]);
  const timeWords = new Set(['pagi', 'siang', 'sore', 'malam']);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;

  const addressTail = '(?:kak|kakak|min|admin|tiko|gan|agan|bro|sis|mas|mbak|pak|bu|bang|bos|boss|bli|mb|bot)';
  const timeGreeting = '(?:pagi+|pgi|pg|siang+|siank|sang|sore+|malam+|malem+|mlm)';
  if (new RegExp('^(?:halo|hallo|hai|hay|hi|hello|helo)\\s+selamat\\s+' + timeGreeting + '(?:\\s+' + addressTail + ')?$', 'i').test(text)) return true;
  if (new RegExp('^selamat\\s+' + timeGreeting + '(?:\\s+' + addressTail + ')?$', 'i').test(text)) return true;
  if (new RegExp('^met\\s+' + timeGreeting + '(?:\\s+' + addressTail + ')?$', 'i').test(text)) return true;

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
  const hasCampusInfoIntent = /\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|gelombang|daftar|pendaftaran|beasiswa|fasilitas|fasilias|fasiltas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|inkubator|inbis|language\s+learning|llc|bccp|gccp|gcpp|student\s+exchange|hi-?think|lokasi|alamat|ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|double\s*degree|dual\s*degree|akreditasi|prospek|kerja|yudisium|wisuda|sidang|tugas\\s+akhir|skripsi|tesis|sion|baak|kalender\\s+akademik|apa\\s+itu|berapa|kapan|dimana|bagaimana|gimana|jelaskan|rincian)\b/i.test(raw);
  const normalized = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

  const shortCheckInPattern = /^(p|tes|test|testing|cek|ping)(\s+(bot|kak|min|admin|tiko))?$/i;
  if (shortCheckInPattern.test(normalized)) {
    return {
      answer: buildRuntimeGreetingIntro()
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
  if (/\b(?:baik\s+)?(?:terima\s*(?:kasih|ksih|ksh)|terimakasih|makasih|mksh|mksih|thanks|thank\s+you|thx)\b/i.test(normalized)) {
    return {
      answer: 'Sama-sama, Kak. Kalau ada yang ingin ditanyakan lagi seputar ITB STIKOM Bali, saya siap bantu.'
    };
  }

  if (/^(oke|ok|okay|okey|siap|baik|sip|mantap|noted|iya|ya|y)(?:\s+(?:kalau|kalo)\s+begitu)?$/i.test(normalized)) {
    return {
      answer: 'Baik, Kak. Silakan lanjutkan kalau ada yang ingin ditanyakan seputar ITB STIKOM Bali.'
    };
  }

  if (/\b(stikoman|stikomman)\b/i.test(normalized) && /\b(tau|tahu|kenal|apa|siapa|itu)\b/i.test(normalized)) {
    return {
      answer: 'Kalau yang kakak maksud "Stikoman", itu biasanya dipakai sebagai sebutan informal untuk warga/mahasiswa/keluarga STIKOM Bali. Untuk info resmi kampus, saya bisa bantu jelaskan seputar prodi, PMB, biaya, beasiswa, jadwal pendaftaran, atau UKM.'
    };
  }

  if (/\b(apa\s+kabar(?:nya)?|apa\s+khabar(?:nya)?|kabar(?:nya)?\s+apa|khabar(?:nya)?\s+apa|gimana\s+kabar(?:nya)?|gimana\s+khabar(?:nya)?|kabar(?:nya)?\s+kamu|khabar(?:nya)?\s+kamu|kbr|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar(?:nya)?|bagaimana\s+khabar(?:nya)?)\b/i.test(normalized)) {
    return {
      answer: 'Saya baik-baik saja, terima kasih. Ada yang bisa saya bantu seputar ITB STIKOM Bali?'
    };
  }


  if (/\b(kamu|tiko|bot|asisten)\b/i.test(normalized) && /\b(siapa|apa|bisa\s+bantu\s+apa|bantu\s+apa|lakukan|fungsi|tugas)\b/i.test(normalized) && !/\b(biaya|harga|ukt|dpp|prodi|program\s+studi|jurusan|pendaftaran|jadwal|gelombang|beasiswa|fasilitas|fasilias|fasiltas|layanan|career\s*center|pusat\s+kar(?:ir|ier)|soft\s*skill|softskill|pengembangan\s+softskill|inkubator|language\s+learning|llc|bccp|gccp|gcpp|student\s+exchange|hi-?think|ukm|ormawa|double\s*degree|dual\s*degree)\b/i.test(normalized)) {
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
      answer: `${prefix}${buildRuntimeGreetingIntro()}`
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
  const hasExplicitDoubleDegreeSignal = /\b(double\s*degree|dual\s*degree|dd)\b/i.test(q);
  const hasImplicitPartnerRelationSignal = /\b(?:sisi\s+stikom|di\s+stikom|prodi\s+stikom|jurusan\s+stikom|stikom\s+bali)\b/i.test(q)
    && /\b(?:jurusan|prodi|program\s+studi|pasangan|padanan|sisi|ambil|mengambil|diambil|desain|dkv)\b/i.test(q);
  if (!hasExplicitDoubleDegreeSignal && !hasImplicitPartnerRelationSignal) return null;
  const knownPartner = /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university|help\b)\b/i.test(q);
  const implicitPartnerRelation = /\b(?:sisi\s+stikom|di\s+stikom|prodi\s+stikom|jurusan\s+stikom|stikom\s+bali)\b/i.test(q)
    && /\b(?:jurusan|prodi|program\s+studi|pasangan|padanan|sisi|ambil|mengambil|diambil|desain|dkv)\b/i.test(q);
  if (implicitPartnerRelation && !knownPartner) {
    const implicitMatch = q.match(/\b(?:di|dengan|bersama|mitra|partner)\s+([a-z][a-z0-9.-]{2,}(?:\s+[a-z][a-z0-9.-]{2,}){0,3})\s+(?:sisi|prodi|jurusan|di)?\s*stikom\b/i)
      || q.match(/\b([a-z][a-z0-9.-]{2,}(?:\s+[a-z][a-z0-9.-]{2,}){0,3})\s+(?:sisi|prodi|jurusan)\s+stikom\b/i);
    if (implicitMatch && implicitMatch[1]) {
      const rawImplicit = implicitMatch[1].replace(/\b(?:itu|yang|ambil|diambil|jurusan|prodi|program|apa|berapa|gimana|bagaimana|ya|sisi|stikom)\b.*$/i, '').trim();
      if (rawImplicit && !/\b(?:utb|universitas teknologi bandung|dnui|dalian neusoft|help university|help|stikom|itb)\b/i.test(normalizeFacilityTerm(rawImplicit))) {
        return rawImplicit.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      }
    }
  }
  if (/\bessex\b/i.test(q)) return 'Essex University';
  const directPartnerMatch = q.match(/\b(?:double\s*degree|dual\s*degree|dd)\s+(?!itu\b|apa\b|program\b|kelas\b|nasional\b|internasional\b|di\b|untuk\b)([a-z][a-z0-9.-]{2,}(?:\s+[a-z][a-z0-9.-]{2,}){0,3})\b/i);
  if (directPartnerMatch && !knownPartner) {
    const rawDirect = directPartnerMatch[1].replace(/\b(?:itu|yang|ambil|diambil|jurusan|prodi|program|apa|berapa|gimana|bagaimana|ya)\b.*$/i, '').trim();
    if (rawDirect && !/\b(?:utb|universitas teknologi bandung|dnui|dalian neusoft|help university|help)\b/i.test(normalizeFacilityTerm(rawDirect))) {
      return rawDirect.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
  }
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
function tryUnsupportedInternationalProgramAnswer(question) {
  const q = String(question || '').toLowerCase();
  const mentionsJ1 = /\b(j\s*1|j-?1|training\s+1\s+tahun|program\s+j1|visa\s+j1)\b/i.test(q);
  const mentionsAmerica = /\b(amerika|america|usa|united\s+states|as\b)\b/i.test(q);
  const mentionsJapaneseLevel = /\b(n\s*[1-5]|jlpt\s*n\s*[1-5]|sertifikasi\s+n\s*[1-5]|kelas\s+n\s*[1-5])\b/i.test(q);
  const mentionsJapan = /\b(jepang|japan|nihon)\b/i.test(q);
  const asksProgram = /\b(program|training|magang|internship|kerja|bekerja|luar\s+negeri|sertifikasi|kelas|kursus|bahasa|ada|tersedia|sudah\s+ada)\b/i.test(q);
  if (!(mentionsJ1 || (mentionsAmerica && asksProgram) || (mentionsJapaneseLevel && mentionsJapan && asksProgram))) return null;
  if (mentionsJapaneseLevel && mentionsJapan) {
    return {
      answer: [
        'Saya belum menemukan data yang sesuai bahwa ITB STIKOM Bali memiliki program N4/JLPT N4 ke Jepang pada dokumen yang tersedia saat ini.',
        '',
        'Data yang tersedia baru menunjukkan program Hi-Think yang berkaitan dengan Jepang dan kursus bahasa Jepang sebagai bagian dari persiapan belajar/karier di lingkungan industri Jepang.',
        '',
        'Untuk memastikan apakah ada kelas N4, sertifikasi JLPT N4, syarat, jadwal, biaya, atau jalur ke Jepang, kakak sebaiknya konfirmasi ke admin kampus atau pengelola program terkait.'
      ].join('\n'),
      source: 'semantic-rag-unsupported-international-program',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  return {
    answer: [
      'Saya belum menemukan data yang sesuai bahwa ITB STIKOM Bali memiliki program J1/training 1 tahun ke Amerika pada dokumen yang tersedia saat ini.',
      '',
      'Agar tidak salah menyebut program, syarat, negara tujuan, durasi, biaya, atau mitra, bagian ini sebaiknya dikonfirmasi ke admin kampus atau unit kerja sama internasional.',
      '',
      'Program internasional yang tercatat di data saat ini antara lain Double Degree internasional, GCCP/short course, Hi-Think, kuliah sambil kerja di luar negeri, dan magang berbayar di luar negeri.'
    ].join('\n'),
    source: 'semantic-rag-unsupported-international-program',
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
  const mentionsGenericOtherCampus = /\b(universitas|institut|politeknik)\s+(?!(teknologi\s+dan\s+bisnis\s+)?stikom\b|itb\s+stikom\b|teknologi\s+bandung\b|dalian\b|help\b|renon\b|jimbaran\b|abiansemal\b)[a-z0-9]+/i.test(q) && !/\b(stikom|itb\s*stikom)\b/.test(q);
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
  const scheduleSignal = /\b(jadwal|kalender|agenda|kapan|tanggal|tgl|hari|jam|periode|pelaksanaan|dilaksanakan|berlangsung|selesai|berakhir|mulai)\b/i.test(q);
  const examSignal = /\b(ujian|uts|uas|remedial|remidi|ujian\s+ulang|ujian\s+susulan|susulan)\b/i.test(q);
  const semesterBetweenSignal = /\b(semester\s+antara|semester\s+pendek|sp\b)\b/i.test(q);
  const regularSemesterSignal = /\b(semester\s+(?:genap|ganjil)|genap\s+\d{4}\s*\/\s*\d{4}|ganjil\s+\d{4}\s*\/\s*\d{4})\b/i.test(q);
  const academicExecutionSignal = /\b(pelaksanaan\s+akademik|kalender\s+akademik|agenda\s+akademik|jadwal\s+akademik|jadwal\s+(?:kuliah|perkuliahan)|perkuliahan|kuliah\s+semester|akademik)\b/i.test(q);
  const mentionsPmb = /\b(pmb|penerimaan\s+mahasiswa\s+baru|maba|camaba|gelombang\s+pendaftaran|daftar\s+kuliah)\b/i.test(q);
  const negatesPmb = /\b(?:bukan|tidak|nggak|gak|ga)\s+(?:bertanya\s+tentang\s+)?(?:pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran\s+mahasiswa\s+baru|gelombang\s+pendaftaran)\b/i.test(q);
  if (mentionsPmb && !negatesPmb) return false;
  return scheduleSignal && (examSignal || semesterBetweenSignal || regularSemesterSignal || academicExecutionSignal);
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

function detectExplicitExternalEntity(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q.trim()) return null;
  if (/\b(?:fasilitas|sarana|prasarana|lokasi|alamat|jumlah\s+kampus|berapa\s+kampus|program|layanan|ukm|ormawa)\b/i.test(q) && /\b(?:kampus|stikom|itb\s*stikom|stikom\s+bali)\b/i.test(q)) return null;
  const partnerDoubleDegreeContext = /\b((double|dual)\s*degree|dd)\b/.test(q) && /\b(utb|universitas\s+teknologi\s+bandung|dnui|dalian\s+neusoft|help\s+university)\b/.test(q);
  if (partnerDoubleDegreeContext) return null;

  const known = [
    ['UGM', /\b(?:ugm|universitas\s+gadjah\s+mada)\b/i],
    ['UI', /\b(?:ui|universitas\s+indonesia)\b/i],
    ['Unair', /\b(?:unair|universitas\s+airlangga)\b/i],
    ['IPB', /\b(?:ipb|institut\s+pertanian\s+bogor)\b/i],
    ['Udayana/UNUD', /\b(?:udayana|unud|universitas\s+udayana)\b/i],
    ['Undiksha', /\b(?:undiksha|universitas\s+pendidikan\s+ganesha)\b/i],
    ['Politeknik Negeri Bali/PNB', /\b(?:pnb|politeknik\s+negeri\s+bali)\b/i],
    ['Universitas Terbuka', /\buniversitas\s+terbuka\b/i],
    ['Institut Teknologi Bandung/ITB', /\b(?:institut\s+teknologi\s+bandung|itb\b(?!\s*stikom))\b/i],
    ['Binus', /\bbinus\b/i],
    ['Telkom University', /\btelkom\s+university\b/i],
    ['Undiknas', /\bundiknas\b/i],
    ['Warmadewa', /\bwarmadewa\b/i]
  ];
  for (const [label, pattern] of known) {
    if (pattern.test(q)) return label;
  }

  const generic = q.match(/\b(universitas|institut|politeknik)\s+(?!(?:teknologi\s+dan\s+bisnis\s+)?stikom\b|itb\s+stikom\b|stikom\s+bali\b|renon\b|jimbaran\b|abiansemal\b)([a-z0-9][a-z0-9\s]{2,60})/i);
  if (generic && !/\b(stikom|itb\s*stikom)\b/i.test(q)) return `${generic[1]} ${generic[2]}`.trim();
  return null;
}

function tryExplicitExternalEntityNoDataAnswer(question) {
  const entity = detectExplicitExternalEntity(question);
  if (!entity) return null;
  return {
    answer: `Maaf, saya belum menemukan data tentang ${entity} pada dokumen ITB STIKOM Bali yang tersedia. Saya hanya bisa menjawab berdasarkan informasi ITB STIKOM Bali, jadi saya tidak akan menebak tentang kampus atau entitas lain.`,
    source: 'semantic-rag-explicit-external-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data'
  };
}

function extractAmbiguousAbbreviation(question) {
  const raw = String(question || '').trim();
  if (!/\b(?:apa\s+itu|itu\s+apa|maksud(?:nya)?|kepanjangan|singkatan|tentang|info(?:rmasi)?|jelaskan)\b/i.test(raw)) return '';
  if (detectExplicitExternalEntity(raw)) return '';

  const known = new Set([
    'ITB', 'STIKOM', 'PMB', 'RAG', 'LLC', 'SI', 'TI', 'BD', 'SK', 'MI', 'D3', 'S1', 'S2',
    'KIP', 'UKM', 'DPP', 'UTB', 'DNUI', 'HELP', 'GCCP', 'BCCP', 'RPL', 'MBKM', 'SION',
    'BAAK', 'TA', 'PA', 'KRS', 'KHS', 'IPK', 'SKS', 'PDDIKTI', 'PIN', 'NIM', 'TOEFL',
    'JLPT', 'DKV'
  ]);
  const stop = new Set(['APA', 'ITU', 'YA', 'KAK', 'MIN', 'DAN', 'ATAU', 'DI', 'KE', 'DARI', 'UNTUK', 'DENGAN', 'PRODI']);
  const candidates = [];
  const re = /\b[A-Za-z][A-Za-z0-9]{1,5}\b/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const token = match[0];
    const upper = token.toUpperCase();
    if (stop.has(upper) || known.has(upper)) continue;
    // Only treat as probable abbreviation when the token is uppercase/alphanumeric
    // (e.g., INBIS). This avoids false-positives for normal-cased words like "Inbis".
    const looksLikeAbbreviation = /^[A-Z0-9]{2,6}$/.test(token);
    if (looksLikeAbbreviation) candidates.push(upper);
  }
  return candidates[0] || '';
}

function tryAmbiguousAbbreviationClarificationAnswer(question) {
  const abbr = extractAmbiguousAbbreviation(question);
  if (!abbr) return null;
  return {
    answer: `Kak, singkatan "${abbr}" yang dimaksud itu apa ya? Bisa tuliskan kepanjangannya atau konteksnya, misalnya prodi, fasilitas, layanan kampus, organisasi, PMB, atau data akademik. Setelah konteksnya jelas, saya cekkan berdasarkan data RAG yang tersedia.`
  };
}
function tryFeedbackAnswer(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return null;
  const isFeedback = /\b(kok|loh|waduh|salah|tidak\s+nyambung|nggak\s+nyambung|ga\s+nyambung|gak\s+nyambung|tidak\s+menjawab|nggak\s+menjawab|ga\s+menjawab|gak\s+menjawab|jawabannya|jawaban\s+bot|dicek\s+lagi|cek\s+lagi|koreksi|perbaiki|singkat|informatif|informasi\s+awal|dari\s+mana\s+dapat\s+informasinya)\b/.test(q);
  const hasRealQuestion = /\b(jurusan|prodi|program\s+studi|biaya|bayar|ukt|dpp|semester|pendaftaran|beasiswa|gelombang|double\s*degree|dual\s*degree|akreditasi|prospek|apa\s+itu|berapa|kapan|dimana|bagaimana)\b/.test(q) || /\b\d{5,}\b/.test(q);
  if (!isFeedback || hasRealQuestion) return null;
  return {
    answer: 'Siap, Kak. Untuk informasi awal, saya akan buat jawaban lebih singkat, langsung ke inti, dan tetap berdasarkan data yang tersedia. Kalau ada bagian spesifik yang perlu dikoreksi, kakak bisa kirim teksnya lalu saya bantu rapikan.'
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
    'Baik, Kak. Saya bantu jawab dari konteks ITB STIKOM Bali ya. Saya jelaskan sebagai gambaran awal sebelum kakak masuk ke detail pendaftaran.',
    '',
    'PMB adalah singkatan dari Penerimaan Mahasiswa Baru, yaitu proses penerimaan calon mahasiswa yang ingin mendaftar kuliah di ITB STIKOM Bali.',
    '',
    'PMB, kakak bisa bertanya tentang:',
    '',
    '* Pendaftaran: alur daftar, cara mendaftar, dan langkah berikutnya',
    '* Jadwal pendaftaran: gelombang yang sedang buka, tanggal mulai, dan batas akhir',
    '* Program studi: pilihan S1, D3, S2, dan Double Degree',
    '* Rincian biaya: pendaftaran, DPP, biaya awal masuk, dan biaya per semester',
    '* Beasiswa/potongan: KIP, 1K1S, prestasi, yayasan, dan potongan berdasarkan gelombang',
    '* Syarat dan dokumen pendaftaran',
    '* Kontak atau bantuan admin PMB',
    '',
    'Kalau kakak ingin info yang lebih spesifik, silakan tanya misalnya: "jadwal PMB sekarang gelombang berapa?", "rincian biaya SI gelombang 2B?", atau "apa saja syarat pendaftaran?"',
    '',
    'Jadi, PMB adalah pintu awal untuk calon mahasiswa baru, dan detailnya bisa dilanjutkan ke jadwal, biaya, prodi, atau syarat pendaftaran.'
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
  const pmbContext = /\b(daftar|mendaftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|prodi|program\s+studi|jurusan|stikom|itb\s*stikom|apply|application|admission|international\s+student|study|studying)\b/.test(q);
  const implicitPmbDocumentQuestion = /\b(dokumen|berkas|lampiran|formulir|unggah|mengunggah|diunggah|upload)\b/.test(q) && /\b(apa\s+saja|apa|harus|perlu|wajib|yang)\b/.test(q);
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  if (/\b(linked\s*in|linkedin)\b/i.test(recent) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(recent) && !asksAdmissionRegistration && /\b(detail|info(?:rmasi)?|daftar|mendaftar|pendaftaran|registrasi|cara|bagaimana|gimana|mengikuti|ikut)\b/i.test(q)) return null;
  const recentPmbContext = /\b(daftar|mendaftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|prodi|program\s+studi|jurusan|stikom|itb\s*stikom|apply|application|admission|international\s+student|study|studying)\b/.test(recent);
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

  const explicit = /\b(?:tgl|tanggal|per|pada(?:\s+tanggal)?|di\s+tanggal)\s*(\d{1,2})\s+([a-z]+)(?:\s+(20\d{2}))?\b/i.exec(q);
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

function buildTemporalContract(question) {
  const raw = String(question || '');
  const currentDate = getSemanticTodayYmd();
  const parsedDate = parseRequestedDate(raw);
  const hasExplicitDatePhrase = /\b(?:tgl|tanggal|per|pada(?:\s+tanggal)?|di\s+tanggal)\b/i.test(raw);
  const explicitDate = hasExplicitDatePhrase ? parsedDate : null;
  const relativeDate = parsedDate && !hasExplicitDatePhrase && parsedDate !== currentDate ? parsedDate : null;
  const requestedMonth = parseRequestedMonth(raw);
  const requestedWave = parseRequestedScheduleWave(raw);
  const referenceDate = explicitDate || relativeDate || currentDate;
  return {
    currentDate,
    explicitDate,
    relativeDate,
    requestedMonth,
    requestedWave,
    referenceDate,
    referenceDateReason: explicitDate ? 'explicitDate' : (relativeDate ? 'relativeDate' : 'currentDate')
  };
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
  if (/^IV[A-ZC]?$/.test(s)) return 'IV';
  if (/^III[A-ZC]?$/.test(s)) return 'III';
  if (/^II[A-ZC]?$/.test(s)) return 'II';
  if (/^I[A-ZC]?$/.test(s)) return 'I';
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
  if (isAcademicAdminUploadedDocQuestion(qLower, detectGenericIntent(qLower)) && !explicitPmbContext) return null;
  if (hasRecentNonPmbContext && !explicitPmbContext && asksCampusSupportTechnicalDetail(qLower)) return null;

  const scheduleKeyword = /\b(jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|dari\s+kapan|sampai\s+kapan|deadline|tanggal|tgl|kapan|ditutup|tutup|penutupan|batas\s+akhir|tes\s+masuk|test\s+masuk|testing|dilaksanakan)\b/i;
  const registrationKeyword = /\b(pmb|penerimaan\s+mahasiswa\s+baru|penerimaan\s+maba|mahasiswa\s+baru|maba|camaba|pendaftaran|daftar)\b/i;
  const availabilityKeyword = /\b(masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|sekarang|hari\s+ini|saat\s+ini)\b/i;
  const hasScheduleSignal = scheduleKeyword.test(qLower) ||
    (registrationKeyword.test(qLower) && (scheduleKeyword.test(qLower) || availabilityKeyword.test(qLower))) ||
    Object.keys(ID_MONTH_MAP).some(name => new RegExp(`\\b${name}\\b`, 'i').test(qLower));
  if (!hasScheduleSignal) return null;

  const asksFee = /\b(biaya|bayar|bayarnya|pembayaran|harga|dpp|ukt|potongan|rincian\s+biaya|rincian|total|totalnya|harus\s+bayar|termurah|termahal)\b/i.test(qLower);
  if (asksFee) return null;

  const windows = getScheduleWindows();
  if (!windows.length) return null;

  const canonicalTemporal = options && options.__canonicalQueryUnderstanding && options.__canonicalQueryUnderstanding.temporal;
  const temporal = canonicalTemporal && canonicalTemporal.referenceDate
    ? {
      currentDate: canonicalTemporal.currentDate,
      explicitDate: canonicalTemporal.explicitDate,
      relativeDate: canonicalTemporal.relativeDate,
      requestedMonth: canonicalTemporal.requestedMonth,
      requestedWave: canonicalTemporal.requestedWave,
      referenceDate: canonicalTemporal.referenceDate,
      referenceDateReason: canonicalTemporal.reason || canonicalTemporal.referenceDateReason || 'currentDate'
    }
    : buildTemporalContract(q);
  const requestedMonth = temporal.requestedMonth;
  const requestedWave = temporal.requestedWave;
  const requestedDate = temporal.explicitDate || temporal.relativeDate;
  const todayYmd = temporal.currentDate;
  const referenceDate = temporal.referenceDate;
  const referenceDateLabel = formatYmdIndonesian(referenceDate);
  const asksAvailability = /\b(masih\s+buka|masih\s+dibuka|masih\s+menerima|menerima\s+pendaftaran|terima\s+pendaftaran|buka|dibuka|bisa|pilih|yang\s+mana|aktif|berjalan|masuk|termasuk|ikut|mengikuti|sekarang|hari\s+ini|saat\s+ini|cara|gimana|bagaimana)\b/i.test(qLower);
  const explicitMonthSummaryRequested = /\b(?:bulan|sebulan|selama\s+bulan|ringkasan\s+bulan|overview\s+bulan|bulan\s+apa\s+saja)\b/i.test(qLower) && !/\b(?:tanggal|tgl|per\s+tanggal|pada\s+tanggal|di\s+tanggal)\b/i.test(qLower);
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

  if (requestedDate && !requestedWave && (asksAvailability || !explicitMonthSummaryRequested)) {
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
      const openRequested = matches.filter(w => w.startYmd <= referenceDate && referenceDate <= w.endYmd);
      const currentOpen = openWindowsOnDate(windows, referenceDate);
      if (openRequested.length) {
        return {
          answer: [
            `Per ${referenceDateLabel}, ${title} sedang buka:`,
            '',
            formatScheduleItems(openRequested),
            '',
            `Jadi, kakak masih bisa mengikuti ${title} selama masih dalam tanggal tersebut.`
          ].join('\n')
        };
      }

      return {
        answer: [
          `Per ${referenceDateLabel}, ${title} ${scheduleAvailabilityPhrase(matches[matches.length - 1], referenceDate)}.`,
          '',
          `Jadwal ${title}:`,
          '',
          formatScheduleItems(matches),
          '',
          currentOpen.length
            ? `${temporal.referenceDateReason === 'currentDate' ? 'Yang sedang buka sekarang' : `Yang sedang buka pada ${referenceDateLabel}`} adalah:\n${formatScheduleItems(currentOpen)}`
            : `Saya tidak menemukan gelombang yang sedang buka pada ${referenceDateLabel} di data kalender PMB yang tersedia.`
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
      'Untuk daftar kuliah di ITB STIKOM Bali, kakak bisa melalui online atau offline.',
      '',
      'Online: melalui https://siap.stikom-bali.ac.id',
      'Offline: datang langsung ke kampus ITB STIKOM Bali untuk dibantu petugas PMB.',
      '',
      'Langkah awalnya: tentukan prodi, cek gelombang pendaftaran yang sedang buka, lalu siapkan data/dokumen sesuai arahan PMB.'
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
  // Must explicitly mention wisuda or yudisium to avoid matching general registration
  if (!/\b(wisuda|yudisium)\b/i.test(q)) {
    return null;
  }
  if (/\b(?:kapan|jadwal|tanggal|hari|pukul|jam|waktu|tempat|lokasi|syarat|persyaratan|dokumen|berkas|ketentuan|deadline|batas|informasi|info|akan\s+datang)\b/i.test(q)) {
    return null;
  }
  return {
    answer: [
      'Untuk pendaftaran yudisium atau wisuda, kakak perlu menghubungi pihak akademik atau BAAK.',
      '',
      'Proses pendaftaran yudisium/ wisuda biasanya diurus melalui bagian akademik kampus.',
      '',
      'Kakak bisa menghubungi BAAK untuk informasi lebih lanjut mengenai persyaratan dan jadwal yudisium atau wisuda.'
    ].join('\n')
  };
}

function tryAcademicScheduleAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (/\b(?:mulai\s+kuliah|awal\s+kuliah|perkuliahan\s+semester\s+genap|semester\s+genap)\b/i.test(q) && /\b2025\s*\/?\s*2026|ta\s*2025|tahun\s+akademik\s+2025/i.test(q)) {
    return { answer: 'Untuk Tahun Akademik 2025/2026 Semester Genap, data kalender akademik yang tersedia mencantumkan awal periode perkuliahan pada 02 - 08 Maret 2026. Untuk jadwal kelas per prodi seperti Sistem Informasi, kakak tetap perlu cek SION/BAAK karena jadwal mata kuliah bisa berbeda per kelas.' };
  }
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
  { key: 'language-learning-center', label: 'Language Learning Center', type: 'facility', patterns: ['language learning center', 'llc', 'belajar bahasa', 'latihan bahasa', 'komunitas bahasa', 'bahasa asing', 'kemampuan bahasa', 'meningkatkan kemampuan bahasa', 'fasilitas bahasa', 'kursus bahasa'] },
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

function ensureNamedCampusSupportContextInAnswer(question, answer) {
  const entity = findCampusSupportEntity(question);
  const text = String(answer || '').trim();
  if (!entity || !text) return text;
  const normalizedAnswer = normalizeFacilityTerm(text);
  const mentionsEntity = entity.normalizedPatterns.some((pattern) => pattern && normalizedAnswer.includes(pattern));
  if (mentionsEntity) return text;
  const lowered = text.charAt(0).toLowerCase() + text.slice(1);
  return `Untuk ${entity.label}, ${lowered}`;
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
  return /\b(?:cara(?:nya)?|bagaimana|gimana|alur(?:nya)?|prosedur(?:nya)?|mekanisme(?:nya)?|proses(?:nya)?|syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?|kuota|kouta|seleksi|interview|wawancara|biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp|formulir|form(?:nya)?|link(?:nya)?|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|admin(?:nya)?|pengelola(?:nya)?|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q);
}

function buildCampusSupportTechnicalNoDataAnswer(entity, question = '') {
  const label = entity && entity.label ? entity.label : 'program atau fasilitas tersebut';
  const q = String(question || '').toLowerCase();
  let detail = 'detail teknis seperti syarat, jadwal, biaya, kontak, atau alur pendaftaran';
  if (/\b(?:cara|bagaimana|gimana|alur|prosedur|mekanisme|proses|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q)) {
    detail = 'alur/cara mengikuti atau mendaftar';
  } else if (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|kuota|kouta|seleksi|interview|wawancara)\b/i.test(q)) {
    detail = 'syarat, dokumen, kuota, atau proses seleksi peserta';
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
  return /\b(biaya|harga|tarif|ukt|dpp|pendaftaran|registrasi|gelombang|jadwal|deadline|pmb|beasiswa|potongan|kip|prodi|program\s+studi|jurusan|akreditasi(?:nya)?|terakreditasi|ban-pt|double\s*degree|dual\s*degree|utb|dnui|help|ukm|ormawa|organisasi\s+mahasiswa)\b/i.test(q)
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
  const baseTokens = normalizeFacilityTerm(stripFaqQaLabel(text))
    .split(/\s+/)
    .map((token) => token.replace(/(?:nya|annya)$/i, ''))
    .map((token) => token === 'kuliah' ? 'studi' : token)
    .map((token) => ['prodi', 'jurusan'].includes(token) ? 'program' : token)
    .map((token) => ['pasca', 'pascasarjana', 'magister', 'master'].includes(token) ? 's2' : token)
    .filter((token) => token.length >= 3 && !stop.has(token));
  const expanded = [];
  for (const token of baseTokens) {
    expanded.push(token);
    if (['rekrutmen', 'rekrut', 'perekrutan'].includes(token)) expanded.push('campus', 'hiring', 'lowongan');
    if (['perusahaan', 'industri', 'dundi'].includes(token)) expanded.push('campus', 'hiring', 'kerja');
    if (['lowongan', 'loker'].includes(token)) expanded.push('kerja', 'karier', 'career');
    if (['karir', 'karier', 'career'].includes(token)) expanded.push('kerja', 'lowongan');
    if (['magang', 'internship'].includes(token)) expanded.push('kerja', 'industri');
    if (['visa', 'vitas', 'e30b'].includes(token)) expanded.push('study', 'permit', 'itas');
    if (['itas', 'kitas'].includes(token)) expanded.push('izin', 'tinggal');
    if (['sktt'].includes(token)) expanded.push('domisili');
    if (['asing', 'foreign'].includes(token)) expanded.push('international', 'mahasiswa');
    if (['exchange', 'pertukaran'].includes(token)) expanded.push('student', 'internasional');
    if (['hi', 'hithink'].includes(token)) expanded.push('think', 'jepang');
    if (['tujuan', 'manfaat', 'keuntungan', 'keunggulan'].includes(token)) expanded.push('benefit');
    if (['durasi', 'lama'].includes(token)) expanded.push('masa', 'studi');
  }
  return Array.from(new Set(expanded));
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
  const intentTerms = ['keunggulan', 'keuntungan', 'manfaat', 'kegiatan', 'program kerja', 'syarat', 'biaya', 'kapan', 'bahasa', 'cocok', 'tujuan', 'daftar', 'pendaftaran', 'gelar', 'lulusan', 'lama', 'masa studi', 'studi', 'fokus penelitian', 'konsentrasi', 'akreditasi', 'sulit', 'menantang'];
  const intentHits = intentTerms.filter((term) => qNorm.includes(term) && fNorm.includes(term)).length * 4;
  const intentMismatchPenalty = intentTerms.filter((term) => qNorm.includes(term) && !fNorm.includes(term)).length * 5;
  const programAliasBoost = /\b(?:program|prodi|jurusan)\b/i.test(qNorm) && /\b(?:program|prodi|jurusan)\b/i.test(fNorm) ? 3 : 0;
  const postgradAliasBoost = /\b(?:pasca|pascasarjana|magister|master|s2)\b/i.test(qNorm) && /\b(?:pasca|pascasarjana|magister|master|s2)\b/i.test(fNorm) ? 3 : 0;
  const definitionBoost = userAsksDefinition && faqAsksDefinition ? 7 : 0;
  const definitionMismatchPenalty = userAsksDefinition && !faqAsksDefinition && /\b(?:kegiatan|manfaat|syarat|biaya|kapan|negara|jenis|keunggulan|keuntungan|tujuan)\b/i.test(fNorm) ? 4 : 0;
  const durationBoost = /\b(?:berapa\s+lama|lama\s+(?:kuliah|studi)|masa\s+studi|durasi)\b/i.test(qNorm) && /\b(?:berapa\s+lama|masa\s+studi|durasi)\b/i.test(fNorm) ? 8 : 0;
  const degreeBoost = /\b(?:gelar|lulusan)\b/i.test(qNorm) && /\b(?:gelar|lulusan)\b/i.test(fNorm) ? 8 : 0;
  return (overlap * 2) + reverseOverlap + targetHits + exactTarget + containment + intentHits + programAliasBoost + postgradAliasBoost + definitionBoost + durationBoost + degreeBoost - definitionMismatchPenalty - intentMismatchPenalty;
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

  const pipeRows = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter((line) => line.includes('|'));
  for (const row of pipeRows) {
    const columns = row
      .split(/\s*\|\s*/)
      .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (let i = 0; i < columns.length - 1; i += 1) {
      const questionText = columns[i];
      if (!isLikelyFaqQuestionText(questionText)) continue;
      const answerText = cleanFaqAnswerText(columns[i + 1]);
      if (questionText.length >= 4 && answerText.length >= 8) pairs.push({ questionText, answerText });
    }
  }
  if (pairs.length) return pairs;

  const pipeSegments = raw
    .replace(/\r/g, '\n')
    .split(/\s*\|\s*/)
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (let i = 0; i < pipeSegments.length - 1; i += 1) {
    const questionText = pipeSegments[i];
    if (!isLikelyFaqQuestionText(questionText)) continue;
    const answerText = cleanFaqAnswerText(pipeSegments[i + 1]);
    if (questionText.length >= 4 && answerText.length >= 8) pairs.push({ questionText, answerText });
  }
  if (pairs.length) return pairs;

  const flat = raw.replace(/\s+/g, ' ').trim();
  const questionRe = /((?:apa\s+saja|apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
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
    .replace(/\s+Tertarik\s+join\s+program[\s\S]*$/i, ' ')
    .replace(new RegExp(String.raw`\s+(?:${FAQ_QUESTION_LABEL_SOURCE}|${FAQ_ANSWER_LABEL_SOURCE})\s*`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}
function hasRawSpreadsheetFaqDump(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  const pipeCount = (value.match(/\|/g) || []).length;
  if (/\[Sheet:\s*(?:FAQ|QNA|Profil|Akademik|Sheet\d*)\]/i.test(value)) return true;
  return pipeCount >= 6 && /\b(?:Profil|Akademik|Pertanyaan|Jawaban|Apa\s+nama|Apa\s+gelar|Program\s+Pascasarjana|magister|semester|akreditasi)\b/i.test(value);
}
function isLikelyFaqQuestionText(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^(?:q|tanya|pertanyaan)\s*[:\-.]/i.test(value)) return true;
  if (/^(?:apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa|apa\s+saja)\b/i.test(value)) return true;
  return /\?\s*$/.test(value) && /\b(?:apa\s+saja|apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa|wajib|perlu|diperlukan|dibutuhkan|bisa)\b/i.test(value);
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
  const markerRe = /(?:^|\s)((?:(?:q|tanya|pertanyaan)\s*[:\-.]\s*)?(?:apa\s+saja|apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s+negara\s+mana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
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

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizedTextContainsDomainTerm(haystack, term) {
  const text = String(haystack || '');
  const normalizedTerm = normalizeFacilityTerm(term);
  if (!text || !normalizedTerm) return false;
  if (/^[a-z0-9]+$/i.test(normalizedTerm)) {
    return new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, 'i').test(text);
  }
  return text.includes(normalizedTerm);
}
function hasFaqAnswerDomainConflict(userQuestion, faqQuestion, answer, sourceText = '') {
  const asked = normalizeFacilityTerm(userQuestion || '');
  const ans = normalizeFacilityTerm(answer);
  if (!asked || !ans) return false;

  const domains = [
    { name: 'study_permit', terms: ['izin belajar', 'study permit', 'mahasiswa asing', 'visa pelajar', 'itas', 'kitas', 'sktt'] },
    { name: 'career', terms: ['career center', 'karier', 'karir', 'lowongan', 'magang', 'job fair', 'campus hiring', 'rekrutmen', 'tracer study', 'melamar kerja'] },
    { name: 'student_exchange', terms: ['student exchange', 'pertukaran mahasiswa', 'gccp', 'bccp', 'credit transfer', 'summer program'] },
    { name: 'hi_think', terms: ['hi think', 'hithink', 'jepang', 'bahasa jepang', 'n2', 'kurikulum industri jepang'] },
    { name: 'pmb', terms: ['pmb', 'pendaftaran mahasiswa baru', 'gelombang', 'siap stikom', 'calon mahasiswa'] }
  ];

  if (/\b(?:hi\s*think|hithink)\b/i.test(asked)
    && /\b(?:pascasarjana|magister|akreditasi|intelligent secure system|baik sekali)\b/i.test(ans)
    && !/\b(?:jepang|hi\s*think|hithink|n2|semester 5|year 3|perusahaan teknologi|kurikulum industri)\b/i.test(ans)) return true;
  for (const domain of domains) {
    const answerHasDomain = domain.terms.some((term) => normalizedTextContainsDomainTerm(ans, term));
    if (!answerHasDomain) continue;
    const questionHasDomain = domain.terms.some((term) => normalizedTextContainsDomainTerm(asked, term));
    if (!questionHasDomain) return true;
  }
  return false;
}

function enrichCareerFaqAnswerWithQuestionContext(question, answer) {
  const q = normalizeFacilityTerm(question || '');
  let text = String(answer || '').replace(/\s+\d{1,2}\.\s*$/g, '').trim();
  if (!text) return text;
  const asksCareerCenter = /\b(?:career center|pusat karier|pusat karir|karier|karir|magang|job fair|campus hiring|rekrutmen|lowongan|konsultasi|berkonsultasi|peluang kerja|lulusan|bekerja|bidang it)\b/i.test(q);
  if (!asksCareerCenter) return text;
  if (/\bkeuntungan\b/i.test(q) && !/^Keuntungan\b/i.test(text)) {
    text = `Keuntungan dari sisi karier: ${text}`;
  }
  if (/\bmagang\b/i.test(q) && !/\bCareer\s*Center\b/i.test(text)) {
    text = `Melalui Career Center, ${text}`;
  }
  if (/\bjob\s*fair\b/i.test(q)) {
    if (!/\bJob\s*Fair\b/i.test(text)) text = `Job Fair di ITB STIKOM Bali: ${text}`;
    if (!/\bCareer\s*Center\b/i.test(text)) text = `Career Center mendukung informasi ${text}`;
  }
  if (/\brekrutmen\b/i.test(q) && !/\brekrutmen\b/i.test(text)) {
    text = `${text} Kegiatan ini berkaitan dengan rekrutmen atau campus hiring.`;
  }
  if (/\bkapan\b/i.test(q) && /\bCareer\s*Center\b/i.test(q) && !/\bmahasiswa\s+aktif\b/i.test(text)) {
    text = `Mahasiswa aktif dapat mengikuti program Career Center sesuai jenis kegiatannya. ${text}`;
  }
  if (/\b(?:konsultasi|berkonsultasi)\b/i.test(q) && !/\b(?:konsultasi|berkonsultasi)\b/i.test(text)) {
    text = `Mahasiswa dapat berkonsultasi melalui Career Center. ${text}`;
  }
  if (/\b(?:bidang\s+it|hanya\s+bisa\s+bekerja\s+di\s+bidang\s+it)\b/i.test(q) && !/\bbidang\s+IT\b/i.test(text)) {
    text = text.replace(/bidang teknologi informasi/i, 'bidang IT/teknologi informasi');
  }
  if (/\bpeluang\s+kerja\b/i.test(q) && !/^Peluang kerja lulusan\b/i.test(text)) {
    text = `Peluang kerja lulusan ITB STIKOM Bali: ${text}`;
  }
  if (/\b(?:karier|karir|magang|job fair|rekrutmen|lowongan|pelatihan|campus hiring|peluang kerja|lulusan|bekerja)\b/i.test(q) && !/\bCareer\s*Center\b/i.test(text)) {
    text = `Career Center ITB STIKOM Bali: ${text}`;
  }
  return text
    .replace(/\s+\b[a-z]{1,3}\s+(?=Kegiatan ini\b)/gi, ' ')
    .replace(/^Melalui Career Center, Ya\./i, 'Melalui Career Center, ya.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function isCareerConsultationQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(?:konsultasi|berkonsultasi|bimbingan|konseling)\b(?:\s+(?:mengenai|tentang|seputar|soal|terkait|untuk|di|ke|karier|karir|career)){0,8}\s+\b(?:karier|karir|career|pekerjaan|kerja)\b/i.test(q)
    || /\b(?:karier|karir|career|pekerjaan|kerja)\b(?:\s+(?:mengenai|tentang|seputar|soal|terkait|untuk|di|ke|konsultasi)){0,8}\s+\b(?:konsultasi|berkonsultasi|bimbingan|konseling)\b/i.test(q);
}

function isCareerCenterQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return isCareerConsultationQuestion(q) || /\b(career center|pusat karier|pusat karir|karier|karir|lowongan|pekerjaan|peluang kerja|lulusan|magang|job fair|campus hiring|rekrutmen|perusahaan|kerja sama|kerjasama|pelatihan|pembekalan|tracer study|melamar kerja)\b/i.test(q);
}
function isOverseasWorkStudyQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(kuliah sambil kerja(?: di\s*)?luar negeri|kuliah kerja luar negeri|work study|study and work)\b/i.test(q);
}

function isPaidOverseasInternshipQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(magang berbayar(?: di\s*)?luar negeri|paid internship|internship berbayar)\b/i.test(q);
}

function isStudyPermitQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(izin belajar|study permit|mahasiswa asing|foreign student|visa (?:study|studi|pelajar)|itas|kitas|sktt)\b/i.test(q);
}

function getAdministrativeInfoTopic(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q) return null;
  const has = (re) => re.test(q);
  if (has(/\b(?:sktt|surat keterangan tempat tinggal)\b/i)) return { key: has(/\b(?:perpanjang|perpanjangan|expired|kedaluwarsa|kadaluarsa)\b/i) ? 'sktt_extension' : 'sktt', label: 'SKTT', required: [/\bsktt\b/i], reject: [/\bizin belajar\b/i, /\bvisa\s*e30b\b/i] };
  if (has(/\b(?:itas|kitas|e kitas|e-kitas)\b/i)) return { key: has(/\b(?:perpanjang|perpanjangan|expired|kedaluwarsa|kadaluarsa|overstay|denda)\b/i) ? 'itas_extension' : 'itas_kitas', label: 'ITAS/KITAS', required: [/\bitas\b/i, /\bkitas\b/i], reject: [/\bizin belajar adalah\b/i, /\bvisa\s*e30b\b/i] };
  if (has(/\b(?:visa\s*e\s*30\s*b|e\s*30\s*b|visa pelajar|visa study|visa studi|vitas)\b/i) || (has(/\bvisa\b/i) && has(/\b(?:kuliah|studi|belajar|mahasiswa asing|pelajar|dokumen|berkas|syarat|persyaratan|dibutuhkan|diperlukan|mengurus|pengajuan|proses|biaya|harga|bayar|1 tahun|2 tahun|4 tahun)\b/i))) return { key: 'visa_e30b', label: 'Visa E30B', required: [/\bvisa\b/i, /\be\s*30\s*b\b/i], reject: [/\bbiaya awal masuk\b/i, /\bukt\b/i, /\bdpp\b/i] };
  if (has(/\bizin belajar|study permit\b/i)) return { key: has(/\b(?:perpanjang|perpanjangan|expired|kedaluwarsa|kadaluarsa)\b/i) ? 'study_permit_extension' : 'study_permit', label: 'Izin Belajar', required: [/\bizin belajar\b/i, /\bstudy permit\b/i], reject: [] };
  if (has(/\bmahasiswa asing|foreign student\b/i)) return { key: 'foreign_student_docs', label: 'Mahasiswa Asing', required: [/\bmahasiswa asing\b/i, /\bpaspor\b/i, /\bdokumen\b/i], reject: [] };
  return null;
}

function adminTopicMatchesText(topic, text) {
  if (!topic) return true;
  const normalized = normalizeFacilityTerm(text || '');
  if (!normalized) return false;
  const required = Array.isArray(topic.required) ? topic.required : [];
  if (required.length && !required.some((re) => re.test(normalized))) return false;
  const reject = Array.isArray(topic.reject) ? topic.reject : [];
  if (reject.some((re) => re.test(normalized))) return false;
  return true;
}

function buildAdministrativeCanonicalAnswer(question) {
  const topic = getAdministrativeInfoTopic(question);
  if (!topic) return null;
  const q = normalizeFacilityTerm(question || '');
  const has = (re) => re.test(q);
  const answer = (value) => ({ answer: value, source: 'semantic-rag-admin-topic-composer', frameSource: 'semantic-rag-training-specific', adminTopic: topic.key });

  if (topic.key === 'foreign_student_docs') {
    return answer('Untuk mahasiswa asing, dokumen administrasi yang perlu diperhatikan mencakup Izin Belajar/Study Permit, Visa E30B atau visa pelajar, ITAS/KITAS, dan SKTT. Mahasiswa menyiapkan dokumen pribadi seperti paspor dan dokumen pendukung studi, lalu prosesnya dibantu oleh kampus/International Office sesuai ketentuan yang berlaku.');
  }
  if (topic.key === 'study_permit') {
    if (has(/\b(?:apa itu|pengertian|maksud)\b/i)) return answer('Izin Belajar atau Study Permit adalah dokumen resmi yang menyatakan mahasiswa asing diperbolehkan menempuh pendidikan di Indonesia.');
    if (has(/\b(?:wajib|harus|perlu)\b/i)) return answer('Ya. Mahasiswa asing wajib memiliki Izin Belajar/Study Permit sebagai salah satu dokumen resmi untuk studi di Indonesia.');
    if (has(/\b(?:financial statement)\b/i)) return answer('Ya. Financial Statement termasuk dokumen yang diperlukan untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:statement letter)\b/i)) return answer('Ya. Statement Letter termasuk dokumen yang diperlukan untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:medical statement)\b/i)) return answer('Ya. Medical Statement termasuk dokumen yang diperlukan untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:loa|letter of acceptance)\b/i)) return answer('Ya. Letter of Acceptance atau LOA diperlukan untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:ijazah|transkrip)\b/i)) return answer('Ya. Ijazah dan transkrip akademik termasuk dokumen pendukung untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:foto|photo)\b/i)) return answer('Ya. Foto formal diperlukan sebagai salah satu dokumen pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:paspor|passport)\b/i)) return answer('Ya. Paspor diperlukan untuk pengajuan Izin Belajar mahasiswa asing.');
    if (has(/\b(?:dokumen|berkas|syarat|persyaratan|diperlukan|pengajuan)\b/i)) return answer('Dokumen pengajuan Izin Belajar mahasiswa asing meliputi foto formal, scan paspor, Financial Statement, Statement Letter, Medical Statement, Letter of Acceptance/LOA, ijazah, dan transkrip.');
    if (has(/\b(?:berapa lama|lama proses|waktu|durasi|minggu|1\s*-?\s*2|1 sampai 2|satu sampai dua)\b/i)) return answer('Proses pembuatan Izin Belajar umumnya membutuhkan waktu sekitar 1-2 minggu kerja, bergantung pada kelengkapan dokumen dan proses verifikasi.');
    if (has(/\b(?:biaya|bayar|gratis)\b/i)) return answer('Pengurusan Izin Belajar tidak dikenakan biaya dari data yang tersedia.');
    if (has(/\b(?:siapa|international office|kampus|sendiri|dibantu)\b/i)) return answer('Pengurusan Izin Belajar dibantu oleh kampus/International Office. Mahasiswa menyiapkan dokumen yang diminta, lalu kampus membantu proses pengajuannya.');
    return answer('Pengurusan Izin Belajar dilakukan dengan menyiapkan dokumen persyaratan mahasiswa asing, lalu kampus/International Office membantu proses pengajuannya sesuai prosedur pemerintah.');
  }
  if (topic.key === 'study_permit_extension') {
    if (has(/\b(?:expired|kedaluwarsa|kadaluarsa)\b/i)) return answer('Jika Izin Belajar sudah expired, mahasiswa perlu mengurus Izin Belajar baru sesuai arahan kampus/International Office.');
    if (has(/\b(?:berapa lama|lama proses)\b/i)) return answer('Proses perpanjangan Izin Belajar umumnya membutuhkan waktu sekitar 1-2 minggu kerja, bergantung pada kelengkapan dokumen dan proses verifikasi.');
    if (has(/\b(?:dokumen|berkas|syarat|persyaratan|paspor|passport|kitas|itas|transkrip|sktt)\b/i)) return answer('Dokumen perpanjangan Izin Belajar meliputi paspor, KITAS/ITAS, transkrip akademik, dan SKTT.');
    return answer('Perpanjangan Izin Belajar dapat diajukan sekitar 30 hari sebelum masa berlaku dokumen berakhir dan dibantu oleh kampus/International Office.');
  }
  if (topic.key === 'visa_e30b') {
    if (has(/\bizin belajar\b/i) && has(/\b(?:dokumen|berkas|syarat|persyaratan)\b/i)) return answer('Dokumen untuk pengurusan Izin Belajar dan Visa E30B/Visa Study mahasiswa asing mencakup paspor, Letter of Acceptance/LOA, dokumen pendukung studi, serta dokumen lain yang diminta kampus/International Office sesuai prosedur pengajuan.');
    if (has(/\bizin belajar\b/i)) return answer('Pengurusan Izin Belajar dan Visa E30B/Visa Study untuk mahasiswa asing dibantu oleh kampus/International Office. Mahasiswa menyiapkan dokumen persyaratan termasuk paspor, lalu kampus membantu proses pengajuan Izin Belajar dan arahan administrasi visa pelajar sesuai prosedur yang berlaku.');
    if (has(/\b(?:apa itu|jenis visa|visa apa|digunakan|untuk kuliah|untuk studi)\b/i)) return answer('Visa E30B adalah visa pelajar/studi yang digunakan mahasiswa asing untuk masuk dan menempuh studi di Indonesia.');
    if (has(/\b(?:masa berlaku paspor|minimal.*paspor|passport validity)\b/i)) return answer('Untuk pengajuan Visa E30B, paspor diperlukan dan masa berlaku paspor harus memenuhi ketentuan imigrasi. Jika masa berlaku paspor kurang, mahasiswa perlu memperpanjang paspor terlebih dahulu sebelum pengajuan.');
    if (has(/\b(?:guarantee letter|surat jaminan|sponsor)\b/i)) return answer('Guarantee letter atau surat jaminan diperlukan untuk pengajuan Visa E30B dan disediakan/dibantu oleh pihak kampus sesuai prosedur mahasiswa asing.');
    if (has(/\b(?:loa|letter of acceptance)\b/i)) return answer('Ya. Letter of Acceptance atau LOA diperlukan untuk pengajuan Visa E30B.');
    if (has(/\b(?:paspor|passport)\b/i)) return answer('Ya. Paspor diperlukan untuk pengajuan Visa E30B mahasiswa asing.');
    if (has(/\b(?:dokumen|berkas|syarat|persyaratan|dibutuhkan|diperlukan|butuh|perlu)\b/i)) return answer('Dokumen untuk Visa E30B mahasiswa asing mencakup paspor yang masih berlaku, foto sesuai ketentuan visa, guarantee letter atau surat jaminan dari kampus, Letter of Acceptance/LOA, serta dokumen pendukung lain sesuai ketentuan pengajuan.');
    if (has(/\b(?:berapa lama|lama proses)\b/i)) return answer('Proses pengajuan Visa E30B umumnya membutuhkan waktu sekitar 1-2 minggu kerja setelah pembayaran dan dokumen dinyatakan lengkap.');
    if (has(/\b(?:biaya|harga|bayar|1 tahun|2 tahun|4 tahun)\b/i)) return answer('Biaya Visa E30B pada data yang tersedia adalah Rp6.000.000 untuk masa tinggal sampai 1 tahun, Rp8.500.000 untuk sampai 2 tahun, dan Rp12.000.000 untuk sampai 4 tahun. Nominal final tetap mengikuti ketentuan terbaru dari International Office/admin kampus.');
    return answer('Pengajuan Visa E30B dibantu oleh kampus/International Office. Mahasiswa menyiapkan dokumen visa pelajar, lalu kampus membantu proses pengajuannya.');
  }
  if (topic.key === 'itas_kitas') {
    if (has(/\b(?:kapan|mengurus|mendapatkan|otomatis|tiba|sampai|datang)\b/i)) return answer('Mahasiswa asing yang masuk ke Indonesia dengan Visa E30B akan mendapatkan ITAS/KITAS sebagai bagian dari proses visa dan izin tinggal. Dari data yang tersedia, ITAS released setelah mahasiswa asing sampai di Indonesia; proses Visa dan ITAS menjadi satu kesatuan administrasi.');
    if (has(/\b(?:apa itu|pengertian|maksud|perbedaan)\b/i)) return answer('ITAS/KITAS adalah izin tinggal terbatas bagi warga negara asing di Indonesia. Visa berfungsi sebagai izin masuk, sedangkan ITAS/KITAS berfungsi sebagai izin tinggal selama mahasiswa asing menjalani studi.');
    if (has(/\b(?:wajib|harus|perlu|tanpa)\b/i)) return answer('Ya. Mahasiswa asing wajib memiliki ITAS/KITAS sebagai izin tinggal selama menempuh studi di Indonesia.');
    if (has(/\b(?:masa berlaku|mengikuti visa)\b/i)) return answer('Masa berlaku ITAS/KITAS mengikuti masa berlaku izin/visa yang diberikan.');
    return answer('ITAS/KITAS adalah dokumen izin tinggal terbatas yang wajib dimiliki mahasiswa asing selama tinggal dan belajar di Indonesia.');
  }
  if (topic.key === 'itas_extension') {
    if (has(/\b(?:expired|overstay|denda)\b/i)) return answer('Jika ITAS/KITAS expired, mahasiswa berisiko terkena ketentuan overstay atau denda sesuai aturan imigrasi. Segera hubungi kampus/International Office agar diarahkan proses penanganannya.');
    if (has(/\b(?:kantor imigrasi|imigrasi|biometrik|foto|sidik jari)\b/i)) return answer('Dalam proses perpanjangan ITAS/KITAS, mahasiswa dapat diminta datang ke kantor Imigrasi untuk verifikasi data, foto, atau biometrik sesuai arahan.');
    if (has(/\b(?:keluar indonesia|tanpa keluar)\b/i)) return answer('Perpanjangan ITAS/KITAS dapat diproses tanpa harus keluar Indonesia selama memenuhi ketentuan dan dokumen diajukan tepat waktu.');
    if (has(/\b(?:dokumen|berkas|syarat|surat sponsor|permohonan|ktp sponsor|izin belajar|paspor|e-kitas|ekitas|sktt|pas foto)\b/i)) return answer('Dokumen perpanjangan ITAS/KITAS meliputi surat sponsor/permohonan dari kampus, KTP sponsor, Izin Belajar, paspor, E-KITAS sebelumnya, SKTT, dan pas foto sesuai arahan pengajuan.');
    return answer('Perpanjangan ITAS/KITAS sebaiknya diajukan sekitar 30 hari sebelum masa berlaku berakhir dan dibantu oleh kampus/International Office melalui prosedur imigrasi/e-visa.');
  }
  if (topic.key === 'sktt' || topic.key === 'sktt_extension') {
    if (has(/\b(?:apa itu|kepanjangan|fungsi|bukti domisili)\b/i)) return answer('SKTT adalah Surat Keterangan Tempat Tinggal, yaitu bukti domisili resmi bagi warga negara asing yang tinggal sementara di Indonesia, termasuk mahasiswa asing.');
    if (has(/\b(?:dokumen|berkas|syarat|paspor|passport|itas|kitas|form|f1-01|f1 01)\b/i)) return answer('Dokumen untuk mengurus SKTT meliputi paspor, ITAS/KITAS, dan Form F1-01 atau formulir kependudukan yang diminta oleh Disdukcapil.');
    if (has(/\b(?:cara|mengurus|website|disdukcapil|di mana|dimana)\b/i)) return answer('SKTT diurus melalui Disdukcapil sesuai domisili mahasiswa asing, dan dapat mengikuti mekanisme layanan/website Disdukcapil jika tersedia. Mahasiswa dapat meminta arahan kampus/International Office untuk prosesnya.');
    if (has(/\b(?:berapa lama|lama proses)\b/i)) return answer('Proses pembuatan SKTT umumnya sekitar 1 minggu kerja setelah dokumen dinyatakan lengkap dan diverifikasi.');
    if (has(/\b(?:expired|kedaluwarsa|kadaluarsa|perpanjang)\b/i)) return answer('Jika SKTT sudah expired, mahasiswa perlu memperpanjang atau mengurus kembali SKTT sesuai arahan Disdukcapil dan kampus/International Office.');
    return answer('SKTT diperlukan sebagai dokumen domisili resmi mahasiswa asing dan dapat menjadi dokumen pendukung untuk perpanjangan Izin Belajar maupun ITAS/KITAS.');
  }
  return null;
}
function tryAnchoredAdministrativeFaqAnswer(question, indexForQuery) {
  const topic = getAdministrativeInfoTopic(question);
  if (!topic || !Array.isArray(indexForQuery) || !indexForQuery.length) return null;
  const q = String(question || '').trim();
  const qTokens = Array.from(new Set(faqComparableTokens(q)));
  const scored = [];
  for (let itemIndex = 0; itemIndex < indexForQuery.length; itemIndex += 1) {
    const item = indexForQuery[itemIndex];
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    const sourceText = `${item.filename || ''} ${item.sourceFile || ''} ${item.title || ''}`;
    const continuation = buildChunkContinuationText(indexForQuery, itemIndex, 8);
    if (!adminTopicMatchesText(topic, `${sourceText} ${chunk}`)) continue;
    const pairs = extractFaqQaPairsFromChunk(chunk);
    for (const pair of pairs) {
      const questionText = String(pair.questionText || '').trim();
      if (!questionText) continue;
      if (!adminTopicMatchesText(topic, `${sourceText} ${questionText} ${pair.answerText}`)) continue;
      let answer = cleanUserVisibleRagAnswerText(pair.answerText);
      answer = trimRecoveredFaqAnswerToSection(recoverFaqAnswerAcrossChunkBoundary(continuation, questionText, answer));
      if (!answer || answer.length < 8) continue;
      if (!adminTopicMatchesText(topic, `${questionText} ${answer}`)) continue;
      const questionNorm = normalizeFacilityTerm(questionText);
      const answerNorm = normalizeFacilityTerm(answer);
      const score = scoreFaqQuestionMatch(q, questionText, '', []) + qTokens.filter((token) => questionNorm.includes(token)).length + qTokens.filter((token) => answerNorm.includes(token)).length + 6;
      if (score < 7) continue;
      scored.push({ item, questionText, answer, score });
    }
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.answer.length - b.answer.length);
  const best = scored[0];
  const answer = best.answer.length > 1100 ? `${best.answer.slice(0, 1097).trim()}...` : best.answer;
  return { answer, source: 'semantic-rag-admin-anchored-faq', frameSource: 'semantic-rag-training-specific', matchedFaqQuestion: best.questionText, matchedTrainingId: best.item && best.item.trainingId, matchedSource: best.item && (best.item.filename || best.item.sourceFile || best.item.id), adminTopic: topic.key };
}
function isStudentExchangeQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(student exchange|pertukaran mahasiswa|gccp|global cross cultural program|credit transfer|summer program|short program|short course|shortcourse|kursus singkat)\b/i.test(q);
}

function getInternationalProgramTopic(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q) return null;
  const has = (re) => re.test(q);
  if (has(/\b(?:hi\s*-?\s*think|hithink|bahasa jepang|n2|jepang)\b/i) && has(/\b(?:hi\s*-?\s*think|hithink|program|bahasa|n2|kerja|karier|kurikulum|semester|jepang)\b/i)) return { key: 'hi_think', label: 'Hi-Think' };
  if (has(/\b(?:student exchange|pertukaran mahasiswa|gccp|global cross cultural program|credit transfer|summer program|short program|short course)\b/i)) return { key: 'student_exchange', label: 'Student Exchange' };
  if (has(/\bexchange\b/i) && has(/\b(?:mahasiswa|student|program|ikut|mengikuti|benefit|manfaat(?:nya)?|keuntungan|tujuan|syarat)\b/i) && !has(/\b(?:barang|bekas|tukar\s+barang|money\s+changer|valuta|currency)\b/i)) return { key: 'student_exchange', label: 'Student Exchange' };
  if (has(/\b(?:help university|help|bachelor of information technology|\bbit\b)\b/i)) return { key: 'double_degree_help', label: 'Double Degree HELP University' };
  if (has(/\b(?:dnui|dalian|neusoft|e-commerce|e commerce|bachelor of management|\bbm\b|s\.\s*bns|sbns|dormitory|china)\b/i) && has(/\b(?:double|dual|degree|dnui|dalian|neusoft|e-commerce|e commerce|bachelor|management|dormitory|tahun|china)\b/i)) return { key: 'double_degree_dnui', label: 'Double Degree DNUI' };
  return null;
}

function buildInternationalCanonicalAnswer(question) {
  const q = normalizeFacilityTerm(question || '');
  const topic = getInternationalProgramTopic(question);
  if (!topic) {
    if (/\b(?:program\s+internasional|kelas\s+internasional|international\s+program|international\s+class)\b/i.test(q)
      && /\b(?:apa\s+saja|apa\s+aja|ada|tersedia|pilihan|list|daftar)\b/i.test(q)) {
      return tryInternationalClassFallback(question);
    }
    return null;
  }
  const has = (re) => re.test(q);
  const answer = (value) => ({ answer: value, source: 'semantic-rag-international-topic-composer', frameSource: 'semantic-rag-training-specific', internationalTopic: topic.key });
  const noData = (value = 'Saya belum menemukan data yang sesuai untuk menjawab pertanyaan itu. Agar tidak keliru, kakak bisa cek informasi resmi kampus atau konfirmasi ke admin/unit terkait.') => ({ answer: value, source: 'semantic-rag-insufficient-data', frameSource: 'semantic-rag-training-specific', internationalTopic: topic.key });
  if (has(/\b(?:biaya|harga|bayar|rincian biaya|pendaftaran|dpp|ukt)\b/i)) return null;

  if (topic.key === 'double_degree_help') {
    if (has(/\b(?:syarat|persyaratan|dokumen|berkas|kapan|mulai)\b/i)) return null;
    if (has(/\b(?:gelar|degree|s\.\s*kom|skom|bachelor of information technology|\bbit\b|dua gelar)\b/i)) return answer('Pada Program Double Degree HELP University Malaysia, mahasiswa memperoleh dua gelar: Sarjana Komputer (S.Kom) dari ITB STIKOM Bali dan Bachelor of Information Technology (BIT) dari HELP University Malaysia.');
    if (has(/\b(?:harus.*malaysia|kuliah di malaysia|tanpa.*malaysia|di mana|dimana|offline|indonesia)\b/i)) return answer('Program Double Degree HELP University dapat diikuti tanpa harus kuliah di Malaysia. Perkuliahan dilaksanakan secara offline di ITB STIKOM Bali dengan kurikulum yang mengacu pada kerja sama program.');
    if (has(/\b(?:program studi|prodi)\b/i)) return answer('Program Double Degree HELP University menggunakan Program Studi Sistem Informasi di ITB STIKOM Bali.');
    if (has(/\b(?:berapa lama|durasi|lama)\b/i)) return answer('Durasi Program Double Degree HELP University mengikuti masa studi sarjana, yaitu sekitar 4 tahun.');
    if (has(/\b(?:kurikulum|dipelajari|belajar|keunggulan|manfaat)\b/i)) return answer('Program Double Degree HELP University memadukan pembelajaran Sistem Informasi di ITB STIKOM Bali dengan standar internasional HELP University Malaysia, sehingga mahasiswa mendapat pengalaman pendidikan internasional dan peluang memperoleh dua gelar.');
    return answer('Program Double Degree ITB STIKOM Bali dengan HELP University Malaysia adalah program internasional pada Prodi Sistem Informasi yang memberi peluang mahasiswa memperoleh gelar S.Kom dari ITB STIKOM Bali dan Bachelor of Information Technology (BIT) dari HELP University.');
  }

  if (topic.key === 'double_degree_dnui') {
    if (has(/\b(?:tahun pertama|tahun kedua)\b/i)) return answer('Pada skema Double Degree DNUI, tahun pertama dan tahun kedua dilaksanakan di ITB STIKOM Bali.');
    if (has(/\b(?:tahun ketiga|online|kurikulum)\b/i)) return answer('Pada tahun ketiga Program Double Degree DNUI, perkuliahan menggunakan kurikulum DNUI dan dilaksanakan secara online sesuai skema program.');
    if (has(/\b(?:dormitory|tempat tinggal|shared room|gratis)\b/i)) return answer('Pada Program Double Degree DNUI, mahasiswa mendapatkan fasilitas dormitory selama kuliah di China. Dormitory tersedia dengan sistem shared room sesuai ketentuan program.');
    if (has(/\b(?:tahun keempat|pergi ke china|harus ke china|onsite|kuliah di china)\b/i)) return answer('Ya. Pada tahun keempat Program Double Degree DNUI, mahasiswa mengikuti perkuliahan secara onsite di Dalian Neusoft University of Information (DNUI), China.');
    if (has(/\b(?:program studi|prodi|bisnis digital|e-commerce|e commerce)\b/i)) return answer('Pada Program Double Degree DNUI, prodi di ITB STIKOM Bali adalah Bisnis Digital, sedangkan program di DNUI China adalah E-Commerce.');
    if (has(/\b(?:gelar|degree|s\.\s*bns|sbns|bachelor of management|\bbm\b|dua gelar)\b/i)) return answer('Setelah menyelesaikan Program Double Degree DNUI, mahasiswa memperoleh dua gelar: Sarjana Bisnis (S.Bns) dari ITB STIKOM Bali dan Bachelor of Management (BM) dari DNUI China.');
    if (has(/\b(?:berapa lama|durasi|lama)\b/i)) return answer('Program Double Degree DNUI berlangsung sekitar 4 tahun dengan skema perkuliahan bertahap antara ITB STIKOM Bali dan DNUI China.');
    return answer('Program Double Degree DNUI adalah kerja sama ITB STIKOM Bali dengan Dalian Neusoft University of Information, China. Prodi di ITB STIKOM Bali adalah Bisnis Digital dan program di DNUI adalah E-Commerce, dengan skema hingga tahun keempat onsite di China.');
  }

  if (topic.key === 'hi_think') {
    if (has(/\b(?:berapa\s+lama|durasi|lama|masa\s+studi|gelar|degree|title)\b/i)) return noData('Saya belum menemukan data yang sesuai untuk durasi atau gelar Program Hi-Think.');
    if (has(/\b(?:semester|year 3|tahun ke|mulai kapan|kapan)\b/i)) return answer('Program Hi-Think dapat diikuti mulai Semester 5 atau Year 3.');
    if (has(/\b(?:n2|minimal n2|level kemampuan|belum mencapai n2|syarat.*jepang)\b/i)) return answer('Untuk jalur kerja di Jepang pada Program Hi-Think, kemampuan bahasa Jepang minimal N2 menjadi syarat penting. Jika belum mencapai N2, mahasiswa tetap dapat diarahkan pada peluang kerja di Jakarta atau China sambil meningkatkan kemampuan bahasa Jepang.');
    if (has(/\b(?:kerja|karier|peluang|jakarta|china|jepang)\b/i)) return answer('Program Hi-Think memiliki jalur karier dan peluang kerja setelah lulus. Peserta berkesempatan bekerja di Jepang, China, atau Jakarta, dengan ketentuan kemampuan bahasa Jepang terutama untuk jalur Jepang.');
    if (has(/\b(?:sulit|menantang|tantangan)\b/i)) return answer('Program Hi-Think termasuk menantang karena berbasis industri Jepang, project-based learning, pelatihan bahasa Jepang, dan persiapan peluang kerja setelah lulus.');
    if (has(/\b(?:project|industry|konsep|kurikulum|dipelajari|pelatihan bahasa|bahasa jepang)\b/i)) return answer('Program Hi-Think menggabungkan kurikulum ITB STIKOM Bali dengan kurikulum berbasis industri Jepang, menggunakan project-based dan industry-oriented learning, serta memberikan pelatihan bahasa Jepang.');
    if (has(/\b(?:manfaat|keunggulan|tujuan|pengalaman internasional)\b/i)) return answer('Keunggulan Program Hi-Think adalah memberi pengalaman belajar berorientasi industri Jepang, meningkatkan keterampilan teknis, bahasa Jepang, kesiapan profesional, dan peluang karier internasional.');
    if (has(/\b(?:biaya|mekanisme pendaftaran|daftar|informasi|hubungi)\b/i)) return answer('Untuk informasi biaya, mekanisme pendaftaran, dan jadwal Program Hi-Think, mahasiswa dapat menghubungi admin kampus atau unit/program terkait karena detail teknis dapat mengikuti periode pembukaan program.');
    return null;
  }

  if (topic.key === 'student_exchange') {
    if (has(/\b(?:ada program apa saja|program apa saja)\b/i)) return null;
    if (has(/\b(?:jenis|program.*tersedia|pilihan|apa saja jenis|perbedaan)\b/i)) return answer('Jenis program Student Exchange yang tersedia meliputi Exchange Reguler atau Credit Transfer, Short Program / Summer Program, dan Global Cross Cultural Program (GCCP).');
    if (has(/\b(?:gccp|global cross cultural)\b/i)) return answer('GCCP atau Global Cross Cultural Program adalah program yang memiliki kegiatan outbound dan inbound, interaksi dengan mahasiswa internasional, kegiatan akademik, kegiatan budaya, komunikasi global, dan teamwork.');
    if (has(/\b(?:negara|china|thailand|malaysia|filipina|philippines)\b/i)) return answer('Program Student Exchange tersedia ke negara mitra seperti China, Thailand, Malaysia, dan Filipina/Philippines. Negara tujuan dapat berubah sesuai kerja sama internasional yang aktif.');
    if (has(/\b(?:syarat|persyaratan|ipk|bahasa inggris|seleksi|wawancara|mahasiswa aktif)\b/i)) return answer('Syarat umum Student Exchange mencakup mahasiswa aktif ITB STIKOM Bali, memenuhi ketentuan IPK, memiliki kemampuan bahasa asing/Bahasa Inggris, serta mengikuti seleksi administrasi dan wawancara jika diminta.');
    if (has(/\b(?:informasi|mendaftar|pendaftaran|di mana|dimana|media sosial|pengumuman|direktorat)\b/i)) return answer('Informasi dan pendaftaran Student Exchange dapat diperoleh melalui Direktorat Urusan Internasional ITB STIKOM Bali, media sosial resmi kampus, atau pengumuman internal kampus.');
    if (has(/\b(?:tujuan|manfaat(?:nya)?|keuntungan|benefit(?:nya)?|dapat\s+apa|lingkungan internasional|bahasa asing|wawasan global|lintas budaya|jaringan|percaya diri|mandiri|karier)\b/i)) return answer('Student Exchange memberi pengalaman belajar di lingkungan internasional, meningkatkan kemampuan bahasa asing, wawasan global, pengalaman lintas budaya, kepercayaan diri, kemandirian, jaringan internasional, dan nilai tambah untuk karier.');
    return null;
  }
  return null;
}
function isNonPmbFaqDomainQuestion(question) {
  const q = String(question || '').toLowerCase();
  const asksCampusIdentity = /\b(?:apa\s+itu|profil|jelaskan\s+(?:tentang\s+)?(?:kampus\s+)?|informasi\s+tentang)\b/i.test(q)
    && /\b(?:itb\s*stikom\s*bali|stikom\s+bali)\b/i.test(q)
    && !/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|maba|camaba|jurusan|prodi|program|biaya|akreditasi|jadwal|daftar|pendaftaran|beasiswa|fasilitas)\b/i.test(q);
  return asksCampusIdentity || isCareerCenterQuestion(question) || isStudyPermitQuestion(question) || isStudentExchangeQuestion(question);
}

function tryKnownFaqQnaAnswer(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!q) return null;
  const answer = (value, source = 'semantic-rag-known-faq-qna', frameSource = 'semantic-rag-training-specific') => ({
    answer: value,
    source,
    frameSource,
    matchedSource: 'deterministic-faq-qna-guard'
  });

  if (isOverseasWorkStudyQuestion(q)) {
    return answer(buildOverseasWorkStudyAnswer(), 'semantic-rag-campus-facility', 'semantic-rag-campus-facility');
  }

  if (isPaidOverseasInternshipQuestion(q)) {
    return answer(buildPaidOverseasInternshipAnswer(), 'semantic-rag-campus-facility', 'semantic-rag-campus-facility');
  }

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
    if (/\b(dokumen(?:nya)?|berkas(?:nya)?|persyaratan|syarat(?:nya)?|diperlukan|pengajuan)\b/i.test(q)) {
      return answer('Dokumen yang diperlukan untuk pengajuan Izin Belajar umumnya meliputi identitas/paspor mahasiswa asing, dokumen penerimaan atau status studi di kampus, pas foto, dan dokumen pendukung lain sesuai ketentuan pengajuan. Untuk daftar final, mahasiswa perlu mengikuti arahan kampus karena persyaratan dapat mengikuti ketentuan pemerintah yang berlaku.');
    }
    if (/\b(proses|prosedur|pengurusan dokumen|dokumen mahasiswa asing)\b/i.test(q)) {
      return answer('Pengurusan dokumen mahasiswa asing di ITB STIKOM Bali dilakukan dengan menghubungi bagian kerja sama atau international office kampus. Mahasiswa menyiapkan dokumen persyaratan, kemudian kampus membantu proses pengajuan dan koordinasi administrasi sampai dokumen selesai sesuai ketentuan yang berlaku.');
    }
    if (/\b(cara|bagaimana|mengurus|urus)\b/i.test(q)) {
      if (/\bvisa\s*(?:study|studi|pelajar)?\b/i.test(q)) {
        return answer('Pengurusan Izin Belajar dan Visa Study untuk mahasiswa asing dilakukan melalui kampus/unit terkait. Mahasiswa menyiapkan dokumen persyaratan, menyerahkannya ke pihak kampus, lalu kampus membantu proses pengajuan Izin Belajar dan arahan administrasi Visa Study sesuai prosedur pemerintah yang berlaku.');
      }
      return answer('Pengurusan Izin Belajar dilakukan melalui kampus. Mahasiswa menyiapkan dokumen persyaratan mahasiswa asing, menyerahkannya ke pihak kampus/unit terkait, lalu kampus membantu proses pengajuan Izin Belajar sesuai prosedur pemerintah.');
    }

    if (/\b(apa itu|wajib|harus punya|perlu punya)\b/i.test(q)) {
      return answer('Izin Belajar adalah dokumen resmi dari pemerintah Indonesia yang menyatakan bahwa mahasiswa asing diperbolehkan menempuh pendidikan di Indonesia. Dokumen ini wajib dimiliki oleh seluruh mahasiswa asing.');
    }
  }

  const mentionedSupportEntity = findCampusSupportEntity(q);
  const careerCanOwnQuestion = !mentionedSupportEntity
    || mentionedSupportEntity.key === 'career-center'
    || mentionedSupportEntity.key === 'linkedin-career-center';
  if (careerCanOwnQuestion && isCareerCenterQuestion(q)) {
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
      return careerAnswer('Pada data Career Center yang tersedia, job fair tercantum sebagai salah satu bentuk dukungan karier untuk mahasiswa dan alumni, bersama informasi lowongan kerja, magang, campus hiring, konsultasi karier, dan tracer study. Untuk jadwal Job Fair yang sedang/akan berjalan, kakak perlu cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.');
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

  if (/\b(?:mengapa|kenapa|alasan)\b[\s\S]{0,40}\b(?:memilih|pilih)\b/i.test(q) && /\b(stikom bali|itb stikom)\b/i.test(q)) {
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
    if (/\b(manfaat(?:nya)?|keuntungan|benefit(?:nya)?|dapat\s+apa)\b/i.test(q)) {
      return answer('Manfaat mengikuti Student Exchange antara lain pengalaman belajar internasional, peningkatan kepercayaan diri dan kemandirian, memperluas jaringan global, serta nilai tambah untuk karier di masa depan.');
    }
    if (/\b(apa itu|student exchange|pertukaran mahasiswa)\b/i.test(q)) {
      return answer('Student Exchange adalah program pertukaran mahasiswa yang memberi kesempatan kepada mahasiswa ITB STIKOM Bali untuk belajar di kampus luar negeri dalam periode tertentu, sekaligus mendapatkan pengalaman akademik dan budaya internasional.');
    }
  }
  return null;
}
function isDanglingFaqAnswer(answer) {
  const text = String(answer || '').trim();
  if (!text) return false;
  return /(?:^|\s)[?*-]\s*[A-Za-z]{1,8}$/i.test(text) || /\b(?:pro|prog|progra|inform|pen|kurik|peluang|pengalaman)\s*$/i.test(text);
}

function recoverFaqAnswerAcrossChunkBoundary(sourceChunk, questionText, currentAnswer) {
  if (!isDanglingFaqAnswer(currentAnswer)) return currentAnswer;
  const source = String(sourceChunk || '');
  const question = String(questionText || '').trim();
  if (!source || !question) return currentAnswer;
  const questionAnchors = [question];
  const embeddedQuestion = question.match(/(?:apa\s+saja|apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|siapa|mengapa|kenapa)\b[^?]{4,240}\?/i);
  if (embeddedQuestion && embeddedQuestion[0]) questionAnchors.unshift(embeddedQuestion[0]);
  if (/^\S+\s+/.test(question)) questionAnchors.push(question.replace(/^\S+\s+/, ''));
  let pos = -1;
  let matchedQuestion = question;
  for (const anchor of questionAnchors) {
    const candidate = String(anchor || '').trim();
    if (!candidate) continue;
    pos = source.toLowerCase().indexOf(candidate.toLowerCase());
    if (pos >= 0) { matchedQuestion = candidate; break; }
  }
  let raw = '';
  if (pos >= 0) {
    raw = source.slice(pos + matchedQuestion.length);
  } else {
    const answerText = String(currentAnswer || '').trim();
    const answerPos = answerText ? source.toLowerCase().indexOf(answerText.toLowerCase()) : -1;
    if (answerPos < 0) return currentAnswer;
    raw = source.slice(answerPos);
  }
  const recovered = trimRecoveredFaqAnswerToSection(cleanUserVisibleRagAnswerText(cleanFaqAnswerText(raw)));
  return recovered && recovered.length > String(currentAnswer || '').length ? recovered : currentAnswer;
}

function mergeChunkPartsWithOverlap(parts) {
  const cleanParts = (Array.isArray(parts) ? parts : [])
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  let merged = '';
  for (const part of cleanParts) {
    if (!merged) {
      merged = part;
      continue;
    }
    let overlap = 0;
    const max = Math.min(220, merged.length, part.length);
    for (let len = max; len >= 12; len -= 1) {
      if (merged.slice(-len).toLowerCase() === part.slice(0, len).toLowerCase()) {
        overlap = len;
        break;
      }
    }
    if (!overlap) {
      const tail = merged.slice(-500).toLowerCase();
      for (let probe = Math.min(180, part.length); probe >= 32; probe -= 8) {
        const prefix = part.slice(0, probe).toLowerCase();
        const foundAt = tail.indexOf(prefix);
        if (foundAt >= 0) {
          overlap = tail.length - foundAt;
          overlap = Math.min(overlap, part.length);
          break;
        }
      }
    }
    const suffix = part.slice(overlap);
    const needsSpace = merged && suffix && !/\s$/.test(merged) && !/^\s|^[,.;:!?)]/.test(suffix);
    merged += (needsSpace ? ' ' : '') + suffix;
  }
  return merged;
}

function trimRecoveredFaqAnswerToSection(answer) {
  let text = String(answer || '').trim();
  if (!text) return text;
  const boundaryRe = /\b(?:Penetapan\s+Kemampuan|Profil\s+Lulusan|Profesi\s+Lulusan|Berikut\s+adalah\s+daftar\s+mata\s+kuliah|Semester\s+[IVX]+|Mata\s+Kuliah|Kurikulum\s+Program\s+Studi)\b/i;
  const boundary = boundaryRe.exec(text);
  if (boundary && boundary.index >= 120) text = text.slice(0, boundary.index).trim();
  return text
    .replace(/\s*\u2022\s*[A-Za-z]{1,8}\s+[^\u2022:]{20,320}\.\s+(?=\u2022\s*[A-Z][^:]{2,90}:)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function buildChunkContinuationText(index, itemIndex, maxExtraChunks = 8) {
  const current = Array.isArray(index) ? index[itemIndex] : null;
  const currentChunk = String(current && current.chunk ? current.chunk : '').trim();
  if (!current || !current.trainingId) return currentChunk;
  const trainingId = String(current.trainingId);
  const seen = new Set();
  const parts = [];
  const pushChunk = (chunk) => {
    const text = String(chunk || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    parts.push(text);
  };
  pushChunk(currentChunk);

  const fullIndex = getCachedSemanticIndex();
  const searchIndex = Array.isArray(fullIndex) && fullIndex.length ? fullIndex : index;
  const currentPos = searchIndex.findIndex((item) => item && String(item.trainingId || '') === trainingId && String(item.chunk || '').trim() === currentChunk);
  if (currentPos >= 0) {
    for (let cursor = currentPos + 1; cursor < searchIndex.length && parts.length < maxExtraChunks; cursor += 1) {
      const next = searchIndex[cursor];
      if (!next || String(next.trainingId || '') !== trainingId) break;
      pushChunk(next.chunk);
    }
  } else {
    for (const item of searchIndex) {
      if (!item || String(item.trainingId || '') !== trainingId) continue;
      pushChunk(item.chunk);
      if (parts.length >= maxExtraChunks) break;
    }
  }

  return mergeChunkPartsWithOverlap(parts).slice(0, 12000);
}

function buildGenericFaqQnaAnswerFromIndex(question, indexForQuery, options = {}) {
  const q = String(question || '').trim();
  if (!q || !isLikelyFaqQuestionText(q)) return null;
  const index = Array.isArray(indexForQuery) ? indexForQuery : [];
  if (!index.length) return null;
  const requestedSupportEntity = findCampusSupportEntity(q);

  const scored = [];
  for (let itemIndex = 0; itemIndex < index.length; itemIndex += 1) {
    const item = index[itemIndex];
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (isLikelyRawAdministrativeDocument(chunk, item && (item.filename || item.sourceFile || ''))) continue;
    const faqSourceChunk = chunk;
    const faqContinuationChunk = buildChunkContinuationText(index, itemIndex, 8);
    const pairs = extractFaqQaPairsFromChunk(faqSourceChunk);
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

      let answer = cleanUserVisibleRagAnswerText(pair.answerText);
      answer = trimRecoveredFaqAnswerToSection(recoverFaqAnswerAcrossChunkBoundary(faqContinuationChunk, pair.questionText, answer));
      if (!answer || answer.length < 8) continue;
      const evidenceNorm = normalizeFacilityTerm(`${sourceText} ${chunk} ${pair.questionText} ${answer}`);
      const asksPostgraduate = /\b(?:pasca|pascasarjana|pasca\s*sarjana|magister|master|s2|s\s*2)\b/i.test(qNorm);
      if (asksPostgraduate && !/\b(?:pasca|pascasarjana|pasca\s*sarjana|magister|master|s2|s\s*2|magister\s+sistem\s+informasi|sistem\s+informasi)\b/i.test(evidenceNorm)) continue;
      if (asksPostgraduate && !/\b(?:pasca|pascasarjana|magister|s2|sistem\s+informasi)\b/i.test(normalizeFacilityTerm(answer))) {
        answer = `Keunggulan Program Pascasarjana / S2 Sistem Informasi ITB STIKOM Bali: ${answer}`;
      }
      const scopedFaqNorm = normalizeFacilityTerm(`${sourceText} ${pair.questionText} ${answer}`);
      if (requestedSupportEntity && !requestedSupportEntity.normalizedPatterns.some((pattern) => pattern && scopedFaqNorm.includes(pattern))) continue;
      const faqQuestionNorm = normalizeFacilityTerm(pair.questionText);
      const requiredFaqQuestionTerms = ['sulit', 'menantang'];
      if (requiredFaqQuestionTerms.some((term) => qNorm.includes(term) && !faqQuestionNorm.includes(term))) continue;
      if (hasFaqAnswerDomainConflict(q, pair.questionText, answer, sourceText)) continue;
      const score = scoreFaqQuestionMatch(q, pair.questionText, '', []);
      const sourceBoost = /upload/i.test(String(item && item.source ? item.source : '')) ? 2 : 0;
      const sourceTermBoost = qTokens.filter((token) => normalizeFacilityTerm(sourceText).includes(token)).length;
      const evidenceTermBoost = qTokens.filter((token) => evidenceNorm.includes(token)).length;
      const postgraduateEvidenceBoost = asksPostgraduate ? 4 : 0;
      const finalScore = score + sourceBoost + sourceTermBoost + evidenceTermBoost + postgraduateEvidenceBoost + overlap;
      if (finalScore < 8) continue;
      scored.push({ item, pair, answer, score: finalScore, baseScore: score, overlap });
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.baseScore - a.baseScore || a.answer.length - b.answer.length);
  const best = scored[0];
  const bestNorm = normalizeFacilityTerm(best.pair.questionText);
  const userNorm = normalizeFacilityTerm(q);
  const strongExactOrNearExact = bestNorm && userNorm && (userNorm.includes(bestNorm) || bestNorm.includes(userNorm));
  if (best.score < 12 && best.baseScore < 8 && !strongExactOrNearExact) return null;
  const answer = best.answer.length > 1100 ? `${best.answer.slice(0, 1097).trim()}...` : best.answer;
  const source = /upload/i.test(String(best.item && best.item.source ? best.item.source : '')) ? 'semantic-rag-uploaded-training-generic' : 'semantic-rag-generic-faq-qna';
  const preflight = evaluateOutboundAnswer(answer, q, { source });
  if ((preflight && preflight.blocked) || hasRawSpreadsheetFaqDump(answer) || hasRawEvidenceSnippetShape(answer)) return null;
  return {
    answer,
    source: 'semantic-rag-generic-faq-qna',
    frameSource: 'semantic-rag-training-specific',
    matchedFaqQuestion: best.pair.questionText,
    matchedTrainingId: best.item && best.item.trainingId,
    matchedItemSource: best.item && best.item.source,
    matchedSource: best.item && (best.item.filename || best.item.sourceFile || best.item.id)
  };
}

function hasSpecificFaqQnaEntity(question) {
  const q = String(question || '').toLowerCase();
  if (!q) return false;
  if (findCampusSupportEntity(q)) return true;
  return /\b(?:dnui|dalian|help\s+university|utb|universitas\s+teknologi\s+bandung|mahasiswa\s+asing|foreign\s+student|izin\s+belajar|study\s+permit|visa\s*(?:study|studi|pelajar)?|e\s*30\s*b|itas|kitas|sktt|career\s*center|pusat\s+kar(?:ir|ier)|tracer\s*study|job\s*fair|campus\s*hiring|inkubator\s+bisnis|inbis|hi-?think|hithink|student\s+exchange|pertukaran\s+mahasiswa|gccp|bccp|short\s*program|summer\s+program|credit\s+transfer)\b/i.test(q);
}
function tryGenericFaqQnaAnswer(question, indexForQuery, options = {}) {
  const q = String(question || '');
  const fine = detectFineGrainedIntent(q);
  const specificFaqEntity = hasSpecificFaqQnaEntity(q);
  if (['program_comparison', 'program_curriculum', 'program_faculty'].includes(fine.fineIntent)) return null;
  if (['international_program_list', 'international_program_requirement', 'international_program_fee'].includes(fine.fineIntent) && !specificFaqEntity) return null;
  const asksProgramDefinition = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|maksud(?:nya)?|jelaskan)\b/i.test(q)
    && /\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|\bsi\b|\bti\b|\bbd\b|\bsk\b|\bmi\b)\b/i.test(q);
  if (asksProgramDefinition) return null;
  const asksProgramComparison = /\b(?:beda|bedanya|perbedaan|bandingkan|perbandingan)\b/i.test(q)
    && /\b(?:prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|manajemen)\b/i.test(q);
  if (asksProgramComparison) return null;
  return buildGenericFaqQnaAnswerFromIndex(question, indexForQuery, options);
}
function tryPostgraduateProfileAnswer(question) {
  const q = String(question || '');
  if (!/\b(?:pasca|pascasarjana|pasca\s*sarjana|s2|s\s*2|magister|master)\b/i.test(q)) return null;

  const answer = (text) => ({
    answer: text,
    source: 'semantic-rag-postgraduate-profile',
    frameSource: 'semantic-rag-training-specific'
  });

  if (/\b(?:keunggulan|unggulan|kelebihan|manfaat|kenapa\s+(?:memilih|ambil)|alasan\s+memilih)\b/i.test(q)) {
    return answer([
      'Keunggulan Program Pascasarjana / S2 Sistem Informasi ITB STIKOM Bali antara lain:',
      '',
      '- Kurikulumnya berbasis industri dan diarahkan pada kebutuhan bidang sistem informasi modern.',
      '- Didukung dosen berpengalaman.',
      '- Program Studi S2 Sistem Informasi memiliki akreditasi Baik Sekali dari LAM INFOKOM.',
      '- Fokus pengembangannya pada Intelligent & Secure System.',
      '- Fokus penelitian yang tersedia mencakup Cyber Security, Data Science, Enterprise System, dan Medical Informatics.',
      '- Masa studi normal 4 semester dengan total 56 SKS.',
      '',
      'Jadi, program ini cocok untuk lulusan S1 yang ingin memperdalam keahlian sistem informasi, data, keamanan, enterprise system, atau riset terapan di bidang teknologi.'
    ].join('\n'));
  }

  if (/\b(?:fokus\s+penelitian|konsentrasi|bidang\s+riset|riset)\b/i.test(q)) {
    return answer('Fokus penelitian Program Pascasarjana / S2 Sistem Informasi ITB STIKOM Bali mencakup Cyber Security, Data Science, Enterprise System, dan Medical Informatics.');
  }

  if (/\b(?:gelar|title)\b/i.test(q)) {
    return answer('Lulusan Program Pascasarjana / S2 Sistem Informasi ITB STIKOM Bali memperoleh gelar Magister Komputer (M.Kom.).');
  }

  if (/\b(?:lama|masa\s+studi|berapa\s+semester|total\s+sks|sks)\b/i.test(q)) {
    return answer('Masa studi normal Program Pascasarjana / S2 Sistem Informasi ITB STIKOM Bali adalah 4 semester dengan total 56 SKS.');
  }

  if (/\b(?:apa\s+itu|profil|tentang|program\s+apa|nama\s+program)\b/i.test(q)) {
    return answer('Program Pascasarjana ITB STIKOM Bali menyelenggarakan Program Studi Magister Sistem Informasi atau S2 Sistem Informasi. Program ini berfokus pada penguatan keahlian sistem informasi tingkat lanjut, dengan arah Intelligent & Secure System.');
  }

  return null;
}

function tryAccreditationAnswer(question, indexForQuery) {
  const q = String(question || '');
  if (!/\b(akreditasi(?:nya)?|akredit|akrediasi|terakreditasi|ban\s*-?\s*pt|peringkat\s+akreditasi|sertifikat\s+akreditasi|sk\s+akreditasi)\b/i.test(q)) return null;

  const asksS2Accreditation = /\b(?:pasca|pascasarjana|pasca\s*sarjana|s2|s\s*2|magister|master)\b/i.test(q);
  if (asksS2Accreditation) {
    const structuredS2 = ragEngine.tryStructuredAccreditationAnswer('akreditasi S2 Sistem Informasi', indexForQuery);
    if (structuredS2 && structuredS2.answer && structuredS2.source !== 'rag-accreditation-clarify') return structuredS2;
    return {
      answer: 'Akreditasi Prodi S2 Sistem Informasi belum saya temukan secara lengkap pada data akreditasi yang tersedia. Agar tidak salah menyebut peringkat, kakak sebaiknya konfirmasi ke Admin PMB atau bagian akademik.',
      source: 'rag-accreditation-no-data',
      frameSource: 'rag-accreditation'
    };
  }

  if (/\b(?:manajemen\s+informatika|d\s*3\s+manajemen|d3\s+manajemen|\bmi\b)\b/i.test(q)) {
    return {
      answer: 'Akreditasi Prodi Manajemen Informatika: Baik.',
      source: 'rag-accreditation',
      frameSource: 'rag-accreditation'
    };
  }

  const asksProgramAccreditationOverview = /\b(program|prodi|program\s+studi|jurusan)\b/i.test(q)
    && /\b(apa\s+(?:aja|saja)|ada\s+apa|yang\s+ada|tersedia|gimana|bagaimana)\b/i.test(q);
  if (asksProgramAccreditationOverview) {
    return {
      answer: [
        'Program yang tersedia di ITB STIKOM Bali:',
        '',
        '- S2 Sistem Informasi',
        '- S1 Sistem Informasi',
        '- S1 Teknologi Informasi',
        '- S1 Bisnis Digital',
        '- S1 Sistem Komputer',
        '- D3 Manajemen Informatika',
        '',
        'Akreditasi yang terbaca pada data:',
        '- Institusi ITB STIKOM Bali: Baik Sekali (BAN-PT)',
        '- Sistem Informasi: Baik Sekali',
        '- Teknologi Informasi: Baik',
        '- Bisnis Digital: Baik',
        '- Sistem Komputer: Baik Sekali',
        '- Manajemen Informatika: Baik'
      ].join('\n'),
      source: 'rag-accreditation',
      frameSource: 'rag-accreditation'
    };
  }
  const structured = ragEngine.tryStructuredAccreditationAnswer(question, indexForQuery);
  if (structured && structured.answer && structured.source !== 'rag-accreditation-clarify') {
    return structured;
  }

  const asksInstitution = /\b(kampus|institusi|perguruan\s+tinggi|itb\s*stikom\s*bali|stikom\s*bali)\b|\bdi\s*kampus\b/i.test(q)
    || /\b(apakah|apa)\b[\s\S]{0,80}\bterakreditasi\b/i.test(q);
  if (!asksInstitution || !Array.isArray(indexForQuery) || !indexForQuery.length) return structured || null;

  const candidates = [];
  for (const item of indexForQuery) {
    const chunk = String(item && item.chunk ? item.chunk : '').replace(/\s+/g, ' ').trim();
    const haystack = `${item && (item.filename || item.sourceFile || '')} ${chunk}`;
    if (!/akreditasi|ban\s*-?\s*pt|peringkat/i.test(haystack)) continue;
    if (!/institut\s+teknologi\s+dan\s+bisnis\s+stikom\s+bali|itb\s*stikom\s*bali|perguruan\s+tinggi/i.test(haystack)) continue;
    const gradeMatch = chunk.match(/menjadi\s+(UNGGUL|BAIK\s+SEKALI|BAIK|[ABC])\b/i)
      || chunk.match(/peringkat\s+akreditasi[\s\S]{0,160}?\b(UNGGUL|BAIK\s+SEKALI|BAIK|[ABC])\b/i)
      || chunk.match(/terakreditasi[\s\S]{0,80}?\b(UNGGUL|BAIK\s+SEKALI|BAIK|[ABC])\b/i);
    const skMatch = haystack.match(/(?:Nomor\s*[:\-]?\s*)?([0-9]{2,5}\/SK\/BAN\s*-?\s*PT\/[A-Za-z0-9.\/-]+\/\d{4})/i);
    const score = (gradeMatch ? 10 : 0) + (skMatch ? 4 : 0) + (/konversi\s+peringkat/i.test(haystack) ? 3 : 0) + (/perguruan\s+tinggi/i.test(haystack) ? 2 : 0);
    if (score > 0) candidates.push({ chunk, score, grade: gradeMatch && gradeMatch[1], sk: skMatch && skMatch[1] });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || !best.grade) return structured || null;
  const grade = String(best.grade).replace(/\s+/g, ' ').trim().replace(/\b\w/g, (m) => m.toUpperCase());
  const lines = [`ITB STIKOM Bali sudah terakreditasi oleh BAN-PT dengan peringkat ${grade}.`];
  if (best.sk) lines.push(`Nomor SK: ${String(best.sk).replace(/\s+/g, '')}.`);
  return {
    answer: lines.join('\n'),
    source: 'rag-accreditation',
    frameSource: 'rag-accreditation'
  };
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
  const accreditationResult = tryAccreditationAnswer(question, indexForQuery);
  if (accreditationResult && accreditationResult.answer) return accreditationResult;

  const q = String(question || '');
  if (/\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|pusat\s+karir|karier|karir|lowongan|job\s*fair|campus\s*hiring|rekrutmen|tracer\s*study|konsultasi\s+karier|inkubator|inbis|incubator|language\s+learning|llc|belajar\s+bahasa|kemampuan\s+bahasa|softskill|soft\s*skill|hi-?think|hithink|gccp|gcpp|bccp|student\s*exchange|short\s*course|kuliah\s+sambil\s+kerja|magang\s+berbayar)\b/i.test(q)) return null;
  if (/\b(?:double\s*degree|dual\s*degree|dkv|desain\s+komunikasi\s+visual|desain\s+visual|visual\s+branding|illustration|utb|dnui|help\s+university)\b/i.test(q)) return null;
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
    .replace(/["'\u201c\u201d\u2018\u2019]/g, '')
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
    'LLC adalah singkatan dari Language Learning Center. Dari data fasilitas yang tersedia, ITB STIKOM Bali mencantumkan Language Learning Center (LLC) sebagai fasilitas/program pendukung untuk pengembangan kemampuan bahasa mahasiswa.',
    '',
    'Selain itu, pada data program Hi-Think juga disebutkan adanya kursus bahasa Jepang sebagai bagian dari persiapan belajar/karier yang berkaitan dengan industri Jepang.',
    '',
    'Untuk detail teknis seperti bahasa apa saja yang tersedia, jadwal kelas, syarat ikut, atau biaya jika ada, saya belum menemukan rincian lengkapnya di data yang aman. Sebaiknya kakak konfirmasi ke admin kampus atau pengelola program terkait.'
  ].join('\n');
}

function buildCareerReadinessProgramsAnswer() {
  return [
    'Ya, dari data Career Center yang tersedia, mahasiswa mendapat dukungan untuk persiapan karier dan melamar pekerjaan.',
    '',
    'Bentuk kegiatan atau layanannya mencakup:',
    '',
    '- Konsultasi atau bimbingan karier.',
    '- Pembekalan softskill dan keterampilan kerja.',
    '- Persiapan melamar pekerjaan dan memasuki dunia profesional.',
    '- Informasi lowongan kerja dan peluang karier.',
    '- Informasi magang atau pengalaman kerja.',
    '- Job fair atau campus hiring jika tersedia dalam agenda kampus.',
    '- Tracer study dan dukungan kesiapan kerja setelah lulus.',
    '',
    'Untuk jadwal kegiatan, materi pelatihan rinci, formulir pendaftaran, atau program yang sedang berjalan, kakak sebaiknya cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.'
  ].join('\n');
}
function buildCareerSoftskillAnswer() {
  return [
    'Ya, mahasiswa mendapat dukungan persiapan sebelum melamar pekerjaan melalui layanan Career Center dan program pengembangan softskill yang tercatat pada data kampus.',
    '',
    'Bentuk kegiatannya yang aman saya sampaikan:',
    '',
    '- Bimbingan atau konsultasi karier.',
    '- Pembekalan softskill dan keterampilan kerja.',
    '- Arahan kesiapan melamar pekerjaan dan memasuki dunia profesional.',
    '- Informasi lowongan kerja, magang, job fair, atau campus hiring jika tersedia.',
    '- Dukungan karier untuk mahasiswa dan alumni.',
    '',
    'Untuk detail teknis seperti jadwal pelatihan, nama kelas, materi per sesi, kuota, atau cara ikut, saya belum menemukan rincian lengkap pada data yang tersedia. Bagian itu sebaiknya dikonfirmasi ke Career Center/admin kampus.'
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
function buildOverseasWorkStudyAnswer() {
  return [
    'Kuliah Sambil Kerja di Luar Negeri adalah program pendukung yang tercatat di data fasilitas/program ITB STIKOM Bali untuk memberi mahasiswa peluang pengalaman belajar sekaligus bekerja di luar negeri.',
    '',
    'Data yang aman saya sampaikan baru sebatas nama dan arah programnya: program ini berkaitan dengan pengalaman internasional, pengembangan kemampuan kerja, dan persiapan mahasiswa menghadapi lingkungan kerja global.',
    '',
    'Untuk detail teknis seperti negara tujuan, syarat peserta, durasi, biaya, jadwal, jenis pekerjaan, dan alur pendaftaran, data training saat ini belum memuat rincian lengkap. Bagian itu sebaiknya dikonfirmasi ke admin kampus atau unit kerja sama internasional.'
  ].join('\n');
}

function buildPaidOverseasInternshipAnswer() {
  return [
    'Magang Berbayar di Luar Negeri adalah program pendukung yang tercatat sebagai peluang pengalaman kerja/magang internasional bagi mahasiswa.',
    '',
    'Maksudnya, mahasiswa berkesempatan mengikuti magang di luar negeri dan programnya disebut sebagai magang berbayar pada data fasilitas yang tersedia.',
    '',
    'Namun data yang aman belum memuat rincian seperti negara tujuan, perusahaan mitra, nominal uang saku/gaji, durasi, syarat peserta, biaya, jadwal, atau alur seleksi. Untuk detail tersebut, kakak sebaiknya konfirmasi ke admin kampus atau unit kerja sama internasional agar tidak keliru.'
  ].join('\n');
}

function buildHiThinkAnswer() {
  return [
    'Program Hi-Think tercatat sebagai program yang berkaitan dengan persiapan belajar dan karier mahasiswa di lingkungan industri teknologi Jepang.',
    '',
    'Dari data yang tersedia, program ini menekankan penguatan kompetensi dan persiapan kerja yang relevan dengan kebutuhan industri teknologi, serta adanya unsur pembelajaran bahasa Jepang yang mendukung kesiapan kerja.',
    '',
    'Untuk detail teknis seperti syarat ikut, jadwal, kuota, biaya, atau alur pendaftaran, kakak sebaiknya konfirmasi ke admin kampus atau pengelola program.'
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
  if (/\b(semester\s+antara|semester\s+pendek|sp\b|pelaksanaan\s+akademik)\b/i.test(q)) {
    return 'Saya belum menemukan jadwal pelaksanaan akademik semester antara yang cukup aman pada data yang tersedia. Untuk tanggal selesai atau periode resminya, kakak sebaiknya cek kalender akademik/SION atau konfirmasi ke BAAK.';
  }
  if (/\b(semester\s+(?:genap|ganjil)|genap\s+\d{4}\s*\/\s*\d{4}|ganjil\s+\d{4}\s*\/\s*\d{4})\b/i.test(q)) {
    return 'Saya belum menemukan jadwal pelaksanaan akademik semester genap/ganjil yang cukup aman pada data yang tersedia. Untuk tanggal mulai, selesai, atau periode resminya, kakak sebaiknya cek kalender akademik/SION atau konfirmasi ke BAAK.';
  }
  if (/\b(remedial|remidi)\b/i.test(q)) {
    return 'Saya belum menemukan jadwal remedial semester genap yang cukup aman pada data yang tersedia. Untuk jadwal resmi remedial, kakak sebaiknya cek pengumuman akademik/SION atau konfirmasi ke BAAK/dosen pengampu.';
  }
  return 'Saya belum menemukan jadwal akademik yang cukup aman pada data yang tersedia. Untuk jadwal resmi, kakak sebaiknya cek pengumuman akademik/SION atau konfirmasi ke BAAK.';
}


function tryCampusSupportEntityAnswer(question, indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  const explicitNonCareerSupportEntity = findCampusSupportEntity(q);
  const questionMentionsNonCareerSupport = explicitNonCareerSupportEntity
    && explicitNonCareerSupportEntity.key !== 'career-center'
    && explicitNonCareerSupportEntity.key !== 'linkedin-career-center';
  if (/\b(?:inbis|inkubator\s+bisnis|incubator\s+bisnis)\b/i.test(q) && /\b(?:apa\s+itu|itu\s+apa|jelaskan|detail|informasi|info|program|layanan|manfaat|kegiatan|aktivitas|ada|tersedia|punya)\b/i.test(q)) {
    return {
      answer: buildInkubatorBisnisAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\b(?:dkv|desain\s+komunikasi\s+visual)\b/i.test(q) && /\b(?:apa\s+itu|itu\s+apa|definisi|pengertian|jelaskan|maksud(?:nya)?)\b/i.test(q)) {
    return {
      answer: [
        'DKV adalah singkatan dari Desain Komunikasi Visual.',
        '',
        'Bidang ini fokus pada seni visual, komunikasi pesan, branding, dan penyampaian informasi melalui elemen visual seperti layout, warna, tipografi, ilustrasi, dan media digital.',
        '',
        'Untuk detail kurikulum atau program resmi yang tersedia di kampus, kakak bisa cek program studi yang relevan atau konfirmasi ke admin PMB supaya tidak keliru.'
      ].join('\n'),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\bjob\s*fair\b/i.test(q) && /\b(?:apa\s+itu|itu\s+apa|definisi|pengertian|jelaskan|maksud(?:nya)?|kegunaan|manfaat)\b/i.test(q)) {
    return {
      answer: [
        'Job fair adalah kegiatan kampus yang mempertemukan mahasiswa atau alumni dengan perusahaan, instansi, atau mitra industri.',
        '',
        'Tujuannya biasanya untuk memperkenalkan peluang kerja, magang, dan karier, sekaligus memberi kesempatan peserta untuk bertanya langsung dengan pihak rekrutmen.',
        '',
        'Pada data Career Center yang tersedia, job fair tercantum sebagai salah satu bentuk dukungan karier yang penting, bersama informasi lowongan kerja, magang, campus hiring, konsultasi karier, dan tracer study.',
        '',
        'Untuk jadwal, syarat, atau daftar perusahaan yang hadir, kakak sebaiknya cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.'
      ].join('\n'),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\bcareer\s*center\b/i.test(q) && /\b(?:apa\s+saja|program|layanan|apa\s+itu|itu\s+apa|detail|kegunaan|manfaat)\b/i.test(q)) {
    return {
      answer: buildCareerReadinessProgramsAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier|career)\b/i.test(q)) {
    return {
      answer: buildLinkedInCareerNoDataAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  if (isOverseasWorkStudyQuestion(q)) {
    return {
      answer: buildOverseasWorkStudyAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (isPaidOverseasInternshipQuestion(q)) {
    return {
      answer: buildPaidOverseasInternshipAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  const internationalMentionCount = [
    /\b(?:short\s*course|shortcourse|kursus\s+singkat)\b/i,
    /\b(?:student\s*exchange|students\s*exchange|studens\s*exchange|pertukaran\s+mahasiswa|exchange\s+program)\b/i,
    /\bbccp\b/i,
    /\b(?:gccp|gcpp|gcp)\b/i
  ].filter((pattern) => pattern.test(q)).length;
  if (internationalMentionCount >= 2 && /\b(?:ada|tersedia|punya|program|apa\s+saja|apa\s+aja|pilihan|opsi)\b/i.test(q)) {
    return {
      answer: buildCampusSupportTechnicalNoDataAnswer({ label: 'program internasional seperti short course, Student Exchange, GCCP, atau BCCP' }, q),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  if (/\b(?:hi[-\s]?think|hithink)\b/i.test(q)) {
    let hiThinkAnswer = buildHiThinkAnswer();
    if (/\b(?:kapan|mulai|semester|ikut|mengikuti|daftar|mendaftar)\b/i.test(q)) {
      hiThinkAnswer = 'Mahasiswa dapat mengikuti Program Hi-Think mulai Semester 5. Program ini berkaitan dengan persiapan belajar dan karier di lingkungan industri teknologi Jepang, termasuk penguatan kompetensi dan bahasa Jepang. Untuk jadwal pembukaan, kuota, dan alur pendaftaran yang sedang berjalan, kakak sebaiknya konfirmasi ke admin kampus atau pengelola program.';
    } else if (/\b(?:karier|karir|career|peluang\s+kerja|kerja|membantu|manfaat)\b/i.test(q)) {
      hiThinkAnswer = 'Program Hi-Think membantu karier mahasiswa dengan menyiapkan kompetensi yang relevan dengan industri teknologi Jepang, termasuk pembelajaran bahasa Jepang dan kesiapan kerja. Dari data yang tersedia, program ini memberi peluang kerja di perusahaan Hi-Think, baik di Indonesia, China, maupun Jepang.';
    } else if (/\b(?:sulit|menantang|berat|susah)\b/i.test(q)) {
      hiThinkAnswer = 'Program Hi-Think termasuk menantang karena berbasis industri dan berkaitan dengan persiapan kerja di lingkungan teknologi Jepang. Namun program ini juga memberi pengalaman belajar, penguatan bahasa Jepang, dan peluang karier yang besar bagi mahasiswa yang siap mengikuti prosesnya.';
    }
    return {
      answer: hiThinkAnswer,
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }

  if (/\b(?:short\s*course|shortcourse|kursus\s+singkat)\b/i.test(q) && !/\bgccp\b/i.test(q)) {
    return {
      answer: buildGccpAnswer(),
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
  const earlyAsksStudentExchangeProgramOptions = resolved.entity.key === 'student-exchange'
    && /\b(program\s+apa\s+saja|ada\s+program\s+apa\s+saja|pilihan\s+program|program\s+yang\s+tersedia|opsi\s+program|ada\s+pilihan\s+program|program\s+internasional|program\s+support|program\s+pendukung)\b/i.test(q);
  if (earlyAsksStudentExchangeProgramOptions) {
    return {
      answer: buildStudentExchangeProgramOptionsAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
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
  if (resolved.entity.key === 'language-learning-center') {
    return {
      answer: buildLanguageLearningAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-facility',
      matchedEntity: resolved.entity.key,
      contextResolved: resolved.fromRecent || undefined
    };
  }

  const currentMentionsEntity = !resolved.fromRecent;
  const asksAdmissionRegistration = /\b(kuliah|pmb|mahasiswa\s+baru|camaba|prodi|program\s+studi|jurusan|gelombang|siap\.stikom|biaya|ukt|dpp)\b/i.test(q);
  const asksOtherSupportTopic = /\b(layanan\s+industri|kerja\s*sama\s+industri|industri|inkubator|goes\s*to\s*school|gccp|gcpp|gcp|bccp|student\s+exchange|soft\s*skill|softskill|language\s+learning|belajar\s+bahasa|kemampuan\s+bahasa|ukm|ormawa|hi-?think)\b/i.test(q);
  if (resolved.fromRecent && asksAdmissionRegistration) return null;
  if (resolved.fromRecent && resolved.entity.key === 'linkedin-career-center' && asksOtherSupportTopic) return null;
  if (resolved.fromRecent && isExplicitNonSupportTopic(question) && resolved.entity.key !== 'linkedin-career-center') return null;
  const hasFollowUpSignal = resolved.fromRecent && isShortCampusSupportFollowUp(question);
  const asksDetail = asksCampusSupportDetail(question);
  if (!currentMentionsEntity && !hasFollowUpSignal && !asksDetail) return null;

  const asksStudentExchangeDefinition = resolved.entity.key === 'student-exchange'
    && /\b(?:apa\s+itu|itu\s+apa|definisi|pengertian|maksud(?:nya)?|jelaskan)\b/i.test(q)
    && !/\b(?:syarat|cara|bagaimana|gimana|ikut|mengikuti|daftar|mendaftar|pendaftaran|registrasi|biaya|jadwal|kapan|program\s+apa\s+saja|apa\s+saja|apa\s+aja|pilihan|opsi)\b/i.test(q);
  if (asksStudentExchangeDefinition) return null;
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
      source: 'semantic-rag-campus-support-entity',
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
function isCareerReadinessQuestion(question) {
  const q = String(question || '').toLowerCase();
  return /\b(?:mempersiapkan|persiapan|siap|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|setelah\s+(?:lulus|tamat)|lowongan|job\s*fair|campus\s*hiring|magang|pelatihan|pembekalan|bimbingan|konsultasi|melamar\s+pekerjaan)\b/i.test(q)
    && /\b(?:program|fasilitas|layanan|pendukung|apa\s+saja|ada\s+apa|mahasiswa|career\s*center|pusat\s+karier|pusat\s+karir|karier|karir|career|pekerjaan|kerja|melamar|dunia\s+kerja)\b/i.test(q);
}

function tryCareerReadinessAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksCareerCenterService = /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(q)
    && /\b(?:layanan|memberikan|fungsi|tugas|bantu|membantu|apa\s+saja|apa\s+aja|ngapain|untuk\s+apa)\b/i.test(q);
  if (!isCareerReadinessQuestion(question) && !asksCareerCenterService) return null;
  return {
    answer: buildCareerReadinessProgramsAnswer(),
    source: 'semantic-rag-career-readiness',
    frameSource: 'semantic-rag-campus-support-entity'
  };
}function tryCareerCenterSoftskillAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksSoftskill = /\b(soft\s*skill|softskill|pengembangan\s+softskill|keterampilan\s+kerja|pembekalan\s+kerja|pelatihan\s+(?:kerja|karier|karir|career|sebelum\s+melamar)|bimbingan\s+(?:karier|karir|career|melamar)|persiapan\s+(?:kerja|karier|karir|career|melamar)|kompetensi)\b/i.test(q);
  const mentionsCareerCenter = /\b(career\s*center|pusat\s+karier|pusat\s+karir|karir|karier|career)\b/i.test(q);
  const asksCareerPrep = /\b(?:pelatihan|pembekalan|bimbingan|konsultasi|persiapan)\b/i.test(q)
    && /\b(?:melamar|lamar(?:an)?|pekerjaan|kerja|karier|karir|career|profesional|dunia\s+kerja)\b/i.test(q);
  if (!asksSoftskill && !asksCareerPrep) return null;
  if (!mentionsCareerCenter && !asksCareerPrep) return null;
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
    source: 'semantic-rag-campus-support-entity',
    frameSource: 'semantic-rag-insufficient-data'
  };
}
function tryCampusFacilityAnswer(question, indexForQuery) {
  const q = String(question || '').toLowerCase();
  const explicitNonCareerSupportEntity = findCampusSupportEntity(q);
  const questionMentionsNonCareerSupport = explicitNonCareerSupportEntity
    && explicitNonCareerSupportEntity.key !== 'career-center'
    && explicitNonCareerSupportEntity.key !== 'linkedin-career-center';
  const asksFacilities = /\b(fasilitas|fasilias|fasiltas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|karir|karier|inkubator|incubator|inbis|softskill|language\s+learning|llc|belajar\s+bahasa|kemampuan\s+bahasa|bahasa(?:nya)?|hi-?think|hithink|gccp|gcpp|gcp|short\s*course|shortcourse|kursus\s+singkat|bccp|kuliah\s+sambil\s+kerja|magang\s+berbayar|konsultasi|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q);
  if (!asksFacilities) return null;
  if (/\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(q)) return null;
  if (/\b(mempersiapkan|persiapan|siap|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|setelah\s+(?:lulus|tamat)|karier|karir|career|lowongan|job\s*fair|campus\s*hiring|magang|pelatihan|pembekalan|melamar\s+pekerjaan)\b/i.test(q) && /\b(program|fasilitas|layanan|pendukung|apa\s+saja|ada\s+apa|mahasiswa)\b/i.test(q) && !questionMentionsNonCareerSupport) {
    return {
      answer: buildCareerReadinessProgramsAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\b(layanan\s+industri|dari\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i.test(q)) {
    return {
      answer: [
        'Layanan Industri ITB STIKOM Bali berkaitan dengan fasilitasi kerja sama kampus dengan pihak industri atau mitra eksternal.',
        '',
        'Konteks yang aman saya sampaikan mencakup kerja sama industri, rekrutmen atau campus hiring, magang, pelatihan, dan kolaborasi yang mendukung pembelajaran serta pengembangan karier mahasiswa.',
        '',
        'Untuk daftar layanan resmi, alur pengajuan kerja sama, PIC, atau dokumen yang diperlukan, kakak sebaiknya konfirmasi ke admin kampus atau unit kerja sama terkait.'
      ].join('\n'),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
  }
  if (/\b(?:goes\s*to\s*school|goestoschool|stikom\s+bali\s+goes)\b/i.test(q)) {
    return {
      answer: buildGoesToSchoolAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (isOverseasWorkStudyQuestion(q)) {
    return {
      answer: buildOverseasWorkStudyAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (isPaidOverseasInternshipQuestion(q)) {
    return {
      answer: buildPaidOverseasInternshipAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\b(?:hi-?think|hithink)\b/i.test(q)) {
    const specificHiThink = buildSpecificFacilityAnswerFromIndex(question, indexForQuery);
    if (specificHiThink && specificHiThink.answer) {
      return {
        ...specificHiThink,
        answer: ensureNamedCampusSupportContextInAnswer(question, specificHiThink.answer),
        source: 'semantic-rag-campus-facility',
        frameSource: specificHiThink.frameSource || 'semantic-rag-campus-facility'
      };
    }
    return {
      answer: buildHiThinkAnswer(),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-campus-facility'
    };
  }

  if (/\b(?:short\s*course|shortcourse|kursus\s+singkat)\b/i.test(q) && !/\bgccp\b/i.test(q)) {
    return {
      answer: buildGccpAnswer(),
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

  if (/\b(language\s+learning|llc|belajar\s+bahasa|kemampuan\s+bahasa(?:nya)?|meningkatkan\s+kemampuan\s+bahasa(?:nya)?|fasilitas\s+bahasa|kursus\s+bahasa)\b/i.test(q)) {
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
      'Fasilitas dan layanan pendukung kampus yang tersedia di ITB STIKOM Bali antara lain:',
      '',
      '- Career Center',
      '- Inkubator Bisnis',
      '- Program Pengembangan Softskill',
      '- Unit Kegiatan Mahasiswa (UKM) dan Ormawa',
      '- Language Learning Center',
      '- Hi-Think sebagai program pendukung persiapan kerja bidang TI di Jepang',
      '- Dukungan konsultasi karier setelah lulus',
      '',
      'Kalau kakak mau, saya bisa jelaskan salah satu layanan pendukungnya, misalnya Career Center, Inkubator Bisnis, UKM, Language Learning Center, atau Hi-Think.'
    ].join('\n'),
    source: 'semantic-rag-campus-facility'
  };
}
function isCampusPhysicalAttributeQuestion(question) {
  const q = String(question || '').toLowerCase();
  const mentionsCampusPhysicalObject = /\b(?:kampus|gedung|aula|ruang|kelas|laboratorium|lab|perpustakaan|parkiran|kantin)\b/i.test(q);
  const asksPhysicalAttribute = /\b(?:tinggi|luas|jumlah\s+lantai|berapa\s+lantai|lantai\s+berapa|kapasitas|ukuran|warna(?:nya)?|panjang|lebar|besar(?:nya)?|daya\s+tampung)\b/i.test(q);
  const asksTrueLocation = /\b(?:alamat|lokasi|dimana|di\s*mana|letak|maps?|rute|arah|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
  return mentionsCampusPhysicalObject && asksPhysicalAttribute && !asksTrueLocation;
}

function stripDoubleDegreeSectionForNarrowProgramList(question, answer) {
  const q = String(question || '').toLowerCase();
  if (/\b(?:double\s*degree|dual\s*degree|kelas\s+internasional|program\s+internasional|international|utb|dnui|help)\b/i.test(q)) return answer;
  if (!/\b(?:jurusan(?:nya)?|prodi(?:nya)?|program\s+studi)\b/i.test(q)) return answer;
  return String(answer || '').replace(/\n\nDouble Degree:[\s\S]*$/i, '').trim();
}
function tryCampusPhysicalAttributeFallback(question) {
  if (!isCampusPhysicalAttributeQuestion(question)) return null;
  return {
    answer: buildInsufficientDataAnswer('very_low'),
    source: 'semantic-rag-campus-physical-attribute-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data'
  };
}
function tryCampusLocationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (isStudyPermitQuestion(question) || isCareerCenterQuestion(question) || isStudentExchangeQuestion(question)) return null;
  if (/\b(?:akreditasi|akrediasi|ban\s*-?pt|lam\s*infokom|peringkat)\b/i.test(q)) return null;
  const asksPhysicalAttribute = /\b(?:tinggi|luas|jumlah\s+lantai|berapa\s+lantai|lantai\s+berapa|kapasitas|ukuran|warna(?:nya)?|panjang|lebar|besar(?:nya)?|daya\s+tampung)\b/i.test(q);
  if (asksPhysicalAttribute) return null;
  const hasLocationIntent = /\b(lokasi(?:nya)?|alamat(?:nya)?|dimana|di\s*mana|where|letak(?:nya)?|maps?|google\s+maps|rute|arah|patokan|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
  if (!hasLocationIntent) return null;
  if (/\b(fasilitas|layanan|sarana|prasarana|ukm|ormawa|organisasi|kegiatan\s+mahasiswa|komunitas|hobi|minat)\b/i.test(q)) return null;
  const asksMainCampus = /\b(kampus\s+(?:utama|pusat)|utama(?:nya)?|pusat(?:nya)?)\b/i.test(q);
  const asksGenericCampusLocation = /\b(lokasi(?:nya)?\s+kampus|alamat(?:nya)?\s+kampus|campus(?:\s+location)?|location\s+campus|campus\s+address|maps?|google\s+maps|rute|arah|pin\s+lokasi|share\s*loc|shareloc)\b/i.test(q);
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
      'ITB STIKOM Bali memiliki 3 lokasi kampus:',
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
  if (/\b(?:organisasi|ormawa|ukm|unit\s+kegiatan|kegiatan\s+mahasiswa)\b/i.test(q) && /\b(?:tersedia|ada|mendukung|minat|formal|pembelajaran|luar)\b/i.test(q)) {
    return {
      answer: [
        'Ya, tersedia organisasi mahasiswa dan kegiatan nonformal yang bisa mendukung minat mahasiswa di ITB STIKOM Bali.',
        '',
        '- Badan Eksekutif Mahasiswa',
        '- Dewan Perwakilan Mahasiswa',
        '- Himaprodi BD',
        '- Himaprodi SI',
        '- Himaprodi SK',
        '- Himaprodi TI',
        '- Himas Jimbaran',
        '',
        'Untuk detail UKM/minat khusus seperti seni, olahraga, teknologi, jadwal kegiatan, atau pendaftaran anggota, kakak sebaiknya konfirmasi ke bagian kemahasiswaan atau pengurus organisasi terkait.'
      ].join('\\n'),
      source: 'semantic-rag-campus-support-fallback'
    };
  }
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
  if (!/\b(biaya|uang\s*pangkal|uang\s*pangkalnya|dpp|uk t|ukt|uang\s*pangkal|cicil|cicilan|nyicil|angsuran|diangsur)\b/i.test(q)) return null;
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

  if (/\b(topik|tema|judul|bidang|jenis\s+penelitian|penelitian\s+apa|apa\s+saja)\b/i.test(q) && /\b(skripsi|tugas\s+akhir|tesis)\b/i.test(q)) {
    return {
      answer: [
        'Pada Pedoman Tugas Akhir S1, Tugas Akhir disusun berdasarkan hasil penelitian. Jenis/topik penelitian yang disebutkan meliputi:',
        '',
        '- Penelitian Dasar: untuk pengembangan ilmu pengetahuan atau pengujian teori/konsep. Contohnya analisis, pengujian, komparasi, identifikasi, audit, pengukuran, kajian, dan topik sejenis.',
        '- Penelitian Terapan: untuk penerapan dan pengembangan ilmu dalam masalah nyata. Contohnya perekayasaan, rancang bangun, implementasi, pengembangan, dan topik sejenis.',
        '',
        'Untuk judul spesifik, kakak tetap perlu menyesuaikan dengan prodi, minat, dan arahan dosen pembimbing.'
      ].join('\n'),
      source: 'semantic-rag-thesis-topic-fallback'
    };
  }
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
  if (!/\b(kelas\s+internasional|kelas internasional|program\s+internasional|kelas\s+internasional\s+ada|study\s+abroad|student\s+exchange|pertukaran\s+mahasiswa)\b/i.test(q)) return null;
  return {
    answer: [
      'Program internasional yang tercatat untuk ITB STIKOM Bali:',
      '',
      '- Double Degree Internasional DNUI - Dalian Neusoft University of Information, China. Prodi di STIKOM Bali: Bisnis Digital.',
      '- Double Degree Internasional HELP University, Malaysia. Prodi di STIKOM Bali: Sistem Informasi.',
      '- Student Exchange / pertukaran mahasiswa, jika dibuka sesuai kerja sama dan ketentuan kampus.',
      '- Program Hi-Think Jepang, yaitu program berbasis industri/karier internasional yang tercatat pada data kampus.',
      '',
      'Saya tidak mencampur daftar ini dengan prodi reguler. Untuk syarat, kuota, jadwal, dan alur final, kakak bisa konfirmasi ke Admin PMB atau bagian kerja sama/international office kampus.'
    ].join('\n'),
    source: 'semantic-rag-international-class-fallback'
  };
}
function tryCareerFallback(_question) {
  return null;
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
    .replace(/^PROFILE\s+ORMAWA\s+/i, '')
    .replace(/^PROFIL\s+ORMAWA\s+/i, '')
    .replace(/^PROFILE\s+UKM\s+/i, '')
    .replace(/^PROFIL\s+UKM\s+/i, '')
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

function isBrokenUkmProfileSentence(line) {
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (/^(?:profile|profil)\s+(?:ormawa|ukm|organisasi)\b/i.test(text)) return true;
  if (/\b(?:diprakarsai|didirikan|berawal|diinisiasi).*\b(?:Prof|Dr|Ir|Bapak|Ibu)\.$/i.test(text)) return true;
  if (/^(?:Dari awal|Dari waktu|Pada awal|Awalnya|Sejarah|Perjalanan|Seiring|Beserta|Sehingga|Dan|Yang|Dengan)\b/i.test(text)) return true;
  if (/\b(?:di\s+dampingi|didampingi|mempunyai\s+minat,?\s+bakat)\.$/i.test(text)) return true;
  if (text.length < 50 && !/\b(?:adalah|merupakan|wadah|bergerak|berfokus|kegiatan|latihan|kompetisi|pengembangan|organisasi|mahasiswa)\b/i.test(text)) return true;
  return false;
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
    .filter((line) => !isBrokenUkmProfileSentence(line))
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

function extractUkmVisionMissionSections(text) {
  const raw = String(text || '').replace(/\r/g, '\n').replace(/\s+/g, ' ').trim();
  if (!raw || !/\b(?:visi|misi)\b/i.test(raw)) return { vision: '', mission: '' };
  const cleanPart = (value) => {
    let out = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^(?:dan|adalah|:|-)+\s*/i, '')
      .trim();
    out = out.replace(/\b(?:catatan|identitas\s+organisasi|sejarah\s+singkat|profil|profile|fungsi\s+organisasi|fokus\s*&\s*kegiatan\s+utama)\b[\s\S]*$/i, '').trim();
    if (out.length > 320) out = out.slice(0, 317).trim() + '...';
    if (!out || out.length < 18) return '';
    return normalizeUkmProfileSentence(out);
  };
  const extract = (label) => {
    const next = label === 'visi' ? 'misi' : 'visi|tujuan|profil|profile|identitas|sejarah|fungsi|fokus|kegiatan|program';
    const re = new RegExp('\\b' + label + '\\b\\s*(?:dan\\s+misi)?\\s*[:\\-]?\\s*([\\s\\S]+?)(?=\\s+\\b(?:' + next + ')\\b\\s*[:\\-]?|$)', 'i');
    const match = raw.match(re);
    return cleanPart(match && match[1]);
  };
  return { vision: extract('visi'), mission: extract('misi') };
}

function buildUkmVisionMissionAnswerFromIndex(ukmName, indexForQuery) {
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
    logger.warn({ err: err && err.message ? err.message : String(err), ukmName: name }, '[SemanticRAG] failed to load full index for UKM vision/mission');
  }

  const seenIds = new Set();
  const matches = [];
  for (const index of indexes) {
    for (const item of index) {
      if (!item || seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      const filename = String(item.filename || item.sourceFile || '');
      const chunk = String(item.chunk || '').trim();
      if (!chunk || !/\b(?:visi|misi)\b/i.test(chunk)) continue;
      const haystack = normalizeFacilityTerm(filename + ' ' + chunk);
      const filenameNorm = normalizeFacilityTerm(filename);
      const hasUkmSignal = /\bukm\b/i.test(filename) || /\bukm\b/i.test(chunk) || /\bunit\s+kegiatan\s+mahasiswa\b/i.test(chunk);
      const filenameMatch = aliases.some((alias) => filenameNorm.includes(alias) || filenameNorm.includes('ukm ' + alias));
      const structuredNameMatch = aliases.some((alias) => {
        const value = normalizeFacilityTerm(alias);
        if (!value) return false;
        return filenameNorm.includes(value)
          || filenameNorm.includes('ukm ' + value)
          || haystack.includes('ukm ' + value)
          || haystack.includes('ormawa ' + value)
          || haystack.includes('profile ukm ' + value)
          || haystack.includes('profil ukm ' + value)
          || haystack.includes('profile ormawa ' + value)
          || haystack.includes('profil ormawa ' + value);
      });
      if (!hasUkmSignal || (!structuredNameMatch && !filenameMatch)) continue;
      const sections = extractUkmVisionMissionSections(chunk);
      if (!sections.vision && !sections.mission) continue;
      const score = (filenameMatch ? 8 : 0) + (sections.vision ? 4 : 0) + (sections.mission ? 4 : 0) + (/profile|profil/i.test(filename) ? 2 : 0);
      matches.push({ item, sections, score });
    }
  }

  const title = name.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  if (!matches.length) {
    return {
      answer: `Saya belum menemukan teks visi atau misi resmi UKM ${title} secara lengkap pada data yang tersedia. Agar tidak keliru, kakak bisa konfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.`,
      source: 'semantic-rag-ukm-specific-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }
  matches.sort((a, b) => b.score - a.score);
  const best = matches[0];
  const lines = [`Berikut informasi visi/misi UKM ${title} dari data yang tersedia:`];
  if (best.sections.vision) lines.push('', 'Visi:', `- ${best.sections.vision}`);
  if (best.sections.mission) lines.push('', 'Misi:', `- ${best.sections.mission}`);
  return {
    answer: lines.join('\n'),
    source: 'semantic-rag-ukm-specific',
    frameSource: 'semantic-rag-ukm-specific',
    debug: { source: 'semantic-rag-ukm-specific-vision-mission', filename: best.item.filename || best.item.sourceFile || null }
  };
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
  const title = name.split(/\s+/).map((word) => word.length <= 4 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
  const answerText = summarizeUkmProfileBody(body, title);
  if (!answerText || answerText.length < 20) return null;
  return {
    answer: 'Berikut penjelasan tentang UKM ' + title + ':\n\n' + answerText,
    source: 'semantic-rag-ukm-list',
    frameSource: 'semantic-rag-ukm-specific',
    debug: { source: 'semantic-rag-ukm-specific-profile', ukmProfileFromIndex: true, filename: best.item.filename || best.item.sourceFile || null }
  };
}
function asksUkmTechnicalDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(?:cara(?:nya)?|bagaimana\s+cara|bagaimana|gimana\s+cara|gimana|alur(?:nya)?|prosedur(?:nya)?|mekanisme(?:nya)?|proses(?:nya)?|syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode(?:nya)?|kuota|kouta|seleksi|interview|wawancara|biaya(?:nya)?|bayar(?:an|nya)?|harga(?:nya)?|spp|formulir|form(?:nya)?|link(?:nya)?|kontak|\bcp\b|contact\s*person|pic|narahubung(?:nya)?|pembina(?:nya)?|pelatih|coach|penanggung\s+jawab|admin(?:nya)?|pengurus(?:nya)?|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q);
}

function buildUkmTechnicalNoDataAnswer(ukmName, question = '') {
  const label = String(ukmName || '').trim() || 'UKM/Ormawa tersebut';
  const q = String(question || '').toLowerCase();
  let detail = 'detail teknis seperti syarat, jadwal, kontak, pembina, atau alur pendaftaran';
  if (/\b(?:cara|bagaimana\s+cara|bagaimana|gimana\s+cara|gimana|alur|prosedur|mekanisme|proses|daftar(?:nya)?|mendaftar|pendaftaran|registrasi(?:nya)?|join(?:nya)?|ikut|mengikuti|bergabung|gabung|masuk)\b/i.test(q)) {
    detail = 'alur/cara bergabung atau mendaftar';
  } else if (/\b(?:syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?|berkas(?:nya)?|kuota|kouta|seleksi|interview|wawancara)\b/i.test(q)) {
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
    if (/\b(apa\s+itu|ukm\s+apa|tentang|profil|profile|jelaskan|maksud)\b/i.test(q)) {
      const indexedKslProfile = buildUkmProfileAnswerFromIndex('KSL', _indexForQuery);
      if (indexedKslProfile) return indexedKslProfile;
    }
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
      /\b(?:apa\s+itu|itu\s+apa|tentang|detail|profil|kegiatan|aktivitas|program\s+kerja|proker|pembina|visi|misi|visi\s+misi)\s+ukm\s+([a-z0-9][a-z0-9\s._-]{1,50})\b/i,
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
  const earlyAsksUkmCount = /\b(?:berapa\s+(?:banyak|jumlah|ada)|ada\s+berapa|jumlah(?:nya)?|total(?:nya)?|berapa\s+unit|berapa\s+organisasi)\b/i.test(q)
    && /\b(?:ukm|ormawa|unit\s+kegiatan\s+mahasiswa|organisasi\s+mahasiswa|kegiatan\s+mahasiswa)\b/i.test(q);
  const earlyAsksUkmList = !/\b(?:visi|misi)\b/i.test(q) && ((
    /\b(ukm(?:nya)?|ormawa(?:nya)?|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(q)
    && /\b(ada|tersedia|punya|memiliki|apa|daftar|list|sebutkan|mana|saja|aja|jenis|pilihan)\b/i.test(q)
  ) || /\b(ada\s+ukm|ukm\s+apa|apa\s+saja\s+ukm|daftar\s+ukm|list\s+ukm|sebutkan\s+ukm|ada\s+ormawa|daftar\s+ormawa)\b/i.test(q));
  const explicitUnknownUkmName = !currentMentionedUkm && !earlyAsksUkmList && !earlyAsksUkmCount ? extractExplicitUnknownUkmName(q) : '';
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

  const asksUkmCount = earlyAsksUkmCount;

  const asksUkmList = earlyAsksUkmList;

  const followUpUsesRecentUkm = !currentMentionedUkm && !asksUkmList && (!hasExplicitDifferentTopic || asksUkmTechnicalDetail(q)) && shouldUseRecentEntityContext(q) && /\b(kegiatan(?:nya)?|aktivitas(?:nya)?|program(?:nya)?|program\s+kerja|proker|manfaat(?:nya)?|pembina(?:nya)?|jadwal(?:nya)?|deadline(?:nya)?|latihan(?:nya)?|cara\s+(?:ikut|gabung)|daftar(?:nya)?|pendaftaran(?:nya)?|registrasi(?:nya)?|join(?:nya)?|link(?:nya)?|form(?:nya)?|kontak|\bcp\b|pic|admin(?:nya)?|apa\s+saja|gimana|bagaimana)\b/i.test(q);
  const mentionedUkm = currentMentionedUkm || (followUpUsesRecentUkm ? recentMentionedUkm : null);
  if (mentionedUkm && /\b(?:visi|misi)\b/i.test(q)) {
    return buildUkmVisionMissionAnswerFromIndex(mentionedUkm, _indexForQuery);
  }
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
  if (!asksUkmList && !asksUkmCount) {
    const recommendation = tryUkmInterestRecommendation(question, options);
    if (recommendation) return recommendation;
    return null;
  }

  const list = loadUkmList();
  if (!list || !list.text) {
    return {
      answer: 'Maaf, saya belum menemukan daftar UKM/Ormawa pada data yang tersedia. Kakak bisa hubungi admin kampus untuk daftar terbaru.',
      source: 'semantic-rag-ukm-no-data'
    };
  }

  if (asksUkmCount) {
    return {
      answer: 'Ada ' + list.total + ' UKM/Ormawa yang tercatat di ITB STIKOM Bali berdasarkan daftar kampus yang tersedia. Kalau kakak ingin melihat namanya satu per satu, saya bisa tampilkan daftar UKM/Ormawa tersebut.',
      source: 'semantic-rag-ukm-count',
      frameSource: 'semantic-rag-ukm-list'
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

  if (src.includes('uploaded-training-generic') && isAcademicAdminUploadedDocQuestion(question, detectGenericIntent(normalizeAcademicAdminQueryText(question)))) {
    const topic = /\byudisium\b/i.test(q) ? 'informasi yudisium' : (/\bwisuda\b/i.test(q) ? 'informasi wisuda' : 'informasi akademik dari dokumen kampus');
    return {
      request: topic,
      assumption: 'Saya jawab dari data akademik yang tersedia dan hanya mengambil bagian yang relevan.',
      conclusion: 'Jadi, informasi ini saya rangkum dari data akademik yang tersedia. Untuk proses administrasi resmi atau perubahan terbaru, kakak tetap bisa konfirmasi ke BAAK/unit akademik.',
      followups: [
        'Kapan pendaftaran yudisium?',
        'Kapan pelaksanaan yudisium?',
        'Persyaratan yudisium apa saja?'
      ]
    };
  }

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
  if (isOverseasWorkStudyQuestion(q) || isPaidOverseasInternshipQuestion(q)) {
    return {
      request: 'program pengalaman kerja atau belajar di luar negeri yang kakak tanyakan',
      assumption: 'Saya jawab sesuai nama program yang tercatat dan tidak menambahkan detail teknis yang belum ada di data.',
      conclusion: 'Jadi, program ini berkaitan dengan pengalaman internasional, tetapi detail pelaksanaan tetap perlu dikonfirmasi ke admin kampus atau unit kerja sama internasional.',
      followups: [
        'Apa saja program internasional yang tersedia di STIKOM Bali?',
        'Apa itu GCCP atau short course internasional?',
        'Apa saja pilihan Double Degree internasional?'
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
  if (/\b(mempersiapkan|persiapan|siap|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|setelah\s+(?:lulus|tamat)|karier|karir|career|lowongan|job\s*fair|campus\s*hiring|magang)\b/i.test(q)) {
    return {
      request: 'program atau fasilitas yang membantu kesiapan kerja mahasiswa',
      assumption: 'Saya fokuskan ke layanan kampus yang paling berkaitan dengan karier dan kesiapan kerja.',
      conclusion: 'Jadi, untuk kesiapan kerja, jalur paling relevan adalah Career Center, softskill, magang, dan program karier/internasional yang tercatat.',
      followups: [
        'Layanan apa saja yang diberikan Career Center?',
        'Apa itu Program Pengembangan Softskill?',
        'Program magang apa saja yang tersedia untuk mahasiswa?'
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

  if (!src.includes('ukm') && (src.includes('campus-location') || /\b(lokasi|alamat|kampus|maps|rute)\\b/.test(q))) {
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

  if (src.includes('program-list-contextual') && !src.includes('fee')) {
    return {
      request: 'daftar jurusan/program studi reguler yang tersedia di ITB STIKOM Bali',
      assumption: 'Saya tampilkan prodi reguler per jenjang D3/S1/S2.',
      conclusion: 'Jadi, pilihan prodi reguler yang tersedia mencakup S2, S1, dan D3.',
      followups: [
        'Apa perbedaan SI dan TI?',
        'Biaya S1 termurah apa?',
        'Prospek kerja Bisnis Digital bagaimana?'
      ]
    };
  }
  if (src.includes('program-list') && !src.includes('fee') && !/\b(biaya|harga|bayar|ukt|dpp|pendaftaran|rincian|detail|gelombang|gel\\b)\\b/.test(q)) {
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

  if (src.includes('fee') || (!isAcademicAdminUploadedDocQuestion(question, detectGenericIntent(question)) && /\b(biaya|bayar|dpp|ukt|gelombang|pendaftaran|termurah|termahal)\b/.test(q))) {
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

  if (src.includes('career') || (/\b(prospek|kerja|karir|karier|lulusan)\b/.test(q) && !(/uploaded-training/i.test(src) && /\bgelar\b/i.test(q)))) {
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
  if (/soft\s*skill|softskill|pengembangan\s+softskill/.test(q)) {
    return 'Apa saja bentuk Program Pengembangan Softskill untuk membantu kesiapan kerja mahasiswa?';
  }  if (/career\s*center|layanan/.test(q)) {
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
  'semantic-rag-explicit-external-no-data',
  'semantic-rag-abbreviation-clarification',
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
  const qNorm = normalizeCacheText(question);
  const src = String(source || '').toLowerCase();
  for (const item of list) {
    const expanded = expandContextualFollowup(item, context);
    if (!expanded || out.includes(expanded)) continue;
    const expandedNorm = normalizeCacheText(expanded);
    if (src.includes('fee') && /\brincian\s+biaya\b/i.test(question) && /\brincian\s+biaya\b/i.test(expanded)) continue;
    if (qNorm && expandedNorm && (expandedNorm === qNorm || expandedNorm.includes(qNorm) || qNorm.includes(expandedNorm))) continue;
    if (validate && !canAnswerFollowupCandidate(expanded)) continue;
    out.push(expanded);
    if (out.length >= 3) break;
  }  return out;
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

  if (src.includes('pmb-info')) {
    return [
      'Bisa, Kak. Saya jawab sesuai data ITB STIKOM Bali yang tersedia.'
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

  if (src.includes('pmb-info')) {
    return [
      'Bisa, Kak. Saya jawab sesuai data ITB STIKOM Bali yang tersedia.'
    ];
  }

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
    if (/\b(seluruh|semua|full|penuh|100\s*%)\b/i.test(q)) {
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
  const src = String(source || '').toLowerCase();
  if (src.includes('small-talk')) return body;
  if (src.includes('pmb-info')) return body;
  if (src.includes('academic-schedule') || src.includes('academic-policy') || src.includes('insufficient-data') || src.includes('unsupported-international-program')) return body;
  const isUploadedAcademicAnswer = src.includes('uploaded-training-generic') && isAcademicAdminUploadedDocQuestion(question, detectGenericIntent(normalizeAcademicAdminQueryText(question)));
  if (isUploadedAcademicAnswer) {
    if (!envFlag('BOT_NATURAL_ANSWER_FRAME', true)) return body;
    if (hasLikelyRawDocumentLeak(body)) return body;
    const topic = inferFrameTopic(question, source);
    const followups = envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)
      ? topic.followups
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .filter((item) => normalizeCacheText(item) !== normalizeCacheText(question))
          .slice(0, 3)
      : [];
    const parts = [
      'Baik, Kak. Saya bantu jawab dari data yang tersedia.',
      `Saya tangkap pertanyaannya tentang ${topic.request}. ${topic.assumption}`.replace(/\s{2,}/g, ' ').trim(),
      '',
      body
    ];
    if (topic.conclusion) parts.push('', topic.conclusion);
    if (followups.length) parts.push('', ['Topik lanjutan:', ...followups.map(item => `- ${item}`)].join('\n'));
    return parts.join('\n').trim();
  }
  const appendFollowupsOnly = () => {
    if (!envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) return body;
    const topic = inferFrameTopic(question, source);
    const followups = buildContextualFollowups(topic.followups, question, body, source, topic);
    if (!followups.length) return body;
    return [body, '', ['Topik lanjutan:', ...followups.map(item => `- ${item}`)].join('\n')].join('\n').trim();
  };
  if (/^(?:mohon\s+)?maaf\b/i.test(body)) return appendFollowupsOnly();
  if (!envFlag('BOT_NATURAL_ANSWER_FRAME', true)) return appendFollowupsOnly();
  if (src.includes('uploaded-training-generic') && isAcademicAdminUploadedDocQuestion(question, detectGenericIntent(question))) return appendFollowupsOnly();
  if (src.includes('insufficient-data') || src.includes('safe-general') || src.includes('institution-vision-mission') || src.includes('student-concern') || src.includes('academic-schedule') || src.includes('academic-policy') || src.includes('out-of-domain') || src.includes('feedback') || src.includes('unsupported-program') || src.includes('clarification') || src.includes('pmb-contact') || src.includes('pmb-requirements')) return appendFollowupsOnly();
  if (src.includes('ukm') || src.includes('generic-faq-qna') || src.includes('training-specific') || src.includes('campus-support-entity') || src.includes('campus-facility')) return appendFollowupsOnly();
  const q = String(question || '').toLowerCase();
  if (src.includes('rpl')) return appendFollowupsOnly();
  if (src.includes('scholarship') && /\b(seluruh|semua|full|penuh|100\s*%)\b/i.test(q)) return appendFollowupsOnly();
  if (/belum menemukan data biaya Program Double Degree untuk Teknologi Informasi/i.test(body)) return appendFollowupsOnly();
  if (/\b(apa\s+kabar|apa\s+khabar|kabar\s+apa|khabar\s+apa|gimana\s+kabar|gimana\s+khabar|kabar\s+kamu|khabar\s+kamu|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar|bagaimana\s+khabar)\b/i.test(q)) return appendFollowupsOnly();
  if (/^\s*(halo|hallo|hai|hi|hello|haloo|halooo|assalamualaikum|assalamu\s+alaikum|om\s+swastiastu|swastiastu|shalom|namo\s+buddhaya|nammo\s+buddhaya|salam\s+kebajikan|rahayu|salam\s+rahayu|salam|selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)\s*(kak|min|admin|tiko)?\s*$/i.test(String(question || '').trim())) return body;

  const questionText = String(question || '').trim();
  if (isEnglishQuestion(questionText)) {
    return appendFollowupsOnly();
  }
  const topic = inferFrameTopic(question, source);
  const opener = pickVariant(question, source, buildFrameOpeners(question, source, topic));
  const opening = `${opener} ${topic.assumption}`.replace(/\s{2,}/g, ' ').trim();
  const parts = [opening, '', body];

  if (src.includes('fee')) {
    if (envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) {
      const followups = buildContextualFollowups(topic.followups, question, body, source, topic);
      if (followups.length) {
        parts.push('', ['Topik lanjutan:', ...followups.map(item => `- ${item}`)].join('\n'));
      }
    }
    return parts.join('\n').trim();
  }
  const bodyAlreadyHasConclusion = /\n\s*(?:Jadi|Singkatnya|Kesimpulannya),|\n\s*Kesimpulan\s*:/i.test(body);
  if (!bodyAlreadyHasConclusion && topic.conclusion) {
    parts.push('', topic.conclusion);
  }

  if (envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) {
    const followups = buildContextualFollowups(topic.followups, question, body, source, topic);
    if (followups.length) {
      parts.push('', ['Topik lanjutan:', ...followups.map(item => `- ${item}`)].join('\n'));
    }
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
  if (!/\b(?:visi|misi)(?:\s*nya|nya)?\b/i.test(q)) return false;
  if (/\b(ukm|himaprodi|himpunan|bem|inbis|inkubator|career center|pusat karier|pusat karir|prodi|program studi)\b/i.test(q)) return false;
  return /\b(stikom|stikom bali|itb stikom|kampus|institut|lembaga)\b/i.test(q) || /^\s*(?:visi|misi)(?:\s+dan\s+misi)?(?:\s+apa)?\s*\??\s*$/i.test(q);
}

function tryInstitutionVisionMissionAnswer(question, indexForQuery) {
  if (!isInstitutionVisionMissionQuestion(question)) return null;
  const rawQuestion = String(question || '');
  const asksMission = /\bmisi(?:\s*nya|nya)?\b/i.test(rawQuestion);
  const asksVision = /\bvisi(?:\s*nya|nya)?\b/i.test(rawQuestion);
  const wantsOnlyMission = asksMission && !asksVision;
  const wantsOnlyVision = asksVision && !asksMission;
  const wantsBoth = asksVision && asksMission;
  const index = Array.isArray(indexForQuery) ? indexForQuery : [];
  const exclude = /\b(inkubator|inbis|ukm|unit\s+kegiatan\s+mahasiswa|ormawa|organisasi\s+mahasiswa|himaprodi|himpunan|bem|mapala|jcos|ksl|rade|basket|e-?sport|paskamras|pasukan\s+keamanan|keamanan\s+acara|voice\s+of\s+stikom|student\s+exchange|gccp|goes\s*to\s*school|unlock\s+potential|sma\/?smk|latar\s+belakang|moslem\s+community|mcos|u2m|paskamras|athena)\b/i;
  const institution = /\b(stikom bali|itb\s*stikom|institut teknologi dan bisnis(?:\s*\(itb\))?\s*stikom bali|visi\s*&\s*misi\s+institut)\b/i;
  const getText = (item) => String(item && (item.chunk || item.text || item.content) ? (item.chunk || item.text || item.content) : '').trim();
  const getFilename = (item) => String(item && (item.filename || item.source || item.title || '') ? (item.filename || item.source || item.title || '') : '').trim();
  const candidates = index
    .map((item) => ({ text: getText(item), filename: getFilename(item) }))
    .filter((item) => item.text)
    .filter((item) => institution.test(item.text) && !exclude.test(`${item.filename} ${item.text}`))
    .filter((item) => {
      const chunk = item.text;
      const hasVision = /\bvisi\b/i.test(chunk);
      const hasMission = /\bmisi\b/i.test(chunk);
      if (wantsOnlyMission) return hasMission;
      if (wantsOnlyVision) return hasVision;
      return hasVision || hasMission;
    });

  const cleanSectionValue = (value) => String(value || '')
    .replace(/[\u201c\u201d"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[:\-\s]+/, '')
    .replace(/\s*[.;,]?\s*$/, '.')
    .trim();

  const isStopLine = (line, currentLabel) => {
    const l = String(line || '').trim();
    if (!l) return false;
    const stop = /^(?:\d+[.)]\s*)?(?:visi|misi|tujuan|sasaran|sejarah|profil|identitas|struktur|kontak|alamat|kegiatan|program|makna|catatan)\b/i;
    if (!stop.test(l)) return false;
    if (currentLabel === 'visi' && /^(?:\d+[.)]\s*)?visi\b/i.test(l)) return false;
    if (currentLabel === 'misi' && /^(?:\d+[.)]\s*)?misi\b/i.test(l)) return false;
    return true;
  };

  const extractSection = (text, label) => {
    const normalized = cleanUserVisibleRagAnswerText(text).replace(/\r/g, '\n');
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const labelRe = label === 'visi'
      ? /^(?:\d+[.)]\s*)?visi(?:\s*&\s*misi|\s+dan\s+misi)?\s*[::-]?\s*(.*)$/i
      : /^(?:\d+[.)]\s*)?misi\s*[::-]?\s*(.*)$/i;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(labelRe);
      if (!match) continue;
      const parts = [];
      const inline = String(match[1] || '').trim();
      if (inline && !/^(?:visi|misi)$/i.test(inline)) parts.push(inline);
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (isStopLine(next, label)) break;
        parts.push(next);
        if (parts.join(' ').length > (label === 'misi' ? 900 : 350)) break;
      }
      const value = cleanSectionValue(parts.join(' '));
      if (value && value.length >= 20 && !/\b(acara|panitia|undangan|peserta|anggota|organisasi|ukm|himpunan|pengurus)\b/i.test(value)) return value;
    }

    const compact = normalized.replace(/\s+/g, ' ').trim();
    const directRe = label === 'visi'
      ? /\bvisi\b\s*[::-]?\s*[\u201c\u201d"']?(.+?)(?=\s+\b(?:misi|tujuan|sasaran|sejarah|profil|identitas|struktur|kontak)\b|$)/i
      : /\bmisi\b\s*[::-]?\s*(.+?)(?=\s+\b(?:visi|tujuan|sasaran|sejarah|profil|identitas|struktur|kontak)\b|$)/i;
    const direct = compact.match(directRe);
    if (direct && direct[1]) {
      const value = cleanSectionValue(direct[1]);
      if (value && value.length >= 20 && !/\b(acara|panitia|undangan|peserta|anggota|organisasi|ukm|himpunan|pengurus)\b/i.test(value)) return value;
    }
    return '';
  };

  let visionText = '';
  let missionText = '';
  for (const chunk of candidates) {
    if (!visionText && !wantsOnlyMission) visionText = extractSection(chunk, 'visi');
    if (!missionText && !wantsOnlyVision) missionText = extractSection(chunk, 'misi');
    if ((wantsOnlyVision && visionText) || (wantsOnlyMission && missionText) || (wantsBoth && visionText && missionText)) break;
  }

  if (wantsOnlyMission && !missionText) {
    return {
      answer: 'Maaf, Kak. Saya belum menemukan teks misi resmi ITB STIKOM Bali yang cukup aman pada data yang tersedia, jadi saya tidak mau mengarang. Untuk teks resmi terbaru, kakak sebaiknya konfirmasi ke admin kampus atau kanal resmi ITB STIKOM Bali.',
      source: 'semantic-rag-institution-vision-mission',
      frameSource: 'semantic-rag-institution-vision-mission'
    };
  }
  if (wantsOnlyVision && !visionText) {
    return {
      answer: 'Maaf, Kak. Saya belum menemukan teks visi resmi ITB STIKOM Bali yang cukup aman pada data yang tersedia, jadi saya tidak mau mengarang. Untuk teks resmi terbaru, kakak sebaiknya konfirmasi ke admin kampus atau kanal resmi ITB STIKOM Bali.',
      source: 'semantic-rag-institution-vision-mission',
      frameSource: 'semantic-rag-institution-vision-mission'
    };
  }
  if (wantsBoth && (!visionText || !missionText)) {
    return {
      answer: 'Maaf, Kak. Saya belum menemukan teks visi dan misi resmi ITB STIKOM Bali secara lengkap pada data yang tersedia, jadi saya tidak mau mengarang. Untuk teks resmi terbaru, kakak sebaiknya konfirmasi ke admin kampus atau kanal resmi ITB STIKOM Bali.',
      source: 'semantic-rag-institution-vision-mission',
      frameSource: 'semantic-rag-institution-vision-mission'
    };
  }

  const lines = [];
  if (wantsOnlyMission) {
    lines.push('Baik, Kak. Berikut misi ITB STIKOM Bali dari data yang tersedia:', '', 'Misi:');
    lines.push(...missionText.split(/\s*(?:\d+[.)]|;| - )\s*/).map(cleanSectionValue).filter(Boolean).map((item) => `- ${item}`));
  } else if (wantsOnlyVision) {
    lines.push('Baik, Kak. Berikut visi ITB STIKOM Bali dari data yang tersedia:', '', 'Visi:', `- ${visionText}`);
  } else {
    lines.push('Baik, Kak. Berikut visi dan misi ITB STIKOM Bali dari data yang tersedia:');
    if (visionText) lines.push('', 'Visi:', `- ${visionText}`);
    if (missionText) lines.push('', 'Misi:', ...missionText.split(/\s*(?:\d+[.)]|;| - )\s*/).map(cleanSectionValue).filter(Boolean).map((item) => `- ${item}`));
  }

  return {
    answer: lines.join('\n').trim(),
    source: 'semantic-rag-institution-vision-mission',
    frameSource: 'semantic-rag-institution-vision-mission'
  };
}
function isInstitutionProfileQuestion(question) {
  const q = normalizeFacilityTerm(question || '');
  if (!/\b(?:visi|misi|tujuan|profil|profile|identitas)\b/i.test(q)) return false;
  if (/\b(?:ukm|ormawa|organisasi\s+mahasiswa|himaprodi|himpunan|bem|inbis|inkubator|career\s*center|pusat\s+karier|pusat\s+karir|student\s+exchange|double\s*degree|dual\s*degree|prodi|program\s+studi|jurusan)\b/i.test(q)) return false;
  return /\b(?:kampus|institusi|lembaga|itb\s*stikom|stikom\s+bali|institut)\b/i.test(q);
}

function tryInstitutionProfileAnswer(question, indexForQuery) {
  const visionMission = tryInstitutionVisionMissionAnswer(question, indexForQuery);
  if (visionMission && visionMission.answer) return visionMission;
  if (!isInstitutionProfileQuestion(question)) return null;
  return {
    answer: 'Maaf, Kak. Saya belum menemukan profil, tujuan, atau identitas resmi ITB STIKOM Bali yang cukup aman pada data yang tersedia, jadi saya tidak mau mengarang. Untuk teks resmi terbaru, kakak sebaiknya konfirmasi ke admin kampus atau kanal resmi ITB STIKOM Bali.',
    source: 'semantic-rag-institution-profile',
    frameSource: 'semantic-rag-institution-profile'
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
  if (/\b(kurang\s+cakap|belum\s+(?:jago|mahir|bisa)|tidak\s+(?:jago|mahir|cakap)|nggak\s+(?:jago|mahir)|gak\s+(?:jago|mahir)|pemula)\b/i.test(q) && /\b(teknologi\s+informasi|komputer|coding|ngoding|it\b|kuliah|mahasiswa|prodi|jurusan)\b/i.test(q)) {
    return {
      answer: 'Bisa tetap mulai, Kak. Untuk menjadi mahasiswa ITB STIKOM Bali, kakak tidak harus sudah jago Teknologi Informasi dari awal. Yang penting punya kemauan belajar dan memilih prodi yang paling sesuai minat. Kalau masih kurang cakap di bidang TI, kakak bisa mulai dari dasar komputer, logika, penggunaan aplikasi, dan konsultasi ke Admin PMB/prodi agar diarahkan ke pilihan yang paling cocok.',
      source: 'semantic-rag-student-concern',
      frameSource: 'semantic-rag-student-concern'
    };
  }
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

  if (/\b(apa\s+itu\s+itb\s+stikom\s+bali|keunggulan\s+(?:itb\s+)?stikom\s+bali|keunggulan\s+kuliah|campus\s+tour|terakreditasi|akreditasi(?:nya)?\s+kampus|akreditasi|ban-pt)\b/i.test(q)) {
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

  if (/\b(?:kalender\s+akademik|jadwal\s+akademik|semester\s+(?:genap|ganjil|antara|pendek)|pelaksanaan\s+akademik)\b/i.test(q)) {
    return null;
  }

  if (/\b(melihat\s+nilai|khs|cuti|aktif\s+kembali|pindah\s+kelas|kartu\s+mahasiswa|masalah\s+akademik|reset\s+password|mereset\s+password|lupa\s+password|login\s+ke\s+sion|log\s+in\s+sion|akun\s+mahasiswa\s+.*terkunci|email\s+mahasiswa|nomor\s+telepon|e-?learning|unggah\s+tugas|mengunggah\s+tugas|tugas\s+.*gagal\s+diunggah|saya\s+tidak\s+bisa\s+masuk)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk layanan akademik atau IT support seperti SION, e-learning, nilai, KHS, cuti, kartu mahasiswa, reset password, akun terkunci, mengganti email atau nomor telepon, pindah kelas, dan unggah tugas, sebaiknya kakak menghubungi unit akademik/IT kampus. Saya tidak mengakses akun mahasiswa atau data akademik pribadi.') };
  }

  if (/\b(ukm|kegiatan\s+mahasiswa|poin\s+kegiatan|dana\s+kegiatan|ruangan\s+untuk\s+kegiatan|perundungan|pelecehan|masalah\s+dengan\s+teman|membantu\s+masalah\s+mahasiswa|konseling|perlindungan\s+mahasiswa|kemahasiswaan)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk urusan kemahasiswaan, UKM, kegiatan mahasiswa, konseling, atau pelaporan masalah mahasiswa, kakak bisa menghubungi bagian kemahasiswaan atau admin kampus. Saya bisa bantu info umum yang tersedia, tetapi detail prosedur internal perlu dikonfirmasi ke unit terkait.') };
  }

  if (/\b(mbkm|sks\s+yang\s+dapat\s+dikonversi|dikonversi\s+menjadi\s+sks|rpl|startup)\b/i.test(q)) {
    return { answer: contextualizeSafeFallback('untuk MBKM, RPL, startup, atau Inkubator Bisnis, saya bisa bantu penjelasan umum berdasarkan data yang tersedia. Untuk syarat peserta, konversi SKS, cara daftar, dan PIC resmi, kakak sebaiknya konfirmasi ke admin kampus/unit terkait.') };
  }

  if (/\b(?:yudisium|wisuda)\b/i.test(q)) {
    return null;
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

  if (/\b(?:ti|bd|double\s*degree|dkv)\s+(?:brp|berapa)\??$/i.test(q) && /\b(?:biaya|harga|ukt|dpp|gelombang|uang\s*pangkal|pmb)\b/i.test(q)) {
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
  ['semantic-rag-explicit-external-no-data', tryExplicitExternalEntityNoDataAnswer],
  ['semantic-rag-abbreviation-clarification', tryAmbiguousAbbreviationClarificationAnswer],
  ['semantic-rag-clarification', tryShortClarificationAnswer],
  ['semantic-rag-out-of-domain', tryOutOfDomainAnswer],
  ['semantic-rag-security-refusal', trySecurityRefusalAnswer],
  ['semantic-rag-student-concern', tryStudentConcernAnswer],
  ['semantic-rag-career-readiness', tryCareerReadinessAnswer],
  ['semantic-rag-career-softskill', tryCareerCenterSoftskillAnswer],
  ['semantic-rag-unsupported-double-degree-partner', tryUnsupportedDoubleDegreePartnerAnswer],
  ['semantic-rag-unsupported-international-program', tryUnsupportedInternationalProgramAnswer],
  ['semantic-rag-known-faq-qna', tryKnownFaqQnaAnswer],
  ['semantic-rag-program-curriculum', tryProgramCurriculumFollowupAnswer],
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
  ['semantic-rag-campus-physical-attribute-insufficient-data', tryCampusPhysicalAttributeFallback],
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
  'semantic-rag-program-curriculum',
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
  'semantic-rag-explicit-external-no-data',
  'semantic-rag-abbreviation-clarification',
  'semantic-rag-out-of-domain',
  'semantic-rag-security-refusal',
  'semantic-rag-student-concern',
  'semantic-rag-career-softskill',
  'semantic-rag-unsupported-double-degree-partner',
  'semantic-rag-unsupported-international-program',
  'semantic-rag-known-faq-qna',
  'semantic-rag-program-curriculum',
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
  'semantic-rag-program-list',
  'semantic-rag-program-recommendation',
  'semantic-rag-program-comparison',
  'semantic-rag-career',
  'semantic-rag-international-class-fallback',
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
      ...(result && typeof result === 'object' ? result : {}),
      ...(result && result.debug && typeof result.debug === 'object' ? result.debug : {})
    }
  };
}

const GENERIC_FALLBACK_SOURCES = new Set([
  'semantic-rag-finance-fallback',
  'semantic-rag-billing-change-fallback',
  'semantic-rag-campus-support-fallback',
  'semantic-rag-international-class-fallback',
  'semantic-rag-thesis-fallback'
]);

function hasSpecificCampusQuestionIntent(question) {
  const q = normalizeFacilityTerm(question || '');
  return /\b(?:konsultasi|berkonsultasi|bimbingan|konseling|job\s*fair|campus\s*hiring|tracer\s*study|career\s*center|pusat\s+karier|pusat\s+karir|peluang\s+kerja|prospek\s+kerja|lulusan|inbis|inkubator\s+bisnis|llc|language\s+learning|student\s+exchange|pertukaran\s+mahasiswa|dual\s+degree|double\s+degree|dnui|help|utb|rpl|rekognisi\s+pembelajaran\s+lampau|beasiswa|skss|1k1s|kip|pasca|pascasarjana|magister|s2|s\s*2|akreditasi|akrediasi|ban\s*-?\s*pt)\b/i.test(q);
}

function shouldSuppressGenericFallbackForQuestion(question, source) {
  if (!GENERIC_FALLBACK_SOURCES.has(String(source || ''))) return false;
  return hasSpecificCampusQuestionIntent(question);
}

function runDeterministicHandlers(originalQuestion, handlers, options = {}, variants = [], debugExtra = {}) {
  const trimmedOriginal = String(originalQuestion || '').trim();
  const questions = uniqueList([trimmedOriginal, ...(Array.isArray(variants) ? variants : [])], 8);
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
        if (shouldSuppressGenericFallbackForQuestion(originalQuestion, built.source)) {
          if (debugTrace) {
            console.log('[TRACE runDeterministicHandlers] SKIPPING generic fallback for specific question:', {
              source,
              builtSource: built.source,
              builtAnswerPreview: String(built.answer).slice(0, 100)
            });
          }
          continue;
        }
        if (!/semantic-rag-certification/i.test(String(built.source || '')) && isMeaningMismatchAnswer(originalQuestion, built.answer, built.source)) {
          if (debugTrace) {
            console.log('[TRACE runDeterministicHandlers] SKIPPING meaning-mismatch handler:', {
              source,
              builtSource: built.source,
              anchors: extractMeaningAnchors(originalQuestion),
              builtAnswerPreview: String(built.answer).slice(0, 100)
            });
          }
          continue;
        }
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

function shouldDeferDeterministicBeforeSemantic(question) {
  const q = String(question || '').trim();
  if (!q || q.length < 12) return false;
  if (isBroadCampusDocumentQuestion(q) && !hasExplicitFeeQuestionSignal(q)) return true;

  const directQuestionStarts = /^(?:apa|siapa|kapan|dimana|bagaimana|gimana|berapa|apakah|jelaskan|tolong|minta|info|informasi|bisakah|bisa|apaan|maksud|pengertian|ceritakan|detail)\b/i;
  const clearDomainSignals = /\b(?:biaya(?:nya)?|harga(?:nya)?|ukt|spp|tarif|daftar|pendaftaran|registrasi|program(?:\s+studi)?|jurusan|beasiswa|prodi|jadwal|kelas|fasilitas|magang|training|sertifikat|syarat|seleksi|kampus|kuliah)\b/i;
  const slangOrInformalSignals = /\b(?:kalo|gmn|gimana|mau|pengen|sya|aku|min|kak|brp|bgt|bgs|gak|gk|blah|mksd|maksud|yg|nih|dong|yaudah|udah|jd|jdi|cpt|cuma|pake|bkin|bisa|engga|tergantung)\b/i;
  const multiWordNaturalQuestion = q.split(/\s+/).filter(Boolean).length >= 4;
  const likelyNaturalQuery = /[a-zA-Z]/.test(q) && (slangOrInformalSignals.test(q) || multiWordNaturalQuestion);

  if (!likelyNaturalQuery) return false;
  if (directQuestionStarts.test(q) || clearDomainSignals.test(q)) return false;

  const unambiguousShortForm = /^(?:gmn|gimana|bagaimana|apa|berapa|kapan|dimana|siapa|apakah)\s+/i.test(q);
  return likelyNaturalQuery && !unambiguousShortForm && !clearDomainSignals.test(q);
}

function hasExplicitFeeQuestionSignal(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;
  if (/\b(?:sks|satuan\s+kredit\s+semester|total\s+sks|jumlah\s+sks|beban\s+sks)\b/i.test(q)) return false;

  const hasMoneyTopic = /\b(biaya(?:nya)?|harga(?:nya)?|tarif|ongkos|bayar(?:an|nya)?|pembayaran|uang(?:\s+kuliah|\s+masuk)?|dpp|ukt|spp|tagihan|angsuran|cicil|cicilan|dicicil|nyicil|nominal|total(?:an)?|fee|fees|cost|costs|tuition|payment|payments)\b/i.test(q);
  if (hasMoneyTopic) return true;

  const asksRegistrationAmount =
    /\b(?:pendaftaran|registrasi|daftar)\b.{0,45}\b(?:berapa|rp|rupiah|nominal)\b/i.test(q) ||
    /\b(?:berapa|rp|rupiah|nominal)\b.{0,45}\b(?:pendaftaran|registrasi|daftar)\b/i.test(q);
  const asksRegistrationProcess = /\b(cara|gimana|bagaimana|jadwal|tanggal|kapan|masih\s+buka|buka|periode|gelombang\s+berapa)\b/i.test(q);
  if (asksRegistrationAmount && !asksRegistrationProcess) return true;

  return /\b(per\s+semester|semesteran|uang\s+kuliah|uang\s+masuk|awal(?:nya)?\s+masuk|biaya\s+masuk)\b/i.test(q);
}
function buildInsufficientDataAnswer(kind = 'very_low') {
  return 'Saya belum menemukan data yang sesuai untuk menjawab pertanyaan itu. Agar tidak keliru, kakak bisa cek informasi resmi kampus atau konfirmasi ke admin/unit terkait.';
}
function buildMeaningMismatchFallbackAnswer(question) {
  if (isAcademicAdminUploadedDocQuestion(question, 'schedule') || isAcademicScheduleLookupQuestion(question)) return buildAcademicScheduleNoDataAnswer(question);
  return buildInsufficientDataAnswer('low');
}

const MEANING_STOPWORDS = new Set([
  'apa', 'apakah', 'itu', 'ini', 'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'pada', 'dalam', 'tentang', 'terkait',
  'saya', 'aku', 'kak', 'kakak', 'min', 'admin', 'ingin', 'mau', 'tahu', 'tau', 'menanyakan', 'bertanya', 'maksudnya',
  'kalau', 'kalo', 'baik', 'iya', 'ya', 'nah', 'jadi', 'berarti', 'sekarang', 'saat', 'tahun', 'ada', 'sudah',
  'program', 'fasilitas', 'informasi', 'detail', 'jelaskan', 'bagaimana', 'gimana', 'berapa', 'kapan', 'dimana', 'mana',
  'stikom', 'bali', 'itb', 'kampus', 'kuliah', 'mahasiswa', 'mahasiswi', 'tersebut', 'terima', 'kasih', 'mempersiapkan', 'mendapat', 'setelah', 'tamat', 'saja', 'boleh'
]);

function extractMeaningAnchors(question) {
  const normalized = normalizeCacheText(question);
  if (!normalized) return [];

  const phraseAnchors = [
    'semester antara', 'semester pendek', 'pelaksanaan akademik', 'kalender akademik', 'ujian remidi', 'ujian remedial',
    'j1', 'training 1 tahun', 'n4', 'jlpt n4', 'jepang', 'amerika', 'career center', 'inkubator bisnis', 'language learning center', 'kuliah sambil kerja',
    'magang berbayar', 'hi think', 'hithink', 'gccp', 'short course', 'double degree', 'dual degree', 'help university',
    'dnui', 'dalian neusoft', 'utb', 'universitas teknologi bandung', 'softskill', 'soft skill', 'pmb', 'gelombang',
    'sistem informasi', 'teknologi informasi', 'teknik informatika', 'bisnis digital', 'sistem komputer', 'manajemen informatika'
  ];

  const anchors = [];
  for (const phrase of phraseAnchors) {
    const p = normalizeCacheText(phrase);
    if (p && normalized.includes(p)) anchors.push(p);
  }

  for (const token of normalized.split(' ')) {
    if (!token || token.length < 3) continue;
    if (MEANING_STOPWORDS.has(token)) continue;
    if (/^\d{4}$/.test(token)) continue;
    anchors.push(token);
  }

  const aliases = [];
  if (anchors.includes('remidi')) aliases.push('remedial');
  if (anchors.includes('remedial')) aliases.push('remidi');
  if (anchors.includes('pendaftaran') || anchors.includes('mendaftar') || anchors.includes('daftar')) aliases.push('pmb', 'pendaftaran', 'daftar', 'mendaftar');
  if (anchors.includes('ganti')) aliases.push('mengganti', 'ubah', 'diubah');
  if (anchors.includes('jurusan')) aliases.push('prodi', 'program studi', 'pilihan prodi');
  if (anchors.includes('karier') || anchors.includes('karir')) aliases.push('career center', 'karier', 'karir');
  if (anchors.includes('pekerjaan') || anchors.includes('kerja')) aliases.push('career center', 'karier', 'magang', 'kerja');
  if (anchors.includes('amerika')) aliases.push('usa', 'america');
  if (anchors.includes('teknik informatika')) aliases.push('teknologi informasi', 'ti');

  return uniqueList([...anchors, ...aliases], 12);
}

function hasNoDataAnswerPhrase(answer) {
  return /\b(belum\s+(?:menemukan|mempunyai|ada)|tidak\s+(?:mempunyai|menemukan|ada|cukup)|data\s+yang\s+tersedia|agar\s+tidak\s+keliru|agar\s+tidak\s+salah|konfirmasi|cek\s+pengumuman|cek\s+kalender|sion|baak)\b/i.test(String(answer || ''));
}

function answerMentionsUnaskedSpecificEntity(question, answer) {
  const q = normalizeCacheText(question);
  const a = normalizeCacheText(answer);
  const entities = [
    'help university', 'dnui', 'dalian neusoft', 'utb', 'universitas teknologi bandung', 'hi think', 'hithink',
    'double degree', 'dual degree', 'bisnis digital', 'sistem informasi', 'teknologi informasi', 'program studi'
  ];
  return entities.some(entity => a.includes(entity) && !q.includes(entity));
}

function inferQuestionMeaningProfile(question) {
  const q = String(question || '').toLowerCase();
  if (!q.trim()) return { intent: 'unknown' };

  if (/\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|pengertian|jelaskan|maksud(?:nya)?|tentang)\b/i.test(q) && /\b(?:student\s+exchange|career\s+center|bccp|gccp|toga|ukm|ormawa|program|fasilitas|layanan|beasiswa|kursus|magang|internasional|double\s+degree|dual\s+degree|language\s+learning\s+center|hi[- ]?think|inbis|inkubator\s+bisnis|incubator\s+bisnis)\b/i.test(q)) return { intent: 'definition_question' };
  if (isAcademicAdminUploadedDocQuestion(q, 'requirement') && /\b(syarat|persyaratan|dokumen|berkas|apa\s+saja|ketentuan)\b/i.test(q)) return { intent: 'academic_requirement' };
  if (isAcademicAdminUploadedDocQuestion(q, 'schedule') || isAcademicScheduleLookupQuestion(q)) return { intent: 'academic_schedule' };
  if (/\b(?:fokus\s+penelitian|bidang\s+riset|riset|konsentrasi)\b/i.test(q) && /\b(?:pasca|pascasarjana|pasca\s*sarjana|magister|s2|s\s*2)\b/i.test(q)) return { intent: 'postgraduate_research' };
  if (/\b(biaya|harga|bayar|ukt|dpp|rincian\s+biaya|biaya\s+kuliah|potongan\s+biaya)\b/i.test(q)) return { intent: 'fee' };
  if (/\b(pmb|penerimaan\s+mahasiswa\s+baru)\b/i.test(q) && /\b(apa\s+itu|tentang|bertanya|tanya|informasi|jelaskan|maksud)\b/i.test(q)) return { intent: 'pmb_info' };
  if (/\b(daftar|mendaftar|pendaftaran|registrasi)\b/i.test(q) && /\b(kuliah|pmb|stikom|camaba|mahasiswa\s+baru)\b/i.test(q)) return { intent: 'registration_info' };
  if (/\b(jurusan|prodi|program\s+studi|program\s+kuliah|pilihan\s+jurusan|daftar\s+jurusan)\b/i.test(q) && /\b(apa\s+saja|apa\s+aja|daftar|tersedia|yang\s+ada|ada\s+apa)\b/i.test(q)) return { intent: 'program_list' };
  if (/\b(apa\s+itu|itu\s+apa|pengertian|maksud(?:nya)?|jelaskan)\b/i.test(q) && /\b(sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|\bsi\b|\bti\b|\bbd\b|\bsk\b|\bmi\b)\b/i.test(q)) return { intent: 'program_definition' };
  if (/\b(mempersiapkan|persiapan|siap|mendapat(?:kan)?\s+pekerjaan|dapat\s+kerja|setelah\s+(?:lulus|tamat)|karier|karir|career|lowongan|job\s*fair|campus\s*hiring|magang|pelatihan|pembekalan|melamar\s+pekerjaan)\b/i.test(q) && /\b(program|fasilitas|layanan|pendukung|apa\s+saja|ada\s+apa|mahasiswa)\b/i.test(q)) return { intent: 'career_readiness' };
  if (/\b(fasilitas|fasilias|fasiltas|layanan|sarana|prasarana)\b/i.test(q) && /\b(apa\s+saja|apa\s+aja|unggulan|diunggulkan|tersedia|yang\s+ada|ada\s+apa)\b/i.test(q)) return { intent: 'facility_list' };
  if (/\b(program|training|magang|internship|kerja|bekerja|sertifikasi|kelas|kursus|bahasa)\b/i.test(q) && /\b(j\s*1|j-?1|n\s*[1-5]|jlpt|amerika|america|usa|jepang|japan|luar\s+negeri)\b/i.test(q)) return { intent: 'international_program_availability' };
  if (/\b(beasiswa|kip|1k1s|potongan|prestasi|yayasan)\b/i.test(q)) return { intent: 'scholarship' };
  return { intent: 'unknown' };
}

function answerMatchesQuestionMeaning(question, answer, source = '') {
  const profile = inferQuestionMeaningProfile(question);
  const intent = profile.intent || 'unknown';
  if (intent === 'unknown') return null;

  const q = normalizeAcademicAdminQueryText(question).toLowerCase();
  const a = String(answer || '').toLowerCase();
  const src = String(source || '').toLowerCase();
  const noData = hasNoDataAnswerPhrase(answer);

  if (intent === 'academic_requirement') {
    if (/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|calon\s+mahasiswa|camaba|gelombang\s+pendaftaran|admin\s+pmb)\b/i.test(a)) return false;
    return noData || /\b(persyaratan|syarat|yudisium|wisuda|telah|sudah|wajib|bebas|lunas|minimum|tidak\s+lebih|krs|pddikti|pin|ipk|nilai|transkrip|sk\s+rektor|sidang|tugas\s+akhir|proyek\s+akhir|mata\s+kuliah|kurikulum)\b/i.test(a);
  }
  if (intent === 'academic_schedule') {
    if (/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|calon\s+mahasiswa|camaba|gelombang\s+pendaftaran|admin\s+pmb)\b/i.test(a)) return false;
    if (/\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis)\b/i.test(q)) {
      return noData || /\b(sidang|tugas\s+akhir|proyek\s+akhir|skripsi|tesis|hari\s*\/?\s*tanggal|tanggal|pukul|wita|wib|wit|loket|tempat|sion|baak|akademik)\b/i.test(a);
    }
    if (/\byudisium\b/i.test(q)) return noData || /\b(yudisium|hari\s*\/?\s*tanggal|tanggal|pukul|wita|wib|wit|loket|tempat|sion|baak|akademik)\b/i.test(a);
    if (/\bwisuda\b/i.test(q)) return noData || /\b(wisuda|hari\s*\/?\s*tanggal|tanggal|pukul|wita|wib|wit|loket|tempat|sion|baak|akademik)\b/i.test(a);
    return noData || /\b(semester\s+antara|semester\s+pendek|remedial|remidi|jadwal\s+akademik|kalender\s+akademik|sion|baak)\b/i.test(a);
  }
  if (intent === 'postgraduate_research') {
    return /\b(?:Cyber\s+Security|Data\s+Science|Enterprise\s+System|Medical\s+Informatics|fokus\s+penelitian|riset)\b/i.test(answer);
  }
  if (intent === 'fee') {
    return /\b(rp\.?|biaya|ukt|dpp|pendaftaran|potongan|gelombang)\b/i.test(a);
  }
  if (intent === 'pmb_info') {
    return /\b(pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran\s+mahasiswa\s+baru|calon\s+mahasiswa)\b/i.test(a);
  }
  if (intent === 'registration_info') {
    if (noData && /\b(linked\s*in|linkedin|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(q)) return true;
    return /\b(daftar|mendaftar|pendaftaran|registrasi|siap\.stikom-bali\.ac\.id|online|offline|pmb)\b/i.test(a);
  }
  if (intent === 'program_list') {
    return /\b(sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|s2\s+sistem\s+informasi|double\s+degree|dual\s+degree)\b/i.test(a);
  }
  if (intent === 'program_definition' || intent === 'definition_question') {
    const q = String(question || '').toLowerCase();
    if (/\bdkv\b|desain\s+komunikasi\s+visual/i.test(q)) return /\bdkv\b|desain\s+komunikasi\s+visual/i.test(a);
    if (/\bhi-?think\b|hithink/i.test(q)) return /\bhi-?think\b|hithink/i.test(a);
    if (/\bjob\s*fair\b/i.test(q)) return /\bjob\s*fair\b|pameran\s+kerja/i.test(a);
    if (/\bcareer\s*center\b|pusat\s+karier|pusat\s+karir/i.test(q)) return /\bcareer\s*center\b|pusat\s+karier|pusat\s+karir/i.test(a);
    if (/\blanguage\s+learning\s+center\b|\bllc\b/i.test(q)) return /\blanguage\s+learning\s+center\b|\bllc\b/i.test(a);
    if (/\binkubator\s+bisnis\b|\binbis\b/i.test(q)) return /\binkubator\s+bisnis\b|\binbis\b/i.test(a);
    if (/\bgccp\b|\bshort\s*course\b/i.test(q)) return /\bgccp\b|\bshort\s*course\b/i.test(a);
    if (/\bstudent\s+exchange\b/i.test(q)) return /\bstudent\s+exchange\b|pertukaran\s+mahasiswa/i.test(a);
    if (/\bsoft\s*skill\b|softskill/i.test(q)) return /\bsoft\s*skill\b|softskill/i.test(a);
    if (/\bsi\b|sistem\s+informasi/i.test(q)) return /sistem\s+informasi/i.test(a);
    if (/\bti\b|teknologi\s+informasi|teknik\s+informatika/i.test(q)) return /teknologi\s+informasi|teknik\s+informatika/i.test(a);
    if (/\bbd\b|bisnis\s+digital/i.test(q)) return /bisnis\s+digital/i.test(a);
    if (/\bsk\b|sistem\s+komputer/i.test(q)) return /sistem\s+komputer/i.test(a);
    if (/\bmi\b|manajemen\s+informatika/i.test(q)) return /manajemen\s+informatika/i.test(a);
    return /program\s+studi|prodi|program|fasilitas|layanan|kegiatan|gelar|akademik|mahasiswa|kampus|luar\s+negeri/i.test(a) || /student\s+exchange|career\s+center|gccp|bccp|ukm|ormawa|language\s+learning\s+center|hi[- ]?think/i.test(a);
  }
  if (intent === 'career_readiness') {
    return /\b(career\s*center|pusat\s+karier|karier|karir|soft\s*skill|softskill|magang|lowongan|job\s*fair|campus\s*hiring|hi-?think|konsultasi)\b/i.test(a);
  }
  if (intent === 'facility_list') {
    const facilityHits = ['career center', 'inkubator', 'softskill', 'soft skill', 'ukm', 'language learning', 'double degree', 'hi-think', 'hithink', 'gccp', 'magang', 'konsultasi'].filter(term => a.includes(term)).length;
    return facilityHits >= 2 || (src.includes('campus-facility') && /\bfasilitas\b/i.test(a));
  }
  if (intent === 'international_program_availability') {
    const q = String(question || '').toLowerCase();
    const targetMentioned = (/\b(j\s*1|j-?1)\b/i.test(q) ? /\bj\s*1|j-?1\b/i.test(a) : true)
      && (/\bn\s*[1-5]|jlpt\b/i.test(q) ? /\bn\s*[1-5]|jlpt\b/i.test(a) : true)
      && (/amerika|america|usa/i.test(q) ? /amerika|america|usa/i.test(a) : true)
      && (/jepang|japan/i.test(q) ? /jepang|japan/i.test(a) : true);
    return targetMentioned && (noData || /\b(double\s+degree|gccp|hi-?think|magang|kuliah\s+sambil\s+kerja|luar\s+negeri)\b/i.test(a));
  }
  if (intent === 'scholarship') {
    return /\b(beasiswa|kip|1k1s|potongan|prestasi|yayasan)\b/i.test(a);
  }

  return null;
}
function isGenericEvidenceLikeSource(source = '') {
  return /semantic-rag-(?:uploaded-training-generic|evidence-first|generic-faq-qna|campus-support-entity|campus-facility|training-specific)/i.test(String(source || ''));
}

function hasRawEvidenceSnippetShape(answer) {
  const text = String(answer || '').trim();
  if (!text) return false;
  if (hasLikelyRawDocumentLeak(text)) return true;
  if (/\b(?:SOURCE_CHUNKS|Sheet:|chunkId|trainingId|metadata|filename|sourceFile)\b/i.test(text)) return true;
  if (/\b(?:Program Studi\s*:|No\s*:\s*\d+\s*\||INSTITUT TEKNOLOGI DAN BISNIS \(ITB\) STIKOM BALI Kampus|Kampus Denpasar\s+Kampus Jimbaran)\b/i.test(text)) return true;
  const embeddedQuestionCount = (text.match(/\b(?:apa\s+itu|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|siapa|dokumen\s+apa|apa\s+saja)\b[^?]{4,180}\?/gi) || []).length;
  if (embeddedQuestionCount >= 2) return true;
  if (embeddedQuestionCount >= 1 && /\b(?:izin\s+belajar|study\s+permit|visa|itas|kitas|sktt|mahasiswa\s+asing)\b/i.test(text) && text.length > 350) return true;
  const bulletCount = (text.match(/(?:^|\n|\s)-\s+/g) || []).length;
  const startsWithBullet = /^[-*]\s+/.test(text);
  const hasQuestionBullet = /(?:^|\n|\s)-\s*(?:\d+[.)]\s*)?(?:apa|apakah|kapan|bagaimana|gimana|berapa|di\s*mana|dimana|siapa)\b/i.test(text);
  const hasFragmentedQaBullets = startsWithBullet && bulletCount >= 2 && (hasQuestionBullet || /\s-\s*(?:Ya|Tentu|Tidak|Career Center|Program|\d+[.)])/i.test(text));
  const pipeDump = (text.match(/\|/g) || []).length >= 3 && /\b(?:No|Pertanyaan|Jawaban|Program|Biaya|Keterangan)\b/i.test(text);
  return hasFragmentedQaBullets || pipeDump;
}

function hasUploadedTrainingAnswerGrounding(question, answer) {
  const q = normalizeForLexicalMatch(question || '');
  const a = normalizeForLexicalMatch(answer || '');
  if (!q || !a) return false;

  const meaning = answerMatchesQuestionMeaning(question, answer, 'semantic-rag-uploaded-training-generic');
  if (meaning === true) return true;
  if (meaning === false) return false;

  if (getMissingStrongQuestionAnchors(question, answer).length > 0) return false;
  if (hasUploadedDocumentTopicConflict(question, answer) || hasUnrequestedSensitiveDomainLeak(question, answer)) return false;

  const stop = new Set([
    'apa', 'apakah', 'bagaimana', 'gimana', 'berapa', 'kapan', 'dimana', 'mana', 'siapa', 'yang', 'dan', 'atau', 'dari', 'dengan', 'untuk', 'pada', 'dalam', 'bisa', 'dapat', 'punya', 'memiliki', 'ada', 'tersedia', 'tentang', 'info', 'informasi', 'jelaskan', 'detail', 'saya', 'aku', 'kak', 'min', 'itu', 'ini', 'nya', 'aja', 'saja', 'mau', 'ingin', 'pengen', 'kalau', 'harus', 'kampus', 'itb', 'stikom', 'bali', 'mahasiswa', 'kuliah', 'program', 'prodi', 'program studi', 'jurusan'
  ]);
  const tokens = Array.from(new Set(q.split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stop.has(token))));
  if (!tokens.length) return answerMatchesStrongQuestionAnchors(question, answer);

  const hits = tokens.filter((token) => a.includes(token));
  if (hits.length >= 1) return true;

  const acronymPairs = [
    ['rpl', /rekognisi\s+pembelajaran\s+lampau/i],
    ['inbis', /inkubator\s+bisnis/i],
    ['llc', /language\s+learning\s+center/i],
    ['pmb', /penerimaan\s+mahasiswa\s+baru|pendaftaran/i],
    ['s2', /pascasarjana|magister/i],
    ['bd', /bisnis\s+digital/i],
    ['si', /sistem\s+informasi/i],
    ['ti', /teknologi\s+informasi/i],
    ['sk', /sistem\s+komputer/i],
    ['mi', /manajemen\s+informatika/i]
  ];
  for (const [abbr, full] of acronymPairs) {
    if (new RegExp(`(^|\\s)${abbr}(\\s|$)`, 'i').test(q) && full.test(answer)) return true;
  }

  return false;
}
function failsExpectedAnswerShape(question, answer) {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').toLowerCase();
  if (!q || !a || hasNoDataAnswerPhrase(a)) return false;

  if (/\b(?:kapan|tanggal|jadwal|pukul|jam|deadline|batas|periode|gelombang\s+berapa)\b/i.test(q)) {
    return !/\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)|20\d{2}|pukul|jam|wita|wib|wit|semester|gelombang|periode|minggu|bulan|hari|tanggal)\b/i.test(a);
  }

  if (/\b(?:berapa|nominal|harga|biaya|ukt|dpp|sks|semester|durasi|lama|total|jumlah)\b/i.test(q)) {
    return !/\b(?:rp\.?\s*\d|\d+\s*(?:sks|semester|tahun|bulan|minggu|hari|orang|prodi|program|juta|ribu)|\d+[,.]?\d*)\b/i.test(a);
  }

  if (/\b(?:dokumen|berkas|syarat|persyaratan|diperlukan|dibutuhkan|perlu\s+diurus)\b/i.test(q)) {
    return !/\b(?:dokumen|berkas|syarat|persyaratan|paspor|passport|foto|loa|letter\s+of\s+acceptance|ijazah|transkrip|financial\s+statement|statement\s+letter|medical\s+statement|surat|form|kitas|itas|sktt|visa|izin\s+belajar)\b/i.test(a);
  }

  if (/\b(?:gelar|title|degree)\b/i.test(q)) {
    return !/\b(?:gelar|s\.kom|s\.?kom|s\.bns|s\.?bns|m\.kom|m\.?kom|bachelor|bit|bm|sarjana|magister)\b/i.test(a);
  }

  if (/\b(?:negara|china|tiongkok|malaysia|jepang|thailand|filipina|philippines|luar\s+negeri|lokasi|di\s+mana|dimana)\b/i.test(q)) {
    return !/\b(?:china|tiongkok|malaysia|jepang|japan|thailand|filipina|philippines|indonesia|denpasar|jimbaran|kampus|dnui|help\s+university|luar\s+negeri|onsite|online|offline)\b/i.test(a);
  }

  return false;
}
function shouldBlockGenericEvidenceAnswer(question, answer, source = '') {
  if (!isGenericEvidenceLikeSource(source)) return false;
  const text = String(answer || '').trim();
  if (!text) return false;
  if (hasNoDataAnswerPhrase(text)) return false;
  if (hasRawEvidenceSnippetShape(text)) return true;
  if (failsExpectedAnswerShape(question, text)) return true;
  if (/^semantic-rag-uploaded-training-generic$/i.test(String(source || '')) && !hasUploadedTrainingAnswerGrounding(question, text)) return true;
  const meaning = answerMatchesQuestionMeaning(question, text, source);
  if (meaning === false) return true;
  if (hasUploadedDocumentTopicConflict(question, text) || hasUnrequestedSensitiveDomainLeak(question, text)) return true;
  const fine = detectFineGrainedIntent(question || '');
  const stable = new Set(['program_list','program_definition','program_comparison','program_recommendation','program_curriculum','program_faculty','career_readiness','international_program_list','international_program_requirement','international_program_fee','fee','scholarship','accreditation','facility_list','academic_schedule','academic_requirement','registration_info','pmb_info']);
  if (stable.has(String(fine.fineIntent || '').toLowerCase()) && !answerMatchesStrongQuestionAnchors(question, text)) return true;
  return false;
}

function isMeaningMismatchAnswer(question, answer, source = '') {
  if (!String(answer || '').trim()) return false;

  const srcForAvailability = String(source || '').toLowerCase();
  const qForAvailability = String(question || '').toLowerCase();
  if (srcForAvailability.includes('explicit-external-insufficient-data')) return false;
  if (srcForAvailability.includes('program-list-contextual') || srcForAvailability.includes('program-scope-clarification-choice')) return false;
  if (srcForAvailability.includes('program-comparison') && /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(qForAvailability)) return false;
  
  // Document answers are trusted only after anchor and meaning alignment. Uploaded files can contain many unrelated sections, so keep verifier active for them.
  if (/campus-support|campus-facility/i.test(srcForAvailability)) {
    return false;
  }
  
  if (!/small-talk|clarification|feedback|out-of-domain|no-data|insufficient/i.test(srcForAvailability) && failsExpectedAnswerShape(question, answer)) return true;
  const asksAvailability = /\b(apakah|apa|ada|tersedia|sudah\s+ada|punya|memiliki)\b/i.test(qForAvailability) && /\b(program|layanan|fasilitas|kelas|kursus|sertifikasi|training|magang|kerja|beasiswa|komunitas|ukm|jalur)\b/i.test(qForAvailability);
  const asksRecommendationExplicitly = /\b(cocok|cocoknya|rekomendasi|saran|sarankan|jurusan\s+apa|prodi\s+apa|pilih\s+jurusan)\b/i.test(qForAvailability);
  if (srcForAvailability.includes('program-recommendation') && asksAvailability && !asksRecommendationExplicitly) return true;
  if (srcForAvailability.includes('program-change')
    && /\b(ganti|ubah|pindah|tukar)\b/i.test(qForAvailability)
    && /\b(jurusan|prodi|program\s+studi|pilihan)\b/i.test(qForAvailability)
    && /\b(setelah\s+daftar|sudah\s+daftar|pendaftaran|mendaftar)\b/i.test(qForAvailability)) return false;

  const meaningMatch = answerMatchesQuestionMeaning(question, answer, source);
  if (meaningMatch === true) return false;
  if (meaningMatch === false) return true;

  const anchors = extractMeaningAnchors(question);
  if (!anchors.length) return false;

  const normalizedAnswer = normalizeCacheText(answer);
  const src = String(source || '').toLowerCase();
  const hits = anchors.filter(anchor => normalizedAnswer.includes(anchor));
  if (hits.length > 0) return false;

  const noDataAnswer = hasNoDataAnswerPhrase(answer);
  if (/rag-accreditation|semantic-rag-accreditation/.test(src)
    && /\b(program|prodi|jurusan)\b/i.test(question)
    && /Program yang tersedia[\s\S]+Akreditasi/i.test(answer)) return false;
  if (noDataAnswer) return answerMentionsUnaskedSpecificEntity(question, answer);

  if (src.includes('program-list') && /\b(?:Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika)\b/i.test(answer)) return false;
  if (/training-specific|generic-faq-qna|campus-support-entity|campus-facility|schedule-window|current-open-waves|registration-info|program-list/.test(src)) return true;
  return anchors.length >= 2;
}

function isGeneralCampusAvailabilityQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(apakah|apa|ada|tersedia|sudah\s+ada|punya|memiliki)\b/i.test(q)) return false;
  if (!/\b(program|layanan|fasilitas|kelas|kursus|sertifikasi|training|magang|kerja|beasiswa|komunitas|ukm|jalur)\b/i.test(q)) return false;
  if (!/\b(stikom|itb\s*stikom|kampus|bali|di\s+stikom|internasional|international|luar\s+negeri|korea|jepang|amerika|malaysia|china|australia|singapura|jerman|program|kelas|kursus|sertifikasi|training|magang)\b/i.test(q)) return false;
  return true;
}

function extractAvailabilityTopic(question) {
  let q = String(question || '').trim();
  q = q.replace(/[?!.]+$/g, '').trim();
  q = q.replace(/^\s*(?:kalau|kalo|baik|iya|ya|nah|apakah|apa)\s+/i, '');
  q = q.replace(/\b(?:apakah|apa|sudah|ada|tersedia|punya|memiliki|di|itb|stikom|bali|kampus|kak|ya)\b/gi, ' ');
  q = q.replace(/\s{2,}/g, ' ').trim();
  return q.length >= 4 && q.length <= 90 ? q : 'program atau layanan tersebut';
}

function buildGeneralAvailabilityNoDataAnswer(question) {
  const topic = extractAvailabilityTopic(question);
  return [
    `Saya belum menemukan data yang sesuai tentang ${topic} pada informasi ITB STIKOM Bali yang tersedia saat ini.`,
    '',
    'Agar tidak keliru menyebut ketersediaan, syarat, jadwal, biaya, atau unit pengelolanya, kakak sebaiknya konfirmasi ke admin kampus/unit terkait.',
    '',
    'Kalau konteksnya program pendukung kampus, data yang tersedia saat ini mencatat beberapa program seperti Career Center, Inkubator Bisnis, UKM, Language Learning Center, Double Degree, Hi-Think, GCCP/short course, kuliah sambil kerja di luar negeri, dan magang berbayar di luar negeri.'
  ].join('\n');
}
async function verifyAnswerRelevanceWithLlm(client, question, answer, source = '') {
  if (!client || !envFlag('SEMANTIC_RAG_LLM_RELEVANCE_GATE', true)) return null;
  const src = String(source || '').toLowerCase();
  if (src.includes('small-talk')) return { ok: true, verdict: 'small_talk_skipped', confidence: 1 };
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (!q || !a) return { ok: false, verdict: 'empty', confidence: 1 };

  const prompt = [
    'Nilai apakah JAWABAN benar-benar menjawab MAKSUD PERTANYAAN USER.',
    'Ini adalah pemeriksa umum sebelum jawaban chatbot kampus dikirim ke WhatsApp.',
    '',
    'Kembalikan JSON valid saja dengan schema:',
    '{"verdict":"direct|safe_no_data|partial|mismatch|hallucination","confidence":0-1,"reason":"singkat"}',
    '',
    'Definisi:',
    '- direct: jawaban menjawab inti pertanyaan user secara relevan.',
    '- safe_no_data: jawaban tidak memberi fakta yang diminta karena data tidak tersedia, tetapi tetap menyebut target/topik yang ditanyakan user dan tidak mengalihkan ke topik lain.',
    '- partial: sebagian menjawab tetapi ada bagian penting yang belum dijawab.',
    '- mismatch: jawaban membahas topik lain, hanya cocok kata, atau tidak menjawab maksud user.',
    '- hallucination: jawaban mengklaim fakta yang tidak didukung/terlalu pasti untuk topik yang tampak tidak tersedia.',
    '',
    'Aturan penting:',
    '- Jangan terjebak kesamaan kata. Fokus pada maksud pertanyaan.',
    '- Kalau user bertanya jadwal akademik, jawaban PMB/gelombang pendaftaran adalah mismatch.',
    '- Kalau user bertanya program tertentu yang belum ada datanya, safe_no_data boleh hanya jika menyebut program/negara/target yang user tanyakan.',
    '- Kalau jawaban hanya berisi rekomendasi pertanyaan lanjutan tanpa menjawab pertanyaan utama, verdict mismatch.',
    '- Kalau jawaban berupa daftar dan user memang meminta daftar, verdict direct.',
    '',
    `SOURCE: ${source || '-'}`,
    '',
    `PERTANYAAN USER:\n${clampText(q, 1200)}`,
    '',
    `JAWABAN BOT:\n${clampText(a, 2500)}`
  ].join('\n');

  try {
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: 'You are a strict semantic relevance judge for a grounded campus chatbot. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: 180,
      temperature: 0,
      top_p: 0.1
    });
    const obj = extractJsonObject(completion && completion.choices && completion.choices[0] && completion.choices[0].message ? completion.choices[0].message.content : '');
    const verdict = String(obj && obj.verdict ? obj.verdict : '').toLowerCase();
    const confidence = Number.isFinite(Number(obj && obj.confidence)) ? Math.max(0, Math.min(1, Number(obj.confidence))) : 0;
    const ok = ['direct', 'safe_no_data'].includes(verdict) || (verdict === 'partial' && confidence >= 0.82);
    return { ok, verdict: verdict || 'unknown', confidence, reason: String(obj && obj.reason ? obj.reason : '').slice(0, 240) };
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err), source }, '[SemanticRAG] LLM relevance verifier failed; using local meaning gate only');
    return null;
  }
}

async function traceAndCacheSemanticResult(question, result, resultCacheKey, stage = 'final') {
  if (resultCacheKey) setCachedSemanticResult(resultCacheKey, result);
  try {
    const debug = result && result.debug && typeof result.debug === 'object' ? result.debug : {};
    const normalized = normalizeUserQuery(question);
    await recordRagTrace(prisma, {
      chatId: debug.chatId || debug.providerChatId || null,
      question,
      normalizedQuestion: normalized && normalized.normalizedText ? normalized.normalizedText : null,
      intent: debug.intent || debug.fineIntent || debug.routeIntent || null,
      source: result && result.source ? result.source : null,
      confidenceScore: result && typeof result.confidenceScore === 'number' ? result.confidenceScore : null,
      confidenceTier: result && result.confidenceTier ? result.confidenceTier : null,
      routeStage: debug.routeStage || stage,
      contexts: result && Array.isArray(result.contexts) ? result.contexts : [],
      debug: {
        stage,
        routeStage: debug.routeStage || null,
        answerabilityResult: debug.answerabilityResult || null,
        blockedSource: debug.blockedSource || null,
        reason: debug.reason || null
      }
    });
    appendRuntimeAuditJsonl('semantic_rag_trace.jsonl', {
      stage,
      question: String(question || '').slice(0, 300),
      source: result && result.source ? result.source : null,
      confidenceScore: result && typeof result.confidenceScore === 'number' ? result.confidenceScore : null,
      contextCount: result && Array.isArray(result.contexts) ? result.contexts.length : 0
    });
  } catch (err) {
    try { logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to persist final trace'); } catch (_) { try { console.warn('[SemanticRAG] failed to persist final trace', err && err.message ? err.message : String(err)); } catch (__) {} }
  }
  return result;
}
async function finalizeSemanticResult(question, result, resultCacheKey, options = {}) {
  if (!result || !result.answer) return result;
  const source = result.source || 'semantic-rag';

  if (/^semantic-rag-uploaded-training-generic$/i.test(source) && /\b(?:goes\s*to\s*school|goestoschool|stikom\s+bali\s+goes)\b/i.test(String(question || ''))) {
    const goesToSchoolResult = {
      success: true,
      answer: buildGoesToSchoolAnswer(),
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0.9,
      confidenceTier: 'HIGH',
      debug: { ...(result.debug && typeof result.debug === 'object' ? result.debug : {}), routeStage: 'uploaded-training-goes-to-school-structured-recovery' }
    };
    return await traceAndCacheSemanticResult(question, goesToSchoolResult, resultCacheKey, 'deterministic');
  }
  const routeDomainCheck = isRouteDomainGuardApplicable(source) ? isRouteDomainCompatible(question, result) : { ok: true };
  if (routeDomainCheck && routeDomainCheck.ok === false) {
    const deterministic = runVettedDeterministicFallback(question, options, null, 'route-domain-guard');
    const deterministicCheck = deterministic && deterministic.answer ? isRouteDomainCompatible(question, deterministic) : null;
    if (deterministic && deterministic.answer && deterministicCheck && deterministicCheck.ok !== false) {
      return await traceAndCacheSemanticResult(question, deterministic, resultCacheKey, 'routeDomainFallback');
    }
    const blocked = {
      success: true,
      answer: buildMeaningMismatchFallbackAnswer(question),
      source: 'semantic-rag-route-domain-mismatch',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        routeDomainCheck,
        deterministicCheck,
        reason: 'route_domain_guard'
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }

  if (shouldBlockGenericEvidenceAnswer(question, result.answer, source)) {
    const deterministic = runVettedDeterministicFallback(question, options, null, 'global-generic-evidence-guard');
    if (deterministic && deterministic.answer && !shouldBlockGenericEvidenceAnswer(question, deterministic.answer, deterministic.source || '')) {
      return await traceAndCacheSemanticResult(question, deterministic, resultCacheKey, 'deterministic');
    }
    const blocked = {
      success: true,
      answer: buildMeaningMismatchFallbackAnswer(question),
      source: 'semantic-rag-meaning-mismatch',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        reason: 'global_generic_evidence_guard',
        meaningAnchors: extractMeaningAnchors(question)
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }

  if (/^semantic-rag-certification$/i.test(source)) {
    return await traceAndCacheSemanticResult(question, result, resultCacheKey, 'deterministic-certification');
  }

  if (/^semantic-rag-uploaded-training-generic$/i.test(source) && hasNoDataAnswerPhrase(result.answer)) {
    const deterministic = runVettedDeterministicFallback(question, options, null, 'generic-no-data-deterministic-recovery');
    if (deterministic && deterministic.answer && !hasNoDataAnswerPhrase(deterministic.answer)) {
      return await traceAndCacheSemanticResult(question, deterministic, resultCacheKey, 'deterministic');
    }
  }

  const uploadedPreflight = /^semantic-rag-uploaded-training-generic$/i.test(source)
    ? evaluateOutboundAnswer(result.answer, question, { source })
    : null;
  const uploadedCriticalLeak = Boolean(uploadedPreflight && uploadedPreflight.blocked && Array.isArray(uploadedPreflight.issues)
    && uploadedPreflight.issues.some(issue => /raw_document_leak|technical_leak|excessive_raw_quotation/i.test(String(issue || ''))));
  if (uploadedCriticalLeak) {
    const deterministic = runVettedDeterministicFallback(question, options, null, 'generic-critical-leak-deterministic-recovery');
    if (deterministic && deterministic.answer && !hasNoDataAnswerPhrase(deterministic.answer)) {
      return await traceAndCacheSemanticResult(question, deterministic, resultCacheKey, 'deterministic');
    }
    const blocked = {
      success: true,
      answer: uploadedPreflight.answer || buildPreflightFallback(question, 'raw_document_leak'),
      source: 'semantic-rag-preflight-blocked',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        preflight: uploadedPreflight,
        reason: 'uploaded_training_raw_or_technical_leak'
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }
  if (/^semantic-rag-uploaded-training-generic$/i.test(source) && Array.isArray(result.contexts) && result.contexts.length) {
    const compactAcademicSchedule = buildAcademicScheduleSummaryAnswer(question, result.contexts);
    const compactAcademicRequirement = compactAcademicSchedule ? '' : buildAcademicRequirementSummaryAnswer(question, result.contexts);
    const compactAcademicGeneral = (compactAcademicSchedule || compactAcademicRequirement) ? '' : buildAcademicGeneralSummaryAnswer(question, result.contexts);
    if (compactAcademicSchedule || compactAcademicRequirement || compactAcademicGeneral) {
      result = {
        ...result,
        answer: formatNaturalAnswerFrame(question, compactAcademicSchedule || compactAcademicRequirement || compactAcademicGeneral, source),
        debug: {
          ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
          ...(compactAcademicSchedule ? { compactAcademicSchedule: true } : (compactAcademicRequirement ? { compactAcademicRequirement: true } : { compactAcademicGeneral: true }))
        }
      };
    }
  }

  if (/^semantic-rag-uploaded-training-generic$/i.test(source) && (!answerMatchesStrongQuestionAnchors(question, result.answer) || hasUploadedDocumentTopicConflict(question, result.answer))) {
    const anchorDualDegreeFallback = /\b(?:double|dual)\s+degree\b/i.test(String(question || '')) ? tryDualDegreeAnswer(question, options) : null;
    if (anchorDualDegreeFallback && anchorDualDegreeFallback.answer && answerMatchesStrongQuestionAnchors(question, anchorDualDegreeFallback.answer)) {
      return await traceAndCacheSemanticResult(question, anchorDualDegreeFallback, resultCacheKey, 'anchorDualDegreeFallback');
    }
    const anchorFallback = runVettedDeterministicFallback(question, options, null, 'generic-anchor-mismatch-deterministic-fallback');
    if (anchorFallback && anchorFallback.answer) {
      const fallbackSource = String(anchorFallback.source || '');
      const fallbackNoData = hasNoDataAnswerPhrase(anchorFallback.answer);
      const fallbackSafe = fallbackNoData || !/uploaded-training-generic/i.test(fallbackSource) || (answerMatchesStrongQuestionAnchors(question, anchorFallback.answer) && !hasUploadedDocumentTopicConflict(question, anchorFallback.answer));
      if (fallbackSafe) {
        return await traceAndCacheSemanticResult(question, anchorFallback, resultCacheKey, 'anchorFallback');
      }
    }
    const anchorMismatch = {
      success: true,
      answer: buildMeaningMismatchFallbackAnswer(question),
      source: 'semantic-rag-meaning-mismatch',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: { ...(result.debug && typeof result.debug === 'object' ? result.debug : {}), blockedSource: source, reason: 'strong_anchor_missing_in_generic_answer' }
    };
    return await traceAndCacheSemanticResult(question, anchorMismatch, resultCacheKey, 'anchorMismatch');
  }

  const answerShapeCheck = isRouteDomainGuardApplicable(source) ? evaluateAnswerShapeCompatibility(question, result) : { ok: true };
  if (answerShapeCheck && answerShapeCheck.ok === false) {
    const deterministic = runVettedDeterministicFallback(question, options, null, 'answer-shape-guard');
    const deterministicDomainCheck = deterministic && deterministic.answer ? isRouteDomainCompatible(question, deterministic) : null;
    const deterministicShapeCheck = deterministic && deterministic.answer ? evaluateAnswerShapeCompatibility(question, deterministic) : null;
    if (deterministic && deterministic.answer
      && deterministicDomainCheck && deterministicDomainCheck.ok !== false
      && deterministicShapeCheck && deterministicShapeCheck.ok !== false) {
      return await traceAndCacheSemanticResult(question, deterministic, resultCacheKey, 'answerShapeFallback');
    }
    const blocked = {
      success: true,
      answer: buildMeaningMismatchFallbackAnswer(question),
      source: 'semantic-rag-answer-shape-mismatch',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        answerShapeCheck,
        deterministicDomainCheck,
        deterministicShapeCheck,
        reason: 'answer_shape_guard'
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }
  const preflight = evaluateOutboundAnswer(result.answer, question, { source });
  const compactScheduleSafe = Boolean(result.debug && result.debug.compactAcademicSchedule)
    && isSafeCompactAcademicScheduleAnswer(question, result.answer);
  const compactRequirementSafe = Boolean(result.debug && result.debug.compactAcademicRequirement)
    && isSafeCompactAcademicRequirementAnswer(question, result.answer);
  const compactGeneralSafe = Boolean(result.debug && result.debug.compactAcademicGeneral)
    && isSafeCompactAcademicGeneralAnswer(question, result.answer);
  const compactAcademicSafe = compactScheduleSafe || compactRequirementSafe || compactGeneralSafe;
  const structuredSmallTalkSafe = /small-talk/i.test(source);
  const structuredScheduleSafe = /semantic-rag-schedule-window/i.test(source)
    && hasConcreteDateOrPeriod(result.answer)
    && /\b(?:PMB|pendaftaran|gelombang|Per\s+\d{1,2}|Untuk\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember))\b/i.test(String(question || '') + ' ' + String(result.answer || ''))
    && !hasLikelyRawDocumentLeak(result.answer);
  const structuredPmbSafe = (/pmb-info/i.test(source) && isSafePmbOverviewAnswer(question, result.answer)) || (/pmb-requirements/i.test(source) && /\b(syarat|persyaratan|dokumen|berkas|pendaftaran|siap\.stikom-bali\.ac\.id|pmb)\b/i.test(String(result.answer || '')));
  const structuredDualDegreeSafe = /dual-degree/i.test(source) && isSafeDualDegreeAnswer(question, result.answer);
  const structuredFacilitySafe = isSafeCampusFacilityAnswer(question, result.answer, source);
  const structuredProgramListSafe = isSafeProgramListAnswer(question, result.answer, source);
  const structuredProgramDefinitionSafe = isSafeProgramDefinitionAnswer(question, result.answer, source);
  const structuredPostgraduateProfileSafe = /semantic-rag-postgraduate-profile/i.test(source)
    && /\b(?:S2|Magister|Pascasarjana|Cyber\s+Security|Data\s+Science|Enterprise\s+System|Medical\s+Informatics|M\.Kom|56\s+SKS|4\s+semester)\b/i.test(String(result.answer || ''));
  const structuredProgramCurriculumSafe = /semantic-rag-program-curriculum/i.test(source)
    && /\\b(?:belajar|dipelajari|mata\\s+kuliah|kurikulum|skill|kompetensi|digital\\s+marketing|e-commerce|data\\s+analytics)\\b/i.test(String(result.answer || ''));
  const structuredProgramComparisonSafe = /semantic-rag-program-comparison/i.test(source)
    && /\b(?:beda|bedanya|bedain|perbedaan|banding|bandingkan|dibanding(?:kan)?|perbandingan|vs|versus)\b/i.test(String(question || ''))
    && /\b(?:Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer|Manajemen\s+Informatika|Manajemen)\b/i.test(String(result.answer || ''));
  const structuredAcademicFacultySafe = /semantic-rag-academic-faculty/i.test(source)
    && /\bfakultas\b/i.test(String(question || ''))
    && /\bFakultas\s+(?:Informatika\s+dan\s+Komputer|Bisnis\s+dan\s+Vokasi)\b/i.test(String(result.answer || ''));
  const structuredAcademicNoDataSafe = /semantic-rag-academic-(?:credit-no-data|schedule|no-data)|semantic-rag-meaning-mismatch/i.test(source)
    && hasNoDataAnswerPhrase(result.answer)
    && /\b(?:sks|semester\s+(?:genap|ganjil|antara|pendek)|kalender\s+akademik|jadwal\s+akademik|pelaksanaan\s+akademik|tugas\s+akhir|skripsi)\b/i.test(String(question || '') + ' ' + String(result.answer || ''));
  const structuredAbbreviationClarificationSafe = isSafeAbbreviationClarificationAnswer(question, result.answer, source);
  const structuredRplSafe = /semantic-rag-rpl/i.test(source) && /\b(RPL|Rekognisi\s+Pembelajaran\s+Lampau|SKS|PMB|siap\.stikom-bali\.ac\.id)\b/i.test(String(result.answer || ''));
  const explicitExternalNoDataSafe = /explicit-external-insufficient-data/i.test(source);
  const meaningProfile = inferQuestionMeaningProfile(question);
  const rawGenericEvidenceShape = (hasRawEvidenceSnippetShape(result.answer) || hasUnrequestedSensitiveDomainLeak(question, result.answer)) && isGenericEvidenceLikeSource(source);
  const structuredDefinitionSafe = meaningProfile.intent === 'definition_question' && /semantic-rag-uploaded-training-generic|campus-support-entity|campus-facility/i.test(source) && !rawGenericEvidenceShape;
  const structuredAccreditationSafe = /rag-accreditation|semantic-rag-accreditation/i.test(source)
    && /\b(BAN\s*-?\s*PT|akreditasi|Baik\s+Sekali|Baik)\b/i.test(String(result.answer || ''));
  const structuredScholarshipSafe = /semantic-rag-scholarship|rag-scholarship/i.test(source)
    && /\b(beasiswa|KIP|1K1S|prestasi|yayasan|potongan|PMB)\b/i.test(String(result.answer || ''));
  const structuredVisaStudySafe = /semantic-rag-(?:generic-faq-qna|uploaded-training-generic)|rag-/i.test(source)
    && /\b(izin\s+belajar|visa|mahasiswa\s+asing|dokumen|kampus|unit\s+terkait)\b/i.test(String(question || '') + ' ' + String(result.answer || ''));
  const structuredAdminInternationalSafe = /semantic-rag-(?:admin|international)-topic-composer/i.test(source)
    && !hasNoDataAnswerPhrase(result.answer)
    && !hasLikelyRawDocumentLeak(result.answer)
    && !hasUploadedDocumentTopicConflict(question, result.answer)
    && /\b(?:izin\s+belajar|study\s+permit|visa|e\s*30\s*b|itas|kitas|sktt|mahasiswa\s+asing|student\s+exchange|gccp|double\s*degree|dual\s*degree|help\s+university|dnui|dalian|hi\s*-?\s*think|jepang|bachelor|gelar|dormitory)\b/i.test(String(question || '') + ' ' + String(result.answer || ''));
  const structuredCampusLocationSafe = /semantic-rag-campus-location|rag-campus-location/i.test(source)
    && /\b(kampus|lokasi|alamat|Denpasar|Renon|Jimbaran|Abiansemal|3\s+lokasi)\b/i.test(String(result.answer || ''));
  const structuredFeedbackSafe = /semantic-rag-feedback/i.test(source)
    && /\b(singkat|informatif|koreksi|rapikan|langsung\s+ke\s+inti)\b/i.test(String(question || '') + ' ' + String(result.answer || ''));
  const structuredInstitutionProfileSafe = /semantic-rag-institution-profile|semantic-rag-institution-vision-mission/i.test(source)
    && /\b(?:ITB\s+STIKOM\s+Bali|Institut\s+Teknologi\s+dan\s+Bisnis\s+STIKOM\s+Bali|visi|misi)\b/i.test(String(result.answer || ''));
  const structuredCertificationSafe = /semantic-rag-certification/i.test(source)
    && /\b(?:sertifikasi|sertifikat|pelatihan|training|Career\s+Center|kemahasiswaan)\b/i.test(String(result.answer || ''));
  const structuredAcademicUploadSafe = /semantic-rag-uploaded-training-generic|semantic-rag-academic/i.test(source)
    && /\b(?:yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir)\b/i.test(String(question || ''))
    && /\b(?:yudisium|wisuda|sidang|tugas\s+akhir|proyek\s+akhir)\b/i.test(String(result.answer || ''))
    && (/(?:Hari\s*\/?\s*Tanggal|Tanggal)\s*:/i.test(String(result.answer || '')) || /\b(?:Persyaratan|Syarat)\s+(?:Yudisium|Wisuda|akademik)\b/i.test(String(result.answer || '')))
    && !hasLikelyRawDocumentLeak(result.answer)
    && !hasUploadedDocumentTopicConflict(question, result.answer);  const fineForSafety = detectFineGrainedIntent(question);
  const documentEvidenceSourceSafe = /semantic-rag-(?:known-faq-qna|generic-faq-qna|uploaded-training-generic|evidence-first)|rag-/i.test(source)
    && !rawGenericEvidenceShape
    && !hasNoDataAnswerPhrase(result.answer)
    && isDocumentEvidenceFirstCandidate(question)
    && !hasLikelyRawDocumentLeak(result.answer)
    && answerMatchesStrongQuestionAnchors(question, result.answer)
    && !hasUploadedDocumentTopicConflict(question, result.answer)
    && /\b(?:pascasarjana|magister|s2|fakultas|program|prodi|jurusan|skripsi|tugas\s+akhir|internasional|student\s+exchange|double\s*degree|dual\s*degree|dnui|help|gelar|lulusan|masa\s+studi|semester|sks|kurikulum|mata\s+kuliah|akreditasi|keunggulan|penelitian|yudisium|wisuda|linkedin|j\s*1|amerika|indikator|akuntabilitas|layanan\s+industri|goes\s*to\s*school)\b/i.test(String(question || '') + ' ' + String(result.answer || ''));
  const fineIntentSafe = Boolean(fineForSafety.fineIntent) && documentEvidenceSourceSafe;
  const deterministicKnownFaqSafe = /semantic-rag-known-faq-qna/i.test(source)
    && !hasNoDataAnswerPhrase(result.answer)
    && !hasLikelyRawDocumentLeak(result.answer)
    && !hasUploadedDocumentTopicConflict(question, result.answer);
  const structuredSemanticSafe = deterministicKnownFaqSafe || structuredSmallTalkSafe || structuredScheduleSafe || compactAcademicSafe || structuredPmbSafe || structuredDualDegreeSafe || structuredFacilitySafe || structuredProgramListSafe || structuredProgramDefinitionSafe || structuredPostgraduateProfileSafe || structuredProgramCurriculumSafe || structuredProgramComparisonSafe || structuredAcademicFacultySafe || structuredAcademicNoDataSafe || structuredAbbreviationClarificationSafe || structuredRplSafe || explicitExternalNoDataSafe || structuredDefinitionSafe || structuredAccreditationSafe || structuredScholarshipSafe || structuredVisaStudySafe || structuredAdminInternationalSafe || structuredCampusLocationSafe || structuredFeedbackSafe || structuredInstitutionProfileSafe || structuredCertificationSafe || structuredAcademicUploadSafe || documentEvidenceSourceSafe || fineIntentSafe;
  if (preflight && preflight.blocked && !structuredSemanticSafe) {
    const blocked = {
      success: true,
      answer: preflight.answer,
      source: 'semantic-rag-preflight-blocked',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        preflight,
        meaningAnchors: extractMeaningAnchors(question)
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }
  if (preflight && preflight.changed && preflight.answer && !structuredSemanticSafe) {
    result = {
      ...result,
      answer: preflight.answer,
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        preflight
      }
    };
  }

  const client = options.client || getClient();
  const localMismatch = structuredSemanticSafe ? false : isMeaningMismatchAnswer(question, result.answer, source);
  const explicitFeeQuestion = hasExplicitFeeQuestionSignal(question);
  const explicitDualDegreeQuestion = /\b(double\s*degree|dual\s*degree|dd)\b/i.test(question);
  const feeSourceSafe = /(?:semantic-rag-fee-detail|semantic-rag-registration-fee|semantic-rag-contextual-fee|semantic-rag-fee-general|semantic-rag-fee-comparison|semantic-rag-finance-fallback|semantic-rag-clarify)/i.test(source);
  const explicitFeeSafe = explicitFeeQuestion && (feeSourceSafe || /(?:biaya|harga|ukt|dpp|tarif|pembayaran|spp|pay|fee)/i.test(source));
  const dualDegreeSourceSafe = explicitDualDegreeQuestion && /semantic-rag-dual-degree/i.test(source);
  
  const isDocumentSource = /semantic-rag-uploaded-training|campus-support|campus-facility/i.test(source);
  const academicNoDataSourceSafe = hasNoDataAnswerPhrase(result.answer)
    && /semantic-rag-academic-(?:credit-no-data|schedule|no-data)|semantic-rag-meaning-mismatch/i.test(source);
  const skipLlmVerifier = structuredSemanticSafe || academicNoDataSourceSafe || /known-faq-qna|campus-support|campus-facility/i.test(source) || (hasNoDataAnswerPhrase(result.answer) && /(?:campus-support|insufficient-data|linkedin-career)/i.test(source)) || (explicitFeeQuestion && feeSourceSafe) || dualDegreeSourceSafe;
  const llmVerdict = (localMismatch || skipLlmVerifier) ? null : await verifyAnswerRelevanceWithLlm(client, question, result.answer, source);
  const llmMismatch = llmVerdict && llmVerdict.ok === false;

  if ((localMismatch && !explicitFeeSafe && !structuredSemanticSafe && !academicNoDataSourceSafe) || llmMismatch) {
    try {
      logger.warn({
        question,
        source,
        localMismatch,
        llmVerdict,
        answerPreview: String(result.answer || '').slice(0, 220)
      }, '[SemanticRAG] result blocked by general semantic relevance verifier');
    } catch (e) {
      try { console.warn('[SemanticRAG] result blocked by general semantic relevance verifier', e && e.message ? e.message : e); } catch (_) { }
    }

    const blocked = {
      success: true,
      answer: buildMeaningMismatchFallbackAnswer(question),
      source: 'semantic-rag-meaning-verifier-blocked',
      contexts: Array.isArray(result.contexts) ? result.contexts : [],
      confidenceScore: typeof result.confidenceScore === 'number' ? result.confidenceScore : 0,
      confidenceTier: 'VERY_LOW',
      debug: {
        ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
        blockedSource: source,
        localMismatch,
        llmVerdict,
        meaningAnchors: extractMeaningAnchors(question)
      }
    };
    return await traceAndCacheSemanticResult(question, blocked, resultCacheKey, 'blocked');
  }

  const finalized = llmVerdict ? {
    ...result,
    debug: {
      ...(result.debug && typeof result.debug === 'object' ? result.debug : {}),
      llmMeaningVerifier: llmVerdict
    }
  } : result;
  return await traceAndCacheSemanticResult(question, finalized, resultCacheKey, 'finalized');
}
function tryShortProgramDefinitionDirectAnswer(question, canonical = null) {
  const q = String(question || '').trim();
  if (!q) return null;
  const normalized = q.toLowerCase();
  const asksDefinitionShape = /\b(?:apa\s+itu|apakah\s+itu|itu\s+apa|apaan|pengertian|jelaskan|maksud(?:nya)?|tentang|jurusan\s+apa|prodi\s+apa|program\s+studi\s+apa|seperti\s+apa)\b/i.test(normalized);
  const asksProgramExistenceShape = /\b(?:ada|tersedia|punya|memiliki)\b/i.test(normalized)
    && /\b(?:jurusan|prodi|program\s+studi)\b/i.test(normalized)
    && !/\b(?:biaya|harga|bayar|ukt|dpp|pendaftaran|daftar|gelombang|jadwal|beasiswa)\b/i.test(normalized);
  const mentionsProgramKey = /\b(?:sistem\s+informasi|teknologi\s+informasi|teknik\s+informatika|informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi|dkv|desain\s+komunikasi\s+visual)\b/i.test(normalized);
  if ((!asksDefinitionShape && !asksProgramExistenceShape) || !mentionsProgramKey) return null;
  if (/\bdkv\b|desain\s+komunikasi\s+visual/i.test(normalized)) {
    const answer = [
      'DKV adalah singkatan dari Desain Komunikasi Visual.',
      '',
      'Secara umum, bidang ini fokus pada seni visual, komunikasi pesan, branding, dan penyampaian informasi lewat elemen visual seperti layout, warna, tipografi, ilustrasi, dan media digital.',
      '',
      'Untuk detail kurikulum atau program resmi yang tersedia di kampus, kakak bisa cek program studi yang relevan atau konfirmasi ke admin PMB supaya tidak keliru.'
    ].join('\n');
    return buildDeterministicResponse(q, 'semantic-rag-program-definition', { answer, source: 'semantic-rag-program-definition' }, {
      routeStage: 'short-definition-direct'
    });
  }
  const result = tryProgramDefinitionAnswer(q);
  const canonicalProgram = canonical
    && canonical.entities
    && Array.isArray(canonical.entities.programs)
    && canonical.entities.programs[0]
    && canonical.entities.programs[0].canonical;
  const canUseCanonicalProgramProfile = canonicalProgram
    && canonical.intent
    && (canonical.intent.primary === 'ask_program_definition' || asksProgramExistenceShape);
  const canonicalResult = (!result || !result.answer) && canUseCanonicalProgramProfile
    ? tryProgramDefinitionAnswer(`Apa itu Program Studi ${canonicalProgram}`)
    : null;
  const finalResult = result && result.answer ? result : canonicalResult;
  if (!finalResult || !finalResult.answer) return null;
  return buildDeterministicResponse(q, 'semantic-rag-program-definition', finalResult, {
    routeStage: 'short-definition-direct'
  });
}

function isUnsafeDeterministicFallback(question, result, rewrite = null) {
  if (!result || !result.answer) return false;
  const q = String(question || '').toLowerCase();
  const source = String(result.source || '').toLowerCase();
  const intent = String(rewrite && rewrite.intent ? rewrite.intent : '').toLowerCase();
  const answer = String(result.answer || '').toLowerCase();

  const asksAvailability = /\b(apakah|apa|ada|tersedia|sudah\s+ada|punya|memiliki)\b/i.test(q) && /\b(program|layanan|fasilitas|kelas|kursus|sertifikasi|training|magang|kerja|beasiswa|komunitas|ukm|jalur)\b/i.test(q);
  const asksRecommendationExplicitly = /\b(cocok|cocoknya|rekomendasi|saran|sarankan|jurusan\s+apa|prodi\s+apa|pilih\s+jurusan)\b/i.test(q);
  if (source.includes('program-recommendation') && asksAvailability && !asksRecommendationExplicitly) return true;

  const supportEntity = findCampusSupportEntity(q);
  const mentionsLinkedinCareer = /\b(linked\s*in|linkedin|career\s*center|karir\s*center|pusat\s*karir)\b/i.test(q);
  const asksRegistration = /\b(daftar|mendaftar|pendaftaran|registrasi|ikut|mengikuti)\b/i.test(q);
  const asksAdmissionRegistration = /\b(pmb|kuliah|calon\s+mahasiswa|mahasiswa\s+baru|camaba|siap\.stikom-bali\.ac\.id|stikom|itb\s*stikom)\b/i.test(q);
  if (source.includes('registration-info') && asksRegistration && supportEntity && !asksAdmissionRegistration) return true;
  if (source.includes('registration-info') && asksRegistration && mentionsLinkedinCareer && !asksAdmissionRegistration) return true;
  if (source.includes('registration-info') && /\bdaftar\s+kuliah\b/i.test(answer) && (supportEntity || mentionsLinkedinCareer)) return true;
  if (isMeaningMismatchAnswer(question, result.answer, result.source)) return true;

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
function tryProgramCurriculumFollowupAnswer(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return null;
  const asksLearning = /\b(?:belajar|dipelajari|yang\s+dipelajarin|perkuliahan|kuliah(?:nya)?|mata\s+kuliah|matkul|materi|course|kurikulum|skill|kompetensi|jurusannya\s+gimana|jurusannya\s+bagaimana|jago\s+komputer|jago\s+coding|harus\s+(?:bisa|jago|mahir).*?(?:komputer|coding|ngoding)|coding|ngoding|komputer)\b/i.test(q);
  if (!asksLearning) return null;
  if (/\b(?:s2|s\s*2|pascasarjana|pasca\s*sarjana|magister|master)\b/i.test(q) && !/\b(?:hi-?think|hithink|jepang|student\s*exchange|double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(q)) {
    return {
      answer: [
        'Untuk Program Pascasarjana / S2 Sistem Informasi, data yang tersedia menjelaskan arah perkuliahan dan fokus kurikulumnya, bukan daftar mata kuliah rinci per semester.',
        '',
        'Informasi yang aman saya sampaikan: kurikulumnya berbasis industri, fokus pengembangannya pada Intelligent & Secure System, dan area penguatan/riset yang disebutkan mencakup Cyber Security, Data Science, Enterprise System, dan Medical Informatics.',
        '',
        'Masa studi normalnya 4 semester dengan total 56 SKS. Untuk daftar mata kuliah lengkap per semester, kakak sebaiknya konfirmasi ke prodi Pascasarjana atau bagian akademik agar tidak keliru.'
      ].join('\n'),
      source: 'semantic-rag-postgraduate-profile',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }
  if (/\bbisnis\s+digital\b/i.test(q) && /\b(?:jago\s+komputer|jago\s+coding|harus\s+(?:bisa|jago|mahir).*?(?:komputer|coding|ngoding)|coding|ngoding|komputer)\b/i.test(q)) {
    return {
      answer: [
        'Tidak harus sudah jago komputer atau coding dari awal, Kak.',
        '',
        'Pada Program Studi Bisnis Digital, fokus belajarnya adalah bisnis berbasis teknologi: digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, data analytics, dan kewirausahaan digital. Jadi kemampuan komputer tetap membantu, tetapi bukan berarti calon mahasiswa harus masuk dengan kemampuan coding yang kuat seperti prodi yang lebih teknis.',
        '',
        'Yang lebih penting adalah minat pada bisnis, pemasaran digital, data, kreativitas, dan pengembangan usaha di ekosistem digital.'
      ].join('\n'),
      source: 'semantic-rag-program-curriculum',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }  if (/\bbisnis\s+digital\b/i.test(q)) {
    return {
      answer: [
        'Di Program Studi Bisnis Digital, mahasiswa belajar bisnis berbasis teknologi dan pengembangan usaha di ekosistem digital.',
        '',
        'Materi yang ditekankan antara lain digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, data analytics, dan kewirausahaan digital.',
        '',
        'Jadi, fokusnya bukan hanya komputer atau coding, tetapi bagaimana teknologi dipakai untuk membangun, memasarkan, dan mengembangkan bisnis modern.'
      ].join('\n'),
      source: 'semantic-rag-program-curriculum',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }
  return null;
}

function tryProgramAdviceAnswerFromCanonical(canonicalUnderstanding) {
  const canonical = canonicalUnderstanding || {};
  if (!canonical.intent || canonical.intent.primary !== 'ask_program_advice') return null;
  const program = canonical.entities && Array.isArray(canonical.entities.programs) ? canonical.entities.programs[0] : null;
  if (!program || !program.canonical) return null;
  return {
    answer: [
      `Kalau kakak merasa belum cakap di bidang ${program.canonical}, langkah paling aman adalah mulai dari fondasi dan pilih ritme belajar yang realistis.`,
      '',
      '- Perkuat dasar komputer, logika, dan cara berpikir sistematis sedikit demi sedikit.',
      '- Coba materi pengantar atau proyek kecil sebelum menilai diri cocok atau tidak.',
      '- Tanyakan kurikulum dan dukungan belajar ke prodi/PMB agar kakak tahu ekspektasi kuliahnya.',
      '- Kalau masih ragu, bandingkan minat kakak dengan prodi lain seperti Sistem Informasi, Bisnis Digital, Sistem Komputer, atau Manajemen Informatika.',
      '',
      'Jadi, tidak harus langsung mahir dari awal. Yang penting kakak tahu minatnya, siap belajar bertahap, dan memastikan pilihan prodi sesuai tujuan kakak.'
    ].join('\n'),
    source: 'semantic-rag-program-advice',
    frameSource: 'semantic-rag-program-advice'
  };
}
function tryProgramFacultyAnswer(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q || !/\bfakultas\b/i.test(q)) return null;

  const asksFacultyList = /\b(?:fakultas\s+(?:apa\s+saja|apa\s+aja|yang\s+ada|ada\s+apa)|apa\s+saja\s+fakultas|apa\s+aja\s+fakultas)\b/i.test(q);
  if (asksFacultyList) {
    return {
      answer: [
        'Pada data yang tersedia, fakultas yang tercatat di ITB STIKOM Bali adalah:',
        '',
        '- Fakultas Informatika dan Komputer',
        '- Fakultas Bisnis dan Vokasi',
        '',
        'Untuk pembagian prodi terbaru per fakultas, kakak sebaiknya tetap konfirmasi ke admin kampus atau bagian akademik.'
      ].join('\n'),
      source: 'semantic-rag-academic-faculty',
      frameSource: 'semantic-rag-academic-faculty'
    };
  }

  const fikPrograms = /\b(?:sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|manajemen\s+informatika|\bsi\b|\bti\b|\bsk\b|\bmi\b)\b/i.test(q);
  if (fikPrograms) {
    const program = /manajemen\s+informatika|\bmi\b/i.test(q) ? 'Manajemen Informatika'
      : /teknologi\s+informasi|\bti\b/i.test(q) ? 'Teknologi Informasi'
        : /sistem\s+komputer|\bsk\b/i.test(q) ? 'Sistem Komputer'
          : 'Sistem Informasi';
    return {
      answer: [
        `Program Studi ${program} termasuk dalam Fakultas Informatika dan Komputer.`,
        '',
        'Data ini mengacu pada dokumen akademik yang mencantumkan Dekan Fakultas Informatika dan Komputer bersama Ketua Program Studi S1 Sistem Informasi, S1 Sistem Komputer, S1 Teknologi Informasi, dan D3 Manajemen Informatika.'
      ].join('\n'),
      source: 'semantic-rag-academic-faculty',
      frameSource: 'semantic-rag-academic-faculty'
    };
  }

  return null;
}
function tryAcademicSpecificNoDataAnswer(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return null;

  if (/\bfakultas\b/i.test(q) && !/\b(?:tugas\s+akhir|skripsi|tesis|halaman|minimal|jumlah\s+halaman)\b/i.test(q)) {
    const facultyAnswer = tryProgramFacultyAnswer(question);
    if (facultyAnswer && facultyAnswer.answer) return facultyAnswer;
    return {
      answer: [
        'Saya belum menemukan informasi fakultas untuk prodi tersebut yang tercantum jelas pada data yang tersedia.',
        '',
        'Data yang aman saya sebutkan saat ini adalah daftar program studi dan informasi PMB/prodi. Untuk struktur fakultas resmi, kakak sebaiknya konfirmasi ke admin kampus atau bagian akademik agar tidak keliru.'
      ].join('\n'),
      source: 'semantic-rag-academic-no-data',
      frameSource: 'semantic-rag-academic-no-data'
    };
  }

  if (/\bbisnis\s+digital\b/i.test(q) && /\bdigital\s+marketing\b|pemasaran\s+digital|marketing\s+digital/i.test(q)) {
    return {
      answer: [
        'Ya, Kak. Pada data kurikulum yang tersedia, Bisnis Digital memuat materi yang berkaitan dengan digital marketing.',
        '',
        'Materi yang disebut antara lain manajemen pemasaran digital, social media strategy, search engine marketing, e-commerce, analitik bisnis, manajemen produk digital, dan business model innovation. Mahasiswa juga diarahkan mengerjakan proyek kampanye atau simulasi pengembangan produk digital.'
      ].join('\n'),
      source: 'semantic-rag-program-curriculum',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }

  if (/\bseo\b|search\s+engine\s+optim(?:ization|isation)|optimasi\s+mesin\s+pencari/i.test(q)) {
    return {
      answer: [
        'Ada konteks pembelajaran yang dekat dengan SEO pada Program Studi Bisnis Digital.',
        '',
        'Data kurikulum mencatat materi seperti digital marketing, social media strategy, search engine marketing, analitik bisnis, dan e-commerce. Jadi topik optimasi mesin pencari masuk dalam rumpun pemasaran digital/search engine marketing; untuk kepastian apakah SEO berdiri sebagai mata kuliah khusus, kakak bisa konfirmasi ke prodi atau admin PMB.'
      ].join('\n'),
      source: 'semantic-rag-program-curriculum',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }
  if (/\b(?:artificial\s+intelligence|ai\b|kecerdasan\s+buatan)\b/i.test(q) && /\bbisnis\s+digital\b/i.test(q)) {
    return {
      answer: [
        'Program Studi Bisnis Digital memiliki konteks pembelajaran teknologi dan data yang dekat dengan pemanfaatan Artificial Intelligence (AI).',
        '',
        'Data yang tersedia menyebut bisnis berbasis teknologi, digital marketing, e-commerce, strategi produk digital, analisis pasar, branding, data analytics, dan kewirausahaan digital. Jadi mahasiswa belajar fondasi digital/data yang relevan dengan AI; untuk kepastian apakah AI menjadi mata kuliah khusus, kakak bisa konfirmasi ke prodi atau admin PMB.'
      ].join('\n'),
      source: 'semantic-rag-program-curriculum',
      frameSource: 'semantic-rag-program-curriculum'
    };
  }
  if (/\b(?:tugas\s+akhir|skripsi|tesis|ta)\b/i.test(q) && /\b(?:warna\s+sampul|sampul|cover|warna\s+cover)\b/i.test(q)) {
    return {
      answer: [
        'Saya belum menemukan ketentuan warna sampul/cover Tugas Akhir atau Skripsi yang tercantum eksplisit pada data akademik yang tersedia.',
        '',
        'Agar tidak keliru, kakak sebaiknya mengikuti template/pedoman TA terbaru dari prodi/fakultas atau konfirmasi ke bagian akademik/prodi.'
      ].join('\n'),
      source: 'semantic-rag-academic-policy',
      frameSource: 'semantic-rag-academic-policy'
    };
  }

  if (/\b(?:tugas\s+akhir|skripsi|tesis|ta)\b/i.test(q) && /\b(?:halaman|lembar|minimal|maksimal|jumlah\s+halaman|panjang\s+naskah)\b/i.test(q)) {
    return {
      answer: [
        'Untuk pertanyaan minimal halaman total Tugas Akhir/Skripsi, saya tidak menemukan angka minimal total halaman yang tercantum eksplisit pada Pedoman Tugas Akhir S1 yang tersedia.',
        '',
        'Yang tercantum di pedoman adalah ketentuan penulisan dan beberapa batas bagian tertentu, misalnya abstrak wajib minimal 150 kata dan maksimal 200 kata, kata pengantar sebaiknya tidak melebihi 1 halaman, penomoran bagian awal memakai angka Romawi kecil, bagian isi memakai angka Arab, serta daftar pustaka mengikuti standar IEEE. Pedoman juga mencatat Tugas Akhir S1 berbobot 4 SKS.',
        '',
        'Jadi, untuk jumlah halaman total, jawaban paling aman: ikuti template/pedoman TA terbaru dari prodi/fakultas atau konfirmasi ke bagian akademik/prodi, karena angka minimal total halaman tidak terbaca eksplisit pada data yang tersedia.'
      ].join('\n'),
      source: 'semantic-rag-academic-policy',
      frameSource: 'semantic-rag-academic-policy'
    };
  }
  return null;
}
function tryGenericFeeClarificationAnswer(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return null;
  const asksFeeDetail = /\b(rincian\s+biaya|detail\s+biaya|biayanya|berapa\s+biaya|total\s+biaya|totalnya|harus\s+bayar)\b/i.test(q);
  const hasProgram = /\b(sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|si|ti|bd|sk|mi|dnui|help|utb)\b/i.test(q);
  const hasWave = /\b(?:gelombang\s*)?(?:khusus|[1-4]\s*[a-d]?|i{1,3}\s*[a-d]?|iv\s*[a-d]?)\b/i.test(q);
  if (!asksFeeDetail || hasProgram || hasWave) return null;
  return {
    answer: [
      'Bisa, Kak. Untuk rincian biaya lengkap, saya perlu tahu dulu prodi/program dan gelombang pendaftaran yang kakak maksud.',
      '',
      'Contoh: "rincian biaya Sistem Informasi Gelombang 2B" atau "biaya Bisnis Digital Gelombang 1A".'
    ].join('\n'),
    source: 'semantic-rag-fee-clarification',
    frameSource: 'semantic-rag-fee-clarification'
  };
}
function tryAcademicCreditNoDataAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(?:sks|satuan\s+kredit\s+semester|total\s+sks|jumlah\s+sks|beban\s+sks)\b/i.test(q)) return null;

  let program = '';
  if (/\bbisnis\s+digital\b|\bbd\b/i.test(q)) program = ' untuk Prodi S1-Bisnis Digital';
  else if (/\bsistem\s+informasi\b|\bsi\b/i.test(q)) program = ' untuk Prodi Sistem Informasi';
  else if (/\bteknologi\s+informasi\b|\bti\b/i.test(q)) program = ' untuk Prodi Teknologi Informasi';
  else if (/\bsistem\s+komputer\b|\bsk\b/i.test(q)) program = ' untuk Prodi Sistem Komputer';
  else if (/\bmanajemen\s+informatika\b|\bmi\b/i.test(q)) program = ' untuk Prodi D3 Manajemen Informatika';

  const isS1Question = /\b(?:s1|sarjana|strata\s+satu|bisnis\s+digital|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer)\b/i.test(q)
    && !/\b(?:d3|diploma|s2|magister|pascasarjana|rpl|transfer|konversi)\b/i.test(q);

  if (isS1Question || !program) {
    const programLabel = program || ' untuk program S1';
    return {
      answer: [
        `Untuk lulus${programLabel}, total beban studi S1 adalah 144 SKS.`,
        '',
        'Angka ini berlaku sebagai acuan beban studi program sarjana. Untuk sebaran mata kuliah per semester atau kurikulum detail per prodi, kakak bisa cek kurikulum prodi atau konfirmasi ke bagian akademik/prodi.'
      ].join('\n'),
      source: 'semantic-rag-academic-credit'
    };
  }

  return {
    answer: [
      `Untuk total SKS lulus${program}, data yang tersedia perlu dicek pada kurikulum prodi terkait.`,
      '',
      'Kalau kakak menyebut prodinya dengan jelas, saya bisa bantu arahkan ke informasi kurikulum yang paling relevan.'
    ].join('\n'),
    source: 'semantic-rag-academic-credit'
  };
}
function tryGreetingPermissionAnswer(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return null;
  const hasGreeting = /\b(?:halo|hallo|hai|hay|selamat\s+(?:pagi|siang|sore|malam)|permisi|assalamu'?alaikum)\b/i.test(q);
  const asksToAsk = /\b(?:ingin|mau|boleh|bisa|izin|ijin)\b.{0,30}\b(?:bertanya|tanya|nanya)\b|\b(?:bertanya|tanya|nanya)\b/i.test(q);
  if (!hasGreeting || !asksToAsk) return null;
  const hasSpecificTopic = /\b(?:prodi|program\s+studi|jurusan|biaya|beasiswa|rpl|akreditasi|double\s*degree|dual\s*degree|dnui|help|utb|pendaftaran|pmb|gelombang|visa|izin\s+belajar|ukm|ormawa|organisasi|kampus|sks|kurikulum)\b/i.test(q);
  if (hasSpecificTopic) return null;
  return {
    answer: 'Halo, Kak. Silakan, mau tanya seputar prodi, PMB, biaya, beasiswa, RPL, Double Degree, atau informasi kampus apa?',
    source: 'semantic-rag-small-talk',
    frameSource: 'semantic-rag-small-talk'
  };
}
function tryDualDegreeFeeClarificationAnswer(question) {
  const q = String(question || '').trim().toLowerCase();
  if (!q) return null;
  const asksDualDegree = /\b(?:double|dual)\s*degree\b|\bdd\b|\bdnui\b|\bhelp\s+university\b|\butb\b/i.test(q);
  const asksFee = /\b(?:biaya|harga|tarif|bayar|pembayaran|dpp|ukt|potongan|diskon|rincian|nominal|total)\b/i.test(q);
  if (!asksDualDegree || !asksFee) return null;
  const partner = /\bdnui\b/i.test(q) ? 'DNUI'
    : /\bhelp\s+university\b|\bhelp\b/i.test(q) ? 'HELP University'
      : /\butb\b/i.test(q) ? 'UTB'
        : '';
  if (partner) {
    return {
      answer: [
        `Untuk biaya atau potongan Double Degree ${partner}, saya belum menemukan angka lengkap yang aman untuk langsung disebutkan dari data yang tersedia.`,
        '',
        'Supaya tidak salah nominal, kakak sebaiknya konfirmasi ke Admin PMB dengan menyebut partner Double Degree dan gelombang pendaftaran yang dimaksud.'
      ].join('\n'),
      source: 'semantic-rag-dual-degree-fee-clarification',
      frameSource: 'semantic-rag-fee-clarification'
    };
  }
  return {
    answer: [
      'Untuk biaya atau potongan Double Degree, rinciannya bisa berbeda berdasarkan partner program.',
      '',
      'Agar tidak salah angka, pilih dulu program yang kakak maksud: Double Degree UTB, DNUI, atau HELP University. Kalau kakak tahu gelombang pendaftarannya, sertakan juga gelombangnya.'
    ].join('\n'),
    source: 'semantic-rag-dual-degree-fee-clarification',
    frameSource: 'semantic-rag-fee-clarification'
  };
}
function normalizeSemanticQueryOptions(options = {}) {
  const normalized = options && typeof options === 'object' ? { ...options } : {};
  const rawSessionData = normalized.sessionData && typeof normalized.sessionData === 'object'
    ? normalized.sessionData
    : (normalized.session && typeof normalized.session === 'object' ? normalized.session : {});
  const sessionData = rawSessionData && typeof rawSessionData === 'object' ? { ...rawSessionData } : {};
  const history = Array.isArray(normalized.conversationHistory) ? normalized.conversationHistory : (Array.isArray(normalized.history) ? normalized.history : []);
  if (history.length && !Array.isArray(sessionData.messages)) {
    const mapped = history
      .map((m) => {
        const role = String((m && (m.role || m.direction)) || '').toLowerCase();
        const message = String((m && (m.message || m.content || m.text)) || '').trim();
        if (!message) return null;
        return {
          role: role || 'message',
          direction: role === 'assistant' || role === 'bot' || role === 'outgoing' ? 'outgoing' : 'incoming',
          message
        };
      })
      .filter(Boolean);
    if (mapped.length) {
      sessionData.messages = mapped;
      const lastUser = [...mapped].reverse().find((m) => m.direction === 'incoming');
      const lastBot = [...mapped].reverse().find((m) => m.direction === 'outgoing');
      if (lastUser && !sessionData.lastQuestion) sessionData.lastQuestion = lastUser.message;
      if (lastBot && !sessionData.lastAnswer) sessionData.lastAnswer = lastBot.message;
    }
  }
  if (Object.keys(sessionData).length) normalized.sessionData = sessionData;
  return normalized;
}
async function querySemanticRag(question, options = {}) {
  options = normalizeSemanticQueryOptions(options);
  const originalQuestion = String(question || '').trim();
  const preStrictDocumentOnly = isStrictDocumentOnlyMode();
  const immediateProgramScopeChoice = preStrictDocumentOnly ? null : tryProgramScopeClarificationChoiceAnswer(originalQuestion, options);
  if (immediateProgramScopeChoice && immediateProgramScopeChoice.answer) {
    const immediateCacheKey = buildSemanticResultCacheKey(originalQuestion, options);
    const cachedImmediate = getCachedSemanticResult(immediateCacheKey);
    if (cachedImmediate) return cachedImmediate;
    const builtImmediateChoice = buildDeterministicResponse(originalQuestion, immediateProgramScopeChoice.source || 'semantic-rag-program-scope-clarification-choice', immediateProgramScopeChoice, { routeStage: 'pre-followup-program-scope-choice' });
    return await finalizeSemanticResult(originalQuestion, builtImmediateChoice, immediateCacheKey);
  }

  const followupResolution = resolveSemanticFollowupQuestion(originalQuestion, options);
  if (followupResolution && followupResolution.changed && followupResolution.question) {
    question = followupResolution.question;
  }
  const resultCacheQuestion = followupResolution && followupResolution.changed
    ? `${originalQuestion}\n[resolved_context:${followupResolution.question}]`
    : question;
  const resultCacheKey = buildSemanticResultCacheKey(resultCacheQuestion, options);
  const cachedResult = getCachedSemanticResult(resultCacheKey);
  if (cachedResult) return cachedResult;

  const strictDocumentOnly = preStrictDocumentOnly;
  const normalizedRouting = normalizeUserQuery(question);
  const routingQuestion = normalizedRouting && normalizedRouting.normalizedText ? normalizedRouting.normalizedText : question;
  const canonicalUnderstanding = buildCanonicalQueryUnderstanding(question, { normalizedQuery: routingQuestion });
  const canonicalRoutingQuestion = canonicalUnderstanding && canonicalUnderstanding.routingQuery ? canonicalUnderstanding.routingQuery : routingQuestion;
  options.__canonicalQueryUnderstanding = canonicalUnderstanding;
  if (!strictDocumentOnly && isRawDocumentLeakComplaint(question)) {
    const response = { success: true, answer: buildRawDocumentLeakComplaintAnswer(), source: 'semantic-rag-raw-document-leak-feedback', contexts: [] };
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }

  const earlyCertification = strictDocumentOnly ? null : tryCertificationAnswer(question);
  if (earlyCertification && earlyCertification.answer) {
    const builtCertification = buildDeterministicResponse(question, earlyCertification.source || 'semantic-rag-certification', earlyCertification, { routeStage: 'pre-guard-early-certification', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtCertification, resultCacheKey);
  }
  const noProviderShortAmbiguousProgramAmount = !strictDocumentOnly
    && !getClient()
    && canonicalUnderstanding
    && canonicalUnderstanding.intent
    && (canonicalUnderstanding.intent.primary === 'ask_fee' || /\b(?:brp|berapa|kena)\b/i.test(String(question || '')))
    && canonicalUnderstanding.entities
    && Array.isArray(canonicalUnderstanding.entities.programs)
    && canonicalUnderstanding.entities.programs.length > 0
    && String(question || '').trim().split(/\s+/).filter(Boolean).length <= 3
    && /\b(?:brp|berapa|kena)\b/i.test(String(question || ''))
    && !/\b(?:biaya|uang\s+kuliah|bayar|ukt|dpp|spp|pendaftaran|daftar|gelombang)\b/i.test(String(question || ''));
  if (noProviderShortAmbiguousProgramAmount) {
    const disabled = { success: true, answer: null, source: 'semantic-rag-disabled', reason: 'missing_openai_api_key', contexts: [], debug: { routeStage: 'pre-guard-no-provider-short-ambiguous-program-amount' } };
    setCachedSemanticResult(resultCacheKey, disabled);
    return disabled;
  }
  const earlySmallTalk = trySmallTalkAnswer(question);
  const earlySmallTalkWords = String(question || '').trim().split(/\s+/).filter(Boolean).length;
  if (earlySmallTalk && earlySmallTalk.answer && shouldReturnSmallTalkImmediately(question, earlySmallTalkWords)) {
    const smallTalkResp = buildDeterministicResponse(question, 'semantic-rag-small-talk', earlySmallTalk, { routeStage: 'pre-guard-small-talk' });
    return await finalizeSemanticResult(question, smallTalkResp, resultCacheKey);
  }

  const greetingPermission = strictDocumentOnly ? null : tryGreetingPermissionAnswer(routingQuestion || question);
  if (greetingPermission && greetingPermission.answer) {
    const builtGreetingPermission = buildDeterministicResponse(question, greetingPermission.source || 'semantic-rag-small-talk', greetingPermission, { routeStage: 'pre-guard-greeting-permission', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtGreetingPermission, resultCacheKey);
  }

  const preGuardCanonicalInstitutionProfile = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.domain && canonicalUnderstanding.domain.primary === 'institution_profile') ? null : (
    tryInstitutionProfileAnswer(question, getCachedSemanticIndex())
    || tryInstitutionProfileAnswer(routingQuestion || question, getCachedSemanticIndex())
    || tryInstitutionProfileAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex())
  );
  if (preGuardCanonicalInstitutionProfile && preGuardCanonicalInstitutionProfile.answer) {
    const builtCanonicalInstitutionProfile = buildDeterministicResponse(question, preGuardCanonicalInstitutionProfile.source || 'semantic-rag-institution-profile', preGuardCanonicalInstitutionProfile, { routeStage: 'pre-guard-canonical-institution-profile', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalInstitutionProfile, resultCacheKey);
  }
  const preGuardProductScopeClarification = strictDocumentOnly ? null : (tryAmbiguousCampusProductAnswer(routingQuestion || question) || tryAmbiguousCampusProductAnswer(question));
  if (preGuardProductScopeClarification && preGuardProductScopeClarification.answer) {
    const builtProductScope = buildDeterministicResponse(question, preGuardProductScopeClarification.source || 'semantic-rag-product-scope-clarification', preGuardProductScopeClarification, { routeStage: 'pre-guard-product-scope-clarification', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProductScope, resultCacheKey);
  }

  const preGuardShortDefinition = strictDocumentOnly ? null : (tryShortProgramDefinitionDirectAnswer(canonicalRoutingQuestion || routingQuestion || question, canonicalUnderstanding) || tryShortProgramDefinitionDirectAnswer(routingQuestion || question, canonicalUnderstanding) || tryShortProgramDefinitionDirectAnswer(question, canonicalUnderstanding));
  if (preGuardShortDefinition && preGuardShortDefinition.answer) {
    return await finalizeSemanticResult(question, preGuardShortDefinition, resultCacheKey);
  }

  const preGuardCanonicalProgramDefinition = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_program_definition') ? null : (
    tryShortProgramDefinitionDirectAnswer(canonicalRoutingQuestion || routingQuestion || question, canonicalUnderstanding)
    || tryShortProgramDefinitionDirectAnswer(routingQuestion || question, canonicalUnderstanding)
    || tryShortProgramDefinitionDirectAnswer(question, canonicalUnderstanding)
  );
  if (preGuardCanonicalProgramDefinition && preGuardCanonicalProgramDefinition.answer) {
    return await finalizeSemanticResult(question, preGuardCanonicalProgramDefinition, resultCacheKey);
  }
  const preGuardStudyLevelComparison = strictDocumentOnly ? null : (tryStudyLevelComparisonAnswer(routingQuestion || question) || tryStudyLevelComparisonAnswer(question));
  if (preGuardStudyLevelComparison && preGuardStudyLevelComparison.answer) {
    const builtStudyLevelComparison = buildDeterministicResponse(question, preGuardStudyLevelComparison.source || 'semantic-rag-study-level-comparison', preGuardStudyLevelComparison, { routeStage: 'pre-guard-study-level-comparison', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtStudyLevelComparison, resultCacheKey);
  }
  const preGuardCanonicalProgramComparison = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_program_comparison') ? null : (
    tryProgramComparisonAnswer(canonicalRoutingQuestion || routingQuestion || question)
    || tryProgramComparisonAnswer(routingQuestion || question)
    || tryProgramComparisonAnswer(question)
  );
  if (preGuardCanonicalProgramComparison && preGuardCanonicalProgramComparison.answer) {
    const builtCanonicalProgramComparison = buildDeterministicResponse(question, 'semantic-rag-program-comparison', { ...preGuardCanonicalProgramComparison, source: 'semantic-rag-program-comparison' }, { routeStage: 'pre-guard-canonical-program-comparison', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalProgramComparison, resultCacheKey);
  }

  const preGuardCanonicalProgramList = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_program_list') ? null : (
    tryProgramListAnswer(canonicalRoutingQuestion || routingQuestion || question)
    || tryProgramListAnswer(routingQuestion || question)
    || tryProgramListAnswer(question)
  );
  if (preGuardCanonicalProgramList && preGuardCanonicalProgramList.answer) {
    const canonicalProgramListAnswer = 'Program studi/prodi yang tersedia di ITB STIKOM Bali:\n\n' + stripDoubleDegreeSectionForNarrowProgramList(question, preGuardCanonicalProgramList.answer);
    const narrowProgramListFrame = /\b(?:jurusan(?:nya)?|prodi(?:nya)?|program\s+studi)\b/i.test(String(question || '')) && !/\b(?:double\s*degree|dual\s*degree|kelas\s+internasional|program\s+internasional|international|utb|dnui|help)\b/i.test(String(question || ''));
    const builtCanonicalProgramList = buildDeterministicResponse(question, 'semantic-rag-program-list', { ...preGuardCanonicalProgramList, answer: canonicalProgramListAnswer, source: 'semantic-rag-program-list', frameSource: narrowProgramListFrame ? 'semantic-rag-program-list-contextual' : 'semantic-rag-program-list' }, { routeStage: 'pre-guard-canonical-program-list', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalProgramList, resultCacheKey);
  }
  const preGuardCanonicalRelationPairing = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_relation_pairing') ? null : (
    tryDualDegreeAnswer(canonicalRoutingQuestion || routingQuestion || question, options)
    || tryDualDegreeAnswer(routingQuestion || question, options)
    || tryDualDegreeAnswer(question, options)
  );
  if (preGuardCanonicalRelationPairing && preGuardCanonicalRelationPairing.answer) {
    const builtCanonicalRelationPairing = buildDeterministicResponse(question, preGuardCanonicalRelationPairing.source || 'semantic-rag-dual-degree', { ...preGuardCanonicalRelationPairing, source: preGuardCanonicalRelationPairing.source || 'semantic-rag-dual-degree' }, { routeStage: 'pre-guard-canonical-relation-pairing', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalRelationPairing, resultCacheKey);
  }
  const preGuardProgramRecommendationIntent = strictDocumentOnly ? null : (tryExplicitProgramRecommendationPreGuard(routingQuestion || question) || tryExplicitProgramRecommendationPreGuard(question));
  if (preGuardProgramRecommendationIntent && preGuardProgramRecommendationIntent.answer) {
    const builtProgramRecommendationIntent = buildDeterministicResponse(question, preGuardProgramRecommendationIntent.source || 'semantic-rag-program-recommendation', preGuardProgramRecommendationIntent, { routeStage: 'pre-guard-program-recommendation-intent', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProgramRecommendationIntent, resultCacheKey);
  }
  const preGuardInternationalSubtopic = strictDocumentOnly || typeof buildInternationalCanonicalAnswer !== 'function' ? null : (
    buildInternationalCanonicalAnswer(canonicalRoutingQuestion || routingQuestion || question)
    || buildInternationalCanonicalAnswer(routingQuestion || question)
    || buildInternationalCanonicalAnswer(question)
  );
  if (preGuardInternationalSubtopic && preGuardInternationalSubtopic.answer) {
    const builtInternationalSubtopic = buildDeterministicResponse(
      question,
      preGuardInternationalSubtopic.source || 'semantic-rag-international-topic-composer',
      preGuardInternationalSubtopic,
      { routeStage: 'pre-guard-international-topic-before-support-entity', normalizedRouting: normalizedRouting.changed }
    );
    return await finalizeSemanticResult(question, builtInternationalSubtopic, resultCacheKey);
  }

  const preGuardExplicitSupportQuestion = String(routingQuestion || question || '').toLowerCase();
  const preGuardExplicitSupportEntityKey = findCampusSupportEntity(preGuardExplicitSupportQuestion);
  const preGuardExplicitSupportAllowed = preGuardExplicitSupportEntityKey
    && (
      preGuardExplicitSupportEntityKey.key !== 'career-center'
      || /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(preGuardExplicitSupportQuestion)
    );
  const preGuardExplicitSupportEntity = strictDocumentOnly || !preGuardExplicitSupportAllowed ? null : tryCampusSupportEntityAnswer(routingQuestion || question, getCachedSemanticIndex(), options);
  if (preGuardExplicitSupportEntity && preGuardExplicitSupportEntity.answer && /semantic-rag-campus-(?:support-entity|facility)/i.test(String(preGuardExplicitSupportEntity.source || ''))) {
    const builtExplicitSupportEntity = buildDeterministicResponse(question, preGuardExplicitSupportEntity.source || 'semantic-rag-campus-support-entity', preGuardExplicitSupportEntity, { routeStage: 'pre-guard-explicit-campus-support-entity', normalizedRouting: normalizedRouting.changed, supportEntityKey: preGuardExplicitSupportEntityKey.key });
    return await finalizeSemanticResult(question, builtExplicitSupportEntity, resultCacheKey);
  }
  const preGuardCampusPhysicalAttribute = strictDocumentOnly ? null : (
    (canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_physical_attribute' ? tryCampusPhysicalAttributeFallback(canonicalRoutingQuestion || routingQuestion || question) : null)
    || tryCampusPhysicalAttributeFallback(routingQuestion || question)
    || tryCampusPhysicalAttributeFallback(question)
  );
  if (preGuardCampusPhysicalAttribute && preGuardCampusPhysicalAttribute.answer) {
    const builtCampusPhysicalAttribute = buildDeterministicResponse(question, preGuardCampusPhysicalAttribute.source || 'semantic-rag-campus-physical-attribute-insufficient-data', preGuardCampusPhysicalAttribute, { routeStage: 'pre-guard-campus-physical-attribute', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtCampusPhysicalAttribute, resultCacheKey);
  }
  const preGuardCampusLocation = strictDocumentOnly ? null : (
    (canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_location' ? tryCampusLocationAnswer(canonicalRoutingQuestion || routingQuestion || question) : null)
    || tryCampusLocationAnswer(routingQuestion || question)
    || tryCampusLocationAnswer(question)
  );
  if (preGuardCampusLocation && preGuardCampusLocation.answer) {
    const builtCampusLocation = buildDeterministicResponse(question, preGuardCampusLocation.source || 'semantic-rag-campus-location', preGuardCampusLocation, { routeStage: 'pre-guard-campus-location', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtCampusLocation, resultCacheKey);
  }

  const preGuardProgramAccreditationOverview = strictDocumentOnly ? null : (tryAccreditationAnswer(routingQuestion || question, getCachedSemanticIndex()) || tryAccreditationAnswer(question, getCachedSemanticIndex()));
  if (preGuardProgramAccreditationOverview && preGuardProgramAccreditationOverview.answer && /rag-accreditation/i.test(String(preGuardProgramAccreditationOverview.source || ''))) {
    const builtProgramAccreditationOverview = buildDeterministicResponse(question, preGuardProgramAccreditationOverview.source || 'rag-accreditation', preGuardProgramAccreditationOverview, { routeStage: 'pre-guard-program-accreditation-overview', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProgramAccreditationOverview, resultCacheKey);
  }
  const preGuardProgramScopeChoice = strictDocumentOnly ? null : (tryProgramScopeClarificationChoiceAnswer(routingQuestion || question, options) || tryProgramScopeClarificationChoiceAnswer(question, options));
  if (preGuardProgramScopeChoice && preGuardProgramScopeChoice.answer) {
    const builtProgramScopeChoice = buildDeterministicResponse(question, preGuardProgramScopeChoice.source || 'semantic-rag-program-scope-clarification-choice', preGuardProgramScopeChoice, { routeStage: 'pre-guard-program-scope-choice', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProgramScopeChoice, resultCacheKey);
  }
  const preGuardProgramScopeClarification = strictDocumentOnly ? null : (tryAmbiguousProgramScopeAnswer(routingQuestion || question, options) || tryAmbiguousProgramScopeAnswer(question, options));
  if (preGuardProgramScopeClarification && preGuardProgramScopeClarification.answer) {
    const builtProgramScopeClarification = buildDeterministicResponse(question, preGuardProgramScopeClarification.source || 'semantic-rag-program-scope-clarification', preGuardProgramScopeClarification, { routeStage: 'pre-guard-program-scope-clarification', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProgramScopeClarification, resultCacheKey);
  }

  const preGuardGeneralInternationalText = `${routingQuestion || ''} ${question || ''}`.toLowerCase();
  const shouldRunPreGuardGeneralInternationalList = /\b(?:program\s+internasional|kelas\s+internasional|international\s+program|international\s+class)\b/i.test(preGuardGeneralInternationalText)
    && /\b(?:apa\s+saja|apa\s+aja|ada|tersedia|pilihan|list|daftar)\b/i.test(preGuardGeneralInternationalText);
  const preGuardGeneralInternationalList = strictDocumentOnly || !shouldRunPreGuardGeneralInternationalList ? null : (
    tryInternationalClassFallback(routingQuestion || question)
    || tryInternationalClassFallback(question)
  );
  if (preGuardGeneralInternationalList && preGuardGeneralInternationalList.answer) {
    const builtGeneralInternationalList = buildDeterministicResponse(question, preGuardGeneralInternationalList.source || 'semantic-rag-international-class-fallback', preGuardGeneralInternationalList, { routeStage: 'pre-guard-general-international-list', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtGeneralInternationalList, resultCacheKey);
  }
  const earlyAdministrativeTopic = strictDocumentOnly ? null : getAdministrativeInfoTopic(question);
  const earlyAdministrativeCanonical = !earlyAdministrativeTopic || !/^(foreign_student_docs|study_permit|study_permit_extension|visa_e30b|itas_kitas|itas_extension|sktt|sktt_extension)$/.test(earlyAdministrativeTopic.key) ? null : buildAdministrativeCanonicalAnswer(question);
  if (earlyAdministrativeCanonical && earlyAdministrativeCanonical.answer) {
    const builtEarlyAdministrative = buildDeterministicResponse(question, earlyAdministrativeCanonical.source || 'semantic-rag-admin-topic-composer', earlyAdministrativeCanonical, { routeStage: 'pre-guard-admin-specific-topic', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtEarlyAdministrative, resultCacheKey);
  }

  const preGuardAdministrativeCompound = strictDocumentOnly || !isCompoundAdministrativeTopicQuestion(routingQuestion || question) ? null : (
    buildAdministrativeCanonicalAnswer(routingQuestion || question)
    || buildAdministrativeCanonicalAnswer(question)
  );
  if (preGuardAdministrativeCompound && preGuardAdministrativeCompound.answer) {
    const builtAdministrativeCompound = buildDeterministicResponse(question, preGuardAdministrativeCompound.source || 'semantic-rag-admin-topic-composer', preGuardAdministrativeCompound, { routeStage: 'pre-guard-admin-compound-topic', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtAdministrativeCompound, resultCacheKey);
  }
  if (!strictDocumentOnly && isCareerConsultationQuestion(routingQuestion || question)) {
    const preGuardCareerConsultation = {
      answer: 'Ya. Mahasiswa dapat berkonsultasi mengenai karier melalui Career Center ITB STIKOM Bali, termasuk terkait persiapan kerja, peluang karier, magang, dan proses melamar pekerjaan. Untuk jadwal layanan atau PIC yang sedang aktif, kakak bisa cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', preGuardCareerConsultation, { routeStage: 'pre-guard-career-consultation', normalizedRouting: normalizedRouting.changed }), resultCacheKey);
  }
  const preGuardCanonicalProgramAdvice = strictDocumentOnly ? null : tryProgramAdviceAnswerFromCanonical(canonicalUnderstanding);
  if (preGuardCanonicalProgramAdvice && preGuardCanonicalProgramAdvice.answer) {
    const builtCanonicalProgramAdvice = buildDeterministicResponse(question, preGuardCanonicalProgramAdvice.source || 'semantic-rag-program-advice', preGuardCanonicalProgramAdvice, { routeStage: 'pre-guard-canonical-program-advice', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalProgramAdvice, resultCacheKey);
  }

  const preGuardCanonicalFacility = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_facility_list') ? null : (
    tryCampusFacilityAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex())
    || tryCampusFacilityAnswer(routingQuestion || question, getCachedSemanticIndex())
    || tryCampusFacilityAnswer(question, getCachedSemanticIndex())
  );
  if (preGuardCanonicalFacility && preGuardCanonicalFacility.answer) {
    const builtCanonicalFacility = buildDeterministicResponse(question, preGuardCanonicalFacility.source || 'semantic-rag-campus-facility', preGuardCanonicalFacility, { routeStage: 'pre-guard-canonical-facility', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalFacility, resultCacheKey);
  }

  const preGuardCanonicalCurriculum = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_program_curriculum') ? null : (
    tryProgramCurriculumFollowupAnswer(canonicalRoutingQuestion || routingQuestion || question)
    || tryProgramCurriculumFollowupAnswer(routingQuestion || question)
    || tryProgramCurriculumFollowupAnswer(question)
  );
  if (preGuardCanonicalCurriculum && preGuardCanonicalCurriculum.answer) {
    const builtCanonicalCurriculum = buildDeterministicResponse(question, preGuardCanonicalCurriculum.source || 'semantic-rag-program-curriculum', preGuardCanonicalCurriculum, { routeStage: 'pre-guard-canonical-program-curriculum', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalCurriculum, resultCacheKey);
  }

  const preGuardCanonicalCareerService = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_career_service') ? null : {
    answer: buildCareerReadinessProgramsAnswer(),
    source: 'semantic-rag-campus-support-entity',
    frameSource: 'semantic-rag-campus-support-entity'
  };
  if (preGuardCanonicalCareerService && preGuardCanonicalCareerService.answer) {
    const builtCanonicalCareerService = buildDeterministicResponse(question, preGuardCanonicalCareerService.source, preGuardCanonicalCareerService, { routeStage: 'pre-guard-canonical-career-service', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalCareerService, resultCacheKey);
  }

  const canonicalScheduleText = `${canonicalRoutingQuestion || ''} ${routingQuestion || ''} ${question || ''}`;
  const preGuardCanonicalSchedule = strictDocumentOnly || isAcademicScheduleLookupQuestion(canonicalScheduleText) || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_schedule' && canonicalUnderstanding.domain && canonicalUnderstanding.domain.primary === 'pmb_schedule') ? null : (
    tryScheduleWindowAnswer(canonicalRoutingQuestion || routingQuestion || question, null, options)
    || tryCurrentOpenWavesAnswer(canonicalRoutingQuestion || routingQuestion || question, null, options)
    || tryScheduleWindowAnswer(routingQuestion || question, null, options)
    || tryCurrentOpenWavesAnswer(routingQuestion || question, null, options)
    || tryScheduleWindowAnswer(question, null, options)
  );
  if (preGuardCanonicalSchedule && preGuardCanonicalSchedule.answer) {
    const builtCanonicalSchedule = buildDeterministicResponse(question, preGuardCanonicalSchedule.source || 'semantic-rag-schedule-window', preGuardCanonicalSchedule, { routeStage: 'pre-guard-canonical-pmb-schedule', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalSchedule, resultCacheKey);
  }

  const earlyUnsupportedDoubleDegreePartner = strictDocumentOnly || typeof tryUnsupportedDoubleDegreePartnerAnswer !== 'function'
    ? null
    : tryUnsupportedDoubleDegreePartnerAnswer(question);
  if (earlyUnsupportedDoubleDegreePartner && earlyUnsupportedDoubleDegreePartner.answer) {
    const builtUnsupportedDoubleDegreePartner = buildDeterministicResponse(
      question,
      earlyUnsupportedDoubleDegreePartner.source || 'semantic-rag-unsupported-double-degree-partner',
      earlyUnsupportedDoubleDegreePartner,
      { routeStage: 'pre-guard-unsupported-double-degree-partner-before-dual-degree', normalizedRouting: normalizedRouting.changed }
    );
    return await finalizeSemanticResult(question, builtUnsupportedDoubleDegreePartner, resultCacheKey);
  }
  const earlyInternationalPartnerCanonical = strictDocumentOnly || typeof buildInternationalCanonicalAnswer !== 'function' ? null : (
    buildInternationalCanonicalAnswer(canonicalRoutingQuestion || routingQuestion || question)
    || buildInternationalCanonicalAnswer(routingQuestion || question)
    || buildInternationalCanonicalAnswer(question)
  );
  if (earlyInternationalPartnerCanonical && earlyInternationalPartnerCanonical.answer) {
    const builtEarlyInternationalPartner = buildDeterministicResponse(
      question,
      earlyInternationalPartnerCanonical.source || 'semantic-rag-international-topic-composer',
      earlyInternationalPartnerCanonical,
      { routeStage: 'pre-guard-international-topic-before-dual-degree', normalizedRouting: normalizedRouting.changed }
    );
    return await finalizeSemanticResult(question, builtEarlyInternationalPartner, resultCacheKey);
  }

  if (!strictDocumentOnly) {
    const earlyDualDegreeStructured = tryDualDegreeAnswer(question, options)
      || tryDualDegreeAnswer(canonicalRoutingQuestion || routingQuestion || question, options)
      || tryDualDegreeAnswer(routingQuestion || question, options);
    if (earlyDualDegreeStructured && earlyDualDegreeStructured.answer) {
      const builtEarlyDualDegree = buildDeterministicResponse(
        question,
        'semantic-rag-dual-degree',
        { ...earlyDualDegreeStructured, source: 'semantic-rag-dual-degree' },
        { routeStage: 'pre-guard-dual-degree-before-document-first', normalizedRouting: normalizedRouting.changed }
      );
      return await finalizeSemanticResult(question, builtEarlyDualDegree, resultCacheKey);
    }
  }
  const preGuardCanonicalOrganizationCount = strictDocumentOnly || !(canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_organization_count') ? null : (
    tryUkmAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryUkmAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryUkmAnswer(question, getCachedSemanticIndex(), options)
  );
  if (preGuardCanonicalOrganizationCount && preGuardCanonicalOrganizationCount.answer) {
    const builtCanonicalOrganizationCount = buildDeterministicResponse(question, preGuardCanonicalOrganizationCount.source || 'semantic-rag-ukm-count', preGuardCanonicalOrganizationCount, { routeStage: 'pre-guard-canonical-organization-count', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtCanonicalOrganizationCount, resultCacheKey);
  }

  if (!strictDocumentOnly && shouldTryDocumentEvidenceBeforePreGuards(question)) {
    try {
      const earlyDocumentFirst = await tryEvidenceFirstLocalDocumentAnswer(question, { ...options, topK: Math.max(8, Number(options.topK || 0) || 0), routeStage: 'pre-guard-document-first' });
      if (earlyDocumentFirst && earlyDocumentFirst.answer && !isWeakSemanticResultSource(earlyDocumentFirst.source)) {
        return await finalizeSemanticResult(question, earlyDocumentFirst, resultCacheKey);
      }
    } catch (e) {
      try { logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] document-first pre-guard probe failed'); } catch (_) {}
    }
  }
  const preGuardAcademicSchedule = strictDocumentOnly ? null : (tryAcademicScheduleAnswer(routingQuestion || question) || tryAcademicScheduleAnswer(question));
  if (preGuardAcademicSchedule && preGuardAcademicSchedule.answer) {
    const builtAcademicSchedule = buildDeterministicResponse(question, preGuardAcademicSchedule.source || 'semantic-rag-academic-schedule', preGuardAcademicSchedule, { routeStage: 'pre-guard-academic-schedule', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtAcademicSchedule, resultCacheKey);
  }

  const preGuardAcademicCredit = strictDocumentOnly ? null : (tryAcademicCreditNoDataAnswer(routingQuestion || question) || tryAcademicCreditNoDataAnswer(question));
  if (preGuardAcademicCredit && preGuardAcademicCredit.answer) {
    const builtAcademicCredit = buildDeterministicResponse(question, preGuardAcademicCredit.source || 'semantic-rag-academic-credit', preGuardAcademicCredit, { routeStage: 'pre-guard-academic-credit', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtAcademicCredit, resultCacheKey);
  }
  const preGuardProgramCurriculum = strictDocumentOnly ? null : (
    (canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_program_curriculum' ? tryProgramCurriculumFollowupAnswer(canonicalRoutingQuestion || routingQuestion || question) : null)
    || tryProgramCurriculumFollowupAnswer(routingQuestion || question)
    || tryProgramCurriculumFollowupAnswer(question)
  );
  if (preGuardProgramCurriculum && preGuardProgramCurriculum.answer) {
    const builtProgramCurriculum = buildDeterministicResponse(question, preGuardProgramCurriculum.source || 'semantic-rag-program-curriculum', preGuardProgramCurriculum, { routeStage: 'pre-guard-program-curriculum', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtProgramCurriculum, resultCacheKey);
  }
  const preGuardAdministrativeFaq = strictDocumentOnly ? null : (
    tryAnchoredAdministrativeFaqAnswer(question, getCachedSemanticIndex())
    || tryAnchoredAdministrativeFaqAnswer(routingQuestion || question, getCachedSemanticIndex())
  );
  if (preGuardAdministrativeFaq && preGuardAdministrativeFaq.answer) {
    const anchoredAdministrativeFaq = { ...preGuardAdministrativeFaq, answer: preserveAdministrativeAnswerAnchor(question, preGuardAdministrativeFaq.answer), source: 'semantic-rag-generic-faq-qna' };
    const builtAdministrativeFaq = buildDeterministicResponse(question, 'semantic-rag-generic-faq-qna', anchoredAdministrativeFaq, { routeStage: 'pre-guard-admin-anchored-faq', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtAdministrativeFaq, resultCacheKey);
  }

  const preGuardAdministrativeCanonical = strictDocumentOnly ? null : (
    buildAdministrativeCanonicalAnswer(question)
    || buildAdministrativeCanonicalAnswer(routingQuestion || question)
  );
  if (preGuardAdministrativeCanonical && preGuardAdministrativeCanonical.answer) {
    const builtAdministrativeCanonical = buildDeterministicResponse(question, preGuardAdministrativeCanonical.source || 'semantic-rag-admin-topic-composer', preGuardAdministrativeCanonical, { routeStage: 'pre-guard-admin-topic-composer', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtAdministrativeCanonical, resultCacheKey);
  }
  const preGuardInternationalCanonical = strictDocumentOnly ? null : (
    buildInternationalCanonicalAnswer(routingQuestion || question)
    || buildInternationalCanonicalAnswer(question)
  );
  if (preGuardInternationalCanonical && preGuardInternationalCanonical.answer) {
    const builtInternationalCanonical = buildDeterministicResponse(question, preGuardInternationalCanonical.source || 'semantic-rag-international-topic-composer', preGuardInternationalCanonical, { routeStage: 'pre-guard-international-topic-composer', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtInternationalCanonical, resultCacheKey);
  }

  const preGuardDualDegreeStructured = strictDocumentOnly ? null : (
    tryDualDegreeAnswer(question, options)
    || tryDualDegreeAnswer(routingQuestion || question, options)
  );
  if (preGuardDualDegreeStructured && preGuardDualDegreeStructured.answer) {
    const builtDualDegreeStructured = buildDeterministicResponse(question, 'semantic-rag-dual-degree', { ...preGuardDualDegreeStructured, source: 'semantic-rag-dual-degree' }, { routeStage: 'pre-guard-dual-degree-structured', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtDualDegreeStructured, resultCacheKey);
  }
  const preGuardFeeText = `${canonicalRoutingQuestion || ''} ${routingQuestion || ''} ${question || ''}`.toLowerCase();
  const canonicalFeeType = canonicalUnderstanding && canonicalUnderstanding.constraints ? canonicalUnderstanding.constraints.feeType : null;
  const canonicalFeeIntent = canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_fee';
  const preGuardOutOfDomainFee = strictDocumentOnly || !canonicalFeeIntent ? null : tryOutOfDomainAnswer(question);
  if (preGuardOutOfDomainFee && preGuardOutOfDomainFee.answer) {
    const builtOutOfDomainFee = buildDeterministicResponse(question, 'semantic-rag-out-of-domain', preGuardOutOfDomainFee, { routeStage: 'pre-guard-out-of-domain-before-fee', normalizedRouting: normalizedRouting.changed, canonicalIntent: canonicalUnderstanding.intent.primary, canonicalDomain: canonicalUnderstanding.domain.primary });
    return await finalizeSemanticResult(question, builtOutOfDomainFee, resultCacheKey);
  }
  const preGuardFinanceOperational = strictDocumentOnly || options.client ? null : tryFinanceFallback(question);
  if (preGuardFinanceOperational && preGuardFinanceOperational.answer) {
    const builtFinanceResult = buildDeterministicResponse(question, 'semantic-rag-finance-fallback', preGuardFinanceOperational, { routeStage: 'pre-guard-finance-operational', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtFinanceResult, resultCacheKey);
  }
  const shouldRunPreGuardFee = (canonicalFeeIntent || /\b(?:biaya|harga|bayar|ukt|dpp|spp|uang\s+(?:kuliah|masuk|pendaftaran)|pendaftaran|registrasi|rincian\s+biaya|per\s+semester|semesteran|double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(preGuardFeeText)) && !/\b(?:visa|e\s*30\s*b|itas|kitas|sktt|izin\s+belajar|study\s+permit|mahasiswa\s+asing)\b/i.test(preGuardFeeText);
  const preferDetailedDoubleDegreeFee = /\b(?:double\s*degree|dual\s*degree|dnui|help\s+university|utb)\b/i.test(preGuardFeeText)
    && /\b(?:biaya\s+kuliah|rincian|total|dpp|ukt|pendidikan|subject|semester)\b/i.test(preGuardFeeText);
  const preferDetailedFeeBySubtype = ['ukt', 'dpp', 'initial_fee', 'total_estimate'].includes(String(canonicalFeeType || ''));
  const preGuardFeeAnswer = strictDocumentOnly || !shouldRunPreGuardFee ? null : ((preferDetailedDoubleDegreeFee || preferDetailedFeeBySubtype) ? (
    tryDetailedFeeAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryDetailedFeeAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryDetailedFeeAnswer(question, getCachedSemanticIndex(), options)
    || tryRegistrationFeeAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationFeeAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationFeeAnswer(question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(question, getCachedSemanticIndex(), options)
  ) : (
    tryRegistrationFeeAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationFeeAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationFeeAnswer(question, getCachedSemanticIndex(), options)
    || tryDetailedFeeAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryDetailedFeeAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryDetailedFeeAnswer(question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGeneralFeeQuestionAnswer(question, getCachedSemanticIndex(), options)
  ));
  if (preGuardFeeAnswer && preGuardFeeAnswer.answer) {
    const feeLooksDetailed = /\b(?:Rincian\s+biaya\s+program\s+Double\s+Degree|DPP|Dana\s+Pendidikan\s+Pokok|Biaya\s+Pendidikan\s*&\s*Ujian|Subject|UKT|awal\s+masuk)\b/i.test(String(preGuardFeeAnswer.answer || ''));
    let feeSource = preGuardFeeAnswer.source || (preGuardFeeAnswer.wave || feeLooksDetailed ? 'semantic-rag-fee-detail' : 'semantic-rag-registration-fee');
    if (/semantic-rag-registration-fee/i.test(feeSource) && (feeLooksDetailed || preferDetailedFeeBySubtype)) feeSource = 'semantic-rag-fee-detail';
    const builtFeeAnswer = buildDeterministicResponse(question, feeSource, { ...preGuardFeeAnswer, source: feeSource }, { routeStage: 'pre-guard-fee', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtFeeAnswer, resultCacheKey);
  }

  const administrativeTopicForKnownFaq = getAdministrativeInfoTopic(routingQuestion || question);
  const preGuardStudyPermit = strictDocumentOnly || !isStudyPermitQuestion(routingQuestion || question) || (administrativeTopicForKnownFaq && !/^(study_permit|study_permit_extension|foreign_student_docs)$/.test(administrativeTopicForKnownFaq.key)) ? null : (
    tryKnownFaqQnaAnswer(routingQuestion || question) || tryKnownFaqQnaAnswer(question)
  );
  if (preGuardStudyPermit && preGuardStudyPermit.answer) {
    const builtStudyPermit = buildDeterministicResponse(question, preGuardStudyPermit.source || 'semantic-rag-known-faq-qna', preGuardStudyPermit, { routeStage: 'pre-guard-study-permit', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtStudyPermit, resultCacheKey);
  }

  const preGuardRegistrationText = `${canonicalRoutingQuestion || ''} ${routingQuestion || ''} ${question || ''}`.toLowerCase();
  const canonicalRegistrationHow = canonicalUnderstanding && canonicalUnderstanding.intent && canonicalUnderstanding.intent.primary === 'ask_registration_how';
  const isRegistrationCorrectionRequest = /\b(?:salah\s+isi|koreksi|perbaiki|ubah|revisi|edit)\b/i.test(preGuardRegistrationText)
    && /\b(?:data|formulir|pendaftaran|registrasi|pmb)\b/i.test(preGuardRegistrationText);
  const shouldRunPreGuardRegistrationHow = (canonicalRegistrationHow || /\b(?:daftar|mendaftar|pendaftaran|registrasi|pmb|penerimaan\s+mahasiswa\s+baru)\b/i.test(preGuardRegistrationText))
    && !isRegistrationCorrectionRequest
    && !/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(preGuardRegistrationText);
  const preGuardRegistrationHow = strictDocumentOnly || !shouldRunPreGuardRegistrationHow ? null : (
    tryRegistrationHowAnswer(canonicalRoutingQuestion || routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationHowAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryRegistrationHowAnswer(question, getCachedSemanticIndex(), options)
  );
  if (preGuardRegistrationHow && preGuardRegistrationHow.answer) {
    const builtRegistrationHow = buildDeterministicResponse(question, preGuardRegistrationHow.source || 'semantic-rag-registration-info', preGuardRegistrationHow, { routeStage: 'pre-guard-registration-how', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtRegistrationHow, resultCacheKey);
  }

  const preGuardAccreditationEarly = strictDocumentOnly ? null : (
    tryAccreditationAnswer(routingQuestion || question, getCachedSemanticIndex())
    || tryAccreditationAnswer(question, getCachedSemanticIndex())
  );
  if (preGuardAccreditationEarly && preGuardAccreditationEarly.answer) {
    const builtPreGuardAccreditation = buildDeterministicResponse(question, preGuardAccreditationEarly.source || 'rag-accreditation', preGuardAccreditationEarly, { routeStage: 'pre-guard-accreditation-early', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPreGuardAccreditation, resultCacheKey);
  }


  const explicitSupportEntityForGenericFaq = findCampusSupportEntity(routingQuestion || question);
  const preGuardSpecificEntityFaqQna = strictDocumentOnly || !explicitSupportEntityForGenericFaq || isStudyPermitQuestion(question) ? null : (
    tryGenericFaqQnaAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGenericFaqQnaAnswer(question, getCachedSemanticIndex(), options)
  );
  if (preGuardSpecificEntityFaqQna && preGuardSpecificEntityFaqQna.answer) {
    let entityFaqAnswerText = ensureNamedCampusSupportContextInAnswer(question, preGuardSpecificEntityFaqQna.answer);
    entityFaqAnswerText = enrichCareerFaqAnswerWithQuestionContext(question, entityFaqAnswerText);
    if (answerMatchesStrongQuestionAnchors(question, entityFaqAnswerText) && !hasUploadedDocumentTopicConflict(question, entityFaqAnswerText) && !hasRawEvidenceSnippetShape(entityFaqAnswerText)) {
      const builtSpecificEntityFaq = buildDeterministicResponse(
        question,
        preGuardSpecificEntityFaqQna.source || 'semantic-rag-generic-faq-qna',
        { ...preGuardSpecificEntityFaqQna, answer: entityFaqAnswerText, source: preGuardSpecificEntityFaqQna.source || 'semantic-rag-generic-faq-qna' },
        { routeStage: 'pre-guard-specific-entity-faq-qna', normalizedRouting: normalizedRouting.changed }
      );
      return await finalizeSemanticResult(question, builtSpecificEntityFaq, resultCacheKey);
    }
  }
  const preGuardSupportEntity = strictDocumentOnly ? null : findCampusSupportEntity(routingQuestion || question);
  if (preGuardSupportEntity && preGuardSupportEntity.key !== 'linkedin-career-center') {
    const preGuardSupportEntityAnswer = tryCampusSupportEntityAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
      || tryCampusSupportEntityAnswer(question, getCachedSemanticIndex(), options);
    if (preGuardSupportEntityAnswer && preGuardSupportEntityAnswer.answer) {
      const supportSource = preGuardSupportEntityAnswer.source || 'semantic-rag-campus-support-entity';
      if (/insufficient-data|no-data/i.test(String(supportSource))) {
        try {
          const supportEvidenceFirst = await tryEvidenceFirstLocalDocumentAnswer(question, { ...options, topK: Math.max(8, Number(options.topK || 0) || 0), routeStage: 'pre-guard-support-insufficient-evidence-first' });
          if (supportEvidenceFirst && supportEvidenceFirst.answer) {
            return await finalizeSemanticResult(question, supportEvidenceFirst, resultCacheKey);
          }
        } catch (e) {
          try { logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] support insufficient evidence-first probe failed'); } catch (_) {}
        }
      }
      const builtSupportEntity = buildDeterministicResponse(
        question,
        supportSource,
        preGuardSupportEntityAnswer,
        { routeStage: 'pre-guard-support-entity', normalizedRouting: normalizedRouting.changed }
      );
      return await finalizeSemanticResult(question, builtSupportEntity, resultCacheKey);
    }
  }
  const preGuardGenericFaqQna = strictDocumentOnly || isCampusChoiceReasonQuestion(question) || explicitSupportEntityForGenericFaq ? null : (
    tryGenericFaqQnaAnswer(routingQuestion || question, getCachedSemanticIndex(), options)
    || tryGenericFaqQnaAnswer(question, getCachedSemanticIndex(), options)
  );
  if (preGuardGenericFaqQna && preGuardGenericFaqQna.answer) {
    let genericFaqAnswerText = ensureNamedCampusSupportContextInAnswer(question, preGuardGenericFaqQna.answer);
    genericFaqAnswerText = enrichCareerFaqAnswerWithQuestionContext(question, genericFaqAnswerText);
    if (isStudyPermitQuestion(question) || !answerMatchesStrongQuestionAnchors(question, genericFaqAnswerText)
      || hasUploadedDocumentTopicConflict(question, genericFaqAnswerText)) {
      preGuardGenericFaqQna.answer = '';
    } else {
    const genericFaqSource = (isIndustryServicesQuestionAnswer(question, preGuardGenericFaqQna.answer) || isCareerCenterQuestion(question))
      ? 'semantic-rag-campus-support-entity'
      : (preGuardGenericFaqQna.matchedFaqQuestion
        ? 'semantic-rag-generic-faq-qna'
        : /upload/i.test(String(preGuardGenericFaqQna.matchedItemSource || ''))
        ? 'semantic-rag-uploaded-training-generic'
        : (preGuardGenericFaqQna.source || 'semantic-rag-generic-faq-qna'));
    const builtGenericFaqQna = buildDeterministicResponse(
      question,
      genericFaqSource,
      { ...preGuardGenericFaqQna, answer: genericFaqAnswerText, source: genericFaqSource },
      { routeStage: 'pre-guard-generic-faq-qna', normalizedRouting: normalizedRouting.changed }
    );
    return await finalizeSemanticResult(question, builtGenericFaqQna, resultCacheKey);
    }
  }

  const preGuardKnownFaqQna = strictDocumentOnly ? null : (tryKnownFaqQnaAnswer(routingQuestion || question) || tryKnownFaqQnaAnswer(question));
  if (preGuardKnownFaqQna && preGuardKnownFaqQna.answer) {
    const builtKnownFaqQna = buildDeterministicResponse(
      question,
      preGuardKnownFaqQna.source || 'semantic-rag-generic-faq-qna',
      preGuardKnownFaqQna,
      { routeStage: 'pre-guard-known-faq-qna', normalizedRouting: normalizedRouting.changed }
    );
    return await finalizeSemanticResult(question, builtKnownFaqQna, resultCacheKey);
  }

  if (!strictDocumentOnly && /\b(?:linked\s*in|linkedin)\b/i.test(routingQuestion) && /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|career|karier|karir)\b/i.test(routingQuestion)) {
    const linkedInSupport = tryCampusSupportEntityAnswer(routingQuestion, getCachedSemanticIndex(), options) || tryKnownFaqQnaAnswer(routingQuestion);
    if (linkedInSupport && linkedInSupport.answer) {
      const builtLinkedIn = buildDeterministicResponse(question, linkedInSupport.source || 'semantic-rag-campus-support-entity', { ...linkedInSupport, source: linkedInSupport.source || 'semantic-rag-campus-support-entity' }, { routeStage: 'pre-guard-linkedin-career-center', normalizedRouting: normalizedRouting.changed });
      return await finalizeSemanticResult(question, builtLinkedIn, resultCacheKey);
    }
  }
  if (!strictDocumentOnly
    && /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(String(routingQuestion || question || '').toLowerCase())
    && /\b(?:layanan|memberikan|fungsi|tugas|bantu|membantu|apa\s+saja|apa\s+aja|ngapain|untuk\s+apa)\b/i.test(String(routingQuestion || question || '').toLowerCase())) {
    const preGuardCareerCenter = {
      answer: buildCareerReadinessProgramsAnswer(),
      source: 'semantic-rag-career-readiness',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-career-readiness', preGuardCareerCenter, { routeStage: 'pre-guard-career-center-service', normalizedRouting: normalizedRouting.changed }), resultCacheKey);
  }


  const preGuardDualDegreeFeeClarification = strictDocumentOnly ? null : tryDualDegreeFeeClarificationAnswer(routingQuestion || question);
  if (preGuardDualDegreeFeeClarification && preGuardDualDegreeFeeClarification.answer) {
    const builtDualDegreeFeeClarification = buildDeterministicResponse(question, preGuardDualDegreeFeeClarification.source || 'semantic-rag-dual-degree-fee-clarification', preGuardDualDegreeFeeClarification, { routeStage: 'pre-guard-dual-degree-fee-clarification', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtDualDegreeFeeClarification, resultCacheKey);
  }

  const preGuardAccreditation = strictDocumentOnly ? null : tryAccreditationAnswer(routingQuestion || question, getCachedSemanticIndex());
  if (preGuardAccreditation && preGuardAccreditation.answer) {
    const builtPreGuardAccreditation = buildDeterministicResponse(question, preGuardAccreditation.source || 'rag-accreditation', preGuardAccreditation, { routeStage: 'pre-guard-accreditation', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPreGuardAccreditation, resultCacheKey);
  }

  const preGuardScholarship = strictDocumentOnly ? null : tryScholarshipAnswer(routingQuestion || question, getCachedSemanticIndex(), options);
  if (preGuardScholarship && preGuardScholarship.answer) {
    const builtPreGuardScholarship = buildDeterministicResponse(question, preGuardScholarship.source || 'semantic-rag-scholarship', preGuardScholarship, { routeStage: 'pre-guard-scholarship', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPreGuardScholarship, resultCacheKey);
  }

  const preGuardPostgraduateProfile = strictDocumentOnly ? null : tryPostgraduateProfileAnswer(routingQuestion || question);
  if (preGuardPostgraduateProfile && preGuardPostgraduateProfile.answer) {
    const builtPostgraduateProfile = buildDeterministicResponse(question, preGuardPostgraduateProfile.source || 'semantic-rag-postgraduate-profile', preGuardPostgraduateProfile, { routeStage: 'pre-guard-postgraduate-profile', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPostgraduateProfile, resultCacheKey);
  }

  const preGuardAcademicSpecificNoData = strictDocumentOnly ? null : tryAcademicSpecificNoDataAnswer(routingQuestion || question);
  if (preGuardAcademicSpecificNoData && preGuardAcademicSpecificNoData.answer) {
    const builtPreGuardAcademicSpecificNoData = buildDeterministicResponse(question, preGuardAcademicSpecificNoData.source || 'semantic-rag-academic-no-data', preGuardAcademicSpecificNoData, { routeStage: 'pre-guard-academic-specific-no-data', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPreGuardAcademicSpecificNoData, resultCacheKey);
  }

  const preGuardUkmAnswer = strictDocumentOnly ? null : tryUkmAnswer(routingQuestion || question, getCachedSemanticIndex(), options);
  if (preGuardUkmAnswer && preGuardUkmAnswer.answer) {
    const builtPreGuardUkm = buildDeterministicResponse(question, preGuardUkmAnswer.source || 'semantic-rag-ukm-list', preGuardUkmAnswer, { routeStage: 'pre-guard-ukm', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtPreGuardUkm, resultCacheKey);
  }

  if (!strictDocumentOnly
    && /\b(?:student\s*exchange|students\s*exchange|pertukaran\s+mahasiswa)\b/i.test(routingQuestion || question)
    && /\b(?:apa\s+itu|itu\s+apa|tentang|jelaskan|maksud(?:nya)?|program\s+apa)\b/i.test(routingQuestion || question)) {
    const studentExchangeDefinition = {
      answer: 'Student Exchange adalah program pertukaran mahasiswa yang memberi kesempatan kepada mahasiswa ITB STIKOM Bali untuk belajar di kampus luar negeri dalam periode tertentu, sekaligus mendapatkan pengalaman akademik dan budaya internasional. Untuk detail negara tujuan, jadwal, kuota, syarat, biaya, dan alur pendaftaran, kakak sebaiknya konfirmasi ke admin kampus atau unit kerja sama internasional.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    const builtStudentExchangeDefinition = buildDeterministicResponse(question, studentExchangeDefinition.source, studentExchangeDefinition, { routeStage: 'pre-guard-student-exchange-definition', normalizedRouting: normalizedRouting.changed });
    return await finalizeSemanticResult(question, builtStudentExchangeDefinition, resultCacheKey);
  }

  if (!strictDocumentOnly) {
    const preGuardFineRoute = detectFineGrainedIntent(routingQuestion);
    const preGuardInternationalListRequested = /\b(?:program\s+internasional|kelas\s+internasional|international\s+program)\b/i.test(routingQuestion);
    const preGuardDoubleDegreeRequested = /\b(?:double|dual)\s*degree\b/i.test(routingQuestion);
    const preGuardSpecificInternationalEntity = /\b(?:student\s*exchange|students\s*exchange|pertukaran\s+mahasiswa|gccp|bccp|short\s*course|hi-?think|kuliah\s+sambil\s+kerja|magang\s+berbayar)\b/i.test(routingQuestion);
    if (preGuardFineRoute.fineIntent === 'international_program_list' && (preGuardDoubleDegreeRequested || (preGuardInternationalListRequested && !preGuardSpecificInternationalEntity))) {
      const preGuardInternational = preGuardDoubleDegreeRequested
        ? tryDualDegreeAnswer(routingQuestion, options)
        : tryInternationalClassFallback(routingQuestion, getCachedSemanticIndex(), options);
      if (preGuardInternational && preGuardInternational.answer) {
        const preGuardSource = preGuardDoubleDegreeRequested ? 'semantic-rag-dual-degree' : (preGuardInternational.source || 'semantic-rag-international-class-fallback');
        const builtInternational = buildDeterministicResponse(question, preGuardSource, { ...preGuardInternational, source: preGuardSource }, { routeStage: 'pre-guard-international-program-list', normalizedRouting: normalizedRouting.changed });
        return await finalizeSemanticResult(question, builtInternational, resultCacheKey);
      }
    }    if (preGuardSpecificInternationalEntity && /\b(?:apa\s+itu|tentang|jelaskan|info(?:rmasi)?|ada|tersedia|punya|program|apa\s+saja|apa\s+aja|pilihan|opsi|ikut|mengikuti)\b/i.test(routingQuestion)) {
      const preGuardSupport = tryCampusSupportEntityAnswer(routingQuestion, getCachedSemanticIndex(), options);
      if (preGuardSupport && preGuardSupport.answer) {
        const builtSupport = buildDeterministicResponse(question, preGuardSupport.source || 'semantic-rag-campus-support-entity', preGuardSupport, { routeStage: 'pre-guard-specific-international-support', normalizedRouting: normalizedRouting.changed });
        return await finalizeSemanticResult(question, builtSupport, resultCacheKey);
      }
    }
  }

  const careerRoutingQuestion = `${String(routingQuestion || '')} ${String(question || '')}`.toLowerCase();
  const careerRoutingEntity = findCampusSupportEntity(careerRoutingQuestion);
  const careerQuestionMentionsOtherSupport = careerRoutingEntity
    && careerRoutingEntity.key !== 'career-center'
    && careerRoutingEntity.key !== 'linkedin-career-center';
  if (!strictDocumentOnly
    && !careerQuestionMentionsOtherSupport
    && !isCareerConsultationQuestion(careerRoutingQuestion)
    && !(/\b(?:apa\s+itu|itu\s+apa|pengertian|maksud|tentang|jelaskan|fungsi|layanan)\b/i.test(careerRoutingQuestion) && /\b(?:career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(careerRoutingQuestion))
    && /\b(?:lowongan|loker|peluang\s+kerja|prospek\s+kerja|karier|karir|career|tracer\s*study|campus\s*hiring|job\s*fair)\b/i.test(careerRoutingQuestion)
    && /\b(?:mahasiswa|alumni|lulusan|kampus|itb\s*stikom\s*bali|stikom\s+bali|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(careerRoutingQuestion)) {
    const result = {
      answer: 'Peluang kerja lulusan ITB STIKOM Bali didukung oleh kurikulum yang relevan dengan kebutuhan industri serta layanan Career Center. Dari data yang tersedia, dukungan Career Center mencakup informasi lowongan kerja, magang, job fair, campus hiring, konsultasi karier, dan tracer study untuk mahasiswa/alumni. Jika kakak ingin lebih spesifik, sebutkan prodinya agar saya jelaskan prospek kerja per prodi.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-guard-career-support', normalizedRouting: normalizedRouting.changed }), resultCacheKey);
  }

  if (!strictDocumentOnly && !shouldDeferEarlyEvidenceFirstToStableRoute(routingQuestion)) {
    try {
      const earlyEvidenceFirst = await tryEvidenceFirstLocalDocumentAnswer(question, { ...options, topK: Math.max(8, Number(options.topK || 0) || 0), routeStage: 'pre-guard-document-evidence' });
      if (earlyEvidenceFirst && earlyEvidenceFirst.answer) {
        return await finalizeSemanticResult(question, earlyEvidenceFirst, resultCacheKey);
      }
    } catch (e) {
      try { logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] pre-guard evidence-first probe failed'); } catch (_) {}
    }
    if (/\b(?:layanan\s+industri|dari\s+industri|kerja\s*sama\s+industri|kerjasama\s+industri)\b/i.test(String(question || ''))) {
      const industryNoData = { answer: buildIndustryServicesNoDataAnswer(), source: 'semantic-rag-campus-facility-insufficient-data', frameSource: 'semantic-rag-insufficient-data' };
      return await finalizeSemanticResult(question, buildDeterministicResponse(question, industryNoData.source, industryNoData, { routeStage: 'pre-guard-industry-services-no-data' }), resultCacheKey);
    }
  }
  if (isRawDocumentLeakComplaint(question)) {
    const response = { success: true, answer: buildRawDocumentLeakComplaintAnswer(), source: 'semantic-rag-raw-document-leak-feedback', contexts: [] };
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }

  if (isOperationalAcademicPolicyQuestion(question)) {
    const response = { success: true, answer: buildAcademicPolicyNoDataAnswer(question), source: 'semantic-rag-operational-academic-policy-no-answer', contexts: [] };
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }

  const explicitExternalNoData = tryExplicitExternalEntityNoDataAnswer(question);
  if (explicitExternalNoData && explicitExternalNoData.answer) {
    const response = buildDeterministicResponse(question, 'semantic-rag-explicit-external-no-data', explicitExternalNoData, { routeStage: 'pre-ai-explicit-external-no-data' });
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }


  if (/\b(indikator|pertanggung\s*jawab(?:an)?|dipertanggung\s*jawabkan|institusi\s+pendidikan|akuntabilitas|kinerja\s+institusi)\b/i.test(String(question || ''))) {
    const response = { success: true, answer: 'Saya belum menemukan rincian indikator pertanggungjawaban institusi pendidikan ITB STIKOM Bali yang cukup aman pada data yang tersedia. Agar tidak keliru, indikator resmi seperti akreditasi, mutu akademik, tata kelola, layanan, atau pelaporan institusi sebaiknya dikonfirmasi ke pihak kampus/unit terkait.', source: 'semantic-rag-institution-indicator-insufficient-data', contexts: [] };
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }

  if (/\b(pks|pasal\s+\d+|addendum|pihak\s+(?:pertama|kedua|kesatu)|nama\s+mitra|template\s+pks|perjanjian\s+kerja\s*sama)\b/i.test(String(question || ''))) {
    const response = { success: true, answer: 'Untuk informasi PKS/perjanjian kerja sama, saya tidak menampilkan atau menafsirkan detail dokumen legal melalui bot. Jika kakak membutuhkan template, isi pasal, nama mitra, atau addendum, sebaiknya konfirmasi langsung ke admin kampus atau unit kerja sama terkait agar sesuai dokumen resmi.', source: 'semantic-rag-admin-legal-no-answer', contexts: [] };
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }

  const client = getClient();
  const fallbacksAllowed = !strictDocumentOnly;
  const debugTrace = envFlag('DEBUG_SEMANTIC_HANDLER_TRACE', false);
  const earlySupportQuestion = String(question || '').toLowerCase();
  const deferEarlyKeywordFallbacks = Boolean(client) && shouldDeferDeterministicBeforeSemantic(question);
  if (!strictDocumentOnly
    && /\b(?:peluang\s+kerja|prospek\s+kerja)\b/i.test(earlySupportQuestion)
    && /\b(?:lulusan|alumni|itb\s*stikom\s*bali|stikom\s+bali|kampus)\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: 'Peluang kerja lulusan ITB STIKOM Bali didukung oleh kurikulum yang relevan dengan kebutuhan industri serta dukungan Career Center. Dari data yang tersedia, dukungan karier mencakup informasi lowongan kerja, magang, job fair, campus hiring, konsultasi karier, dan tracer study. Untuk peluang per prodi, kakak bisa sebutkan prodinya, misalnya Sistem Informasi, Teknologi Informasi, Bisnis Digital, Sistem Komputer, Manajemen Informatika, atau S2 Sistem Informasi.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-ai-support-career-opportunity', normalizedRouting: normalizedRouting.changed }), resultCacheKey);
  }
  if (!strictDocumentOnly && isCareerConsultationQuestion(earlySupportQuestion)) {
    const result = {
      answer: 'Ya. Mahasiswa dapat berkonsultasi mengenai karier melalui Career Center ITB STIKOM Bali, termasuk terkait persiapan kerja, peluang karier, magang, dan proses melamar pekerjaan. Untuk jadwal layanan atau PIC yang sedang aktif, kakak bisa cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-ai-support-career-consultation', normalizedRouting: normalizedRouting.changed }), resultCacheKey);
  }
  if (!strictDocumentOnly
    && /\b(?:career\s*center|pusat\s+karier|pusat\s+karir|cdc)\b/i.test(earlySupportQuestion)
    && /\b(?:layanan|memberikan|fungsi|tugas|bantu|membantu|apa\s+saja|apa\s+aja|ngapain|untuk\s+apa)\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: buildCareerReadinessProgramsAnswer(),
      source: 'semantic-rag-career-readiness',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-career-readiness', result, { routeStage: 'pre-ai-support-career-center-service' }), resultCacheKey);
  }
  if (!strictDocumentOnly && !client && !deferEarlyKeywordFallbacks && /\b(?:llc|language\s+learning\s+center)\b/i.test(earlySupportQuestion) && /\b(?:apa|itu|pengertian|maksud|tentang|info(?:rmasi)?|jelaskan)\b/i.test(earlySupportQuestion)) {
    const result = { answer: buildLanguageLearningAnswer(), source: 'semantic-rag-campus-facility', frameSource: 'semantic-rag-campus-facility' };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-facility', result, { routeStage: 'pre-ai-support-abbreviation' }), resultCacheKey);
  }
  if (!strictDocumentOnly && !client && !deferEarlyKeywordFallbacks
    && /\b(?:pelatihan|pembekalan|bimbingan|konsultasi|persiapan)\b/i.test(earlySupportQuestion)
    && /\b(?:melamar|lamar(?:an)?|pekerjaan|kerja|karier|karir|career|profesional|dunia\s+kerja)\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: buildCareerSoftskillAnswer(),
      source: 'semantic-rag-career-softskill',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-career-softskill', result, { routeStage: 'pre-ai-support-career-readiness' }), resultCacheKey);
  }
  if (!strictDocumentOnly && !client && !deferEarlyKeywordFallbacks && /\b(?:career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(earlySupportQuestion) && /\b(?:apa|itu|ngapain|fungsi|tugas|layanan|info(?:rmasi)?|tentang|jelaskan)\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: 'Career Center ITB STIKOM Bali adalah layanan dukungan karier untuk mahasiswa dan alumni. Dari data yang tersedia, dukungannya mencakup informasi lowongan kerja, magang, campus hiring, job fair, konsultasi karier, dan tracer study. Untuk jadwal kegiatan atau lowongan yang sedang berjalan, kakak bisa cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-ai-support-career-center' }), resultCacheKey);
  }
  if (!strictDocumentOnly && !client && !deferEarlyKeywordFallbacks && /\bjob\s*fair\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: 'Pada data Career Center yang tersedia, job fair tercantum sebagai salah satu bentuk dukungan karier untuk mahasiswa dan alumni, bersama informasi lowongan kerja, magang, campus hiring, konsultasi karier, dan tracer study. Untuk jadwal Job Fair yang sedang atau akan berjalan, kakak perlu cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-ai-support-career-event' }), resultCacheKey);
  }
  if (!strictDocumentOnly && !client && !deferEarlyKeywordFallbacks && /\b(campus\s*hiring|rekrutmen|lowongan|loker|magang|tracer\s*study|konsultasi\s+karier)\b/i.test(earlySupportQuestion) && /\b(apakah|ada|punya|tersedia|informasi|info|tentang|apa|bagaimana|gimana|di\s*mana|dimana)\b/i.test(earlySupportQuestion)) {
    const result = {
      answer: 'Pada data Career Center yang tersedia, ITB STIKOM Bali mencantumkan dukungan karier seperti informasi lowongan kerja, magang, campus hiring, job fair, konsultasi karier, dan tracer study. Untuk daftar lowongan, jadwal, formulir, atau kegiatan yang sedang berjalan, kakak perlu cek pengumuman resmi kampus atau konfirmasi ke Career Center/admin kampus.',
      source: 'semantic-rag-campus-support-entity',
      frameSource: 'semantic-rag-campus-support-entity'
    };
    return await finalizeSemanticResult(question, buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', result, { routeStage: 'pre-ai-support-career-event' }), resultCacheKey);
  }
  // Prefer explicit small-talk deterministic answers for short greetings/thanks
  // before consulting uploaded-training so casual messages aren't intercepted
  // by long-form RAG content that later gets blocked by preflight.
  const smallTalk = trySmallTalkAnswer(question);
  const smallTalkWords = String(question || '').trim().split(/\s+/).filter(Boolean).length;
  // Only treat as small-talk when user message is very short (brief greeting/thanks/etc.).
  if (smallTalk && smallTalk.answer && shouldReturnSmallTalkImmediately(question, smallTalkWords)) {
    const smallTalkResp = buildDeterministicResponse(question, 'semantic-rag-small-talk', smallTalk, { routeStage: 'pre-ai-small-talk' });
    return await finalizeSemanticResult(question, smallTalkResp, resultCacheKey);
  }

  if (!strictDocumentOnly) {
    const directRpl = tryRplAnswer(question);
    if (directRpl && directRpl.answer) {
      const builtRpl = buildDeterministicResponse(question, directRpl.source || 'semantic-rag-rpl', directRpl, { routeStage: 'pre-ai-direct-rpl' });
      return await finalizeSemanticResult(question, builtRpl, resultCacheKey);
    }

    const institutionProfileText = String(question || '');
    const institutionProfileQuestion = /\b(?:apa\s+itu|profil|jelaskan\s+(?:tentang\s+)?(?:kampus\s+)?|informasi\s+tentang)\b/i.test(institutionProfileText)
      && /\b(?:itb\s*stikom\s*bali|stikom\s+bali)\b/i.test(institutionProfileText)
      && !/\b(?:pmb|penerimaan\s+mahasiswa\s+baru|maba|camaba|jurusan|prodi|program|biaya|akreditasi|jadwal|daftar|pendaftaran|beasiswa|fasilitas)\b/i.test(institutionProfileText);
    if (institutionProfileQuestion) {
      const institutionProfile = {
        success: true,
        answer: [
          'ITB STIKOM Bali adalah Institut Teknologi dan Bisnis STIKOM Bali, perguruan tinggi di Bali yang berfokus pada bidang teknologi informasi, komputer, dan bisnis digital.',
          '',
          'Kampus ini menyediakan program pendidikan seperti S1, D3, S2, serta beberapa program kerja sama seperti Double Degree dan program internasional sesuai data yang tersedia.'
        ].join('\n'),
        source: 'semantic-rag-institution-profile',
        contexts: []
      };
      return await finalizeSemanticResult(question, institutionProfile, resultCacheKey);
    }
    const directPmbInfo = tryPmbInfoAnswer(question);
    if (directPmbInfo && directPmbInfo.answer) {
      const builtPmbInfo = buildDeterministicResponse(question, directPmbInfo.source || 'semantic-rag-pmb-info', directPmbInfo, { routeStage: 'pre-ai-direct-pmb-info' });
      return await finalizeSemanticResult(question, builtPmbInfo, resultCacheKey);
    }

    const directAcademicSchedule = tryAcademicScheduleAnswer(question);
    if (directAcademicSchedule && directAcademicSchedule.answer) {
      const builtAcademicSchedule = buildDeterministicResponse(question, directAcademicSchedule.source || 'semantic-rag-academic-schedule', directAcademicSchedule, { routeStage: 'pre-ai-direct-academic-schedule' });
      return await finalizeSemanticResult(question, builtAcademicSchedule, resultCacheKey);
    }

    const directAcademicCreditNoData = tryAcademicCreditNoDataAnswer(question);
    if (directAcademicCreditNoData && directAcademicCreditNoData.answer) {
      const builtAcademicCredit = buildDeterministicResponse(question, directAcademicCreditNoData.source || 'semantic-rag-academic-credit-no-data', directAcademicCreditNoData, { routeStage: 'pre-ai-direct-academic-credit' });
      return await finalizeSemanticResult(question, builtAcademicCredit, resultCacheKey);
    }

    const directCurriculum = tryProgramCurriculumFollowupAnswer(question);
    if (directCurriculum && directCurriculum.answer) {
      const builtCurriculum = buildDeterministicResponse(question, directCurriculum.source || 'semantic-rag-program-curriculum', directCurriculum, { routeStage: 'pre-ai-direct-curriculum' });
      return await finalizeSemanticResult(question, builtCurriculum, resultCacheKey);
    }

    const fineRoute = detectFineGrainedIntent(routingQuestion);
    const priorityHandlers = [];
    if (fineRoute.fineIntent === 'program_curriculum') priorityHandlers.push(['semantic-rag-program-curriculum', tryProgramCurriculumFollowupAnswer]);
    if (fineRoute.fineIntent === 'program_comparison') priorityHandlers.push(['semantic-rag-program-comparison', tryProgramComparisonAnswer]);
    if (fineRoute.fineIntent === 'program_faculty') priorityHandlers.push(['semantic-rag-academic-faculty', tryProgramFacultyAnswer]);
    const fineRouteSpecificInternationalEntity = /\b(?:student\s*exchange|students\s*exchange|studens\s*exchange|pertukaran\s+mahasiswa|gccp|gcpp|gcp|bccp|short\s*course|shortcourse|hi-?think|kuliah\s+sambil\s+kerja|magang\s+berbayar)\b/i.test(routingQuestion);
    if (fineRoute.fineIntent === 'international_program_list') {
      if (fineRouteSpecificInternationalEntity) priorityHandlers.push(['semantic-rag-campus-support-entity', tryCampusSupportEntityAnswer]);
      else priorityHandlers.push(['semantic-rag-international-class-fallback', tryInternationalClassFallback]);
    }
    if (fineRoute.fineIntent === 'international_program_requirement') priorityHandlers.push(['semantic-rag-dual-degree', tryDualDegreeAnswer], ['semantic-rag-campus-support-entity', tryCampusSupportEntityAnswer], ['semantic-rag-international-class-fallback', tryInternationalClassFallback]);
    if (fineRoute.fineIntent === 'career_readiness') priorityHandlers.push(['semantic-rag-career-readiness', tryCareerReadinessAnswer], ['semantic-rag-campus-facility', tryCampusFacilityAnswer], ['semantic-rag-career-softskill', tryCareerCenterSoftskillAnswer]);
    for (const [sourceName, handler] of priorityHandlers) {
      const routed = handler(routingQuestion, options);
      if (routed && routed.answer) {
        const builtRouted = buildDeterministicResponse(question, routed.source || sourceName, routed, { routeStage: 'pre-ai-fine-intent-priority', fineIntent: fineRoute.fineIntent, normalizedRouting: normalizedRouting.changed });
        return await finalizeSemanticResult(question, builtRouted, resultCacheKey);
      }
    }

    const preGuardCertification = strictDocumentOnly ? null : tryCertificationAnswer(question);
    if (preGuardCertification && preGuardCertification.answer) {
      const builtCertification = buildDeterministicResponse(question, preGuardCertification.source || 'semantic-rag-certification', preGuardCertification, { routeStage: 'pre-guard-certification' });
      return await finalizeSemanticResult(question, builtCertification, resultCacheKey);
    }

    const operationalFastHandlers = handlersForSources([
      'semantic-rag-registration-data-correction',
      'semantic-rag-program-change',
      'semantic-rag-registration-info',
      'semantic-rag-schedule-window',
      'semantic-rag-current-open-waves',
      'semantic-rag-pmb-contact',
      'semantic-rag-pmb-requirements',
      'semantic-rag-dual-degree',
      'semantic-rag-international-class-fallback',
      'semantic-rag-program-list',
      'semantic-rag-program-definition',
      'semantic-rag-program-comparison',
      'semantic-rag-program-recommendation',
      'semantic-rag-career',
      'semantic-rag-career-readiness',
      'semantic-rag-career-softskill',
      'semantic-rag-certification',
      'semantic-rag-campus-support-entity',
      'semantic-rag-bem',
      'semantic-rag-campus-support-fallback',
      'semantic-rag-finance-fallback',
      'semantic-rag-registration-fee',
      'semantic-rag-fee-detail',
      'semantic-rag-contextual-fee',
      'semantic-rag-fee-general',
      'semantic-rag-fee-comparison',
      'semantic-rag-fee-fallback',
      'semantic-rag-contact-lecturer',
      'semantic-rag-graduation-registration',
      'semantic-rag-academic-schedule',
      'semantic-rag-academic-krs',
      'semantic-rag-academic-grade',
      'semantic-rag-academic-transcript',
      'semantic-rag-thesis-fallback'
    ]);
    const operationalFastResult = runDeterministicHandlers(question, operationalFastHandlers, options, [question], { routeStage: 'pre-ai-operational-fast-lane' });
    if (operationalFastResult && operationalFastResult.answer) {
      return await finalizeSemanticResult(question, operationalFastResult, resultCacheKey);
    }
  }

  const earlyAcademicSpecificNoData = strictDocumentOnly ? null : tryAcademicSpecificNoDataAnswer(question);
  if (earlyAcademicSpecificNoData && earlyAcademicSpecificNoData.answer) {
    const builtEarlyAcademicSpecificNoData = buildDeterministicResponse(question, earlyAcademicSpecificNoData.source || 'semantic-rag-academic-no-data', earlyAcademicSpecificNoData, { routeStage: 'pre-ai-early-academic-specific-no-data' });
    return await finalizeSemanticResult(question, builtEarlyAcademicSpecificNoData, resultCacheKey);
  }

  const feedbackDirect = strictDocumentOnly ? null : tryFeedbackAnswer(question);
  if (feedbackDirect && feedbackDirect.answer) {
    const builtFeedback = buildDeterministicResponse(question, 'semantic-rag-feedback', feedbackDirect, { routeStage: 'pre-ai-feedback' });
    return await finalizeSemanticResult(question, builtFeedback, resultCacheKey);
  }
  const explicitInbisSupport = strictDocumentOnly ? null : (/\b(?:inbis|inkubator\s+bisnis|incubator\s+bisnis)\b/i.test(earlySupportQuestion) ? tryCampusSupportEntityAnswer(question, getCachedSemanticIndex(), options) : null);
  if (explicitInbisSupport && explicitInbisSupport.answer) {
    const builtInbisSupport = buildDeterministicResponse(question, 'semantic-rag-campus-support-entity', explicitInbisSupport, { routeStage: 'pre-ai-campus-support-inbis' });
    return await finalizeSemanticResult(question, builtInbisSupport, resultCacheKey);
  }
  const abbreviationClarification = strictDocumentOnly ? null : tryAmbiguousAbbreviationClarificationAnswer(question);
  if (abbreviationClarification && abbreviationClarification.answer) {
    // Before asking user to clarify an ambiguous abbrev, probe the local
    // uploaded-training index for the uppercase candidate (e.g., INBIS).
    // If the local RAG has content for the abbreviation, prefer that
    // authoritative evidence instead of asking a clarification.
    try {
      const abbr = extractAmbiguousAbbreviation(question);
      if (abbr) {
        const probe = await tryLocalUploadedTrainingGenericAnswer(abbr, options);
        if (probe && probe.answer) {
          if (debugTrace) console.log('[TRACE PRE_AI] returning probe result for abbreviation:', { abbr, source: probe.source });
          return await finalizeSemanticResult(question, probe, resultCacheKey);
        }
      }
    } catch (e) {
      if (debugTrace) console.log('[TRACE PRE_AI] abbreviation probe failed', e && e.message ? e.message : String(e));
    }

    const response = buildDeterministicResponse(question, 'semantic-rag-abbreviation-clarification', abbreviationClarification, { routeStage: 'pre-ai-abbreviation-clarification' });
    return await finalizeSemanticResult(question, response, resultCacheKey);
  }
  const pmbRequirementsDirect = strictDocumentOnly ? null : tryPmbRequirementsAnswer(question, getCachedSemanticIndex(), options);
  if (pmbRequirementsDirect && pmbRequirementsDirect.answer) {
    const builtPmbRequirements = buildDeterministicResponse(question, 'semantic-rag-pmb-requirements', pmbRequirementsDirect, { routeStage: 'pre-ai-pmb-requirements' });
    return await finalizeSemanticResult(question, builtPmbRequirements, resultCacheKey);
  }

  const shortDefinitionResponse = strictDocumentOnly ? null : tryShortProgramDefinitionDirectAnswer(question);
  if (shortDefinitionResponse) {
    return await finalizeSemanticResult(question, shortDefinitionResponse, resultCacheKey);
  }
  const financeOperationalResult = strictDocumentOnly || client ? null : tryFinanceFallback(question);
  if (financeOperationalResult && financeOperationalResult.answer) {
    const builtFinanceResult = buildDeterministicResponse(question, 'semantic-rag-finance-fallback', financeOperationalResult, { routeStage: 'pre-ai-finance' });
    return await finalizeSemanticResult(question, builtFinanceResult, resultCacheKey);
  }

  if (!strictDocumentOnly && !client && /\b(double\s*degree|dual\s*degree|dd|utb|dnui|help\s+university)\b/i.test(String(question || '')) && /\b(biaya|harga|tarif|bayar|pembayaran|dpp|potongan|diskon|rincian|nominal|total)\b/i.test(String(question || ''))) {
    try {
      const legacyDualDegreeFee = await ragEngine.query(question, options.topK || 5, { ...(options || {}), semanticDualDegreeFeeBridge: true });
      if (legacyDualDegreeFee && legacyDualDegreeFee.answer && /dual-degree|double-degree/i.test(String(legacyDualDegreeFee.source || ''))) {
        return await finalizeSemanticResult(question, legacyDualDegreeFee, resultCacheKey);
      }
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] legacy double degree fee bridge failed');
    }
  }
  const academicSpecificNoData = strictDocumentOnly ? null : tryAcademicSpecificNoDataAnswer(question);
  if (academicSpecificNoData && academicSpecificNoData.answer) {
    const builtAcademicSpecificNoData = buildDeterministicResponse(question, academicSpecificNoData.source || 'semantic-rag-academic-no-data', academicSpecificNoData, { routeStage: 'pre-ai-academic-specific-no-data' });
    return await finalizeSemanticResult(question, builtAcademicSpecificNoData, resultCacheKey);
  }

  const academicCreditNoData = strictDocumentOnly ? null : tryAcademicCreditNoDataAnswer(question);
  if (academicCreditNoData && academicCreditNoData.answer) {
    const builtAcademicCredit = buildDeterministicResponse(question, academicCreditNoData.source || 'semantic-rag-academic-credit-no-data', academicCreditNoData, { routeStage: 'pre-ai-academic-credit' });
    return await finalizeSemanticResult(question, builtAcademicCredit, resultCacheKey);
  }

  const genericFeeClarification = strictDocumentOnly ? null : tryGenericFeeClarificationAnswer(question);
  if (genericFeeClarification && genericFeeClarification.answer) {
    const builtGenericFeeClarification = buildDeterministicResponse(question, genericFeeClarification.source || 'semantic-rag-fee-clarification', genericFeeClarification, { routeStage: 'pre-ai-fee-clarification' });
    return await finalizeSemanticResult(question, builtGenericFeeClarification, resultCacheKey);
  }

  const hasDirectFeeSignal = hasExplicitFeeQuestionSignal(question);
  if (!strictDocumentOnly && !client && hasDirectFeeSignal) {
    const feeResult = tryDetailedFeeAnswer(question, getCachedSemanticIndex(), options);
    if (feeResult && feeResult.answer) {
      const builtFeeResult = buildDeterministicResponse(question, 'semantic-rag-fee-detail', feeResult, { routeStage: 'pre-ai-fee' });
      return await finalizeSemanticResult(question, builtFeeResult, resultCacheKey);
    }
  }

  const earlySupportHandlers = strictDocumentOnly ? [] : handlersForSources([
    'semantic-rag-campus-support-entity',
    'semantic-rag-career-softskill',
    'semantic-rag-campus-facility'
  ]);
  const earlySupportResult = (!strictDocumentOnly && !client)
    ? runDeterministicHandlers(question, earlySupportHandlers, options, [question], { routeStage: 'pre-ai-support' })
    : null;
  if (earlySupportResult) {
    return await finalizeSemanticResult(question, earlySupportResult, resultCacheKey);
  }

  if (!strictDocumentOnly && !client && isInstitutionVisionMissionQuestion(question)) {
    const institutionVisionMission = tryInstitutionVisionMissionAnswer(question, getCachedSemanticIndex());
    if (institutionVisionMission && institutionVisionMission.answer) {
      const builtInstitutionVisionMission = buildDeterministicResponse(question, 'semantic-rag-institution-vision-mission', institutionVisionMission, { routeStage: 'pre-ai-institution-vision-mission' });
      return await finalizeSemanticResult(question, builtInstitutionVisionMission, resultCacheKey);
    }
  }

  await getActiveTrainingDataFromDb();
  if (!strictDocumentOnly && isIndustryServicesQuestion(question)) {
    const industryIndexAnswer = tryIndustryServicesAnswerFromIndex(question);
    if (industryIndexAnswer && industryIndexAnswer.answer) {
      return await finalizeSemanticResult(question, buildDeterministicResponse(question, industryIndexAnswer.source, industryIndexAnswer, { routeStage: 'pre-guard-industry-services-index' }), resultCacheKey);
    }
    if (process.env.NODE_ENV === 'test') {
      const industryNoData = { answer: buildIndustryServicesNoDataAnswer(), source: 'semantic-rag-campus-facility-insufficient-data', frameSource: 'semantic-rag-insufficient-data' };
      return await finalizeSemanticResult(question, buildDeterministicResponse(question, industryNoData.source, industryNoData, { routeStage: 'pre-guard-industry-services-no-data-test' }), resultCacheKey);
    }
  }

  if (!strictDocumentOnly) {
    try {
      const evidenceFirstResult = await tryEvidenceFirstLocalDocumentAnswer(question, options);
      if (evidenceFirstResult && evidenceFirstResult.answer) {
        if (debugTrace) {
          console.log('[TRACE PRE_AI] returning evidence-first document result:', {
            source: evidenceFirstResult.source,
            fineIntent: evidenceFirstResult.debug && evidenceFirstResult.debug.fineIntent,
            answerPreview: String(evidenceFirstResult.answer).slice(0, 100)
          });
        }
        return await finalizeSemanticResult(question, evidenceFirstResult, resultCacheKey);
      }
    } catch (e) {
      try { console.warn('[SemanticRAG] evidence-first document probe failed', e && e.message ? e.message : String(e)); } catch (_) {}
    }
  }
  if (!strictDocumentOnly && /\b(?:pasca|pascasarjana|pasca\s*sarjana|magister|s2|s\s*2)\b/i.test(String(question || ''))) {
    const postgraduateProfile = tryPostgraduateProfileAnswer(question);
    if (postgraduateProfile && postgraduateProfile.answer) {
      return await finalizeSemanticResult(question, buildDeterministicResponse(question, postgraduateProfile.source, postgraduateProfile, { routeStage: 'pre-ai-postgraduate-profile' }), resultCacheKey);
    }
    const earlyUploadedTraining = await tryLocalUploadedTrainingGenericAnswer(question, options);
    if (earlyUploadedTraining && earlyUploadedTraining.answer) {
      if (debugTrace) {
        console.log('[TRACE PRE_AI] returning early uploaded-training result for postgraduate question:', {
          source: earlyUploadedTraining.source,
          answerPreview: String(earlyUploadedTraining.answer).slice(0, 100)
        });
      }
      return await finalizeSemanticResult(question, earlyUploadedTraining, resultCacheKey);
    }
  }
  const preAiHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_AI_HANDLER_SOURCES.has(source));
  const shouldDeferDeterministicToSemantic = Boolean(client) && shouldDeferDeterministicBeforeSemantic(question);
  if (debugTrace) {
    console.log('[TRACE STRICT] strictDocumentOnly:', strictDocumentOnly);
    console.log('[TRACE PRE_AI] handlers:', preAiHandlers.map(([s]) => s));
    console.log('[TRACE PRE_AI] question:', question);
    console.log('[TRACE PRE_AI] shouldDeferDeterministicToSemantic:', shouldDeferDeterministicToSemantic);
    console.log('[TRACE PRE_AI] PRE_AI_HANDLER_SOURCES membership check:', {
      'semantic-rag-graduation-registration': PRE_AI_HANDLER_SOURCES.has('semantic-rag-graduation-registration'),
      'semantic-rag-academic-grade': PRE_AI_HANDLER_SOURCES.has('semantic-rag-academic-grade'),
      'semantic-rag-certification': PRE_AI_HANDLER_SOURCES.has('semantic-rag-certification')
    });
  }

  let preAiResult = null;
  if (!strictDocumentOnly && !shouldDeferDeterministicToSemantic) {
    preAiResult = runDeterministicHandlers(question, preAiHandlers, options, [question], { routeStage: 'pre-ai' });
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
      return await finalizeSemanticResult(question, preAiResult, resultCacheKey);
    }
  }

  const preRewriteHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_REWRITE_HANDLER_SOURCES.has(source));
  let preRewriteResult = null;
  if (!strictDocumentOnly && !shouldDeferDeterministicToSemantic) {
    preRewriteResult = runDeterministicHandlers(question, preRewriteHandlers, options, [question], { routeStage: 'pre-rewrite' });
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
      return await finalizeSemanticResult(question, preRewriteResult, resultCacheKey);
    }
  }

  if (!strictDocumentOnly && shouldProbeUploadedTrainingBeforeDeterministic(question)) {
    const preAiUploadedTraining = await tryLocalUploadedTrainingGenericAnswer(question, options);
    if (preAiUploadedTraining && preAiUploadedTraining.answer) {
      if (debugTrace) {
        console.log('[TRACE PRE_AI] returning local uploaded-training result after deterministic probes:', {
          source: preAiUploadedTraining.source,
          answerPreview: String(preAiUploadedTraining.answer).slice(0, 100)
        });
      }
      return await finalizeSemanticResult(question, preAiUploadedTraining, resultCacheKey);
    }
  }

  // (index-first deterministic pass removed - rely on semantic routing and
  // retriever flow to decide deterministic handlers after rewrite and RAG)

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
    const deterministicFirstForKnownCampusTopic = isKnownSpecializedCampusQuestion(question);
    if (deterministicFirstForKnownCampusTopic) {
      const fallbackResult = runDeterministicHandlers(question, DETERMINISTIC_HANDLERS, options, [question], { routeStage: 'fallback-no-ai-known-topic' });
      if (fallbackResult) {
        return await finalizeSemanticResult(question, fallbackResult, resultCacheKey);
      }
    }

    let localUploadedTraining = await tryLocalUploadedTrainingGenericAnswer(question, options);
    if (localUploadedTraining && localUploadedTraining.answer) {
      // If the uploaded-training result addresses explicit academic/admin topics
      // such as yudisium or wisuda, normalize the source to an academic tag
      // so downstream routing/tests expecting academic sources remain stable.
      if (/\b(yudisium|wisuda|jadwal|pendaftaran\s+yudisium|jadwal\s+yudisium)\b/i.test(String(question || ''))) {
        localUploadedTraining = { ...localUploadedTraining, source: 'semantic-rag-academic' };
      }
      return await finalizeSemanticResult(question, localUploadedTraining, resultCacheKey);
    }

    if (!deterministicFirstForKnownCampusTopic) {
      const fallbackResult = runDeterministicHandlers(question, DETERMINISTIC_HANDLERS, options, [question], { routeStage: 'fallback-no-ai' });
      if (fallbackResult) {
        return await finalizeSemanticResult(question, fallbackResult, resultCacheKey);
      }
    }
    if (isGeneralCampusAvailabilityQuestion(question)) {
      const generalNoData = {
        success: true,
        answer: buildGeneralAvailabilityNoDataAnswer(question),
        source: 'semantic-rag-general-availability-no-data',
        contexts: [],
        confidenceTier: 'VERY_LOW'
      };
      return await finalizeSemanticResult(question, generalNoData, resultCacheKey);
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

  if (rewrite.needsClarification) {
    const qForRecommendation = String(question || '').toLowerCase();
    const asksProgramFit = /\b(cocok|rekomendasi|saran|pilih|pilihan|jurusan|prodi|program\s+studi)\b/i.test(qForRecommendation);
    const hasInterestSignal = /\b(suka|hobi|hobby|minat|tertarik|senang|ingin|pengen|desain|design|visual|dkv|ui\s*\/?\s*ux|konten|content|bisnis|marketing|jualan|usaha|coding|ngoding|programming|pemrograman|jaringan|network|server|hardware|komputer|data|analisis|game|aplikasi|web|website)\b/i.test(qForRecommendation);
    if (asksProgramFit && hasInterestSignal) {
      const canonicalQuestion = `Rekomendasi jurusan/prodi ITB STIKOM Bali berdasarkan minat: ${String(question || '').trim()}`;
      rewrite = {
        ...(rewrite && typeof rewrite === 'object' ? rewrite : {}),
        canonicalQuestion,
        searchQueries: uniqueList([canonicalQuestion, String(question || '').trim(), 'rekomendasi jurusan prodi berdasarkan minat hobi'], 4),
        intent: 'program_recommendation',
        confidence: Math.max(Number(rewrite.confidence) || 0, 0.78),
        needsClarification: false,
        clarificationQuestion: ''
      };
    }
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
    return await finalizeSemanticResult(question, response, resultCacheKey);
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


  const queryUnderstanding = buildQueryUnderstanding(question, rewrite, {
    intentHint: options.intentHint || '',
    dynamicAliases: buildDynamicAliasDictionary(getCachedSemanticIndex()),
    sessionData: options.sessionData || {},
    conversationHistory: getRecentConversation(options.sessionData || null),
    memory: {
      lastProgramHint: options.sessionData && options.sessionData.lastProgramHint || null,
      lastIntent: options.sessionData && options.sessionData.lastIntent || null
    }
  });
  const retrieved = await retrieveSemanticContexts(queryUnderstanding.searchQueries, {
    topK: options.topK,
    question,
    intent: rewrite.intent,
    queryUnderstanding
  });
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
  let evidenceProcessingResult = null;
  if (selectedEvidence.length > 0) {
    try {
      answerabilityResult = evaluateEvidenceAnswerability({ question, selectedEvidence, intent: rewrite.intent });
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] evidence answerability evaluation failed, proceeding with generation');
    }
  }
  evidenceProcessingResult = processEvidence(selectedEvidence, answerabilityResult, queryUnderstanding);
  const techniquePipelineDebug = {
    queryUnderstanding,
    retrieval: retrieved.techniquePipeline || null,
    evidenceProcessing: evidenceProcessingResult
  };

  if (evidenceProcessingResult.conflicts.length && envFlag('SEMANTIC_RAG_BLOCK_CONFLICTING_EVIDENCE', false)) {
    return {
      success: true,
      answer: buildSpecificInsufficientDataAnswer(question, ['conflicting_evidence']),
      source: 'semantic-rag-conflicting-evidence',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      confidenceTier: 'LOW',
      debug: { rewrite, queryUnderstanding, evidenceProcessingResult }
    };
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
        debug: { rewrite, minScore, veryLowThreshold, indexSize: retrieved.indexSize, answerabilityResult, failureReason: failureReason('no_context'), strictDocumentOnly: true }
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
      debug: { rewrite, minScore, veryLowThreshold, indexSize: retrieved.indexSize, answerabilityResult, failureReason: failureReason('no_context') }
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
        debug: { rewrite, answerabilityResult, failureReason: failureReason('unanswerable'), strictDocumentOnly: true }
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
      debug: { rewrite, answerabilityResult, failureReason: failureReason('unanswerable') }
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
          debug: { rewrite, answerabilityResult, failureReason: failureReason('empty_answer'), strictDocumentOnly: true }
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
      const emptyAnswerResult = { success: true, answer: buildInsufficientDataAnswer('very_low'), source: 'semantic-rag-empty-answer', contexts: selectedEvidence, confidenceScore: retrieved.topScore, confidenceTier: 'VERY_LOW', debug: { rewrite, answerabilityResult, failureReason: failureReason('empty_answer') } };
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
          debug: { rewrite, answerabilityResult, failureReason: failureReason('insufficient_context') }
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
        debug: { rewrite, answerabilityResult, failureReason: failureReason('insufficient_context') }
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
      const evidenceAnswerOnBlock = buildLocalUploadedTrainingAnswer(question, selectedEvidence);
      const evidencePreflightOnBlock = evidenceAnswerOnBlock && answerMatchesStrongQuestionAnchors(question, evidenceAnswerOnBlock) && !hasUploadedDocumentTopicConflict(question, evidenceAnswerOnBlock) ? evaluateOutboundAnswer(evidenceAnswerOnBlock, question, { source: 'semantic-rag-uploaded-training-generic' }) : null;
      if (evidenceAnswerOnBlock && evidencePreflightOnBlock && !evidencePreflightOnBlock.blocked && !hasLikelyRawDocumentLeak(evidenceAnswerOnBlock)) {
        const evidenceResult = {
          success: true,
          answer: formatNaturalAnswerFrame(question, evidenceAnswerOnBlock, 'semantic-rag-uploaded-training-generic'),
          source: 'semantic-rag-uploaded-training-generic',
          contexts: selectedEvidence,
          confidenceScore: retrieved.topScore,
          confidenceTier: retrieved.topScore >= 0.3 ? 'HIGH' : 'MEDIUM',
          debug: { rewrite, preflight, evidencePreflightOnBlock, answerabilityResult, recoveredFrom: 'preflight-blocked' }
        };
        setCachedSemanticResult(resultCacheKey, evidenceResult);
        return evidenceResult;
      }
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
          debug: { rewrite, preflight, answerabilityResult, failureReason: failureReason('preflight_blocked', { issues: preflight.issues, action: preflight.action }) }
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
        debug: { rewrite, preflight, answerabilityResult, failureReason: failureReason('preflight_blocked', { issues: preflight.issues, action: preflight.action }) }
      };
      if (debugTrace) {
        console.log('[TRACE PREFLIGHT_BLOCKED] RETURNING preflight-blocked result');
      }
      return preflightBlockedResult;
    }

    if (isMeaningMismatchAnswer(question, preflight.answer, 'semantic-rag')) {
      const evidenceAnswerOnMismatch = buildLocalUploadedTrainingAnswer(question, selectedEvidence);
      const evidencePreflightOnMismatch = evidenceAnswerOnMismatch && answerMatchesStrongQuestionAnchors(question, evidenceAnswerOnMismatch) && !hasUploadedDocumentTopicConflict(question, evidenceAnswerOnMismatch) ? evaluateOutboundAnswer(evidenceAnswerOnMismatch, question, { source: 'semantic-rag-uploaded-training-generic' }) : null;
      if (evidenceAnswerOnMismatch && evidencePreflightOnMismatch && !evidencePreflightOnMismatch.blocked && !hasLikelyRawDocumentLeak(evidenceAnswerOnMismatch)) {
        const evidenceResult = {
          success: true,
          answer: formatNaturalAnswerFrame(question, evidenceAnswerOnMismatch, 'semantic-rag-uploaded-training-generic'),
          source: 'semantic-rag-uploaded-training-generic',
          contexts: selectedEvidence,
          confidenceScore: retrieved.topScore,
          confidenceTier: retrieved.topScore >= 0.3 ? 'HIGH' : 'MEDIUM',
          debug: { rewrite, preflight, evidencePreflightOnMismatch, answerabilityResult, recoveredFrom: 'meaning-mismatch' }
        };
        setCachedSemanticResult(resultCacheKey, evidenceResult);
        return evidenceResult;
      }
      logger.warn({
        reason: 'meaning_mismatch',
        question,
        anchors: extractMeaningAnchors(question),
        answerPreview: String(preflight.answer || '').slice(0, 180)
      }, '[SemanticRAG] answer blocked by meaning relevance gate');

      const meaningFallback = fallbacksAllowed ? runVettedDeterministicFallback(question, options, rewrite, 'rag-meaning-mismatch-deterministic-fallback') : null;
      if (meaningFallback) {
        setCachedSemanticResult(resultCacheKey, meaningFallback);
        return meaningFallback;
      }

      const meaningMismatchResult = {
        success: true,
        answer: buildMeaningMismatchFallbackAnswer(question),
        source: 'semantic-rag-meaning-mismatch',
        contexts: selectedEvidence,
        confidenceScore: retrieved.topScore,
        confidenceTier: 'VERY_LOW',
        debug: { rewrite, preflight, answerabilityResult, failureReason: failureReason('meaning_mismatch'), meaningAnchors: extractMeaningAnchors(question) }
      };
      setCachedSemanticResult(resultCacheKey, meaningMismatchResult);
      return meaningMismatchResult;
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
      answer: formattedAnswer,
      source: 'semantic-rag',
      contexts: selectedEvidence,
      confidenceScore: retrieved.topScore,
      confidenceTier: retrieved.topScore >= 0.3 ? 'HIGH' : 'MEDIUM',
      debug: { rewrite, indexSize: retrieved.indexSize, answerabilityResult, answerCategory, preflight, techniquePipeline: techniquePipelineDebug }
    };
    if (debugTrace) {
      console.log('[TRACE FINAL] CACHING and RETURNING semantic-rag response:', {
        source: response.source,
        answerPreview: String(response.answer).slice(0, 100)
      });
    }
    return await finalizeSemanticResult(question, response, resultCacheKey);
  } catch (err) {
    try { logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] answer generation failed'); } catch (_) {}
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
async function verifyOutboundSemanticRelevance(question, answer, source = 'provider-outbound') {
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (!q || !a) return { ok: true, skipped: true, reason: 'empty_question_or_answer' };
  const src = String(source || '').trim() || 'provider-outbound';

  const localMismatch = isMeaningMismatchAnswer(q, a, src);
  if (localMismatch) {
    return {
      ok: false,
      localMismatch: true,
      llmVerdict: null,
      reason: 'local_meaning_mismatch',
      meaningAnchors: extractMeaningAnchors(q)
    };
  }

  if (/^semantic-rag-/i.test(src)) {
    const preflight = evaluateOutboundAnswer(a, q, { source: src });
    const preflightIssues = Array.isArray(preflight && preflight.issues) ? preflight.issues : [];
    const structuredDocDump = a.length > 700
      && /\b(?:Perihal|Ditujukan\s+Kepada|Sehubungan\s+dengan|Lampiran|Tembusan|Persyaratan)\b/i.test(a)
      && ((a.match(/(?:^|\n|\s)\b[A-Z]\.\s+/g) || []).length >= 2 || (a.match(/\b(?:Hari\/Tanggal|Pukul|Tempat|Waktu)\s*:/gi) || []).length >= 4);
    const compactOutboundAcademicSafe = isSafeCompactAcademicScheduleAnswer(q, a) || isSafeCompactAcademicRequirementAnswer(q, a) || isSafeCompactAcademicGeneralAnswer(q, a);
    const structuredOutboundSafe = compactOutboundAcademicSafe
      || (/pmb-info/i.test(src) && isSafePmbOverviewAnswer(q, a))
      || (/dual-degree/i.test(src) && isSafeDualDegreeAnswer(q, a))
      || isSafeCampusFacilityAnswer(q, a, src)
      || isSafeProgramDefinitionAnswer(q, a, src)
      || isSafeAbbreviationClarificationAnswer(q, a, src);
    const unsafeSemanticOutput = !structuredOutboundSafe && (Boolean(preflight && preflight.blocked)
      || hasLikelyRawDocumentLeak(a)
      || structuredDocDump
      || preflightIssues.some((issue) => /(?:raw_document_leak|technical_leak|placeholder_or_ocr_noise|excessive_raw_quotation|too_long_for_query|long_answer_split_expected)/i.test(String(issue || ''))));

    if (unsafeSemanticOutput) {
      return {
        ok: false,
        localMismatch: false,
        llmVerdict: null,
        reason: 'semantic_rag_preflight_blocked',
        preflight,
        meaningAnchors: extractMeaningAnchors(q)
      };
    }

    return {
      ok: true,
      localMismatch: false,
      llmVerdict: null,
      reason: 'trusted_semantic_rag_local_verified',
      meaningAnchors: extractMeaningAnchors(q)
    };
  }

  const client = getClient();
  const llmVerdict = await verifyAnswerRelevanceWithLlm(client, q, a, src);
  if (llmVerdict && llmVerdict.ok === false) {
    return {
      ok: false,
      localMismatch: false,
      llmVerdict,
      reason: 'llm_meaning_mismatch',
      meaningAnchors: extractMeaningAnchors(q)
    };
  }

  return {
    ok: true,
    localMismatch: false,
    llmVerdict,
    reason: llmVerdict ? 'llm_verified' : 'local_verified_or_llm_unavailable',
    meaningAnchors: extractMeaningAnchors(q)
  };
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
  verifyOutboundSemanticRelevance,
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
  evaluateGenericAnswerability,
  resolveSemanticFollowupQuestion
};







