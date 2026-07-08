const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const ragEngine = require('./ragEngine');
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

function buildSemanticResultCacheKey(question, options = {}) {
  if (!isStatelessSemanticQuery(options)) return null;
  const q = normalizeCacheText(question);
  if (!q) return null;
  const topK = Number.isFinite(Number(options.topK)) ? String(Number(options.topK)) : '';
  const frame = envFlag('BOT_NATURAL_ANSWER_FRAME', true) ? '1' : '0';
  const followups = envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false) ? '1' : '0';
  return `q:${q}|topK:${topK}|frame:${frame}|followups:${followups}|today:${getSemanticTodayYmd()}|style:v3`;
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
  if (!apiKey) return null;
  if (process.env.NODE_ENV === 'test' && apiKey !== 'test-key' && !envFlag('ALLOW_OPENAI_IN_TEST', false)) return null;
  const timeoutMsRaw = parseInt(process.env.OPENAI_SEMANTIC_RAG_TIMEOUT_MS || process.env.OPENAI_TIMEOUT_MS || '20000', 10);
  const timeout = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 20000;
  return new OpenAI({ apiKey, timeout });
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

function getRecentConversation(sessionData) {
  const maxMessages = parseInt(process.env.SEMANTIC_RAG_CONTEXT_MESSAGES || '8', 10);
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  const recent = messages.slice(-Math.max(0, maxMessages || 0));
  return recent
    .map((m) => {
      const direction = String(m && m.direction ? m.direction : 'message').trim();
      const message = clampText(m && m.message ? m.message : '', 500);
      return message ? `${direction}: ${message}` : '';
    })
    .filter(Boolean)
    .join('\n');
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
async function retrieveSemanticContexts(searchQueries, options = {}) {
  const index = getCachedSemanticIndex();
  const topK = Number.isFinite(Number(options.topK)) ? Math.max(1, Number(options.topK)) : parseInt(process.env.SEMANTIC_RAG_TOP_K || process.env.RAG_TOP_K || '8', 10);
  const maxCandidates = Math.max(topK, parseInt(process.env.SEMANTIC_RAG_CANDIDATES || '24', 10));
  const queries = uniqueList(searchQueries, 4);
  if (!Array.isArray(index) || !index.length || !queries.length) {
    return { contexts: [], topScore: 0, indexSize: Array.isArray(index) ? index.length : 0 };
  }

  const queryEmbeddings = [];
  for (const query of queries) {
    try {
      queryEmbeddings.push(await computeEmbeddingCached(query));
    } catch (e) {
      logger.warn({ err: e && e.message ? e.message : String(e) }, '[SemanticRAG] query embedding failed');
    }
  }

  if (!queryEmbeddings.length) return { contexts: [], topScore: 0, indexSize: index.length };

  const scored = [];
  for (const item of index) {
    if (!item || !String(item.chunk || '').trim()) continue;
    const emb = Array.isArray(item.embedding) ? item.embedding : null;
    if (!emb) continue;
    let bestScore = 0;
    for (const qEmb of queryEmbeddings) {
      bestScore = Math.max(bestScore, cosineSimilarity(qEmb, emb));
    }
    if (bestScore > 0) {
      scored.push({ item, score: bestScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const contexts = scored.slice(0, maxCandidates).slice(0, topK).map((s) => ({
    id: s.item.id || null,
    score: s.score,
    chunk: s.item.chunk,
    filename: s.item.filename || s.item.sourceFile || null,
    trainingId: s.item.trainingId || null,
    divisionKey: s.item.divisionKey || null,
    metadata: s.item.metadata || null
  }));

  return {
    contexts,
    topScore: contexts.length ? contexts[0].score : 0,
    indexSize: index.length
  };
}

function buildContextText(contexts) {
  const maxChars = parseInt(process.env.SEMANTIC_RAG_CONTEXT_MAX_CHARS || '9000', 10);
  let used = 0;
  const blocks = [];
  const list = Array.isArray(contexts) ? contexts : [];
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    const source = [c && c.filename, c && c.trainingId].filter(Boolean).join(' | ') || `chunk-${i + 1}`;
    const body = clampText(c && c.chunk ? c.chunk : '', 1800);
    if (!body) continue;
    const block = `[#${i + 1}] Sumber: ${source}\n${body}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    used += block.length;
  }
  return blocks.join('\n\n');
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

  const allowedSuffix = new Set(['kak', 'min', 'admin', 'tiko', 'pagi', 'siang', 'sore', 'malam', 'semua', 'guys', 'gan', 'bro', 'sis']);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;

  const first = collapseRepeatedLetters(words[0]).replace(/[^a-z]/g, '');
  const exactGreetings = new Set(['halo', 'hallo', 'hai', 'hay', 'hi', 'hello', 'helo', 'salam', 'bro']);
  const roots = ['halo', 'hai', 'hi', 'hello', 'helo', 'hay', 'salam', 'bro'];
  const firstIsGreeting = exactGreetings.has(first) || roots.some((root) => editDistance(first, root) <= (root.length <= 3 ? 1 : 2));
  if (!firstIsGreeting) return false;

  return words.slice(1).every((word) => allowedSuffix.has(collapseRepeatedLetters(word).replace(/[^a-z]/g, '')));
}

function trySmallTalkAnswer(question) {
  const raw = String(question || '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase();

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

  const religiousGreeting = getReligiousGreetingReply(normalized);
  if (isGreetingOnly(normalized) || /^(selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)(\s+(kak|min|admin|tiko|pagi|siang|sore|malam))*$/.test(normalized) || religiousGreeting) {
    const prefix = religiousGreeting ? `${religiousGreeting} ` : '';
    return {
      answer: `${prefix}Halo Kak, saya Tiko, asisten informasi ITB STIKOM Bali. Saya bisa bantu seputar PMB, rincian biaya, program studi, jadwal pendaftaran, beasiswa, dan informasi kampus.`
    };
  }

  return null;
}

function tryShortClarificationAnswer(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return null;

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

function tryFeedbackAnswer(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return null;
  const isFeedback = /\b(kok|loh|waduh|salah|tidak\s+nyambung|nggak\s+nyambung|ga\s+nyambung|gak\s+nyambung|tidak\s+menjawab|nggak\s+menjawab|ga\s+menjawab|gak\s+menjawab|jawabannya|jawaban\s+bot|dicek\s+lagi|cek\s+lagi|dari\s+mana\s+dapat\s+informasinya)\b/.test(q);
  const hasRealQuestion = /\b(jurusan|prodi|program\s+studi|biaya|bayar|ukt|dpp|semester|pendaftaran|beasiswa|gelombang|double\s*degree|dual\s*degree|akreditasi|prospek|apa\s+itu|berapa|kapan|dimana|bagaimana)\b/.test(q) || /\b\d{5,}\b/.test(q);
  if (!isFeedback || hasRealQuestion) return null;
  return {
    answer: 'Terima kasih koreksinya, kak. Bisa tuliskan ulang pertanyaan yang ingin dicek? Saya akan jawab lagi berdasarkan data ITB STIKOM Bali.'
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
    'Kalau kakak ingin info yang lebih spesifik, silakan tanya misalnya: “jadwal PMB sekarang gelombang berapa?”, “rincian biaya SI gelombang 2B?”, atau “apa saja syarat pendaftaran?”'
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

function tryPmbRequirementsAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksRequirement = /\b(syarat|persyaratan|dokumen|berkas|lampiran|formulir|kelengkapan)\b/.test(q);
  const pmbContext = /\b(daftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|stikom|itb\s*stikom)\b/.test(q);
  if (!asksRequirement || !pmbContext) return null;

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
  if (!/\b(pmb|penerimaan\s+mahasiswa\s+baru|penerimaan\s+maba|maba|camaba)\b/.test(q)) return null;
  const isSpecificSchedule = /\b(jadwal|gelombang|tanggal|deadline|kapan|masih\s+buka|masih\s+dibuka|dibuka|buka|sekarang|hari\s+ini|saat\s+ini)\b/.test(q);
  const isOverview = /\b(apa\s+itu|maksudnya|tentang|informasi|bertanya|tanya|jelaskan|penjelasan|alur|syarat|dokumen)\b/.test(q);
  if (isSpecificSchedule && !isOverview) return null;
  return { answer: buildPmbInfoAnswer() };
}

function tryCurrentOpenWavesAnswer(question) {
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
  if (!ragEngine || typeof ragEngine.extractScheduleRegistrationWindowsFromIndex !== 'function') return [];
  return ragEngine.extractScheduleRegistrationWindowsFromIndex() || [];
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

function tryScheduleWindowAnswer(question) {
  const q = String(question || '').trim();
  if (!q) return null;
  const qLower = q.toLowerCase();

  const hasScheduleSignal = /\b(pmb|penerimaan\s+mahasiswa\s+baru|penerimaan\s+maba|maba|camaba|pendaftaran|daftar|jadwal|gelombang|gbg|bulan\s+depan|bulan\s+ini|bulan\s+lalu|dari\s+kapan|sampai\s+kapan|deadline)\b/i.test(qLower) ||
    Object.keys(ID_MONTH_MAP).some(name => new RegExp(`\\b${name}\\b`, 'i').test(qLower));
  if (!hasScheduleSignal) return null;

  const asksFee = /\b(biaya|bayar|harga|dpp|ukt|potongan|rincian\s+biaya|termurah|termahal)\b/i.test(qLower);
  if (asksFee) return null;

  const windows = getScheduleWindows();
  if (!windows.length) return null;

  const requestedMonth = parseRequestedMonth(q);
  const requestedWave = parseRequestedScheduleWave(q);
  const requestedDate = parseRequestedDate(q);
  const todayYmd = getSemanticTodayYmd();
  const asksAvailability = /\b(masih\s+buka|masih\s+dibuka|buka|dibuka|bisa|pilih|yang\s+mana|aktif|berjalan|sekarang|hari\s+ini|saat\s+ini|cara|gimana|bagaimana)\b/i.test(qLower);

  if (asksAvailability && !requestedDate && !requestedMonth && !requestedWave && /\b(pmb|penerimaan\s+mahasiswa\s+baru|pendaftaran|daftar|maba|camaba)\b/i.test(qLower)) {
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

function tryRegistrationHowAnswer(question) {
  const q = String(question || '').toLowerCase();
  const asksRegister = /\b(cara|gimana|bagaimana|dimana|di\s*mana|mana|lewat|link|online|mau|ingin|pengen|pengin|bisa)\b/.test(q) && /\b(daftar(?:nya)?|mendaftar|pendaftaran|registrasi|kuliah)\b/.test(q);
  if (!asksRegister) return null;
  if (/\b(biaya|bayar|harga|dpp|ukt|potongan|gelombang|jadwal|tanggal|deadline|masih\s+buka)\b/.test(q)) return null;

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

function tryCampusLocationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(lokasi|alamat|kampus|dimana|di\s*mana|where|letak|maps|rute)\b/i.test(q)) return null;
  const mentionsStikomCampus = /\b(stikom|itb\s*stikom|stikom\s*bali|renon|denpasar|jimbaran|abiansemal)\b/i.test(q);
  if (!mentionsStikomCampus) return null;
  if (/\b(daftar|mendaftar|pendaftaran|registrasi|kuliah)\b/i.test(q) && /\b(dimana|di\s*mana|cara|gimana|bagaimana|mau|ingin|pengen|pengin)\b/i.test(q)) return null;

  if (/\b(kampus\s+utama|utama|pusat|kampus\s+pusat)\b/i.test(q)) {
    return {
      answer: [
        'Kampus utama ITB STIKOM Bali berada di Denpasar/Renon.',
        '',
        '- Kampus Denpasar/Renon: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
        '',
        'Selain kampus utama, ITB STIKOM Bali juga memiliki Kampus Jimbaran dan Kampus Abiansemal.'
      ].join('\n'),
      source: 'semantic-rag-campus-location'
    };
  }

  return {
    answer: [
      'Lokasi kampus ITB STIKOM Bali:',
      '',
      '- Kampus Denpasar/Renon: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
      '- Kampus Jimbaran: Jl. Raya Kampus Udayana, Kuta Selatan, Jimbaran, Bali.',
      '- Kampus Abiansemal: Jl. Janger, Abiansemal, Dauh Yeh Cani, Badung, Bali.',
      '',
      'Kalau kakak ingin datang langsung, sebaiknya pilih kampus sesuai kebutuhan layanan/prodi lalu cek rute maps dari lokasi kakak.'
    ].join('\n'),
    source: 'semantic-rag-campus-location'
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

const UKM_INTEREST_PROFILES = [
  { key: 'sports', label: 'olahraga', re: /\b(olahraga|sport|futsal|sepak\s*bola|basket|bola|atlet|main\s+bola)\b/, items: ['Futsal', 'Basket', 'Athena Esports'] },
  { key: 'esports', label: 'esports atau game kompetitif', re: /\b(esport|esports|game|gaming|gamer|mobile\s+legend|mlbb|pubg|valorant|turnamen\s+game)\b/, items: ['Athena Esports'] },
  { key: 'nature', label: 'alam, petualangan, atau kegiatan outdoor', re: /\b(alam|outdoor|gunung|mendaki|hiking|camping|petualangan|mapala|lingkungan)\b/, items: ['Mapala Kompas'] },
  { key: 'media', label: 'foto, video, desain, atau multimedia', re: /\b(foto|fotografi|photography|kamera|video|videografi|multimedia|desain|design|editing|konten|content|media)\b/, items: ['Himatography', 'Multimedia'] },
  { key: 'arts', label: 'seni, musik, tari, tabuh, atau teater', re: /\b(seni|musik|band|nyanyi|vokal|vocal|tari|menari|tabuh|teater|drama|akting|acting)\b/, items: ['Musik', 'Tari', 'Tabuh', 'Teater Biner', 'Vos'] },
  { key: 'leadership', label: 'organisasi, kepemimpinan, atau kegiatan kampus', re: /\b(organisasi|kepemimpinan|leadership|pemimpin|bem|dpm|hima|himpunan|panitia|event|acara|kampus)\b/, items: ['Badan Eksekutif Mahasiswa', 'Dewan Perwakilan Mahasiswa', 'Himaprodi BD', 'Himaprodi SI', 'Himaprodi SK', 'Himaprodi TI', 'Himas Jimbaran'] },
  { key: 'volunteer', label: 'relawan, kesehatan, atau kedisiplinan', re: /\b(relawan|volunteer|kesehatan|medis|palang\s+merah|sosial|disiplin|paskibra|baris\s+berbaris)\b/, items: ['Ksr', 'Paskamras'] },
  { key: 'religious', label: 'kegiatan rohani atau keagamaan', re: /\b(rohani|agama|keagamaan|hindu|kristen|islam|muslim|kmhd|pmk|ksl)\b/, items: ['Kmhd', 'Pmk', 'Ksl'] },
  { key: 'technology', label: 'teknologi, coding, atau komunitas IT', re: /\b(coding|ngoding|programming|programmer|teknologi|it\b|komputer|software|developer|web|aplikasi)\b/, items: ['Syntax', 'Progress'] }
];

function tryUkmInterestRecommendation(question) {
  const q = String(question || '').toLowerCase();
  const asksUkm = /\b(ukm|ormawa|organisasi\s+mahasiswa|organisasi|unit\s+kegiatan|komunitas|himpunan|hima)\b/i.test(q);
  const asksRecommendation = /\b(cocok|rekomendasi|saran|sarankan|pilih|ikut|gabung|masuk|ambil|hobi|hobby|suka|minat|ada\s+yang|apa\s+yang)\b/i.test(q);
  if (!asksUkm || !asksRecommendation) return null;

  const profile = UKM_INTEREST_PROFILES.find((item) => item.re.test(q));
  if (!profile) return null;

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

function tryUkmAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(ukm|ormawa|organisasi\s+mahasiswa|organisasi|bem|hima|unit\s+kegiatan|komunitas|himpunan)\b/i.test(q)) return null;

  const recommendation = tryUkmInterestRecommendation(question);
  if (recommendation) return recommendation;

  if (!/\b(stikom|itb\s*stikom|kampus|ada|apa|daftar|list|sebutkan|mana|saja|aja)\b/i.test(q)) return null;

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

  if (src.includes('campus-location') || /\b(lokasi|alamat|kampus|maps|rute)\b/.test(q)) {
    return {
      request: 'lokasi kampus ITB STIKOM Bali',
      assumption: 'Saya tampilkan alamat kampus yang tersedia agar kakak bisa memilih lokasi yang sesuai.',
      conclusion: 'Jadi, ITB STIKOM Bali memiliki beberapa lokasi kampus, dan tujuan kunjungan sebaiknya disesuaikan dengan kebutuhan layanan kakak.',
      followups: [
        'Kampus utama di mana?',
        'Prodi saya kuliah di kampus mana?',
        'Kontak kampus berapa?'
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

  if (src.includes('dual-degree') || /\b(double\s*degree(?:nya)?|dual\s*degree(?:nya)?|utb|dnui|help)\b/.test(q)) {
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

  if (src.includes('program-list') || /\b(jurusan|prodi|program\s+studi)\b/.test(q)) {
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

  if (/\bukt\b|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester/i.test(q)) {
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

  if (src.includes('program-definition') || /\b(apa\s+itu|pengertian|belajar\s+apa)\b/.test(q)) {
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
    if (/\bukt\b|uang\s+kuliah\s+tunggal|biaya\s+pendidikan\s+per\s+semester|biaya\s+semester/i.test(q)) {
      return [
        prefix + ' Saya jawab khusus UKT' + target + ' per semester agar tidak tercampur dengan biaya awal masuk.',
        'Untuk UKT' + target + ', saya fokus ke biaya pendidikan per semester.',
        'Kalau yang kakak tanyakan UKT' + target + ', angka ini saya pisahkan dari DPP dan pendaftaran.',
        'Saya cek bagian UKT' + target + ' saja ya, Kak.'
      ];
    }
    return [
      prefix + ' Saya rincikan biaya' + target + ' dari komponen PMB yang tersedia.',
      'Untuk biaya' + target + ', saya susun dari pendaftaran, biaya awal masuk, dan UKT bila datanya tersedia.',
      'Saya jawab rincian biaya' + target + ' sesuai prodi dan gelombang yang kakak sebutkan.',
      'Saya cek bagian biaya' + target + ' dari data PMB ya.'
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
      'Untuk biaya kuliah, saya susun dari pendaftaran, biaya awal masuk, dan UKT/semester ya, Kak.',
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
      'Saya pahami kakak menanyakan lokasi kampus ITB STIKOM Bali. Saya tampilkan alamat yang tersedia.',
      'Baik, Kak. Untuk lokasi kampus, alamatnya saya rangkum seperti ini.',
      'Kalau yang kakak cari alamat kampus, berikut lokasi yang tersedia ya.',
      'Saya jawab bagian lokasi kampusnya ya, Kak.'
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
      'Untuk biaya kuliah, saya susun dari pendaftaran, biaya awal masuk, dan UKT/semester ya, Kak.',
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
      `Untuk pertanyaan “apa itu”, saya jelaskan dari fokus belajar dan arah skill-nya ya.`,
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
  if (!envFlag('BOT_NATURAL_ANSWER_FRAME', true)) return body;
  const src = String(source || '').toLowerCase();
  if (src.includes('small-talk') || src.includes('out-of-domain') || src.includes('feedback') || src.includes('unsupported-program') || src.includes('clarification') || src.includes('pmb-contact') || src.includes('pmb-requirements')) return body;
  const q = String(question || '').toLowerCase();
  if (/\b(apa\s+kabar|apa\s+khabar|kabar\s+apa|khabar\s+apa|gimana\s+kabar|gimana\s+khabar|kabar\s+kamu|khabar\s+kamu|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar|bagaimana\s+khabar)\b/i.test(q)) return body;
  if (/^\s*(halo|hallo|hai|hi|hello|haloo|halooo|assalamualaikum|assalamu\s+alaikum|om\s+swastiastu|swastiastu|shalom|namo\s+buddhaya|nammo\s+buddhaya|salam\s+kebajikan|rahayu|salam\s+rahayu|salam|selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)\s*(kak|min|admin|tiko)?\s*$/i.test(String(question || '').trim())) return body;

  const topic = inferFrameTopic(question, source);
  const opener = pickVariant(question, source, buildFrameOpeners(question, source, topic));
  const opening = `${opener} ${topic.assumption}`.replace(/\s{2,}/g, ' ').trim();
  const parts = [opening, '', body];

  const bodyAlreadyHasConclusion = /\n\s*(?:Jadi|Singkatnya|Kesimpulannya),|\n\s*Kesimpulan\s*:/i.test(body);
  if (!bodyAlreadyHasConclusion && topic.conclusion) {
    parts.push('', topic.conclusion);
  }

  const followups = Array.isArray(topic.followups) ? topic.followups : [];
  if (followups.length) {
    parts.push('', `Kalau mau lanjut, kakak bisa tanya:\n${followups.slice(0, 3).map(item => `- ${item}`).join('\n')}`);
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

const DETERMINISTIC_HANDLERS = [
  ['semantic-rag-small-talk', trySmallTalkAnswer],
  ['semantic-rag-clarification', tryShortClarificationAnswer],
  ['semantic-rag-out-of-domain', tryOutOfDomainAnswer],
  ['semantic-rag-feedback', tryFeedbackAnswer],
  ['semantic-rag-unsupported-program', tryUnsupportedProgramAnswer],
  ['semantic-rag-pmb-contact', tryPmbContactAnswer],
  ['semantic-rag-pmb-requirements', tryPmbRequirementsAnswer],
  ['semantic-rag-registration-info', tryRegistrationHowAnswer],
  ['semantic-rag-schedule-window', tryScheduleWindowAnswer],
  ['semantic-rag-campus-location', tryCampusLocationAnswer],
  ['semantic-rag-ukm-list', tryUkmAnswer],
  ['semantic-rag-registration-fee', tryRegistrationFeeAnswer],
  ['semantic-rag-fee-detail', tryDetailedFeeAnswer],
  ['semantic-rag-contextual-fee', tryContextualMultiProgramFeeAnswer],
  ['semantic-rag-fee-general', tryGeneralFeeQuestionAnswer],
  ['semantic-rag-dual-degree', tryDualDegreeAnswer],
  ['semantic-rag-scholarship', tryScholarshipAnswer],
  ['semantic-rag-current-open-waves', tryCurrentOpenWavesAnswer],
  ['semantic-rag-pmb-info', tryPmbInfoAnswer],
  ['semantic-rag-program-recommendation', tryProgramRecommendationAnswer],
  ['semantic-rag-fee-comparison', tryFeeComparisonAnswer],
  ['semantic-rag-program-comparison', tryProgramComparisonAnswer],
  ['semantic-rag-program-list', tryProgramListAnswer],
  ['semantic-rag-career', tryCareerAnswer],
  ['semantic-rag-program-definition', tryProgramDefinitionAnswer]
];

const HANDLERS_BY_SOURCE = new Map(DETERMINISTIC_HANDLERS);
const SOURCES_NEEDING_INDEX = new Set([
  'semantic-rag-registration-fee',
  'semantic-rag-fee-detail',
  'semantic-rag-fee-general',
  'semantic-rag-contextual-fee',
  'semantic-rag-fee-comparison'
]);
const PRE_AI_HANDLER_SOURCES = new Set([
  'semantic-rag-small-talk',
  'semantic-rag-out-of-domain',
  'semantic-rag-unsupported-program'
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
  return {
    success: true,
    answer: formatNaturalAnswerFrame(originalQuestion, result.answer, result.frameSource || source),
    source,
    contexts: [],
    confidenceScore: 1,
    confidenceTier: 'HIGH',
    debug: {
      ...debugExtra,
      ...(result && typeof result === 'object' ? result : {})
    }
  };
}

function runDeterministicHandlers(originalQuestion, handlers, options = {}, variants = [], debugExtra = {}) {
  const questions = uniqueList([...(Array.isArray(variants) ? variants : []), originalQuestion], 8);
  let handlerIndex = null;
  for (const [source, handler] of Array.isArray(handlers) ? handlers : []) {
    for (const variant of questions) {
      const indexArg = SOURCES_NEEDING_INDEX.has(source) ? (handlerIndex || (handlerIndex = getCachedSemanticIndex())) : undefined;
      const result = handler(variant, indexArg, { ...options, originalQuestion });
      if (result && result.answer) {
        return buildDeterministicResponse(originalQuestion, source, result, {
          ...debugExtra,
          semanticVariant: variant !== String(originalQuestion || '').trim() ? variant : undefined
        });
      }
    }
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

async function querySemanticRag(question, options = {}) {
  const resultCacheKey = buildSemanticResultCacheKey(question, options);
  const cachedResult = getCachedSemanticResult(resultCacheKey);
  if (cachedResult) return cachedResult;

  const preAiHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_AI_HANDLER_SOURCES.has(source));
  const preAiResult = runDeterministicHandlers(question, preAiHandlers, options, [question], { routeStage: 'pre-ai' });
  if (preAiResult) {
    setCachedSemanticResult(resultCacheKey, preAiResult);
    return preAiResult;
  }

  const client = getClient();
  if (!client) {
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

  const semanticRouteEnabled = shouldUseSemanticDeterministicRoute(rewrite);
  const preferTrainingFirst = semanticRouteEnabled && shouldPreferTrainingBeforeDeterministic(rewrite);
  const runSemanticDeterministicRoute = (routeStage = 'ai-intent') => {
    if (!semanticRouteEnabled) return null;
    const semanticSources = getSemanticHandlerSources(rewrite.intent);
    const semanticHandlers = handlersForSources(semanticSources);
    const semanticQuestions = buildSemanticRoutingQuestions(question, rewrite);
    return runDeterministicHandlers(question, semanticHandlers, { ...options, semanticRewrite: rewrite }, semanticQuestions, {
      routeStage,
      rewrite,
      trainingFirst: preferTrainingFirst || undefined
    });
  };

  if (semanticRouteEnabled && !preferTrainingFirst) {
    const routedResult = runSemanticDeterministicRoute('ai-intent');
    if (routedResult) {
      setCachedSemanticResult(resultCacheKey, routedResult);
      return routedResult;
    }
  }

  const retrieved = await retrieveSemanticContexts(rewrite.searchQueries, { topK: options.topK });
  const minScoreRaw = Number(process.env.SEMANTIC_RAG_MIN_SCORE || '0.18');
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0.18;
  if (!retrieved.contexts.length || retrieved.topScore < minScore) {
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-no-context') : null;
    if (fallbackResult) {
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    return {
      success: true,
      answer: 'Maaf, saya belum menemukan data yang cukup untuk menjawab pertanyaan itu dari sumber yang tersedia. Coba tuliskan pertanyaannya lebih spesifik, misalnya topik PMB, biaya, prodi, jadwal, beasiswa, lokasi, atau UKM.',
      source: 'semantic-rag-no-context',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      debug: { rewrite, minScore, indexSize: retrieved.indexSize }
    };
  }

  try {
    const rawAnswer = await answerFromContexts(client, question, rewrite, retrieved.contexts, {
      programHint: options.programHint || '',
      intentHint: options.intentHint || ''
    });
    if (!rawAnswer) {
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-empty-answer') : null;
      if (fallbackResult) {
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      return { success: true, answer: 'Maaf, saya belum bisa menemukan jawaban yang cukup dari data yang tersedia. Kakak bisa tuliskan pertanyaannya dengan lebih spesifik?', source: 'semantic-rag-empty-answer', contexts: retrieved.contexts, confidenceScore: retrieved.topScore, debug: { rewrite } };
    }
    if (rawAnswer.toUpperCase().includes('TIDAK_CUKUP_DATA')) {
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-insufficient-context') : null;
      if (fallbackResult) {
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      const cleaned = rawAnswer.replace(/TIDAK_CUKUP_DATA[:\s-]*/i, '').trim();
      const allowClarifyingFallback = envFlag('SEMANTIC_RAG_RETURN_CLARIFICATION_ON_NO_DATA', true);
      return {
        success: true,
        answer: allowClarifyingFallback && cleaned ? cleaned : 'Maaf, data yang tersedia belum cukup untuk menjawab pertanyaan itu dengan tepat.',
        source: 'semantic-rag-insufficient-context',
        contexts: retrieved.contexts,
        confidenceScore: retrieved.topScore,
        debug: { rewrite }
      };
    }

    const response = {
      success: true,
      answer: formatNaturalAnswerFrame(question, ragEngine.cleanAnswerLanguage(rawAnswer), 'semantic-rag'),
      source: 'semantic-rag',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      confidenceTier: retrieved.topScore >= 0.3 ? 'HIGH' : 'MEDIUM',
      debug: { rewrite, indexSize: retrieved.indexSize }
    };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] answer generation failed');
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-error') : null;
    if (fallbackResult) {
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    return {
      success: true,
      answer: 'Maaf, saya belum bisa mengambil jawaban dari data saat ini. Coba ulangi pertanyaannya sebentar lagi, atau tuliskan dengan lebih spesifik.',
      source: 'semantic-rag-error',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      debug: { rewrite, error: err && err.message ? err.message : String(err) }
    };
  }
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
  cosineSimilarity
};





