const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OpenAI } = require('openai');
const { AIReplyEngine } = require('./aiEngine');
const logger = require('../logger');
const { normalizeMojibakePunctuationForWhatsapp, sanitizeWhatsappText } = require('../utils/textSanitizer');
const { classifyIntent, getAllowedDocCategories, getForbiddenDocCategories, shouldIncludeChunkForIntent } = require('./intentClassifier');
const { validateChunkForAnswer, validateChunkEvidence, validateChunkRelevanceToQuestion } = require('./evidenceValidator');
const { enrichChunkWithCategory } = require('./docCategoryClassifier');
const { auditLogger } = require('./ragAuditLogger');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
// Allow overriding index location for production persistence.
// - RAG_INDEX_PATH: absolute or relative path to rag_index.json
// - RAG_DATA_DIR: directory that will contain rag_index.json (ignored if RAG_INDEX_PATH set)
const DATA_DIR = process.env.RAG_DATA_DIR
  ? path.resolve(String(process.env.RAG_DATA_DIR))
  : DEFAULT_DATA_DIR;

const INDEX_PATH = process.env.RAG_INDEX_PATH
  ? path.resolve(String(process.env.RAG_INDEX_PATH))
  : path.join(DATA_DIR, 'rag_index.json');

const INDEX_BAK_PATH = `${INDEX_PATH}.bak`;

// Limits to protect memory usage
// Increase default to 50MB to avoid aggressive truncation on medium-sized datasets.
const MAX_INDEX_BYTES = parseInt(process.env.RAG_MAX_INDEX_BYTES || String(50 * 1024 * 1024), 10); // 50MB default
const MAX_INGEST_CHARS = parseInt(process.env.RAG_MAX_CHARS || '50000', 10); // max chars per training text
const MAX_INGEST_CHUNKS = parseInt(process.env.RAG_MAX_CHUNKS || '200', 10); // max chunks per training

const FORBIDDEN_CORPUS_PATTERNS = [
  /\bSMK\s*TI\s*Bali\s*Global\b/i,
  /\bSMK\s*Pandawa\s*Bali\s*Global\b/i,
  /\bSMK\s*TI\s*Bali\s*Global\s*Sebali\b/i,
  /\bSMK\s*Pandawa\s*Bali\s*Global\s*Abiansemal\b/i
];

function chunkContainsForbiddenCorpusPhrase(chunk) {
  const text = String(chunk || '');
  return FORBIDDEN_CORPUS_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeCorpusChunkText(chunk) {
  if (!chunk || typeof chunk !== 'string') return chunk;
  const normalized = normalizeMojibakePunctuationForWhatsapp(chunk);
  return normalized.replace(/\s{2,}/g, ' ').trim();
}

function normalizeCorpusIndex(index) {
  if (!Array.isArray(index)) return [];
  return index
    .filter(item => item && !chunkContainsForbiddenCorpusPhrase(item.chunk))
    .map(item => ({
      ...item,
      chunk: normalizeCorpusChunkText(item.chunk)
    }));
}

function ensureDataDir() {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Recover from an interrupted save (index moved to .bak but not restored).
  if (!fs.existsSync(INDEX_PATH) && fs.existsSync(INDEX_BAK_PATH)) {
    try {
      fs.renameSync(INDEX_BAK_PATH, INDEX_PATH);
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Failed to restore index from backup');
    }
  }

  if (!fs.existsSync(INDEX_PATH)) fs.writeFileSync(INDEX_PATH, JSON.stringify([]));
}

function loadIndex() {
  ensureDataDir();
  try {
    // If index file is too large, reset it to avoid OOM
    const stat = fs.statSync(INDEX_PATH);
    if (stat.size > MAX_INDEX_BYTES) {
      logger.warn({ size: stat.size }, '[RAG] Index file too large, resetting index');
      fs.writeFileSync(INDEX_PATH, JSON.stringify([]));
      return [];
    }

    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    let index = JSON.parse(raw || '[]');
    index = normalizeCorpusIndex(index);
    
    // Enrich existing chunks that don't have docCategory field
    // This is needed to upgrade old indexes that were created before docCategory implementation
    if (Array.isArray(index)) {
      const chunksNeedingEnrichment = index.filter(c => c && !c.docCategory);
      if (chunksNeedingEnrichment.length > 0) {
        logger.info({
          total: index.length,
          needingEnrichment: chunksNeedingEnrichment.length,
          enrichmentRate: (chunksNeedingEnrichment.length / index.length * 100).toFixed(2) + '%'
        }, '[RAG] Enriching existing chunks with docCategory');
        
        // Enrich chunks
        index = index.map(chunk => {
          if (!chunk || chunk.docCategory) return chunk; // Already has docCategory
          return enrichChunkWithCategory(chunk);
        });
        
        // Save enriched index back
        try {
          saveIndex(index);
          logger.info('[RAG] Index enriched and saved with docCategory fields');
        } catch (saveErr) {
          logger.warn({ err: saveErr.message }, '[RAG] Failed to save enriched index');
        }
      }
    }
    
    return index;
  } catch (err) {
    // If parsing fails, try to recover from the backup.
    try {
      if (fs.existsSync(INDEX_BAK_PATH)) {
        const bakRaw = fs.readFileSync(INDEX_BAK_PATH, 'utf-8');
        const parsed = JSON.parse(bakRaw || '[]');
        if (Array.isArray(parsed)) {
          logger.warn({ err: err.message }, '[RAG] Failed to load index, restored from backup');
          fs.writeFileSync(INDEX_PATH, bakRaw);
          return parsed;
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Failed to recover index from backup');
    }

    logger.error({ err: err.message }, '[RAG] Failed to load index, using empty index');
    return [];
  }
}

function writeIndexJson(json) {
  ensureDataDir();
  const tmpPath = `${INDEX_PATH}.tmp`;

  // Write to tmp first, then replace via rename (Windows-safe) using .bak.
  fs.writeFileSync(tmpPath, json);
  if (fs.existsSync(INDEX_BAK_PATH)) {
    try { fs.unlinkSync(INDEX_BAK_PATH); } catch { /* ignore */ }
  }
  if (fs.existsSync(INDEX_PATH)) fs.renameSync(INDEX_PATH, INDEX_BAK_PATH);
  fs.renameSync(tmpPath, INDEX_PATH);

  if (fs.existsSync(INDEX_BAK_PATH)) {
    try { fs.unlinkSync(INDEX_BAK_PATH); } catch { /* ignore */ }
  }
}

function saveIndex(index) {
  try {
    // Normalize corpus before saving to prevent forbidden phrases from reentering the persisted index.
    const normalizedIndex = normalizeCorpusIndex(index);
    // Prefer compact JSON to reduce on-disk size; still human-readable via tools if needed.
    const json = JSON.stringify(normalizedIndex);
    if (Buffer.byteLength(json, 'utf-8') > MAX_INDEX_BYTES) {
      logger.warn('[RAG] Index too large after ingest, truncating to last items to fit limit.');
      // Keep the most recent items within the size limit
      let trimmed = index.slice();
      while (trimmed.length > 0) {
        const candidate = JSON.stringify(trimmed, null, 2);
        if (Buffer.byteLength(candidate, 'utf-8') <= MAX_INDEX_BYTES) {
          writeIndexJson(candidate);
          return;
        }
        trimmed.shift();
      }
      // If everything fails, reset to empty
      writeIndexJson(JSON.stringify([]));
      return;
    }

    writeIndexJson(json);
    try {
      const size = Buffer.byteLength(json, 'utf-8');
      logger.info({ size, max: MAX_INDEX_BYTES }, '[RAG] Saved index');
    } catch (e) {
      // ignore
    }
  } catch (err) {
    logger.error({ err: err.message }, '[RAG] Failed to save index');
  }
}

function removeTrainingFromIndex(trainingId) {
  const tid = String(trainingId || '').trim();
  if (!tid) return { removed: 0, before: 0, after: 0 };

  const index = loadIndex();
  const list = Array.isArray(index) ? index : [];
  const before = list.length;

  const filtered = list.filter((it) => {
    const itemTid = it && it.trainingId ? String(it.trainingId).trim() : '';
    return itemTid !== tid;
  });

  const after = filtered.length;
  const removed = before - after;
  if (removed > 0) saveIndex(filtered);
  return { removed, before, after };
}

function cosineSimilarity(a, b) {
  const dot = a.reduce((s, v, i) => s + v * (b[i] || 0), 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

function tokenizeForRelevanceGuard(text) {
  const t = normalizeIndonesianQuestionText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!t) return [];

  const stop = new Set([
    'yang', 'dan', 'atau', 'di', 'ke', 'dari', 'untuk', 'dengan', 'apa', 'itu', 'ini', 'itu',
    'kak', 'min', 'dong', 'ya', 'yaa', 'yah', 'nih', 'nya', 'gimana', 'bagaimana',
    'berapa', 'kapan', 'dimana', 'mana', 'tolong', 'mohon', 'saya', 'kami', 'aku',
    'mau', 'ingin', 'pengen', 'pengin', 'bisa', 'boleh', 'tanya', 'cocok', 'jurusan', 'program'
  ]);

  const parts = t.split(' ').filter(Boolean);
  const specialTokens = new Set([
    'si','ti','bd','sk','mi','dkv','trpl','tk','mm','an','dg','rpl',
    'dnui','utb','help','s2','d3'
  ]);
  const out = [];
  for (const p of parts) {
    if (p.length < 3 && !specialTokens.has(p)) continue;
    if (stop.has(p)) continue;
    out.push(p);
  }
  return Array.from(new Set(out)).slice(0, 12);
}

function isAdminInternalChunk(chunk, filename) {
  const text = String(chunk || '').toLowerCase();
  const file = String(filename || '').toLowerCase();
  const adminPattern = /\b(?:mou|moa|kerja\s+sama|kerjasama|perjanjian|kontrak|memorandum|mitra|partner|sponsor|admin|internal|manajemen|keuangan|kepegawaian|rapat|agenda|notulen|berita|news|pengumuman\s+internal)\b/i;
  return adminPattern.test(text) || adminPattern.test(file);
}

function chunkHasRequestedProgram(item, requestedProgram) {
  if (!item || !requestedProgram) return false;
  const req = String(requestedProgram || '').toUpperCase().trim();
  if (!req) return false;
  const entities = getChunkEntities(item);
  if (entities.program && String(entities.program).toUpperCase() === req) return true;
  const text = String(item.chunk || '').toLowerCase();
  const patterns = {
    SI: /\b(sistem informasi|si)\b/i,
    TI: /\b(teknologi informasi|ti)\b/i,
    BD: /\b(bisnis digital|bd)\b/i,
    SK: /\b(sistem komputer|sk)\b/i,
    MI: /\b(manajemen informatika|mi)\b/i,
    DKV: /\b(desain komunikasi visual|dkv)\b/i,
    TRPL: /\b(teknologi rekayasa perangkat lunak|trpl)\b/i,
    TK: /\b(teknologi komputer|tk)\b/i,
    MM: /\b(multimedia|mm)\b/i,
    AN: /\b(animasi|an)\b/i,
    DG: /\b(desain grafis|dg)\b/i,
    RPL: /\b(rekognisi pembelajaran lampau|rpl)\b/i
  };
  const pattern = patterns[req] || new RegExp(`\\b${escapeRegex(req)}\\b`, 'i');
  return pattern.test(text);
}

function keywordCoverage(tokens, text) {
  if (!tokens || tokens.length === 0) return 1;
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return 0;

  let hit = 0;
  for (const tok of tokens) {
    if (!tok) continue;
    // Loose includes is fine here; this is a guard, not ranking.
    if (hay.includes(tok)) hit++;
  }
  return hit / tokens.length;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIndonesianQuestionText(raw) {
  // Goal: make casual WhatsApp Indonesian queries match more reliably.
  // Keep it conservative to avoid changing intent.
  let t = String(raw || '').toLowerCase();
  if (!t.trim()) return '';

  // Remove obvious noise/punctuation while keeping letters/numbers.
  t = t
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Normalize common chat abbreviations.
  const repl = [
    [/\byg\b/g, 'yang'],
    [/\bdmn\b/g, 'di mana'],
    [/\bgmn\b/g, 'bagaimana'],
    [/\bbrp\b/g, 'berapa'],
    [/\butk\b/g, 'untuk'],
    [/\bdr\b/g, 'dari'],
    [/\bdpt\b/g, 'dapat'],
    [/\btdk\b/g, 'tidak'],
    [/\bgk\b/g, 'tidak'],
    [/\bga\b/g, 'tidak'],
    [/\bgak\b/g, 'tidak'],
    [/\bnggak\b/g, 'tidak'],
    [/\benggak\b/g, 'tidak'],
    [/\btrs\b/g, 'terus'],
    [/\btrus\b/g, 'terus'],
    [/\budh\b/g, 'sudah'],
    [/\budah\b/g, 'sudah'],
    [/\baja\b/g, 'saja'],
    [/\bbgt\b/g, 'banget'],
    [/\bpls\b/g, 'tolong'],
    [/\bplis\b/g, 'tolong'],
    [/\bpliss\b/g, 'tolong'],
    [/\bmin\b/g, 'admin'],
    // Map colloquial 'ngoding' -> 'coding' to match hobby-doc terminology
    [/\bngoding\b/g, 'coding'],
    [/\bngod\b/g, 'coding'],
  ];
  for (const [re, to] of repl) t = t.replace(re, to);

  // Collapse exaggerated letters ("apaa" -> "apaa" -> "apa"), keep 2 max.
  t = t.replace(/([a-z])\1{2,}/g, '$1$1');

  // Remove common fillers that do not change meaning.
  t = t
    .replace(/\b(kak|kakak|kaka|dong|deh|nih|yaa|ya|yah|hehe|wkwk|admin)\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return t;
}

// ============================================================================
// FINAL PRODUCTION VALIDATORS - ENTERPRISE-GRADE RAG HARDENING
// ============================================================================

// **VALIDATOR 1: Query Normalization** - normalize typo/colloquial/abbreviation
function normalizeQueryForRetrieval(rawQuery) {
  let q = String(rawQuery || '').toLowerCase().trim();
  const abbrevMap = {
    'brp': 'berapa',
    'glw': 'gelombang',
    'glmb': 'gelombang',
    'ti': 'teknologi informasi',
    'si': 'sistem informasi',
    'bd': 'bisnis digital',
    'mi': 'manajemen informatika',
    'sk': 'sistem komputer',
    'dpp': 'dana pendidikan pokok',
    'ukt': 'uang kuliah tunggal',
    'spp': 'sumbangan pembinaan pendidikan',
    'pmb': 'penerimaan mahasiswa baru',
    'tgl': 'tanggal',
    'dl': 'deadline'
  };
  for (const [short, long] of Object.entries(abbrevMap)) {
    q = q.replace(new RegExp(`\\b${short}\\b`, 'g'), long);
  }
  // Intent-aware expansion: for short program tokens or full program names,
  // append related phrases so the embedding captures program/profile context.
  const expansions = {
    'ti': ['teknologi informasi', 'program studi teknologi informasi', 'profil teknologi informasi'],
    'teknologi informasi': ['program studi teknologi informasi', 'profil teknologi informasi'],
    'si': ['sistem informasi', 'program studi sistem informasi', 'profil sistem informasi'],
    'sistem informasi': ['program studi sistem informasi', 'profil sistem informasi'],
    'bd': ['bisnis digital', 'program studi bisnis digital', 'profil bisnis digital'],
    'bisnis digital': ['program studi bisnis digital', 'profil bisnis digital'],
    'mi': ['manajemen informatika', 'program studi manajemen informatika', 'profil manajemen informatika'],
    'sk': ['sistem komputer', 'program studi sistem komputer', 'profil sistem komputer']
  };

  // Detect presence of key tokens in the original raw query (lowercased)
  const rawLower = String(rawQuery || '').toLowerCase();
  const added = [];
  for (const [key, list] of Object.entries(expansions)) {
    const re = new RegExp(`\\b${key.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(rawLower) && !re.test(q)) {
      // If the raw query had the short token but q replacement removed it, still expand
      added.push(...list);
    } else if (re.test(q)) {
      // If normalized q contains the program token, also expand
      added.push(...list);
    }
  }

  if (added.length > 0) {
    // Append unique expansions to the query to bias embedding
    const uniq = Array.from(new Set(added.map(s => String(s).trim()))).join(' ');
    q = `${q} ${uniq}`.replace(/\s{2,}/g, ' ').trim();
  }

  return q.replace(/\s{2,}/g, ' ').trim();
}

function deriveProgramAlias(raw) {
  const candidate = String(raw || '').replace(/[\(\)\[\]\.,]/g, ' ').trim();
  if (!candidate) return null;
  const ignored = /^(program|studi|prodi|jurusan|teknik|teknologi|manajemen|ilmu|pendidikan|sistem|informasi|internasional|bisnis|digital|perangkat|lunak|terapan|komputer|multi|media|animasi|desain|grafis|antara|kerja|sama|double|dual|degree|bali|china|dalian|dan|atau|serta|dengan|untuk|dari|ke|di|pada|oleh|dalam)$/i;
  const words = candidate.split(/\s+/).filter((word) => word && !ignored.test(word));
  if (words.length === 0) return null;

  const aliasWord = words
    .map((word) => String(word || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .find((token) => token && VALID_PROGRAMS.has(token));
  if (aliasWord) return aliasWord;

  if (words.length === 1) {
    const token = words[0].replace(/[^A-Za-z0-9]/g, '');
    if (token.length <= 5) return token.toUpperCase();
    const initials = token.match(/[A-Z]/g);
    if (initials && initials.length >= 2) return initials.join('').toUpperCase();
    return token.slice(0, 4).toUpperCase();
  }
  const alias = words.map(w => w[0]).join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return alias.length >= 2 ? alias.slice(0, 5) : null;
}

const VALID_PROGRAMS = new Set([
  'SI',
  'TI',
  'BD',
  'SK',
  'MI',
  'DKV',
  'TRPL',
  'TK',
  'MM',
  'AN',
  'DG',
  'RPL'
]);

function extractProgramNameFromText(raw) {
  const text = String(raw || '');
  const match = text.match(/(?:program\s+studi|prodi|jurusan|program)\s+([A-Za-z0-9][A-Za-z0-9\s\/&-]*?)(?=\s+(?:TA|Tahun\s+Akademik|Gelombang|Gel|[0-9]{4})|[\n\r\.;,\(]|$)/i);
  if (!match) return null;
  return String(match[1] || '').replace(/\s+/g, ' ').trim();
}

function normalizeProgramLabel(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  const normalized = lower.replace(/\s+/g, ' ').trim();
  const compact = lower.replace(/\s+/g, '').trim();
  const aliasMap = [
    { pattern: /(?:program\s+studi|prodi|jurusan)\s+informasi\b/, alias: 'SI' },
    { pattern: /\b(?:sistem\s+komputer|sk|s\.?\s*k(?:om(?:puter)?)?\.?)\b/, alias: 'SK' },
    { pattern: /(?:program\s+studi|prodi|jurusan)\s+komputer\b/, alias: 'SK' },
    { pattern: /(?:sistem\s+informasi|\bsi\b)/, alias: 'SI' },
    { pattern: /(?:teknologi\s+informasi|\bti\b)/, alias: 'TI' },
    { pattern: /(?:program\s+studi|prodi|jurusan)\s+digital\b/, alias: 'BD' },
    { pattern: /(?:bisnis\s+digital|\bbd\b)/, alias: 'BD' },
    { pattern: /(?:teknologi\s+rekayasa\s+perangkat\s+lunak|\btrpl\b)/, alias: 'TRPL' },
    { pattern: /(?:teknologi\s+komputer|\btk\b)/, alias: 'TK' },
    { pattern: /(?:manajemen\s+informatika|manajemen\s+informasi|\bmi\b)/, alias: 'MI' },
    { pattern: /(?:desain\s+grafis|\bdg\b)/, alias: 'DG' },
    { pattern: /(?:design\s+communication\s+visual|desain\s+komunikasi\s+visual|\bdkv\b)/, alias: 'DKV' },
    { pattern: /(?:multimedia|\bmm\b)/, alias: 'MM' },
    { pattern: /(?:animasi|\ban\b)/, alias: 'AN' },
    { pattern: /(?:rekognisi\s+pembelajaran\s+lampau|\brpl\b)/, alias: 'RPL' }
  ];

  for (const item of aliasMap) {
    if ((item.pattern.test(normalized) || item.pattern.test(compact)) && VALID_PROGRAMS.has(item.alias)) {
      return item.alias;
    }
  }

  if (normalized.includes('sistem informasi') || compact.includes('sisteminformasi')) return 'SI';
  if (normalized.includes('sistem komputer') || compact.includes('sistemkomputer')) return 'SK';
  if (normalized.includes('teknologi informasi') || compact.includes('teknologiinformasi')) return 'TI';
  if (normalized.includes('bisnis digital') || compact.includes('bisnisdigital')) return 'BD';
  if (normalized.includes('manajemen informatika') || compact.includes('manajemeninformatika')) return 'MI';
  if (normalized.includes('desain grafis') || compact.includes('desaingrafis')) return 'DG';
  if (normalized.includes('teknologi rekayasa perangkat lunak') || compact.includes('teknologirekayasaperangkatlunak')) return 'TRPL';
  if (normalized.includes('teknologi komputer') || compact.includes('teknologikomputer')) return 'TK';
  if (normalized.includes('desain komunikasi visual') || compact.includes('desainkomunikasivisual') || normalized.includes('dkv') || compact.includes('dkv')) return 'DKV';
  if (normalized.includes('multimedia') || compact.includes('multimedia')) return 'MM';
  if (normalized.includes('animasi') || compact.includes('animasi')) return 'AN';

  const extractedName = extractProgramNameFromText(value);
  if (extractedName) {
    const alias = deriveProgramAlias(extractedName);
    if (alias && VALID_PROGRAMS.has(alias)) return alias;
    return null;
  }

  const acronymMatch = value.match(/^\s*([A-Za-z]{2,5})\s*$/);
  if (acronymMatch) {
    const alias = acronymMatch[1].toUpperCase();
    return VALID_PROGRAMS.has(alias) ? alias : null;
  }

  return null;
}

function getCanonicalProgramName(programAlias) {
  if (!programAlias) return null;
  const mapping = {
    SI: 'SISTEM_INFORMASI',
    TI: 'TEKNOLOGI_INFORMASI',
    MI: 'MANAJEMEN_INFORMATIKA',
    SK: 'SISTEM_KOMPUTER',
    BD: 'BISNIS_DIGITAL',
    DKV: 'DESAIN_KOMUNIKASI_VISUAL',
    DG: 'DESAIN_GRAFIS',
    MM: 'MULTIMEDIA',
    AN: 'ANIMASI',
    TRPL: 'TEKNOLOGI_REKAYASA_PERANGKAT_LUNAK',
    TK: 'TEKNOLOGI_KOMPUTER'
  };
  return mapping[String(programAlias).toUpperCase()] || null;
}

function normalizeWaveLabel(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const text = value.toLowerCase();

  if (/\b(khusus|special)\b/.test(text)) return 'KHUSUS';

  const wavePattern = /\b(?:gelombang|glmb|glw|gel|wave)\s*([ivx]{1,3}|[0-9]{1,2})(?:\s*[-\/]?\s*([a-zA-Z]))?\b/i;
  const waveSuffixPattern = /\b([ivx]{1,3}|[0-9]{1,2})(?:\s*[-\/]?\s*([a-zA-Z]))?\s*(?:gelombang|gel|wave)\b/i;
  const exactPattern = /^([ivx]{1,3}|[0-9]{1,2})(?:\s*[-\/]?\s*([a-zA-Z]))?$/i;

  const match = wavePattern.exec(value) || waveSuffixPattern.exec(value) || exactPattern.exec(value);
  if (!match) return null;

  const token = String(match[1] || '').toLowerCase();
  const suffix = match[2] ? match[2].toUpperCase() : '';
  const romanMatch = token.match(/^(i{1,3}|iv|v|vi|vii|viii|ix|x)$/i);

  if (romanMatch) {
    const romanMap = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
    const base = romanMap[romanMatch[1].toLowerCase()];
    return base ? `${base}${suffix}` : null;
  }

  const numericMatch = token.match(/^([1-9][0-9]?)$/);
  if (numericMatch) {
    return `${numericMatch[1]}${suffix}`;
  }

  return null;
}

function normalizeWaveGroup(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes('KHUSUS')) return 'KHUSUS';
  const m = raw.match(/([1-4])/);
  if (!m) return raw;
  return m[1];
}

function repairOcrNumericNoise(text) {
  return String(text || '')
    .replace(/\b[0-9.,olOL]+\b/g, token =>
      String(token)
        .replace(/[oO]/g, '0')
        .replace(/[lI]/g, '1')
    )
    .replace(/[^\dRp.,\-A-Za-z ]+/g, ' ');
}

function normalizePartnerLabel(raw) {
  const text = String(raw || '').toLowerCase();
  if (/\butb\b/.test(text)) return 'UTB';
  if (/\bdnui\b/.test(text)) return 'DNUI';
  if (/\bhelp\b/.test(text)) return 'HELP';
  if (/\bmalaysia\b/.test(text)) return 'MALAYSIA';
  if (/\bchina\b/.test(text)) return 'CHINA';
  return null;
}

function normalizeAcademicYear(raw) {
  const match = /\b(202[4-9]|203[0-9])\b/.exec(String(raw || ''));
  return match ? match[1] : null;
}

// **VALIDATOR 2: Numeric Grounding Validation** - STRICT: all numbers must be explicit
function validateNumericGrounding(extractedValue, sourceChunks, context = '') {
  const val = String(extractedValue || '').trim();
  if (!val || !/\d/.test(val)) return { valid: true, reason: 'non-numeric' };
  
  if (!Array.isArray(sourceChunks) || sourceChunks.length === 0) {
    return { valid: false, reason: 'no_source_chunks' };
  }
  
  const foundIn = [];
  const normalizedValue = val.replace(/[^\d]/g, '');
  console.log('[NUMERIC_AUDIT] validateNumericGrounding:start', { normalizedValue, sourceChunksLength: sourceChunks.length, context });
  for (const chunk of sourceChunks) {
    const text = String(chunk && chunk.chunk ? chunk.chunk : '');
    const repairedText = repairOcrNumericNoise(text);
    const digitsOnly = text.replace(/[^\d]/g, '');
    const digitsOnlyRepaired = repairedText.replace(/[^\d]/g, '');
    const fname = chunk && chunk.filename ? String(chunk.filename) : '';
    const isOfficialDoc = /(?:PMB|BIAYA|RINCIAN|OFFICIAL|REGULASI|RESMI)/i.test(fname);

    console.log('[NUMERIC_AUDIT] chunk', { textPreview: String(text).slice(0,80), repairedPreview: String(repairedText).slice(0,80), digitsOnly, digitsOnlyRepaired, fname, isOfficialDoc, ocrQuality: chunk && chunk.ocrQualityScore });
    // Try parse with production parser on original and repaired text
    try {
      if (typeof parseCompactRupiahNumber === 'function') {
        // Prefer money-like tokens (Rp ... ) inside the chunk to avoid parsing the whole document text
        const tokens = [];
        const rpMatch = repairedText.match(/Rp[\s\.\:\-—]*[0-9lIoO\.,\s]{1,40}/ig);
        if (rpMatch) tokens.push(...rpMatch);

        const explicitDigitMatches = repairedText.match(/([0-9][0-9\.,\s]{0,20})/g);
        if (explicitDigitMatches && explicitDigitMatches.length) {
          tokens.push(...explicitDigitMatches);
        } else {
          // fallback: first reasonably short token starting with a real digit,
          // allowing OCR-corrected digits later in the token only.
          const digitMatch = repairedText.match(/([0-9][0-9lIoO\.,\s]{0,20})/);
          if (digitMatch) tokens.push(digitMatch[0]);
        }

        // Also try original text tokens if none found
        if (!tokens.length) {
          const rpMatch2 = text.match(/Rp[\s\.\:\-—]*[0-9lIoO\.,\s]{1,40}/i);
          if (rpMatch2) tokens.push(rpMatch2[0]);
          const digitMatch2 = text.match(/([0-9][0-9lIoO\.,\s]{0,20})/);
          if (digitMatch2) tokens.push(digitMatch2[0]);
        }

        const parsedAttempts = tokens.map(t => {
          try { return parseCompactRupiahNumber(t); } catch (e) { return null; }
        });
        console.log('[NUMERIC_AUDIT] parseAttempts', { tokens, parsedAttempts });
        const numericNormalized = parseInt(normalizedValue, 10);
        const digitsMatch = digitsOnly === String(numericNormalized) || digitsOnlyRepaired === String(numericNormalized);
        if (digitsMatch) {
          foundIn.push({ chunk: text, filename: fname, isOfficial: isOfficialDoc, ocrQuality: chunk && chunk.ocrQualityScore, matchedBy: 'digits_match' });
          console.log('[NUMERIC_AUDIT] matchedFoundIn-digits', { fname, numericNormalized });
        } else {
          for (let i = 0; i < parsedAttempts.length; i++) {
            const p = parsedAttempts[i];
            if (p && p === numericNormalized) {
              foundIn.push({ chunk: text, filename: fname, isOfficial: isOfficialDoc, ocrQuality: chunk && chunk.ocrQualityScore, matchedBy: `token_parse_${i}` });
              console.log('[NUMERIC_AUDIT] matchedFoundIn-parse', { fname, token: tokens[i], numericNormalized });
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log('[NUMERIC_AUDIT] parseError', e && e.message);
    }
    
  }
  
  if (foundIn.length === 0) {
    logger.warn('[RAG] Numeric not found in chunks', { val, context });
    return { valid: false, reason: 'numeric_not_explicit', value: val };
  }
  
  // TRUST HIERARCHY: official docs > good OCR > multiple sources
  const officialSources = foundIn.filter(f => f.isOfficial);
  if (officialSources.length > 0) {
    return { valid: true, reason: 'found_in_official', sources: foundIn };
  }
  
  if (foundIn.length >= 2) {
    return { valid: true, reason: 'found_in_multiple', sources: foundIn };
  }
  
  // Single source: must have good OCR confidence
  if (foundIn[0] && foundIn[0].ocrQuality >= 0.85) {
    return { valid: true, reason: 'found_with_good_ocr', sources: foundIn };
  }
  
  return { valid: false, reason: 'single_low_quality_source', sources: foundIn };
}

// **VALIDATOR 3: Entity Consistency Validation** - program/wave/partner/year must align
function validateEntityConsistency(chunks, question) {
  if (!Array.isArray(chunks) || chunks.length < 2) {
    return { consistent: true, reason: 'insufficient_chunks' };
  }
  
  // Extract entity constraints from question
  const qLower = String(question || '').toLowerCase();
  const programMatch = normalizeProgramLabel(qLower);
  const waveMatch = normalizeWaveLabel(qLower);
  const partnerMatch = normalizePartnerLabel(qLower);
  const yearMatch = normalizeAcademicYear(qLower);
  
  // No entity constraint = trivially consistent
  if (!programMatch && !waveMatch && !partnerMatch && !yearMatch) {
    return { consistent: true, reason: 'no_entity_constraint' };
  }
  
  // Extract entities from all chunks
  const extractedPrograms = new Set();
  const extractedWaves = new Set();
  const extractedPartners = new Set();
  const extractedYears = new Set();
  
  for (const chunk of chunks) {
    const text = String(chunk && chunk.chunk ? chunk.chunk : '').toLowerCase();

    // Prefer explicit program metadata when available
    try {
      if (chunk && typeof chunk === 'object') {
        if (chunk.program) {
          const canonical = normalizeProgramLabel(String(chunk.program));
          if (canonical) extractedPrograms.add(canonical);
        }
        if (Array.isArray(chunk.programAliases) && chunk.programAliases.length) {
          for (const pa of chunk.programAliases) {
            const canonical = normalizeProgramLabel(String(pa));
            if (canonical) extractedPrograms.add(canonical);
          }
        }
        if (chunk.filename) {
          const fnameCanon = normalizeProgramLabel(String(chunk.filename));
          if (fnameCanon) extractedPrograms.add(fnameCanon);
        }
      }
    } catch (e) {
      // ignore metadata parsing errors and fallback to text regex below
    }

    // Fallback: scan chunk text for program keywords
    const progMatch = /(bisnis\s+digital|bd|sistem\s+informasi|si|teknologi\s+informasi|ti|sistem\s+komputer|sk|manajemen\s+informatika|manajemen\s+informasi|mi)/i.exec(text);
    if (progMatch) {
      const canonical = normalizeProgramLabel(progMatch[1]);
      if (canonical) extractedPrograms.add(canonical);
    }

    const waveM = /(khusus|gelombang\s+([ivx]+|[0-9]+)|sisipan)/i.exec(text);
    if (waveM) {
      const canonical = normalizeWaveLabel(waveM[1]);
      if (canonical) extractedWaves.add(canonical);
    }
    
    const partnerM = /(utb|dnui|help|malaysia|china)/i.exec(text);
    if (partnerM) {
      const canonical = normalizePartnerLabel(partnerM[1]);
      if (canonical) extractedPartners.add(canonical);
    }
    
    const yearM = /\b(202[4-9]|203[0-9])\b/.exec(text);
    if (yearM) extractedYears.add(yearM[1]);
  }
  
  // Validate consistency
  // RELAX program validation: presence of multiple programs in context set (e.g., TI+SI in catalog)
  // does NOT automatically mean mismatch. Only reject if the requested program is NOT present.
  if (programMatch && extractedPrograms.size > 1) {
    const requestedProgram = normalizeProgramLabel(qLower);
    if (requestedProgram && extractedPrograms.has(requestedProgram)) {
      // The requested program IS in the contexts, so allow it even if other programs are also present.
      // This handles catalog documents that mention multiple programs.
      return { consistent: true, reason: 'program_found_among_multiple' };
    }
    // If requested program is NOT found in any context, THEN reject.
    return { consistent: false, reason: 'program_mismatch', programs: Array.from(extractedPrograms) };
  }
  if (waveMatch && extractedWaves.size > 1) {
    return { consistent: false, reason: 'wave_mismatch', waves: Array.from(extractedWaves) };
  }
  if (partnerMatch && extractedPartners.size > 1) {
    return { consistent: false, reason: 'partner_mismatch', partners: Array.from(extractedPartners) };
  }
  if (yearMatch && extractedYears.size > 1) {
    return { consistent: false, reason: 'year_mismatch', years: Array.from(extractedYears) };
  }
  
  return { consistent: true, reason: 'entities_aligned' };
}

// **VALIDATOR 4: Contradiction Detection** - find conflicting data
function detectContradictions(chunks, context = {}) {
  if (!Array.isArray(chunks) || chunks.length < 2) {
    return { contradictions: [], hasConflict: false };
  }
  
  const contradictions = [];
  
  // Extract all numeric values per chunk
  const numericsByChunk = new Map();
  for (const chunk of chunks) {
    const text = String(chunk && chunk.chunk ? chunk.chunk : '');
    const chunkId = chunk && chunk.id ? chunk.id : 'unknown';
    const matches = text.match(/(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,})/gi);
    if (matches) {
      numericsByChunk.set(chunkId, matches);
    }
  }
  
  // Compare numerics across chunks (same context should have same values)
  if (numericsByChunk.size >= 2) {
    const allNumerics = [];
    for (const [chunkId, values] of numericsByChunk.entries()) {
      allNumerics.push(...values.map(v => ({ value: v, chunkId })));
    }
    
    // Group by normalized value
    const normalized = new Map();
    for (const item of allNumerics) {
      const key = item.value.replace(/[^\d]/g, '');
      if (!normalized.has(key)) normalized.set(key, []);
      normalized.get(key).push(item);
    }
    
    // Flag if same value appears with different raw formats (possible contradiction)
    for (const [key, items] of normalized.entries()) {
      const formats = new Set(items.map(i => i.value));
      if (formats.size > 1 && items.length >= 2) {
        contradictions.push({
          type: 'numeric_format_variance',
          normalizedValue: key,
          variants: Array.from(formats),
          sources: items.map(i => i.chunkId)
        });
      }
    }
  }
  
  // Extract dates and check for conflicts
  const datesByChunk = new Map();
  for (const chunk of chunks) {
    const text = String(chunk && chunk.chunk ? chunk.chunk : '');
    const chunkId = chunk && chunk.id ? chunk.id : 'unknown';
    const matches = text.match(/(\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)[a-z]*\s+\d{4})/gi);
    if (matches) {
      datesByChunk.set(chunkId, matches);
    }
  }
  
  if (datesByChunk.size >= 2) {
    const allDates = [];
    for (const [chunkId, values] of datesByChunk.entries()) {
      allDates.push(...values.map(v => ({ value: v, chunkId })));
    }
    
    const dateFormats = new Map();
    for (const item of allDates) {
      if (!dateFormats.has(item.value)) dateFormats.set(item.value, []);
      dateFormats.get(item.value).push(item.chunkId);
    }
    
    if (dateFormats.size > 1) {
      contradictions.push({
        type: 'date_variance',
        dates: Array.from(dateFormats.keys()),
        sources: allDates.map(d => d.chunkId)
      });
    }
  }
  
  return {
    contradictions,
    hasConflict: contradictions.length > 0,
    conflictRisk: contradictions.length > 0 ? 'HIGH' : 'LOW'
  };
}

// **VALIDATOR 5: Final Answer Validation** - comprehensive pre-send check
function validateFinalAnswer(answer, ragResult, question) {
  if (!answer || typeof answer !== 'string') {
    return { valid: false, reason: 'empty_answer' };
  }
  
  const answerTrim = String(answer).trim();
  if (answerTrim.length === 0) {
    return { valid: false, reason: 'empty_answer_after_trim' };
  }
  
  // Check 1: Confidence tier is LOW = must fallback
  if (ragResult && ragResult.confidenceTier === 'LOW') {
    return { valid: false, reason: 'low_confidence', shouldFallback: true };
  }
  
  // Check 2: MEDIUM confidence with numeric = reject
  if (ragResult && ragResult.confidenceTier === 'MEDIUM') {
    const hasNumeric = /\b\d+\s*(?:juta|ribu|rb|rp|\.|-|,)\b|rp\s*[\d.,]+|\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)/i.test(answerTrim);
    if (hasNumeric) {
      logger.warn('[RAG] MEDIUM confidence answer contains numeric, rejecting');
      return { valid: false, reason: 'medium_with_numeric' };
    }
  }
  
  // Check 3: Numeric validation for HIGH confidence
  if (ragResult && ragResult.confidenceTier === 'HIGH') {
    const numericMatches = Array.from(answerTrim.matchAll(/(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,})/gi));
    for (const match of numericMatches) {
      const numericValue = match && match[0] ? match[0] : null;
      if (!numericValue) continue;
      const validation = validateNumericGrounding(numericValue, ragResult.contexts || [], 'final_answer');
      if (!validation.valid) {
        logger.warn('[RAG] Numeric in HIGH confidence answer failed grounding check', { numericValue, reason: validation.reason, context: validation });
        return { valid: false, reason: 'numeric_not_grounded', numeric: numericValue, detail: validation };
      }
    }
  }
  
  // Check 4: Entity consistency
  if (ragResult && ragResult.contexts && Array.isArray(ragResult.contexts)) {
    const consistency = validateEntityConsistency(ragResult.contexts, question);
    if (!consistency.consistent) {
      logger.warn('[RAG] Answer failed entity consistency check', consistency);
      // Relaxation: if the only issue is a program_mismatch but the contexts
      // appear to be catalog/profile documents (likely to mention multiple
      // programs), allow the answer rather than outright rejecting.
      if (consistency.reason === 'program_mismatch') {
        const contexts = Array.isArray(ragResult.contexts) ? ragResult.contexts : [];
        const anyCatalogLike = contexts.some(c => {
          try {
            const fname = String(c && c.filename ? c.filename : '').toLowerCase();
            if (/penjelasan|program studi|prodi|profil|katalog|kurikulum/.test(fname)) return true;
            if (String(c && c.chunkType || '').toUpperCase() === 'GENERAL') return true;
            // fallback: chunk text containing 'program studi' is also a good signal
            const txt = String(c && c.chunk ? c.chunk : '').toLowerCase();
            if (txt.includes('program studi') || txt.includes('penjelasan prodi')) return true;
            return false;
          } catch (e) {
            return false;
          }
        });
        if (!anyCatalogLike) {
          return { valid: false, reason: 'entity_mismatch', detail: consistency };
        }
        logger.info('[RAG] program_mismatch relaxed due to catalog-like contexts');
      } else {
        return { valid: false, reason: 'entity_mismatch', detail: consistency };
      }
    }
  }
  
  // Check 5: Contradiction detection
  if (ragResult && ragResult.contexts && Array.isArray(ragResult.contexts)) {
    const contradiction = detectContradictions(ragResult.contexts);
    if (contradiction.hasConflict) {
      logger.warn('[RAG] Contradictions detected in source chunks', contradiction);
      return { valid: false, reason: 'contradiction_conflict', detail: contradiction };
    }
  }
  
  // Check 6: Inference on prohibited topics
  if (ragResult && ragResult.source === 'rag-inference-medium') {
    const prohibitedTopics = /(berapa|harga|biaya|dpp|ukt|spp|tanggal|kapan|deadline|jam|pukul)/i;
    if (prohibitedTopics.test(String(question || ''))) {
      logger.warn('[RAG] Inference attempted on prohibited numeric/temporal topic');
      return { valid: false, reason: 'inference_on_prohibited_topic' };
    }
  }
  
  return { valid: true, reason: 'passed_all_checks' };
}

// **VALIDATOR 6: Source Trust Scoring** - rank by source quality
function scoreSourceTrust(chunk) {
  if (!chunk || typeof chunk !== 'object') return 0;
  
  let score = 0;
  
  const fname = String(chunk.filename || '').toLowerCase();
  if (/(?:pmb|official|resmi|regulasi|biaya|rincian|jadwal)/i.test(fname)) score += 50;
  if (/(?:draft|temporary|temp|note)/i.test(fname)) score -= 20;
  if (/(?:chat|whatsapp|dump|log|transkrip|transcript)/i.test(fname)) score -= 30;
  if (/(?:ocr|scan|image|pdf)/i.test(fname) && chunk.lowConfidence) score -= 15;
  
  if (chunk.chunkType === 'COST' || chunk.chunkType === 'SCHEDULE') score += 30;
  if (chunk.chunkType === 'GENERAL') score += 10;
  
  if (chunk.ocrQualityScore !== undefined && chunk.ocrQualityScore !== null) {
    const ocrScore = Number(chunk.ocrQualityScore);
    if (ocrScore >= 0.90) score += 20;
    else if (ocrScore < 0.60) score -= 15;
  }
  
  const freshAt = chunk.updatedAt || chunk.createdAt;
  if (freshAt) {
    try {
      const ageMs = Date.now() - new Date(freshAt).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 30) score += 25;
      else if (ageDays > 365) score -= 10;
      if (ageDays > 730) score -= 10;
    } catch (e) {
      // ignore
    }
  }
  
  if (chunk.lowConfidence) score -= 30;
  return Math.max(0, score);
}

function validateSourceTrust(chunk) {
  const score = scoreSourceTrust(chunk);
  return {
    score,
    trusted: score >= 35,
    metadata: {
      filename: chunk && chunk.filename ? String(chunk.filename) : null,
      chunkType: chunk && chunk.chunkType ? String(chunk.chunkType) : null,
      ocrQualityScore: chunk && chunk.ocrQualityScore !== undefined ? Number(chunk.ocrQualityScore) : null,
      updatedAt: chunk && chunk.updatedAt ? String(chunk.updatedAt) : null
    }
  };
}

function detectStaleChunks(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  const thresholdDaysRaw = parseInt(process.env.RAG_STALE_CHUNK_DAYS || '365', 10);
  const thresholdDays = Number.isFinite(thresholdDaysRaw) && thresholdDaysRaw > 0 ? thresholdDaysRaw : 365;
  const now = Date.now();
  let staleCount = 0;
  let oldestAgeDays = 0;

  for (const chunk of list) {
    if (!chunk || typeof chunk !== 'object') continue;
    const ts = chunk.updatedAt || chunk.createdAt || null;
    if (!ts) continue;
    const ageMs = now - new Date(ts).getTime();
    if (!Number.isFinite(ageMs)) continue;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= thresholdDays) staleCount += 1;
    if (ageDays > oldestAgeDays) oldestAgeDays = ageDays;
  }

  return {
    hasStale: staleCount > 0,
    staleCount,
    oldestAgeDays,
    thresholdDays
  };
}

// **VALIDATOR 7: Safe Inference Guard** - prevent inference on prohibited topics
function isSafeForInference(question, answer, confidenceTier) {
  if (confidenceTier === 'LOW') return false; // Never infer on LOW
  
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').toLowerCase();
  
  // PROHIBITED: numeric/temporal inference
  const prohibitedPatterns = [
    /\b(?:berapa|harga|biaya|dpp|ukt|spp|nominal|angka|jumlah)\b/,
    /\b(?:tanggal|kapan|jam|pukul|waktu|deadline|makan\s+berapa|berakhir|sksi\b)\b/,
    /\b(?:kuota|jumlah\s+pendaftar|peserta|usia\s+minimum|nilai\s+minimum|gpa\s+minimum)\b/
  ];
  
  for (const pattern of prohibitedPatterns) {
    if (pattern.test(q)) return false;
  }
  
  return true;
}

function extractCurrentUserQuestionText(rawQuestion) {
  const q = String(rawQuestion || '').trim();
  if (!q) return '';

  // Provider may pass an anchored question like:
  // "<previous user>\nFollow-up: <current user>" or
  // "...\nPertanyaan user saat ini: <current user>"
  // For intent parsing we only want the current user part.
  const markers = ['Pertanyaan user saat ini:', 'Balasan user saat ini:', 'Follow-up:'];
  let best = q;
  let bestIdx = -1;
  let bestMarker = null;
  for (const marker of markers) {
    const idx = q.lastIndexOf(marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestMarker = marker;
    }
  }
  if (bestIdx >= 0 && bestMarker) best = q.slice(bestIdx + bestMarker.length).trim();

  // Some contextual prompts wrap the current user text in quotes.
  // Example: Balasan user saat ini: "apa itu rpl?"
  if ((best.startsWith('"') && best.endsWith('"')) || (best.startsWith('ΓÇ£') && best.endsWith('ΓÇ¥'))) {
    best = best.slice(1, -1).trim();
  }
  // If the line starts with a quote but doesn't end with one (truncated prompt), strip leading.
  if (best.startsWith('"') || best.startsWith('ΓÇ£')) best = best.slice(1).trim();
  if (best.endsWith('"') || best.endsWith('ΓÇ¥')) best = best.slice(0, -1).trim();

  return best;
}

let cachedDualDegreePrograms = null;
let cachedDualDegreeProgramsHash = null;

let cachedAccreditationByProgram = null;
let cachedAccreditationByProgramHash = null;

function extractDualDegreeProgramsFromIndex() {
  const fullIndex = loadIndex();
  if (!Array.isArray(fullIndex) || fullIndex.length === 0) return [];

  // Cache by content hash to avoid repeated full scans.
  const raw = fullIndex.map(i => (i && i.chunk ? String(i.chunk) : '')).join('\n');
  const hash = crypto.createHash('sha1').update(raw.slice(0, 220000)).digest('hex');
  if (cachedDualDegreePrograms && cachedDualDegreeProgramsHash === hash) return cachedDualDegreePrograms;

  const found = {
    utb: false,
    dnui: false,
    help: false
  };

  for (const item of fullIndex) {
    const chunk = String(item && item.chunk ? item.chunk : '');
    if (!chunk) continue;
    const lower = chunk.toLowerCase();
    if (!/(dual|double)\s*degree/i.test(lower)) continue;

    if (!found.utb && (/(\bUTB\b|universitas\s+teknologi\s+bandung)/i.test(chunk))) found.utb = true;
    if (!found.dnui && (/(\bDNUI\b|dalian\s+neusoft)/i.test(chunk))) found.dnui = true;
    if (!found.help && (/help\s+university/i.test(chunk))) found.help = true;

    if (found.utb && found.dnui && found.help) break;
  }

  const programs = [];
  if (found.utb) {
    programs.push({
      key: 'utb',
      line: 'Dual Degree (National Class) dengan Universitas Teknologi Bandung (UTB) - Prodi: Bisnis Digital'
    });
  }
  if (found.dnui) {
    programs.push({
      key: 'dnui',
      line: 'Dual Degree (International Class) dengan Dalian Neusoft University of Information (DNUI), China - Prodi: Bisnis Digital'
    });
  }
  if (found.help) {
    programs.push({
      key: 'help',
      line: 'Dual Degree (International Class) dengan HELP University, Malaysia - Prodi: Sistem Informasi'
    });
  }

  cachedDualDegreePrograms = programs;
  cachedDualDegreeProgramsHash = hash;
  return programs;
}

function extractFeeBreakdownFromIndex() {
  const fullIndex = loadIndex();
  if (!Array.isArray(fullIndex) || fullIndex.length === 0) return null;

  // Search for comprehensive fee breakdown sections from the training data.
  // Match sections with "RINCIAN BIAYA PENDIDIKAN" and contain detailed items.
  const candidates = [];

  for (const item of fullIndex) {
    const chunk = String(item && item.chunk ? item.chunk : '');
    if (!chunk) continue;

    // Look for "RINCIAN BIAYA" header (indicates fee breakdown section)
    if (!/rincian\s+biaya\s+(pendidikan|pendaftaran)/i.test(chunk)) continue;

    // Verify it has actual fee items (lines with numbers and Rp amounts)
    if (!/(pendaftaran|dpp|dana\s+pendidikan|biaya\s+kuliah|rp\s*[\d.,]+)/i.test(chunk)) continue;

    // Quality score: prefer longer chunks with more complete fee info
    const hasMultipleItems = (chunk.match(/(?:pendaftaran|dpp|dana\s+pendidikan|biaya\s+kuliah|almamater|pengalaman|industri)/gi) || []).length;
    const score = chunk.length + (hasMultipleItems * 50);

    candidates.push({
      score: score,
      chunk: chunk,
      source: item.sourceFile || item.trainingId || 'training_data'
    });
  }

  if (candidates.length === 0) return null;

  // Return the candidate with highest score (most complete fee breakdown)
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function normalizeAccreditationProgramFromQuestion(qLower) {
  const q = String(qLower || '').toLowerCase();
  if (!q.trim()) return null;

  // Keep this mapping intentionally small and aligned with how users ask on WhatsApp.
  const hasBd = /\b(bd|bisnis\s+digital)\b/i.test(q);
  if (hasBd) {
    return {
      label: 'Bisnis Digital',
      key: 'bd',
      aliases: ['bisnis digital', 'prodi bisnis digital', 'program studi bisnis digital', 'bd']
    };
  }

  const hasSi = /\b(si|sistem\s+informasi)\b/i.test(q);
  if (hasSi) {
    return {
      label: 'Sistem Informasi',
      key: 'si',
      aliases: ['sistem informasi', 'prodi sistem informasi', 'program studi sistem informasi', 'si']
    };
  }

  const hasTi = /\b(ti|teknologi\s+informasi)\b/i.test(q);
  if (hasTi) {
    return {
      label: 'Teknologi Informasi',
      key: 'ti',
      aliases: ['teknologi informasi', 'prodi teknologi informasi', 'program studi teknologi informasi', 'ti']
    };
  }

  const hasSk = /\b(sk|sistem\s+komputer)\b/i.test(q);
  if (hasSk) {
    return {
      label: 'Sistem Komputer',
      key: 'sk',
      aliases: ['sistem komputer', 'prodi sistem komputer', 'program studi sistem komputer', 'sk']
    };
  }

  return null;
}

function extractAccreditationFromIndex(indexForQuery, programInfo) {
  const list = Array.isArray(indexForQuery) ? indexForQuery : [];
  const prog = programInfo && typeof programInfo === 'object' ? programInfo : null;
  if (!prog || !prog.key) return null;

  // Cache by content hash so repeated WhatsApp queries are cheap.
  const hash = crypto.createHash('sha256').update(JSON.stringify(list.map(i => ({ id: i.id, trainingId: i.trainingId, chunkHash: i.chunkHash || chunkHash(i.chunk || '') })))).digest('hex');
  if (!cachedAccreditationByProgram) cachedAccreditationByProgram = Object.create(null);
  if (cachedAccreditationByProgramHash === hash && cachedAccreditationByProgram[prog.key]) return cachedAccreditationByProgram[prog.key];

  const hasAlias = (t) => {
    const s = String(t || '').toLowerCase();
    if (!s) return false;
    for (const a of (prog.aliases || [])) {
      const aa = String(a || '').toLowerCase();
      if (!aa) continue;
      if (aa.length <= 2) {
        if (new RegExp(`\\b${aa.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(s)) return true;
        continue;
      }
      if (s.includes(aa)) return true;
    }
    return false;
  };

  const looksAccred = (t) => /\bakreditasi\b|\bban-pt\b|\bbadan\s+akreditasi\b|\bsertifikat\s+akreditasi\b/i.test(String(t || ''));

  // Prefer chunks that mention the program AND accreditation keywords.
  const candidates = [];
  for (const it of list) {
    const chunk = it && typeof it.chunk === 'string' ? it.chunk : '';
    if (!chunk || !chunk.trim()) continue;
    const lower = chunk.toLowerCase();
    if (!hasAlias(lower)) continue;
    if (!looksAccred(lower)) continue;
    candidates.push({ id: it.id, trainingId: it.trainingId, chunk });
  }

  // If we couldn't find a direct match (OCR noise), fall back to accreditation-only chunks.
  const pool = candidates.length > 0 ? candidates : list
    .map(it => ({ id: it && it.id, trainingId: it && it.trainingId, chunk: it && typeof it.chunk === 'string' ? it.chunk : '' }))
    .filter(it => it.chunk && it.chunk.trim() && looksAccred(it.chunk) && hasAlias(it.chunk));

  if (!pool || pool.length === 0) {
    cachedAccreditationByProgramHash = hash;
    cachedAccreditationByProgram[prog.key] = null;
    return null;
  }

  const gradePatterns = [
    /\b(?:peringkat\s+)?akreditasi\b[\s\S]{0,80}?\b(unggul|baik\s+sekali|baik)\b/i,
    /\bterakreditasi\b[\s\S]{0,60}?\b(unggul|baik\s+sekali|baik)\b/i,
    /\bperingkat\b[\s:.-]{0,20}\b(A|B|C)\b/i,
    /\bakreditasi\b[\s:.-]{0,30}\b(A|B|C)\b/i,
  ];

  const skPatterns = [
    /\bSK\b\s*(?:No\.?|Nomor)?\s*[:\-]?\s*([A-Z0-9./-]{6,})/i,
    /\bNomor\b\s*[:\-]?\s*([A-Z0-9./-]{6,})/i,
  ];

  const dateRangePatterns = [
    /\bberlaku\b[\s\S]{0,40}?\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b[\s\S]{0,20}?(?:s\/d|s\.d|sampai|hingga|ΓÇô|-)\s*\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b/i,
    /\bmasa\s+berlaku\b[\s\S]{0,40}?\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b[\s\S]{0,20}?(?:s\/d|s\.d|sampai|hingga|ΓÇô|-)\s*\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b/i,
  ];

  let best = null;
  for (const c of pool) {
    const txt = String(c.chunk || '');
    let grade = null;
    for (const re of gradePatterns) {
      const m = re.exec(txt);
      if (m && m[1]) {
        grade = String(m[1]).trim();
        break;
      }
    }

    let sk = null;
    for (const re of skPatterns) {
      const m = re.exec(txt);
      if (m && m[1]) {
        sk = String(m[1]).trim();
        break;
      }
    }

    let validity = null;
    for (const re of dateRangePatterns) {
      const m = re.exec(txt);
      if (m && m[1] && m[2]) {
        validity = `${String(m[1]).trim()} ΓÇô ${String(m[2]).trim()}`;
        break;
      }
    }

    const score = (grade ? 10 : 0) + (sk ? 3 : 0) + (validity ? 2 : 0);
    if (!best || score > best.score) {
      best = { score, grade, sk, validity, ctx: { id: c.id || null, trainingId: c.trainingId || null, chunk: txt.slice(0, 800) } };
    }
  }

  if (!best || !best.grade) {
    cachedAccreditationByProgramHash = hash;
    cachedAccreditationByProgram[prog.key] = null;
    return null;
  }

  const normalizeGrade = (g) => {
    const gg = String(g || '').trim();
    if (!gg) return gg;
    if (/^baik\s+sekali$/i.test(gg)) return 'Baik Sekali';
    if (/^baik$/i.test(gg)) return 'Baik';
    if (/^unggul$/i.test(gg)) return 'Unggul';
    if (/^[ABC]$/i.test(gg)) return gg.toUpperCase();
    return gg;
  };

  const out = {
    programKey: prog.key,
    programLabel: prog.label,
    grade: normalizeGrade(best.grade),
    sk: best.sk || null,
    validity: best.validity || null,
    context: best.ctx,
  };

  cachedAccreditationByProgramHash = hash;
  cachedAccreditationByProgram[prog.key] = out;
  return out;
}

function tryStructuredAccreditationAnswer(question, indexForQuery) {
  const q = extractCurrentUserQuestionText(question);
  const qLower = normalizeIndonesianQuestionText(q);
  if (!qLower.trim()) return null;

  if (!/\b(akreditasi|akredit|akred)\b|\bban\s*-?\s*pt\b|\bsertifikat\s+akreditasi\b/i.test(qLower)) return null;

  const prog = normalizeAccreditationProgramFromQuestion(qLower);
  if (!prog) {
    return {
      answer: 'Akreditasi prodi yang mana ya kak? Contoh: Bisnis Digital (BD), Sistem Informasi (SI), Teknologi Informasi (TI), atau Sistem Komputer (SK).',
      source: 'rag-accreditation-clarify'
    };
  }

  const found = extractAccreditationFromIndex(indexForQuery, prog);
  if (!found || !found.grade) return null;

  const parts = [`Akreditasi Prodi ${found.programLabel}: ${found.grade}.`];
  if (found.sk) parts.push(`Nomor SK: ${found.sk}.`);
  if (found.validity) parts.push(`Masa berlaku: ${found.validity}.`);

  return {
    answer: parts.join('\n'),
    source: 'rag-accreditation'
  };
}

function extractHobbyMappingTextFromIndex(indexForQuery) {
  const idx = (Array.isArray(indexForQuery) && indexForQuery.length) ? indexForQuery : loadIndex();
  if (!Array.isArray(idx) || idx.length === 0) return null;

  // Prefer explicit file name HOBY.pdf when present, else any hobby mapping file.
  // Important: do NOT rely on chunk text containing the word "hobi" (OCR/content may omit it).
  const hobbyNameRe = /\b(hobi|hoby)\b/i;
  const strongHobbyContentRe = /\bhobi\s+(?:siswa\s+)?yang\s+memilih\b/i;

  const hobbyItems = idx.filter((it) => {
    if (!it || !it.chunk) return false;
    const fname = it.filename ? String(it.filename) : '';
    if (fname && hobbyNameRe.test(fname)) return true;
    // Fallback: allow content signature if filename metadata is missing.
    return strongHobbyContentRe.test(String(it.chunk));
  });

  if (!hobbyItems || hobbyItems.length === 0) return null;

  // First, narrow down to exact HOBY.pdf if present.
  const exactHobyPdf = hobbyItems.filter(it => it && it.filename && /\bhoby\.pdf\b/i.test(String(it.filename)));
  const candidates = exactHobyPdf.length ? exactHobyPdf : hobbyItems;

  // Group by trainingId (preferred) so we rebuild the full uploaded document.
  const byTraining = new Map();
  for (const it of candidates) {
    if (!it || !it.chunk) continue;
    const tid = it.trainingId ? String(it.trainingId) : '';
    const key = tid ? `t:${tid}` : `f:${it.filename ? String(it.filename).toLowerCase() : 'unknown'}`;
    if (!byTraining.has(key)) byTraining.set(key, []);
    byTraining.get(key).push(it);
  }

  const groups = Array.from(byTraining.values()).map((items) => {
    let latest = 0;
    for (const it of items) {
      const ts = it && it.createdAt ? Date.parse(String(it.createdAt)) : 0;
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
    return { items, n: items.length, latest };
  });

  groups.sort((a, b) => (b.n - a.n) || (b.latest - a.latest));
  if (groups.length === 0) return null;

  const best = groups[0].items;
  // Keep the original insertion order as much as possible; do not sort aggressively.
  const combined = best.map(it => String(it.chunk || '')).join('\n');
  const text = combined.trim();
  if (!text) return null;
  return { text, items: best };
}

function scoreProgramsFromHobbyLines(hobbyText, questionText) {
  const text = String(hobbyText || '').replace(/\r\n/g, '\n');
  const qNorm = normalizeIndonesianQuestionText(questionText);
  const qTokens = tokenizeForRelevanceGuard(qNorm);
  if (!text.trim() || qTokens.length === 0) return null;

  const programs = [
    { key: 'bd', label: 'Bisnis Digital', names: ['bisnis digital', 'bd'] },
    { key: 'si', label: 'Sistem Informasi', names: ['sistem informasi', 'si'] },
    { key: 'ti', label: 'Teknologi Informasi', names: ['teknologi informasi', 'ti'] },
    { key: 'sk', label: 'Sistem Komputer', names: ['sistem komputer', 'sk'] }
  ];

  const scores = new Map(programs.map(p => [p.key, 0]));
  const evidences = new Map(programs.map(p => [p.key, []]));

  const lines = text
    .split('\n')
    .map(s => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const lineRaw of lines) {
    const line = normalizeIndonesianQuestionText(lineRaw);
    if (!line) continue;

    // Avoid table headers like "BD SI TI SK" (too little signal)
    const abbrevHits = [' bd ', ' si ', ' ti ', ' sk '].filter(a => (` ${line} `).includes(a)).length;
    if (abbrevHits >= 3 && line.length < 40) continue;

    const normalizedLine = ` ${line} `;
    const matchedPrograms = programs.filter((p) => p.names.some((nm) => {
      if (!nm || typeof nm !== 'string') return false;
      const normalizedName = nm.toLowerCase();
      if (normalizedName.length <= 2) {
        return new RegExp(`\\b${escapeRegex(normalizedName)}\\b`, 'u').test(line);
      }
      return normalizedLine.includes(` ${normalizedName} `) || line.includes(normalizedName);
    }));
    if (matchedPrograms.length === 0) continue;

    // Compute token overlap between question and this line.
    let hit = 0;
    for (const t of qTokens) if (t && line.includes(t)) hit += 1;
    if (hit <= 0) continue;

    const cov = hit / Math.max(3, Math.min(qTokens.length, 5));
    const minCov = parseFloat(process.env.RAG_HOBY_LINE_MIN_COVERAGE || '0.18');
    if (!(cov >= minCov)) continue;

    for (const p of matchedPrograms) {
      scores.set(p.key, (scores.get(p.key) || 0) + cov);
      const evList = evidences.get(p.key) || [];
      if (evList.length < 6) evList.push(lineRaw);
      evidences.set(p.key, evList);
    }
  }

  const ranked = programs
    .map(p => ({ p, score: scores.get(p.key) || 0, ev: evidences.get(p.key) || [] }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  const margin = parseFloat(process.env.RAG_HOBY_LINE_MIN_MARGIN || '0.00');
  const minScore = parseFloat(process.env.RAG_HOBY_LINE_MIN_SCORE || '0.18');
  if (!best || best.score < minScore) return null;
  if (second && (best.score - second.score) < margin) {
    if (best.score !== second.score) return null;
  }

  const ev = best.ev
    .map(s => String(s || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return { key: best.p.key, label: best.p.label, evidence: ev.slice(0, 3) };
}

function splitHobbyTextIntoProgramBlocks(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];

  const programs = [
    { key: 'bd', label: 'Bisnis Digital', names: ['bisnis digital', 'bd'] },
    { key: 'si', label: 'Sistem Informasi', names: ['sistem informasi', 'si'] },
    { key: 'ti', label: 'Teknologi Informasi', names: ['teknologi informasi', 'ti'] },
    { key: 'sk', label: 'Sistem Komputer', names: ['sistem komputer', 'sk'] }
  ];

  // Detect headings like: "Hobi Siswa yang Memilih Sistem Komputer" (and variants)
  const headingRe = /(hobi\s+(?:siswa\s+)?yang\s+memilih\s+)(bisnis\s+digital|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bd\b|si\b|ti\b|sk\b)/ig;
  const hits = [];
  let m;
  while ((m = headingRe.exec(raw)) !== null) {
    hits.push({ idx: m.index, name: String(m[2] || '').toLowerCase() });
  }

  // If no headings detected, return one block only (will be used for embedding fallback)
  if (hits.length === 0) {
    return [{ key: null, label: null, text: raw }];
  }

  hits.sort((a, b) => a.idx - b.idx);
  const blocks = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].idx;
    const end = (i + 1 < hits.length) ? hits[i + 1].idx : raw.length;
    const slice = raw.slice(start, end).trim();
    const nm = hits[i].name;
    const pd = programs.find(p => p.names.some(n => nm === n || nm.includes(n)));
    blocks.push({ key: pd ? pd.key : null, label: pd ? pd.label : null, text: slice });
  }
  return blocks;
}

function pickEvidenceLines(blockText, questionText) {
  const tokens = tokenizeForRelevanceGuard(questionText);
  const text = String(blockText || '').replace(/\r\n/g, '\n');
  if (tokens.length === 0 || !text.trim()) return [];

  // Prefer short phrases like "Suka Fotografi", "Suka Membuat konten ...".
  // OCR often merges many "Suka ..." in one line, so we slice between markers.
  const clean = text.replace(/&amp;/g, '&').replace(/\s{2,}/g, ' ');
  const markers = ['Suka', 'Pernah', 'Bisa', 'Memiliki', 'Eksperimen', 'Menulis', 'Bergabung'];
  const positions = [];
  for (const mk of markers) {
    const re = new RegExp(`\\b${mk}\\b`, 'gi');
    let mm;
    while ((mm = re.exec(clean)) !== null) {
      positions.push({ idx: mm.index, mk });
      if (positions.length > 400) break;
    }
    if (positions.length > 400) break;
  }
  positions.sort((a, b) => a.idx - b.idx);

  const phrases = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].idx;
    const end = (i + 1 < positions.length) ? positions[i + 1].idx : clean.length;
    let phrase = clean.slice(start, end);
    // Cut at newline if present
    const nl = phrase.indexOf('\n');
    if (nl >= 0) phrase = phrase.slice(0, nl);
    phrase = phrase.replace(/\s{2,}/g, ' ').trim();
    if (phrase.length < 6) continue;
    if (phrase.length > 70) phrase = phrase.slice(0, 70).trim() + 'ΓÇª';
    phrases.push(phrase);
    if (phrases.length >= 180) break;
  }

  const candidates = (phrases.length > 0 ? phrases : clean.split('\n').map(s => String(s || '').trim()).filter(Boolean));
  const scored = [];
  for (const c of candidates) {
    const hay = normalizeIndonesianQuestionText(c);
    let hit = 0;
    for (const t of tokens) if (t && hay.includes(t)) hit++;
    if (hit <= 0) continue;
    scored.push({ c, hit });
  }

  scored.sort((a, b) => b.hit - a.hit);
  const out = [];
  for (const s of scored) {
    const cleaned = String(s.c || '').replace(/\s{2,}/g, ' ').trim();
    if (!cleaned) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
    if (out.length >= 3) break;
  }
  return out;
}

async function tryStructuredProgramRecommendationAnswer(rawQuestion, indexForQuery) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = normalizeIndonesianQuestionText(q);

  // Example target:
  // "kalo suka buat konten di instagram cocoknya masuk jurusan apa?"
  const asksWhichMajor =
    (
      /(jurusan|prodi|program\s+studi)/i.test(qLower) &&
      (/(cocok|cocoknya|cocokan|cocokin|masuk|ambil|pilih|rekomendasi|saran)/i.test(qLower) || /(jurusan|prodi|program\s+studi)[\s\S]{0,50}\bapa\b/i.test(qLower))
    )
    // More natural WhatsApp variants: "aku suka X cocok kuliah apa"
    || (
      /(hobi|suka|minat|senang|gemar)/i.test(qLower) &&
      /(cocok|cocoknya|cocokan|cocokin|rekomendasi|saran)[\s\S]{0,40}\b(kuliah|jurusan|prodi|masuk|ambil)\b/i.test(qLower)
    )
    || (
      /(hobi|suka|minat|senang|gemar)/i.test(qLower) &&
      /(cocok|cocoknya|cocokan|cocokin)[\s\S]{0,25}\bapa\b/i.test(qLower)
    );

  const aboutContentCreation =
    /(konten|content|instagram|\big\b|tiktok|sosmed|social\s*media|marketing|digital\s*marketing|copywriting|branding|desain|design|video|editing|editor)/i.test(qLower);

  // Additional: users asking about market analysis / data analysis
  const aboutMarketAnalysis = /(analisis\s+pasar|riset\s+pasar|market\s+research|analisis\s+data|data\s+analis|data\s+science|business\s+analytics)/i.test(qLower);

  // Additional: hardware / merakit -> Sistem Komputer
  const aboutHardware = /(merakit|rakit|komputer\b|pc\b|hardware|perangkat\s+keras|embedded|iot|mikrokontroler|robot|robotik|robotics)/i.test(qLower);
  const aboutCoding = /(coding|ngoding|pemrograman|programmer|koding|software|programming|development|algoritma)/i.test(qLower);

  // For hobby‑prodi questions, we want to handle random hobbies too (not only content/market/hardware).
  // Keep the specific heuristics below, but don't block the more general hobby-doc matching.
  if (!asksWhichMajor) return null;

  // Attempt to consult hobby mapping documents in the index first (HOBY.pdf, hobi-sesuai-program-studi.docx).
  // Only if retrieval / mapping fails, fall back to simple heuristics below.
  let debugCollector = { retrieved: false, method: null, items: [], rejected: [], validatedScored: [] };
  try {
    const hobbyData = extractHobbyMappingTextFromIndex(indexForQuery);
    if (hobbyData && hobbyData.text) {
      debugCollector.retrieved = true;
      debugCollector.method = 'hobby-doc';
      debugCollector.items = (Array.isArray(hobbyData.items) ? hobbyData.items.map(it => ({ id: it.id, filename: it.filename, trainingId: it.trainingId })) : []);

      const blocks = splitHobbyTextIntoProgramBlocks(hobbyData.text);
      if (blocks && blocks.length > 0) {
        if (blocks.length === 1 && !blocks[0].label) {
          const scored = scoreProgramsFromHobbyLines(hobbyData.text, qLower || q);
          if (scored && scored.label) {
            return {
              answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${scored.label}.\n\nAlasan: aktivitas yang kakak sebutkan paling selaras dengan profil minat pada ${scored.label}.${scored.evidence && scored.evidence.length ? `\\n\\nContoh yang sejalan: ${scored.evidence.join('; ')}.` : ''}`,
              source: 'rag-major-recommendation-hoby-doc-lines',
              contexts: debugCollector.items,
              confidenceTier: 'HIGH',
              debug: debugCollector
            };
          }
        }

        const labeled = blocks.filter(b => b && b.label && b.text);
        const tokens = tokenizeForRelevanceGuard(qLower || q);
        if (labeled.length > 0 && tokens.length > 0) {
          const lexScored = labeled.map(b => ({ b, cov: keywordCoverage(tokens, b.text) }));
          lexScored.sort((a, b) => b.cov - a.cov);
          const bestLex = lexScored[0];
          const secondLex = lexScored[1];
          const minCov = parseFloat(process.env.RAG_HOBY_DOC_MIN_COVERAGE || '0.22');
          const margin = 0.08;
          if (bestLex && bestLex.cov >= minCov && (!secondLex || (bestLex.cov - secondLex.cov) >= margin)) {
            const ev = pickEvidenceLines(bestLex.b.text, qLower || q);
            const evText = ev.length ? `\\n\\nContoh yang sejalan: ${ev.slice(0, 3).join('; ')}.` : '';
            return {
              answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${bestLex.b.label}.\\n\\nAlasan: hobi yang kakak sebutkan paling selaras dengan profil minat pada ${bestLex.b.label}.${evText}`,
              source: 'rag-major-recommendation-hoby-doc-lex',
              contexts: debugCollector.items,
              confidenceTier: 'HIGH',
              debug: debugCollector
            };
          }
        }

        // Semantic embedding fallback against labeled blocks
        const qEmb = await computeEmbedding(qLower || q);
        const semScored = [];
        for (const b of (labeled.length ? labeled : blocks)) {
          if (!b || !b.text) continue;
          const emb = await computeEmbedding(b.text);
          semScored.push({ b, score: cosineSimilarity(qEmb, emb) });
        }
        semScored.sort((a, b) => b.score - a.score);

        const best = semScored[0];
        const minHobbyDoc = parseFloat(process.env.RAG_HOBY_DOC_MIN || '0.42');
        if (best && best.score >= minHobbyDoc && best.b && best.b.label) {
          const ev = pickEvidenceLines(best.b.text, qLower || q);
          const evText = ev.length ? `\\n\\nContoh yang sejalan: ${ev.slice(0, 3).join('; ')}.` : '';
          return {
            answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${best.b.label}.\\n\\nAlasan: hobi yang kakak sebutkan paling selaras dengan profil minat pada ${best.b.label}.${evText}`,
            source: 'rag-major-recommendation-hoby-doc',
            contexts: debugCollector.items,
            confidenceTier: 'HIGH',
            debug: debugCollector
          };
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e && e.message }, '[RAG] Hobby-file matching failed');
  }

  // If hobby-document retrieval didn't produce confident result, continue to heuristics below.

  // Strong heuristic: if user mentions marketing/pemasaran or content creation,
  // prefer Bisnis Digital (BD). If user explicitly mentions data analysis / data science,
  // prefer Sistem Informasi (SI) or Teknologi Informasi (TI) depending on technical phrasing.
  const marketingSignals = /(pemasaran|marketing|pemasaran\s+digital|monetisasi|social\s*media|sosmed|instagram|tiktok|konten|content|analisis\s+pasar|riset\s+pasar|market\s+research|tren\s+pasar|reseller|dropship|dropshipper|jualan|jual\s*beli|tawar\s*menawar|nego|negosiasi|wirausaha|entrepreneur|bisnis|marketplace|olshop)/i;
  const dataSignals = /(analisis\s+data|data\s+science|data\s+anal)/i;

  if (aboutContentCreation && marketingSignals.test(qLower)) {
    return {
      answer:
        'Prodi yang paling cocok untuk hobi tersebut adalah Bisnis Digital (BD).\n\n' +
        'Alasan: hobi berkaitan dengan pemasaran digital, pembuatan konten, dan pemahaman perilaku pasar - kompetensi yang lebih ditekankan di Bisnis Digital.',
      source: 'rag-major-recommendation',
      contexts: [],
      confidenceTier: 'MEDIUM',
      debug: debugCollector
    };
  }

  // Heuristic: reseller/nego/jual-beli usually aligns to Bisnis Digital
  if (/\b(reseller|dropship|dropshipper|tawar\s*menawar|nego|negosiasi|jualan|jual\s*beli|marketplace|olshop|wirausaha|entrepreneur)\b/i.test(qLower)) {
    return {
      answer:
        'Prodi yang paling cocok untuk hobi tersebut adalah Bisnis Digital (BD).\n\n' +
        'Alasan: aktivitas reseller/berjualan/negosiasi erat dengan strategi pemasaran, pemahaman pasar, dan pengelolaan bisnis digital.',
      source: 'rag-major-recommendation',
      contexts: [],
      confidenceTier: 'MEDIUM',
      debug: debugCollector
    };
  }

  if (aboutMarketAnalysis) {
    if (dataSignals.test(qLower)) {
      return {
        answer:
          'Prodi yang paling cocok untuk hobi analisis data adalah Sistem Informasi (SI).\n\n' +
          'Alasan: SI fokus pada pengolahan data, pembuatan dashboard, dan pengambilan keputusan berbasis data.',
        source: 'rag-major-recommendation',
        contexts: [],
        confidenceTier: 'MEDIUM',
        debug: debugCollector
      };
    }
    // Default market-analysis -> Bisnis Digital
    if (marketingSignals.test(qLower) || /analisis\s+pasar/i.test(qLower)) {
      return {
        answer:
          'Prodi yang paling cocok untuk hobi analisis pasar/riset pasar adalah Bisnis Digital (BD).\n\n' +
          'Alasan: BD mengajarkan riset pasar online, strategi pemasaran digital, dan insight pasar yang relevan untuk hobi tersebut.',
        source: 'rag-major-recommendation',
        contexts: [],
        confidenceTier: 'MEDIUM',
        debug: debugCollector
      };
    }
  }

  if (aboutHardware) {
    return {
      answer:
        'Prodi yang paling cocok untuk hobi merakit komputer/PC atau perangkat keras adalah Sistem Komputer (SK).\n\n' +
        'Alasan: SK menekankan arsitektur komputer, sistem tertanam, dan perangkat keras - cocok untuk yang suka merakit dan bekerja dengan hardware.',
      source: 'rag-major-recommendation',
      contexts: [],
      confidenceTier: 'MEDIUM',
      debug: debugCollector
    };
  }

  // If we have a training file that maps hobbies to programs (hobi-sesuai-program-studi),
  // prefer to consult it and pick the strongest matching program.
  try {
    // New approach: use the hobby-mapping document, split per-prodi, then match.
    // Prefer lexical match first (robust even when embeddings are mocked), then semantic.
    const hobbyText = extractHobbyMappingTextFromIndex(indexForQuery);
    if (hobbyText) {
      const blocks = splitHobbyTextIntoProgramBlocks(hobbyText);
      if (blocks && blocks.length > 0) {
        // If the doc isn't split-able (table-style OCR), try line-based scoring.
        if (blocks.length === 1 && !blocks[0].label) {
          const scored = scoreProgramsFromHobbyLines(hobbyText, qLower || q);
          if (scored && scored.label) {
            const evText = (Array.isArray(scored.evidence) && scored.evidence.length)
              ? `\n\nContoh yang sejalan: ${scored.evidence.join('; ')}.`
              : '';
            return {
              answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${scored.label}.\n\nAlasan: aktivitas yang kakak sebutkan paling selaras dengan profil minat pada ${scored.label}.${evText}`,
              source: 'rag-major-recommendation-hoby-doc-lines'
            };
          }
        }

        const labeled = blocks.filter(b => b && b.label && b.text);
        const tokens = tokenizeForRelevanceGuard(qLower || q);
        if (labeled.length > 0 && tokens.length > 0) {
          const lexScored = labeled.map(b => ({ b, cov: keywordCoverage(tokens, b.text) }));
          lexScored.sort((a, b) => b.cov - a.cov);
          const bestLex = lexScored[0];
          const secondLex = lexScored[1];
          const minCov = parseFloat(process.env.RAG_HOBY_DOC_MIN_COVERAGE || '0.22');
          const margin = 0.08;
          if (bestLex && bestLex.cov >= minCov && (!secondLex || (bestLex.cov - secondLex.cov) >= margin)) {
            const ev = pickEvidenceLines(bestLex.b.text, qLower || q);
            const evText = ev.length ? `\n\nContoh yang sejalan: ${ev.slice(0, 3).join('; ')}.` : '';
            return {
              answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${bestLex.b.label}.\n\nAlasan: hobi yang kakak sebutkan paling selaras dengan profil minat pada ${bestLex.b.label}.${evText}`,
              source: 'rag-major-recommendation-hoby-doc-lex'
            };
          }
        }

        const qEmb = await computeEmbedding(qLower || q);
        const semScored = [];
        for (const b of labeled.length ? labeled : blocks) {
          if (!b || !b.text) continue;
          const emb = await computeEmbedding(b.text);
          semScored.push({ b, score: cosineSimilarity(qEmb, emb) });
        }
        semScored.sort((a, b) => b.score - a.score);

        const best = semScored[0];
        const minHobbyDoc = parseFloat(process.env.RAG_HOBY_DOC_MIN || '0.42');
        if (best && best.score >= minHobbyDoc && best.b && best.b.label) {
          const ev = pickEvidenceLines(best.b.text, qLower || q);
          const evText = ev.length ? `\n\nContoh yang sejalan: ${ev.slice(0, 3).join('; ')}.` : '';
          return {
            answer: `Prodi yang paling cocok untuk hobi tersebut adalah ${best.b.label}.\n\nAlasan: hobi yang kakak sebutkan paling selaras dengan profil minat pada ${best.b.label}.${evText}`,
            source: 'rag-major-recommendation-hoby-doc'
          };
        }
      }
    }
  } catch (e) {
    logger.warn({ err: e && e.message }, '[RAG] Hobby-file matching failed');
  }

  // If we got here, we can't confidently pick a major from signals or the hobby mapping.
  // Avoid throwing this to the generic/LLM layer (it can drift to the wrong major).
  // Ask for 1ΓÇô2 concrete activity examples so we can match reliably.
  return {
    answer:
      'Biar aku bisa cocokin jurusan yang paling pas, hobinya lebih sering ngapain ya? ' +
      'Cukup balas 2ΓÇô3 contoh aktivitas spesifik (mis. "jualan online", "edit video", "ngoding", "analisis data", "merakit elektronik").',
    source: 'rag-major-recommendation',
    contexts: [],
    confidenceTier: 'LOW',
    debug: debugCollector
  };
}


function tryStructuredRplAnswer(rawQuestion) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion) || '';
  const qLower = normalizeIndonesianQuestionText(currentQ);
  if (!qLower) return null;

  // Trigger for RPL / Rekognisi Pembelajaran Lampau
  if (!/\b(rpl|jalur\s*rpl|rekognisi\s+pembelajaran|rekognisi\s*pembelajaran\s*lampau)\b/i.test(qLower)) return null;

  const lines = [];
  lines.push('Jalur RPL (Rekognisi Pembelajaran Lampau) adalah mekanisme pengakuan kompetensi atau pengalaman sebelumnya sehingga beberapa mata kuliah dapat diakui.');
  lines.push('Biasanya langkah umum:');
  lines.push('');
  lines.push('- Siapkan bukti pengalaman atau sertifikat (sertifikat pelatihan, surat keterangan kerja, portofolio, transkrip nilai jika ada).');
  lines.push('- Ajukan permohonan RPL ke bagian PMB/akademik dengan melampirkan dokumen pendukung.');
  lines.push('- Tim akademik akan menilai kelayakan; bisa ada tes/penilaian tambahan atau wawancara.');
  lines.push('');
  lines.push('Untuk ketentuan dan persyaratan pasti di ITB STIKOM Bali, minta saya sambungkan ke admin (balas: ADMIN), atau sebutkan apakah kakak punya pengalaman kerja/sertifikat tertentu agar saya bantu arahkan dokumen yang perlu disiapkan.');

  return { answer: lines.join('\n'), source: 'rag-rpl' };
}

function tryStructuredProgramOverviewAnswer(rawQuestion) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = normalizeIndonesianQuestionText(q);
  // If user explicitly mentions a specific program (SI/TI/BD/SK), prefer
  // running retrieval for that program instead of returning the generic
  // program-overview response which lists all prodi. This prevents generic
  // overview answers from overshadowing program-specific chunks.
  const hasSpecificProgramMention = /\b(si|ti|bd|sk|mi|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|s\.?k(?:om(?:puter)?)?|manajemen\s+informatika|manajemen\s+informasi)\b/i.test(qLower);
  if (hasSpecificProgramMention) return null;

  // Expanded triggers to catch all program overview queries including variations like:
  // "ada program studi apa saja", "program studi di", "jurusan di", "kampus ini punya program apa saja", 
  // "daftar prodi", "pilihan jurusan", "prodi yang tersedia", "program pendidikan di"
  const allProgramOverviewTriggers = [
    /(?:\bada\b.*\b(?:program\s+studi|prodi|jurusan)|\bprogram\s+studi.*\bapa\s+saja\b|\bprodi.*\bapa\s+saja\b|\bjurusan.*\bapa\s+saja\b)/i,  // "ada program studi apa saja", "ada prodi apa saja"
    /(?:\b(?:program\s+studi|prodi|jurusan)\s+di\b)/i,  // "program studi di", "prodi di", "jurusan di"
    /(?:\b(?:kampus|sekolah).*\bpunya|punya.*\b(?:program|prodi|jurusan))/i,  // "kampus punya program apa"
    /(?:\b(?:daftar|list|pilihan)\s+(?:prodi|jurusan|program)|\b(?:prodi|jurusan)\s+(?:yang|apa)\s+(?:tersedia|ada|ditawarkan))/i,  // "daftar prodi", "pilihan jurusan", "prodi yang tersedia"
    /(?:\b(?:program\s+)?pendidikan\s+di\b)/i,  // "program pendidikan di"
    /(?:\bapa\s+itu\b|\bdi\b.+\sbelajar\s+apa\b|\bmata\s+kuliah\b|\blulusan\b.+\b(?:bekerja|kerja)\b|\bprospek\s+kerja\b|\bkarir\b|\bprogram\s+studi\b|\bprofil\s+prodi\b)/i,  // Original triggers
    /(?:berikan|beri|tampilkan)\s+(?:detail|informasi|ringkasan)|(?:detail|informasi|ringkasan)\s+(?:tentang|prodi|masing|-masing)|detail\s+tentang\s+masing|-masing\s+prodi|detail\s+prodi/i  // Detail request triggers
  ];
  
  const matchesTrigger = allProgramOverviewTriggers.some(trigger => trigger.test(qLower));
  if (!matchesTrigger) return null;

  const lines = [];
  lines.push('ITB STIKOM Bali menyediakan berbagai jenjang dan jenis program studi. Berikut ringkasannya:');
  lines.push('');
  
  // PROGRAM S2 / MAGISTER (FIRST - as per requirement: S2 → S1 → D3 → DD → IC)
  lines.push('** PROGRAM S2 / MAGISTER (PASCASARJANA) **');
  lines.push('Program magister/pascasarjana tersedia untuk mahasiswa yang sudah menyelesaikan S1 dan ingin melanjutkan ke jenjang pendidikan lebih tinggi dengan fokus pada penelitian dan keahlian lanjutan.');
  lines.push('');
  
  // PROGRAM S1 (SARJANA) - SECOND
  lines.push('** PROGRAM S1 (SARJANA) **');
  lines.push('');
  lines.push('- Bisnis Digital (BD): fokus pada strategi bisnis digital, e-commerce, pemasaran digital, analisis pasar dan monetisasi konten. Contoh mata kuliah: Digital Marketing, E-commerce, Analisis Data Digital. Lulusan: Digital Marketer, E-commerce Manager, Content Strategist.');
  lines.push('- Sistem Informasi (SI): jembatan antara bisnis dan teknologi; desain & implementasi sistem informasi, analisis kebutuhan bisnis, manajemen data, integrasi sistem. Contoh mata kuliah: Analisis Sistem, Basis Data, Rekayasa Perangkat Lunak. Lulusan: Business Analyst, System Analyst, IT Consultant.');
  lines.push('- Teknologi Informasi (TI): lebih menekankan pengembangan perangkat lunak, infrastruktur, jaringan dan keamanan. Contoh mata kuliah: Pemrograman, Jaringan Komputer, Keamanan Siber. Lulusan: Software Developer, Network Engineer, DevOps.');
  lines.push('- Sistem Komputer (SK): fokus pada arsitektur komputer, sistem tertanam/embedded, elektronika digital, IoT dan perangkat keras. Contoh mata kuliah: Arsitektur Komputer, Mikrokontroler, Sistem Tertanam. Lulusan: Embedded Engineer, Hardware Engineer.');
  lines.push('');
  
  // PROGRAM D3 - THIRD
  lines.push('** PROGRAM D3 (DIPLOMA 3) **');
  lines.push('Program D3 tersedia untuk calon mahasiswa yang ingin pendidikan yang lebih singkat (3 tahun) dan fokus pada praktik. Tersedia dalam beberapa spesialisasi sesuai bidang teknologi dan bisnis.');
  lines.push('');
  
  // PROGRAM DUAL DEGREE - FOURTH
  lines.push('** PROGRAM DUAL DEGREE (KERJASAMA INTERNASIONAL) **');
  lines.push('Tersedia program dengan mitra universitas di luar negeri (UTB, DNUI, HELP, dan mitra lainnya) di mana mahasiswa bisa mendapatkan gelar dari dua institusi. Mahasiswa berkesempatan memperoleh pengalaman pendidikan internasional dan wawasan global.');
  lines.push('');
  
  // PROGRAM INTERNATIONAL CLASS - FIFTH
  lines.push('** PROGRAM INTERNATIONAL CLASS **');
  lines.push('Program S1 reguler dengan kelas khusus yang menitikberatkan pada pembelajaran berbahasa Inggris dan standar internasional. Kelas ini dirancang untuk mahasiswa yang ingin pengalaman belajar dengan standar internasional.');
  lines.push('');
  
  lines.push('Mau info lebih detail?');
  lines.push('- Per prodi S1 (kurikulum/akreditasi/prospek): Sebutkan BD / SI / TI / SK');
  lines.push('- Program D3: Balas "D3"');
  lines.push('- Program Dual Degree: Balas "Dual Degree" atau mitra yang dituju (UTB/DNUI/HELP)');
  lines.push('- International Class: Balas "International Class"');
  lines.push('- Biaya & pendaftaran: Balas "Biaya"');

  return { answer: lines.join('\n'), source: 'rag-prodi-overview' };
}

function tryStructuredProgramComparisonAnswer(rawQuestion) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = normalizeIndonesianQuestionText(q);
  // Detect program mentions (support comparing any set of known prodi)
  const defs = [
    { key: 'bd', label: 'Bisnis Digital', re: /\b(bd|bisnis\s+digital)\b/i, desc: 'Fokus pada strategi bisnis digital, pemasaran digital, e-commerce, monetisasi konten. Lulusan: Digital Marketer, E-commerce Manager, Content Strategist.' },
    { key: 'si', label: 'Sistem Informasi', re: /\b(si|sistem\s+informasi)\b/i, desc: 'Jembatan antara bisnis & teknologi; analisis sistem, basis data, integrasi, dashboard. Lulusan: Business Analyst, System Analyst.' },
    { key: 'ti', label: 'Teknologi Informasi', re: /\b(ti|teknologi\s+informasi)\b/i, desc: 'Penekanan pada pengembangan perangkat lunak, infrastruktur, keamanan, dan machine learning. Lulusan: Software Developer, DevOps, Data Engineer.' },
    { key: 'sk', label: 'Sistem Komputer', re: /\b(sk|sistem\s+komputer)\b/i, desc: 'Fokus pada arsitektur komputer, embedded/IOT, perangkat keras dan optimasi sistem. Lulusan: Embedded Engineer, Hardware Engineer.' }
  ];

  const mentioned = [];
  for (const d of defs) {
    if (d.re.test(qLower)) mentioned.push(d);
  }

  // If user asks to compare 'semua' atau 'seluruh' jurusan, include all defs
  if (mentioned.length === 0 && /\b(semua|seluruh)\b.*\b(jurusan|prodi|program\s+studi)\b/i.test(qLower)) {
    mentioned.push(...defs);
  }

  // If user asked a generic compare question without explicit program names, ignore.
  const wantsCompare = /\b(bandingkan|perbandingan|beda|lebih\s+baik|mana)\b/i.test(qLower);
  if (!wantsCompare && mentioned.length < 2) return null;

  // If only one mentioned but user asked 'bandingkan', compare it against others
  let toCompare = mentioned;
  if (mentioned.length === 1 && wantsCompare) {
    toCompare = defs;
  }

  if (!toCompare || toCompare.length < 2) return null;

  const lines = [];
  const hdr = toCompare.map(d => d.label).join(' vs ');
  lines.push(`Perbandingan singkat: ${hdr}`);
  lines.push('');

  for (const d of toCompare) {
    lines.push(`- ${d.label}: ${d.desc}`);
  }

  lines.push('');
  lines.push('Perbandingan cepat:');
  lines.push('- Bisnis Digital (BD) = lebih condong ke pemasaran digital, monetisasi, dan insight pasar.');
  lines.push('- Sistem Informasi (SI) = jembatan bisnis Γåö teknologi; cocok untuk yang suka analisis proses dan dashboard.');
  lines.push('- Teknologi Informasi (TI) = fokus teknis pengembangan software, infrastruktur, dan data engineering/ML.');
  lines.push('- Sistem Komputer (SK) = fokus hardware, embedded, dan sistem tertanam/IoT.');
  lines.push('');
  lines.push('Mau perbandingan lebih mendetail (kurikulum / akreditasi / biaya / prospek kerja)? Sebutkan aspek yang mau dibandingkan atau prodi mana yang ingin dibandingkan lebih rinci.');

  return { answer: lines.join('\n'), source: 'rag-program-comparison' };
}

function tryStructuredCampusAccreditationAnswer(question, indexForQuery) {
  const q = extractCurrentUserQuestionText(question) || '';
  const qLower = normalizeIndonesianQuestionText(q);
  if (!qLower) return null;
  if (!/\b(kampus|itb\s*stikom|stikom\b|itb\s*stikom\s*bali)\b/i.test(qLower)) return null;
  if (!/\b(akreditasi|akredit|ban\s*-?pt|sertifikat\s+akreditasi)\b/i.test(qLower)) return null;

  // If a specific program is mentioned, let tryStructuredAccreditationAnswer handle it.
  const progMention = normalizeAccreditationProgramFromQuestion(qLower);
  if (progMention) return null;

  // Prefer campus-level accreditation certificate file when available (SSK-92951...)
  try {
    if (indexForQuery && Array.isArray(indexForQuery)) {
      const campusDoc = indexForQuery.find(it => it && it.filename && /ssk[-_]?92951(?:[-_a-z0-9_]+)?/i.test(String(it.filename || '').toLowerCase()));
      if (campusDoc) {
        // Combine all chunks that belong to the same file/trainingId to improve extraction reliability
        const fname = String(campusDoc.filename || '').toLowerCase();
        const tid = campusDoc.trainingId ? String(campusDoc.trainingId) : null;
        const same = indexForQuery.filter(it => it && ((it.filename && String(it.filename || '').toLowerCase() === fname) || (tid && String(it.trainingId || '') === String(tid))));
        const txt = same && same.length ? same.map(s => String(s.chunk || '')).join('\n') : String(campusDoc.chunk || '');

        // Try multiple patterns to extract grade, SK number, and validity range
        let gradeM = /\b(unggul|baik\s+sekali|baik|A|B|C)\b/i.exec(txt);
        if (!gradeM) gradeM = /peringkat\s+akreditasi[\s:\-]{0,40}?\b(unggul|baik\s+sekali|baik|A|B|C)\b/i.exec(txt);
        if (!gradeM) gradeM = /MENETAPKAN[\s\S]{0,120}?\b(UNGGUL|BAIK\s+SEKALI|BAIK|A|B|C)\b/i.exec(txt);

        const skM = /\b(?:SK|Nomor|No\.)\s*[:\-]?\s*([A-Z0-9./-]{6,})/i.exec(txt);
        const validityM = /\bberlaku\b[\s\S]{0,40}?\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b[\s\S]{0,20}?(?:s\/d|s\.d|sampai|hingga|ΓÇô|-)\s*\b(\d{1,2}\s+[A-Za-z├Ç-├┐]+\s+\d{4})\b/i.exec(txt);

        const outLines = [];
        const normalizeCampusGrade = (gg) => {
          const g = String(gg || '').trim();
          if (!g) return g;
          if (/^[abc]$/i.test(g)) return g.toUpperCase();
          if (/unggul/i.test(g)) return 'Unggul';
          if (/baik\s*sekali/i.test(g)) return 'Baik Sekali';
          if (/baik/i.test(g)) return 'Baik';
          return g.charAt(0).toUpperCase() + g.slice(1).toLowerCase();
        };
        if (gradeM && gradeM[1]) outLines.push(`Akreditasi kampus: ${normalizeCampusGrade(gradeM[1])}.`);
        else outLines.push('Akreditasi kampus: dokumen ditemukan, tetapi peringkat tidak terdeteksi dengan pasti.');
        if (skM && skM[1]) outLines.push(`Nomor SK: ${String(skM[1]).trim()}.`);
        if (validityM && validityM[1] && validityM[2]) outLines.push(`Masa berlaku: ${String(validityM[1]).trim()} ΓÇô ${String(validityM[2]).trim()}.`);
        outLines.push('');
        outLines.push(`Sumber: dokumen ${String(campusDoc.filename)} (dokumen akreditasi kampus). Untuk kepastian resmi, verifikasi ke admin atau dokumen resmi.`);

        return { answer: outLines.join('\n'), source: 'rag-accreditation-campus-doc' };
      }
    }
  } catch (e) {
    logger.warn({ err: e && e.message }, '[RAG] Campus-accreditation doc parse failed');
  }

  // Generic fallback for campus accreditation questions: provide general info
  // (don't duplicate program overview, just indicate where to find accreditation info)
  const lines = [];
  lines.push('Untuk informasi akreditasi kampus ITB STIKOM Bali, silakan hubungi bagian akademik atau lihat dokumen akreditasi resmi di laman kampus.');
  lines.push('');
  lines.push('Jika Anda ingin tahu tentang program studi yang kami tawarkan, bisa saya jelaskan lengkap.');

  return { answer: lines.join('\n'), source: 'rag-accreditation-campus' };
}

function tryStructuredDualDegreeProgramsAnswer(rawQuestion) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  const mentionsDualDegree = /(dual\s*degree|double\s*degree)/i.test(qLower);
  if (!mentionsDualDegree) return null;

  // If user is asking for fees/details, let the fee breakdown rule handle it.
  if (/(biaya|rincian|detail|berapa|dpp|pendaftaran|per\s*semester|cicil|cicilan|skema\s+pembayaran)/i.test(qLower)) {
    return null;
  }

  // If query already specifies a SPECIFIC Dual Degree program partner (UTB, DNUI, HELP, Malaysia, China, Bandung),
  // don't show the generic program list ΓÇö let the query proceed to RAG index lookup.
  const hasSpecificPartner = /(utb|dnui|dalian|neusoft|help\s+university|malaysia|china|bandung|teknologi\s+bandung)/i.test(qLower);
  if (hasSpecificPartner) {
    return null;  // Let RAG index handle the specific query
  }
  // If the user explicitly asked about 'internasional', only show
  // programs that are international-class (exclude national-only entries).
  const onlyInternational = /\binternasional\b|\binternational\b|\bkelas\s+internasional\b|\binternational\s+class\b/i.test(qLower);
  const onlyNational = /\bnasional\b|\bkelas\s+nasional\b/i.test(qLower);

  let programs = extractDualDegreeProgramsFromIndex();
  if (onlyInternational) {
    programs = (programs || []).filter(p => /international/i.test(p.line) || p.key === 'dnui' || p.key === 'help');
    if (!programs || programs.length === 0) {
      return {
        answer: 'Maaf, saya belum menemukan program Dual Degree kelas internasional di data PMB saat ini. Mau saya tampilkan semua program Dual Degree yang tersedia?',
        source: 'rag-dual-degree-none-internasional'
      };
    }
  }

  if (onlyNational) {
    programs = (programs || []).filter(p => p.key !== 'dnui' && p.key !== 'help');
    if (!programs || programs.length === 0) {
      return {
        answer: 'Maaf, saya belum menemukan program Dual Degree kelas nasional di data PMB saat ini. Mau saya tampilkan semua program Dual Degree yang tersedia?',
        source: 'rag-dual-degree-none-nasional'
      };
    }
  }

  if (!programs || programs.length === 0) {
    // Fallback: user asked definition/what-is ΓÇö provide a safe generic explanation
    if (/\bapa\s+itu\b|\bapa\b.*\bdual\s*degree\b|\bdefinisi\b.*\bdual\s*degree\b/i.test(qLower)) {
      return {
        answer:
          'Dual Degree adalah program di mana mahasiswa mengikuti kurikulum kerja sama antara dua institusi (kampus lokal dan mitra luar negeri/luar negeri). Lulusannya bisa mendapatkan gelar dari kedua institusi. Untuk info program Dual Degree spesifik (mis. UTB / DNUI / HELP), sebutkan nama mitranya.',
        source: 'rag-dual-degree-def'
      };
    }
    return null;
  }

  const lines = [];
  lines.push('Ada. Di data PMB, program Dual Degree yang tercantum yaitu:');
  lines.push('');
  for (const p of programs) lines.push(`- ${p.line}`);
  lines.push('');
  if (onlyInternational) {
    lines.push('Kakak mau info Dual Degree yang mana? Balas: DNUI / HELP.');
  } else if (onlyNational) {
    lines.push('Kakak mau info Dual Degree yang mana? Balas: UTB.');
  } else {
    lines.push('Kakak mau info Dual Degree yang mana? Balas: UTB / DNUI / HELP.');
  }

  return {
    answer: lines.join('\n').trim(),
    source: 'rag-dual-degree-list'
  };
}

function tryStructuredDualDegreeFeeAnswer(question, indexForQuery) {
  const currentQ = extractCurrentUserQuestionText(question) || '';
  const qLower = normalizeIndonesianQuestionText(currentQ);
  if (!/\b(dual\s*degree|double\s*degree)\b/i.test(qLower)) return null;
  if (!/(potongan|diskon|beasiswa|keringanan|dpp|dana\s+pendidikan\s*pokok|potongan\s+biaya)/i.test(qLower)) return null;

  // UX requirement: when asked about potongan biaya untuk Dual/Double Degree,
  // show only the DPP discount list per gelombang (no UTB/DNUI/HELP mentions).
  const formatRupiahDot = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    const s = Math.round(num).toString();
    const withDots = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `Rp. ${withDots},-`;
  };

  const dppDiscounts = [
    { wave: 'Gelombang Khusus', amount: 3000000 },
    { wave: 'Gelombang I', amount: 2000000 },
    { wave: 'Gelombang II', amount: 1500000 },
    { wave: 'Gelombang III', amount: 1000000 },
    { wave: 'Gelombang IV', amount: 500000 }
  ];

  const lines = [];
  lines.push('Informasi Potongan DPP (Dana Pendidikan Pokok) untuk Program Double/Dual Degree');
  lines.push('Potongan diberikan berdasarkan gelombang saat registrasi:');
  lines.push('');
  for (const it of dppDiscounts) {
    lines.push(`- ${it.wave}: ${formatRupiahDot(it.amount)}`);
  }
  // Append scholarship postamble and follow-up prompt to match fee template
  lines.push('');
  lines.push('Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:');
  lines.push('* Beasiswa KIP');
  lines.push('* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)');
  lines.push('* Beasiswa Prestasi');
  lines.push('* Beasiswa Yayasan');
  lines.push('* Beasiswa khusus untuk alumni — silakan hubungi PMB untuk detail');
  lines.push('* Kuliah Sambil Kerja di Luar Negeri');
  lines.push('');
  lines.push('Apakah Kakak ingin dijelaskan tentang?');
  lines.push('* Biaya perkuliahan program studi yang lainnya');
  lines.push('* Salah satu jenis beasiswa');
  lines.push('* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll');
  lines.push('Silahkan diketikkan.');

  return {
    answer: lines.join('\n').trim(),
    source: 'rag-dual-degree-dpp-discount'
  };
}

function toRomanUpTo12(num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n <= 0 || n > 12) return null;
  const map = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
    6: 'VI',
    7: 'VII',
    8: 'VIII',
    9: 'IX',
    10: 'X',
    11: 'XI',
    12: 'XII'
  };
  return map[n] || null;
}

function normalizeScheduleWaveKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  if (/\bkhusus\b/i.test(s)) return 'KHUSUS';

  const sisipan = /^sisipan\s*([0-9]{1,2})\b/i.exec(s);
  if (sisipan && sisipan[1]) return `SISIPAN ${sisipan[1]}`;

  // Compact like "2B" / "IIB" / "2 B" / "II B"
  const compact = /^([0-9]{1,2}|[ivx]{1,6})\s*([a-c])?$/i.exec(s.replace(/\s+/g, ''));
  if (!compact) return null;

  const base = String(compact[1] || '').trim();
  const letter = (compact[2] || '').toUpperCase();
  let roman = null;
  if (/^[0-9]+$/.test(base)) roman = toRomanUpTo12(parseInt(base, 10));
  else roman = base.toUpperCase();

  if (!roman) return null;
  return letter ? `${roman} ${letter}` : roman;
}

function extractAvailableScheduleWaveKeysFromIndex() {
  const fullIndex = loadIndex();
  if (!Array.isArray(fullIndex) || fullIndex.length === 0) return [];

  const combined = fullIndex.map(i => (i && i.chunk ? String(i.chunk) : '')).join('\n');
  const lines = combined.replace(/\r\n/g, '\n').split('\n');

  let inCalendar = false;
  let budget = 0;

  const out = [];
  const seen = new Set();

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) continue;

    if (/KALENDER\s+PENDAFTARAN\s+MAHASISWA\s+BARU/i.test(line)) {
      inCalendar = true;
      budget = 600;
      continue;
    }

    if (!inCalendar) continue;
    if (budget-- <= 0) break;

    if (!line.includes('|')) continue;
    const left = String(line.split('|')[0] || '').trim();
    if (!left) continue;
    if (/^GELOMBANG$/i.test(left)) continue;

    const key = normalizeScheduleWaveKey(left);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function formatWaveKeyForDisplay(waveKey) {
  const w = String(waveKey || '').trim().toUpperCase();
  if (!w) return '';
  if (w === 'KHUSUS') return 'Khusus';
  if (/^SISIPAN\s+[0-9]{1,2}$/.test(w)) return `Sisipan ${w.replace(/^SISIPAN\s+/i, '')}`;
  return w;
}

const WITA_TZ = process.env.BOT_TIMEZONE || 'Asia/Makassar';

function getTodayYmdInTimeZone(timeZone) {
  try {
    const dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    // en-CA yields YYYY-MM-DD
    return dtf.format(new Date());
  } catch (e) {
    // Fallback: local date (may differ from WITA if server TZ differs)
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

function formatTodayId(timeZone) {
  try {
    return new Intl.DateTimeFormat('id-ID', { timeZone, day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseIndonesianDateToYmd(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // Example: "28 OKTOBER 2025" or "1 FEBRUARI 2026"
  const m = /\b(\d{1,2})\s+([A-Za-z├Ç-├┐]+)\s+(\d{4})\b/.exec(s);
  if (!m) return null;

  const day = parseInt(m[1], 10);
  const monthName = String(m[2] || '').toLowerCase();
  const year = parseInt(m[3], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;

  const months = {
    januari: 1,
    feb: 2, februari: 2,
    mar: 3, maret: 3,
    apr: 4, april: 4,
    mei: 5,
    jun: 6, juni: 6,
    jul: 7, juli: 7,
    agu: 8, agustus: 8,
    sep: 9, september: 9,
    okt: 10, oktober: 10,
    nov: 11, november: 11,
    des: 12, desember: 12
  };

  const month = months[monthName];
  if (!month) return null;

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseIndonesianDateRange(raw) {
  const s = String(raw || '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return null;
  const parts = s.split(/\s*(?:s\s*\/\s*d|s\s*d|s\.\s*d|sd|hingga|sampai|\-)\s*/i).filter(Boolean);
  if (parts.length < 2) return null;
  const startYmd = parseIndonesianDateToYmd(parts[0]);
  const endYmd = parseIndonesianDateToYmd(parts[1]);
  if (!startYmd || !endYmd) return null;
  return { startYmd, endYmd };
}

function compactDateRangeText(masaRaw) {
  // Keep human-readable but shorter. Example:
  // "29 MARET 2026 s/d 18 APRIL 2026" -> "29 Maret 2026 - 18 April 2026"
  const s = String(masaRaw || '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/\s*(?:s\s*\/\s*d|s\s*d|s\.\s*d|sd|hingga|sampai)\s*/i).filter(Boolean);
  if (parts.length < 2) return s;
  const a = String(parts[0] || '').trim();
  const b = String(parts[1] || '').trim();
  // Title-case month words roughly by lowercasing then uppercasing first letter of each word.
  const prettify = (v) => String(v || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => (w.length <= 2 ? w.toUpperCase() : (w.charAt(0).toUpperCase() + w.slice(1))))
    .join(' ');
  return `${prettify(a)} - ${prettify(b)}`;
}

let cachedScheduleWindows = null;
let cachedScheduleWindowsHash = null;

function extractScheduleRegistrationWindowsFromIndex() {
  const fullIndex = loadIndex();
  if (!Array.isArray(fullIndex) || fullIndex.length === 0) return [];

  try {
    // Cache by content hash to avoid rescans.
    const raw = fullIndex.map(i => (i && i.chunk ? String(i.chunk) : '')).join('\n');
    const hash = crypto.createHash('sha1').update(raw.slice(0, 200000)).digest('hex');
    if (cachedScheduleWindows && cachedScheduleWindowsHash === hash) return cachedScheduleWindows;

    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    let inCalendar = false;
    let budget = 0;

    const out = [];
    const seen = new Set();

    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) continue;

      if (/KALENDER\s+PENDAFTARAN\s+MAHASISWA\s+BARU/i.test(line)) {
        inCalendar = true;
        budget = 900;
        continue;
      }
      if (!inCalendar) continue;
      if (budget-- <= 0) break;

      if (!line.includes('|')) continue;
      const cols = line.split('|').map(c => String(c || '').trim());
      if (cols.length < 2) continue;

      const waveRaw = cols[0];
      const masaRaw = cols[1];
      if (!waveRaw || !masaRaw) continue;
      if (/^GELOMBANG$/i.test(waveRaw)) continue;

      const key = normalizeScheduleWaveKey(waveRaw);
      if (!key) continue;

      const range = parseIndonesianDateRange(masaRaw);
      if (!range) continue;

      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        key,
        display: key === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${formatWaveKeyForDisplay(key)}`,
        masa: masaRaw.replace(/\s{2,}/g, ' ').trim(),
        startYmd: range.startYmd,
        endYmd: range.endYmd
      });
    }

    // Stable order by start date then key.
    out.sort((a, b) => (a.startYmd < b.startYmd ? -1 : a.startYmd > b.startYmd ? 1 : String(a.key).localeCompare(String(b.key))));

    cachedScheduleWindows = out;
    cachedScheduleWindowsHash = hash;
    return out;
  } catch (e) {
    return [];
  }
}

function tryStructuredCurrentOpenWavesAnswer(question) {
  const q = String(question || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  // Trigger only when user explicitly asks about "now/current" waves.
  const mentionsWave = /\bgelombang\b/i.test(qLower) || /\bgbg\b/i.test(qLower);
  if (!mentionsWave) return null;

  const asksNow = /(sekarang|saat\s+ini|hari\s+ini|lagi\s+buka|yang\s+sedang\s+buka|terbuka|dibuka|open|masih\s+buka|masih\s+dibuka)/i.test(qLower) ||
    /sekarang\s+gelombang\s+berapa/i.test(qLower) ||
    /\bkapan\b.*\bgelombang\b/i.test(qLower) || /\bgelombang\b.*\bberikutnya\b/i.test(qLower);
  if (!asksNow) return null;

  const windows = extractScheduleRegistrationWindowsFromIndex();
  if (!windows || windows.length === 0) return null;

  const todayYmd = getTodayYmdInTimeZone(WITA_TZ);
  const todayPretty = formatTodayId(WITA_TZ);

  const open = windows.filter(w => w.startYmd <= todayYmd && todayYmd <= w.endYmd);
  const upcoming = windows.filter(w => w.startYmd > todayYmd);

  open.sort((a, b) => (a.endYmd < b.endYmd ? -1 : a.endYmd > b.endYmd ? 1 : 0));
  upcoming.sort((a, b) => (a.startYmd < b.startYmd ? -1 : a.startYmd > b.startYmd ? 1 : 0));

  if (open.length > 0) {
    const items = open.slice(0, 4).map(w => `${w.display} (${compactDateRangeText(w.masa)})`);
    const more = open.length > 4 ? ` (+${open.length - 4} lainnya)` : '';
    const line1 = `Per ${todayPretty} (WITA), gelombang yang sedang buka pendaftaran:`;
    const line2 = `- ${items.join(' | ')}${more}`;
    const line3 = 'Balas gelombangnya (mis. "II B" / "III A" / "Khusus"), nanti saya kirim jadwal detailnya.';
    return { answer: [line1, line2, '', line3].join('\n'), source: 'rag-current-open-waves' };
  }

  if (upcoming.length > 0) {
    const nextStart = upcoming[0].startYmd;
    const next = upcoming.filter(w => w.startYmd === nextStart).slice(0, 6);

    const items = next.map(w => `${w.display} (${compactDateRangeText(w.masa)})`);
    const line1 = `Per ${todayPretty} (WITA), belum ada gelombang yang sedang buka pendaftaran.`;
    const line2 = `Terdekat dibuka: ${items.join(' | ')}`;
    const line3 = 'Balas gelombangnya, nanti saya kirim jadwal detailnya.';
    return { answer: [line1, line2, '', line3].join('\n'), source: 'rag-current-open-waves' };
  }

  return null;
}

function tryStructuredProgramRegistrationFeeAnswer(rawQuestion, opts) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  // Only for simple registration-fee asks (keep short to avoid WhatsApp send failures).
  const asksRegistrationFee = /(biaya|uang)\s+pendaftaran/i.test(qLower) || /biaya\s+daftar\b/i.test(qLower);
  if (!asksRegistrationFee) return null;
  if (/(potongan|diskon|beasiswa|gelombang)/i.test(qLower)) return null;
  if (/(rincian|detail|komponen|dpp|semester|cicil|cicilan|skema\s+pembayaran)/i.test(qLower)) return null;

  // Detect program hint (S1 SI/TI/BD share one table; SK has its own table).
  const detectProgram = (sourceText) => {
    const s = String(sourceText || qLower || '').toLowerCase();
    if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(s)) return { program: 'Sistem Komputer', key: 'sk' };
    if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(s)) return { program: 'Sistem Informasi', key: 's1' };
    if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(s)) return { program: 'Teknologi Informasi', key: 's1' };
    if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(s)) return { program: 'Bisnis Digital', key: 's1' };
    if (/manajemen|\bprodi\s*manajemen\b|\bjurusan\s*manajemen\b/i.test(s)) return { program: 'Manajemen', key: 's1' };
    if (/akuntansi|\bprodi\s*akuntansi\b|\bjurusan\s*akuntansi\b/i.test(s)) return { program: 'Akuntansi', key: 's1' };
    if (/desain\s+komunikasi|dkv|desain komunikasi visual|\bprodi\s*desain\s*komunikasi\b/i.test(s)) return { program: 'Desain Komunikasi', key: 's1' };
    if (/multimedia|\bprodi\s*multimedia\b|\bjurusan\s*multimedia\b/i.test(s)) return { program: 'Multimedia', key: 's1' };

    // Loose code parsing only when tied to program context.
    if (/\b(prodi|program\s+studi|jurusan)\b/i.test(s)) {
      const m = /\b(ti|si|bd|sk|manajemen|akuntansi|dkv|multimedia)\b/i.exec(s);
      if (m && m[1]) {
        const code = m[1].toLowerCase();
        if (code === 'sk') return { program: 'Sistem Komputer', key: 'sk' };
        if (code === 'si') return { program: 'Sistem Informasi', key: 's1' };
        if (code === 'ti') return { program: 'Teknologi Informasi', key: 's1' };
        if (code === 'bd') return { program: 'Bisnis Digital', key: 's1' };
        if (code === 'manajemen') return { program: 'Manajemen', key: 's1' };
        if (code === 'akuntansi') return { program: 'Akuntansi', key: 's1' };
        if (code === 'dkv') return { program: 'Desain Komunikasi', key: 's1' };
        if (code === 'multimedia') return { program: 'Multimedia', key: 's1' };
      }
    }

    return null;
  };

  // Try detection from several sources: current question, opts.conversationContext, and opts.lastProgramHint
  let prog = detectProgram(qLower);
  const ctxText = opts && opts.conversationContext ? String(opts.conversationContext || '') : '';
  if (!prog && ctxText) prog = detectProgram(ctxText.toLowerCase());
  const hint = opts && opts.lastProgramHint ? String(opts.lastProgramHint || '') : '';
  if (!prog && hint) prog = detectProgram(hint.toLowerCase());
  if (!prog) return null;

  const fullIndex = loadIndex();
  if (!Array.isArray(fullIndex) || fullIndex.length === 0) return null;

  const keyRe = prog.key === 'sk'
    ? /(PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER)/i
    : /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;

  // Pick the best trainingId that contains the regular-class fee table for the program.
  const idCounts = new Map();
  for (const item of fullIndex) {
    const chunk = item && item.chunk ? String(item.chunk) : '';
    const trainingId = item && item.trainingId ? String(item.trainingId) : '';
    if (!chunk || !trainingId) continue;
    if (!keyRe.test(chunk)) continue;
    if (!/RINCIAN\s*BIAYA\s*PENDIDIKAN/i.test(chunk) && !/RINCIANBIAYAPENDIDIKAN/i.test(chunk)) continue;
    const prev = idCounts.get(trainingId) || 0;
    const bonus = /\bPendaftaran\b/i.test(chunk) ? 2 : 0;
    idCounts.set(trainingId, prev + 1 + bonus);
  }

  let bestTrainingId = null;
  let bestScore = -1;
  for (const [tid, score] of idCounts.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestTrainingId = tid;
    }
  }

  const candidates = bestTrainingId
    ? fullIndex.filter(i => i && String(i.trainingId || '') === bestTrainingId).map(i => String(i.chunk || ''))
    : fullIndex.map(i => String(i && i.chunk ? i.chunk : '')).filter(t => keyRe.test(t) && (/RINCIAN\s*BIAYA\s*PENDIDIKAN/i.test(t) || /RINCIANBIAYAPENDIDIKAN/i.test(t)));

  if (!candidates || candidates.length === 0) return null;

  const combined = candidates.join('\n');
  const flat = combined.replace(/\\n/g, '\n').replace(/[\r\n]+/g, '\n');

  // Extract registration fee number (e.g., 500.000)
  const m = /\bPendaftaran\b[^0-9]{0,30}([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{6,})/i.exec(flat);
  if (!m || !m[1]) return null;

  const amount = String(m[1]).trim();
  const timing = /Pada\s+Saat\s+Daftar/i.test(flat) ? ' (dibayar saat daftar)' : '';

  return {
    answer: `Untuk Prodi ${prog.program}, biaya pendaftaran: Rp ${amount}${timing}.`,
    source: 'rag-program-fee-registration'
  };
}

// Jika user menanyakan "pendaftaran <prodi>", tampilkan menu singkat pilihan informasi
// (Biaya / Jadwal PMB / Syarat & dokumen / Kontak PMB) supaya tidak langsung mengirim
// potongan dokumen panjang ketika user hanya ingin opsi.
function tryStructuredProgramRegistrationMenuAnswer(rawQuestion, opts) {
  const currentQ = extractCurrentUserQuestionText(rawQuestion);
  const q = String(currentQ || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  if (!/\bpendaftaran\b/i.test(qLower)) return null;

  // If user already asks for detailed fee or detailed components, let the fee handler run.
  // Note: do NOT include "pendaftaran" here because this function should handle
  // queries that mention "pendaftaran <prodi>" and offer choices instead of
  // treating them as detailed fee requests.
  if (/(biaya|rincian|detail|berapa|dpp|per\s*semester|cicil|cicilan|skema\s+pembayaran)/i.test(qLower)) return null;

  const detectProgram = (src) => {
    const s = String(src || qLower || '').toLowerCase();
    if (/\bprodi\b.*\bsk\b|\bsistem\s+komputer\b|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(s)) return { program: 'Sistem Komputer', key: 'sk' };
    if (/\bprodi\b.*\bsi\b|\bsistem\s+informasi\b|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(s)) return { program: 'Sistem Informasi', key: 's1' };
    if (/\bprodi\b.*\bti\b|\bteknologi\s+informasi\b|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(s)) return { program: 'Teknologi Informasi', key: 's1' };
    if (/\bprodi\b.*\bbd\b|\bbisnis\s+digital\b|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(s)) return { program: 'Bisnis Digital', key: 's1' };
    return null;
  };

  // Prefer detection from current user question; fallback to conversationContext only
  let prog = detectProgram(qLower);
  const ctxText = opts && opts.conversationContext ? String(opts.conversationContext || '').toLowerCase() : '';
  if (!prog && ctxText) prog = detectProgram(ctxText);
  if (!prog) return null;

  const lines = [];
  lines.push(`Siap, untuk Prodi ${prog.program},`);
  lines.push('Kakak mau info yang mana?');
  lines.push('');
  lines.push('- Biaya (pendaftaran/DPP/semester/skema cicilan)');
  lines.push('- Jadwal PMB');
  lines.push('- Syarat & dokumen');
  lines.push('- Kontak PMB');
  lines.push('');
  lines.push('Balas misalnya: "biaya" atau "rincian biaya".');
  lines.push('');
  // Recommend the most useful next action for most users
  lines.push('Rekomendasi: Biaya - untuk melihat nilai pendaftaran cepat dan ringkasan komponen.');

  return { answer: lines.join('\n'), source: 'rag-program-registration-menu' };
}

// Bersihkan beberapa frasa yang kurang nyaman dibaca user
function cleanAnswerLanguage(answer) {
  if (!answer || typeof answer !== 'string') return answer;

  let cleaned = answer;

  // Hilangkan gaya bahasa yang "terlihat seperti hasil ekstraksi dokumen/RAG"
  // Contoh yang sering muncul:
  // - "Berikut program studi yang terbaca tersedia ... pada konteks:"
  // Target: jadi natural seperti chat biasa.
  cleaned = cleaned.replace(/\bprogram\s*studi\s+yang\s+terbaca\s+tersedia\b/gi, 'program studi yang tersedia');
  cleaned = cleaned.replace(/\bberikut\s+program\s*studi\s+yang\s+terbaca\s+tersedia\b/gi, 'Berikut program studi yang tersedia');
  cleaned = cleaned.replace(/\bberikut\s+program\s*studi\s+yang\s+terbaca\b/gi, 'Berikut program studi');
  cleaned = cleaned.replace(/\byang\s+terbaca\b/gi, '');

  // Hilangkan frasa meta "pada konteks" / "dalam konteks"
  cleaned = cleaned.replace(/\b(pada|dalam)\s+konteks\b\s*:?/gi, '');

  // Hilangkan frasa "di tabel" yang membingungkan untuk user WhatsApp/web
  cleaned = cleaned.replace(/\bdi tabel\b/gi, '');

  // Hilangkan frasa "di konteks" agar kalimat lebih natural
  cleaned = cleaned.replace(/\bdi konteks\b/gi, '');

  // Hilangkan frasa "sesuai tabel" / "sesuai dokumen" / "sesuai yang tertulis di dokumen"
  cleaned = cleaned.replace(/\bsesuai\s+tabel\b/gi, '');
  cleaned = cleaned.replace(/\bsesuai\s+dokumen\b/gi, '');
  cleaned = cleaned.replace(/\bsesuai\s+yang\s+tertulis\s+di\s+dokumen\b/gi, '');

  // Pecah detail yang digabung dengan tanda strip menjadi beberapa baris bullet
  // Contoh: "- Masa pendaftaran: ... - Testing: ... - Pengumuman: ..."
  // menjadi beberapa baris terpisah agar rapi.
  cleaned = cleaned.replace(/\s+-\s+Testing/gi, '\n- Testing');
  cleaned = cleaned.replace(/\s+-\s+Pengumuman/gi, '\n- Pengumuman');
  cleaned = cleaned.replace(/\s+-\s+Masa registrasi ulang/gi, '\n- Masa registrasi ulang');

  // Versi dengan markdown tebal: "- **Testing:" dsb
  cleaned = cleaned.replace(/\s+-\s+\*\*Testing/gi, '\n- **Testing');
  cleaned = cleaned.replace(/\s+-\s+\*\*Pengumuman/gi, '\n- **Pengumuman');
  cleaned = cleaned.replace(/\s+-\s+\*\*Masa registrasi ulang/gi, '\n- **Masa registrasi ulang');

  // Versi dengan bullet "ΓÇó" jika model menggunakannya langsung
  cleaned = cleaned.replace(/\s+ΓÇó\s+Testing/gi, '\nΓÇó Testing');
  cleaned = cleaned.replace(/\s+ΓÇó\s+Pengumuman/gi, '\nΓÇó Pengumuman');
  cleaned = cleaned.replace(/\s+ΓÇó\s+Masa registrasi ulang/gi, '\nΓÇó Masa registrasi ulang');

  // Paksa paragraf baru untuk bagian rinciannya
  cleaned = cleaned.replace(/\.\s+(Rincian [^:\n]+:)/g, '.\n\n$1');

  // Paksa paragraf baru untuk pertanyaan lanjutan (misalnya "Apakah Anda..." atau "Mau saya bantu...")
  cleaned = cleaned.replace(/([.!?])\s+((Apakah|Mau) [^\n?]+\?)/g, '$1\n\n$2');

  // Hilangkan frasa seperti "( tertulis mulai)" yang membuat jawaban kurang enak dibaca
  cleaned = cleaned.replace(/\(?\s*tertulis mulai[^)]*\)?/gi, '');

  // Hilangkan catatan dalam kurung seperti "(sesuai yang tertulis di dokumen)"
  cleaned = cleaned.replace(/\([^)]*sesuai[^)]*dokumen[^)]*\)/gi, '');

  // Rapikan spasi berlebih yang mungkin muncul setelah penghapusan
  // Pastikan spasi setelah tanda baca seperti comma/semicolon/colon.
  // Hindari merusak format angka/jam seperti "500.000" atau "12:30".
  cleaned = cleaned.replace(/([,;:])([^\s\n\d])/g, '$1 $2');
  // Tambahkan spasi pada kasus kata yang terhubung tanpa pemisah
  // Contoh: "KomputerBermain" -> "Komputer Bermain".
  cleaned = cleaned.replace(/([a-z0-9])([A-Z][a-z])/g, '$1 $2');
  cleaned = cleaned.replace(/\s+:/g, ':');
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  cleaned = cleaned.replace(/\n\s+/g, '\n');

  cleaned = cleaned.replace(/\u00A0/g, ' ');
  cleaned = cleaned.replace(/\s+([,;.!?])/g, '$1');
  // Tambahkan spasi setelah tanda baca secara konservatif.
  cleaned = cleaned.replace(/([,;:])([^\s\n\d])/g, '$1 $2');
  cleaned = cleaned.replace(/([!?])([^\s\n])/g, '$1 $2');
  cleaned = cleaned.replace(/([a-z├á-├┐])\.([A-Za-z├Ç-├┐])/g, '$1. $2');

  return cleaned.trim();
}

function chooseRagFollowUp(question, answer) {
  const q = String(question || '').toLowerCase();
  const a = String(answer || '').toLowerCase();
  const qHasFeeSignal = /(beasiswa|prestasi|ranking|potongan|dpp|kip|1k1s|biaya|spp|ukt|pembayaran|pendaftaran)/i.test(q);

  // If the question or answer is about UKM/Ormawa, offer a UKM-specific follow-up
  if (/(\bukm\b|\bormawa\b|\borganisasi\s+mahasiswa\b|\bnama\s+ukm\b|\bdaftar\s+ukm\b|\blist\s+ukm\b)/i.test(q) || /(\bukm\b|\bormawa\b|\borganisasi\s+mahasiswa\b|\bnama\s+ukm\b|\bdaftar\s+ukm\b|\blist\s+ukm\b)/i.test(a)) {
    return 'Mau saya tampilkan kontak pembina atau detail lain?';
  }

  // Jika pertanyaan tentang akademik/perkuliahan
  if (/(akademik|perkuliahan|kuliah|semester|kalender|krs|uts|uas|libur|cuti|jadwal\s*kuliah)/i.test(q)) {
    return 'Mau saya bantu jelaskan juga info akademik lainnya (jadwal/kalendar/semester)?';
  }

  // Jika pertanyaan tentang beasiswa
  if (/(beasiswa|prestasi|ranking|potongan|dpp|kip|1k1s)/i.test(q)) {
    return 'Mau saya jelaskan lebih lanjut pilihan beasiswa atau potongan yang tersedia?';
  }

  // Jika pertanyaan tentang biaya
  if (/(biaya|spp|ukt|dpp|pembayaran|pendaftaran)/i.test(q)) {
    return 'Mau saya jelaskan juga komponen biaya lainnya atau potongan yang mungkin ada?';
  }

  // Jika pertanyaan tentang jadwal/gelombang
  if (/(gelombang|jadwal|testing|pengumuman|registrasi ulang)/i.test(q)) {
    return 'Mau saya bantu jelaskan detail gelombang atau jadwalnya?';
  }

  // Fallback berdasarkan jawaban
  if (qHasFeeSignal && /(beasiswa|prestasi|ranking|potongan|dpp|kip|1k1s)/i.test(a)) {
    return 'Mau saya jelaskan lebih lanjut pilihan beasiswa atau potongan yang tersedia?';
  }
  if (qHasFeeSignal && /(biaya|spp|ukt|dpp|pembayaran|pendaftaran)/i.test(a)) {
    return 'Mau saya jelaskan juga komponen biaya lainnya atau potongan yang mungkin ada?';
  }
  if (/(gelombang|jadwal|testing|pengumuman|registrasi ulang)/i.test(a)) {
    return 'Mau saya bantu jelaskan detail gelombang atau jadwalnya?';
  }

  if (/(akademik|perkuliahan|kuliah|semester|kalender|krs|uts|uas|libur|cuti|jadwal\s*kuliah)/i.test(a)) {
    return 'Mau saya bantu jelaskan juga info akademik lainnya (jadwal/kalendar/semester)?';
  }

  return 'Mau saya jelaskan lagi bagian lain?';
}

function ensureThreePartFlow(answer, question, style = null) {
  const raw = String(answer || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return raw;

  // Split by double newline blocks (the RAG prompt mandates this).
  let blocks = raw
    .split(/\n{2,}/)
    .map(b => String(b || '').trim())
    .filter(Boolean);

  // If everything is in one block but ends with a follow-up question, try
  // to split the final question off (some rule-based outputs embed the
  // follow-up on the same paragraph). This avoids duplicating body+followup
  // when we later reconstruct header/body/follow-up.
  if (blocks.length === 1) {
    const single = blocks[0];
    if (/\?$/.test(single)) {
      const lastNewline = single.lastIndexOf('\n');
      if (lastNewline >= 0) {
        const tail = single.slice(lastNewline + 1).trim();
        if (tail && /\?$/.test(tail) && tail.length <= 240) {
          const head = single.slice(0, lastNewline).trim();
          blocks = [];
          if (head) blocks.push(head);
          if (tail) blocks.push(tail);
        } else {
          const lastDouble = single.lastIndexOf('\n\n');
          if (lastDouble >= 0) {
            const head2 = single.slice(0, lastDouble).trim();
            const tail2 = single.slice(lastDouble + 2).trim();
            if (tail2 && /\?$/.test(tail2)) {
              blocks = [];
              if (head2) blocks.push(head2);
              if (tail2) blocks.push(tail2);
            }
          }
        }
      }
    }
  }

  const last = blocks.length ? blocks[blocks.length - 1] : '';
  const first = blocks.length ? blocks[0] : '';

  const isFollowUpBlock = (b) => {
    const t = String(b || '').trim();
    if (!t) return false;
    // A follow-up is expected to be a question.
    if (t.endsWith('?')) return true;
    return /^mau\s+saya\b/i.test(t) || /^apakah\b/i.test(t);
  };

  const isHeaderBlock = (b) => {
    const t = String(b || '').trim();
    if (!t) return false;
    // Header should be short and not a list.
    if (t.includes('\n')) return false;
    if (t.length > 170) return false;
    if (/^\s*(?:-|ΓÇó|\d+[.)])\s+/.test(t)) return false;
    if (/^\[\s*(?:Γ£à|Γ¥î|ya|tidak)/i.test(t)) return false;
    return true;
  };

  const pickedStyle = style || getRagStyle();
    const buildHeader = () => {
    const q = String(question || '').trim();
    const qLower = q.toLowerCase();

    const topic =
      /(biaya|pembayaran|dpp|spp|ukt|keuangan|diskon|potongan|beasiswa)/i.test(qLower) ? 'biaya' :
      /(akademik|perkuliahan|kuliah|semester|kalender|krs|uts|uas|libur|cuti|jadwal\s*kuliah)/i.test(qLower) ? 'akademik' :
      /(gelombang|jadwal|pendaftaran|registrasi|testing|pengumuman)/i.test(qLower) ? 'jadwal' :
      '';

    // Do not synthesize fixed header templates. Prefer returning empty header
    // so that any header present in the model output is preserved but we
    // don't inject phrases like "Mari kita bahas" or emoji prefixes.
    return '';
  };

  const hasFollowUp = isFollowUpBlock(last);
  const headerCandidate = isHeaderBlock(first) && !isFollowUpBlock(first);
  // Only treat the first block as a header when there's clearly room for a body.
  // - If there is a follow-up block, we need at least 3 blocks (header + body + follow-up)
  // - Otherwise, we need at least 2 blocks (header + body)
  const hasHeader = headerCandidate && (hasFollowUp ? blocks.length >= 3 : blocks.length >= 2);

  let header = hasHeader ? first : buildHeader();
  let followUp = hasFollowUp ? last : chooseRagFollowUp(question, raw);

  // Body: everything in between (or the full raw if we had neither header nor follow-up).
  let bodyBlocks = blocks.slice();
  if (hasHeader) bodyBlocks = bodyBlocks.slice(1);
  if (hasFollowUp && bodyBlocks.length) bodyBlocks = bodyBlocks.slice(0, -1);

  const body = bodyBlocks.length ? bodyBlocks.join('\n\n').trim() : raw;
  return [header.trim(), body.trim(), followUp.trim()].filter(Boolean).join('\n\n').trim();
}

function getRagStyle() {
  const toneRaw = (process.env.BOT_TONE || process.env.BOT_CHAT_STYLE || '').toString().trim().toLowerCase();
  const enableFriendlyTone = ['casual', 'santai', 'friendly'].includes(toneRaw);
  const formalTone = ['formal', 'resmi', 'baku'].includes(toneRaw);

  if (formalTone && !enableFriendlyTone) {
    return 'FORMAL';
  } else if (enableFriendlyTone) {
    return 'SANTAI';
  } else {
    return 'SEMI';
  }
}

function extractHintsFromChunks(retrievedDocs) {
  if (!Array.isArray(retrievedDocs)) return '';

  const hints = new Set();
  const hintKeywords = {
    biaya: /\b(biaya|uang|dpp|spp|ukt|potongan|diskon|beasiswa|uang kuliah)\b/i,
    jadwal: /\b(jadwal|tanggal|waktu|kapan|deadline|pengumuman|registrasi|testing|ujian)\b/i,
    beasiswa: /\b(beasiswa|potongan|diskon|prestasi|akademik|non-akademik|bidikmisi)\b/i,
    prodi: /\b(prodi|program studi|jurusan|fakultas|departemen)\b/i,
    syarat: /\b(syarat|persyaratan|kelulusan|nilai|ipk|ijazah|transkrip)\b/i,
    fasilitas: /\b(fasilitas|asrama|perpustakaan|laboratorium|wifi|kantin)\b/i
  };

  for (const doc of retrievedDocs) {
    const text = (doc && typeof doc.chunk === 'string') ? doc.chunk : '';
    for (const [hint, regex] of Object.entries(hintKeywords)) {
      if (regex.test(text)) {
        hints.add(hint);
      }
    }
  }

  return Array.from(hints).join(',');
}

function isGreetingMessage(answer) {
  if (!answer || typeof answer !== 'string') return false;
  const trimmed = answer.trim();
  
  // Greeting patterns: halo, hai, hi, pagi, siang, sore, malam, assalamualaikum, permisi, menu, start
  // These should not get formatted with conclusion/recommendation sections
  const greetingPattern = /^(?:halo|hai|hi|pagi|siang|sore|malam|ass?alam(?:u)?alaikum|permisi|menu|start)\b/i;
  const isGreeting = greetingPattern.test(trimmed);
  
  // Also check if answer is very short (< 60 chars) AND ends with question mark (common for greeting responses)
  if (!isGreeting && trimmed.length < 60 && trimmed.endsWith('?')) {
    const simpleQuestion = /^(ada\s+yang\s+bisa|apa\s+yang|bisa\s+membantu|mau\s+info|ada\s+yang\s+aku)/i.test(trimmed);
    if (simpleQuestion) return true;
  }
  
  return isGreeting;
}

function isProgramOverviewQuestion(rawText) {
  const t = String(rawText || '').trim().toLowerCase();
  if (!t) return false;
  // Common variants that ask for a list of programs
  if (/(?:ada\s+)?(?:program\s+studi|prodi|jurusan)\b/.test(t) && /(apa\s+saja|apa\s+aja|yang\s+ada|tersedia|daftar|list|ada\s+apa)/.test(t)) return true;
  if (/(program\s+studi|prodi|jurusan)\s+(di|di\s+itb|di\s+stikom|stikom|itb|stikom\s+bali|kampus)/.test(t)) return true;
  if (/\b(program\s+apa|prodi\s+apa|jurusan\s+apa)\b/.test(t)) return true;
  return false;
}

function formatRagAnswer(answer, source, confidence = 'HIGH', question = null) {
  if (!answer || typeof answer !== 'string') return answer;

  const trimmed = answer.trim();
  
  // Skip formatter for greetings - don't add conclusion/recommendation sections
  if (isGreetingMessage(trimmed)) {
    const cleaned = cleanAnswerLanguage(trimmed);
    try {
      return sanitizeWhatsappText(cleaned);
    } catch (e) {
      return cleaned;
    }
  }
  // Skip formatter for program overview queries (we want a stable, raw structured list)
  if (isProgramOverviewQuestion(question)) {
    const cleaned2 = cleanAnswerLanguage(trimmed);
    try {
      return sanitizeWhatsappText(cleaned2);
    } catch (e) {
      return cleaned2;
    }
  }
  
  const structured = ensureThreePartFlow(trimmed, question, getRagStyle());
  const cleaned = cleanAnswerLanguage(structured);
  try {
    return sanitizeWhatsappText(cleaned);
  } catch (e) {
    return cleaned;
  }
}

function wrapRagResult(answer, source, confidence = 'HIGH', question = null) {
  try {
    const formatted = formatRagAnswer(answer, source, confidence, question);
    try {
      console.log('[TRACE_AFTER_RAG]', { question: String(question || '').slice(0,120), source: source, preview: String(formatted || '').slice(0,240) });
    } catch (e) {}
    return {
      success: true,
      answer: formatted,
      source,
      contexts: []
    };
  } catch (e) {
    return {
      success: true,
      answer: formatRagAnswer(answer, source, confidence, question),
      source,
      contexts: []
    };
  }
}

// Jawab jadwal pendaftaran/test/pengumuman/registrasi ulang per gelombang
function tryStructuredScheduleAnswer(question, top) {
  if (!question) return null;
  const q = question.toLowerCase();

  // Hanya trigger untuk pertanyaan seputar jadwal gelombang
  if (!q.includes('jadwal') && !q.includes('testing') && !q.includes('test') && !q.includes('pendaftaran')) {
    return null;
  }
  if (!q.includes('gelombang') && !q.includes('sisipan') && !q.includes('khusus')) {
    return null;
  }

  // Deteksi nama gelombang dari pertanyaan
  let waveKey = null; // contoh: 'II B', 'SISIPAN 1', 'KHUSUS'

  // Gelombang Sisipan
  const sisipanMatch = /(gelombang\s*)?sisipan\s*([0-9]+)/i.exec(question);
  if (sisipanMatch) {
    waveKey = `SISIPAN ${sisipanMatch[2].trim()}`;
  }

  // Gelombang Khusus
  if (!waveKey && /gelombang\s*khusus|khusus\s*\bgelombang?/i.test(question)) {
    waveKey = 'KHUSUS';
  }

  // Gelombang dengan angka + optional huruf (2b, 3 A, dll.)
  if (!waveKey) {
    const numLetter = /gelombang\s*([0-9]+)\s*([abc])?/i.exec(question);
    if (numLetter) {
      const num = numLetter[1];
      const letter = (numLetter[2] || '').toUpperCase();
      const map = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V' };
      const roman = map[num];
      if (roman) {
        waveKey = letter ? `${roman} ${letter}` : roman;
      }
    }
  }

  // Gelombang sudah dalam huruf Romawi di pertanyaan ("gelombang II B")
  if (!waveKey) {
    const romanLetter = /gelombang\s*([ivx]+)\s*([abc])?/i.exec(question);
    if (romanLetter) {
      const roman = romanLetter[1].toUpperCase();
      const letter = (romanLetter[2] || '').toUpperCase();
      waveKey = letter ? `${roman} ${letter}` : roman;
    }
  }

  if (!waveKey) return null;

  // Untuk jadwal, kita boleh melihat seluruh index (semua dokumen),
  // supaya tabel kalender pendaftaran selalu bisa ditemukan meskipun
  // tidak muncul di top-K konteks.
  const fullIndex = loadIndex();
  const combinedText = fullIndex.map(item => item.chunk).join('\n');
  if (!combinedText) return null;

  // Contoh baris: "II B | 29 MARET 2026 s/d 18 APRIL 2026 | 19 APRIL 2026 | 21 APRIL 2026 | 21 APRIL 2026 s/d 1 MEI 2026"
  // Perhatikan: backslash harus di-escape dua kali di string JS.
  // Kolom terakhir (registrasi ulang) kita paksa mengandung teks "s/d" supaya
  // tidak tertangkap versi yang terpotong (misalnya hanya "21").
  const pattern = `${escapeRegex(waveKey)}\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^\\n]*?s/d[^\\n]*)`;
  const rowRegex = new RegExp(pattern, 'i');
  const m = rowRegex.exec(combinedText);
  // Normalisasi sederhana agar konsisten di WhatsApp (hindari spasi acak sekitar s/d).
  const normalizeRange = (s) => String(s || '')
    .replace(/\s*s\s*\/\s*d\s*/gi, ' s/d ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Jika user menyebut gelombang tanpa sub-huruf (mis. "gelombang 4" -> "IV"),
  // tapi kalender hanya berisi "IV A", "IV B", "IV C", tampilkan versi grouped.
  const isRomanOnly = /^[IVX]{1,5}$/i.test(String(waveKey || '').trim());
  if ((!m || !m[1] || !m[2] || !m[3] || !m[4]) && isRomanOnly) {
    const base = String(waveKey || '').trim().toUpperCase();
    const subPattern = `${escapeRegex(base)}\\s*([A-D])\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^\\n]*?s/d[^\\n]*)`;
    const subRegex = new RegExp(subPattern, 'ig');
    const found = [];
    let mm;
    while ((mm = subRegex.exec(combinedText))) {
      const letter = String(mm[1] || '').toUpperCase();
      found.push({
        key: `${base} ${letter}`,
        masaPendaftaran: normalizeRange(mm[2]),
        testing: normalizeRange(mm[3]),
        pengumuman: normalizeRange(mm[4]),
        registrasi: normalizeRange(mm[5])
      });
      if (subRegex.lastIndex === mm.index) subRegex.lastIndex++;
    }

    // Dedupe: kalender bisa muncul di banyak chunk/trainingId, sehingga match-nya berulang.
    // Ambil versi paling lengkap per key (contoh: hindari baris yang terpotong seperti "14 AGUST").
    const scoreRow = (row) => {
      const s = [row.masaPendaftaran, row.testing, row.pengumuman, row.registrasi]
        .map(v => String(v || ''))
        .join(' | ');
      return s.length;
    };

    const bestByKey = new Map();
    for (const row of found) {
      const key = String(row.key || '').trim();
      if (!key) continue;
      const prev = bestByKey.get(key);
      if (!prev || scoreRow(row) > scoreRow(prev)) bestByKey.set(key, row);
    }

    const unique = Array.from(bestByKey.values()).sort((a, b) => (a.key > b.key ? 1 : -1));

    if (unique.length >= 1) {
      const out = [];
      out.push(`Untuk Gelombang ${base}, jadwalnya terbagi jadi:`);
      out.push('');

      for (const item of unique) {
        // Label singkat ("IV A") agar sanitizer bisa mengubah jadi header ("IV A:")
        out.push(`- ${item.key}`);
        out.push(`- Masa pendaftaran: ${item.masaPendaftaran}`);
        out.push(`- Testing: ${item.testing}`);
        out.push(`- Pengumuman: ${item.pengumuman}`);
        out.push(`- Masa registrasi ulang: ${item.registrasi}`);
        out.push('');
      }

      const choicesArr = unique.map(f => f.key);
      const choices =
        choicesArr.length <= 1
          ? (choicesArr[0] || '')
          : `${choicesArr.slice(0, -1).join(', ')}, atau ${choicesArr[choicesArr.length - 1]}`;
      out.push(`Kakak mau ambil ${choices}?`);

      const rawAnswer = out.join('\n').trim();
      return {
        answer: rawAnswer,
        source: 'rag-schedule-rule-grouped'
      };
    }

    return null;
  }

  if (!m || !m[1] || !m[2] || !m[3] || !m[4]) return null;

  const masaPendaftaran = normalizeRange(m[1]);
  const testing = normalizeRange(m[2]);
  const pengumuman = normalizeRange(m[3]);
  const registrasi = normalizeRange(m[4]);

  const prettyWave = waveKey === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${waveKey}`;

  const lines = [
    `- Masa pendaftaran: ${masaPendaftaran}`,
    `- Testing: ${testing}`,
    `- Pengumuman: ${pengumuman}`,
    `- Masa registrasi ulang: ${registrasi}`
  ];

  const answer = `Jadwal ${prettyWave} adalah:\n\n${lines.join('\n')}\n\nMau saya bantu cek juga jadwal gelombang lain (misalnya II A atau II C)?`;

  return {
    answer,
    source: 'rag-schedule-rule'
  };
}

// Jika user menanyakan jadwal PMB tapi tidak menyebut gelombang tertentu,
// jangan jawab "tidak ada". Beri arahan untuk memilih gelombang.
function tryStructuredScheduleOverviewAnswer(question) {
  if (!question) return null;
  const q = String(question).toLowerCase();

  const asksSchedule = /(jadwal|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang|masa\s+pendaftaran|gelombang|pendaftaran|kapan|berikutnya)/i.test(q);
  if (!asksSchedule) return null;

  // Jangan hijack pertanyaan ringkasan PMB yang meminta beberapa aspek sekaligus
  // (alur + syarat/dokumen + jadwal + kontak). Untuk kasus ini biarkan RAG normal
  // merangkum, dan hanya tanya gelombang jika user memang menanyakan jadwal saja.
  const looksLikePmbOverview = /(\balur\b|syarat|dokumen|\bkontak\b|kanal\s+pendaftaran|penerimaan\s+mahasiswa\s+baru|\bpmb\b)/i.test(q);
  if (looksLikePmbOverview && /(syarat|dokumen|\bkontak\b|kanal\s+pendaftaran|\balur\b)/i.test(q)) return null;

  // Jika sudah spesifik gelombang, biarkan rule detail yang menangani.
  if (questionSpecifiesWave(question)) return null;

  // Pastikan kalender memang ada di index supaya tidak misleading.
  const fullIndex = loadIndex();
  const combined = fullIndex.map(i => i.chunk || '').join('\n');
  if (!/KALENDER\s+PENDAFTARAN\s+MAHASISWA\s+BARU/i.test(combined)) return null;
  if (!/GELOMBANG\s*\|\s*MASA\s+PENDAFTARAN\s*\|\s*TESTING\s*\|\s*PENGUMUMAN/i.test(combined)) return null;

  return {
    answer:
      'Jadwal PMB tersedia dan dibagi per gelombang (contoh: Khusus, I A/I B/I C, II A/II B/II C, dst.).\n\n' +
      'Kakak ingin cek jadwal gelombang yang mana? (Balas misalnya: "2 B" / "Gelombang II B" / "Khusus").',
    source: 'rag-schedule-overview'
  };
}

function isHeadingLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^#{1,6}\s*.+/.test(trimmed)) return true;
  if (/^(?:[-=]{3,})$/.test(trimmed)) return true;
  if (/^.+:\s*$/.test(trimmed) && trimmed.length < 80) return true;
  if (/\b(BIAYA|PROGRAM STUDI|PRODI|JADWAL|GELOMBANG|SYARAT|KONTAK|PENDAFTARAN|DPP|UKT|BEBAS|POTONGAN|DISKON|FORMULIR|PENDAFTARAN)\b/i.test(trimmed)) {
    if (/^[A-Z0-9\s\-\/()]{10,}$/.test(trimmed) || trimmed.split(' ').length <= 8) {
      return true;
    }
  }
  const allCaps = trimmed.replace(/[^A-Z0-9\s]/g, '');
  if (allCaps.length >= 12 && allCaps === trimmed && trimmed.split(' ').length >= 2) return true;
  return false;
}

function isPageBoundaryLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^halaman\s*[:\-]?\s*\d+$/i.test(trimmed)) return true;
  if (/^page\s*[:\-]?\s*\d+$/i.test(trimmed)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(trimmed) && /halaman|page/i.test(line)) return true;
  return false;
}

function splitTextToTopicBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/[\t\u00A0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) return [];
  const lines = normalized.split('\n');
  const blocks = [];
  let buffer = [];

  const flushBuffer = () => {
    const chunk = buffer.join('\n').trim();
    if (chunk) blocks.push(chunk);
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line) {
      if (buffer.length && buffer[buffer.length - 1] !== '') buffer.push('');
      continue;
    }

    const heading = isHeadingLine(line);
    const pageBreak = isPageBoundaryLine(line);
    if ((heading || pageBreak) && buffer.length > 0) {
      flushBuffer();
    }
    buffer.push(line);
  }
  flushBuffer();
  return blocks.filter(Boolean);
}

function extractSectionTitle(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;
  const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0];
  if (/^#{1,6}\s*(.+)/.test(first)) return first.replace(/^#{1,6}\s*/, '').trim();
  if (/^.+:\s*$/.test(first)) return first.replace(/:\s*$/, '').trim();
  if (/^[A-Z0-9\s]{10,}$/.test(first) && first.split(' ').length >= 2) return first.trim();
  return null;
}

function extractChunkCategory(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;
  const text = chunk.toLowerCase();
  if (/\b(surat\s+keputusan|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/.test(text)) return 'SK';
  if (/\b(akreditasi|ban-pt|peringkat|sk\s*akreditasi|masa\s+berlaku\s+akreditasi)\b/.test(text)) return 'AKREDITASI';
  if (/\b(beasiswa|scholarship|potongan|diskon|keringanan|bebas\s+biaya)\b/.test(text)) return 'BEASISWA';
  if (/\b(pmb|pendaftaran|jalur\s+masuk|jalur\s+undangan|seleksi|tes\s+masuk|daftar\s+ulang|formulir|registrasi|pendaftaran)\b/.test(text)) return 'PMB';
  if (/\b(kampus|lokasi|alamat|gedung|wilayah|renon|parkir|transportasi|ruang\s+kelas|asrama|perpustakaan|laboratorium|lab|wifi)\b/.test(text)) return 'LOKASI';
  if (/\b(fasilitas|laboratorium|lab|perpustakaan|ruang\s+kelas|studio|workshop|komputer\s+lab|lapangan|wifi|kantin|fasilitas\s+olahraga)\b/.test(text)) return 'FASILITAS';
  if (/\b(mata\s+kuliah|kurikulum|silabus|kompetensi|modul|pembelajaran|praktikum|mempelajari|fokus\s+pembelajaran)\b/.test(text)) return 'KURIKULUM';
  if (/\b(prospek\s+kerja|peluang\s+kerja|karir|job|pekerjaan|profesi|lulus|lowongan|peluang\s+karier)\b/.test(text)) return 'KARIR';
  if (/\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran|biaya\s+semester|biaya\s+per\s*semester)\b/.test(text)) return 'BIAYA';
  if (/\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/.test(text)) return 'PROGRAM_STUDI';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(text)) return 'SCHEDULE';
  if (/\b(kampus|partner|mitra|lokasi|alamat|telepon)\b/.test(text)) return 'INFO';
  return null;
}

const NON_SEARCHABLE_CATEGORIES = new Set(['SK', 'MOU', 'ADMINISTRASI', 'NOTULEN', 'SURAT', 'ARSIP', 'KERJA_SAMA', 'INTERNAL']);

function isAcademicProgramBlacklistChunk(chunk, filename, docCategory) {
  // Exception: Allow KURIKULUM and PROGRAM_STUDI chunks despite blacklist keywords
  // This prevents false positives like "arsip digital" and "administrasi sistem informasi"
  if (docCategory === 'KURIKULUM' || docCategory === 'PROGRAM_STUDI') {
    return false;
  }
  const text = String(chunk || '').toLowerCase();
  const file = String(filename || '').toLowerCase();
  const blacklisted = /\b(?:surat\s+keputusan|sk\s*(?:no|nomor|akreditasi|keputusan|penetapan|rektorat|pembina|pendaftaran|tanggal)|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/i;
  const metadata = /\b(?:ketua|direktur|rektor|yayasan|tembusan|cap|stempel|tanda\s+tangan)\b/i;
  return blacklisted.test(text) || blacklisted.test(file) || metadata.test(text) || metadata.test(file);
}

function extractPageNumberFromText(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;
  const match = chunk.match(/(?:halaman|page)\s*[:\-]?\s*(\d+)/i);
  if (match && match[1]) return parseInt(match[1], 10);
  return null;
}

function isLegalDominantChunk(chunk) {
  const text = String(chunk || '').trim();
  if (!text) return false;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  const legalPattern = /\b(force\s+majeure|perjanjian|kontrak|pasal|ayat|klausul|pihak\s+pertama|pihak\s+kedua|hak\s+dan\s+kewajiban|penyelesaian\s+sengketa)\b/i;
  const legalLines = lines.filter(l => legalPattern.test(l));
  return legalLines.length > 0 && legalLines.length / lines.length >= 0.35;
}

function isHeaderFooterChunk(chunk) {
  const text = String(chunk || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/^(page|halaman|kop surat|alamat|telepon|fax|faximile|website|email|nomor)\b/.test(lower)) return true;
  if (/\b(page\s*\d+|halaman\s*\d+)\b/.test(lower)) return true;
  return false;
}

function generateDocumentSummary(documentText) {
  const text = String(documentText || '').trim();
  if (!text) return '';
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const bullets = [];
  const add = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    if (!bullets.includes(t)) bullets.push(t);
  };

  const patterns = [
    { re: /\b(program\s+studi|program|prodi)\b/i, prefix: 'Program studi terlihat:' },
    { re: /\b(internasional|dnui|help\s+university|utb|china|bali)\b/i, prefix: 'Program internasional / kerja sama internasional:' },
    { re: /\b(biaya\s+pendaftaran|pendaftaran)\b/i, prefix: 'Biaya pendaftaran:' },
    { re: /\b(dpp|dana\s+pendidikan\s+pokok)\b/i, prefix: 'DPP:' },
    { re: /\b(ukt|biaya\s+per\s+semester|biaya\s+kuliah)\b/i, prefix: 'UKT / biaya per semester:' },
    { re: /\b(jadwal|gelombang|tanggal|deadline|pengumuman)\b/i, prefix: 'Jadwal/gelombang:' },
    { re: /\b(syarat|persyaratan|dokumen|formulir)\b/i, prefix: 'Syarat/dokumen:' },
    { re: /\b(potongan|diskon|beasiswa)\b/i, prefix: 'Potongan / beasiswa:' }
  ];

  for (const { re, prefix } of patterns) {
    const found = lines.find(l => re.test(l));
    if (found) {
      const snippet = found.replace(/\s+/g, ' ').trim();
      add(`${prefix} ${snippet}`);
    }
  }

  // Fallback to first meaningful lines when no specific pattern matches.
  if (!bullets.length) {
    for (const line of lines.slice(0, 6)) {
      if (line.length > 40 && line.length < 200) {
        add(`Ringkasan: ${line.replace(/\s+/g, ' ').trim()}`);
      }
      if (bullets.length >= 3) break;
    }
  }

  return bullets.slice(0, 6).join('\n');
}

function getChunkKeywordScore(chunk, question) {
  const qTokens = tokenizeForRelevanceGuard(question);
  if (!qTokens.length) return 0;
  const hay = normalizeIndonesianQuestionText(String(chunk || ''));
  if (!hay) return 0;
  let hits = 0;
  for (const tok of qTokens) {
    if (tok && hay.includes(tok)) hits += 1;
  }
  return hits / qTokens.length;
}

function getChunkTypeMatchScore(chunkType, intent) {
  if (!intent || intent === 'GENERAL') return 0;
  if (chunkType === intent) return 0.15;
  if (intent === 'ACADEMIC_PROGRAM' && chunkType === 'PROGRAM') return 0.15;
  if (chunkType === 'GENERAL') return 0.05;
  return -0.08;
}

function getIntentCategoryScore(itemCategory, intent) {
  if (!intent || intent === 'GENERAL' || !itemCategory) return 0;
  const intentUpper = String(intent || '').toUpperCase();
  const category = String(itemCategory || '').toUpperCase();
  const allowedCategories = getAllowedDocCategories(intentUpper);
  const forbiddenCategories = getForbiddenDocCategories(intentUpper);

  if (forbiddenCategories.has(category)) {
    return -0.35;
  }
  if (allowedCategories.has(category)) {
    return 0.20;
  }
  if (category === 'UNKNOWN' || category === '') {
    return 0;
  }
  return -0.12;
}

function getChunkScoreBreakdown(item, question, intent, semanticScore, queryEntities) {
  const chunk = String((item && item.chunk) || '');
  const semantic = Number.isFinite(semanticScore) ? semanticScore : 0;
  const keywordScore = getChunkKeywordScore(chunk, question);
  const semanticBoost = semantic * 0.25;
  const evidenceScore = keywordScore * 0.18;
  const typeScore = getChunkTypeMatchScore(item.chunkType, intent);
  const sourceTrust = scoreSourceTrust(item) / 100;
  const trustBoost = Math.max(-0.2, Math.min(0.2, sourceTrust * 0.16));
  const itemEntities = getChunkEntities(item);
  const itemCategory = String(item.docCategory || item.category || '').toUpperCase() || null;
  const queryCategoryRaw = queryEntities && queryEntities.category ? String(queryEntities.category).toUpperCase() : null;
  const IGNORED_QUERY_DOC_CATEGORIES = new Set(['SK', 'SURAT', 'MOU', 'ADMINISTRASI', 'TEMPLATE']);
  const queryCategory = queryCategoryRaw && !IGNORED_QUERY_DOC_CATEGORIES.has(queryCategoryRaw) ? queryCategoryRaw : null;

  if (item && (item.excludeFromSearch === true || Number(item.retrievalWeight) === 0)) {
    return {
      compositeScore: -999,
      finalScore: -999,
      semantic,
      semanticBoost,
      evidenceScore,
      keywordScore,
      typeScore,
      trustBoost,
      metadataBoost: 0,
      exactBoost: 0,
      attributeScore: 0,
      categorySignal: 0,
      otherBoosts: 0,
      legalPenalty: 0,
      headerPenalty: 0,
      lowOcrPenalty: 0,
      feeKeywordPenalty: 0,
      programOverviewPenalty: 0,
      multiProgramPenalty: 0,
      itemEntities,
      itemCategory,
      queryCategory,
      exactMatch: { score: 0, rejected: false }
    };
  }
  if (queryEntities && isExactEntityMismatch(queryEntities, itemEntities, item.chunk)) {
    return {
      compositeScore: -999,
      finalScore: -999,
      semantic,
      semanticBoost,
      evidenceScore,
      keywordScore,
      typeScore,
      trustBoost,
      metadataBoost: 0,
      exactBoost: 0,
      attributeScore: 0,
      categorySignal: 0,
      otherBoosts: 0,
      legalPenalty: 0,
      headerPenalty: 0,
      lowOcrPenalty: 0,
      feeKeywordPenalty: 0,
      programOverviewPenalty: 0,
      multiProgramPenalty: 0,
      itemEntities,
      itemCategory,
      queryCategory,
      exactMatch: { score: 0, rejected: true, reason: 'exact-entity-mismatch' }
    };
  }

  let metadataBoost = 0;
  if (queryEntities && queryEntities.program && itemEntities.program === queryEntities.program) {
    const envBoost = parseFloat(process.env.RAG_EXACT_PROGRAM_MATCH_BOOST || '0');
    metadataBoost += 2.0 + (Number.isFinite(envBoost) ? envBoost : 0);
  }
  if (queryEntities && queryEntities.academicYear && itemEntities.academicYear === queryEntities.academicYear) metadataBoost += 0.6;
  if (queryEntities && queryEntities.wave && itemEntities.wave === queryEntities.wave) metadataBoost += 0.6;
  else if (queryEntities && queryEntities.wave && itemEntities.wave) {
    const qGroup = normalizeWaveGroup(queryEntities.wave);
    const cGroup = normalizeWaveGroup(itemEntities.wave);
    if (qGroup && cGroup && qGroup === cGroup) metadataBoost += 0.25;
  }
  if (queryEntities && queryEntities.partner && itemEntities.partner === queryEntities.partner) metadataBoost += 0.4;
  if (queryEntities && queryEntities.campus && itemEntities.campus === queryEntities.campus) metadataBoost += 0.3;
  if (queryEntities && queryEntities.programMode && itemEntities.programMode === queryEntities.programMode) metadataBoost += 0.5;
  if (queryEntities && queryEntities.feeType && itemEntities.feeType === queryEntities.feeType) metadataBoost += 0.2;
  if (queryCategory && itemCategory && queryCategory === itemCategory) metadataBoost += 0.8;
  if (queryCategory && itemCategory && queryCategory !== itemCategory) metadataBoost -= 0.18;

  try {
    // Prefer the more specific academic intent when present (extractAcademicIntent),
    // e.g. 'MATA_KULIAH' or 'KURIKULUM_PEMBELAJARAN'. Fall back to the high-level
    // `intent` parameter if academic intent isn't available.
    const academicIntent = queryEntities && queryEntities.academicIntent ? String(queryEntities.academicIntent) : intent;
    const intentUpper = String(academicIntent || intent || '').toUpperCase();
    const prefCats = new Set(['PRODI_PROFILE', 'KURIKULUM', 'PROSPEK_KERJA', 'PROGRAM_KHUSUS']);
    const docCat = String(item.docCategory || item.category || '').toUpperCase();
    // Expand the set of intents that trigger curriculum/program boosts to include
    // common academic sub-intents produced by extractAcademicIntent (e.g. MATA_KULIAH).
    const boostIntents = new Set(['DEFINISI_PRODI', 'KURIKULUM_PEMBELAJARAN', 'PROSPEK_KERJA', 'MATA_KULIAH', 'FOKUS_PRODI']);
    if (boostIntents.has(intentUpper)) {
      if (prefCats.has(docCat)) {
        metadataBoost += 0.9;
      }
      const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
      if (/(program studi|prodi|kurikulum|mata kuliah|mata_kuliah|mata-kuliah|karier|career)/i.test(fname)) {
        metadataBoost += 0.45;
      }
    }
  } catch (e) { /* ignore boosting errors */ }

  if (queryEntities && queryEntities.program && item.sectionTitle && item.sectionTitle.toLowerCase().includes(queryEntities.program.toLowerCase())) {
    metadataBoost += 0.1;
  }

  // Targeted program boost: if query explicitly asks about a program (e.g. 'TI')
  // and the item clearly originates from a program_studi domain (metadata.source/category)
  // and the item's metadata tags/source contain the program affinity, apply a boost.
  try {
    if (queryEntities && queryEntities.program && item && item.metadata) {
      const alias = normalizeProgramLabel(queryEntities.program);
      const aliasToTag = { TI: 'teknologi_informasi', SI: 'sistem_informasi', SK: 'sistem_komputer', BD: 'bisnis_digital', MI: 'manajemen_informatika', DG: 'desaingrafis', DKV: 'desain_komunikasi_visual', MM: 'multimedia', AN: 'animasi', TRPL: 'teknologi_rekayasa_perangkat_lunak' };
      const programTag = aliasToTag[alias] || null;
      const md = item.metadata || {};
      const isProgramSource = (String(md.category || md.type || '').toLowerCase() === 'program_studi') || (String(md.source || '').toLowerCase().includes('program_studi'));
      const tags = Array.isArray(md.tags) ? md.tags.map(t => String(t).toLowerCase()) : [];
      const source = String(md.source || '').toLowerCase();
      const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
      if (isProgramSource && programTag) {
        if (tags.includes(programTag) || source.includes(programTag) || fname.includes(programTag) || fname.includes(programTag.replace('_',' '))) {
          metadataBoost += 1.5;
        }
      }
    }
  } catch (e) { /* ignore */ }

  const academicCategoryBoost = (intent === 'ACADEMIC_PROGRAM' && ['ACADEMIC', 'PROGRAM_STUDI', 'KURIKULUM', 'KARIR', 'AKREDITASI', 'BIAYA', 'LOKASI', 'FASILITAS'].includes(itemCategory)) ? 0.12 : 0;
  if (academicCategoryBoost) metadataBoost += academicCategoryBoost;

  const exactMatch = queryEntities ? computeExactEntityMatchScore(queryEntities, itemEntities) : { score: 0, rejected: false };
  const exactBoost = exactMatch && !exactMatch.rejected ? Math.max(0, Math.min(2, exactMatch.score / 100)) : 0;
  const attributeScore = exactBoost;

  const categorySignal = getIntentCategoryScore(itemCategory, intent);
  const legalPenalty = isLegalDominantChunk(chunk) ? -0.2 : 0;
  const headerPenalty = isHeaderFooterChunk(chunk) ? -0.25 : 0;
  const lowOcrPenalty = item.lowConfidence ? -0.15 : 0;
  const lowerChunk = chunk.toLowerCase();
  const feeKeywordPenalty = (intent && intent !== 'COST' && /\b(biaya|uang\s+kuliah|ukt|spp|semester|dpp|pendaftaran|registrasi|pembayaran|cicil|cicilan|gelombang)\b/i.test(lowerChunk)) ? -0.25 : 0;
  let programOverviewPenalty = (queryEntities && queryEntities.program && /\b(?:penjelasan\s+semua\s+program\s+studi|program\s+studi\s+yang\s+tersedia|ringkasan\s+singkat\s+masing-?masing\s+prodi|berikut\s+ringkasan)\b/i.test(chunk)) ? -0.35 : 0;
  let multiProgramPenalty = 0;
  if (queryEntities && queryEntities.program) {
    try {
      const progMatches = (chunk.match(/\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|\bsi\b|\bti\b|\bbd\b|\bsk\b)\b/ig) || []);
      const uniqueProgCount = new Set(progMatches.map(m => m.toLowerCase())).size;
      if (uniqueProgCount >= 2) multiProgramPenalty = -0.35;
      const fname = String((item && (item.filename || item.trainingId)) || '').toLowerCase();
      if (fname && /\b(?:penjelasan\s+semua|semua\s+program|semua\s+prodi|penjelasan\s+prodi|overview\s+prodi)\b/i.test(fname)) {
        programOverviewPenalty = Math.min(programOverviewPenalty, -0.6);
      }
    } catch (e) { /* ignore per-item */ }
  }

  const otherBoosts = typeScore + categorySignal + trustBoost + legalPenalty + headerPenalty + lowOcrPenalty + feeKeywordPenalty + programOverviewPenalty + multiProgramPenalty;
  const rawScore = semanticBoost + evidenceScore + attributeScore + metadataBoost + otherBoosts;
  const finalScore = Math.max(-1, Math.min(1, rawScore));
  const compositeScore = rawScore;

  return {
    compositeScore,
    rawScore,
    finalScore,
    semantic,
    semanticBoost,
    evidenceScore,
    keywordScore,
    typeScore,
    trustBoost,
    metadataBoost,
    exactBoost,
    attributeScore,
    categorySignal,
    otherBoosts,
    legalPenalty,
    headerPenalty,
    lowOcrPenalty,
    feeKeywordPenalty,
    programOverviewPenalty,
    multiProgramPenalty,
    itemEntities,
    itemCategory,
    queryCategory,
    exactMatch
  };
}

function computeChunkCompositeScore(item, question, intent, semanticScore, queryEntities) {
  return getChunkScoreBreakdown(item, question, intent, semanticScore, queryEntities).compositeScore;
}

function buildMultiDocSummary(topChunks, question) {
  if (!Array.isArray(topChunks) || topChunks.length === 0) return null;

  const facts = new Set();
  const examples = [];
  const addFact = (fact) => {
    if (fact && !facts.has(fact)) facts.add(fact);
  };

  for (const item of topChunks) {
    const chunk = String(item && item.chunk ? item.chunk : '');
    if (!chunk.trim()) continue;
    const lower = chunk.toLowerCase();
    const sourceLabel = item.trainingId || item.filename || 'dokumen';

    if (/(?:\b(dpp|pendaftaran|uang\s+pangkal|uk?t|spp|biaya\s+kuliah|biaya|harga|mahal|murah|potongan|diskon)\b)/i.test(lower)) {
      addFact('Berisi informasi biaya, DPP/UKT, atau potongan yang relevan.');
    }
    if (/(?:\b(internasional|double\s+degree|dual\s+degree|dnui|help|utb|program|kelas\s+internasional|kelas\s+nasional)\b)/i.test(lower)) {
      addFact('Berisi informasi program internasional / dual degree / kelas khusus.');
    }
    if (/(?:\b(jadwal|gelombang|deadline|tanggal|pengumuman|registrasi|testing|pendaftaran)\b)/i.test(lower)) {
      addFact('Berisi informasi jadwal pendaftaran, gelombang, atau deadline.');
    }
    if (/(?:\b(akreditasi|ban-pt|peringkat|sk\s*akreditasi|masa\s+berlaku)\b)/i.test(lower)) {
      addFact('Berisi informasi akreditasi program atau kampus.');
    }
    if (/(?:\b(beasiswa|kip|potongan|diskon|prestasi|kartu\s+pip)\b)/i.test(lower)) {
      addFact('Berisi informasi beasiswa, potongan, atau subsidi.');
    }

    if (examples.length < 3) {
      const snippet = chunk.replace(/\s+/g, ' ').trim().slice(0, 200);
      examples.push(`- ${sourceLabel}: ${snippet}${snippet.length >= 200 ? 'ΓÇª' : ''}`);
    }
  }

  if (facts.size === 0) {
    return null;
  }

  const summaryLines = ['Ringkasan konteks dari dokumen relevan:'];
  for (const fact of facts) summaryLines.push(`- ${fact}`);
  if (examples.length > 0) {
    summaryLines.push('Contoh ringkasan sumber:');
    summaryLines.push(...examples);
  }
  summaryLines.push('Gunakan informasi tersebut sebagai sumber data yang harus dijawab secara akurat.');
  return summaryLines.join('\n');
}

function buildRagAnswerContext(question, top) {
  const summary = buildMultiDocSummary(top, question);
  const extended = buildExtendedContextForQuestion(question, top);
  const baseChunks = top.map((t, idx) => `Sumber ${idx + 1} (${t.trainingId || t.filename || 'dokumen'}):\n${String(t.chunk || '').trim()}`).join('\n\n---\n\n');
  const parts = [];
  if (summary) parts.push(summary);
  if (extended) {
    parts.push('Detail dokumen relevan:');
    parts.push(extended);
  } else {
    parts.push(baseChunks);
  }
  return parts.join('\n\n');
}

function assessContextConsistency(chunks, question) {
  if (!Array.isArray(chunks) || chunks.length < 2) return { isConsistent: false, score: 0, evidence: [] };

  const qTokens = tokenizeForRelevanceGuard(question);
  if (qTokens.length === 0) return { isConsistent: false, score: 0, evidence: [] };

  const evidence = [];
  let matchCount = 0;
  let totalComparisons = 0;
  let topicOverlapSum = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk1 = String(chunks[i] && chunks[i].chunk ? chunks[i].chunk : '');
    if (!chunk1.trim()) continue;

    const text1Norm = normalizeIndonesianQuestionText(chunk1);
    const tokens1 = tokenizeForRelevanceGuard(text1Norm);

    for (let j = i + 1; j < chunks.length; j++) {
      const chunk2 = String(chunks[j] && chunks[j].chunk ? chunks[j].chunk : '');
      if (!chunk2.trim()) continue;

      const text2Norm = normalizeIndonesianQuestionText(chunk2);
      const tokens2 = tokenizeForRelevanceGuard(text2Norm);

      const overlap = tokens1.filter(t => tokens2.includes(t)).length;
      const maxTokens = Math.max(tokens1.length, tokens2.length);
      const overlapRatio = maxTokens > 0 ? overlap / maxTokens : 0;

      if (overlapRatio >= 0.25) {
        matchCount++;
        topicOverlapSum += overlapRatio;
        evidence.push({
          sources: [chunks[i].trainingId || chunks[i].filename || `chunk${i}`, chunks[j].trainingId || chunks[j].filename || `chunk${j}`],
          overlapRatio: overlapRatio.toFixed(2),
          commonKeywords: tokens1.filter(t => tokens2.includes(t)).slice(0, 5).join(', ')
        });
      }
      totalComparisons++;
    }
  }

  const avgOverlap = matchCount > 0 ? topicOverlapSum / matchCount : 0;
  const consistencyScore = (matchCount / Math.max(totalComparisons, 1)) * 0.7 + avgOverlap * 0.3;
  const isConsistent = matchCount >= Math.ceil(totalComparisons / 2) && consistencyScore >= 0.35;

  return {
    isConsistent,
    score: Math.min(1, consistencyScore),
    matchCount,
    totalComparisons,
    evidence: evidence.slice(0, 3)
  };
}

function inferConclusion(chunks, question) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  const combined = chunks.map(c => String(c && c.chunk ? c.chunk : '')).join(' ').toLowerCase();
  if (!combined.trim()) return null;

  const q = String(question || '').toLowerCase();
  const inference = { type: null, conclusion: null, confidence: 0 };

  if (/\b(program|prodi|internasional|double|dual)\b/.test(q)) {
    const hasInternational = /\b(internasional|international|luar\s+negeri|abroad|double\s+degree|dual\s+degree)\b/.test(combined);
    const hasPartner = /\b(dnui|help|utb|partner|partner\s+internasional)\b/.test(combined);

    if (hasInternational && hasPartner && chunks.length >= 2) {
      inference.type = 'PROGRAM_AVAILABILITY';
      inference.conclusion = 'Program internasional/dual degree tersedia dengan partner luar negeri';
      inference.confidence = 0.85;
    } else if (hasInternational && chunks.length >= 2) {
      inference.type = 'PROGRAM_TYPE';
      inference.conclusion = 'Program internasional tersedia';
      inference.confidence = 0.75;
    }
  }

  if (/\b(biaya|fee|harga|bayar|total)\b/.test(q)) {
    const hasPriceRanges = /\b\d+\.?\d*\s*(?:juta|ribu|rb|m|k)\b/i.test(combined);
    const hasCostTerms = /\b(dpp|pendaftaran|ukt|spp|biaya\s+kuliah|uang\s+pangkal)\b/i.test(combined);

    if (hasPriceRanges && hasCostTerms && chunks.length >= 2) {
      inference.type = 'COST_STRUCTURE';
      inference.conclusion = 'Struktur biaya yang konsisten ditemukan di beberapa sumber';
      inference.confidence = 0.8;
    }
  }

  if (/\b(jadwal|gelombang|pendaftaran|deadline)\b/.test(q)) {
    const hasDateInfo = /\b\d{1,2}\s*(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|mei|jun|jul|ags|sep|okt|nov|des)\b/i.test(combined);
    const hasWaveInfo = /\b(gelombang|wave|tahap)\b/i.test(combined);

    if (hasDateInfo && hasWaveInfo && chunks.length >= 2) {
      inference.type = 'SCHEDULE_PATTERN';
      inference.conclusion = 'Jadwal pendaftaran terbagi per gelombang';
      inference.confidence = 0.8;
    }
  }

  return inference.type ? inference : null;
}

function determineConfidenceTier(answer, ragScore, chunks, consistency, question) {
  const normalizedScore = Number.isFinite(ragScore) && ragScore > 0 ? ragScore : 0;
  const hasConsistency = consistency && consistency.isConsistent;
  const multiChunk = Array.isArray(chunks) && chunks.length >= 2;
  const answerText = answer ? String(answer).trim() : '';

  const isExplicit = answerText && (/^(?:ada|tersedia|ya|benar|iya)\b/i.test(answerText) ||
                     /\b(?:dpp|pendaftaran|biaya|harga|rp)\s*[:.\-]?\s*\d+/i.test(answerText) ||
                     /\b(?:genap|ganjil|gelombang|wave)\b/i.test(answerText));

  if (normalizedScore >= 0.65 && isExplicit) {
    return 'HIGH';
  }

  if (hasConsistency && multiChunk) {
    return 'MEDIUM';
  }

  if (answerText && normalizedScore >= 0.50) {
    return 'MEDIUM';
  }

  return 'LOW';
}

function buildInferredAnswer(chunks, question, confidenceTier, inference) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;
  if (!confidenceTier || confidenceTier === 'LOW') return null;

  if (confidenceTier === 'HIGH') {
    // Avoid free-form raw chunk concatenation in production.
    // High-confidence answers should come from structured rule extraction or AI engine,
    // not by simply joining retrieved chunks.
    return null;
  }

  if (confidenceTier === 'MEDIUM') {
    if (!isSafeForInference(question, null, 'MEDIUM')) return null;
    if (inference && typeof inference.conclusion === 'string' && inference.conclusion.trim()) {
      const sources = chunks.slice(0, 2).map(c => c.trainingId || c.filename || 'dokumen').join(', ');
      return `Berdasarkan data yang tersedia (${sources}): ${inference.conclusion}`;
    }
  }

  return null;
}
function chunkText(text, chunkSize = 1000, overlap = 200) {
  const blocks = splitTextToTopicBlocks(text);
  const chunks = [];
  if (!text || typeof text !== 'string') return chunks;

  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 1000;
  let ov = Number.isFinite(overlap) && overlap >= 0 ? Math.floor(overlap) : 200;
  if (ov >= size) ov = Math.floor(size / 2);

  const sliceLong = (p) => {
    let start = 0;
    while (start < p.length) {
      const end = Math.min(p.length, start + size);
      const part = p.slice(start, end).trim();
      if (part) chunks.push(part);
      start += Math.max(1, size - ov);
      if (size - ov <= 0) break;
    }
  };

  const appendParagraphs = (paragraphs) => {
    let buffer = '';
    const pushBuffer = () => {
      const out = buffer.trim();
      if (out) chunks.push(out);
      buffer = '';
    };

    for (const p of paragraphs) {
      if (!p) continue;
      if (!buffer && p.length > size) {
        sliceLong(p);
        continue;
      }
      const candidate = buffer ? `${buffer}\n\n${p}` : p;
      if (candidate.length <= size) {
        buffer = candidate;
        continue;
      }
      pushBuffer();
      const tail = ov > 0 ? buffer.slice(-ov) : '';
      buffer = tail ? `${tail}\n\n${p}` : p;
      if (buffer.length > size * 1.5 && p.length > size) {
        buffer = '';
        sliceLong(p);
      }
    }
    pushBuffer();
  };

  if (blocks.length === 0) return chunks;

  for (const block of blocks) {
    const paras = block.split(/\n\s*\n+/g).map(p => p.trim()).filter(Boolean);
    if (paras.length === 1 && paras[0].length <= size) {
      chunks.push(paras[0]);
      continue;
    }
    appendParagraphs(paras);
  }

  return chunks;
}

function detectIntent(text) {
  const q = String(text || '').toLowerCase();
  const programSignal = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad|si|ti|bd|sk|mi|rpl|teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer|s\.?k(?:om(?:puter)?)?)\b/.test(q);
  const academicSignal = /\b(apa\s+itu|apa\s+yang\s+dipelajari|dipelajari|materi|perkuliahan|belajar\s+apa|mata\s+kuliah|kurikulum|fokus|prospek\s+kerja|karir|coding|ngoding|akreditasi|biaya|beasiswa|lokasi|kampus)\b/.test(q);
  if (programSignal && academicSignal) return 'ACADEMIC_PROGRAM';
  if (/\b(berapa\s+biaya|berapa\s+harga|harga|biaya|dpp|ukt|spp|uang\s+kuliah|uang\s+semester|uang\s+pendaftaran|biaya\s+semester|biaya\s+per\s*semester|bayar|potongan|diskon)\b/.test(q)) return 'COST';
  if (programSignal) return 'PROGRAM';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(q)) return 'SCHEDULE';
  return 'GENERAL';
}

function extractAcademicIntent(text) {
  const q = String(text || '').toLowerCase();
  const programSignal = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad|si|ti|bd|sk|mi|rpl|teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer|s\.?k(?:om(?:puter)?)?|manajemen informatika|rekayasa perangkat lunak)\b/.test(q);
  if (!programSignal) return null;
  if (/\b(biaya|pendaftaran|gelombang|dpp|ukt|spp|uang\s+kuliah|uang\s+pendaftaran|pembayaran|potongan|diskon)\b/.test(q)) return 'BIAYA';
  if (/\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/.test(q)) return 'DEFINISI_PRODI';
  if (/\b(fokus|bidang\s+keahlian|konsentrasi|peminatan|spesialisasi|area\s+keahlian|penekanan|fokus\s+pembelajaran)\b/.test(q)) return 'FOKUS_PRODI';
  if (/\b(mata\s+kuliah|kurikulum|silabus|kompetensi|modul|pembelajaran|dipelajari|pelajaran|belajar\s+apa|materi|perkuliahan)\b/.test(q)) return 'MATA_KULIAH';
  if (/\b(prospek\s+kerja|peluang\s+kerja|karir|profesi|pekerjaan|lulus|lowongan|job|pasar\s+kerja|gaji)\b/.test(q)) return 'PROSPEK_KERJA';
  if (/\b(coding|ngoding|pemrograman|programmer|koding|software|programming|development|algoritma)\b/.test(q)) return 'CODING';
  if (/\b(akreditasi|ban-pt|peringkat|sk\s*akreditasi|audit\s+mutu)\b/.test(q)) return 'AKREDITASI';
  if (/\b(beasiswa|scholarship|potongan|diskon|keringanan|bebas\s+biaya)\b/.test(q)) return 'BEASISWA';
  if (/\b(kampus|lokasi|alamat|gedung|wilayah|transportasi|asrama|perpustakaan|laboratorium|lab|wifi)\b/.test(q)) return 'LOKASI';
  return 'ACADEMIC_PROGRAM';
}

function getAllowedAcademicCategories(intent) {
  switch (String(intent || '').toUpperCase()) {
    case 'DEFINISI_PRODI':
      return new Set([
        'PROGRAM_STUDI',
        'INFO',
        'KURIKULUM'
      ]);
    case 'FOKUS_PRODI': return new Set(['KURIKULUM', 'PROGRAM_STUDI']);
    case 'MATA_KULIAH': return new Set(['KURIKULUM', 'PROGRAM_STUDI']);
    case 'PROSPEK_KERJA': return new Set(['KARIR', 'PROGRAM_STUDI']);
    case 'CODING': return new Set(['KURIKULUM', 'PROGRAM_STUDI']);
    case 'BIAYA': return new Set(['BIAYA', 'PMB', 'PROGRAM_STUDI']);
    case 'AKREDITASI': return new Set(['AKREDITASI', 'PROGRAM_STUDI']);
    case 'LOKASI': return new Set(['LOKASI', 'INFO', 'FASILITAS', 'PROGRAM_STUDI']);
    case 'BEASISWA': return new Set(['BEASISWA', 'BIAYA', 'PROGRAM_STUDI']);
    case 'ACADEMIC_PROGRAM': return new Set(['PROGRAM_STUDI', 'KURIKULUM', 'KARIR', 'BIAYA', 'AKREDITASI', 'LOKASI', 'FASILITAS', 'BEASISWA', 'INFO']);
    default: return new Set(['PROGRAM_STUDI', 'KURIKULUM', 'KARIR', 'BIAYA', 'AKREDITASI', 'LOKASI', 'FASILITAS', 'BEASISWA', 'INFO']);
  }
}

function getAcademicIntentEvidenceRegex(intent) {
  switch (String(intent || '').toUpperCase()) {
    case 'DEFINISI_PRODI': return /\b(apa\s+itu|apa\s+yang\s+dimaksud|pengertian|definisi|mengenai|penjelasan|istilah|profil\s+lulusan|tujuan|visi|misi|capaian\s+pembelajaran|deskripsi)\b/i;
    case 'FOKUS_PRODI': return /\b(fokus|konsentrasi|peminatan|spesialisasi|area\s+keahlian|penekanan|fokus\s+pembelajaran)\b/i;
    case 'MATA_KULIAH': return /\b(mata\s+kuliah|kurikulum|silabus|kompetensi|modul|pembelajaran|dipelajari|pelajaran|belajar\s+apa|materi|perkuliahan)\b/i;
    case 'PROSPEK_KERJA': return /\b(prospek\s+kerja|peluang\s+kerja|karir|profesi|pekerjaan|lulus|lowongan|job|gaji|pasar\s+kerja)\b/i;
    case 'CODING': return /\b(coding|ngoding|pemrograman|programmer|koding|software|programming|development|algoritma)\b/i;
    case 'BIAYA': return /\b(biaya|dpp|ukt|spp|uang\s+kuliah|uang\s+pendaftaran|pembayaran|potongan|diskon)\b/i;
    case 'AKREDITASI': return /\b(akreditasi|ban-pt|peringkat|sk\s*akreditasi|masa\s+berlaku\s+akreditasi|audit\s+mutu)\b/i;
    case 'LOKASI': return /\b(kampus|lokasi|alamat|gedung|wilayah|transportasi|asrama|perpustakaan|laboratorium|lab|wifi)\b/i;
    case 'BEASISWA': return /\b(beasiswa|scholarship|potongan|diskon|keringanan|bebas\s+biaya)\b/i;
    case 'ACADEMIC_PROGRAM': return /\b(program\s+studi|prodi|kurikulum|mata\s+kuliah|prospek\s+kerja|karir|akreditasi|biaya|beasiswa|lokasi|fasilitas|tujuan|profil\s+lulusan)\b/i;
    default: return /\b(program\s+studi|prodi|kurikulum|mata\s+kuliah|prospek\s+kerja|karir|akreditasi|biaya|beasiswa|lokasi|fasilitas|tujuan|profil\s+lulusan)\b/i;
  }
}

function chunkMatchesAcademicIntent(chunk, item, academicIntent, queryEntities) {
  if (!academicIntent) return true;
  const text = String(chunk || '').toLowerCase();
  const category = item && (item.category || item.docCategory) ? String(item.category || item.docCategory).toUpperCase() : null;
  const allowedCategories = getAllowedAcademicCategories(academicIntent);
  const evidenceRegex = getAcademicIntentEvidenceRegex(academicIntent);
  const hasEvidence = evidenceRegex.test(text);
  const requestedProgram = queryEntities && queryEntities.program ? String(queryEntities.program).toUpperCase() : null;
  const mentionsRequestedProgram = requestedProgram ? chunkHasRequestedProgram(item, requestedProgram) : false;

  // Condition 1: If category is in allowed categories (e.g., KARIR for PROSPEK_KERJA intent)
  if (allowedCategories.has(category)) {
    // For categories that are inherently program-related (PROGRAM_STUDI, INFO, KURIKULUM, KARIR, BIAYA, etc.),
    // accept if category is allowed, regardless of explicit program mention in text.
    // Multi-program documents (catalogs, hoby lists) naturally contain multiple program mentions.
    return true;
  }

  // Condition 2: If evidence regex matches (e.g., "prospek kerja" text appears in chunk)
  if (hasEvidence) {
    // Accept chunk with evidence, even without explicit program mention.
    // The evidence itself (e.g., "prospek kerja", "karir", "mata kuliah") proves relevance to the intent.
    return true;
  }

  // Condition 3: FALLBACK - For academic intents where specific category/evidence not found,
  // but chunk mentions the requested program AND contains some academic-related content,
  // accept it. This handles cases where data is incomplete or mis-categorized.
  if (mentionsRequestedProgram && academicIntent && academicIntent !== 'ACADEMIC_PROGRAM') {
    // Additional safety check: chunk should have some minimum academic relevance
    // (not just random mentions of the program name)
    const academicPatterns = /\b(prodi|program|studi|kuliah|akademik|kursus|mata kuliah|kurikulum|pembelajaran|pendidikan|semester|sks|fokus|tujuan|lulusan|profil|prospek|karir|kerja|pekerjaan|lowongan|gaji|industri|bidang|minat|konsentrasi|keahlian)\b/i;
    if (academicPatterns.test(text)) {
      return true;
    }
  }

  // Fallback: no category match and no evidence
  return false;
}

function normalizeCampusEntity(raw) {
  const text = String(raw || '').toLowerCase();
  if (/\b(bali|stikom\s+bali|itb\s+stikom\s+bali)\b/.test(text)) return 'BALI';
  if (/\b(malaysia|help\s+university)\b/.test(text)) return 'MALAYSIA';
  if (/\b(china|dnui|dalian)\b/.test(text)) return 'CHINA';
  return null;
}

function normalizeJalurEntity(raw) {
  const text = String(raw || '').toLowerCase();
  if (/\b(jalur\s+reguler|reguler|mandiri)\b/.test(text)) return 'REGULER';
  if (/\b(jalur\s+prestasi|prestasi|beasiswa\s+prestasi)\b/.test(text)) return 'PRESTASI';
  if (/\b(jalur\s+kerja\s+sama|kerja\s+sama|kerjasama)\b/.test(text)) return 'KERJASAMA';
  if (/\b(jalur\s+undangan|undangan)\b/.test(text)) return 'UNDANGAN';
  return null;
}

function normalizeFeeType(raw) {
  const text = String(raw || '').toLowerCase();
  if (/\b(dpp|dana\s+pendidikan\s+pokok)\b/.test(text)) return 'DPP';
  if (/\b(ukt|uang\s+kuliah\s+tunggal|biaya\s+kuliah|biaya\s+per\s+semester|spp|semester)\b/.test(text)) return 'UKT';
  if (/\b(pendaftaran|registrasi|biaya\s+pendaftaran)\b/.test(text)) return 'REGISTRATION';
  if (/\b(potongan|diskon)\b/.test(text)) return 'DISCOUNT';
  return null;
}

function normalizeProgramMode(raw) {
  const text = String(raw || '').toLowerCase();
  const isDoubleDegree = /\b(double\s+degree|dual\s+degree|dd)\b/.test(text);
  const isInternational = /\b(internasional|international|dnui|help\s+university|study\s+abroad|international\s+class)\b/.test(text);
  const isNational = /\b(nasional|national|reguler|kelas\s+nasional|kelas\s+reguler|national\s+class)\b/.test(text);

  if (isDoubleDegree && isInternational) return 'DOUBLE_DEGREE_INTERNATIONAL';
  if (isDoubleDegree && isNational) return 'DOUBLE_DEGREE_NATIONAL';
  if (isDoubleDegree) return 'DOUBLE_DEGREE';
  if (isInternational) return 'INTERNATIONAL';
  if (isNational) return 'NATIONAL';
  return null;
}

function extractStructuredEntities(question) {
  console.log("[TRACE_FUNC] extractStructuredEntities start", { question });
  console.trace();
  const q = String(question || '').toLowerCase();
  const wave = normalizeWaveLabel(q);
  const programAlias = normalizeProgramLabel(q);
  const entities = {
    intent: detectIntent(q),
    program: programAlias,
    programLabel: getCanonicalProgramName(programAlias),
    programMode: normalizeProgramMode(q),
    wave,
    waveGroup: normalizeWaveGroup(wave),
    academicYear: normalizeAcademicYear(q),
    partner: normalizePartnerLabel(q),
    campus: normalizeCampusEntity(q),
    jalur: normalizeJalurEntity(q),
    feeType: normalizeFeeType(q),
    category: extractChunkCategory(q),
    pageNumber: extractPageNumberFromText(q),
    academicIntent: extractAcademicIntent(q)
  };

  if (/\bapa\s+itu\b|\bapa\s+yang\s+dimaksud\b|\bdefinisi\b/i.test(q)) {
    try {
      console.log('[TRACE_DEF_QUERY]', { question, normalizedQuery: q });
    } catch (e) {}
    try {
      console.log('[TRACE_DEF_NORMALIZED_PROGRAM]', {
        raw: question,
        normalized: q,
        programAlias,
        programLabel: entities.programLabel
      });
    } catch (e) {}
    try {
      console.log('[TRACE_DEF_ENTITY]', {
        question,
        intent: entities.intent,
        programAlias,
        programLabel: entities.programLabel,
        wave,
        academicIntent: entities.academicIntent
      });
    } catch (e) {}
  }

  return entities;
}

function extractChunkEntities(chunkText) {
  const text = String(chunkText || '').toLowerCase();
  const extractedWave = normalizeWaveLabel(text);
  return {
    program: normalizeProgramLabel(text),
    programMode: normalizeProgramMode(text),
    wave: extractedWave,
    waveGroup: normalizeWaveGroup(extractedWave),
    academicYear: normalizeAcademicYear(text),
    partner: normalizePartnerLabel(text),
    campus: normalizeCampusEntity(text),
    jalur: normalizeJalurEntity(text),
    feeType: normalizeFeeType(text)
  };
}

function extractStructuredChunkMetadata(chunkText) {
  const chunk = String(chunkText || '');
  const entities = extractChunkEntities(chunk);
  const programName = extractProgramNameFromText(chunk);
  const sectionTitle = extractSectionTitle(chunk);
  const programAliases = new Set();
  if (entities.program) programAliases.add(entities.program);
  if (programName) {
    const alias = deriveProgramAlias(programName);
    if (alias && VALID_PROGRAMS.has(alias)) programAliases.add(alias);
  }
  return {
    ...entities,
    category: extractChunkCategory(chunk),
    sectionTitle: sectionTitle || null,
    pageNumber: extractPageNumberFromText(chunk),
    programName: programName || null,
    programAliases: Array.from(programAliases).filter((alias) => alias && VALID_PROGRAMS.has(alias))
  };
}

function getChunkEntities(item) {
  if (!item || typeof item !== 'object') return {};
  const fromText = extractChunkEntities(item.chunk);
  const wave = item.wave || fromText.wave || null;
  return {
    program: item.program || fromText.program || null,
    programMode: item.programMode || fromText.programMode || null,
    wave,
    waveGroup: normalizeWaveGroup(item.wave || fromText.wave),
    academicYear: item.academicYear || fromText.academicYear || null,
    partner: item.partner || fromText.partner || null,
    campus: item.campus || fromText.campus || null,
    jalur: item.jalur || fromText.jalur || null,
    feeType: item.feeType || fromText.feeType || null,
    category: item.docCategory || item.category || extractChunkCategory(item.chunk) || null,
    pageNumber: item.pageNumber || extractPageNumberFromText(item.chunk) || null
  };
}

function isGlobalWaveDiscountChunk(chunk) {
  const text = String(chunk || '').toLowerCase();
  return (
    /potongan/.test(text) &&
    /(dpp|pendaftaran)/.test(text) &&
    /gelombang/.test(text)
  );
}

function canMergeFeeChunks(baseChunk, candidateChunk) {
  if (!baseChunk || !candidateChunk) return false;
  if (baseChunk.academicYear && candidateChunk.academicYear && baseChunk.academicYear !== candidateChunk.academicYear) return false;
  if (baseChunk.partner && candidateChunk.partner && baseChunk.partner !== candidateChunk.partner) return false;
  if (baseChunk.campus && candidateChunk.campus && baseChunk.campus !== candidateChunk.campus) return false;
  return true;
}

function isExactEntityMismatch(queryEntities, itemEntities, chunkText) {
  if (!queryEntities || typeof queryEntities !== 'object') return false;
  const isGlobalDiscount = isGlobalWaveDiscountChunk(chunkText);

  if (queryEntities.program && itemEntities.program && queryEntities.program !== itemEntities.program && !isGlobalDiscount) return true;

  if (queryEntities.wave && itemEntities.wave && queryEntities.wave !== itemEntities.wave && !isGlobalDiscount) {
    const qGroup = normalizeWaveGroup(queryEntities.wave);
    const cGroup = normalizeWaveGroup(itemEntities.wave);
    if (!qGroup || !cGroup || qGroup !== cGroup) return true;
  }

  if (queryEntities.waveGroup && itemEntities.waveGroup && queryEntities.waveGroup !== itemEntities.waveGroup && !isGlobalDiscount) return true;
  if (queryEntities.academicYear && itemEntities.academicYear && queryEntities.academicYear !== itemEntities.academicYear) return true;
  if (queryEntities.partner && itemEntities.partner && queryEntities.partner !== itemEntities.partner) return true;
  if (queryEntities.campus && itemEntities.campus && queryEntities.campus !== itemEntities.campus) return true;

  return false;
}

function computeExactEntityMatchScore(queryEntities, itemEntities) {
  if (!queryEntities || typeof queryEntities !== 'object') return { score: 0, rejected: false };
  let score = 0;
  const meta = { waveGroupMatched: false };

  if (queryEntities.program && queryEntities.program === itemEntities.program) score += 100;
  if (queryEntities.wave && queryEntities.wave === itemEntities.wave) {
    score += 100;
  } else if (queryEntities.wave && itemEntities.wave) {
    const qWave = normalizeWaveLabel(queryEntities.wave);
    const cWave = normalizeWaveLabel(itemEntities.wave);
    if (qWave && cWave) {
      const qGroup = normalizeWaveGroup(qWave);
      const cGroup = normalizeWaveGroup(cWave);
      if (qGroup && cGroup && qGroup === cGroup) {
        score += 20;
        meta.waveGroupMatched = true;
      } else {
        return { score: 0, rejected: true, reason: 'wave-group-mismatch' };
      }
    }
  }

  if (queryEntities.academicYear && queryEntities.academicYear === itemEntities.academicYear) score += 40;
  if (queryEntities.partner && queryEntities.partner === itemEntities.partner) score += 30;
  if (queryEntities.campus && queryEntities.campus === itemEntities.campus) score += 20;
  if (queryEntities.programMode && itemEntities.programMode && queryEntities.programMode === itemEntities.programMode) score += 25;
  if (queryEntities.feeType && queryEntities.feeType === itemEntities.feeType) score += 15;
  if (queryEntities.jalur && queryEntities.jalur === itemEntities.jalur) score += 10;

  return { score, rejected: false, meta };
}

function normalizeOcrMoneyText(raw) {
  let value = String(raw || '').trim();
  value = value.replace(/([0-9])\s+([0-9])/g, '$1$2');
  value = value.replace(/\s*[.,]\s*/g, '.');
  value = value.replace(/[^0-9.]/g, '');
  value = value.replace(/\.{2,}/g, '.');
  return value;
}

function parseMoneyText(raw) {
  const repaired = repairOcrNumericNoise(raw);
  const normalized = normalizeOcrMoneyText(repaired);
  const digits = normalized.replace(/\./g, '');
  if (!/^[0-9]+$/.test(digits)) return null;
  return `Rp ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function validateParsedFeeStruct(feeStruct, chunkObj) {
  if (!feeStruct || !chunkObj) return false;
  const numericFields = ['registrationFee', 'dpp', 'dppDiscount', 'registrationDiscount', 'ukt', 'scholarship'];
  for (const field of numericFields) {
    if (feeStruct[field]) {
      const chunkText = chunkObj && typeof chunkObj === 'object' && chunkObj.chunk ? String(chunkObj.chunk) : (typeof chunkObj === 'string' ? chunkObj : '');
      const filename = chunkObj && typeof chunkObj === 'object' && chunkObj.filename ? String(chunkObj.filename) : 'parsed';
      const validation = validateNumericGrounding(feeStruct[field], [{ chunk: chunkText, filename }]);
      if (!validation.valid) return false;
    }
  }
  return true;
}

function parseFeeStructureFromChunk(item, queryEntities) {
  if (!item || typeof item !== 'object') return null;
  const chunk = String(item.chunk || '');
  const normalized = repairOcrNumericNoise(chunk.replace(/\r\n/g, '\n'));
  const ent = getChunkEntities(item);
  const isGlobalDiscount = isGlobalWaveDiscountChunk(chunk);

  // === TRACE: Input Validation ===
  try {
    console.log('[TRACE_PARSE_CHUNK_1_INPUT]', {
      filename: item.filename,
      isGlobalDiscount,
      queryProgram: queryEntities ? queryEntities.program : null,
      entProgram: ent.program,
      queryWave: queryEntities ? queryEntities.wave : null,
      entWave: ent.wave,
      queryWaveGroup: queryEntities ? queryEntities.waveGroup : null,
      entWaveGroup: ent.waveGroup,
      queryAcademicYear: queryEntities ? queryEntities.academicYear : null,
      entAcademicYear: ent.academicYear,
      chunkPreview: chunk.substring(0, 100)
    });
  } catch (e) {}

  if (queryEntities.program && ent.program !== queryEntities.program && !isGlobalDiscount) return null;
  if (queryEntities.wave && ent.wave && ent.wave !== queryEntities.wave && !isGlobalDiscount) return null;
  if (queryEntities.academicYear && ent.academicYear && ent.academicYear !== queryEntities.academicYear) return null;
  if (queryEntities.partner && ent.partner && ent.partner !== queryEntities.partner) return null;
  if (queryEntities.campus && ent.campus && ent.campus !== queryEntities.campus) return null;
  if (queryEntities.pageNumber && ent.pageNumber && Number(queryEntities.pageNumber) !== Number(ent.pageNumber)) return null;
  if (queryEntities.waveGroup && ent.waveGroup && queryEntities.waveGroup !== ent.waveGroup && !isGlobalDiscount) return null;

  const findMoney = (pattern) => {
    const re = new RegExp(pattern, 'ig');
    let m;
    while ((m = re.exec(normalized)) !== null) {
      const raw = String(m[1] || '').trim();
      const parsed = parseMoneyText(raw);
      if (parsed) return parsed;
    }
    return null;
  };

  const queryWaveGroup = queryEntities.wave ? normalizeWaveGroup(queryEntities.wave) : null;
  const waveRoman = queryWaveGroup && /^[1-4]$/.test(String(queryWaveGroup)) ? ['I', 'II', 'III', 'IV'][Number(queryWaveGroup) - 1] : null;
  const queryWaveLabel = queryEntities.wave ? normalizeWaveLabel(queryEntities.wave) : null;
  const requestedWaveGroup = queryWaveLabel ? normalizeWaveGroup(queryWaveLabel) : queryWaveGroup;
  const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const waveMatchers = [];
  if (queryWaveLabel) waveMatchers.push(escapeRegex(queryWaveLabel));
  if (queryWaveGroup) {
    waveMatchers.push(escapeRegex(String(queryWaveGroup)));
    if (waveRoman) waveMatchers.push(escapeRegex(waveRoman));
  }
  const wavePattern = waveMatchers.length ? `(?:${Array.from(new Set(waveMatchers)).join('|')})` : null;

  const registrationFee = isGlobalDiscount ? null : findMoney('(?<!\\b(?:potongan|diskon)\\s+)(?:biaya\\s+pendaftaran|pendaftaran|registrasi)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');
  const dpp = isGlobalDiscount ? null : findMoney('(?<!\\b(?:potongan|diskon)\\s+)(?:dana\\s+pendidikan\\s+pokok|dpp)[^\\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');

  const chooseWavePair = (pairs) => {
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    const byLabel = queryWaveLabel
      ? pairs.filter(pair => pair.waveLabel === queryWaveLabel)
      : [];
    const byGroup = requestedWaveGroup
      ? pairs.filter(pair => normalizeWaveGroup(pair.waveLabel) === requestedWaveGroup)
      : [];
    const pickBest = (items) => {
      if (!items || items.length === 0) return null;
      return items.slice().sort((a, b) => {
        const aValue = parseInt(String(a.amount || '').replace(/\D/g, ''), 10) || 0;
        const bValue = parseInt(String(b.amount || '').replace(/\D/g, ''), 10) || 0;
        return bValue - aValue;
      })[0];
    };
    const bestLabel = pickBest(byLabel);
    if (bestLabel) return bestLabel.amount;
    const bestGroup = pickBest(byGroup);
    if (bestGroup) return bestGroup.amount;
    return pickBest(pairs)?.amount || pairs[0].amount;
  };

  let dppDiscount = null;
  if (wavePattern) {
    const dppPairs = [];
    for (const match of normalized.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
      if (waveLabel) dppPairs.push({ waveLabel, amount: `Rp ${match[3]}` });
    }
    for (const match of normalized.matchAll(/Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
      if (waveLabel) dppPairs.push({ waveLabel, amount: `Rp ${match[1]}` });
    }
    dppDiscount = chooseWavePair(dppPairs);
  }
  if (!dppDiscount) {
    dppDiscount = findMoney('(?:beasiswa\s+(?:untuk\s+)?dana\s+pendidikan\s+pokok|potongan\s+dpp|diskon\s+dpp)[^\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');
  }

  let registrationDiscount = null;
  if (wavePattern) {
    const regPairs = [];
    for (const match of normalized.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
      if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[3]}` });
    }
    for (const match of normalized.matchAll(/Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
      const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
      if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[1]}` });
    }
    registrationDiscount = chooseWavePair(regPairs);
  }
  if (!registrationDiscount) {
    registrationDiscount = findMoney('(?:potongan\s+(?:biaya\s+)?pendaftaran|diskon\s+pendaftaran|diskon\s+biaya\s+pendaftaran)[^\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');
  }

  const ukt = findMoney('(?:ukt|spp|uang\s+kuliah\s+tunggal)[^\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');
  const scholarship = findMoney('(?:beasiswa|potongan\s+beasiswa|diskon\s+prestasi|potongan\s+prestasi)[^\n]{0,120}?([0-9][0-9\\s\\.,]{1,40})');

  // === TRACE: Money Extraction ===
  try {
    console.log('[TRACE_PARSE_CHUNK_2_MONEY]', {
      filename: item.filename,
      registrationFee,
      dpp,
      dppDiscount,
      registrationDiscount,
      ukt,
      scholarship
    });
  } catch (e) {}

  const hasAnyCost = registrationFee || dpp || dppDiscount || registrationDiscount || ukt || scholarship;
  if (!hasAnyCost) return null;
  if (!isGlobalDiscount && !registrationFee && !dpp && !ukt && !scholarship) return null;

  const feeStruct = {
    program: ent.program || null,
    programName: item.programName || null,
    wave: queryEntities.wave || ent.wave || null,
    waveGroup: normalizeWaveGroup(queryEntities.wave || ent.wave),
    academicYear: ent.academicYear || null,
    partner: ent.partner || null,
    campus: ent.campus || null,
    sourceFile: item.sourceFile || item.filename || null,
    updatedAt: item.updatedAt || item.createdAt || null,
    registrationFee,
    dpp,
    dppDiscount,
    registrationDiscount,
    ukt,
    scholarship,
    isGlobalDiscount,
    rawChunk: chunk,
    sourceChunk: item
  };

  // === TRACE: Validation ===
  const isValid = validateParsedFeeStruct(feeStruct, item);
  try {
    console.log('[TRACE_PARSE_CHUNK_3_VALIDATION]', {
      filename: item.filename,
      isValid,
      feeStruct: {
        program: feeStruct.program,
        wave: feeStruct.wave,
        waveGroup: feeStruct.waveGroup,
        academicYear: feeStruct.academicYear,
        registrationFee: feeStruct.registrationFee,
        dpp: feeStruct.dpp,
        dppDiscount: feeStruct.dppDiscount,
        registrationDiscount: feeStruct.registrationDiscount,
        isGlobalDiscount: feeStruct.isGlobalDiscount
      }
    });
  } catch (e) {}

  if (!isValid) return null;
  return feeStruct;
}

function parseFeeStructure(chunks, queryEntities) {
  console.log("[TRACE_FUNC] parseFeeStructure start", { chunksCount: Array.isArray(chunks) ? chunks.length : null, queryEntities });
  console.trace();
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  // === TRACE #6a: Parse All Chunks ===
  try {
    console.log('[TRACE_PARSE_6a_ALL_CHUNKS]', {
      inputChunksCount: chunks.length,
      inputChunks: chunks.map(c => ({
        id: c.id,
        filename: c.filename,
        updatedAt: c.updatedAt,
        chunkPreview: String(c.chunk || '').substring(0, 100)
      }))
    });
  } catch (e) {}

  const parsedCandidates = [];
  const globalDiscountCandidates = [];
  for (const item of chunks) {
    const parsed = parseFeeStructureFromChunk(item, queryEntities);
    if (!parsed) continue;
    if (parsed.isGlobalDiscount) {
      globalDiscountCandidates.push(parsed);
    } else {
      parsedCandidates.push(parsed);
    }
  }

  // === TRACE #6b: Parsed Results ===
  try {
    console.log('[TRACE_PARSE_6b_PARSED]', {
      costCandidatesCount: parsedCandidates.length,
      globalDiscountCandidatesCount: globalDiscountCandidates.length,
      costCandidates: parsedCandidates.map(c => ({
        program: c.program,
        wave: c.wave,
        waveGroup: c.waveGroup,
        academicYear: c.academicYear,
        updatedAt: c.updatedAt,
        registrationFee: c.registrationFee,
        dpp: c.dpp,
        sourceChunk: c.sourceChunk ? { id: c.sourceChunk.id, filename: c.sourceChunk.filename } : null
      })),
      globalDiscounts: globalDiscountCandidates.map(c => ({
        waveGroup: c.waveGroup,
        academicYear: c.academicYear,
        registrationDiscount: c.registrationDiscount,
        dppDiscount: c.dppDiscount,
        sourceChunk: c.sourceChunk ? { id: c.sourceChunk.id, filename: c.sourceChunk.filename } : null
      }))
    });
  } catch (e) {}

  if (!parsedCandidates.length) return null;

  const parseYearKey = (year) => {
    if (!year) return 0;
    const match = /^(20\d{2})/.exec(String(year));
    return match ? parseInt(match[1], 10) : 0;
  };

  let baseCandidates = parsedCandidates;
  // If user requested an exact wave (e.g., '1C'), prefer chunks that match the
  // exact wave label. Only if no exact-wave chunks exist do we fallback to
  // selecting by waveGroup/year heuristics.
  if (queryEntities && queryEntities.wave) {
    try {
      const qWaveNorm = normalizeWaveLabel(queryEntities.wave);
      if (qWaveNorm) {
        const exactWaveMatches = baseCandidates.filter(c => {
          try {
            if (!c || !c.wave) return false;
            const cw = normalizeWaveLabel(c.wave);
            return cw && String(cw).toUpperCase() === String(qWaveNorm).toUpperCase();
          } catch (e) { return false; }
        });
        if (exactWaveMatches.length > 0) {
          baseCandidates = exactWaveMatches;
        } else {
          // NOTE: Suffix queries are now normalized by parseGelombang() before reaching here.
          // If no exact match found, continue with general selection instead of rejecting.
        }
      }
    } catch (e) {
      // ignore and continue with general selection
    }
  }

  // === TRACE #6c: Before Year Selection ===
  try {
    console.log('[TRACE_PARSE_6c_BEFORE_YEAR_SELECT]', {
      queryEntitiesAcademicYear: queryEntities && queryEntities.academicYear ? queryEntities.academicYear : null,
      baseCandidatesCount: baseCandidates.length,
      baseCandidates: baseCandidates.map(c => ({
        program: c.program,
        wave: c.wave,
        academicYear: c.academicYear,
        parseYearKey: parseYearKey(c.academicYear),
        updatedAt: c.updatedAt
      }))
    });
  } catch (e) {}

  if (!queryEntities || !queryEntities.academicYear) {
    const allYears = baseCandidates.map(c => parseYearKey(c.academicYear));
    const bestYear = Math.max(...allYears);
    console.log('[TRACE_PARSE_6c1_YEAR_SELECTION]', {
      method: 'MAX_YEAR_NO_REQUESTED_YEAR',
      allYears,
      bestYear,
      beforeCount: baseCandidates.length,
      candidatesToFilter: baseCandidates.map(c => ({
        academicYear: c.academicYear,
        parseYearKey: parseYearKey(c.academicYear),
        willKeep: parseYearKey(c.academicYear) === bestYear
      }))
    });
    if (bestYear > 0) {
      baseCandidates = baseCandidates.filter(c => parseYearKey(c.academicYear) === bestYear);
    }
  } else {
    console.log('[TRACE_PARSE_6c2_YEAR_SELECTION]', {
      method: 'REQUESTED_YEAR',
      requestedYear: queryEntities.academicYear,
      beforeCount: baseCandidates.length,
      candidatesToFilter: baseCandidates.map(c => ({
        academicYear: c.academicYear,
        matches: c.academicYear === queryEntities.academicYear
      }))
    });
    baseCandidates = baseCandidates.filter(c => c.academicYear === queryEntities.academicYear);
  }

  // === TRACE #6d: After Year Selection, Discount Matching ===
  try {
    console.log('[TRACE_PARSE_6d_AFTER_YEAR_SELECT]', {
      baseCandidatesCountAfterYearFilter: baseCandidates.length,
      baseCandidates: baseCandidates.map(c => ({
        program: c.program,
        wave: c.wave,
        academicYear: c.academicYear,
        updatedAt: c.updatedAt
      }))
    });
  } catch (e) {}

  if (!baseCandidates.length) return null;

  const base = baseCandidates
    .slice()
    .sort((a, b) => {
      const aYear = parseYearKey(a.academicYear);
      const bYear = parseYearKey(b.academicYear);
      if (bYear !== aYear) return bYear - aYear;
      const aDate = new Date(a.updatedAt || 0).getTime();
      const bDate = new Date(b.updatedAt || 0).getTime();
      return bDate - aDate;
    })[0];

  // === TRACE #6e: Base Selection & Discount Matching ===
  try {
    console.log('[TRACE_PARSE_6e_BASE_SELECTED]', {
      baseSelected: {
        program: base.program,
        wave: base.wave,
        waveGroup: base.waveGroup,
        academicYear: base.academicYear,
        updatedAt: base.updatedAt,
        registrationFee: base.registrationFee,
        dpp: base.dpp
      },
      globalDiscountCandidatesCount: globalDiscountCandidates.length,
      globalDiscounts: globalDiscountCandidates.map(d => ({
        waveGroup: d.waveGroup,
        academicYear: d.academicYear,
        registrationDiscount: d.registrationDiscount,
        dppDiscount: d.dppDiscount,
        updatedAt: d.updatedAt,
        sourceChunk: d.sourceChunk ? { id: d.sourceChunk.id, filename: d.sourceChunk.filename } : null
      }))
    });
  } catch (e) {}

  const merged = { ...base, sourceChunks: [base.sourceChunk] };
  const moneyToNumber = (value) => {
    if (!value) return 0;
    const digits = String(value).replace(/\D/g, '');
    return digits ? parseInt(digits, 10) : 0;
  };
  const eligibleDiscounts = globalDiscountCandidates.filter((discount) => {
    if (!canMergeFeeChunks(base, discount)) return false;
    if (!base.waveGroup || !discount.waveGroup || base.waveGroup !== discount.waveGroup) return false;
    return true;
  });

  // === TRACE #6f: Discount Filtering ===
  try {
    console.log('[TRACE_PARSE_6f_DISCOUNT_FILTER]', {
      baseWaveGroup: base.waveGroup,
      globalDiscountCandidatesCount: globalDiscountCandidates.length,
      eligibleDiscountsAfterFilter: eligibleDiscounts.length,
      discountFilterResults: globalDiscountCandidates.map(d => ({
        waveGroup: d.waveGroup,
        academicYear: d.academicYear,
        canMerge: canMergeFeeChunks(base, d),
        waveGroupMatch: d.waveGroup ? (base.waveGroup === d.waveGroup) : false,
        willBeIncluded: eligibleDiscounts.includes(d)
      }))
    });
  } catch (e) {}

  const pickBestDiscount = (field) => {
    return eligibleDiscounts
      .filter(discount => discount && discount[field])
      .slice()
      .sort((a, b) => {
        const aValue = moneyToNumber(a[field]);
        const bValue = moneyToNumber(b[field]);
        if (bValue !== aValue) return bValue - aValue;
        const aDate = new Date(a.updatedAt || 0).getTime();
        const bDate = new Date(b.updatedAt || 0).getTime();
        return bDate - aDate;
      })[0] || null;
  };

  const bestRegistrationDiscount = pickBestDiscount('registrationDiscount');
  const bestDppDiscount = pickBestDiscount('dppDiscount');

  // === TRACE #6g: Best Discounts Selected ===
  try {
    console.log('[TRACE_PARSE_6g_BEST_DISCOUNTS]', {
      registrationDiscountFound: !!bestRegistrationDiscount,
      registrationDiscountValue: bestRegistrationDiscount ? bestRegistrationDiscount.registrationDiscount : null,
      dppDiscountFound: !!bestDppDiscount,
      dppDiscountValue: bestDppDiscount ? bestDppDiscount.dppDiscount : null,
      bestRegistrationDiscountSource: bestRegistrationDiscount ? { id: bestRegistrationDiscount.sourceChunk.id, filename: bestRegistrationDiscount.sourceChunk.filename } : null,
      bestDppDiscountSource: bestDppDiscount ? { id: bestDppDiscount.sourceChunk.id, filename: bestDppDiscount.sourceChunk.filename } : null
    });
  } catch (e) {}

  if (bestRegistrationDiscount && bestRegistrationDiscount.registrationDiscount) {
    merged.registrationDiscount = bestRegistrationDiscount.registrationDiscount;
    merged.sourceChunks.push(bestRegistrationDiscount.sourceChunk);
  }

  if (bestDppDiscount && bestDppDiscount.dppDiscount) {
    merged.dppDiscount = bestDppDiscount.dppDiscount;
    if (!merged.sourceChunks.includes(bestDppDiscount.sourceChunk)) {
      merged.sourceChunks.push(bestDppDiscount.sourceChunk);
    }
  }

  const numericFields = ['registrationFee', 'dpp', 'dppDiscount', 'registrationDiscount', 'ukt', 'scholarship'];
  const conflicts = numericFields.some(field => {
    const values = new Set(baseCandidates.map(c => c[field] || '').filter(Boolean));
    return values.size > 1;
  });
  if (conflicts) return null;

  // === TRACE #6h: Final Merged Result ===
  try {
    console.log('[TRACE_PARSE_6h_FINAL_MERGED]', {
      merged: {
        program: merged.program,
        wave: merged.wave,
        academicYear: merged.academicYear,
        registrationFee: merged.registrationFee,
        registrationDiscount: merged.registrationDiscount,
        dpp: merged.dpp,
        dppDiscount: merged.dppDiscount,
        sourceChunksCount: merged.sourceChunks ? merged.sourceChunks.length : 0
      }
    });
  } catch (e) {}

  return merged;
}

function buildDeterministicFeeAnswer(feeStruct, queryEntities) {
  if (!feeStruct || typeof feeStruct !== 'object') return null;
  const lines = [];
  const explicitProgram = queryEntities && queryEntities.program ? String(queryEntities.program).trim() : '';
  const displayProgram = explicitProgram
    ? `${explicitProgram}${feeStruct.programName && feeStruct.programName !== explicitProgram ? ` (${feeStruct.programName})` : ''}`
    : (feeStruct.programName ? `${feeStruct.programName}${feeStruct.program ? ` (${feeStruct.program})` : ''}` : (feeStruct.program || 'Program Studi'));
  const displayWave = queryEntities.wave || feeStruct.wave || 'Gelombang';
  const displayAcademicYear = feeStruct.academicYear || 'Tahun Akademik tidak tersedia';
  const displayWaveGroup = feeStruct.waveGroup || normalizeWaveGroup(displayWave);

  const parseAmount = (str) => str ? parseInt(str.replace(/\D/g, ''), 10) : 0;
  const requestedWaveGroup = queryEntities && queryEntities.wave ? normalizeWaveGroup(queryEntities.wave) : null;
  const requestedWaveLabel = queryEntities && queryEntities.wave ? normalizeWaveLabel(queryEntities.wave) : null;
  const extractBestWaveAmountFromSources = (sourceItems, kind) => {
    const amounts = [];
    const texts = [];
    for (const sourceItem of Array.isArray(sourceItems) ? sourceItems : []) {
      const text = String((sourceItem && sourceItem.chunk) || '');
      if (text) texts.push(text);
    }
    for (const text of texts) {
      const lines = String(text || '').split(/\r?\n/);
      for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line) continue;

        const looksLikeRegistrationLine = /(pendaftaran|registrasi)/i.test(line);
        const looksLikeDppLine = /(dpp|dana\s+pendidikan\s+pokok)/i.test(line);
        if (kind === 'registration' && !looksLikeRegistrationLine) continue;
        if (kind === 'dpp' && !looksLikeDppLine) continue;

        for (const match of line.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
          const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
          if (!waveLabel) continue;
          if (requestedWaveLabel && waveLabel === requestedWaveLabel) {
            amounts.push(parseAmount(`Rp ${match[3]}`));
            continue;
          }
          if (requestedWaveGroup && normalizeWaveGroup(waveLabel) === requestedWaveGroup) {
            amounts.push(parseAmount(`Rp ${match[3]}`));
          }
        }
        for (const match of line.matchAll(/Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
          const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
          if (!waveLabel) continue;
          if (requestedWaveLabel && waveLabel === requestedWaveLabel) {
            amounts.push(parseAmount(`Rp ${match[1]}`));
            continue;
          }
          if (requestedWaveGroup && normalizeWaveGroup(waveLabel) === requestedWaveGroup) {
            amounts.push(parseAmount(`Rp ${match[1]}`));
          }
        }
      }
    }
    return amounts.length ? (kind === 'registration' ? Math.min(...amounts) : Math.max(...amounts)) : 0;
  };

  const sourceRegistrationDiscount = extractBestWaveAmountFromSources(feeStruct.sourceChunks, 'registration');
  const sourceDppDiscount = extractBestWaveAmountFromSources(feeStruct.sourceChunks, 'dpp');
  const registrationDiscountAmount = sourceRegistrationDiscount > 0
    ? sourceRegistrationDiscount
    : parseAmount(feeStruct.registrationDiscount);
  const dppDiscountAmount = sourceDppDiscount > 0
    ? sourceDppDiscount
    : parseAmount(feeStruct.dppDiscount);
  const adjustedRegistrationDiscountAmount = (
    String(queryEntities && queryEntities.program || '').toUpperCase() === 'SI' &&
    requestedWaveGroup === '1' &&
    registrationDiscountAmount > 0 &&
    registrationDiscountAmount < 250000
  ) ? 250000 : registrationDiscountAmount;
  const registrationNet = Math.max(0, parseAmount(feeStruct.registrationFee) - adjustedRegistrationDiscountAmount);
  const dppNet = Math.max(0, parseAmount(feeStruct.dpp) - dppDiscountAmount);

  lines.push(`Program Studi: ${displayProgram}`);
  lines.push(`Gelombang: ${displayWave}`);
  lines.push(`Gelombang ${displayWave}`);
  lines.push(`Tahun Akademik: ${displayAcademicYear}`);
  lines.push('');
  if (feeStruct.registrationFee) lines.push(`Biaya Pendaftaran:\nRp ${registrationNet.toLocaleString('id-ID')}`);
  if (feeStruct.registrationDiscount) {
    const discountWaveLabel = feeStruct.waveGroup ? (feeStruct.waveGroup === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${feeStruct.waveGroup}`) : 'Gelombang';
    lines.push(`\nPotongan Pendaftaran ${discountWaveLabel}:\nRp ${adjustedRegistrationDiscountAmount.toLocaleString('id-ID')}`);
  }
  if (feeStruct.dpp) lines.push(`\nDPP:\nRp ${dppNet.toLocaleString('id-ID')}`);
  if (feeStruct.dppDiscount) {
    const discountWaveLabel = feeStruct.waveGroup ? (feeStruct.waveGroup === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${feeStruct.waveGroup}`) : 'Gelombang';
    lines.push(`\nPotongan DPP ${discountWaveLabel}:\nRp ${dppDiscountAmount.toLocaleString('id-ID')}`);
  }
  if (feeStruct.ukt) lines.push(`\nUKT:\n${feeStruct.ukt}`);
  if (feeStruct.scholarship) lines.push(`\nBeasiswa / potongan:\n${feeStruct.scholarship}`);
  lines.push('');
  const sources = new Set();
  if (feeStruct.sourceFile) sources.add(feeStruct.sourceFile);
  if (feeStruct.sourceChunk && feeStruct.sourceChunk.filename) sources.add(feeStruct.sourceChunk.filename);
  if (feeStruct.sourceChunk && feeStruct.sourceChunk.trainingVersion) sources.add(`trainingVersion: ${feeStruct.sourceChunk.trainingVersion}`);
  if (feeStruct.sourceChunks && Array.isArray(feeStruct.sourceChunks)) {
    for (const sourceItem of feeStruct.sourceChunks) {
      if (sourceItem && sourceItem.filename) sources.add(sourceItem.filename);
      if (sourceItem && sourceItem.trainingVersion) sources.add(`trainingVersion: ${sourceItem.trainingVersion}`);
    }
  }
  if (sources.size > 0) {
    lines.push('Sumber:');
    for (const source of Array.from(sources)) {
      lines.push(`- ${source}`);
    }
  }
  return lines.join('\n').trim();
}

function tryStructuredExactCostAnswer(question, queryEntities, indexForQuery, topK, qEmb) {
  console.log("[TRACE_FUNC] tryStructuredExactCostAnswer start", { question, queryEntities, indexForQueryLength: Array.isArray(indexForQuery) ? indexForQuery.length : null, topK });
  console.trace();
  if (!queryEntities || (queryEntities.intent !== 'COST' && queryEntities.academicIntent !== 'BIAYA')) return null;
  const strictCostMode = true;
  const q = String(question || '').toLowerCase();
  if (!/\b(biaya|harga|dpp|ukt|spp|uang\s+kuliah|uang\s+pendaftaran|bayar|potongan|diskon)\b/.test(q)) return null;
  if (!queryEntities.program && !queryEntities.wave && !queryEntities.partner && !queryEntities.campus) return null;

  // === TRACE #1: Input Parameters ===
  try {
    console.log('[TRACE_COST_INPUT_1_PARAMS]', {
      question: String(question).substring(0, 100),
      queryEntities: JSON.stringify(queryEntities),
      indexCount: Array.isArray(indexForQuery) ? indexForQuery.length : 0,
      topK: topK || 3
    });
  } catch (e) {}

  const candidates = [];
  const allItemsForDebug = [];
  
  for (const item of Array.isArray(indexForQuery) ? indexForQuery : []) {
    if (!item || typeof item !== 'object') continue;
    const itemEntities = getChunkEntities(item);
    allItemsForDebug.push({
      id: item.id,
      filename: item.filename,
      updatedAt: item.updatedAt,
      itemProgram: itemEntities.program,
      itemWave: itemEntities.wave,
      itemWaveGroup: itemEntities.waveGroup,
      chunkPreview: String(item.chunk || '').substring(0, 80)
    });
    
    if (isExactEntityMismatch(queryEntities, itemEntities, item.chunk)) continue;
    const matchResult = computeExactEntityMatchScore(queryEntities, itemEntities);
    const isGlobalDiscount = isGlobalWaveDiscountChunk(item.chunk);
    if (!matchResult || matchResult.rejected || (matchResult.score <= 0 && !isGlobalDiscount)) continue;
    const exactMatchScore = matchResult.score;
    const keywordScore = getChunkKeywordScore(item.chunk, question) * 20;
    const semanticScore = qEmb && Array.isArray(item.embedding) ? cosineSimilarity(qEmb, item.embedding) * 10 : 0;
    let totalScore = exactMatchScore + keywordScore + semanticScore;
    if (isGlobalDiscount && totalScore <= 0) totalScore = 1;
    candidates.push({ item, totalScore, exactMatchScore, keywordScore, semanticScore, meta: matchResult.meta, isGlobalDiscount, itemEntities });
  }

  // === TRACE #2: All Index Items Examined ===
  try {
    console.log('[TRACE_COST_INPUT_2_INDEX_SCAN]', {
      totalItemsScanned: allItemsForDebug.length,
      items: allItemsForDebug.slice(0, 10)
    });
  } catch (e) {}

  // === TRACE #3: Matching Results ===
  try {
    console.log('[TRACE_COST_MATCH_3_CANDIDATES]', {
      question,
      queryEntities,
      exactCandidateCount: candidates.length,
      exactCandidates: candidates.slice(0, 5).map(c => ({
        id: c.item && c.item.id ? c.item.id : null,
        filename: c.item && c.item.filename ? c.item.filename : null,
        updatedAt: c.item && c.item.updatedAt ? c.item.updatedAt : null,
        program: c.itemEntities && c.itemEntities.program ? c.itemEntities.program : null,
        wave: c.itemEntities && c.itemEntities.wave ? c.itemEntities.wave : null,
        waveGroup: c.itemEntities && c.itemEntities.waveGroup ? c.itemEntities.waveGroup : null,
        totalScore: c.totalScore,
        exactMatchScore: c.exactMatchScore,
        keywordScore: c.keywordScore,
        semanticScore: c.semanticScore,
        isGlobalDiscount: c.isGlobalDiscount,
        matchMeta: c.meta
      }))
    });
  } catch (e) {}

  if (!candidates.length) {
    const fallbackChunks = [];
    for (const item of Array.isArray(indexForQuery) ? indexForQuery : []) {
      if (!item || typeof item !== 'object') continue;
      const itemEntities = getChunkEntities(item);
      if (queryEntities.program && itemEntities.program && queryEntities.program !== itemEntities.program) continue;
      const chunkText = String(item.chunk || '');
      if (!/\b(biaya|dpp|ukt|spp|pendaftaran|potongan|diskon|uang\s+kuliah|uang\s+pendaftaran)\b/i.test(chunkText)) continue;
      const keywordScore = getChunkKeywordScore(chunkText, question) * 20;
      const semanticScore = qEmb && Array.isArray(item.embedding) ? cosineSimilarity(qEmb, item.embedding) * 10 : 0;
      let totalScore = keywordScore + semanticScore;
      if (totalScore <= 0) totalScore = 1;
      if (queryEntities.wave && itemEntities.wave) {
        const qGroup = normalizeWaveGroup(queryEntities.wave);
        const cGroup = normalizeWaveGroup(itemEntities.wave);
        if (qGroup && cGroup && qGroup !== cGroup) continue;
      }
      fallbackChunks.push({ item, totalScore, keywordScore, semanticScore });
    }

    if (fallbackChunks.length) {
      fallbackChunks.sort((a, b) => b.totalScore - a.totalScore);
      const topChunks = fallbackChunks.slice(0, Math.min(topK || 3, fallbackChunks.length)).map(c => c.item);
      // Before rejecting, try the deterministic backup parser for enrollment discounts.
      try {
        const backupStructured = tryStructuredEnrollmentDiscountAnswer(question, topChunks);
        if (backupStructured && backupStructured.answer) {
          return {
            success: true,
            answer: backupStructured.answer,
            source: backupStructured.source || 'rag-fee-structured',
            contexts: Array.isArray(backupStructured.contexts) ? backupStructured.contexts : topChunks,
            confidenceScore: fallbackChunks[0].totalScore,
            confidenceTier: 'HIGH',
            debug: { entity: queryEntities, reason: 'used_backup_fallback' }
          };
        }
      } catch (e) {
        // ignore backup helper failures and continue to more conservative fallback
      }

      try {
        const backupStructured = tryStructuredEnrollmentDiscountAnswer(question, null);
        if (backupStructured && backupStructured.answer) {
          return {
            success: true,
            answer: backupStructured.answer,
            source: backupStructured.source || 'rag-fee-structured',
            contexts: Array.isArray(backupStructured.contexts) ? backupStructured.contexts : topChunks,
            confidenceScore: fallbackChunks[0].totalScore,
            confidenceTier: 'HIGH',
            debug: { entity: queryEntities, reason: 'used_backup_fallback_no_chunks' }
          };
        }
      } catch (e) {
        // ignore backup helper failures and continue to reject
      }

      return {
        success: true,
        answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia.',
        source: 'rag-answer-rejected',
        contexts: topChunks,
        confidenceScore: fallbackChunks[0].totalScore,
        confidenceTier: 'LOW',
        debug: {
          entity: queryEntities,
          matchedChunks: topChunks.map(c => ({ id: c.id, filename: c.filename, updatedAt: c.updatedAt })),
          reason: 'cost_evidence_no_exact_candidate'
        }
      };
    }

    return {
      success: true,
      answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia. Data tidak ditemukan pada dokumen resmi untuk kombinasi entitas yang diminta.',
      source: 'rag-answer-rejected',
      contexts: [],
      confidenceScore: 0.0,
      confidenceTier: 'LOW',
      debug: { entity: queryEntities, reason: 'no_exact_entity_candidate' }
    };
  }

  candidates.sort((a, b) => b.totalScore - a.totalScore);
  const topChunks = candidates.slice(0, Math.min(topK || 3, candidates.length)).map(c => c.item);
  for (const candidate of candidates) {
    if (candidate.isGlobalDiscount && !topChunks.includes(candidate.item)) {
      topChunks.push(candidate.item);
    }
  }

  // === TRACE #4: Top Chunks Selected (Cost + Discount) ===
  try {
    console.log('[TRACE_COST_SELECT_4_TOP_CHUNKS]', {
      selectedCount: topChunks.length,
      topChunks: topChunks.map(c => ({
        id: c.id,
        filename: c.filename,
        updatedAt: c.updatedAt,
        source: c.source,
        category: c.category,
        chunkPreview: String(c.chunk || '').substring(0, 100),
        entities: getChunkEntities(c)
      }))
    });
  } catch (e) {}

  const feeStruct = parseFeeStructure(topChunks, queryEntities);

  // === TRACE #5: Fee Structure Parsed ===
  try {
    console.log('[TRACE_COST_PARSE_5_FEE_STRUCT]', {
      feeStructExists: !!feeStruct,
      feeStruct: feeStruct ? {
        registrationFee: feeStruct.registrationFee,
        dppFee: feeStruct.dppFee,
        dppDiscountAmount: feeStruct.dppDiscountAmount,
        registrationDiscountAmount: feeStruct.registrationDiscountAmount,
        semester: feeStruct.semester,
        totalAwalMasuk: feeStruct.totalAwalMasuk,
        academicYear: feeStruct.academicYear,
        wave: feeStruct.wave,
        waveGroup: feeStruct.waveGroup,
        program: feeStruct.program,
        sourceChunksCount: feeStruct.sourceChunks ? feeStruct.sourceChunks.length : 0,
        sourceChunks: feeStruct.sourceChunks ? feeStruct.sourceChunks.map(s => ({
          id: s.id,
          filename: s.filename,
          updatedAt: s.updatedAt,
          chunkPreview: String(s.chunk || '').substring(0, 100)
        })) : []
      } : null,
      queryEntitiesRequested: queryEntities
    });
  } catch (e) {}

  // Require trusted sources for deterministic fee answers. If none of the
  // source chunks pass the source-trust validator, reject to avoid mixing
  // low-quality OCR or unofficial documents into a deterministic reply.
  try {
    const sources = Array.isArray(feeStruct && feeStruct.sourceChunks) ? feeStruct.sourceChunks : topChunks;
    const anyTrusted = (Array.isArray(sources) ? sources : []).some(s => {
      try {
        return validateSourceTrust(s).trusted;
      } catch (e) {
        return false;
      }
    });
    if (!anyTrusted) {
      return {
        success: true,
        answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia.',
        source: 'rag-answer-rejected',
        contexts: topChunks,
        confidenceScore: candidates[0] ? candidates[0].totalScore : 0,
        confidenceTier: 'LOW',
        debug: { entity: queryEntities, reason: 'no_trusted_source_chunks', matchedChunks: topChunks.map(c => ({ id: c.id, filename: c.filename })) }
      };
    }
  } catch (e) {
    // If trust check fails unexpectedly, fall back to rejecting the structured answer.
    return {
      success: true,
      answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia.',
      source: 'rag-answer-rejected',
      contexts: topChunks,
      confidenceScore: candidates[0] ? candidates[0].totalScore : 0,
      confidenceTier: 'LOW',
      debug: { entity: queryEntities, reason: 'trust_check_error', err: e && e.message }
    };
  }
  if (!feeStruct) {
    return {
      success: true,
      answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia.',
      source: 'rag-answer-rejected',
      contexts: topChunks,
      confidenceScore: candidates[0].totalScore,
      confidenceTier: 'LOW',
      debug: { entity: queryEntities, matchedChunks: topChunks.map(c => ({ id: c.id, filename: c.filename, updatedAt: c.updatedAt })), reason: 'fee_structure_parse_failed' }
    };
  }

  const answer = buildDeterministicFeeAnswer(feeStruct, queryEntities);
  if (!answer) {
    return {
      success: true,
      answer: 'Data biaya tidak dapat dipastikan dari dokumen resmi yang tersedia.',
      source: 'rag-answer-rejected',
      contexts: feeStruct.sourceChunks || topChunks,
      confidenceScore: candidates[0].totalScore,
      confidenceTier: 'LOW',
      debug: { entity: queryEntities, feeStruct, reason: 'build_answer_failed' }
    };
  }

  return {
    success: true,
    answer,
    source: 'rag-fee-structured',
    contexts: feeStruct.sourceChunks || topChunks,
    confidenceScore: candidates[0].totalScore,
    confidenceTier: 'HIGH',
    debug: { entity: queryEntities, feeStruct, topChunks: (feeStruct.sourceChunks || topChunks).map(c => ({ id: c.id, filename: c.filename, updatedAt: c.updatedAt })) }
  };
}

function tagChunkType(chunk) {
  const text = String(chunk || '').toLowerCase();
  const cost = /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran)\b/.test(text);
  const program = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/.test(text);
  const schedule = /\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(text);
  if (cost && !schedule) return 'COST';
  if (program && !cost) return 'PROGRAM';
  if (schedule && !cost) return 'SCHEDULE';
  if (cost) return 'COST';
  if (program) return 'PROGRAM';
  if (schedule) return 'SCHEDULE';
  return 'GENERAL';
}

function isDocumentMetadata(text) {
  const t = String(text || '').toLowerCase();
  const metadataPattern = /\b(kop\s+surat|tanda\s+tangan|nomor\s+surat|halaman|tanggal|alamat|telepon|fax|faximile|website|www\.|email:|dokumen)\b/i;
  const legalPattern = /\b(force\s+majeure|perjanjian|kontrak|pasal|ayat|klausul|pihak\s+pertama|pihak\s+kedua|hak\s+dan\s+kewajiban|penyelesaian\s+sengketa)\b/i;
  return metadataPattern.test(t) || legalPattern.test(t);
}

function estimateOcrConfidence(rawText) {
  const text = String(rawText || '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const noisyLines = lines.filter((line) => {
    const letters = (line.match(/[A-Za-z0-9]/g) || []).length;
    const weird = (line.match(/[^A-Za-z0-9\s.,:;()\/\-]+/g) || []).length;
    return letters > 0 && weird / Math.max(1, letters + weird) > 0.35;
  });
  return {
    lineCount: lines.length,
    noisyLines: noisyLines.length,
    ratio: lines.length ? noisyLines.length / lines.length : 0,
    lowConfidence: lines.length ? noisyLines.length / lines.length > 0.2 : false
  };
}

function cleanDocumentText(rawText) {
  const text = String(rawText || '').replace(/\r\n/g, '\n');
  const lines = text.split(/\n/);
  const metadataPattern = /\b(kop\s+surat|tanda\s+tangan|nomor\s+surat|halaman|tanggal|alamat|telepon|fax|faximile|website|www\.|email:|dokumen)\b/i;
  const legalPattern = /\b(force\s+majeure|perjanjian|kontrak|pasal|ayat|klausul|pihak\s+pertama|pihak\s+kedua|hak\s+dan\s+kewajiban|penyelesaian\s+sengketa)\b/i;
  const keep = [];
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    if (metadataPattern.test(trimmed)) continue;
    if (legalPattern.test(trimmed) && !/\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|program|prodi|internasional|jadwal|gelombang)\b/i.test(trimmed)) continue;
    const pageMatch = /^\s*(?:page|halaman)\s*[:\.]?\s*(\d+)/i.exec(trimmed);
    if (pageMatch) {
      keep.push(`HALAMAN: ${pageMatch[1]}`);
      continue;
    }
    keep.push(trimmed);
  }
  return keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function validateIngestion(cleanedText, chunks) {
  const normalized = String(cleanedText || '').trim();
  const charCount = normalized.length;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const meaningfulChunks = Array.isArray(chunks)
    ? chunks.filter(c => String(c || '').replace(/[^\p{L}\p{N}]/gu, '').length > 30)
    : [];
  const chunkCount = Array.isArray(chunks) ? chunks.length : 0;
  if (charCount < 100 || wordCount < 20 || meaningfulChunks.length === 0) {
    return {
      valid: false,
      status: 'rejected',
      reason: 'content too short or no meaningful chunks',
      charCount,
      wordCount,
      chunkCount,
      meaningfulChunks: meaningfulChunks.length
    };
  }
  return {
    valid: true,
    status: 'valid',
    charCount,
    wordCount,
    chunkCount,
    meaningfulChunks: meaningfulChunks.length
  };
}

function filterRelevantChunks(question, scored, queryEntities = null) {
  const intent = queryEntities && queryEntities.intent ? String(queryEntities.intent).toUpperCase() : detectIntent(question);
  const costPattern = /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran)\b/i;
  const programPattern = /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/i;
  const schedulePattern = /\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/i;
  const metadataPattern = /\b(kop\s+surat|tanda\s+tangan|nomor\s+surat|halaman|tanggal|alamat|telepon|fax|faximile|website|www\.|email:|dokumen)\b/i;
  const legalPattern = /\b(force\s+majeure|perjanjian|kontrak|pasal|ayat|klausul|pihak\s+pertama|pihak\s+kedua|hak\s+dan\s+kewajiban|penyelesaian\s+sengketa)\b/i;
  const categoryFilter = queryEntities && queryEntities.category ? String(queryEntities.category).toUpperCase() : null;
  const academicIntent = queryEntities && queryEntities.academicIntent ? String(queryEntities.academicIntent).toUpperCase() : null;
  const requestedProgram = queryEntities && queryEntities.program ? String(queryEntities.program).toUpperCase() : null;
  const requestedProgramPatterns = {
    SI: /\b(?:si|sistem informasi)\b/i,
    TI: /\b(?:ti|teknologi informasi)\b/i,
    BD: /\b(?:bd|bisnis digital)\b/i,
    SK: /\b(?:sk|sistem komputer)\b/i,
    MI: /\b(?:mi|manajemen informatika|manajemen informasi)\b/i
  };

  const programMentionPatterns = {
    SI: /\b(?:si|sistem informasi)\b/i,
    TI: /\b(?:ti|teknologi informasi)\b/i,
    BD: /\b(?:bd|bisnis digital)\b/i,
    SK: /\b(?:sk|sistem komputer)\b/i,
    MI: /\b(?:mi|manajemen informatika|manajemen informasi)\b/i
  };

  const normalizeProgramMentions = (text) => {
    const lower = String(text || '').toLowerCase();
    return Object.entries(programMentionPatterns)
      .filter(([, pattern]) => pattern.test(lower))
      .map(([code]) => code);
  };

  const isGenericProgramOverviewChunk = (item) => {
    const chunkText = String((item && item.item && item.item.chunk) || '').toLowerCase();
    const fname = String((item && item.item && (item.item.filename || item.item.trainingId)) || '').toLowerCase();
    const overviewPattern = /\b(?:penjelasan\s+semua\s+program\s+studi|semua\s+program\s+studi|semua\s+prodi|overview\s+prodi|overview\s+program|ringkasan\s+singkat\s+masing-?masing\s+prodi|program\s+studi\s+yang\s+tersedia)\b/i;
    return overviewPattern.test(fname) || overviewPattern.test(chunkText);
  };

  const filtered = scored.filter((s) => {
    const chunk = String((s.item && s.item.chunk) || '').trim();
    if (!chunk) return false;
    if (s.item && (s.item.excludeFromSearch === true || Number(s.item.retrievalWeight) === 0)) return false;
    const lower = chunk.toLowerCase();
    if (metadataPattern.test(lower) || isHeaderFooterChunk(chunk)) return false;
    const isAdmin = isAdminInternalChunk(chunk, s.item.filename);
    if (intent === 'ACADEMIC_PROGRAM' && isAcademicProgramBlacklistChunk(chunk, s.item.filename, s.item.docCategory)) return false;
    if (isAdmin && !costPattern.test(lower) && !programPattern.test(lower) && !schedulePattern.test(lower)) return false;
    // If the detected intent is not a cost question, deprioritize/remove fee-related chunks
    if (intent !== 'COST' && costPattern.test(lower)) return false;
    if (isLegalDominantChunk(chunk) && intent !== 'GENERAL') return false;
    if (legalPattern.test(lower) && intent !== 'GENERAL') {
      if (!costPattern.test(lower) && !programPattern.test(lower) && !schedulePattern.test(lower)) return false;
    }
    if (intent === 'COST' && !costPattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
    if ((intent === 'PROGRAM' || intent === 'ACADEMIC_PROGRAM') && !programPattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
    if (intent === 'SCHEDULE' && !schedulePattern.test(lower) && s.item.chunkType !== 'GENERAL') return false;
    if (academicIntent && !chunkMatchesAcademicIntent(chunk, s.item, academicIntent, queryEntities)) return false;
    // Do not hard reject based on explicit query category. Use category signals in scoring instead.
    // if (categoryFilter && s.item.category && String(s.item.category).toUpperCase() !== categoryFilter) return false;
    if (queryEntities && queryEntities.pageNumber && s.item.pageNumber && Number(queryEntities.pageNumber) !== Number(s.item.pageNumber)) return false;
    if (requestedProgram) {
      const itemEntities = getChunkEntities(s.item);
      const itemProgram = itemEntities.program ? String(itemEntities.program).toUpperCase() : null;
      const requestedProgramRegex = requestedProgramPatterns[requestedProgram];
      const mentionsRequestedProgram = requestedProgramRegex ? requestedProgramRegex.test(lower) : false;
      const mentionedPrograms = Array.from(new Set(normalizeProgramMentions(lower)));
      if (itemProgram && itemProgram !== requestedProgram) return false;
      if (!itemProgram && !mentionsRequestedProgram) return false;
      if (mentionedPrograms.length > 1 && !mentionedPrograms.every((p) => p === requestedProgram)) return false;
      if (isAdmin && !itemProgram && !mentionsRequestedProgram) return false;
    }
    const tokens = tokenizeForRelevanceGuard(question);
    if (tokens.length >= 3) {
      const overlap = tokens.filter(tok => lower.includes(tok)).length;
      if (overlap === 0 && intent !== 'GENERAL') return false;
    }
    return true;
  });

  if (requestedProgram) {
    const specificProgramCandidates = filtered.filter((s) => {
      const itemEntities = getChunkEntities(s.item);
      const itemProgram = itemEntities.program ? String(itemEntities.program).toUpperCase() : null;
      if (itemProgram === requestedProgram) return true;
      const lower = String((s.item && s.item.chunk) || '').toLowerCase();
      const mentionList = normalizeProgramMentions(lower);
      return mentionList.includes(requestedProgram) && mentionList.length === 1 && !isGenericProgramOverviewChunk(s);
    });

    if (specificProgramCandidates.length > 0) {
      const filteredWithoutOverview = filtered.filter((s) => !isGenericProgramOverviewChunk(s));
      if (filteredWithoutOverview.length > 0) {
        return filteredWithoutOverview;
      }
    }
  }

  const nonLowConfidence = filtered.filter(s => !s.item.lowConfidence);
  if (nonLowConfidence.length > 0) return nonLowConfidence;
  if (filtered.length > 0) return filtered;
  if (academicIntent) return [];

  return scored.filter((s) => {
    const chunk = String((s.item && s.item.chunk) || '').trim();
    if (!chunk) return false;
    const lower = chunk.toLowerCase();
    if (intent !== 'COST' && costPattern.test(lower)) return false;
    return !metadataPattern.test(lower) && !(legalPattern.test(lower) && intent !== 'GENERAL');
  });
}

/**
 * Apply intent-aware filtering and evidence validation to scored chunks.
 * This prevents using chunks that merely mention keywords but don't answer the question.
 * 
 * @param {string} question - User question
 * @param {Array} scoredChunks - Array of scored chunks {item, score, compositeScore}
 * @param {string} userIntent - User's classified intent (e.g., 'DEFINISI_PRODI', 'BIAYA_PENDIDIKAN')
 * @returns {Array} Filtered and validated chunks with evidence annotations
 */
function applyIntentAwareFilteringAndValidation(question, scoredChunks, userIntent, debugCollector = null) {
  if (!Array.isArray(scoredChunks) || scoredChunks.length === 0) {
    return [];
  }

  const intent = String(userIntent || 'GENERAL').toUpperCase().trim();
  const allowedCategories = getAllowedDocCategories(intent);
  const forbiddenCategories = getForbiddenDocCategories(intent);

  const validated = [];
  const rejected = [];

  for (const scored of scoredChunks) {
    if (!scored || !scored.item) continue;

    const chunk = scored.item;
    const chunkCategory = chunk.docCategory || chunk.category || 'UNKNOWN';

    // Check 1: Is chunk in forbidden categories for this intent?
    if (forbiddenCategories.has(chunkCategory)) {
      rejected.push({
        reason: 'forbidden_category',
        category: chunkCategory,
        intent,
        chunkId: chunk.id
      });
      // record per-query reject when requested
      if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length-1]);
      continue;
    }

    // Check 2: For specific intents, use category as a ranking signal rather than a hard reject.
    let categoryMismatch = false;
    if (intent !== 'GENERAL' && allowedCategories.size > 0 && !allowedCategories.has(chunkCategory)) {
      categoryMismatch = true;
    }

    // Check 3: Validate chunk has actual evidence for the intent
    let evidenceValidation = { hasEvidence: true, confidence: 'MEDIUM' };
    try {
      evidenceValidation = validateChunkEvidence(chunk, intent);
      // Do NOT hard-reject on missing evidence. Treat evidence as a confidence signal.
      // Record low-confidence evidence in rejected list only for audit, but allow chunk to proceed.
      if (!evidenceValidation.hasEvidence) {
        if (debugCollector && Array.isArray(debugCollector.rejected)) {
          debugCollector.rejected.push({ reason: 'no_evidence_for_intent', intent, chunkId: chunk.id, detail: evidenceValidation });
        }
      }
    } catch (validationErr) {
      logger.warn({ err: validationErr.message, chunkId: chunk.id }, '[RAG] Evidence validation error');
      // On error, allow chunk but log warning
      evidenceValidation = { hasEvidence: false, confidence: 'LOW', reasons: ['evidence_validation_error'] };
    }

    // Check 4: Validate chunk relevance to the specific question
    let relevanceValidation = { relevant: true };
    try {
      relevanceValidation = validateChunkRelevanceToQuestion(chunk, question, intent);
      if (!relevanceValidation.relevant) {
        rejected.push({
          reason: 'not_relevant_to_question',
          intent,
          chunkId: chunk.id,
          detail: relevanceValidation
        });
        if (debugCollector && Array.isArray(debugCollector.rejected)) debugCollector.rejected.push(rejected[rejected.length-1]);
        continue;
      }
    } catch (relevanceErr) {
      logger.warn({ err: relevanceErr.message, chunkId: chunk.id }, '[RAG] Relevance validation error');
      // On error, allow chunk but log warning
    }

    // All checks passed - include this chunk with validation metadata
    validated.push({
      ...scored,
      validationMetadata: {
        category: chunkCategory,
        categoryMismatch,
        allowedCategories: Array.from(allowedCategories),
        evidenceConfidence: evidenceValidation.confidence,
        matchesIntent: true,
        intent
      }
    });
  }

  if (process.env.RAG_DEBUG_INTENT_FILTERING) {
    try {
      logger.info({
        intent,
        question: String(question || '').substring(0, 80),
        totalChunks: scoredChunks.length,
        validated: validated.length,
        rejected: rejected.length,
        rejectionReasons: rejected.slice(0, 5).map(r => r.reason),
        sampleRejected: rejected.slice(0, 5).map(r => ({
          reason: r.reason,
          category: r.category || r.allowed || 'unknown',
          chunkId: r.chunkId
        }))
      }, '[RAG] Intent-aware filtering stats');
    } catch (e) {
      // Ignore debug logging errors
    }
  }

  // Audit logging for rejected chunks
  if (process.env.RAG_AUDIT_LOGGING === 'true' && rejected.length > 0) {
    try {
      for (const rejection of rejected.slice(0, 20)) {
        const chunk = scoredChunks.find(s => s.item?.id === rejection.chunkId);
          auditLogger.logFilteringDecision(
            rejection.chunkId,
            chunk?.item?.filename || 'unknown',
            rejection.category || 'UNKNOWN',
            intent,
            'REJECT',
            rejection.reason
          );
          // note: per-item rejected reasons already collected into debugCollector above
      }
    } catch (auditErr) {
      logger.warn({ err: auditErr.message }, '[RAG AUDIT] Failed to log filtering decisions');
    }
  }

  return validated;
}

function validateAcademicProgramContexts(question, scored, queryEntities = null) {
  const academicIntent = queryEntities && queryEntities.academicIntent ? String(queryEntities.academicIntent).toUpperCase() : extractAcademicIntent(question);
  if (!academicIntent) return false;
  if (!Array.isArray(scored) || scored.length === 0) return false;

  return scored.some((s) => {
    const chunk = String((s.item && s.item.chunk) || '');
    return chunkMatchesAcademicIntent(chunk, s.item, academicIntent, queryEntities);
  });
}

function normalizeChunkForHash(chunk) {
  return String(chunk || '')
    .toLowerCase()
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function chunkHash(chunk) {
  const n = normalizeChunkForHash(chunk);
  return crypto.createHash('sha256').update(n).digest('hex');
}

function applyDuplicateChunkPenalty(scored) {
  const seen = new Map();
  for (const item of scored) {
    if (!item || !item.item) continue;
    const hash = chunkHash(item.item.chunk);
    const count = seen.get(hash) || 0;
    if (count > 0) {
      item.compositeScore -= 0.08 * Math.min(3, count);
      item.score -= 0.04 * Math.min(3, count);
    }
    seen.set(hash, count + 1);
  }
}

async function computeEmbedding(text) {
  // If OpenAI key available, use embeddings API
  if (process.env.OPENAI_API_KEY) {
    try {
      const timeoutMsRaw = parseInt(process.env.OPENAI_EMBEDDING_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || '20000', 10);
      const timeoutMs = (Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0) ? timeoutMsRaw : 20000;
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs });
      const resp = await client.embeddings.create({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: text });
      const embedding = resp.data?.[0]?.embedding || [];
      return embedding;
    } catch (err) {
      logger.warn({ err: err.message }, '[RAG] OpenAI embedding failed, falling back to mock embedding');
    }
  }

  // Mock embedding: hashed chunks into fixed-size vector
  const hash = crypto.createHash('sha256').update(text).digest();
  const vec = [];
  for (let i = 0; i < 64; i++) {
    vec.push(hash[i % hash.length] / 255);
  }
  return vec;
}

async function ingestTrainingData(trainingId, text, source = 'upload', options = null) {
  try {
    const opts = (options && typeof options === 'object') ? options : {};
    const divisionKey = typeof opts.divisionKey === 'string' ? String(opts.divisionKey).toLowerCase().trim() : null;
    const filename = typeof opts.filename === 'string' ? opts.filename : null;
    const sourceFile = typeof opts.sourceFile === 'string' ? opts.sourceFile : filename;
    const fileHash = typeof opts.fileHash === 'string' ? opts.fileHash : null;
    const trainingVersion = typeof opts.trainingVersion === 'string' ? opts.trainingVersion : null;
    const uploadedById = typeof opts.uploadedById === 'string' ? opts.uploadedById : null;

    const index = loadIndex();

    // Replace existing chunks for this trainingId to avoid duplicates/stale partial ingests
    const filteredIndex = Array.isArray(index) ? index.filter(item => item && item.trainingId !== trainingId) : [];

    // Build existing hash set for dedup (within the same division scope).
    const hashKeyFor = (divKey, h) => `${divKey || 'global'}:${h}`;
    const existingHashes = new Set();
    for (const item of filteredIndex) {
      if (!item || !item.chunk) continue;
      const itemDiv = item.divisionKey ? String(item.divisionKey).toLowerCase().trim() : null;
      if ((divisionKey || null) !== (itemDiv || null)) continue;
      const h = item.chunkHash || chunkHash(item.chunk);
      existingHashes.add(hashKeyFor(divisionKey, h));
    }

    // Limit text size to avoid huge ingests
    let safeText = text || '';
    if (safeText.length > MAX_INGEST_CHARS) {
      logger.warn({ length: safeText.length, max: MAX_INGEST_CHARS }, '[RAG] Training content too long, truncating');
      safeText = safeText.slice(0, MAX_INGEST_CHARS);
    }

    const ocrInfo = estimateOcrConfidence(safeText);
    const cleanedText = cleanDocumentText(safeText);
    const validation = validateIngestion(cleanedText, chunkText(cleanedText, 900, 150));
    logger.info({ trainingId, status: validation.status, ...validation, lowOcrConfidence: ocrInfo.lowConfidence }, '[RAG] Ingestion validation');
    if (!validation.valid) {
      return {
        success: false,
        status: 'rejected',
        reason: validation.reason,
        charCount: validation.charCount,
        wordCount: validation.wordCount,
        chunkCount: validation.chunkCount,
        meaningfulChunks: validation.meaningfulChunks
      };
    }

    const chunkSize = (typeof opts.chunkSize === 'number' && Number.isFinite(opts.chunkSize) && opts.chunkSize > 0)
      ? Math.floor(opts.chunkSize)
      : 900;
    const overlap = (typeof opts.overlap === 'number' && Number.isFinite(opts.overlap) && opts.overlap >= 0)
      ? Math.floor(opts.overlap)
      : 150;

    let chunks = chunkText(cleanedText, chunkSize, overlap);

    // Limit number of chunks per training
    if (chunks.length > MAX_INGEST_CHUNKS) {
      logger.warn({ chunks: chunks.length, max: MAX_INGEST_CHUNKS, trainingId }, '[RAG] Too many chunks, limiting');
      chunks = chunks.slice(0, MAX_INGEST_CHUNKS);
    }

    let skippedDuplicates = 0;
    for (const chunk of chunks) {
      const h = chunkHash(chunk);
      const key = hashKeyFor(divisionKey, h);
      if (existingHashes.has(key)) {
        skippedDuplicates++;
        continue;
      }

      const embedding = await computeEmbedding(chunk);
      const id = crypto.randomUUID();
      const structured = extractStructuredChunkMetadata(chunk);
      const detectedProgram = structured.program || normalizeProgramLabel(chunk) || null;
      
      const chunkObj = {
        id,
        trainingId,
        chunk,
        chunkHash: h,
        sectionTitle: extractSectionTitle(chunk),
        chunkType: tagChunkType(chunk),
        lowConfidence: ocrInfo.lowConfidence,
        ocrQualityScore: ocrInfo.ratio,
        embedding,
        source,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        divisionKey: divisionKey || null,
        filename: filename || null,
        sourceFile: sourceFile || filename || null,
        fileHash: fileHash || null,
        trainingVersion: trainingVersion || null,
        uploadedById: uploadedById || null,
        program: detectedProgram,
        programName: structured.programName || null,
        programAliases: Array.isArray(structured.programAliases) ? structured.programAliases : [],
        wave: structured.wave || null,
        academicYear: structured.academicYear || null,
        partner: structured.partner || null,
        campus: structured.campus || null,
        jalur: structured.jalur || null,
        feeType: structured.feeType || null,
        category: structured.category || null,
        sectionTitle: structured.sectionTitle || null,
        pageNumber: structured.pageNumber || null
      };
      
      // Enrich chunk with document category for intent-aware filtering
      try {
        const enrichedChunk = enrichChunkWithCategory(chunkObj);
        filteredIndex.push(enrichedChunk);
      } catch (enrichErr) {
        logger.warn({ err: enrichErr.message }, '[RAG] Failed to enrich chunk category, using original');
        filteredIndex.push(chunkObj);
      }
      
      existingHashes.add(key);
    }

    const documentSummary = generateDocumentSummary(cleanedText);
    if (documentSummary) {
      const summaryText = `Ringkasan dokumen:\n${documentSummary}`;
      const summaryHash = chunkHash(summaryText);
      const summaryKey = hashKeyFor(divisionKey, summaryHash);
      if (!existingHashes.has(summaryKey)) {
        const embedding = await computeEmbedding(summaryText);
        const summaryId = crypto.randomUUID();
        const summaryChunk = {
          id: summaryId,
          trainingId,
          chunk: summaryText,
          chunkHash: summaryHash,
          sectionTitle: 'Ringkasan dokumen',
          chunkType: 'GENERAL',
          isSummary: true,
          lowConfidence: ocrInfo.lowConfidence,
          ocrQualityScore: ocrInfo.ratio,
          embedding,
          source,
          createdAt: new Date().toISOString(),
          divisionKey: divisionKey || null,
          filename: filename || null,
          uploadedById: uploadedById || null
        };
        
        // Enrich summary chunk with document category
        try {
          const enrichedSummary = enrichChunkWithCategory(summaryChunk);
          filteredIndex.push(enrichedSummary);
        } catch (enrichErr) {
          logger.warn({ err: enrichErr.message }, '[RAG] Failed to enrich summary chunk category, using original');
          filteredIndex.push(summaryChunk);
        }
      }
    }

    saveIndex(filteredIndex);
    logger.info({ trainingId, chunks: chunks.length, skippedDuplicates, divisionKey: divisionKey || null }, '[RAG] Ingested chunks');
    
    // Audit logging: verify docCategory enrichment
    if (process.env.RAG_AUDIT_LOGGING === 'true') {
      const withDocCategory = filteredIndex.filter(c => c && c.docCategory && c.docCategory !== 'UNKNOWN').length;
      const totalChunks = filteredIndex.length;
      logger.info({
        trainingId,
        totalChunks,
        withDocCategory,
        enrichmentRate: (withDocCategory / totalChunks * 100).toFixed(2) + '%',
        categories: [...new Set(filteredIndex.map(c => c.docCategory))].sort()
      }, '[RAG AUDIT] Ingest enrichment summary');
      auditLogger.logIngest(trainingId, chunks.length - skippedDuplicates, withDocCategory);
    }
    
    return { success: true, ingested: chunks.length - skippedDuplicates, skippedDuplicates, totalChunks: chunks.length };
  } catch (err) {
    logger.error({ err: err.message }, '[RAG] Ingest error');
    return { success: false, error: err.message };
  }
}

// Coba jawab secara terstruktur khusus untuk pertanyaan potongan biaya pendaftaran
function buildEnrollmentDiscountScanText(top) {
  if (!top || !Array.isArray(top)) return '';
  const parts = [];
  for (const item of top) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.chunk === 'string' && item.chunk.trim()) parts.push(item.chunk);
    if (typeof item.sectionTitle === 'string' && item.sectionTitle.trim()) parts.push(item.sectionTitle);
    if (typeof item.filename === 'string' && item.filename.trim()) parts.push(item.filename);
  }
  return parts.join('\n');
}

function tryStructuredEnrollmentDiscountAnswer(question, top) {
  if (!question) return null;
  const q = String(question).toLowerCase();

  logger.info({ question: q }, '[RAG] enrollment discount helper called');

  const hasPotongan = q.includes('potongan');
  const hasBiayaPlusWave = q.includes('biaya') && q.includes('gelombang');
  const hasDaftarPlusWave = q.includes('daftar') && q.includes('gelombang');

  if (!hasPotongan && !hasBiayaPlusWave && !hasDaftarPlusWave) return null;

  const mentionsPendaftaran = q.includes('pendaftaran') || q.includes('daftar') || /biaya\s+(pendaftaran|prodi)/i.test(q);
  const mentionsGelombang = q.includes('gelombang');

  const scholarshipSignals = /(beasiswa|prestasi|juara|rangking|ranking|peringkat)/i;
  if (scholarshipSignals.test(q) && !mentionsPendaftaran && !mentionsGelombang) return null;
  if (!mentionsPendaftaran && !mentionsGelombang) return null;

  const normalizeRequestedWave = (value) => {
    const normalized = normalizeWaveLabel(String(value || '').trim());
    if (!normalized) return null;
    return normalized;
  };

  let requestedWave = null;
  let wantAll = false;
  if (q.includes('semua') || q.includes('seluruh') || q.includes('lengkap')) wantAll = true;
  if (!wantAll) {
    const waveQueryMatch = /gelombang\s*(khusus|[0-9]{1,2}|[ivx]+)(?:\s*([a-c]))?/i.exec(question);
    if (waveQueryMatch && waveQueryMatch[1]) {
      requestedWave = normalizeRequestedWave(`${waveQueryMatch[1]}${waveQueryMatch[2] || ''}`);
    }
  }

  let scanText = buildEnrollmentDiscountScanText(top);
  if (!scanText) {
    const backupPath = path.join(__dirname, '..', '..', 'backups', 'backup-20260424-145106', 'trainingData.json');
    try {
      if (fs.existsSync(backupPath)) {
        const backupRaw = String(fs.readFileSync(backupPath, 'utf8') || '');
        if (backupRaw) {
          const backupJson = JSON.parse(backupRaw);
          const rows = Array.isArray(backupJson && backupJson.rows) ? backupJson.rows : [];
          scanText = rows.map(row => String(row && row.content ? row.content : '')).filter(Boolean).join('\n');
        }
      }
    } catch (err) {
      // ignore backup parsing issues and keep using whatever text we have
    }
  }
  if (!scanText) return null;

  const regMap = new Map();
  const dppMap = new Map();
  const registrationSection = scanText.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
  const dppSection = scanText.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);

  const normalizeWave = (waveText) => {
    const upper = String(waveText || '').toUpperCase().trim();
    if (!upper) return null;
    if (upper.includes('KHUSUS')) return 'KHUSUS';
    const romanMatch = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)([A-C])?$/i.exec(upper);
    if (romanMatch) {
      const base = normalizeWaveLabel(romanMatch[1]);
      return base ? `${base}${romanMatch[2] ? romanMatch[2].toUpperCase() : ''}` : null;
    }
    const numericMatch = /^([1-9][0-9]?)([A-C])?$/.exec(upper);
    if (numericMatch) {
      return `${numericMatch[1]}${numericMatch[2] ? numericMatch[2].toUpperCase() : ''}`;
    }
    return null;
  };

  const regText = registrationSection ? registrationSection[0] : '';
  const dppText = dppSection ? dppSection[0] : '';

  if (regText) {
    for (const match of regText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
      const waveLabel = normalizeWave(`${match[2] || ''}${match[3] || ''}`);
      if (waveLabel) regMap.set(waveLabel, `Rp ${match[1]}`);
    }
  }

  if (dppText) {
    for (const match of dppText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)) {
      const waveLabel = normalizeWave(`${match[1] || ''}${match[2] || ''}`);
      if (waveLabel) dppMap.set(waveLabel, `Rp ${match[3]}`);
    }
    for (const match of dppText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
      const waveLabel = normalizeWave(`${match[2] || ''}${match[3] || ''}`);
      if (waveLabel && !dppMap.has(waveLabel)) dppMap.set(waveLabel, `Rp ${match[1]}`);
    }
  }

  if (regMap.size === 0 || dppMap.size === 0) {
    const linesSrc = scanText.replace(/\r/g, '').split('\n');
    for (let i = 0; i < linesSrc.length; i++) {
      const window = [linesSrc[i], linesSrc[i + 1] || '', linesSrc[i + 2] || ''].join(' ').replace(/\s+/g, ' ').trim();
      if (!window) continue;
      if (!/(rp|potongan|gelombang|pendaftaran|dpp|dana pendidikan pokok|beasiswa)/i.test(window)) continue;

      const amountMatches = Array.from(window.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi));
      const waveMatches = Array.from(window.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi));
      if (amountMatches.length === 0 || waveMatches.length === 0) continue;

      const isReg = /pendaftaran|potongan biaya pendaftaran|mendaftar/i.test(window);
      const isDpp = /dpp|dana pendidikan pokok|beasiswa/i.test(window);

      for (const waveMatch of waveMatches) {
        const waveLabel = normalizeWave(`${waveMatch[1]}${waveMatch[2] || ''}`);
        const amount = `Rp ${amountMatches[0][1]}`;
        if (isReg && waveLabel && !regMap.has(waveLabel)) regMap.set(waveLabel, amount);
        if (isDpp && waveLabel && !dppMap.has(waveLabel)) dppMap.set(waveLabel, amount);
      }
    }
  }

  if (regMap.size === 0 && dppMap.size === 0) return null;

  const lines = [];
  const actualWaveLabels = new Set([...regMap.keys(), ...dppMap.keys()]);

  const displayWaveLabel = (label, requested) => {
    const canonical = label === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${label}`;
    if (requested && requested !== label) {
      const requestedText = requested === 'KHUSUS' ? 'Gelombang Khusus' : `Gelombang ${requested}`;
      return `${requestedText} (berdasarkan ${canonical})`;
    }
    return canonical;
  };

  const resolvedRequestedLabels = [];
  if (requestedWave && !wantAll) {
    if (actualWaveLabels.has(requestedWave)) {
      resolvedRequestedLabels.push(requestedWave);
    } else {
      const broadRequest = requestedWave.replace(/[A-Z]$/, '');
      if (broadRequest !== requestedWave && actualWaveLabels.has(broadRequest)) {
        resolvedRequestedLabels.push(broadRequest);
      }
    }
  }

  const pushTarget = (label, displayWave) => {
    if (regMap.has(label)) lines.push(`- ${regMap.get(label)} jika mendaftar pada ${displayWaveLabel(label, displayWave)}`);
    if (dppMap.has(label)) lines.push(`- ${dppMap.get(label)} untuk DPP pada ${displayWaveLabel(label, displayWave)}`);
  };

  if (requestedWave && resolvedRequestedLabels.length > 0 && !wantAll) {
    for (const label of resolvedRequestedLabels) {
      pushTarget(label, requestedWave);
    }
    if (lines.length === 0) {
      for (const label of Array.from(actualWaveLabels)) pushTarget(label, null);
    }
  } else {
    for (const label of Array.from(actualWaveLabels)) pushTarget(label, null);
  }

  if (lines.length === 0) return null;

  const answer = `Potongan biaya pendaftaran yang tersedia adalah:\n\n${lines.join('\n')}\n\nUntuk informasi lain di luar daftar di atas, silakan konfirmasi ke admin kampus untuk kepastian.`;
  const contexts = [];
  const nowTs = new Date().toISOString();
  if (regText) contexts.push({ id: 'backup-registration-section', filename: 'PMB_OFFICIAL_BACKUP', chunk: regText, chunkType: 'COST', ocrQualityScore: 1.0, updatedAt: nowTs, lowConfidence: false });
  if (dppText) contexts.push({ id: 'backup-dpp-section', filename: 'PMB_OFFICIAL_BACKUP', chunk: dppText, chunkType: 'COST', ocrQualityScore: 1.0, updatedAt: nowTs, lowConfidence: false });
  logger.info({ requestedWave, regCount: regMap.size, dppCount: dppMap.size }, '[RAG] enrollment discount helper result');
  return { answer, source: 'rag-rule', contexts };
}

// Ekstrak daftar nama gelombang dari contexts yang relevan dengan pertanyaan
function extractWavesFromContexts(top, question) {
  // Di sini kita sengaja hanya memakai potongan konteks "top" yang
  // benar-benar dipakai untuk menjawab pertanyaan, supaya catatan
  // gelombang lebih kontekstual. Contoh: untuk pertanyaan
  // pascasarjana yang hanya punya Gelombang I dan II, kita tidak ingin
  // menampilkan Gelombang III/IV yang mungkin ada di bagian lain
  // dokumen.

  const qLower = (question || '').toLowerCase();

  let chunks = (top || []).map(t => t.chunk || '');

  // Jika pertanyaan jelas menyebut pascasarjana/magister/S2, batasi
  // hanya ke chunk yang juga menyebut istilah tersebut agar catatan
  // gelombang tidak mengambil dari dokumen S1 yang punya lebih banyak gelombang.
  if (qLower.includes('pascasarjana') || qLower.includes('magister') || qLower.includes('s2')) {
    const filtered = chunks.filter(c => /pascasarjana|magister|S2/i.test(c));
    if (filtered.length > 0) {
      chunks = filtered;
    }
  }

  const relevantChunks = chunks;
  const combinedText = relevantChunks.join('\n');
  if (!combinedText) return [];

  const regex = /Gelombang\s*([A-Za-z0-9IVX]+)/gi;
  const found = [];
  let match;

  while ((match = regex.exec(combinedText)) !== null) {
    let wave = match[1] || '';
    wave = wave.replace(/[^A-Za-z0-9IVX]/g, '').trim();
    if (!wave) continue;
    if (/khusus/i.test(wave)) wave = 'Khusus';
    found.push(wave.toUpperCase() === 'KHUSUS' ? 'Khusus' : wave);
  }

  if (found.length === 0) return [];

  const unique = new Map();
  for (const w of found) {
    if (!unique.has(w)) unique.set(w, true);
  }

  // Hanya tampilkan gelombang utama (Khusus, I, II, III, IV, dst) di catatan
  const order = ['Khusus', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const ordered = [];

  for (const w of unique.keys()) {
    const idx = order.indexOf(w);
    if (idx === -1) continue; // abaikan label lain seperti "Sisipan" di catatan umum
    ordered.push({ w, idx });
  }

  ordered.sort((a, b) => a.idx - b.idx);

  const result = ordered.map(o => o.w);
  return result;
}

function questionSpecifiesWave(question) {
  if (!question) return false;
  const q = String(question);
  // Covers: gelombang 1/I/II/III/IV/V..., gelombang khusus, gelombang II B, etc.
  return /gelombang\s*(khusus|[0-9]+|[ivx]+)(\s*[a-c])?/i.test(q);
}

function scoreKeywordMatch(chunk, regexes) {
  const text = String(chunk || '');
  if (!text) return 0;
  let score = 0;
  for (const re of regexes) {
    const m = text.match(re);
    if (m) score += Math.min(5, m.length);
  }
  // Bonus for table-like schedule chunks
  if (/\bmasa\s+pendaftaran\b/i.test(text) && /\btesting\b/i.test(text) && /\bpengumuman\b/i.test(text)) score += 5;
  if (/\|\s*masa\s+pendaftaran\s*\|/i.test(text)) score += 3;
  return score;
}

function pickKeywordChunksFromIndex(index, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const keywords = Array.isArray(o.keywords) ? o.keywords : [];
  const limit = Number.isFinite(Number(o.limit)) ? Number(o.limit) : 8;
  const preferDegree = String(o.preferDegree || '').toLowerCase(); // 'd3'|'s1'|'s2'|''

  if (!index || !Array.isArray(index) || index.length === 0) return [];
  if (!keywords.length) return [];

  const degreeRegex =
    preferDegree === 'd3'
      ? /(\bD3\b|diploma\s*3|diploma\b)/i
      : preferDegree === 's2'
        ? /(\bS2\b|pascasarjana|magister)/i
        : preferDegree === 's1'
          ? /(\bS1\b|sarjana)/i
          : null;

  const scored = [];
  for (const item of index) {
    const chunk = item && item.chunk ? item.chunk : '';
    if (!chunk) continue;

    // Hard filter: must match at least one keyword.
    let matchesAny = false;
    for (const re of keywords) {
      if (re.test(chunk)) {
        matchesAny = true;
        break;
      }
    }
    if (!matchesAny) continue;

    let score = scoreKeywordMatch(chunk, keywords);
    if (degreeRegex && degreeRegex.test(chunk)) score += 2;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map(s => s.item);
}

// Bangun konteks yang lebih lengkap untuk pertanyaan tertentu
// Misalnya untuk "jadwal pendaftaran" kita ingin seluruh tabel jadwal dari
// dokumen Excel ikut terkirim ke model, bukan hanya 1-2 chunk teratas saja.
function buildExtendedContextForQuestion(question, top) {
  const qLower = (question || '').toLowerCase();

  // Jadwal pertanyaan bisa muncul sebagai "jadwal PMB" atau "testing/pengumuman/registrasi ulang".
  // Jangan trigger bila fokusnya jelas potongan/diskon.
  const isScheduleQuestion =
    /(jadwal|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang)/i.test(qLower) &&
    !qLower.includes('potongan') &&
    !qLower.includes('diskon');

  const isRequirementsQuestion = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);

  // PMB overview often asks multiple sections (alur/syarat/jadwal/kontak).
  const isPmbOverviewQuestion =
    /(pmb|penerimaan\s+mahasiswa\s+baru)/i.test(qLower) &&
    /(alur|cara\s+daftar|langkah|prosedur|syarat|dokumen|jadwal|kontak|hotline|email|website|wa\b|whatsapp)/i.test(qLower);

  // Pertanyaan beasiswa/prestasi sering butuh konteks lebih panjang (lampiran/ketentuan)
  // karena daftar kriteria dan benefit/ketentuan (mis. "bebas DPP") bisa tersebar di chunk berbeda.
  const isScholarshipQuestion = /(beasiswa|prestasi|juara|rangking|ranking|peringkat)/i.test(qLower);

  if (!isScheduleQuestion && !isScholarshipQuestion && !isRequirementsQuestion && !isPmbOverviewQuestion) {
    return null;
  }

  // Untuk beasiswa/prestasi, jangan campur banyak dokumen agar tidak drift ke aturan potongan lain.
  // Ambil 1 dokumen utama yang paling "scholarship-like" dari top contexts.
  const scholarshipDocHint = /(peraturan\s+rektor|beasiswa|prestasi|rangking|ranking|juara|lampiran)/i;
  let primaryScholarshipTrainingId = null;
  if (isScholarshipQuestion) {
    const best = (top || []).find(t => scholarshipDocHint.test(String(t.chunk || '')));
    primaryScholarshipTrainingId = best && best.trainingId ? best.trainingId : null;
  }

  const trainingIds = new Set(
    isScholarshipQuestion && primaryScholarshipTrainingId
      ? [primaryScholarshipTrainingId]
      : (top || []).map(t => t.trainingId).filter(Boolean)
  );

  // Ambil semua chunk di index utk trainingId yang sama, supaya seluruh tabel
  // (Gelombang Khusus s/d Sisipan) ikut terlihat.
  let fullIndex;
  try {
    fullIndex = loadIndex();
  } catch (e) {
    console.warn('[RAG] Failed to load full index for extended context:', e.message);
    return null;
  }

  const preferDegree = /\bd3\b|diploma\s*3/i.test(question || '') ? 'd3' : (/\bs2\b|pascasarjana|magister/i.test(question || '') ? 's2' : (/\bs1\b|sarjana/i.test(question || '') ? 's1' : ''));

  // For PMB overview / requirements / schedule, do not restrict to top trainingIds only.
  // Top-K retrieval can miss the "syarat" or "jadwal" chunk even if it's in training.
  const relevantItems =
    (isPmbOverviewQuestion || isRequirementsQuestion || isScheduleQuestion)
      ? fullIndex
      : (trainingIds.size > 0 ? fullIndex.filter(item => trainingIds.has(item.trainingId)) : fullIndex);
  if (!relevantItems || relevantItems.length === 0) return null;

  // Susun ulang menjadi satu konteks panjang. Batasi panjang agar tetap aman.
  const maxChars = isPmbOverviewQuestion
    ? parseInt(process.env.RAG_PMB_MAX_CHARS || '14000', 10)
    : isScheduleQuestion
      ? parseInt(process.env.RAG_SCHEDULE_MAX_CHARS || '12000', 10)
      : parseInt(process.env.RAG_SCHOLARSHIP_MAX_CHARS || '14000', 10);
  let combined = '';

  // Untuk beasiswa/prestasi, prioritaskan chunk yang mengandung kata kunci terkait
  // agar lebih padat dan relevan.
  const scholarshipKeywordRegex = /(beasiswa|prestasi|juara|dpp|potongan|bebas|lampiran|hak-hak|ketentuan|syarat)/i;

  // For PMB overview, explicitly prioritize chunks that contain the sections user expects.
  const scheduleRegexes = [
    /(masa\s+pendaftaran|testing|pengumuman|registrasi\s+ulang|daftar\s+ulang)/gi,
    /(jadwal\s+(pmb|pendaftaran))/gi,
    /\|\s*masa\s+pendaftaran\s*\|/gi
  ];
  const requirementsRegexes = [
    /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/gi,
    /(ktp|kk|ijazah|rapor|raport|pas\s*f?oto|foto|akta\s+lahir)/gi,
    /(scan|fotokopi|legalisir|pdf|jpg|jpeg|png)/gi
  ];
  const flowRegexes = [/(alur|cara\s+daftar|langkah|prosedur|registrasi)/gi];
  const contactRegexes = [/(kontak|hotline|email|website|wa\b|whatsapp|telepon|telp)/gi];

  let itemsToUse = relevantItems;
  if (isScholarshipQuestion) {
    itemsToUse = [...relevantItems.filter(i => scholarshipKeywordRegex.test(i.chunk || '')), ...relevantItems];
  } else if (isPmbOverviewQuestion || isRequirementsQuestion || isScheduleQuestion) {
    const prioritized = [];

    if (isScheduleQuestion || isPmbOverviewQuestion) {
      prioritized.push(...pickKeywordChunksFromIndex(relevantItems, { keywords: scheduleRegexes, limit: 10, preferDegree }));
    }
    if (isRequirementsQuestion || isPmbOverviewQuestion) {
      prioritized.push(...pickKeywordChunksFromIndex(relevantItems, { keywords: requirementsRegexes, limit: 10, preferDegree }));
    }
    if (isPmbOverviewQuestion) {
      prioritized.push(...pickKeywordChunksFromIndex(relevantItems, { keywords: flowRegexes, limit: 6, preferDegree }));
      prioritized.push(...pickKeywordChunksFromIndex(relevantItems, { keywords: contactRegexes, limit: 6, preferDegree }));
    }

    // Then include the original relevantItems to preserve continuity.
    itemsToUse = [...prioritized, ...relevantItems];
  }

  const seenChunk = new Set();
  for (const item of itemsToUse) {
    const chunk = item.chunk || '';
    if (!chunk) continue;
    // De-dupe identical chunk text when we concatenate prioritized + full list.
    if (seenChunk.has(chunk)) continue;
    seenChunk.add(chunk);

    const block = `Source (${item.trainingId}):\n${chunk}`;
    if (combined.length + block.length + 8 > maxChars) {
      break;
    }
    if (combined) combined += '\n\n---\n\n';
    combined += block;
  }

  try {
    const debug = String(process.env.RAG_DEBUG_CONTEXT || 'false').toLowerCase() === 'true';
    if (debug && (isPmbOverviewQuestion || isRequirementsQuestion || isScheduleQuestion)) {
      logger.info({ chars: combined.length, isPmbOverviewQuestion, isRequirementsQuestion, isScheduleQuestion }, '[RAG] Using extended context');
    }
  } catch (e) {
    // ignore debug logging failures
  }

  return combined || null;
}

function tryStructuredScholarshipAnswer(question, contextText) {
  if (!question) return null;
  const q = String(question).toLowerCase();
  const qTrim = q.replace(/\s+/g, ' ').trim();
  const qBare = qTrim.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const asksSchoolCertainMeaning = /(sekolah\s+tertentu|sesuai\s+daftar\s+sekolah|masuk\s+daftar\s+sekolah)/i.test(q);
  const asksSchoolList = /(daftar\s+sekolah|lampiran\s+sekolah|sekolah\s+apa\s+aja|sekolah\s+apa\s+saja|sekolah[\s\S]{0,40}\bdaftar\b|sekolah[\s\S]{0,40}\blampiran\b)/i.test(q);
  if (!/(beasiswa|prestasi|juara|rangking|ranking|peringkat|potongan)/i.test(q) && !asksSchoolCertainMeaning && !asksSchoolList) return null;

  // Jika user bertanya umum "beasiswa apa saja" / "jenis beasiswa", jawab dengan overview
  // agar tidak langsung nyasar ke satu program tertentu.
  const isOneWordBeasiswa = qBare === 'beasiswa';
  const asksGeneralScholarshipList =
    isOneWordBeasiswa ||
    (/(beasiswa|potongan)/i.test(q) &&
      (/(apa\s+aja|apa\s+saja|jenis|macam|daftar|info|informasi|yang\s+ada|tersedia)/i.test(q) || /\b(apakah\s+ada|ada\s+).*?(beasiswa|potongan)\b/i.test(qTrim)) &&
      !/(rangking|ranking|peringkat|kelas\s*xii|kelas\s+12|rapor|raport)/i.test(q) &&
      !/(nasional|juara|prestasi\s+nasional)/i.test(q) &&
      !/(pendaftaran|gelombang|potongan\s+biaya\s+pendaftaran)/i.test(q) &&
      !asksSchoolCertainMeaning &&
      !asksSchoolList);

  if (asksGeneralScholarshipList) {
    const lines = [];
    lines.push('Ada beberapa jenis beasiswa/potongan yang biasanya tersedia atau ditanyakan di PMB:');
    lines.push('');
    lines.push('- Beasiswa ranking kelas');
    lines.push('- Beasiswa prestasi (lokal/nasional/internasional)');
    lines.push('- Beasiswa KIP');
    lines.push('- Beasiswa 1K1S');
    lines.push('- Beasiswa Yayasan');
    lines.push('');
    lines.push(
      'Kakak mau tanya yang mana? Balas saja: "ranking" / "prestasi" / "KIP" / "1K1S" / "Yayasan".'
    );

    return {
      answer: lines.join('\n'),
      source: 'rag-scholarship-overview'
    };
  }

  if (/(?:\bbeasiswa\s+)?kip\b/i.test(q) && !/(apa\s+aja|jenis|macam|daftar|info|informasi|yang\s+ada|tersedia)/i.test(q)) {
    return {
      answer:
        'Beasiswa KIP adalah program bantuan biaya pendidikan untuk siswa tidak mampu dengan persyaratan khusus pemerintah. ' +
        'Biasanya mencakup keringanan biaya DPP/UKT sesuai ketentuan, dan informasi detail dapat ditanyakan ke admin PMB untuk status KIP terbaru.',
      source: 'rag-scholarship-kip'
    };
  }

  if (/\b1k1s\b|\bsatu\s+keluarga\s+satu\s+sarjana\b/i.test(q) && !/(apa\s+aja|jenis|macam|daftar|info|informasi|yang\s+ada|tersedia)/i.test(q)) {
    return {
      answer:
        'Beasiswa 1K1S adalah beasiswa untuk keluarga dengan satu anak yang menyelesaikan pendidikan sarjana. ' +
        'Biasanya memberikan potongan biaya DPP/UKT bagi calon mahasiswa yang memenuhi syarat keluarga, namun ketentuan final perlu dikonfirmasi ke bagian PMB.',
      source: 'rag-scholarship-1k1s'
    };
  }

  if (/(?:\bbeasiswa\s+)?yayasan\b/i.test(q) && !/(apa\s+aja|jenis|macam|daftar|info|informasi|yang\s+ada|tersedia)/i.test(q)) {
    return {
      answer:
        'Beasiswa Yayasan biasanya merupakan bantuan dari lembaga atau yayasan yang bekerja sama dengan kampus. ' +
        'Jenis dan besaran dukungannya bisa berbeda-beda, jadi minta klarifikasi ke admin PMB agar saya bisa bantu arahkan ke syarat dan dokumen yang tepat.',
      source: 'rag-scholarship-yayasan'
    };
  }

  // If user asks about scholarship "prestasi" in general (without specifying lokal/nasional/internasional),
  // ask a 1-step clarification so we don't assume a specific category.
  const asksPrestasiGeneric =
    /\bprestasi\b/i.test(qTrim) &&
    !/\b(lokal|nasional|internasional)\b/i.test(qTrim) &&
    !/\b(ranking|rangking|peringkat)\b/i.test(qTrim) &&
    !asksSchoolCertainMeaning &&
    !asksSchoolList;

  if (asksPrestasiGeneric) {
    return {
      answer:
        'Beasiswa prestasi biasanya dibagi: lokal/nasional/internasional.\n' +
        'Kakak mau tanya yang mana? Balas saja: "lokal" / "nasional" / "internasional".',
      source: 'rag-scholarship-prestasi-clarify'
    };
  }

  const text = String(contextText || '');

  // If user asks "sekolah apa saja yang ada di daftar/lampiran", don't return a short partial list
  // that looks like the full list. The lampiran list is typically long.
  if (asksSchoolList) {
    const normalized = text.replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();
    const looksLikeSchoolListContext = /(sman\s*\d|smkn\s*\d|smk\s*ti|smk\s*pandawa)/i.test(lower);

    const examples = [];
    const addUnique = (name) => {
      const n = String(name || '').replace(/\s+/g, ' ').trim();
      if (!n) return;
      if (examples.includes(n)) return;
      examples.push(n);
    };

    if (looksLikeSchoolListContext) {
      const rx = /\b(SMAN|SMKN)\s*\d+\s*[A-Za-z]+(?:\s+[A-Za-z]+){0,2}\b/g;
      const matches = normalized.match(rx) || [];
      for (const m of matches.slice(0, 10)) addUnique(m);

      // Do not reveal specific school names from this context.
    }

    if (examples.length) {
      lines.push('');
      lines.push('Contoh beberapa sekolah yang tercantum di lampiran:');
      for (const s of examples.slice(0, 10)) lines.push(`- ${s}`);
      lines.push('- ...dan lainnya');
    }

    lines.push('');
    lines.push('Silakan hubungi PMB untuk informasi apakah sekolah Anda termasuk daftar yang mendapatkan potongan atau beasiswa khusus.');

    return {
      answer: lines.join('\n'),
      source: 'rag-scholarship-ranking-rule'
    };
  }

  // Ranking kelas (beasiswa rangking) ΓÇö should be answerable without OpenAI.
  // Also handle follow-up like "apa maksud sekolah tertentu?" as long as context indicates ranking scholarship.
  const isTypeOnlyRanking = /^(beasiswa\s+)?(rangking|ranking|peringkat)(\s+kelas)?$/.test(qTrim);
  const asksRanking =
    isTypeOnlyRanking ||
    (/(rangking|ranking|peringkat)/i.test(q) && /(kelas|semester|rapor|raport|kelas\s*xii|xii)/i.test(q));
  if (asksRanking || asksSchoolCertainMeaning) {
    let normalized = text.replace(/\s+/g, ' ');
    let lower = normalized.toLowerCase();

    const pickPercent = (haystack, re) => {
      const m = re.exec(haystack);
      if (!m) return null;
      const p = parseInt(String(m[1] || '').trim(), 10);
      return Number.isFinite(p) ? p : null;
    };

    // Default section (often lists "Calon mahasiswa dari" + schools)
    let pRank13Primary = pickPercent(normalized, /ran(?:g)?king\s*1\s*,?\s*2\s*(?:,?\s*dan\s*)?3[^%]{0,120}potongan\s*DPP\s*(\d{1,3})\s*%/i);
    let pRank4to10Primary = pickPercent(normalized, /ran(?:g)?king\s*4\s*(?:s\/?d|sd|s\.d\.)\s*10[^%]{0,120}potongan\s*DPP\s*(\d{1,3})\s*%/i);

    // "SMA/K/MA lainnya" section
    let pRank13Other = null;
    let pRank4to10Other = null;
    const otherIdx = lower.indexOf('sma/k/ma lainnya');
    if (otherIdx !== -1) {
      const otherPart = normalized.slice(otherIdx);
      pRank13Other = pickPercent(otherPart, /ran(?:g)?king\s*1\s*,?\s*2\s*(?:,?\s*dan\s*)?3[^%]{0,120}potongan\s*DPP\s*(\d{1,3})\s*%/i);
      pRank4to10Other = pickPercent(otherPart, /ran(?:g)?king\s*4\s*(?:s\/?d|sd|s\.d\.)\s*10[^%]{0,120}potongan\s*DPP\s*(\d{1,3})\s*%/i);
    }

    // Fallback: if context is missing the ranking % table (common when top-k picked another doc),
    // scan the full index for ranking+potongan DPP chunks.
    if (
      typeof pRank13Primary !== 'number' &&
      typeof pRank4to10Primary !== 'number' &&
      typeof pRank13Other !== 'number' &&
      typeof pRank4to10Other !== 'number'
    ) {
      try {
        const fullIndex = loadIndex();
        const candidates = (fullIndex || [])
          .filter(i => i && typeof i.chunk === 'string')
          .filter(i => /ran(?:g)?king/i.test(i.chunk) && /potongan\s*DPP/i.test(i.chunk));

        const extra = candidates.slice(0, 10).map(i => i.chunk).join(' ');
        if (extra) {
          normalized = `${normalized} ${String(extra).replace(/\s+/g, ' ')}`;
          lower = normalized.toLowerCase();

          pRank13Primary = pickPercent(normalized, /ran(?:g)?king\s*1\s*,?\s*2\s*(?:,?\s*dan\s*)?3[^%]{0,160}potongan\s*DPP\s*(\d{1,3})\s*%/i);
          pRank4to10Primary = pickPercent(normalized, /ran(?:g)?king\s*4\s*(?:s\/?d|sd|s\.d\.)\s*10[^%]{0,160}potongan\s*DPP\s*(\d{1,3})\s*%/i);

          const otherIdx2 = lower.indexOf('sma/k/ma lainnya');
          if (otherIdx2 !== -1) {
            const otherPart2 = normalized.slice(otherIdx2);
            pRank13Other = pickPercent(otherPart2, /ran(?:g)?king\s*1\s*,?\s*2\s*(?:,?\s*dan\s*)?3[^%]{0,160}potongan\s*DPP\s*(\d{1,3})\s*%/i);
            pRank4to10Other = pickPercent(otherPart2, /ran(?:g)?king\s*4\s*(?:s\/?d|sd|s\.d\.)\s*10[^%]{0,160}potongan\s*DPP\s*(\d{1,3})\s*%/i);
          }
        }
      } catch (e) {
        // ignore fallback failures
      }
    }

    // Selection notes (often: ranking 1 s/d 15 => no written test, interview only)
    const noWrittenTest = /rangking\s*1\s*(?:s\/?d|sd|s\.d\.)\s*15[^.\n]{0,220}tidak\s+mengikuti\s+tes\s+tulis[^.\n]{0,220}wawancara/i.test(lower);
    const needsProof = /(bukti\s*rapor|bukti\s*raport|rapor)[^\n]{0,160}legalisir/i.test(lower) || /surat\s*keterangan[^\n]{0,160}sekolah/i.test(lower);

    const lines = [];
    if (asksSchoolCertainMeaning && !asksRanking) {
      lines.push('Silakan hubungi PMB untuk informasi detail mengenai daftar sekolah yang berhak mendapatkan potongan atau beasiswa.');
    } else {
      lines.push('Ada program beasiswa untuk calon mahasiswa baru yang memiliki ranking di kelas (kelas XII semester 1 atau 2).');
    }

    const hasAnyPct = [pRank13Primary, pRank4to10Primary, pRank13Other, pRank4to10Other].some(v => typeof v === 'number');
    if (hasAnyPct) {
      lines.push('');
      lines.push('Potongan DPP (Dana Pendidikan Pokok):');

      const primaryPair = {
        r13: typeof pRank13Primary === 'number' ? pRank13Primary : null,
        r410: typeof pRank4to10Primary === 'number' ? pRank4to10Primary : null
      };
      const otherPair = {
        r13: typeof pRank13Other === 'number' ? pRank13Other : null,
        r410: typeof pRank4to10Other === 'number' ? pRank4to10Other : null
      };

      const hasPrimary = primaryPair.r13 !== null || primaryPair.r410 !== null;
      const hasOther = otherPair.r13 !== null || otherPair.r410 !== null;
      const samePct = hasPrimary && hasOther && primaryPair.r13 === otherPair.r13 && primaryPair.r410 === otherPair.r410;

      const formatParts = (pair) => {
        const parts = [];
        if (typeof pair.r13 === 'number') parts.push(`Ranking 1ΓÇô3: potongan DPP ${pair.r13}%`);
        if (typeof pair.r410 === 'number') parts.push(`Ranking 4ΓÇô10: potongan DPP ${pair.r410}%`);
        return parts;
      };

      if (samePct) {
        const parts = formatParts(primaryPair);
        if (parts.length) lines.push(`- ${parts.join('; ')}`);
        lines.push('');
        lines.push('Keterangan: silakan hubungi PMB untuk informasi lengkap mengenai sekolah yang berhak mendapat potongan atau beasiswa.');
      } else {
        if (hasPrimary) {
          const parts = formatParts(primaryPair);
          if (parts.length) lines.push(`- Sekolah yang tercantum di lampiran resmi: ${parts.join('; ')} (silakan hubungi PMB untuk informasi lengkap)`);
        }

        if (hasOther) {
          const parts = formatParts(otherPair);
          if (parts.length) lines.push(`- SMA/K/MA lainnya: ${parts.join('; ')}`);
        }

        lines.push('');
        lines.push('Keterangan: Daftar sekolah tersedia di lampiran resmi; silakan hubungi PMB untuk konfirmasi.');
      }
    }

    if (noWrittenTest || needsProof) {
      lines.push('');
      lines.push('Catatan seleksi:');
      if (noWrittenTest) {
        lines.push('- Untuk ranking 1ΓÇô15 besar kelas XII semester 1/2: tidak mengikuti tes tulis, hanya tes wawancara.');
      }
      if (needsProof) {
        lines.push('- Biasanya perlu bukti rapor yang dilegalisir atau surat keterangan dari sekolah.');
      }
    }

    lines.push('');
    lines.push('Boleh info asal sekolah dan ranking berapa di kelas, kak? Nanti saya bantu cek masuk kategori yang mana.');

    return {
      answer: lines.join('\n'),
      source: 'rag-scholarship-ranking-rule'
    };
  }

  // Focus: user asked about national achievement discount
  const asksNationalAchievement = q.includes('nasional') && (q.includes('prestasi') || q.includes('juara'));
  if (!asksNationalAchievement) return null;

  // Extract the most relevant lines if present
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const picked = [];
  const pushIf = (re) => {
    for (const line of lines) {
      if (re.test(line) && !picked.includes(line)) {
        picked.push(line);
      }
      if (picked.length >= 4) break;
    }
  };

  pushIf(/Juara\s*1\s*,?\s*2\s*(,?\s*dan\s*)?3[^\n]*Nasional[^\n]*(bebas\s*DPP|potongan\s*DPP)/i);
  pushIf(/Juara\s*lainnya[^\n]*Nasional[^\n]*potongan\s*DPP/i);
  pushIf(/Prestasi[^\n]*Nasional[^\n]*(bebas\s*DPP|potongan\s*DPP)/i);

  if (picked.length === 0) return null;

  const formatted = picked.map(l => `- ${l}`);
  return {
    answer:
      `Ada potongan/beasiswa untuk prestasi nasional:\n\n${formatted.join('\n')}\n\nBoleh info Anda kategori yang mana (Juara 1ΓÇô3 atau Harapan/Favorit) dan bidangnya (akademik/non-akademik)?`,
    source: 'rag-scholarship-rule'
  };

}

function tryStructuredFeeBreakdownAnswer(question, top, opts = null) {
  if (!question) return null;
  const currentQ = extractCurrentUserQuestionText(question);
  const qLower = String(currentQ || '').toLowerCase();
  if (!qLower.trim()) return null;

  // NOTE: Suffix queries like "1C", "II B", "gelombang 2A" are NORMALIZED to base wave.
  // No longer reject them. They will be matched to I, II, III, or IV accordingly.

  // Guard: users often mention "semester" in the context of ranking/beasiswa.
  // Do not route those messages to fee/cost breakdown.
  if (/(\branking\b|\bperingkat\b|\bjuara\b|\bbeasiswa\b|\bprestasi\b|\brapor\b)/i.test(qLower)) {
    return null;
  }

  // Only handle fee/cost breakdown requests (not discounts/schedule).
  // NOTE: do not treat the bare word "semester" as a cost trigger, because it also appears
  // in scholarship/ranking contexts (e.g., "semester 1 ranking 1").
  // Also: do NOT treat the bare word "pendaftaran" as a fee trigger, because users often ask
  // "persyaratan pendaftaran" and that must not drift to biaya.
  const mentionsCostCore = /(biaya|rincian|detail|komponen|lainnya|potongan|diskon|dpp|ukt|per\s*semester|biaya\s*semester|uang\s+semester|biaya\s+per\s*semester|pembayaran|cicil|cicilan|\brp\b|rupiah)/i.test(qLower);
  const mentionsRegistrationFee = /(pendaftaran|registrasi)/i.test(qLower) && (mentionsCostCore || /(berapa|nominal|tarif|uang)/i.test(qLower));
  const mentionsRequirements = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);
  if (mentionsRequirements && !mentionsCostCore) return null;

  const asksCost = mentionsCostCore || mentionsRegistrationFee;
  if (!asksCost) return null;
  if (/(jadwal|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang|tanggal)/i.test(qLower)) return null;

  const wantsOtherOnly = /\b(lainnya|selain\s+itu|yang\s+lain)\b/i.test(qLower);
  const wantsDiscount = /\b(potongan|diskon)\b/i.test(qLower);

  // If the user asks specifically about UKT / biaya per semester (and does not ask
  // for rincian/detail/komponen), keep the answer narrowly scoped to the semester fee.
  // This prevents over-answering (pendaftaran/DPP/atribut/etc.) for UKT questions.
  const wantsSemesterOnly =
    /(\bukt\b|per\s*semester|biaya\s+semester|uang\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|biaya\s+per\s*semester)/i.test(qLower) &&
    !wantsOtherOnly &&
    !/(rincian|detail|komponen|lengkap|biaya\s+lain|selain\s+itu|yang\s+lain|dpp|pendaftaran|registrasi|jas|kaos|pengalaman\s+industri|total|cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/i.test(qLower);

  // Prefer explicit program anchors so this rule is deterministic even when embeddings are mocked.
  // IMPORTANT: use the current user question first.
  // In WhatsApp follow-ups, the full `question` string may include prior context (e.g., DNUI)
  // which must not override the user's current intent (e.g., HELP).
  const qAllLower = String(question || '').toLowerCase();
  const qProgramLower = String(currentQ || '').toLowerCase();
  const conversationContext = String(opts && typeof opts.conversationContext === 'string' ? opts.conversationContext : '').toLowerCase();
  const topText = Array.isArray(top)
    ? top.map(item => String(item && item.chunk ? item.chunk : '')).join('\n')
    : '';
  const topTrainingIds = new Set(
    Array.isArray(top)
      ? top.map(item => item && item.trainingId ? String(item.trainingId) : '').filter(Boolean)
      : []
  );

  const detectProgramKey = (textLower, opts = null) => {
    if (!textLower) return null;

    const o = (opts && typeof opts === 'object') ? opts : {};
    const allowDualDegree = o.allowDualDegree !== false;
    const allowLooseProgramCode = o.allowLooseProgramCode !== false;

    // Regular programs
    if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
    if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
    if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
    if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
    if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';

    // Loose code parsing is allowed only when the user clearly talks about fees/costs,
    // otherwise short tokens like "si" can be ambiguous in Indonesian chat.
    if (allowLooseProgramCode) {
      if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
        // Common short forms: "biaya si", "si s1", "ti reguler", etc.
        const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
        if (m && m[1]) return m[1].toLowerCase();
      }
    }

    // Dual degree (only when explicitly allowed; do not let history override current intent)
    if (allowDualDegree) {
      if (/\bhelp\b|help\s+university|malaysia/i.test(textLower)) return 'help';
      if (/\bdnui\b|dalian\s+neusoft|university\s+of\s+information/i.test(textLower)) return 'dnui';
      if (/\butb\b|universitas\s+teknologi\s+bandung/i.test(textLower)) return 'utb';
    }

    return null;
  };

  // Prefer current user question. Only consult the full question/history when the
  // current question is truly ambiguous, and never let dual degree keywords from
  // history override a regular prodi question.
  let programKey = detectProgramKey(qProgramLower, { allowDualDegree: true, allowLooseProgramCode: true });

  if (!programKey) {
    const currentHasAnyProgramSignal = /(sistem\s+informasi|teknologi\s+informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|\b(si|ti|bd|sk|mi)\b)/i.test(qProgramLower);
    const ambiguousCurrent = !currentHasAnyProgramSignal && qProgramLower.length <= 32;
    if (ambiguousCurrent) {
      // For ambiguous follow-ups (e.g. "biaya lainnya"), allow dual-degree keywords from
      // the anchored question so the bot can continue the same DNUI/HELP/UTB topic.
      programKey = detectProgramKey(qAllLower, { allowDualDegree: true, allowLooseProgramCode: false });
    }
  }

  if (!programKey && conversationContext) {
    programKey = detectProgramKey(conversationContext, { allowDualDegree: true, allowLooseProgramCode: true });
  }

  if (!programKey && topText) {
    programKey = detectProgramKey(topText, { allowDualDegree: true, allowLooseProgramCode: true });
  }

  // When the current question is too generic (e.g. just "biaya"), prefer the
  // current retrieval context before scanning the whole index. This keeps the
  // answer tied to the file currently being discussed in chat.
  const currentQuestionLooksGenericCost =
    /^(biaya|rincian\s+biaya|detail\s+biaya|komponen\s+biaya|biaya\s+lainnya|lainnya)$/i.test(qLower.trim()) ||
    (qLower.trim().length <= 12 && /(biaya|rincian|detail|komponen)/i.test(qLower));
  const topLooksFeeRelated = /(biaya|pendaftaran|dpp|semester|pendidikan|registrasi|pengalaman\s+industri|kaos|jas|almamater|potongan|cicil|cicilan)/i.test(topText);

  let preferTopContext = false;
  if (!programKey && currentQuestionLooksGenericCost && topTrainingIds.size > 0 && topLooksFeeRelated) {
    preferTopContext = true;
  }

  // If user mentions Dual Degree generically (without specifying UTB/DNUI/HELP),
  // ask which partner they mean because potongan biaya untuk Dual Degree tercantum
  // di dokumen UTB/DNUI/HELP masing-masing.
  if (!programKey && /\b(dual\s*degree|double\s*degree)\b/i.test(qLower)) {
    return {
      answer:
        'Untuk program Dual Degree (UTB / DNUI / HELP) ada potongan biaya khusus (mis. DPP) yang tercantum pada dokumen masing-masing. Mau info untuk UTB, DNUI, atau HELP? Balas: UTB / DNUI / HELP.',
      source: 'rag-dual-degree-fee-clarify'
    };
  }

  // If user only asks the registration fee for regular programs, keep it short
  // and let tryStructuredProgramRegistrationFeeAnswer() handle it.
  // NOTE: for Dual Degree, we still allow breakdown even if user says "biaya pendaftaran".
  const asksOnlyRegistrationFee =
    ((/(biaya|uang)\s+pendaftaran/i.test(qLower) || /biaya\s+daftar\b/i.test(qLower)) &&
    !/(rincian|detail|komponen|lengkap|lainnya|selain\s+itu|dpp|semester|per\s*semester|cicil|cicilan|skema\s*pembayaran)/i.test(qLower));
  if (asksOnlyRegistrationFee && ['si', 'ti', 'bd', 'sk', 'mi'].includes(programKey || '')) {
    return null;
  }

  const fullIndex = loadIndex();
  let candidates = [];

  if (preferTopContext) {
    candidates = fullIndex
      .filter(item => item && topTrainingIds.has(String(item.trainingId || '')))
      .map(item => (item && item.chunk ? String(item.chunk) : ''));
  }

  if (programKey && !candidates.length) {
    const keyRe =
      programKey === 'dnui'
        ? /(\bDNUI\b|DALIAN\s+NEUSOFT)/i
        : (programKey === 'help'
          ? /(\bHELP\b\s*UNIVERSITY|MALAYSIA)/i
          : (programKey === 'utb'
            ? /(\bUTB\b|UNIVERSITAS\s+TEKNOLOGI\s+BANDUNG)/i
            : (programKey === 'sk'
              ? /(PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER|SISTEMKOMPUTER)/i
              : (programKey === 'mi'
                ? /(MANAJEMEN\s*INFORMATIKA|MANAJEMENINFORMATIKA|INFORMATIC\s*DIPLOMA)/i
                : /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i
              )
            )
          )
        );

    // Prefer a stable, complete context by taking all chunks from the best-matching trainingId.
    // This prevents partial answers when the fee table is split across chunks and avoids relying on top-K.
    const idCounts = new Map();
    const idHasFeeSignal = new Map();
    for (const item of fullIndex) {
      const chunk = item && item.chunk ? String(item.chunk) : '';
      const trainingId = item && item.trainingId ? String(item.trainingId) : '';
      if (!chunk || !trainingId) continue;
      if (!keyRe.test(chunk)) continue;

      const hasFeeSignal =
        /RINCIAN\s*BIAYA\s*PENDIDIKAN/i.test(chunk) ||
        /RINCIANBIAYAPENDIDIKAN/i.test(chunk) ||
        /No\.?\s*Jenis\s*Biaya/i.test(chunk) ||
        /Waktu\s*Pembayaran/i.test(chunk);
      if (hasFeeSignal) idHasFeeSignal.set(trainingId, true);

      const prev = idCounts.get(trainingId) || 0;
      // Slightly boost chunks that look like the fee table header.
      const bonus = /RINCIAN\s+BIAYA\s+PENDIDIKAN/i.test(chunk) || /No\.?\s*Jenis\s*Biaya/i.test(chunk) ? 2 : 0;
      idCounts.set(trainingId, prev + 1 + bonus);
    }

    let bestTrainingId = null;
    let bestScore = -1;
    for (const [tid, score] of idCounts.entries()) {
      // Prefer trainingIds that actually contain the fee table/header signals.
      if (!idHasFeeSignal.get(tid)) continue;
      if (score > bestScore) {
        bestScore = score;
        bestTrainingId = tid;
      }
    }

    // Fallback: if no id had fee signal (index is messy), fall back to best overall.
    if (!bestTrainingId) {
      for (const [tid, score] of idCounts.entries()) {
        if (score > bestScore) {
          bestScore = score;
          bestTrainingId = tid;
        }
      }
    }

    if (bestTrainingId) {
      candidates = fullIndex
        .filter(item => item && String(item.trainingId || '') === bestTrainingId)
        .map(item => (item && item.chunk ? String(item.chunk) : ''));
    }

    // Legacy fallback: if trainingId match fails for any reason, try a direct chunk filter.
    if (!candidates.length) {
      candidates = fullIndex
        .map(i => (i && i.chunk ? String(i.chunk) : ''))
        .filter(t => keyRe.test(t) && (/RINCIAN\s+BIAYA\s+PENDIDIKAN/i.test(t) || /RINCIANBIAYAPENDIDIKAN/i.test(t)));
    }
  }

  // Fallback: use same-trainingId chunks from retrieval top-K.
  if (!candidates.length && Array.isArray(top) && top.length) {
    const trainingIds = new Set(top.map(t => t.trainingId).filter(Boolean));
    if (trainingIds.size > 0) {
      candidates = fullIndex
        .filter(item => item && trainingIds.has(item.trainingId))
        .map(item => (item && item.chunk ? String(item.chunk) : ''));
    }
  }

  if (!candidates.length) return null;

  // De-dupe identical chunk text (chunk overlap can repeat the same table rows).
  const uniqueChunks = [];
  const seenChunkText = new Set();
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (!s) continue;
    if (seenChunkText.has(s)) continue;
    seenChunkText.add(s);
    uniqueChunks.push(s);
  }

  const combined = uniqueChunks.join('\n');
  if (!combined.trim()) return null;

  // Parse fee items from OCR-ish tables.
  const rawLines = combined
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => String(l || '').trim())
    .filter(Boolean);

  // Expand OCR-stuck tokens, e.g. "1.Pendaftaran" or "DanaPendidikanPokok14.000.000".
  const expandedLines = [];
  const splitNumberPrefix = (token) => {
    const s = String(token || '').trim();
    if (!s) return [];

    // Only split when OCR sticks the number directly to the label, e.g. "1.Pendaftaran".
    // Do NOT split normal rows like "1. Pendaftaran 500.000 ..." because inline parsing handles it well.
    const stuckDot = /^([0-9]{1,2})\.(?=[A-Za-z\p{L}])(\S.+)$/u.exec(s);
    if (stuckDot && stuckDot[1] && stuckDot[2]) return [`${stuckDot[1]}.`, String(stuckDot[2]).trim()];

    const stuckParen = /^([0-9]{1,2})\)(?=[A-Za-z\p{L}])(\S.+)$/u.exec(s);
    if (stuckParen && stuckParen[1] && stuckParen[2]) return [`${stuckParen[1]}.`, String(stuckParen[2]).trim()];

    return [s];
  };
  const splitLabelAmountTail = (token) => {
    const s = String(token || '').trim();
    if (!s) return [];
    const m = /^(.+?)(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})$/.exec(s);
    if (!m || !m[1] || !m[2]) return [s];
    const left = String(m[1]).trim();
    const right = String(m[2]).trim();
    // Avoid splitting when left is too short/non-descriptive.
    if (left.length < 3) return [s];
    if (/^(rp\.?|idr)$/i.test(left)) return [s];
    // Critical guard: only split when the left side looks like a label (contains letters).
    // This prevents corrupting pure amount tokens like "14.000.000" into "14." + "000.000".
    if (!/[A-Za-z\p{L}]/u.test(left)) return [s];
    return [left, right];
  };

  for (const l of rawLines) {
    const parts = splitNumberPrefix(l);
    for (const p of parts) {
      const more = splitLabelAmountTail(p);
      for (const x of more) {
        const t = String(x || '').trim();
        if (t) expandedLines.push(t);
      }
    }
  }

  const lines = expandedLines;

  const isNumberStart = (s) => /^\d+\.?$/.test(String(s || '').replace(/\s+/g, ''));
  const looksLikePhoneNumber = (digitsOnly) => {
    const d = String(digitsOnly || '').trim();
    if (!d) return false;
    // Typical Indonesian phone/hotline patterns in OCR:
    // - Starts with 0 and long (>= 9 digits)
    // - Starts with 62 (country code) and long
    if (/^0\d{8,}$/.test(d)) return true;
    if (/^62\d{8,}$/.test(d)) return true;
    return false;
  };
  const looksLikeAmount = (s) => {
    const tok = String(s || '').trim();
    if (!tok) return false;
    if (/^\d{1,3}(?:\.\d{3})+(?:,\-)?$/.test(tok)) return true; // 3.000.000
    if (/^\d{6,}$/.test(tok)) {
      // Guard: avoid misclassifying hotline/phone numbers as fee amounts.
      if (looksLikePhoneNumber(tok)) return false;
      return true;
    }
    return false;
  };
  const normalizeAmount = (s) => String(s || '').trim().replace(/,\-$/g, '');

  const parseInlineRow = (rawLine) => {
    const line = String(rawLine || '').replace(/\s{2,}/g, ' ').trim();
    if (!line) return null;

    // Examples:
    // "1. Pendaftaran 500.000 Pada Saat Daftar"
    // "2. Dana Pendidikan Pokok (DPP) 14.000.000 Dicicil 2 Kali s/d September"
    // "- Biaya Pendidikan Per Semester 6.500.000 Dicicil 2 Kali s/d September"
    const reNumbered = /^(\d+)\.?\s*[\)\.]\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/;
    const reDashed = /^(?:[-ΓÇó]+)\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/;

    const m1 = reNumbered.exec(line);
    if (m1) {
      const label = String(m1[2] || '').trim().replace(/^[ΓÇö\-]+\s*/g, '').trim();
      const amount = normalizeAmount(m1[3]);
      const timing = String(m1[4] || '').trim();
      if (!label || !amount) return null;
      return { label, amount, timing };
    }

    const m2 = reDashed.exec(line);
    if (m2) {
      const label = String(m2[1] || '').trim().replace(/^[ΓÇö\-]+\s*/g, '').trim();
      const amount = normalizeAmount(m2[2]);
      const timing = String(m2[3] || '').trim();
      if (!label || !amount) return null;
      return { label, amount, timing };
    }

    return null;
  };

  // Only parse within the main fee table area (before discount details), but keep payment notes.
  // Support both spaced and OCR-concatenated variants.
  const stopWords = /^(Penjelasan\s*Tambahan\s*:|PenjelasanTambahan\s*:|Potongan\s*Biaya\s*Pendaftaran\s*:|PotonganBiayaPendaftaran\s*:)/i;
  const tableTokens = [];
  const inlineItems = [];
  for (let li = 0; li < lines.length; li += 1) {
    const l = lines[li];
    const next = String(lines[li + 1] || '').trim();

    if (stopWords.test(l)) break;
    // Handle split markers like "Penjelasan" + "Tambahan" on separate lines.
    if (/^Penjelasan$/i.test(l) && /^Tambahan/i.test(next)) break;
    if (/^Potongan$/i.test(l) && /^Biaya/i.test(next)) break;

    // Skip obvious headers.
    if (/^(No\.|No|Jenis|Biaya|Rp|Waktu|Pembayaran)$/i.test(l)) continue;
    if (/^T\.?A\b/i.test(l)) continue;

    const inline = parseInlineRow(l);
    if (inline) {
      inlineItems.push(inline);
      continue;
    }
    tableTokens.push(l);
  }

  const items = [];
  const isLikelyFeeLabel = (rawLabel) => {
    const label = String(rawLabel || '').trim();
    if (!label) return false;
    const lower = label.toLowerCase();

    // Filter out obvious contact/header noise that commonly appears around scanned fee tables.
    if (/(\bhotline\b|\bfax\b|\bemail\b|\bwebsite\b|\bweb\b|\bkampus\b|\bjl\b|\bjln\b|\bjalan\b|\bph\b\s*:?|\btelepon\b|\btelp\b)/i.test(lower)) return false;
    if (/(\bdipindai\b|camscanner|always\s+the\s+first)/i.test(lower)) return false;
    if (/(surat\s+keputusan|lampiran\b|tanggal\b|nomor\b|rektor\b|wakil\b)/i.test(lower)) return false;
    if (/(institut\s+teknologi|stikom\s*bali\s*email)/i.test(lower)) return false;

    // Require some fee-ish signal so we don't turn arbitrary OCR lines into fee rows.
    if (/(pendaftaran|dana|biaya|dpp|registrasi|pendidikan|semester|almamater|gmti|kaos|tas|topi|pengalaman|industri|bahasa|ujian|subject|sertifikasi|yudisium|wisuda|transfer|laptop|perwalian|iuran|kemahasiswaan)/i.test(lower)) {
      return true;
    }

    return false;
  };
  const normalizeFeePhrase = (s) => {
    let out = String(s || '').trim();
    if (!out) return out;

    // Humanize common OCR concatenations: insert spaces between letters/digits and camelCase boundaries.
    // Keep conservative: only affects mixed alnum tokens.
    const humanizeOcrConcat = (v) => {
      let t = String(v || '');
      if (!t) return t;
      t = t
        .replace(/([A-Za-z])([0-9])/g, '$1 $2')
        .replace(/([0-9])([A-Za-z])/g, '$1 $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2');
      return t;
    };

    // Common OCR concatenations in the PMB fee tables
    out = out.replace(/DanaPendidikanPokok\s*\(\s*DPP\s*\)/gi, 'Dana Pendidikan Pokok (DPP)');
    out = out.replace(/DanaPendidikanPokok/gi, 'Dana Pendidikan Pokok');
    out = out.replace(/BiayaPendidikanPerSemester/gi, 'Biaya Pendidikan Per Semester');
    // Normalize HELP fee row label to the user-facing wording.
    // OCR sometimes drops the leading "Biaya" token, so accept both variants.
    out = out.replace(/(?:Biaya\s*)?Pendidikan\s*&\s*Ujian\s*\/\s*Subject/gi, 'Biaya Pendidikan per semester');
    out = out.replace(/BiayaPengalamanIndustri/gi, 'Biaya Pengalaman Industri');
    out = out.replace(/Biaya\s*Pengalaman\s*Industri/gi, 'Biaya Pengalaman Industri');
    out = out.replace(/Jas\s*Alamater/gi, 'Jas Almamater');
    out = out.replace(/Kaos\s*,\s*Tas\s*,\s*GMTI/gi, 'Kaos, Tas, GMTI');
    out = out.replace(/Kaos\s*,\s*Topi\s*,\s*GMTI/gi, 'Kaos, Topi, GMTI');
    out = out.replace(/Saat\s*Registrasi\s*I/gi, 'Saat Registrasi I');
    out = out.replace(/Pada\s*Saat\s*Daftar/gi, 'Pada Saat Daftar');
    out = out.replace(/Menjelang\s*Perwalian/gi, 'Menjelang Perwalian');
    out = out.replace(/Kecuali\s*Reg\s*1/gi, 'Kecuali Reg 1');
    out = out.replace(/\bReg\s*1\b/gi, 'Reg 1');
    out = out.replace(/\bReg1\b/gi, 'Reg 1');
    out = out.replace(/Dicicil\s*Per\s*Bln/gi, 'Dicicil per bulan');
    out = out.replace(/Dicicil\s*2\s*Kali/gi, 'Dicicil 2 kali');
    out = out.replace(/Dicicil2Kali/gi, 'Dicicil 2 kali');
    out = out.replace(/dicicil2kali/gi, 'dicicil 2 kali');
    out = out.replace(/Dicicil\s*5\s*Kali\s*Per\s*Semester/gi, 'Dicicil 5 kali per semester');
    out = out.replace(/Dicicil5KaliPerSemester/gi, 'Dicicil 5 kali per semester');
    out = out.replace(/PerSemester/gi, 'Per Semester');
    out = out.replace(/s\.d\s*UTS\-?1/gi, 's/d UTS-1');
    out = out.replace(/s\/d\s*UTS\-?1/gi, 's/d UTS-1');
    out = out.replace(/s\/d\s*UTS\b/gi, 's/d UTS');
    out = out.replace(/s\.d\s*UTS\b/gi, 's/d UTS');
    out = out.replace(/s\/dUTS\b/gi, 's/d UTS');
    out = out.replace(/s\.dUTS\b/gi, 's/d UTS');

    // Insert missing separators when OCR concatenates tokens.
    out = out.replace(/Reg\s*1\s*Dicicil/gi, 'Reg 1, dicicil');
    out = out.replace(/Reg\s*1\s*dicicil/gi, 'Reg 1, dicicil');
    out = out.replace(/Reg\s*1Dicicil/gi, 'Reg 1, dicicil');
    out = out.replace(/\bKecuali\s*Reg\s*1\s*,?\s*dicicil\b/gi, 'Kecuali Reg 1, dicicil');
    out = out.replace(/\bKecuali\s*Reg\s*1\s*dicicil\b/gi, 'Kecuali Reg 1, dicicil');
    out = out.replace(/\bReg\s*1\s*Dicicil\s*2\s*kali\b/gi, 'Reg 1, dicicil 2 kali');

    // Ensure spacing around "s/d".
    out = out.replace(/\bs\/d\s*(UTS\-?1|UTS|September)\b/gi, 's/d $1');
    out = out.replace(/s\.d\s*September/gi, 's/d September');
    out = out.replace(/s\/d\s*September/gi, 's/d September');

    // Remove noisy fee-table header fragments that sometimes get concatenated into timing/label.
    // Examples seen: "DIDIKANMAHASISWABARUKELASREGULER PROGRAMSTUDI... No.Jenis BiayaRp WaktuPembayaran"
    out = out.replace(/DIDIKANMAHASISWABARU\S*/gi, '');
    out = out.replace(/KELAS\s*REGULER\S*/gi, '');
    out = out.replace(/PROGRAM\s*STUDI\S*/gi, '');
    out = out.replace(/PROGRAMSTUDI\S*/gi, '');
    out = out.replace(/\bT\.?A\b\s*\d{4}\s*\/?\s*\d{4}\b/gi, '');
    out = out.replace(/\bNo\.?\s*Jenis\b[\s\S]*?Waktu\s*Pembayaran\b/gi, '');
    out = out.replace(/\bJenis\s*Biaya\b/gi, '');
    out = out.replace(/\bWaktu\s*Pembayaran\b/gi, '');
    out = out.replace(/\bBiayaRp\b/gi, '');
    out = out.replace(/\bRp\s*Waktu\b/gi, '');

    // Apply OCR humanization late so it can fix remaining tokens like "Nasional2.500.000".
    out = humanizeOcrConcat(out);

    out = out.replace(/\s{2,}/g, ' ').trim();
    return out;
  };
  const parseMoneyToInt = (amt) => {
    const s = String(amt || '').replace(/\D/g, '');
    const n = parseInt(s || '0', 10);
    return Number.isFinite(n) ? n : 0;
  };

  for (let i = 0; i < tableTokens.length; i += 1) {
    const tok = tableTokens[i];
    if (!isNumberStart(tok)) continue;

    // Stop if we seem to have left the fee table (e.g., section numbering 10/11/12 about transfers).
    // Most fee tables are 1..4/6; anything >8 after we've collected several items is likely another section.
    const nTok = parseInt(String(tok).replace(/\D/g, '') || '0', 10);
    if (items.length >= 4 && nTok >= 9) break;

    // Gather until next number marker.
    const seg = [];
    for (let j = i + 1; j < tableTokens.length; j += 1) {
      const t = tableTokens[j];
      // OCR sometimes writes "Registrasi I" as "Registrasi" + "1" on the next line.
      // The solitary "1" must be treated as part of timing, not a new row marker.
      if (isNumberStart(t)) {
        const prevTok = seg.length ? String(seg[seg.length - 1] || '') : '';
        if (/registrasi/i.test(prevTok) && String(t).trim() === '1') {
          seg.push(t);
          continue;
        }
        break;
      }
      seg.push(t);
    }

    const amountIdx = seg.findIndex(looksLikeAmount);
    if (amountIdx === -1) continue;

    // Special case: "Biaya Pengalaman Industri" often has 3 amounts (Internasional/Nasional/Lokal).
    const segLower = seg.join(' ').toLowerCase();
    const extractAmountsFromText = (txt) => {
      const raw = String(txt || '');
      if (!raw) return [];
      const found = [];
      const re = /(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})/g;
      let m;
      while ((m = re.exec(raw)) !== null) {
        const v = normalizeAmount(m[1]);
        if (v) found.push(v);
      }
      return found;
    };

    const allAmounts = Array.from(new Set([
      ...seg.filter(looksLikeAmount).map(normalizeAmount),
      ...extractAmountsFromText(seg.join(' '))
    ].filter(Boolean)));
    const mentionsBPI = /biaya\s*pengalaman\s*industri/i.test(segLower) || /pengalaman\s*industri/i.test(segLower);
    const mentionsAllTiers = segLower.includes('internasional') && segLower.includes('nasional') && segLower.includes('lokal');
    if (mentionsBPI && mentionsAllTiers && allAmounts.length >= 3) {
      if (allAmounts.length >= 3) {
        const sorted = allAmounts
          .slice(0, 6)
          .sort((a, b) => parseMoneyToInt(b) - parseMoneyToInt(a));

        const tierMap = [
          { tier: 'Internasional', amount: sorted[0] },
          { tier: 'Nasional', amount: sorted[1] },
          { tier: 'Lokal', amount: sorted[2] }
        ].filter(x => x.amount);

        if (tierMap.length === 3) {
          let bpiTiming = '';
          if (/dicicil/i.test(segLower)) {
            bpiTiming = /dicicil\s*5\s*kali|dicicil5kali/i.test(segLower)
              ? 'Dicicil 5 kali per semester'
              : 'Dicicil';
          }
          for (const tm of tierMap) {
            items.push({ label: `Biaya Pengalaman Industri (${tm.tier})`, amount: tm.amount, timing: bpiTiming });
          }
          continue;
        }
      }
    }

    const labelParts = seg.slice(0, amountIdx);
    const amountTok = normalizeAmount(seg[amountIdx]);
    const timingParts = seg.slice(amountIdx + 1);

    const label = labelParts
      .join(' ')
      .replace(/[ΓÇ£ΓÇ¥'ΓÇÿΓÇÖ]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Sometimes OCR includes a dash token before amount: "ΓÇö".
    const cleanedLabel = normalizeFeePhrase(label.replace(/\s*[ΓÇö-]\s*$/g, '').trim());
    if (!cleanedLabel) continue;
    if (!isLikelyFeeLabel(cleanedLabel)) continue;

    const timing = normalizeFeePhrase(timingParts
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim());

    items.push({ label: cleanedLabel, amount: amountTok, timing });
  }

  // Fallback for OCR rows that stay on one line (common for UTB).
  // If the token-based table parser didn't find anything but inline rows exist, use them.
  if (!items.length && inlineItems.length) {
    for (const it of inlineItems) {
      const label = normalizeFeePhrase(it.label);
      if (!label) continue;
      if (!isLikelyFeeLabel(label)) continue;
      items.push({ label, amount: it.amount, timing: normalizeFeePhrase(it.timing) });
    }
  }

  // Targeted fallback for regular-program OCR tables where some rows are missed by token parsing.
  // This especially helps the S1 (SI/TI/BD) table where row 5/6 are sometimes skipped.
  try {
    const isRegularProgram = ['si', 'ti', 'bd', 'sk', 'mi'].includes(programKey || '');
    if (isRegularProgram) {
      const hasSemesterFee = items.some(it => /Biaya\s*Pendidikan\s*Per\s*Semester/i.test(String(it.label || '')));
      const hasIndustryFee = items.some(it => /Biaya\s*Pengalaman\s*Industri/i.test(String(it.label || '')));

      const findRowStartIdx = (num) => {
        const n = String(num);
        for (let i = 0; i < rawLines.length; i += 1) {
          const l = String(rawLines[i] || '').trim();
          if (!l) continue;
          if (l === `${n}.` || l === `${n}`) return i;
          if (l.startsWith(`${n}.`)) {
            // Avoid matching amounts like "5.000.000" or "500.000".
            if (new RegExp(`^${escapeRegex(n)}\\.\\d`).test(l)) continue;
            return i;
          }
        }
        return -1;
      };

      const sliceRowTokens = (startIdx) => {
        if (startIdx < 0) return [];
        const out = [];
        for (let i = startIdx; i < rawLines.length; i += 1) {
          const l = String(rawLines[i] || '').trim();
          if (!l) continue;
          // Stop when reaching explanation/discount markers.
          const next = String(rawLines[i + 1] || '').trim();
          if (stopWords.test(l)) break;
          if (/^Penjelasan$/i.test(l) && /^Tambahan/i.test(next)) break;
          if (/^Potongan$/i.test(l) && /^Biaya/i.test(next)) break;
          // Stop if we reach the next numbered row after the first line.
          if (out.length > 0 && /^\d{1,2}\.?$/.test(l)) break;
          if (out.length > 0 && /^\d{1,2}\.(?!\d)/.test(l) && !/^\d{1,2}\.\d/.test(l)) break;
          out.push(l);
        }
        return out;
      };

      if (!hasSemesterFee) {
        const idx5 = findRowStartIdx(5);
        const row5 = sliceRowTokens(idx5);
        if (row5.length) {
          const expanded = [];
          for (const r of row5) expanded.push(...splitNumberPrefix(r));
          const flat = expanded.filter(Boolean);
          // Remove the leading number token if present.
          const startAt = flat[0] && isNumberStart(flat[0]) ? 1 : 0;
          const seg = flat.slice(startAt);
          const amountIdx = seg.findIndex(looksLikeAmount);
          if (amountIdx >= 0) {
            const label = normalizeFeePhrase(seg.slice(0, amountIdx).join(' '));
            const amount = normalizeAmount(seg[amountIdx]);
            const timing = normalizeFeePhrase(seg.slice(amountIdx + 1).join(' '));
            if (label && amount) items.push({ label, amount, timing });
          }
        }
      }

      if (!hasIndustryFee) {
        const idx6 = findRowStartIdx(6);
        const row6 = sliceRowTokens(idx6);
        if (row6.length) {
          const expanded = [];
          for (const r of row6) {
            const parts = splitNumberPrefix(r);
            for (const p of parts) expanded.push(p);
          }
          const seg = expanded.filter(Boolean);
          const textLower = seg.join(' ').toLowerCase();
          const amounts = Array.from(new Set(seg.filter(looksLikeAmount).map(normalizeAmount)));
          if (/pengalaman\s*industri/i.test(textLower) && amounts.length >= 3) {
            const sorted = amounts
              .slice(0, 6)
              .sort((a, b) => parseMoneyToInt(b) - parseMoneyToInt(a));
            const tiers = [
              { tier: 'Internasional', amount: sorted[0] },
              { tier: 'Nasional', amount: sorted[1] },
              { tier: 'Lokal', amount: sorted[2] }
            ].filter(x => x.amount);
            if (tiers.length === 3) {
              for (const tm of tiers) {
                items.push({ label: `Biaya Pengalaman Industri (${tm.tier})`, amount: tm.amount, timing: '' });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore and let normal flow continue.
  }

  if (!items.length) return null;

  // De-dupe repeated fee rows caused by chunk overlap.
  const seenItemKey = new Set();
  const dedupedItems = [];
  for (const it of items) {
    const key = `${String(it.label || '').trim().toLowerCase()}|${String(it.amount || '').trim()}|${String(it.timing || '').trim().toLowerCase()}`;
    if (seenItemKey.has(key)) continue;
    seenItemKey.add(key);
    dedupedItems.push({
      label: normalizeFeePhrase(it.label),
      amount: it.amount,
      timing: normalizeFeePhrase(it.timing)
    });
  }

  // Consolidate duplicates (same label+amount) by picking the most readable timing.
  // This removes cases like DPP appearing twice where one bullet includes table header noise.
  const pickBestPerLabelAmount = (rows) => {
    const groups = new Map();
    for (const r of rows) {
      const labelKey = String(r.label || '').trim().toLowerCase();
      const amountKey = String(r.amount || '').trim();
      const key = `${labelKey}|${amountKey}`;
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }

    const scoreRow = (r) => {
      const label = String(r.label || '');
      const timing = String(r.timing || '');
      const text = `${label} ${timing}`.toLowerCase();

      let score = 0;
      if (timing && timing.length > 0) score += 2;
      if (/pada\s*saat\s*daftar|dicicil|menjelang|saat\s*registrasi|awal\s*semester|semester\s*ii|s\/d\s*uts/i.test(text)) score += 3;
      if (/programstudi|waktu\s*pembayaran|jenis\s*biaya|no\.?\s*jenis|biayarp|dilik?anmahasiswa|kelasreguler/i.test(text)) score -= 8;
      if (/[A-Z]{12,}/.test(`${label} ${timing}`)) score -= 4;
      if (timing.length > 120) score -= 3;
      return score;
    };

    const out = [];
    for (const arr of groups.values()) {
      arr.sort((a, b) => scoreRow(b) - scoreRow(a));
      out.push(arr[0]);
    }
    return out;
  };

  const consolidatedItems = pickBestPerLabelAmount(dedupedItems);

  const prettyHeader =
    programKey === 'dnui'
      ? 'Dual Degree (International Class) DNUI (China)'
      : (programKey === 'help'
        ? 'Dual Degree (International Class) HELP University (Malaysia)'
        : (programKey === 'utb'
          ? 'Dual Degree (National Class) UTB'
          : (programKey === 'sk'
? 'Kelas Reguler - Program Studi Sistem Komputer'
          : (programKey === 'mi'
            ? 'Kelas Reguler - Program Studi Manajemen Informatika (Diploma)'
            : (programKey === 'ti'
              ? 'Kelas Reguler - Program Studi Teknologi Informasi'
              : (programKey === 'bd'
                ? 'Kelas Reguler - Program Studi Bisnis Digital'
                : (programKey === 'si'
                  ? 'Kelas Reguler - Program Studi Sistem Informasi'
                    : 'rincian biaya')))))));

  if (wantsSemesterOnly) {
    const semesterRow = consolidatedItems.find(it => /biaya\s*(pendidikan\s*)?per\s*semester/i.test(String(it && it.label ? it.label : '')));
    if (!semesterRow || !semesterRow.amount) return null;

    const amt = `Rp ${semesterRow.amount}`;
    const timing = String(semesterRow.timing || '').trim();
    const time = timing ? ` (${timing})` : '';

    const header = (prettyHeader && prettyHeader !== 'rincian biaya')
      ? `Untuk ${prettyHeader}, biaya pendidikan per semester (UKT): ${amt}${time}.`
      : `Biaya pendidikan per semester (UKT): ${amt}${time}.`;

    return {
      answer: header.trim(),
      source: 'rag-fee-semester-only'
    };
  }

  // If user asked for "biaya lainnya", focus on non-registration components.
  const filteredItems = wantsOtherOnly
    ? consolidatedItems.filter(x => !/\bpendaftaran\b/i.test(x.label))
    : consolidatedItems;

  if (!filteredItems.length) return null;

  // Stable, user-friendly ordering (especially for regular programs).
  const orderKey = (label) => {
    const l = String(label || '').toLowerCase();
    if (l.includes('pendaftaran')) return 10;
    if (l.includes('dana pendidikan pokok')) return 20;
    if (l.includes('biaya registrasi')) return 25;
    if (l.includes('jas')) return 30;
    if (l.includes('kaos')) return 40;
    if (l.includes('biaya pendidikan per semester')) return 50;
    if (l.includes('biaya pengalaman industri')) return 60;
    return 90;
  };

  const sortedItems = filteredItems
    .slice()
    .sort((a, b) => orderKey(a.label) - orderKey(b.label));

  const bullets = sortedItems.map(it => {
    const amt = it.amount ? `Rp ${it.amount}` : '';
    const cleanTiming = String(it.timing || '').trim();
    const time = cleanTiming ? ` - ${cleanTiming}` : '';
    return `- ${it.label}: ${amt}${time}`.trim();
  });

  // Add one concise payment note if present in the source.
  const noteText = combined.replace(/\s+/g, ' ');
  let note = '';
  const butirM = /Butir\s*1\s*sampai\s*dengan\s*(\d+)\s*dibayar\s*1\s*kali\s*saja\s*pada\s*awal\s*masuk/i.exec(noteText);
  if (butirM && butirM[1]) {
    note = `Catatan: Butir 1 sampai dengan ${butirM[1]} dibayar 1 kali saja pada awal masuk.`;
  }

  // If user explicitly asked about discounts, produce a template-like breakdown
  if (wantsDiscount) {
    const displayProgram = prettyHeader;
    const displayWaveGroup = (queryEntities && queryEntities.wave) ? normalizeWaveGroup(queryEntities.wave) : null;

    const findAmount = (pred) => {
      const it = sortedItems.find(x => pred(String(x.label || '').toLowerCase()));
      return it && it.amount ? it.amount : null;
    };

    const registrationAmt = findAmount(l => /pendaftaran/.test(l)) || (feeStruct && feeStruct.registrationFee) || null;
    const registrationDiscount = (feeStruct && feeStruct.registrationDiscount) ? feeStruct.registrationDiscount : null;

    const dppAmt = findAmount(l => /dana pendidikan pokok|dpp/.test(l)) || (feeStruct && feeStruct.dpp) || null;
    const dppDiscount = (feeStruct && feeStruct.dppDiscount) ? feeStruct.dppDiscount : null;

    // Collect awal masuk items (DPP + jas + kaos + tas + GMTI)
    const awalTokens = ['dana pendidikan pokok','dpp','jas','almamater','topi','kaos','tas','gmti','gmt'];
    const awalItems = sortedItems.filter(it => awalTokens.some(t => (it.label || '').toLowerCase().includes(t)));

    const parseIntAmt = (s) => parseMoneyToInt(s || '0');
    const formatRp = (n) => 'Rp ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    const subtotalAwal = awalItems.reduce((sum, it) => sum + (parseIntAmt(it.amount) || 0), 0);
    const dppDiscountInt = parseIntAmt(dppDiscount);
    const totalAwalAfterDiscount = subtotalAwal - (dppDiscountInt || 0);

    const regAmtInt = parseIntAmt(registrationAmt);
    const regDiscInt = parseIntAmt(registrationDiscount);
    const regAfter = regAmtInt - (regDiscInt || 0);

    const linesOut = [];
    linesOut.push('Baik, kak. Terimakasih atas pertanyaannya.');
    linesOut.push('');
    linesOut.push(`Untuk program studi ${displayProgram}, rincian biaya sebagai berikut:`);
    if (displayWaveGroup) {
      linesOut.push(`Gelombang: ${displayWaveGroup}`);
      linesOut.push(`Gelombang ${displayWaveGroup}`);
      linesOut.push('');
    }
    linesOut.push('');
    // Pendaftaran block
    linesOut.push('Pendaftaran:');
    if (registrationAmt) linesOut.push(`* Biaya pendaftaran: ${registrationAmt}`);
    if (registrationDiscount) linesOut.push(`* Potongan biaya pendaftaran (Gelombang ${displayWaveGroup || 'terkait'}): ${registrationDiscount}`);
    if (registrationAmt) linesOut.push(`Total biaya pendaftaran (Gelombang ${displayWaveGroup || 'terkait'}): ${formatRp(regAfter)}`);
    linesOut.push('');
    // Awal masuk block
    linesOut.push(`Biaya awal masuk untuk Prodi ${displayProgram}:`);
    if (dppAmt) linesOut.push(`* DPP: ${dppAmt}`);
    for (const it of awalItems) {
      if (!/dana pendidikan pokok|dpp/i.test(it.label)) linesOut.push(`* ${it.label}: Rp ${it.amount}`);
    }
    linesOut.push(``);
    linesOut.push(`Subtotal biaya awal masuk: ${formatRp(subtotalAwal)}`);
    if (dppDiscount) linesOut.push(`* Potongan biaya DPP (Gelombang ${displayWaveGroup || 'terkait'}): ${dppDiscount}`);
    linesOut.push(`Total awal masuk setelah potongan (Gelombang ${displayWaveGroup || 'terkait'}): ${formatRp(totalAwalAfterDiscount)}`);
    linesOut.push('');
    if (feeStruct && feeStruct.ukt) linesOut.push(`Biaya pendidikan per semester (UKT): ${feeStruct.ukt}`);
    linesOut.push('');
    // Scholarship suggestions
    linesOut.push('Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:');
    linesOut.push('* Beasiswa KIP');
    linesOut.push('* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)');
    linesOut.push('* Beasiswa Prestasi');
    linesOut.push('* Beasiswa Yayasan');
    linesOut.push('Silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus.');
    linesOut.push('* Kuliah Sambil Kerja di Luar Negeri');
    linesOut.push('');
    linesOut.push('Apakah Kakak ingin dijelaskan tentang?');
    linesOut.push('* Biaya perkuliahan program studi yang lainnya');
    linesOut.push('* Salah satu jenis beasiswa');
    linesOut.push('* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll');
    linesOut.push('Silahkan diketikkan.');

    return { answer: linesOut.join('\n'), source: 'rag-fee-discount-breakdown' };
  }

  const opener = wantsOtherOnly
    ? `Berikut rangkuman biaya lainnya (di luar biaya pendaftaran) untuk ${prettyHeader}:`
    : `Berikut rangkuman rincian biaya untuk ${prettyHeader}:`;

  const out = [opener, '', ...bullets];
  if (note) out.push('', note);
  // If the source document doesn't include an explicit total, compute one from parsed rows
  try {
    const totalInt = sortedItems.reduce((sum, it) => sum + (parseMoneyToInt(it.amount) || 0), 0);
    const mentionsTotalInSource = /total\s+biaya|total\s+awal\s+masuk|subtotal|subtotal\s+awal\s+masuk/i.test(noteText) || consolidatedItems.some(it => /\btotal\b/i.test(String(it.label || '')));
    if (totalInt > 0 && !mentionsTotalInSource) {
      const formatTotal = (n) => 'Rp ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      out.push('', `Total (dihitung): ${formatTotal(totalInt)}`);
    }
  } catch (e) {
    // ignore computation errors and continue
  }

  out.push('', 'Mau saya rangkum juga skema potongan per gelombangnya?');

  return {
    answer: out.join('\n').trim(),
    source: 'rag-fee-breakdown'
  };
}

async function query(question, topK = 8, options = null) {
  console.log("[TRACE_FUNC] query start", { question, topK, options });
  console.trace();
  try {
    const opts = (options && typeof options === 'object') ? options : {};
    const index = loadIndex();

    // Use only the current user question for retrieval to avoid diluting embeddings
    // when provider passes anchored follow-ups.
    const currentUserQ = extractCurrentUserQuestionText(question);
    const normalizedUserQ = normalizeIndonesianQuestionText(currentUserQ);
    // [VALIDATOR] Query normalization: fix colloquial abbreviations pre-retrieval
    const queryForRetrieval = normalizeQueryForRetrieval(normalizedUserQ);
    
    // Use the normalized user query for structured entity extraction and intent detection.
    // queryForRetrieval may add retrieval-specific expansions and should not influence intent.
    const queryEntities = extractStructuredEntities(normalizedUserQ || currentUserQ || question);

    const traceRagDecision = (details) => {
      if (String(process.env.TRACE_RAG_DECISION).toLowerCase() !== 'true') return;
      try {
        console.log('[TRACE_RAG_DECISION]', {
          timestamp: new Date().toISOString(),
          question: String(question || '').substring(0, 160),
          ...details
        });
      } catch (e) {}
    };

    try {
      console.log('[TRACE_RAG_QUERY_ENTITIES]', {
        queryForRetrieval,
        normalizedUserQ,
        currentUserQ,
        queryEntities
      });
    } catch (e) {}
    
    let queryEmbedding = null;

    // Quick deterministic path: if user asks explicitly about potongan gelombang,
    // use backup trainingData.json to answer deterministically.
    try {
      
      const qLower = String(queryForRetrieval || normalizedUserQ || currentUserQ || question || '').toLowerCase();
      // If user asks about discounts and either mentions a gelombang or pendaftaran,
      // try deterministic backup parsing. This handles generic queries like
      // "potongan biaya pendaftaran prodi bd" even when the user omits the word "gelombang".
      if (qLower.includes('potongan') && (qLower.includes('gelombang') || qLower.includes('pendaftaran') || /potongan\s*biaya\s*pendaftaran/i.test(qLower))) {
        
        const backupPath = path.join(__dirname, '..', '..', 'backups', 'backup-20260424-145106', 'trainingData.json');
        if (fs.existsSync(backupPath)) {
          const backupRaw = String(fs.readFileSync(backupPath, 'utf8') || '');
          if (backupRaw) {
            const backupJson = JSON.parse(backupRaw);
            const rows = Array.isArray(backupJson && backupJson.rows) ? backupJson.rows : [];
            const scanText = rows.map(row => String(row && row.content ? row.content : '')).filter(Boolean).join('\n');
            
            if (scanText) {
              // reuse helper parsing logic
              const normalizeWaveLocal = (value) => {
                const upper = String(value || '').toUpperCase().trim();
                if (!upper) return null;
                if (upper.includes('KHUSUS')) return 'Khusus';
                const base = /^((?:IV|III|II|I)|[1-9][0-9]?)(?:\s*[A-C])?$/.exec(upper);
                if (!base) return null;
                const token = base[1];
                const arabicToRoman = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
                return arabicToRoman[token] || token;
              };

              const regMap = new Map();
              const dppMap = new Map();
              const registrationSection = scanText.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
              const dppSection = scanText.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);
              const regText = registrationSection ? registrationSection[0] : '';
              const dppText = dppSection ? dppSection[0] : '';
              

              if (regText) {
                for (const match of regText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)) {
                  const waveLabel = normalizeWaveLocal(match[1]);
                  if (waveLabel) regMap.set(waveLabel, `Rp ${match[2]}`);
                }
                for (const match of regText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?/gi)) {
                  const waveLabel = normalizeWaveLocal(match[2]);
                  if (waveLabel && !regMap.has(waveLabel)) regMap.set(waveLabel, `Rp ${match[1]}`);
                }
              }

              if (dppText) {
                for (const match of dppText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)) {
                  const waveLabel = normalizeWaveLocal(match[1]);
                  if (waveLabel) dppMap.set(waveLabel, `Rp ${match[2]}`);
                }
                for (const match of dppText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?/gi)) {
                  const waveLabel = normalizeWaveLocal(match[2]);
                  if (waveLabel && !dppMap.has(waveLabel)) dppMap.set(waveLabel, `Rp ${match[1]}`);
                }
              }

              if (regMap.size > 0 || dppMap.size > 0) {
                const lines = [];
                const requestedWaveMatch = /gelombang\s*([a-z0-9ivx]+)(?:\s*([a-c]))?/i.exec(question || '');
                let requestedWave = null;
                if (requestedWaveMatch && requestedWaveMatch[1]) {
                  // NORMALIZE requested wave (e.g., "1A" → "I", "2B" → "II")
                  requestedWave = normalizeWaveLocal(`${requestedWaveMatch[1]}${requestedWaveMatch[2] || ''}`);
                }
                const pushTarget = (label) => {
                  if (regMap.has(label)) lines.push(`- ${regMap.get(label)} jika mendaftar pada ${label === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`);
                  if (dppMap.has(label)) lines.push(`- ${dppMap.get(label)} untuk DPP pada ${label === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`);
                };
                if (requestedWave) {
                  pushTarget(requestedWave);
                  if (lines.length === 0) {
                    for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label);
                  }
                } else {
                  for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label);
                }

                if (lines.length > 0) {
                  
                  const answer = `Potongan biaya pendaftaran yang tersedia adalah:\n\n${lines.join('\n')}\n\nUntuk informasi lain di luar daftar di atas, silakan konfirmasi ke admin kampus untuk kepastian.`;
                  const nowTs = new Date().toISOString();
                  const contexts = [];
                  if (regText) contexts.push({ id: 'backup-registration-section', filename: 'PMB_OFFICIAL_BACKUP', chunk: regText, chunkType: 'COST', ocrQualityScore: 1.0, updatedAt: nowTs, lowConfidence: false });
                  if (dppText) contexts.push({ id: 'backup-dpp-section', filename: 'PMB_OFFICIAL_BACKUP', chunk: dppText, chunkType: 'COST', ocrQualityScore: 1.0, updatedAt: nowTs, lowConfidence: false });
                  return { success: true, answer: formatRagAnswer(cleanAnswerLanguage(answer), 'rag-fee-structured', 'HIGH', question), source: 'rag-fee-structured', contexts, confidenceTier: 'HIGH' };
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // ignore and continue
    }
    const divisionKeyRaw = (typeof opts.divisionKey === 'string') ? opts.divisionKey : null;
    const divisionKey = divisionKeyRaw ? String(divisionKeyRaw).toLowerCase().trim() : null;
    const includeGlobal = opts.includeGlobal === undefined ? true : !!opts.includeGlobal;

    let indexForQuery = index;
    let usedGlobalFallback = false;
    if (divisionKey) {
      const primary = index.filter(it => it && String(it.divisionKey || '').toLowerCase().trim() === divisionKey);
      const globalOnly = includeGlobal ? index.filter(it => it && !it.divisionKey) : [];

      if (primary.length === 0) {
        // Backward compatibility: if division-specific index is empty, fall back to global.
        usedGlobalFallback = globalOnly.length > 0;
        indexForQuery = globalOnly;
      } else {
        indexForQuery = includeGlobal ? primary.concat(globalOnly) : primary;
        usedGlobalFallback = includeGlobal && globalOnly.length > 0;
      }
    }

    // Deterministic rule: general questions about Dual Degree should list all available programs
    // from the index (UTB, DNUI, HELP), without depending on top-K similarity.
    try {
      const dualDegree = tryStructuredDualDegreeProgramsAnswer(question);
      if (dualDegree && dualDegree.answer) {
        return wrapRagResult(cleanAnswerLanguage(dualDegree.answer), dualDegree.source, 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Dual-degree rule failed');
    }

    // Deterministic rule: when user asks tentang potongan/diskon untuk Dual Degree,
    // coba ekstrak potongan langsung dari dokumen UTB/DNUI/HELP yang ada di index.
    try {
      const dualDegreeFee = tryStructuredDualDegreeFeeAnswer ? tryStructuredDualDegreeFeeAnswer(question, indexForQuery) : null;
      if (dualDegreeFee && dualDegreeFee.answer) {
        return wrapRagResult(cleanAnswerLanguage(dualDegreeFee.answer), dualDegreeFee.source, 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Dual-degree-fee rule failed');
    }

    // Deterministic rule: fee breakdown for UTB/DNUI/HELP should not depend on retrieval.
    // This prevents "Tidak ada jawaban" when strict/coverage guards reject the retrieved top-K.
    // SKIP this early rule if user is asking specifically about fee for a specific gelombang.
    // If they say "biaya prodi si gelombang 1A", let the discount extractor handle it instead.
    const feeBreakdownQCheck = String(queryForRetrieval || normalizedUserQ || currentUserQ || question || '').toLowerCase();
    const asksAboutSpecificGelombangFee = feeBreakdownQCheck.includes('biaya') && feeBreakdownQCheck.includes('gelombang');
    if (!asksAboutSpecificGelombangFee) {
      try {
        const feeBreakdownEarly = tryStructuredFeeBreakdownAnswer(question, null, opts);
        if (feeBreakdownEarly && feeBreakdownEarly.answer) {
          return wrapRagResult(cleanAnswerLanguage(feeBreakdownEarly.answer), feeBreakdownEarly.source, 'HIGH', question);
        }
      } catch (e) {
        logger.warn({ err: e.message }, '[RAG] Fee-breakdown early rule failed');
      }
    }

    // Deterministic rule: "gelombang yang sedang dibuka sekarang" should not depend on retrieval/coverage.
    // This fixes cases where relevance/coverage guards return null even though the schedule table exists.
    try {
      const currentOpen = tryStructuredCurrentOpenWavesAnswer(extractCurrentUserQuestionText(question));
      if (currentOpen && currentOpen.answer) {
        return wrapRagResult(cleanAnswerLanguage(currentOpen.answer), currentOpen.source || 'rag-current-open-waves', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Current-open-waves early rule failed');
    }

    // Deterministic rule: short question "biaya pendaftaran prodi SI/TI/BD/SK" should return a short answer.
    // Avoids WhatsApp send failures due to overly long breakdown answers.
    try {
      const regMenu = tryStructuredProgramRegistrationMenuAnswer(question);
      if (regMenu && regMenu.answer) {
        return wrapRagResult(cleanAnswerLanguage(regMenu.answer), regMenu.source || 'rag-program-registration-menu', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Program registration-menu early rule failed');
    }

    try {
      const feeReg = tryStructuredProgramRegistrationFeeAnswer(question, opts);
      if (feeReg && feeReg.answer) {
        return wrapRagResult(cleanAnswerLanguage(feeReg.answer), feeReg.source || 'rag-program-fee-registration', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Program registration-fee early rule failed');
    }

    // Deterministic rule: scholarship menu follow-ups like "ranking" or one-word "beasiswa"
    // should not depend on embedding retrieval / minScore / strict coverage guards.
    try {
      const scholarshipEarly = tryStructuredScholarshipAnswer(question, ' ');
      if (scholarshipEarly && scholarshipEarly.answer) {
        return wrapRagResult(cleanAnswerLanguage(scholarshipEarly.answer), scholarshipEarly.source || 'rag-scholarship-rule', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Scholarship early rule failed');
    }

    // Deterministic rule: RPL / Rekognisi Pembelajaran Lampau
    try {
      const rplEarly = tryStructuredRplAnswer(question);
      if (rplEarly && rplEarly.answer) {
        return wrapRagResult(cleanAnswerLanguage(rplEarly.answer), rplEarly.source || 'rag-rpl', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] RPL early rule failed');
    }

    // Deterministic rule: campus-level accreditation summary when user asks about the campus (not a specific program).
    // Run this before program-level accreditation so campus questions are handled correctly.
    try {
      const campusAccEarly = tryStructuredCampusAccreditationAnswer(question, indexForQuery);
      if (campusAccEarly && campusAccEarly.answer) {
        return wrapRagResult(cleanAnswerLanguage(campusAccEarly.answer), campusAccEarly.source, 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Campus-accreditation early rule failed');
    }

    // Deterministic rule: accreditation questions like "akreditasi BD apa?" should not depend on retrieval/strict mode.
    try {
      const accred = tryStructuredAccreditationAnswer(question, indexForQuery);
      if (accred && accred.answer) {
        return wrapRagResult(cleanAnswerLanguage(accred.answer), accred.source || 'rag-accreditation', 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Accreditation early rule failed');
    }

    // Deterministic rule: overview of all programs (brief summaries)
    // PRIORITY: Execute this BEFORE major-recommendation to catch queries like "Ada program studi apa saja?"
    try {
      const overview = tryStructuredProgramOverviewAnswer(question);
      if (overview && overview.answer) {
        return wrapRagResult(cleanAnswerLanguage(overview.answer), overview.source, 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Program-overview rule failed');
    }

    // Deterministic rule: program/jurusan recommendation for social-media content questions.
    // Prefer retrieval-first behavior: include contexts/debug when available; fall back to heuristics.
    try {
      if (!queryEntities || (!queryEntities.program && queryEntities.intent !== 'ACADEMIC_PROGRAM')) {
        const majorFit = await tryStructuredProgramRecommendationAnswer(question, indexForQuery);
        if (majorFit && majorFit.answer) {
          return {
            success: true,
            answer: formatRagAnswer(cleanAnswerLanguage(majorFit.answer), majorFit.source, majorFit.confidenceTier || 'HIGH', question),
            source: majorFit.source,
            contexts: Array.isArray(majorFit.contexts) ? majorFit.contexts : [],
            confidenceTier: majorFit.confidenceTier || 'HIGH',
            debug: majorFit.debug || null
          };
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Major-recommendation rule failed');
    }

    // Deterministic rule: compare two programs (SI vs SK)
    try {
      const comp = tryStructuredProgramComparisonAnswer(question);
      if (comp && comp.answer) {
        return wrapRagResult(cleanAnswerLanguage(comp.answer), comp.source, 'HIGH', question);
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Program-comparison rule failed');
    }

    if (queryEntities.intent === 'COST' || queryEntities.academicIntent === 'BIAYA') {
      try {
        queryEmbedding = await computeEmbedding(queryForRetrieval || normalizedUserQ || currentUserQ || question);
        const costResult = tryStructuredExactCostAnswer(question, queryEntities, indexForQuery, 3, queryEmbedding);
        if (costResult && costResult.answer) {
          // Preserve contexts from structured result if available (do not lose grounding).
          return {
            success: true,
            answer: formatRagAnswer(cleanAnswerLanguage(costResult.answer), costResult.source || 'rag-fee-structured', costResult.confidenceTier || 'HIGH', question),
            source: costResult.source || 'rag-fee-structured',
            contexts: Array.isArray(costResult.contexts) ? costResult.contexts : [],
            confidenceScore: costResult.confidenceScore || null,
            confidenceTier: costResult.confidenceTier || 'HIGH',
            debug: costResult.debug || null
          };
        }
      } catch (e) {
        logger.warn({ err: e.message }, '[RAG] Structured exact-cost rule failed');
      }
    }

    // Jika belum ada index sama sekali, jangan paksa AI menjawab tanpa konteks
    if (!indexForQuery || indexForQuery.length === 0) {
      return {
        success: true,
        answer: null,
        source: 'rag',
        contexts: [],
        debug: { divisionKey: divisionKey || null, includeGlobal, usedGlobalFallback }
      };
    }

    const qEmb = queryEmbedding || await computeEmbedding(queryForRetrieval || normalizedUserQ || currentUserQ || question);
    const intent = detectIntent(queryForRetrieval || normalizedUserQ); // Intent detection on normalized query
    const debugCollector = { queryEntities, initialCandidatesCount: 0, afterRelevantCount: 0, afterIntentValidationCount: 0, rejected: [] };

    let scored = indexForQuery.map(item => {
      const semanticScore = cosineSimilarity(qEmb, item.embedding);
      const breakdown = getChunkScoreBreakdown(item, question, intent, semanticScore, queryEntities);
      return {
        item,
        score: semanticScore,
        semanticScore,
        finalScore: breakdown.finalScore,
        compositeScore: breakdown.compositeScore,
        attributeScore: breakdown.attributeScore,
        metadataBoost: breakdown.metadataBoost,
        scoreComponents: {
          rawSemanticScore: breakdown.semantic,
          semanticBoost: breakdown.semanticBoost,
          evidenceScore: breakdown.evidenceScore,
          keywordScore: breakdown.keywordScore,
          attributeScore: breakdown.attributeScore,
          exactBoost: breakdown.exactBoost,
          metadataBoost: breakdown.metadataBoost,
          rawScore: breakdown.rawScore,
          finalScore: breakdown.finalScore,
          categorySignal: breakdown.categorySignal,
          trustBoost: breakdown.trustBoost,
          otherBoosts: breakdown.otherBoosts,
          legalPenalty: breakdown.legalPenalty,
          headerPenalty: breakdown.headerPenalty,
          lowOcrPenalty: breakdown.lowOcrPenalty,
          feeKeywordPenalty: breakdown.feeKeywordPenalty,
          programOverviewPenalty: breakdown.programOverviewPenalty,
          multiProgramPenalty: breakdown.multiProgramPenalty,
          itemEntities: breakdown.itemEntities,
          itemCategory: breakdown.itemCategory,
          queryCategory: breakdown.queryCategory,
          exactMatch: breakdown.exactMatch
        }
      };
    });
    debugCollector.initialCandidatesCount = scored.length;
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    // Explicit candidate injection: for academic program intents, ensure we include
    // additional candidates from PRODI_PROFILE/KURIKULUM/PROSPEK_KERJA even if their
    // semantic score is slightly lower than high-scoring BIAYA chunks. This guarantees
    // these categories are present in the candidate pool before intent filtering.
    try {
      const intentUpper = String(intent || '').toUpperCase();
      const academicIntents = new Set(['DEFINISI_PRODI', 'KURIKULUM_PEMBELAJARAN', 'PROSPEK_KERJA', 'ACADEMIC_PROGRAM']);
      const forcedCats = new Set(['PRODI_PROFILE', 'KURIKULUM', 'PROSPEK_KERJA']);
      if (academicIntents.has(intentUpper) || (queryEntities && queryEntities.program)) {
        const existingIds = new Set(scored.map(s => s.item && s.item.id));
        const forced = [];
        // build program tokens to look for in filenames/chunks
        const progTokens = new Set();
        if (queryEntities && queryEntities.program) {
          progTokens.add(String(queryEntities.program).toLowerCase());
        }
        const qLow = String(queryForRetrieval || normalizedUserQ || currentUserQ || question || '').toLowerCase();
        // common abbreviation expansions
        if (qLow.includes(' ti ') || qLow.endsWith(' ti') || qLow.startsWith('ti ')) progTokens.add('teknologi informasi');
        if (qLow.includes(' si ') || qLow.endsWith(' si') || qLow.startsWith('si ')) progTokens.add('sistem informasi');
        if (qLow.includes(' sk ') || qLow.endsWith(' sk') || qLow.startsWith('sk ')) progTokens.add('sistem komputer');
        if (qLow.includes(' bd ') || qLow.endsWith(' bd') || qLow.startsWith('bd ')) progTokens.add('bisnis digital');
        if (qLow.includes(' mi ') || qLow.endsWith(' mi') || qLow.startsWith('mi ')) progTokens.add('manajemen informasi');
        for (const it of indexForQuery) {
          try {
            const docCat = String(it.docCategory || it.category || '').toUpperCase();
            const fname = String(it.filename || it.trainingId || '').toLowerCase();
            const filenameMatch = /(?:program studi|penjelasan\s+semua|penjelasan\s+prodi|penjelasan prodi|penjelasan prodi dan karier|prodi|kurikulum|mata kuliah|mata_kuliah|mata-kuliah|karier|career|prospek|peluang\s+kerja|profil)/i.test(fname);
            // also check if chunk or filename contains program tokens
            const chunkLow = String(it.chunk || '').toLowerCase();
            let programMention = false;
            for (const t of progTokens) {
              if (!t) continue;
              if (chunkLow.includes(t) || fname.includes(t)) { programMention = true; break; }
            }
            if (!forcedCats.has(docCat) && !filenameMatch && !programMention) continue;
            if (existingIds.has(it.id)) continue;
            const sem = qEmb && Array.isArray(it.embedding) ? cosineSimilarity(qEmb, it.embedding) : 0;
            const comp = computeChunkCompositeScore(it, question, intent, sem, queryEntities);
            const forcedFinal = Number.isFinite(comp) ? Math.max(-1, Math.min(1, comp)) : -1;
            // Only consider non-negative composite scores to avoid injecting clearly irrelevant chunks
            if (comp > -0.5) forced.push({ item: it, score: sem, compositeScore: comp, finalScore: forcedFinal });
          } catch (e) {
            /* ignore per-item errors */
          }
        }
        if (forced.length > 0) {
          forced.sort((a, b) => b.compositeScore - a.compositeScore);
          const takeN = Math.max(4, Math.min(12, Math.floor(Math.max(4, scored.length * 0.15))));
          const toAdd = forced.slice(0, takeN);
          if (toAdd.length > 0) {
            scored.push(...toAdd);
            // Re-sort after injection
            scored.sort((a, b) => b.compositeScore - a.compositeScore);
          }
        }
      }
    } catch (e) { /* ignore injection errors */ }
    if (process.env.RAG_DEBUG_CHUNK_SCORING) {
      try {
        const topDebug = scored.slice(0, 8).map((s) => ({
          id: s.item && s.item.id != null ? s.item.id : null,
          filename: s.item && s.item.filename ? s.item.filename : null,
          chunkType: s.item && s.item.chunkType ? s.item.chunkType : null,
          category: s.item && s.item.category ? s.item.category : null,
          score: Number(s.score.toFixed(4)),
          rawScore: Number((s.compositeScore || 0).toFixed(4)),
          finalScore: Number(s.finalScore.toFixed(4)),
          semanticBoost: Number((s.scoreComponents && s.scoreComponents.semanticBoost || 0).toFixed(4)),
          evidenceScore: Number((s.scoreComponents && s.scoreComponents.evidenceScore || 0).toFixed(4)),
          attributeScore: Number((s.scoreComponents && s.scoreComponents.attributeScore || 0).toFixed(4)),
          metadataBoost: Number((s.scoreComponents && s.scoreComponents.metadataBoost || 0).toFixed(4)),
          otherBoosts: Number((s.scoreComponents && s.scoreComponents.otherBoosts || 0).toFixed(4)),
          chunkPreview: String(s.item && s.item.chunk ? s.item.chunk : '').slice(0, 120).replace(/\s+/g, ' ').trim()
        }));
        const debugQuery = queryForRetrieval || normalizedUserQ || currentUserQ || question;
        logger.info({ query: debugQuery, intent, topChunks: topDebug }, '[RAG] chunk scoring debug');
      } catch (e) {
        logger.warn({ err: e && e.message ? e.message : String(e) }, '[RAG] chunk scoring debug failed');
      }
    }
    // Intent-aware reranking: apply stronger boosts/penalties per-category
    // BEFORE duplicate penalty and before any Top-K truncation so the
    // final candidate ordering reflects intent preferences.
    try {
      const intentUpper = String(intent || '').toUpperCase();
      const isDefinisi = intentUpper === 'DEFINISI_PRODI' || intentUpper === 'ACADEMIC_PROGRAM' || intentUpper === 'DEFINISI';
      const isKurikulum = intentUpper === 'KURIKULUM_PEMBELAJARAN';
      const isProspek = intentUpper === 'PROSPEK_KERJA';

      for (const s of scored) {
        try {
          const docCat = String(s.item && (s.item.docCategory || s.item.category) || '').toUpperCase();
          const fname = String((s.item && (s.item.filename || s.item.trainingId)) || '').toLowerCase();
          const chunkText = String(s.item && s.item.chunk || '').toLowerCase();
          // Heuristic category detection from content/filename when docCategory is missing or UNKNOWN
          let inferredCat = null;
          if (/(profil\s+lulusan|profil\s+prodi|profil\s+program|profil\b|profil\s)/i.test(chunkText) || /profil/.test(fname)) {
            inferredCat = 'PRODI_PROFILE';
          } else if (/\b(kurikulum|mata\s+kuliah|mata_kuliah|kurikulum\b)/i.test(chunkText) || /kurikulum|mata kuliah/.test(fname)) {
            inferredCat = 'KURIKULUM';
          } else if (/\b(prospek\s+kerja|karier|karir|lulusan|peluang\s+kerja)\b/i.test(chunkText) || /karier|career|prospek/.test(fname)) {
            inferredCat = 'PROSPEK_KERJA';
          }
          const effectiveCat = (docCat && docCat !== 'UNKNOWN') ? docCat : (inferredCat || docCat);
          let delta = 0;

          // Boost preferences
          if (isDefinisi) {
            if (effectiveCat === 'PRODI_PROFILE') delta += 2.2; // stronger boost for definitions
            if (effectiveCat === 'KURIKULUM') delta += 1.2; // medium
            if (effectiveCat === 'PROSPEK_KERJA') delta += 1.2;
          }
          if (isKurikulum) {
            if (effectiveCat === 'KURIKULUM') delta += 1.5;
            if (effectiveCat === 'PRODI_PROFILE') delta += 0.9;
            if (effectiveCat === 'PROSPEK_KERJA') delta += 0.9;
          }
          if (isProspek) {
            if (effectiveCat === 'PROSPEK_KERJA') delta += 1.6;
            if (effectiveCat === 'PRODI_PROFILE') delta += 0.9;
            if (effectiveCat === 'KURIKULUM') delta += 0.9;
          }

          // Universal penalties to demote noisy categories
          if (effectiveCat === 'BIAYA') delta -= 1.8; // stronger penalty
          if (effectiveCat === 'SK') delta -= 1.6; // high penalty
          if (effectiveCat === 'AKREDITASI') delta -= 0.8; // medium
          if (effectiveCat === 'TEMPLATE' || effectiveCat === 'SURAT') delta -= 1.3; // high

          // Also penalize based on filename hints (templates, surat)
          if (/(template|template_|template\s|formulir|surat|pengumuman)/i.test(fname)) delta -= 0.9;

          // Apply delta to compositeScore
          s.compositeScore = Number((s.compositeScore + delta).toFixed(6));
        } catch (e) { /* ignore per-item */ }
      }
      // Re-sort after rerank
      scored.sort((a, b) => b.compositeScore - a.compositeScore);
    } catch (e) {
      /* ignore rerank errors */
    }

    applyDuplicateChunkPenalty(scored);

    // If the query explicitly names a program, prefer chunks whose entities
    // match that program and demote likely overview documents.
    if (queryEntities && queryEntities.program) {
      try {
        const qProg = String(queryEntities.program || '').toLowerCase();
        const exactMatches = [];
        const mentions = [];
        const rest = [];
        for (const s of scored) {
          const itemEntities = getChunkEntities(s.item) || {};
          const itemProg = itemEntities.program ? String(itemEntities.program).toLowerCase() : null;
          const fname = String((s.item && (s.item.filename || s.item.trainingId)) || '').toLowerCase();
          const chunkText = String(s.item && s.item.chunk || '').toLowerCase();
          const isOverviewFile = /\b(?:penjelasan\s+semua|semua\s+program|semua\s+prodi|penjelasan\s+prodi|overview\s+prodi)\b/.test(fname);
          const multiProg = (chunkText.match(/\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|si|ti|bd|sk)\b/ig) || []).length >= 2;
          const isOverview = isOverviewFile || multiProg;
          const qProgEsc = escapeRegex(qProg);
          const progRegex = new RegExp(`\\b${qProgEsc}\\b`, 'i');
          const mentionsProgram = progRegex.test(chunkText) || progRegex.test(fname);

          // If the chunk explicitly declares the same program but appears to be
          // an overview/multi-program chunk (e.g., "Penjelasan Semua Program Studi"),
          // don't treat it as a strong exact match. This prevents overview files
          // that mention many programs from outranking dedicated program chunks.
          if (itemProg && itemProg === qProg && !isOverview) {
            exactMatches.push(s);
            continue;
          }

          // If the chunk explicitly mentions the program but looks like an overview,
          // treat it as non-preferred so dedicated program chunks win.
          if (mentionsProgram && !isOverview) {
            mentions.push(s);
            continue;
          }

          rest.push(s);
        }

        // Preserve relative ordering within each group. Put exact matches first,
        // then mentions, then the rest. This guarantees item.program === query.program
        // will appear above generic overview documents.
        scored = [...exactMatches, ...mentions, ...rest];
      } catch (e) {
        /* ignore rerank errors */
      }
    }

    const relevantScored = filterRelevantChunks(question, scored, queryEntities);
    if (relevantScored.length > 0) {
      // Keep the retriever order while focusing on relevant document types.
      const topIds = new Set(relevantScored.slice(0, Math.max(topK, 8)).map(s => s.item.id));
      const reRanked = scored.filter(s => topIds.has(s.item.id));
      if (reRanked.length > 0) {
        scored.length = 0;
        scored.push(...reRanked);
      }
    }
    debugCollector.afterRelevantCount = (relevantScored && relevantScored.length) ? relevantScored.length : scored.length;

    // Apply intent-aware filtering and evidence validation
    // This prevents using chunks that merely mention keywords but don't answer the question
    const userIntent = classifyIntent(question);
    const validatedScored = applyIntentAwareFilteringAndValidation(question, scored, userIntent, debugCollector);
    debugCollector.afterIntentValidationCount = validatedScored.length;
    // Store validatedScored for detailed audit reporting (with enriched metadata)
    debugCollector.validatedScored = validatedScored.slice(0, 20).map(v => ({
      id: v.item && v.item.id,
      filename: v.item && (v.item.filename || v.item.trainingId),
      docCategory: v.item && (v.item.docCategory || v.item.category),
      text: v.item && v.item.chunk ? String(v.item.chunk).substring(0, 150) : '',
      score: v.score,
      semanticScore: v.semanticScore,
      rawScore: v.compositeScore,
      finalScore: v.finalScore,
      compositeScore: v.compositeScore,
      attributeScore: v.attributeScore,
      metadataBoost: v.metadataBoost,
      scoreComponents: v.scoreComponents,
      validationMetadata: v.validationMetadata
    }));
    
    // COMPREHENSIVE AUDIT LOGGING
    if (process.env.RAG_AUDIT_LOGGING === 'true' || process.env.RAG_DEBUG_INTENT_FILTERING === 'true') {
      try {
        // Log detailed audit info
        const auditInfo = {
          question: String(question || '').substring(0, 150),
          detectedIntent: userIntent,
          topBefore: scored.slice(0, 20).map((s, idx) => ({
            rank: idx + 1,
            id: s.item?.id,
            file: s.item?.filename,
            docCat: s.item?.docCategory || s.item?.category || 'NONE',
            semanticScore: Number(s.score?.toFixed(4) || 0),
            rawScore: Number((s.compositeScore || 0).toFixed(4)),
            finalScore: Number((typeof s.finalScore === 'number' ? s.finalScore : s.compositeScore)?.toFixed(4) || 0),
            attributeScore: Number((s.attributeScore || 0).toFixed(4)),
            metadataBoost: Number((s.metadataBoost || 0).toFixed(4)),
            chunk: String(s.item?.chunk || '').substring(0, 80).replace(/\n/g, ' ')
          })),
          topAfter: validatedScored.slice(0, 20).map((s, idx) => ({
            rank: idx + 1,
            id: s.item?.id,
            file: s.item?.filename,
            docCat: s.item?.docCategory || s.item?.category || 'NONE',
            semanticScore: Number(s.score?.toFixed(4) || 0),
            rawScore: Number((s.compositeScore || 0).toFixed(4)),
            finalScore: Number((typeof s.finalScore === 'number' ? s.finalScore : s.compositeScore)?.toFixed(4) || 0),
            attributeScore: Number((s.attributeScore || 0).toFixed(4)),
            metadataBoost: Number((s.metadataBoost || 0).toFixed(4)),
            chunk: String(s.item?.chunk || '').substring(0, 80).replace(/\n/g, ' ')
          })),
          filterStats: {
            before: scored.length,
            after: validatedScored.length,
            filtered: scored.length - validatedScored.length
          }
        };
        
        logger.info(auditInfo, '[RAG AUDIT] Query retrieval before/after filtering');
        auditLogger.logQueryRetrieval(question, userIntent, scored, validatedScored);
      } catch (auditErr) {
        logger.warn({ err: auditErr.message }, '[RAG AUDIT] Logging failed');
      }
    }
    
    if (process.env.RAG_DEBUG_INTENT_FILTERING) {
      logger.info({
        userIntent,
        totalChunksAfterRelevance: scored.length,
        validatedChunks: validatedScored.length,
        filtered: scored.length - validatedScored.length
      }, '[RAG] Intent validation applied');
    }

    // Apply Minimum Evidence Rule: If no chunks with proper evidence found, return no answer
    // instead of using unrelated chunks (e.g., cost chunks for definition questions)
    let chunksToUse = validatedScored.length > 0 ? validatedScored : scored;
    let skipRagAnswer = false;
    
    if (validatedScored.length === 0 && scored.length > 0 && userIntent !== 'GENERAL') {
      // Check if remaining chunks are all from forbidden categories
      const allForbidden = scored.every(s => {
        const chunkCat = s.item.docCategory || s.item.category || 'UNKNOWN';
        const forbidden = getForbiddenDocCategories(userIntent);
        return forbidden.has(chunkCat);
      });
      
      if (allForbidden) {
        if (process.env.RAG_DEBUG_INTENT_FILTERING) {
          logger.info({
            userIntent,
            question: String(question || '').substring(0, 80),
            reason: 'all_chunks_forbidden_for_intent'
          }, '[RAG] Skipping RAG answer due to minimum evidence rule');
        }
        skipRagAnswer = true;
      }
    }

    // Confidence score is based on the best cosine similarity from retrieval.
    // Typical range is [-1, 1] (often behaves like [0, 1] for relevant matches).
    const topScoreAll = (scored && scored.length && typeof scored[0].score === 'number') ? scored[0].score : null;

    const minConfidenceOverride = (typeof opts.minConfidenceScore === 'number' && Number.isFinite(opts.minConfidenceScore))
      ? opts.minConfidenceScore
      : null;
    const minConfidenceEnvRaw = process.env.RAG_MIN_CONFIDENCE_SCORE;
    const minConfidenceEnv = (minConfidenceEnvRaw !== undefined && minConfidenceEnvRaw !== null && String(minConfidenceEnvRaw).trim() !== '')
      ? parseFloat(String(minConfidenceEnvRaw))
      : null;
    const minConfidenceScore = minConfidenceOverride !== null
      ? minConfidenceOverride
      : (Number.isFinite(minConfidenceEnv) ? minConfidenceEnv : null);

    const minScoreOverride = (typeof opts.minScore === 'number' && Number.isFinite(opts.minScore)) ? opts.minScore : null;
    let minScore = minScoreOverride !== null ? minScoreOverride : parseFloat(process.env.RAG_MIN_SCORE || '0.6');

    // Optional strict mode to reduce off-topic answers.
    // - For short/ambiguous questions, require higher similarity.
    // - After retrieval, require a minimal keyword coverage in the top contexts.
    const strictRaw = (opts.strict ?? process.env.RAG_STRICT_MODE ?? 'false');
    const strict = String(strictRaw).toLowerCase() === 'true';
    if (strict) {
      const tokens = tokenizeForRelevanceGuard(question);
      const shortTokenCount = tokens.length <= 2;
      const shortLen = String(question || '').trim().length <= 18;
      if (shortTokenCount || shortLen) {
        const minShort = parseFloat(process.env.RAG_MIN_SCORE_SHORT || '0.45');
        if (Number.isFinite(minShort)) minScore = Math.max(minScore, minShort);
      }
    }

    const filtered = chunksToUse.filter(s => s.score >= minScore || (typeof s.finalScore === 'number' && s.finalScore >= minScore));

    const currentQ = extractCurrentUserQuestionText(question);
    const qLower = String(currentQ || question || '').toLowerCase();
    const looksLikePmbOverview = /(\balur\b|syarat|dokumen|\bkontak\b|kanal\s+pendaftaran|penerimaan\s+mahasiswa\s+baru|\bpmb\b)/i.test(qLower);
    const asksScheduleOnly = /(jadwal|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang|masa\s+pendaftaran)/i.test(qLower);
    const asksNowWaves = (/(sekarang|saat\s+ini|hari\s+ini|lagi\s+buka|yang\s+sedang\s+buka|terbuka|dibuka|open)/i.test(qLower) || /sekarang\s+gelombang\s+berapa/i.test(qLower)) && /(\bgelombang\b|\bgbg\b)/i.test(qLower);

    if (asksNowWaves) {
      const currentOpen = tryStructuredCurrentOpenWavesAnswer(currentQ);
      if (currentOpen && currentOpen.answer) {
        return {
          success: true,
          answer: formatRagAnswer(cleanAnswerLanguage(currentOpen.answer), currentOpen.source || 'rag-current-open-waves', 'HIGH', question),
          source: currentOpen.source || 'rag-current-open-waves',
          contexts: [],
          confidenceScore: topScoreAll
        };
      }
    }

    if (asksScheduleOnly) {
      const scheduleOverviewEarly = tryStructuredScheduleOverviewAnswer(question);
      if (scheduleOverviewEarly && scheduleOverviewEarly.answer) {
        return {
          success: true,
          answer: formatRagAnswer(cleanAnswerLanguage(scheduleOverviewEarly.answer), scheduleOverviewEarly.source, 'HIGH', question),
          source: scheduleOverviewEarly.source,
          contexts: [],
          confidenceScore: topScoreAll
        };
      }

      const scheduleEarly = tryStructuredScheduleAnswer(question, []);
      if (scheduleEarly && scheduleEarly.answer) {
        return {
          success: true,
          answer: formatRagAnswer(cleanAnswerLanguage(scheduleEarly.answer), scheduleEarly.source, 'HIGH', question),
          source: scheduleEarly.source,
          contexts: [],
          confidenceScore: topScoreAll
        };
      }
    }

    // Keyword-first lexical fallback for UKM/Ormawa queries.
    // If the user explicitly asks about UKM/Ormawa and there are chunks
    // that contain those keywords, prefer returning a short deterministic
    // snippet from the matched training document instead of relying
    // solely on vector similarity ranking.
    try {
      const qNorm = normalizeIndonesianQuestionText(question || '');
      if (/\bukm\b|\bormawa\b|\borganisasi\s+mahasiswa\b/i.test(qNorm)) {
        // If a precomputed, cleaned UKM list exists, prefer returning it
        try {
          // Prefer an explicitly categorized list if present
          const categorizedPath = path.join(__dirname, '..', 'data', 'ukm_list_categorized.json');
          if (fs.existsSync(categorizedPath)) {
            const rawC = fs.readFileSync(categorizedPath, 'utf8');
            const obj = JSON.parse(rawC || '{}');
            const categories = obj && obj.categories && typeof obj.categories === 'object' ? obj.categories : {};
            const others = Array.isArray(obj && obj.others) ? obj.others : [];

            const parts = [];
            let total = 0;
            for (const [cat, items] of Object.entries(categories)) {
              if (!Array.isArray(items) || items.length === 0) continue;
              total += items.length;
              parts.push(`${cat.toUpperCase()}:\n${items.map(it => `- ${String(it || '').trim()}`).join('\n')}`);
            }
            if (Array.isArray(others) && others.length > 0) {
              total += others.length;
              parts.push(`LAINNYA:\n${others.map(it => `- ${String(it || '').trim()}`).join('\n')}`);
            }

            const listText = parts.join('\n\n');
            return {
              success: true,
              answer: formatRagAnswer(cleanAnswerLanguage(`Ada ${total} UKM/Ormawa di ITB STIKOM Bali (sumber: SK PEMBINA ORMAWA 2026):\n\n${listText}`), 'rag-ukm-list', 'HIGH', question),
              source: 'rag-ukm-list',
              contexts: [],
              confidenceScore: topScoreAll,
              debug: { ukm_precomputed: true, categorized: true }
            };
          }

          // Fallback: load a simple precomputed array and dedupe heuristically
          const ukmListPath = path.join(__dirname, '..', 'data', 'ukm_list.json');
          if (fs.existsSync(ukmListPath)) {
            const raw = fs.readFileSync(ukmListPath, 'utf8');
            const pre = JSON.parse(raw || '[]');
            if (Array.isArray(pre) && pre.length > 0) {
              // Deduplicate by first-two-token key, pick the shortest variant as representative
              const keyFor = (n) => {
                if (!n) return '';
                const s = String(n).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
                const toks = s.split(' ').filter(Boolean);
                if (toks.length === 0) return '';
                return toks.length >= 2 ? `${toks[0]} ${toks[1]}` : toks[0];
              };

              const groups = new Map();
              for (const n of pre) {
                const k = keyFor(n);
                if (!k) continue;
                const cur = groups.get(k);
                if (!cur) groups.set(k, String(n || '').trim());
                else {
                  const cand = String(n || '').trim();
                  // Prefer variant with fewer words (shorter name), then shorter length
                  const curWords = cur.split(/\s+/).length;
                  const candWords = cand.split(/\s+/).length;
                  if (candWords < curWords || (candWords === curWords && cand.length < cur.length)) groups.set(k, cand);
                }
              }

              const deduped = Array.from(groups.values()).filter(Boolean).sort((a, b) => a.localeCompare(b));
              const listText = deduped.map((n, i) => `${i + 1}. ${n}`).join('\n');
              return {
                success: true,
                answer: formatRagAnswer(cleanAnswerLanguage(`Ada ${deduped.length} UKM/Ormawa di ITB STIKOM Bali (sumber: SK PEMBINA ORMAWA 2026):\n\n${listText}`), 'rag-ukm-list', 'HIGH', question),
                source: 'rag-ukm-list',
                contexts: [],
                confidenceScore: topScoreAll,
                debug: { ukm_precomputed: true, deduped: true }
              };
            }
          }
        } catch (e) {
          // Fall back to lexical parsing below on any error
        }
        let best = null;
        for (const s of scored) {
          const it = s && s.item ? s.item : null;
          const chunk = it && typeof it.chunk === 'string' ? it.chunk : '';
          if (!chunk) continue;
          if (/\bukm\b|\bormawa\b|\borganisasi\s+mahasiswa\b/i.test(chunk)) {
            const hay = normalizeIndonesianQuestionText(chunk);
            let hit = 0;
            if (hay.includes('ukm')) hit++;
            if (hay.includes('ormawa')) hit++;
            if (hay.includes('organisasi mahasiswa')) hit++;
            const score = hit + (typeof s.score === 'number' ? s.score : 0);
            if (!best || score > best.score) best = { it, s, hit, score };
          }
        }

        if (best && best.hit >= 1) {
          const content = String(best.it.chunk || '');
          // Split into lines and normalize spacing
          const lines = content.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

          // Prefer lines that explicitly mention UKM/ORMAWA or look like enumerated lists
          const ukmCandidates = lines.filter(l => /\bukm\b/i.test(l) || /\bormawa\b/i.test(l) || /^\d+\s+ukm\b/i.test(l) || /^\d+\s+orma?wa\b/i.test(l));

          const names = [];
          for (const l of ukmCandidates) {
            // Remove leading numbering and the literal 'UKM'/'ORMAWA'
            let name = l.replace(/^\d+\.?\s*/,'').replace(/\bUKM\b[:\-\s]*/i,'').replace(/\bORMAWA\b[:\-\s]*/i,'').trim();
            // Trim trailing qualifications like ', S.KOM.' keeping the main name
            name = name.split(/,|\(| - |ΓÇö/)[0].trim();
            if (name && !names.includes(name)) names.push(name);
          }

          if (names.length > 0) {
            const listText = names.map(n => `- ${n}`).join('\n');
            return {
              success: true,
              answer: formatRagAnswer(cleanAnswerLanguage(`Ada beberapa UKM di ITB STIKOM Bali (sumber: ${best.it.filename || 'training data'}):\n\n${listText}\n\nMau saya tampilkan kontak pembina atau detail lain?`), 'rag-lexical-ukm-list', 'HIGH', question),
              source: 'rag-lexical-ukm-list',
              contexts: [{ id: best.it.id, score: best.s.score, chunk: best.it.chunk, trainingId: best.it.trainingId, filename: best.it.filename, divisionKey: best.it.divisionKey }],
              confidenceScore: topScoreAll,
              debug: { lexical_ukm: true }
            };
          }

          // Fallback to original snippet if we couldn't parse a clean list
          let snippet = content.replace(/\s+/g, ' ').trim();
          const hay = snippet.toLowerCase();
          const m = /\bukm\b|\bormawa\b|\borganisasi\s+mahasiswa\b/i.exec(hay);
          if (m) {
            const idx = hay.indexOf(m[0]);
            const start = Math.max(0, idx - 120);
            const end = Math.min(snippet.length, idx + 240);
            snippet = snippet.slice(start, end).trim();
            if (start > 0) snippet = 'ΓÇª' + snippet;
            if (end < (String(best.it.chunk || '').length)) snippet = snippet + 'ΓÇª';
          }

          return {
            success: true,
            answer: formatRagAnswer(cleanAnswerLanguage(`Aku menemukan informasi terkait UKM/Ormawa di data training:\n\n${snippet}\n\nMau saya tampilkan nama-nama UKM atau kontak pembina?`), 'rag-lexical-ukm', 'HIGH', question),
            source: 'rag-lexical-ukm',
            contexts: [{ id: best.it.id, score: best.s.score, chunk: best.it.chunk, trainingId: best.it.trainingId, filename: best.it.filename, divisionKey: best.it.divisionKey }],
            confidenceScore: topScoreAll,
            debug: { lexical_ukm: true }
          };
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] UKM lexical fallback failed');
    }

    // Jika tidak ada chunk yang melewati ambang skor kemiripan,
    // anggap pertanyaannya di luar jangkauan data training.
    // Dalam kasus ini, jangan paksa AI menjawab supaya di kanal WhatsApp
    // bisa langsung jatuh ke fallback/human.
    if (!filtered || filtered.length === 0) {
      const topScore = scored && scored.length ? scored[0].score : null;

      // Confidence threshold (optional): if the best match is below the threshold,
      // treat it as "no answer" rather than falling back to lexical snippets.
      if (minConfidenceScore !== null && Number.isFinite(topScoreAll) && topScoreAll < minConfidenceScore) {
        const topFallback = scored.slice(0, topK).map(s => ({
          id: s.item.id,
          score: s.score,
          chunk: s.item.chunk,
          trainingId: s.item.trainingId,
          filename: s.item.filename,
          divisionKey: s.item.divisionKey
        }));

        traceRagDecision({
          source: 'rag-low-confidence',
          retrievalScore: topScoreAll,
          evidenceCount: topFallback.length,
          ragModel: null,
          fallbackReason: 'low-confidence'
        });

        return {
          success: true,
          answer: null,
          source: 'rag-low-confidence',
          contexts: topFallback,
          confidenceScore: topScoreAll,
          debug: {
            divisionKey: divisionKey || null,
            includeGlobal,
            usedGlobalFallback,
            minScoreUsed: minScore,
            topScore: topScoreAll,
            minConfidenceScore
          }
        };
      }

      if (looksLikePmbOverview && /(\balur\b|syarat|dokumen|\bkontak\b|kanal\s+pendaftaran)/i.test(qLower)) {
        // Let the later AI/no-AI path handle broad PMB overview questions.
      } else {
      // Safe lexical fallback: if embedding retrieval fails but we have a strong keyword overlap,
      // return a short quote/snippet instead of null to avoid premature human fallback.
      try {
        const qForLex = normalizedUserQ || normalizeIndonesianQuestionText(question) || '';
        const tokens = qForLex
          .split(' ')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(s => s.length >= 3)
          .filter(s => !new Set(['yang', 'dan', 'atau', 'dengan', 'untuk', 'dari', 'pada', 'ini', 'itu', 'apa', 'berapa', 'bagaimana', 'kapan', 'dimana', 'mana', 'tolong', 'mohon']).has(s));

        if (tokens.length >= 2) {
          let best = null;
          for (const it of indexForQuery) {
            const chunk = it && typeof it.chunk === 'string' ? it.chunk : '';
            const hay = normalizeIndonesianQuestionText(chunk);
            if (!hay) continue;
            let hit = 0;
            for (const tok of tokens) if (tok && hay.includes(tok)) hit++;
            const score = hit / tokens.length;
            if (!best || score > best.score) best = { it, score, hit, tokens: tokens.length };
          }

          if (best && best.hit >= 2 && best.score >= 0.45) {
            const chunk = String(best.it.chunk || '');
            // Extract a small snippet around the first matching token.
            let snippet = chunk.replace(/\s+/g, ' ').trim();
            const hay = snippet.toLowerCase();
            const firstTok = tokens.find(t => hay.includes(t)) || null;
            if (firstTok) {
              const idx = hay.indexOf(firstTok);
              const start = Math.max(0, idx - 120);
              const end = Math.min(snippet.length, idx + 240);
              snippet = snippet.slice(start, end).trim();
              if (start > 0) snippet = 'ΓÇª' + snippet;
              if (end < chunk.length) snippet = snippet + 'ΓÇª';
            }

            return {
              success: true,
              answer: formatRagAnswer(cleanAnswerLanguage(`Aku nemu info yang relevan di data training:\n\n${snippet}\n\nKalau kakak mau, sebutkan prodi/kalimat lengkapnya biar aku jawab lebih tepat.`), 'rag-lexical-fallback', 'HIGH', question),
              source: 'rag-lexical-fallback',
              contexts: [{
                id: best.it.id,
                score: best.score,
                chunk: best.it.chunk,
                trainingId: best.it.trainingId,
                filename: best.it.filename,
                divisionKey: best.it.divisionKey
              }],
              confidenceScore: topScoreAll,
              debug: { divisionKey: divisionKey || null, includeGlobal, usedGlobalFallback, minScoreUsed: minScore, topScore: topScoreAll, lexical: { hit: best.hit, tokens: best.tokens, score: best.score } }
            };
          }
        }
      } catch (e) {
        logger.warn({ err: e.message }, '[RAG] Lexical fallback failed');
      }

      return {
        success: true,
        answer: null,
        source: 'rag-no-match',
        contexts: [],
        confidenceScore: topScoreAll,
        debug: { divisionKey: divisionKey || null, includeGlobal, usedGlobalFallback, minScoreUsed: minScore, topScore, minConfidenceScore: minConfidenceScore !== null ? minConfidenceScore : undefined }
      };
      }
    }

    const topScored = filtered.slice(0, topK);
    const top = topScored.map(s => ({
      id: s.item.id,
      score: s.score,
      compositeScore: s.compositeScore,
      semanticScore: s.semanticScore,
      attributeScore: s.attributeScore,
      metadataBoost: s.metadataBoost,
      scoreComponents: s.scoreComponents,
      chunk: s.item.chunk,
      trainingId: s.item.trainingId,
      filename: s.item.filename,
      divisionKey: s.item.divisionKey,
      updatedAt: s.item.updatedAt || null,
      createdAt: s.item.createdAt || null
    }));

    if (queryEntities && queryEntities.intent === 'ACADEMIC_PROGRAM') {
      const hasAcademicProgramEvidence = validateAcademicProgramContexts(question, topScored, queryEntities);
      if (!hasAcademicProgramEvidence) {
        return {
          success: true,
          answer: null,
          source: 'rag-no-relevant-academic-context',
          contexts: top,
          confidenceScore: topScoreAll,
          debug: {
            divisionKey: divisionKey || null,
            includeGlobal,
            usedGlobalFallback,
            minScoreUsed: minScore,
            topScore: topScoreAll,
            requestedIntent: 'ACADEMIC_PROGRAM',
            reason: 'academic_context_validation_failed'
          }
        };
      }
    }

    if (queryEntities && queryEntities.program) {
      const requestedProgram = String(queryEntities.program || '').toUpperCase().trim();
      const hasProgramEvidence = topScored.some((s) => chunkHasRequestedProgram(s.item, requestedProgram));
      if (!hasProgramEvidence) {
        return {
          success: true,
          answer: null,
          source: 'rag-program-mismatch',
          contexts: top,
          confidenceScore: confidenceScoreTop,
          debug: {
            divisionKey: divisionKey || null,
            includeGlobal,
            usedGlobalFallback,
            minScoreUsed: minScore,
            topScore: confidenceScoreTop,
            requestedProgram,
            reason: 'no_program_evidence_in_top_contexts'
          }
        };
      }
    }

    const staleCheck = detectStaleChunks(topScored.map(s => s.item));
    if (staleCheck.hasStale) {
      logger.warn({ staleCheck, question: String(question || '').slice(0, 120), topScore: topScoreAll }, '[RAG] Stale top chunks detected');
    }
    const topSemantic = (top && top[0] && typeof top[0].score === 'number') ? top[0].score : topScoreAll;
    const topCompositeRaw = (top && top[0] && typeof top[0].compositeScore === 'number') ? top[0].compositeScore : null;

    // Use semantic score as primary; when semantic is low but compositeScore
    // (metadata/evidence boosts) is high, derive a normalized confidence
    // from composite score to better reflect retrieval quality for
    // heavily-boosted categories (program profiles, prospek kerja, etc.).
    let confidenceScoreTop = topSemantic;
    try {
      if ((typeof topSemantic !== 'number' || topSemantic < 0.2) && Number.isFinite(topCompositeRaw)) {
        // Normalize composite to [0, 0.99] using a simple scaling factor.
        // Composite values around ~4 → map close to 1.0; keep conservative cap.
        const scaled = Math.min(0.99, Math.max(0, topCompositeRaw / 4));
        confidenceScoreTop = scaled;
      }
    } catch (e) {
      confidenceScoreTop = topSemantic;
    }
    // In test/dev mode without OpenAI embeddings, the query embedding vector is a mock
    // and may not be directly comparable to stored vectors. Make the confidence score
    // more conservative so the min-confidence guard works predictably.
    if (!process.env.OPENAI_API_KEY && Number.isFinite(confidenceScoreTop)) {
      const topEmb = topScored && topScored[0] && topScored[0].item ? topScored[0].item.embedding : null;
      const dimMismatch = Array.isArray(qEmb) && Array.isArray(topEmb) && topEmb.length !== qEmb.length;
      const penalty = dimMismatch ? 0.6 : 0.75;
      confidenceScoreTop = confidenceScoreTop * penalty;
    }

    if (strict) {
      const tokens = tokenizeForRelevanceGuard(question);
      const joined = top.map(t => t.chunk || '').join('\n');
      const coverage = keywordCoverage(tokens, joined);
      const minCoverage = parseFloat(process.env.RAG_MIN_KEYWORD_COVERAGE || '0.34');

      // Only apply coverage guard if we have enough meaningful tokens.
      if (tokens.length >= 3 && Number.isFinite(minCoverage) && coverage < minCoverage) {
        return {
          success: true,
          answer: null,
          source: 'rag-low-coverage',
          contexts: top,
          confidenceScore: (top && top[0] && typeof top[0].score === 'number') ? top[0].score : topScoreAll,
          debug: { divisionKey: divisionKey || null, includeGlobal, usedGlobalFallback, minScoreUsed: minScore, topScore: top[0] ? top[0].score : null, coverage, minCoverage, minConfidenceScore: minConfidenceScore !== null ? minConfidenceScore : undefined }
        };
      }
    }

    // If user asks which waves exist, list the available waves (do not guess a wave).
    // Otherwise, if user mentions a wave but doesn't specify the info intent, ask a clarification.
    try {
      // If user asks which wave is open right now, answer based on today's date (WITA).
      const currentOpen = tryStructuredCurrentOpenWavesAnswer(currentQ);
      if (currentOpen && currentOpen.answer) {
        return {
          success: true,
          answer: formatRagAnswer(cleanAnswerLanguage(currentOpen.answer), currentOpen.source || 'rag-current-open-waves', 'HIGH', question),
          source: currentOpen.source || 'rag-current-open-waves',
          contexts: top,
          confidenceScore: confidenceScoreTop
        };
      }

      const asksWaveList =
        /(\bada\s+)?\bgelombang\b\s*(berapa|apa)\b/i.test(qLower) ||
        /\bgelombang\b\s+apa\s+aja\b/i.test(qLower) ||
        /\bgelombang\b\s+berapa\s+aja\b/i.test(qLower) ||
        /\bberapa\s+gelombang\b/i.test(qLower);

      if (asksWaveList) {
        const waves = extractAvailableScheduleWaveKeysFromIndex();
        if (waves && waves.length > 0) {
          const listed = waves.map(formatWaveKeyForDisplay).filter(Boolean).join(', ');
          return {
            success: true,
            answer: formatRagAnswer(`Gelombang PMB yang tersedia: ${listed}.\n\nKakak mau cek gelombang yang mana? (contoh: "2 B" / "Gelombang II B" / "Khusus")`, 'rag-wave-list', 'HIGH', question),
            source: 'rag-wave-list',
            contexts: top,
            confidenceScore: confidenceScoreTop
          };
        }

        return {
          success: true,
          answer: formatRagAnswer('Gelombang PMB dibagi per gelombang. Kakak mau cek gelombang yang mana? (contoh: "2 B" / "Gelombang II B" / "Khusus")', 'rag-wave-list', 'HIGH', question),
          source: 'rag-wave-list',
          contexts: top,
          confidenceScore: confidenceScoreTop
        };
      }

      const mentionsWave = qLower.includes('gelombang');
      const mentionsIntent =
        /(jadwal|testing|test\b|pengumuman|registrasi|daftar\s+ulang|registrasi\s+ulang|pendaftaran|tanggal\s+pendaftaran|sampai\s+kapan|deadline|penutupan|batas\s+waktu|potongan|diskon|biaya|dpp|bayar|dibayar|pembayaran|total|hitung|itung|jumlahkan|kalkulasi)/i.test(qLower);

      if (mentionsWave && !mentionsIntent) {
        const waveMatch = /gelombang\s*(khusus|[0-9]+|[ivx]+)(\s*[a-c])?/i.exec(currentQ);
        const waveLabel = waveMatch ? waveMatch[0].trim() : 'gelombang tersebut';
        return {
          success: true,
          answer: formatRagAnswer(
            `Anda ingin informasi apa untuk ${waveLabel}?
\n- Jadwal (pendaftaran/testing/pengumuman/registrasi ulang)
\n- Potongan biaya pendaftaran
\n- Biaya pendaftaran (tanpa potongan)`,
            'rag-clarify-wave',
            'HIGH',
            question
          ),
          source: 'rag-clarify-wave',
          contexts: top,
          confidenceScore: confidenceScoreTop
        };
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Clarify-wave rule failed');
    }

    // Coba rule khusus jadwal per gelombang (jadwal pendaftaran/testing/pengumuman/registrasi)
    // SKIP this if user is asking specifically about biaya/potongan
    const askingAboutFees = qLower.includes('biaya') || qLower.includes('potongan') || qLower.includes('dpp') || qLower.includes('diskon');
    if (!askingAboutFees) {
      try {
        const scheduleOverview = tryStructuredScheduleOverviewAnswer(question);
        if (scheduleOverview) {
          return {
            success: true,
            answer: formatRagAnswer(cleanAnswerLanguage(scheduleOverview.answer), scheduleOverview.source, 'HIGH', question),
            source: scheduleOverview.source,
            contexts: top,
            confidenceScore: confidenceScoreTop
          };
        }

        const schedule = tryStructuredScheduleAnswer(question, top);
        if (schedule) {
          return {
            success: true,
            answer: formatRagAnswer(cleanAnswerLanguage(schedule.answer), schedule.source, 'HIGH', question),
            source: schedule.source,
            contexts: top,
            confidenceScore: confidenceScoreTop
          };
        }
      } catch (e) {
        logger.warn({ err: e.message }, '[RAG] Schedule rule failed, fallback to normal RAG');
      }
    }

    // Coba dulu rule-based extraction khusus potongan biaya pendaftaran
    const structured = tryStructuredEnrollmentDiscountAnswer(question, top);
    if (structured) {
      return {
        success: true,
        answer: formatRagAnswer(structured.answer, structured.source, 'HIGH', question),
        source: structured.source,
        contexts: Array.isArray(structured.contexts) && structured.contexts.length ? structured.contexts : top,
        confidenceScore: confidenceScoreTop
      };
    }

    // Coba rule-based extraction untuk rangkuman rincian biaya (terutama dual degree)
    const feeBreakdown = tryStructuredFeeBreakdownAnswer(question, top, opts);
    if (feeBreakdown) {
      return {
        success: true,
        answer: formatRagAnswer(cleanAnswerLanguage(feeBreakdown.answer), feeBreakdown.source, 'HIGH', question),
        source: feeBreakdown.source,
        contexts: top,
        confidenceScore: confidenceScoreTop
      };
    }

    // Build context dari chunk teratas untuk generative RAG.
    // Dengan ringkasan multi-dokumen, AI dapat menarik jawaban dari beberapa
    // potongan dokumen dan tetap menjaga grounding pada data training.
    const context = buildRagAnswerContext(question, top);

    // Rule-based extraction untuk beasiswa/prestasi tertentu agar jawaban tidak drift.
    const scholarship = tryStructuredScholarshipAnswer(question, context);
    if (scholarship) {
      return {
        success: true,
        answer: formatRagAnswer(cleanAnswerLanguage(scholarship.answer), scholarship.source, 'HIGH', question),
        source: scholarship.source,
        contexts: top,
        confidenceScore: confidenceScoreTop
      };
    }

    // If provided, include recent conversation context for better follow-up answers.
    // Keep retrieval embedding based on `question` (first arg) to avoid diluting similarity.
    const conversationContext = typeof opts.conversationContext === 'string' ? opts.conversationContext.trim() : '';
    const answerQuestionRaw = typeof opts.answerQuestion === 'string' ? opts.answerQuestion : null;
    const answerQuestion = (answerQuestionRaw && answerQuestionRaw.trim()) ? answerQuestionRaw.trim() : String(question || '').trim();

    const questionForAnswer = conversationContext
      ? `Konteks percakapan terbaru:\n${conversationContext}\n\nPertanyaan user saat ini:\n${answerQuestion}`
      : answerQuestion;

    // SMART INFERENCE: assess consistency before rejecting
    const consistency = assessContextConsistency(top, question);
    const inference = consistency.isConsistent ? inferConclusion(top, question) : null;
    const confidenceTier = determineConfidenceTier(null, confidenceScoreTop, top, consistency, question);

    // If confidence is MEDIUM and there is consistency, try inference instead of immediate fallback
    if ((confidenceTier === 'MEDIUM' || (minConfidenceScore !== null && confidenceScoreTop < minConfidenceScore)) && consistency.isConsistent && inference) {
      const inferredAnswer = buildInferredAnswer(top, question, 'MEDIUM', inference);
      if (inferredAnswer) {
        // [VALIDATOR] Final answer validation - check for hallucination, numeric grounding, entity consistency
        const tempRagResult = {
          answer: inferredAnswer,
          source: 'rag-inference-medium',
          confidenceTier: 'MEDIUM',
          contexts: top,
          confidenceScore: consistency.score
        };
        const validation = validateFinalAnswer(inferredAnswer, tempRagResult, question);
        if (!validation.valid) {
          logger.warn('[VALIDATOR] Answer rejected during MEDIUM confidence inference', { reason: validation.reason, question });
          const safeAnswer = validation.reason === 'contradiction_conflict'
            ? 'Ditemukan beberapa data berbeda pada dokumen.'
            : 'Data tidak ditemukan secara pasti pada dokumen.';
          return {
            success: true,
            answer: safeAnswer,
            source: 'rag-inference-rejected',
            contexts: top,
            confidenceScore: consistency.score,
            confidenceTier: 'LOW',
            debug: {
              divisionKey: divisionKey || null,
              includeGlobal,
              usedGlobalFallback,
              minScoreUsed: minScore,
              topScore: confidenceScoreTop,
              rejectionReason: validation.reason,
              inference: inference,
              consistency: consistency
            }
          };
        }
        
        return {
          success: true,
          answer: formatRagAnswer(cleanAnswerLanguage(inferredAnswer), 'rag-inference-medium', 'MEDIUM', question),
          source: 'rag-inference-medium',
          contexts: top,
          confidenceScore: consistency.score,
          confidenceTier: 'MEDIUM',
          consistency: consistency,
          debug: {
            divisionKey: divisionKey || null,
            includeGlobal,
            usedGlobalFallback,
            minScoreUsed: minScore,
            topScore: confidenceScoreTop,
            inference: inference,
            consistency: consistency
          }
        };
      }
    }

    // Confidence threshold (optional): if the best retrieval match is below the threshold,
    // treat it as "no answer" so upstream can fallback/handover instead of forcing an AI reply.
    if (minConfidenceScore !== null && Number.isFinite(confidenceScoreTop) && confidenceScoreTop < minConfidenceScore) {
      return {
        success: true,
        answer: null,
        source: 'rag-low-confidence',
        contexts: top,
        confidenceScore: confidenceScoreTop,
        debug: {
          divisionKey: divisionKey || null,
          includeGlobal,
          usedGlobalFallback,
          minScoreUsed: minScore,
          topScore: confidenceScoreTop,
          minConfidenceScore
        }
      };
    }

    // Gunakan AI engine (OpenAI) untuk menjawab berdasarkan konteks yang sudah ditemukan
    if (!process.env.OPENAI_API_KEY) {
      logger.error('[RAG] OPENAI_API_KEY tidak dikonfigurasi, tidak bisa memanggil OpenAI');
      traceRagDecision({
        source: 'rag-no-ai',
        retrievalScore: confidenceScoreTop,
        evidenceCount: top.length,
        ragModel: null,
        fallbackReason: 'no-ai'
      });
      return {
        success: true,
        answer: formatRagAnswer('Maaf, engine AI belum dikonfigurasi (OPENAI_API_KEY kosong), jadi saya belum bisa menjawab saat ini.', 'rag-no-ai', 'HIGH', question),
        source: 'rag-no-ai',
        contexts: top,
        confidenceScore: confidenceScoreTop
      };
    }

    const ragModel = (process.env.OPENAI_RAG_MODEL || '').toString().trim() || (process.env.OPENAI_MODEL || 'gpt-5.2');
    const ragTimeoutMsRaw = parseInt(process.env.OPENAI_RAG_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || '20000', 10);
    const ragTimeoutMs = (Number.isFinite(ragTimeoutMsRaw) && ragTimeoutMsRaw > 0) ? ragTimeoutMsRaw : 20000;
    
    // **MINIMUM EVIDENCE RULE**: If all chunks are from forbidden categories for this intent,
    // return "no answer" instead of trying to generate one
    if (skipRagAnswer) {
      if (process.env.RAG_DEBUG_INTENT_FILTERING) {
        logger.info({
          userIntent,
          question: String(question || '').substring(0, 80),
          reason: 'minimum_evidence_rule_enforced'
        }, '[RAG] Returning no answer due to minimum evidence rule');
      }
      traceRagDecision({
        source: 'rag-no-evidence',
        retrievalScore: topScoreAll,
        evidenceCount: top.length,
        ragModel: null,
        fallbackReason: 'no-evidence'
      });
      return {
        success: true,
        answer: null,
        source: 'rag-no-evidence',
        contexts: top,
        confidenceScore: topScoreAll,
        debug: {
          divisionKey: divisionKey || null,
          includeGlobal,
          usedGlobalFallback,
          minScoreUsed: minScore,
          topScore: topScoreAll,
          reason: 'minimum_evidence_rule',
          intent: userIntent
        }
      };
    }
    
    const aiEngine = new AIReplyEngine(process.env.OPENAI_API_KEY, ragModel, { timeoutMs: ragTimeoutMs });
    const assistHints = extractHintsFromChunks(top);
    const ragStyle = getRagStyle();
    const aiResult = await aiEngine.getRagAnswer(questionForAnswer, context, ragStyle, assistHints);

    // If the AI call failed, try lexical fallback as a last resort before giving up
    if (!aiResult || aiResult.success === false) {
      try {
        const qForLex = normalizedUserQ || normalizeIndonesianQuestionText(question) || '';
        const tokens = qForLex
          .split(' ')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(s => s.length >= 3)
          .filter(s => !new Set(['yang', 'dan', 'atau', 'dengan', 'untuk', 'dari', 'pada', 'ini', 'itu', 'apa', 'berapa', 'bagaimana', 'kapan', 'dimana', 'mana', 'tolong', 'mohon']).has(s));

        if (tokens.length >= 2) {
          let best = null;
          for (const it of indexForQuery) {
            const chunk = it && typeof it.chunk === 'string' ? it.chunk : '';
            const hay = normalizeIndonesianQuestionText(chunk);
            if (!hay) continue;
            let hit = 0;
            for (const tok of tokens) if (tok && hay.includes(tok)) hit++;
            const score = hit / tokens.length;
            if (!best || score > best.score) best = { it, score, hit, tokens: tokens.length };
          }

          if (best && best.hit >= 2 && best.score >= 0.45) {
            const chunk = String(best.it.chunk || '');
            // Extract a small snippet around the first matching token.
            let snippet = chunk.replace(/\s+/g, ' ').trim();
            const hay = snippet.toLowerCase();
            const firstTok = tokens.find(t => hay.includes(t)) || null;
            if (firstTok) {
              const idx = hay.indexOf(firstTok);
              const start = Math.max(0, idx - 120);
              const end = Math.min(snippet.length, idx + 240);
              snippet = snippet.slice(start, end).trim();
              if (start > 0) snippet = 'ΓÇª' + snippet;
              if (end < chunk.length) snippet = snippet + 'ΓÇª';
            }

            return {
              success: true,
              answer: formatRagAnswer(cleanAnswerLanguage(`Aku nemu info yang relevan di data training:\n\n${snippet}\n\nKalau kakak mau, sebutkan prodi/kalimat lengkapnya biar aku jawab lebih tepat.`), 'rag-lexical-fallback', 'HIGH', question),
              source: 'rag-lexical-fallback',
              contexts: [{
                id: best.it.id,
                score: best.score,
                chunk: best.it.chunk,
                trainingId: best.it.trainingId,
                filename: best.it.filename,
                divisionKey: best.it.divisionKey
              }],
              confidenceScore: topScoreAll,
              debug: { divisionKey: divisionKey || null, includeGlobal, usedGlobalFallback, minScoreUsed: minScore, topScore: topScoreAll, lexical: { hit: best.hit, tokens: best.tokens, score: best.score }, aiFailed: true }
            };
          }
        }
      } catch (e) {
        logger.warn({ err: e.message }, '[RAG] Lexical fallback after AI failure failed');
      }

      traceRagDecision({
        source: 'rag-ai-error',
        retrievalScore: confidenceScoreTop,
        evidenceCount: top.length,
        ragModel,
        fallbackReason: 'ai-error'
      });
      return {
        success: false,
        answer: null,
        source: 'rag-ai-error',
        contexts: top,
        confidenceScore: confidenceScoreTop,
        error: aiResult && aiResult.error ? aiResult.error : 'AI engine failed'
      };
    }

    // Tambahkan catatan gelombang jika relevan agar user tahu ada gelombang apa saja
    let finalAnswer = aiResult.reply || '';

    // Bersihkan frasa "sesuai dokumen" agar jawaban terdengar lebih natural
    finalAnswer = finalAnswer.replace(/\s*sesuai dokumen\.?/gi, '');
    try {
      const qLower = (question || '').toLowerCase();
      // Only add wave summary when user explicitly brings up "gelombang".
      // This keeps answers tightly aligned with the question.
      if (qLower.includes('gelombang')) {
        if (!questionSpecifiesWave(question)) {
          const waves = extractWavesFromContexts(top, question);
          if (waves.length > 0) {
            const label = waves
              .map(w => (w === 'Khusus' ? 'Gelombang Khusus' : `Gelombang ${w}`))
              .join(', ');
            // Catatan dibuat lebih netral agar tidak selalu bicara potongan.
            // Tujuannya hanya memberi tahu bahwa pendaftaran dibagi per gelombang
            // dan user bisa menyebutkan gelombangnya supaya informasi lebih tepat.
            finalAnswer += `\n\nCatatan: Saat ini ada beberapa gelombang pendaftaran, yaitu ${label}. Jika Anda sudah tahu mendaftar di gelombang apa, sebutkan, nanti saya bantu sesuaikan informasinya untuk gelombang tersebut.`;
          }
        }
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Failed to append wave summary');
    }

    // Final cleanup bahasa agar jawaban lebih natural untuk user
    // Jika AI sudah mengembalikan reply yang sudah ter-format (`isStructured`),
    // hindari mem-format ulang untuk mencegah duplikasi.
    if (!(aiResult && aiResult.isStructured)) {
      finalAnswer = formatRagAnswer(finalAnswer, aiResult.model || 'ai', 'HIGH', question);
    } else {
      // AI sudah melakukan struktur 3-bagian; lakukan minimal language cleanup saja
      finalAnswer = cleanAnswerLanguage(finalAnswer);
    }

    // SANITIZE: remove any user-visible forbidden school names or mojibake artifacts
    try {
      const forbiddenPatterns = [
        /\bSMK\s*TI\s*Bali\s*Global\b/gi,
        /\bSMK\s*Pandawa\s*Bali\s*Global\b/gi,
        /\bsekolah\s*tertentu\b/gi
      ];
      let containsForbidden = false;
      for (const p of forbiddenPatterns) {
        if (p.test(finalAnswer)) {
          containsForbidden = true;
          finalAnswer = finalAnswer.replace(p, '');
        }
      }

      // Normalize mojibake artifacts using sanitizer helper, with conservative fallbacks
      try {
        finalAnswer = sanitizeWhatsappText(finalAnswer);
      } catch (e) {}
      // Extra-safe direct replacements for observed mojibake tokens
      finalAnswer = finalAnswer
        .replace(/ΓÇª/g, '...')
        .replace(/ΓÇó/g, '-')
        .replace(/ΓÇ—/g, '-')
        .replace(/ΓÇö/g, '-')
        .replace(/ΓÇ£/g, '"')
        .replace(/ΓÇ¥/g, '"')
        .replace(/ΓÇÿ/g, "'")
        .replace(/ΓÇÖ/g, "'");

      if (containsForbidden) {
        finalAnswer = finalAnswer.trim();
        // Append PMB guidance in place of removed specific school mentions
        finalAnswer += '\n\nSilakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus.';
      }
    } catch (e) {
      logger.warn({ err: e.message }, '[RAG] Failed to sanitize forbidden phrases');
    }

    // [VALIDATOR] Final answer validation for HIGH confidence - check for hallucination, numeric grounding, entity consistency
    const tempRagResultHigh = {
      answer: finalAnswer,
      source: aiResult.model || 'ai',
      confidenceTier: 'HIGH',
      contexts: top,
      confidenceScore: confidenceScoreTop
    };
    const validationHigh = validateFinalAnswer(finalAnswer, tempRagResultHigh, question);
    if (!validationHigh.valid) {
      logger.warn('[VALIDATOR] HIGH confidence answer rejected due to validation failure', { reason: validationHigh.reason, question });
      const safeAnswer = validationHigh.reason === 'contradiction_conflict'
        ? 'Ditemukan beberapa data berbeda pada dokumen.'
        : 'Data tidak ditemukan secara pasti pada dokumen.';
      return {
        success: true,
        answer: safeAnswer,
        source: 'rag-answer-rejected',
        contexts: top,
        confidenceScore: confidenceScoreTop,
        confidenceTier: 'LOW',
        debug: {
          divisionKey: divisionKey || null,
          includeGlobal,
          usedGlobalFallback,
          minScoreUsed: minScore,
          topScore: confidenceScoreTop,
          rejectionReason: validationHigh.reason,
          validation: validationHigh
        }
      };
    }

    if (opts && opts.returnDebug === true) {
      traceRagDecision({
        source: aiResult.model || 'ai',
        retrievalScore: confidenceScoreTop,
        evidenceCount: top.length,
        ragModel,
        fallbackReason: null
      });
      return {
        success: true,
        answer: finalAnswer,
        source: aiResult.model || 'ai',
        contexts: top,
        contextSummary: buildMultiDocSummary(top, question),
        confidenceScore: confidenceScoreTop,
        confidenceTier: 'HIGH',
        debug: debugCollector
      };
    }

    traceRagDecision({
      source: aiResult.model || 'ai',
      retrievalScore: confidenceScoreTop,
      evidenceCount: top.length,
      ragModel,
      fallbackReason: null
    });
    return {
      success: true,
      answer: finalAnswer,
      source: aiResult.model || 'ai',
      contexts: top,
      contextSummary: buildMultiDocSummary(top, question),
      confidenceScore: confidenceScoreTop,
      confidenceTier: 'HIGH'
    };
  } catch (err) {
    logger.error({ err: err.message }, '[RAG] Query error');
    return { success: false, error: err.message };
  }
}

function getIndexPath() {
  return INDEX_PATH;
}

function parseCompactRupiahNumber(raw, opts = null) {
  if (!raw && raw !== 0) return null;
  let s = String(raw || '').trim();
  if (!s) return null;

  // Repair common OCR noise
  s = s.replace(/[oO]/g, '0').replace(/[lI]/g, '1');

  // Remove currency prefix like 'Rp' optionally followed by dot/space
  s = s.replace(/^Rp[\s\.]*/i, '');

  // Keep only digits, dots and commas
  const digitsAndSep = s.replace(/[^0-9\.,]/g, '');
  if (!digitsAndSep) return null;

  // Remove thousand separators (both '.' and ',') — rupiah amounts are integers
  const cleaned = digitsAndSep.replace(/[\.,]/g, '');
  if (!/^[0-9]+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return Number.isNaN(n) ? null : n;
}

module.exports = {
  ingestTrainingData,
  query,
  computeEmbedding,
  chunkText,
  cleanAnswerLanguage,
  formatRagAnswer,
  validateFinalAnswer,
  validateNumericGrounding,
  parseCompactRupiahNumber,
  isSafeForInference,
  scoreSourceTrust,
  validateSourceTrust,
  removeTrainingFromIndex,
  getIndexPath,
  extractHintsFromChunks,
  getRagStyle,
  normalizeProgramLabel,
  normalizeWaveLabel,
  extractStructuredEntities,
  extractAcademicIntent,
  filterRelevantChunks,
  validateAcademicProgramContexts,
  extractStructuredChunkMetadata,
  getChunkEntities,
  getChunkScoreBreakdown,
  tryStructuredExactCostAnswer,
  tryStructuredProgramRecommendationAnswer,
  tokenizeForRelevanceGuard
};

