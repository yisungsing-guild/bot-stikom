const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const ragEngine = require('./ragEngine');
const { getLegacyRagIndexPath, getRagIndexPath } = require('../utils/ragPaths');
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

function appendAnswerQualityLog(event = {}) {
  if (!envFlag('BOT_ANSWER_QUALITY_LOG', true)) return;
  try {
    const dir = path.resolve(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      ts: new Date().toISOString(),
      question: String(event.question || '').slice(0, 500),
      source: event.source || null,
      category: event.category || null,
      confidenceTier: event.confidenceTier || null,
      confidenceScore: Number.isFinite(Number(event.confidenceScore)) ? Number(event.confidenceScore) : null,
      action: event.action || null,
      reason: event.reason || null,
      answerPreview: String(event.answer || '').replace(/\s+/g, ' ').trim().slice(0, 240)
    };
    fs.appendFileSync(path.join(dir, 'answer-quality.jsonl'), JSON.stringify(payload) + '\n');
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] failed to write answer quality log');
  }
}

function detectAnswerCategory(question, source = '') {
  const q = String(question || '').toLowerCase();
  const src = String(source || '').toLowerCase();
  if (src.includes('fee') || /\b(biaya|harga|tarif|ukt|dpp|bayar|pembayaran|uang)\b/i.test(q)) return 'biaya';
  if (src.includes('schedule') || src.includes('current-open-waves') || /\b(jadwal|tanggal|kapan|gelombang|periode)\b/i.test(q)) return 'jadwal';
  if (src.includes('facility') || src.includes('campus-support') || /\b(fasilitas|layanan|sarana|career\s*center|softskill|bahasa|gccp|bccp|ukm(?:nya)?|ormawa|esport|esports|musik)\b/i.test(q)) return 'fasilitas';
  if (src.includes('program') || src.includes('career') || /\b(prodi|program\s+studi|jurusan|prospek|karier|kerja|apa\s+itu)\b/i.test(q)) return 'program_prodi';
  if (src.includes('operational-academic-policy') || /\b(remedial|absensi|presensi|ujian\s+susulan|izin|dispensasi)\b/i.test(q)) return 'kebijakan_akademik';
  if (src.includes('scholarship') || /\b(beasiswa|kip|potongan|diskon)\b/i.test(q)) return 'beasiswa';
  return 'umum';
}

function sourceConfidenceTier({ source = '', score = 1, answer = '' } = {}) {
  const src = String(source || '').toLowerCase();
  const ans = String(answer || '').toLowerCase();
  if (src.includes('insufficient') || src.includes('no-answer') || /\b(mohon maaf|belum mempunyai|belum menemukan|tidak mempunyai jawaban)\b/i.test(ans)) return 'VERY_LOW';
  const n = Number(score);
  if (!Number.isFinite(n)) return 'MEDIUM';
  if (n >= 0.55 || src.includes('direct-answer') || src.includes('compound-question')) return 'HIGH';
  if (n >= 0.3) return 'HIGH';
  if (n >= 0.22) return 'MEDIUM';
  if (n >= 0.14) return 'LOW';
  return 'VERY_LOW';
}

function appendDataBoundary(answer, category, confidenceTier) {
  let out = String(answer || '').trim();
  if (!out || !['MEDIUM', 'LOW'].includes(String(confidenceTier || '').toUpperCase())) return out;
  if (/\b(data yang tersedia|informasi yang tersedia|belum mempunyai informasi lengkap|perlu dikonfirmasi)\b/i.test(out)) return out;
  const boundary = category === 'biaya' || category === 'jadwal'
    ? 'Catatan: saya jawab berdasarkan data yang tersedia, jadi detail resmi terbaru tetap sebaiknya dikonfirmasi ke PMB/admin kampus.'
    : 'Catatan: bagian yang belum tercantum di data sebaiknya dikonfirmasi ke admin kampus agar tidak keliru.';
  return `${out}\n\n${boundary}`.trim();
}

function focusAnswerOnRequestedEntity(question, answer, category) {
  let out = String(answer || '').trim();
  const q = String(question || '').toLowerCase();
  if (!out) return out;
  if (/\bgccp\b/i.test(q)) {
    out = out.replace(/\n-\s*(?:Program internasional\s*\/\s*kerja sama internasional|Student Exchange)[\s\S]*?(?=\n\n|\nUntuk detail|$)/gi, '');
    out = out.replace(/\bApa itu Student Exchange[\s\S]*?(?=\n\n|\nUntuk detail|$)/gi, '');
  }
  if (/\bbccp\b/i.test(q)) {
    out = out.replace(/\n-\s*(?:GCCP|Student Exchange)[\s\S]*?(?=\n\n|$)/gi, '');
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function formatAnswerByCategory(question, answer, source, confidenceTier = 'HIGH') {
  const category = detectAnswerCategory(question, source);
  let out = focusAnswerOnRequestedEntity(question, answer, category);
  if (!out) return out;
  out = appendDataBoundary(out, category, confidenceTier);
  return out.replace(/\n\s*Kalau mau lanjut, kakak bisa tanya:[\s\S]*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSpecificInsufficientDataAnswer(question, kind = 'very_low') {
  const q = String(question || '').toLowerCase();
  if (/\bbccp\b/i.test(q)) {
    return 'Untuk BCCP, saya belum menemukan informasi di data yang tersedia. Jadi saya belum bisa memastikan apakah program itu untuk mahasiswa asing atau bukan. Agar tidak keliru, bagian ini sebaiknya dikonfirmasi ke admin kampus terkait.';
  }
  if (/\blinked\s*in|linkedin\b/i.test(q) && /\bcareer|karier|karir|pusat\s+karier\b/i.test(q)) {
    return 'Untuk program pengembangan karier yang bekerja sama dengan LinkedIn, saya belum menemukan detail resminya di data yang tersedia. Jadi saya belum bisa memastikan bentuk program, jadwal, atau cara mengikutinya. Kakak bisa konfirmasi ke Career Center/admin kampus untuk informasi pastinya.';
  }
  if (/\bsoftskill|career\s*center|pusat\s+karier|karier|karir\b/i.test(q)) {
    return 'Untuk detail pengembangan softskill oleh Career Center, data yang saya pegang belum memuat rincian kegiatan yang lengkap. Jadi saya belum bisa menyebutkan daftar kegiatannya secara pasti. Informasi amannya, bagian ini perlu dikonfirmasi ke Career Center/admin kampus.';
  }
  return buildInsufficientDataAnswer(kind);
}

function maybeBuildClarificationFromLowConfidence(question, category, confidenceTier) {
  const q = String(question || '').trim();
  if (String(confidenceTier || '').toUpperCase() !== 'LOW') return null;
  if (/\b(biaya|jadwal|alamat|lokasi|beasiswa|pendaftaran|double\s*degree|gccp|bccp)\b/i.test(q)) return null;
  if (category === 'umum' || /\b(itu|programnya|fasilitasnya|yang\s+mana|apa\s+saja)\b/i.test(q)) {
    return `Saya masih ragu menangkap maksud pertanyaannya. Apakah yang kakak maksud itu informasi tentang ${category === 'umum' ? 'program/fasilitas kampus tertentu' : category.replace('_', ' ')}?`;
  }
  return null;
}
function isLikelyEnglishQuestion(question) {
  const text = String(question || '').toLowerCase();
  if (!text.trim()) return false;
  const strongEnglish = text.match(/\b(?:what|how|where|when|why|who|which|can|could|would|should|do|does|is|are|am|i\s+am|i'm|international\s+student|apply|application|admission|register|registration|enroll|study|studying|tuition|fee|fees|cost|costs|requirement|requirements|document|documents|major|scholarship)\b/g) || [];
  const weakEnglish = text.match(/\b(?:program|campus|location|service|services|facility|facilities)\b/g) || [];
  const indonesianMatches = text.match(/\b(?:apa|bagaimana|gimana|dimana|di\s+mana|kapan|kenapa|saya|aku|kak|ya|dong|mau|ingin|nanya|daftar|pendaftaran|kuliah|biaya|jurusan|prodi|beasiswa|kampus|layanan|fasilitas|itu|ini)\b/g) || [];
  if (indonesianMatches.length >= 2 && strongEnglish.length < 2) return false;
  return strongEnglish.length >= 2 || (strongEnglish.length >= 1 && weakEnglish.length >= 1 && indonesianMatches.length === 0);
}

function buildEnglishInsufficientDataAnswer() {
  return 'Sorry, I do not have enough information to answer that question accurately. You may rephrase the question or ask another question about ITB STIKOM Bali.';
}

function buildEnglishRegistrationHowAnswer() {
  return [
    'You can apply to ITB STIKOM Bali through the online or offline admission process.',
    '',
    'Online application:',
    '- Register through https://siap.stikom-bali.ac.id/.',
    '- Fill in the admission form and choose the study program you want.',
    '- Prepare the required documents and follow the payment/instruction steps shown by the admission system.',
    '',
    'Offline application:',
    '- You can come directly to the ITB STIKOM Bali admission office for guidance with registration.',
    '',
    'If you are an international student, please contact the admission/admin team as well so they can confirm any additional document requirements for international applicants.'
  ].join('\n');
}

function buildEnglishCampusLocationAnswer(source) {
  if (String(source || '').includes('main-location')) {
    return [
      'The main campus of ITB STIKOM Bali is in Denpasar/Renon.',
      '',
      '- Denpasar/Renon Campus: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
      '',
      'ITB STIKOM Bali also has Jimbaran and Abiansemal campuses.'
    ].join('\n');
  }
  return [
    'ITB STIKOM Bali campus locations:',
    '',
    '- Denpasar/Renon Campus: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
    '- Jimbaran Campus: Jl. Raya Kampus Udayana, Kuta Selatan, Jimbaran, Bali.',
    '- Abiansemal Campus: Jl. Janger, Abiansemal, Dauh Yeh Cani, Badung, Bali.',
    '',
    'If you plan to visit, please choose the campus based on the service or study program you need.'
  ].join('\n');
}

function isLikelyEnglishConversation(question, options = {}) {
  if (isLikelyEnglishQuestion(question)) return true;
  const q = String(question || '').toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const looksLikeEnglishFollowUp = /\b(?:and|then|also|what\s+about|how\s+about|requirements?|documents?|fees?|costs?|scholarship|campus|location|services?|facilities?)\b/i.test(q);
  if (!looksLikeEnglishFollowUp || words.length > 8) return false;
  const recent = getRecentConversation(options && options.sessionData);
  if (!recent) return false;
  const snippets = recent.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(-6);
  const englishCount = snippets.filter(isLikelyEnglishQuestion).length;
  const indonesianCount = snippets.filter(s => /\b(?:apa|bagaimana|gimana|daftar|pendaftaran|kuliah|biaya|kak|saya|aku)\b/i.test(s)).length;
  return englishCount > 0 && englishCount >= indonesianCount;
}

function buildEnglishPmbRequirementsAnswer() {
  return [
    'I do not have a complete and final list of admission documents in the available data yet.',
    '',
    'To avoid giving the wrong document list, the safest steps are:',
    '',
    '- Register or check the admission flow through https://siap.stikom-bali.ac.id.',
    '- Follow the document instructions shown during the application process.',
    '- Or visit ITB STIKOM Bali directly so the admission team can help you.'
  ].join('\n');
}

function buildEnglishPmbContactAnswer() {
  return [
    'For ITB STIKOM Bali admission support, you can use these channels:',
    '',
    '- Online: https://siap.stikom-bali.ac.id',
    '- Offline: visit an ITB STIKOM Bali campus and ask the admission staff for help.',
    '',
    'Campus addresses:',
    '- Denpasar/Renon Campus: Jl. Raya Puputan No. 86 Renon, Denpasar, Bali.',
    '- Jimbaran Campus: Jl. Raya Kampus Udayana, Kuta Selatan, Jimbaran, Bali.',
    '- Abiansemal Campus: Jl. Janger, Abiansemal, Dauh Yeh Cani, Badung, Bali.'
  ].join('\n');
}

function localizeFeeAnswerToEnglish(answer) {
  let out = String(answer || '');
  out = out.replace(/Saya jawab rincian biaya sesuai program yang kakak tanyakan\.[\s\S]*?di luar data\./i, 'Here is the fee breakdown for the program you asked about. I keep the components as listed in the available admission data.');
  out = out.replace(/Rincian biaya program/gi, 'Fee breakdown for');
  out = out.replace(/Biaya pendaftaran/gi, 'Application fee');
  out = out.replace(/DPP \/ Dana Pendidikan Pokok/gi, 'DPP / Main Education Fund');
  out = out.replace(/Bahasa Inggris/gi, 'English language fee');
  out = out.replace(/menjelang Semester II/gi, 'before Semester II');
  out = out.replace(/Biaya Pendidikan & Ujian\/Subject/gi, 'Education & Exam Fee/Subject');
  out = out.replace(/Kalau kakak sebutkan gelombangnya,[\s\S]*$/i, 'If you mention the admission wave, I can help check the applicable discount or payment details when the data is available.');
  out = out.replace(/kakak/gi, 'you');
  out = out.replace(/\bKak\b/gi, '');
  out = out.replace(/^.*?(Fee breakdown for)/is, '$1');
  out = out.replace(/^(Double Degree HELP University:)/i, 'Fee breakdown for $1');
  out = out.replace(/^(Double Degree DNUI[^:]*:)/i, 'Fee breakdown for $1');
  out = out.replace(/^(Double Degree UTB[^:]*:)/i, 'Fee breakdown for $1');
  out = out.replace(/^(?:Baik|Untuk biaya|Saya cekkan|Saya rincikan)[^\n]*\.?\s*/i, '');
  out = out.replace(/\s+\.\s*/g, ' ');
  return out.replace(/\s+\n/g, '\n').trim();
}

function localizeAnswerLanguage(question, answer, source = '', options = {}) {
  if (!isLikelyEnglishConversation(question, options)) return answer;
  const src = String(source || '').toLowerCase();
  if (src.includes('registration-info')) return buildEnglishRegistrationHowAnswer();
  if (src.includes('pmb-requirements')) return buildEnglishPmbRequirementsAnswer();
  if (src.includes('pmb-contact')) return buildEnglishPmbContactAnswer();
  if (src.includes('campus-location')) return buildEnglishCampusLocationAnswer(src);
  if (src.includes('fee')) return localizeFeeAnswerToEnglish(answer);
  if (src.includes('insufficient-data') || /^\s*(?:mohon maaf|saya ragu)/i.test(String(answer || ''))) return buildEnglishInsufficientDataAnswer();
  return answer;
}
function stripQuestionAnswerEnvelope(text) {
  let out = String(text || '').trim();
  out = out.replace(/^\s*(?:FAQ\s*[:\-.]?\s*)?(?:Question|Pertanyaan|Q)\s*[:\-.]\s*[\s\S]*?\n\s*(?:Answer|Jawaban|A|F)\s*[:\-.]\s*/i, '');
  out = out.replace(/^\s*(?:FAQ|Question|Pertanyaan|Answer|Jawaban|Q|A|F)\s*[:\-.]\s*/i, '');
  out = out.replace(/^\s*\((?:FAQ|Q|A|F)\)\s*/i, '');
  out = out.replace(/^\s*FAQ\b[^\n:]{0,120}:?\s*/i, '');
  out = out.replace(/^\s*(?:Question|Pertanyaan|Q)\s*[:\-.]\s*[\s\S]*?\n\s*(?:Answer|Jawaban|A|F)\s*[:\-.]\s*/i, '');
  out = out.replace(/^\s*(?:FAQ|Question|Pertanyaan|Answer|Jawaban|Q|A|F)\s*[:\-.]\s*/i, '');
  out = out.replace(/\n\s*(?:\((?:Q|A|F)\)|(?:Q|A|F|Question|Answer|Pertanyaan|Jawaban)\s*[:\-.])\s*/gi, '\n');
  return out.replace(/\n{3,}/g, '\n\n').trim();
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

function getQuestionContentTerms(question) {
  const stopwords = new Set([
    'apa', 'apakah', 'bagaimana', 'gimana', 'kalau', 'terkait', 'tentang', 'untuk',
    'yang', 'dengan', 'dalam', 'oleh', 'dari', 'itu', 'ini', 'kak', 'kakak',
    'saya', 'aku', 'mau', 'ingin', 'menanyakan', 'bertanya', 'baik', 'oke',
    'punya', 'mempunyai', 'ada', 'saja', 'admin', 'dilakukan'
  ]);
  return normalizeFacilityTerm(question)
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !stopwords.has(term));
}

function countTermHits(text, terms) {
  const normalized = normalizeFacilityTerm(text);
  return (Array.isArray(terms) ? terms : []).filter((term) => normalized.includes(term)).length;
}

function isLikelyRawAdministrativeDocument(text) {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  return /\b(PIHAK\s+PERTAMA|PIHAK\s+KEDUA|PERJANJIAN\s+KERJA\s+SAMA|Pasal\s+\d+|ADDENDUM|alamat\s+telepon\s+e\s*-?\s*mail|Nama\s+Mitra)\b/i.test(raw)
    || /_{5,}|\.{8,}|:{3,}/.test(raw);
}

function shouldRejectSemanticContext(question, context) {
  const chunk = String(context && context.chunk ? context.chunk : '');
  if (!chunk.trim()) return true;
  if (isLikelyRawAdministrativeDocument(chunk)) return true;

  const terms = getQuestionContentTerms(question);
  if (terms.length >= 2 && countTermHits(chunk, terms) === 0) return true;
  return false;
}

function filterSemanticContextsForQuestion(question, contexts) {
  const list = Array.isArray(contexts) ? contexts : [];
  return list.filter((context) => !shouldRejectSemanticContext(question, context));
}

function isSpecificCampusSupportDetailQuestion(question) {
  const q = String(question || '').toLowerCase();
  return /\b(softskill|pengembangan\s+softskill|kemampuan\s+bahasa|belajar\s+bahasa|meningkatkan\s+kemampuan\s+bahasa|language\s+learning|career\s*center|pusat\s+karier|pusat\s+karir)\b/i.test(q)
    && /\b(apa\s+saja|apa\s+yang|kegiatan|aktivitas|program|layanan|fasilitas|dilakukan|pengembangan|meningkatkan|detail|bagaimana|gimana)\b/i.test(q);
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
    'bang', 'bos', 'boss', 'bli', 'mb', 'cuk'
  ]);
  const timeWords = new Set(['pagi', 'siang', 'sore', 'malam']);
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;

  const cleanWord = (word) => collapseRepeatedLetters(word).replace(/[^a-z]/g, '');
  const first = cleanWord(words[0]);
  const exactGreetings = new Set(['halo', 'hallo', 'hai', 'hay', 'hi', 'hello', 'helo', 'salam']);
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

  if (/\b(santai\s+aja|jangan\s+serius|ga\s+usah\s+serius|gak\s+usah\s+serius|nggak\s+usah\s+serius)\b/i.test(normalized)) {
    return {
      answer: 'Siap, Kak. Saya coba jawab lebih santai, tapi tetap saya jaga supaya informasi kampusnya tidak menebak di luar data.'
    };
  }

  if (/\b(sibuk|lagi\s+apa|ngapain|available|bisa\s+bantu)\b/i.test(normalized) && !/\b(biaya|prodi|jurusan|pendaftaran|jadwal|gelombang|beasiswa)\b/i.test(normalized)) {
    return {
      answer: 'Saya siap bantu, Kak. Mau tanya seputar PMB, biaya, prodi, beasiswa, UKM, fasilitas, atau informasi kampus lainnya?'
    };
  }

  if (/\b(kamu|tiko|bot|admin)\b/i.test(normalized) && /\b(suka|senang|hobi|hobby)\b/i.test(normalized) && /\b(musik|lagu|nyanyi|band)\b/i.test(normalized)) {
    if (/\b(ukm|ormawa|stikom|kampus|ada|tersedia)\b/i.test(normalized)) {
      return {
        answer: [
          'Kalau sebagai asisten, saya tidak punya selera pribadi seperti manusia, Kak.',
          '',
          'Untuk pertanyaan kampusnya: ya, di data UKM/Ormawa ITB STIKOM Bali tercatat ada UKM Musik.',
          '',
          'Untuk detail jadwal latihan, pendaftaran anggota, atau kontak pengurus, kakak bisa konfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.'
        ].join('\n')
      };
    }
    return {
      answer: 'Kalau sebagai asisten, saya tidak punya selera pribadi seperti manusia, Kak. Tapi saya bisa ngobrol santai soal musik secukupnya. Untuk info kampus, saya juga bisa bantu soal UKM seni seperti Musik, Tari, Tabuh, Teater Biner, atau VOS kalau datanya tersedia.'
    };
  }

  if (/\b(kamu|tiko|bot|admin)\b/i.test(normalized) && /\b(suka|senang|hobi|hobby)\b/i.test(normalized) && /\b(film|movie|nonton|drama|series|serial)\b/i.test(normalized)) {
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

function getRecentAssistantConversation(sessionData) {
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  return messages
    .filter((m) => String(m && m.direction ? m.direction : '').toLowerCase() === 'assistant')
    .slice(-4)
    .map((m) => clampText(m && m.message ? m.message : '', 500))
    .filter(Boolean)
    .join('\n');
}

function isVagueClarificationReply(question) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return false;
  if (/\b(pmb|pendaftaran|biaya|prodi|jurusan|beasiswa|gelombang|alamat|kontak|ukm|double\s*degree|remedial|absensi|jadwal)\b/i.test(q)) return false;
  return /^(iya|ya|boleh|ok|oke|baik|sip|lanjut|terserah|bebas|apa\s+saja|apa\s+aja|informasi\s+apa\s+saja|info\s+apa\s+saja|yang\s+mana\s+saja|umum\s+saja|spesifik\s+juga\s+boleh)(\s+(boleh|saja|aja|ya|kak|min|admin))*[.!?]*$/i.test(q)
    || /\b(apa\s+saja\s+boleh|apa\s+aja\s+boleh|terserah|bebas|yang\s+mana\s+saja|informasi\s+apa\s+saja\s+boleh)\b/i.test(q);
}

function hasRecentClarificationPrompt(sessionData) {
  const recent = getRecentAssistantConversation(sessionData).toLowerCase();
  if (!recent.trim()) return false;
  return /\b(apakah\s+(?:yang\s+)?kakak\s+maksud|apakah\s+anda\s+ingin|apakah\s+kamu\s+ingin|yang\s+kakak\s+maksud|maksud\s+kakak|ingin\s+informasi\s+umum\s+atau\s+spesifik|bisa\s+diperjelas|mohon\s+diperjelas|kakak\s+mau\s+tanya|pilih\s+salah\s+satu)\b/i.test(recent);
}

function isClarificationLoopRisk(question, options = {}) {
  return isVagueClarificationReply(question) && hasRecentClarificationPrompt(options && options.sessionData);
}

function buildClarificationLoopFallbackAnswer(question, options = {}) {
  const recentUser = getRecentUserConversation(options && options.sessionData);
  const combined = `${recentUser}\n${question || ''}`;
  if (isOperationalAcademicPolicyQuestion(combined)) return buildOperationalAcademicPolicyNoDataAnswer(combined);
  return buildInsufficientDataAnswer('very_low');
}
function getRecentUserConversation(sessionData) {
  const messages = sessionData && Array.isArray(sessionData.messages) ? sessionData.messages : [];
  return messages
    .filter((m) => String(m && m.direction ? m.direction : '').toLowerCase() !== 'assistant')
    .slice(-6)
    .map((m) => clampText(m && m.message ? m.message : '', 500))
    .filter(Boolean)
    .join('\n');
}

function isVagueAcademicPolicyFollowUp(question, options = {}) {
  const q = String(question || '').toLowerCase().trim();
  if (!/\b(iya|ya|boleh|apa\s+saja|terserah|bebas|lanjut|informasi|info|umum|spesifik)\b/i.test(q)) return false;
  if (/\b(pmb|pendaftaran|biaya|prodi|jurusan|beasiswa|gelombang)\b/i.test(q)) return false;
  const recent = getRecentUserConversation(options && options.sessionData).toLowerCase();
  if (!recent.trim()) return false;
  return /\b(absensi|presensi|kehadiran|remedial|remidi|ujian\s+ulang|ujian\s+susulan|susulan|kompensasi|dispensasi|izin\s+tidak\s+masuk|sakit|alpha|alpa|bolos)\b/i.test(recent);
}

function buildOperationalAcademicPolicyQuestionForFollowUp(question, options = {}) {
  const recent = getRecentUserConversation(options && options.sessionData);
  return `${recent}\n${question || ''}`;
}
function buildOperationalAcademicPolicyNoDataAnswer(question) {
  const q = String(question || '').toLowerCase();
  let topic = 'kebijakan akademik tersebut';
  if (/\b(absensi|presensi|kehadiran|alpha|alpa|bolos)\b/i.test(q) && /\b(remedial|remidi|ujian\s+ulang|ujian\s+susulan|susulan)\b/i.test(q)) {
    topic = 'hubungan absensi/kehadiran dengan hak mengikuti remedial atau ujian susulan';
  } else if (/\b(remedial|remidi)\b/i.test(q)) {
    topic = 'kebijakan remedial';
  } else if (/\b(ujian\s+ulang|ujian\s+susulan|susulan)\b/i.test(q)) {
    topic = 'kebijakan ujian susulan atau ujian ulang';
  } else if (/\b(absensi|presensi|kehadiran|alpha|alpa|bolos)\b/i.test(q)) {
    topic = 'kebijakan absensi atau kehadiran kuliah';
  } else if (/\b(izin\s+tidak\s+masuk|sakit|dispensasi|kompensasi)\b/i.test(q)) {
    topic = 'kebijakan izin, sakit, dispensasi, atau kompensasi';
  }

  return [
    `Saya menangkap kakak menanyakan ${topic}.`,
    '',
    'Mohon maaf, data yang saya pegang saat ini belum memuat ketentuan lengkap untuk memastikan jawabannya.',
    '',
    'Jadi saya tidak berani memastikan di luar data, misalnya apakah jumlah absensi tertentu masih boleh ikut remedial. Untuk keputusan resminya, sebaiknya kakak konfirmasi ke bagian Akademik, dosen pengampu, atau prodi terkait.'
  ].join('\n');
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
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const asksRequirement = /\b(syarat|persyaratan|dokumen|berkas|lampiran|formulir|kelengkapan|requirement|requirements|document|documents|file|files)\b/.test(q);
  const pmbContext = /\b(daftar|pendaftaran|pmb|camaba|mahasiswa\s+baru|kuliah|registrasi|stikom|itb\s*stikom|apply|application|admission|register|registration|enroll|study|studying|international\s+student)\b/.test(q)
    || (isLikelyEnglishConversation(question, options) && /\b(apply|application|admission|register|registration|enroll|study|studying|international\s+student|siap\.stikom-bali\.ac\.id|itb\s*stikom|stikom\s*bali)\b/i.test(recent));
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
  const asksRegister = (/\b(cara|gimana|bagaimana|dimana|di\s*mana|mana|lewat|link|online|mau|ingin|pengen|pengin|bisa)\b/.test(q) && /\b(daftar(?:nya)?|mendaftar|pendaftaran|registrasi|kuliah)\b/.test(q)) || /\b(apply|application|admission|register|registration|enroll|study(?:ing)?|international\s+student)\b/i.test(q);
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

function normalizeFacilityTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bstudens\s+exchange\b/g, 'student exchange')
    .replace(/\bstudents\s+exchange\b/g, 'student exchange')
    .replace(/\bstudent\s+exchanges\b/g, 'student exchange')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const CAMPUS_SUPPORT_ENTITY_REGISTRY = [
  { key: 'linkedin-career-center', label: 'program LinkedIn di Career Center', type: 'facility_program', patterns: ['linkedin career center', 'linked in career center', 'program linkedin', 'program linked in'] },
  { key: 'career-center', label: 'Career Center', type: 'facility', patterns: ['career center', 'pusat karier', 'pusat karir'] },
  { key: 'gccp', label: 'GCCP', type: 'international_program', patterns: ['gccp', 'global cultural exchange program'] },
  { key: 'bccp', label: 'BCCP', type: 'international_program', patterns: ['bccp'] },
  { key: 'student-exchange', label: 'Student Exchange', type: 'international_program', patterns: ['student exchange', 'students exchange', 'studens exchange', 'pertukaran mahasiswa', 'exchange program'] },
  { key: 'short-course', label: 'short course', type: 'international_program', patterns: ['short course', 'shortcourse', 'kursus singkat'] },
  { key: 'hi-think', label: 'Hi-Think', type: 'facility_program', patterns: ['hi think', 'hithink'] },
  { key: 'language-learning-center', label: 'Language Learning Center', type: 'facility', patterns: ['language learning center', 'llc'] },
  { key: 'inkubator-bisnis', label: 'Inkubator Bisnis', type: 'facility', patterns: ['inkubator bisnis'] },
  { key: 'layanan-industri', label: 'Layanan Industri', type: 'facility', patterns: ['layanan industri', 'layanan untuk industri'] },
  { key: 'goes-to-school', label: 'STIKOM Bali Goes To School', type: 'facility_program', patterns: ['stikom bali goes to school', 'goes to school', 'goestoschool'] },
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
  const recent = getRecentConversation(options && options.sessionData);
  const fromRecent = findCampusSupportEntity(recent);
  return fromRecent ? { entity: fromRecent, fromRecent: true } : null;
}

function asksCampusSupportDetail(question) {
  const q = String(question || '').toLowerCase();
  return /\b(apa\s+itu|itu\s+apa|apakah|ada|jelaskan|detail|lebih\s+detail|program|layanan|kegiatan|aktivitas|kegunaan|manfaat|syarat|cara|bagaimana|gimana|ikut|mengikuti|daftar|mendaftar|pendaftaran|registrasi|info(?:rmasi)?|punya\s+info)\b/i.test(q);
}

function isShortCampusSupportFollowUp(question) {
  const q = normalizeFacilityTerm(question);
  if (!q) return false;
  if (q.split(/\s+/).length <= 5 && /\b(itu|apa|iya|ya|benar|detail|daftar|mendaftar|caranya|gimana|bagaimana|syarat|program|kegiatan)\b/i.test(q)) return true;
  return /\b(yang\s+tadi|program\s+itu|fasilitas\s+itu|cara\s+daftar(?:nya)?|lebih\s+detail(?:nya)?)\b/i.test(String(question || ''));
}

function campusSupportEntityToFacilityTerm(entity) {
  if (!entity) return null;
  return {
    key: entity.key,
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

  const quoted = /["']([^"']{3,80})["']/.exec(raw);
  let target = quoted ? quoted[1] : '';
  if (!target) {
    const m = /\b(?:apa\s+itu|apakah|jelaskan|detail(?:\s+tentang)?|tentang|info(?:rmasi)?\s+tentang|maksud(?:nya)?\s+apa)\s+(.{3,90})/i.exec(raw);
    if (m) target = m[1];
  }
  if (!target) {
    const m = /\bprogram\s+(.{3,90}?)(?:,?\s+(?:itu|ini))?\s+(?:program\s+)?apa\b/i.exec(raw);
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
  const useful = tokens.filter((token) => !/^(yang|dan|atau|dari|untuk|dengan|pada|kampus|stikom|bali|itb|mempunyai|punya|belajar|bahasa|kemampuan|meningkatkan|mahasiswa|terkait|dilakukan|pengembangan)$/.test(token));
  const distinctive = useful.filter((token) => token.length >= 4);
  const knownEntity = findCampusSupportEntity(normalized);
  if (!knownEntity && distinctive.length < 2) return '';
  if (!knownEntity && /\b(mempunyai|punya|belajar\s+bahasa|kemampuan\s+bahasa|meningkatkan|softskill|career\s*center)\b/i.test(normalized)) return '';
  if (!distinctive.length && !knownEntity) return '';
  return knownEntity ? normalizeFacilityTerm(knownEntity.label) : useful.join(' ');
}

function isLikelyFaqQuestionText(text) {
  return /^(?:q|tanya|pertanyaan)\s*[:\-.]/i.test(String(text || '').trim())
    || /^(?:apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s*mana|kemana|siapa|mengapa|kenapa|apa\s+saja)\b/i.test(String(text || '').trim());
}

function cleanFaqAnswerText(text) {
  return cleanFacilitySnippetText(String(text || '')
    .replace(/^\s*(?:faq|q|a|f|question|answer|tanya|pertanyaan|jawab|jawaban)\s*[:\-.]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim());
}

function extractBestFaqAnswerFromChunk(chunk, target, targetTokens) {
  const flat = String(chunk || '').replace(/\s+/g, ' ').trim();
  if (!flat || !targetTokens.length) return '';

  const markerRe = /(?:^|\s)((?:(?:q|tanya|pertanyaan)\s*[:\-.]\s*)?(?:apa\s+saja|apa|apakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{4,240}\?)/gi;
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

  let best = null;
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const normalizedQuestion = normalizeFacilityTerm(current.questionText);
    const exact = normalizedQuestion.includes(target);
    const tokenHits = targetTokens.filter((token) => normalizedQuestion.includes(token)).length;
    const score = (exact ? 6 : 0) + tokenHits;
    if (!score) continue;
    const next = markers[i + 1] ? markers[i + 1].start : flat.length;
    const answer = cleanFaqAnswerText(flat.slice(current.answerStart, next));
    if (!answer || answer.length < 12) continue;
    if (!best || score > best.score || (score === best.score && answer.length < best.answer.length)) {
      best = { score, answer };
    }
  }

  if (!best) return '';
  return best.answer.length > 900 ? `${best.answer.slice(0, 897).trim()}...` : best.answer;
}
function buildTrainingSpecificAnswerFromIndex(question, indexForQuery) {
  if (isStructuredCampusQuestion(question)) return null;
  const target = extractTrainingSpecificTarget(question);
  if (!target || !Array.isArray(indexForQuery) || !indexForQuery.length) return null;

  const targetTokens = target.split(/\s+/).filter((token) => token.length >= 4);
  if (!targetTokens.length) return null;

  const scored = [];
  for (const item of indexForQuery) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
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
  for (const { chunk } of scored.slice(0, 4)) {
    const faqAnswer = extractBestFaqAnswerFromChunk(chunk, target, targetTokens);
    if (faqAnswer && !snippets.some((existing) => normalizeFacilityTerm(existing) === normalizeFacilityTerm(faqAnswer))) {
      snippets.push(faqAnswer);
      break;
    }

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
  const q = String(question || '').toLowerCase();
  if (/\b(ukm|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa)\b/i.test(q)) return null;
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

function facilityTargetConflict(text, matchedTerm) {
  if (!matchedTerm) return false;
  const normalized = normalizeFacilityTerm(text);
  const currentPatterns = Array.isArray(matchedTerm.patterns) ? matchedTerm.patterns.map(normalizeFacilityTerm).filter(Boolean) : [];
  const hasCurrent = currentPatterns.some((pattern) => pattern && normalized.includes(pattern));
  for (const entity of CAMPUS_SUPPORT_ENTITY_REGISTRY) {
    if (!entity || entity.key === matchedTerm.key) continue;
    const isStrictEntity = ['layanan-industri', 'goes-to-school', 'hi-think', 'student-exchange', 'inkubator-bisnis', 'gccp', 'bccp', 'short-course'].includes(entity.key);
    if (!isStrictEntity) continue;
    const hasOther = entity.normalizedPatterns.some((pattern) => pattern && normalized.includes(pattern));
    if (hasOther && !hasCurrent) return true;
  }
  return false;
}

function scoreSpecificFacilityCandidates(indexForQuery, candidatePatterns, matchedTerm = null) {
  const scored = [];
  for (const item of Array.isArray(indexForQuery) ? indexForQuery : []) {
    const chunk = String(item && item.chunk ? item.chunk : '').trim();
    if (!chunk) continue;
    if (facilityTargetConflict(chunk, matchedTerm)) continue;
    const normalizedChunk = normalizeFacilityTerm(chunk);
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
    .replace(/^\s*(?:faq|q|a|f|question|answer|tanya|pertanyaan|jawab|jawaban)\s*[:\-.]\s*/i, '')
    .trim();

  const stopPatterns = [
    /\s+(?:q|tanya|pertanyaan)\s*[:\-.]\s*/i,
    /\s+(?:apa|apakah|pakah|bagaimana|gimana|berapa|kapan|di\s*mana|dimana|ke\s*mana|kemana|siapa|mengapa|kenapa)\b[^?]{3,220}\?\s*(?:a|answer|jawab|jawaban)\s*[:\-.]/i,
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
    .replace(/[“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}
function snippetMatchesFacilityTarget(text, matchedTerm) {
  if (!matchedTerm) return true;
  const normalized = normalizeFacilityTerm(text);
  const labelNorm = normalizeFacilityTerm(matchedTerm.label);
  const patterns = Array.isArray(matchedTerm.patterns) ? matchedTerm.patterns.map(normalizeFacilityTerm).filter(Boolean) : [];
  if (patterns.some((pattern) => normalized.includes(pattern))) return true;
  if (labelNorm && normalized.includes(labelNorm)) return true;
  const strictLabels = /\b(layanan industri|hi think|stikom bali goes to school|student exchange|inkubator bisnis|gccp|bccp|short course)\b/i;
  if (strictLabels.test(String(matchedTerm.label || ''))) return false;
  return true;
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
  if (/^[a-z]{2,}\b/.test(cleaned) && !/^(apa|apakah|bagaimana|gimana|program|layanan|inkubator|student|short|career|language|hi-?think|gccp|bccp)\b/i.test(cleaned)) return;
  if (isLikelyFaqQuestionText(cleaned)) return;
  if (/\?\s*(?:a|answer|jawab|jawaban)\s*[:\-.]/i.test(cleaned)) return;
  const normalized = normalizeFacilityTerm(cleaned);
  if (!normalized) return;
  if (!snippetMatchesFacilityTarget(cleaned, matchedTerm)) return;
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

function isStudentExchangeProgramListQuestion(question) {
  const q = String(question || '').toLowerCase();
  return /\b(?:student\s*exchange|pertukaran\s+mahasiswa|exchange\s+program)\b/i.test(q)
    && /\b(?:program\s+apa\s+saja|programnya\s+apa\s+saja|apa\s+saja\s+program|program\s+yang\s+tersedia|ada\s+program\s+apa|pilihan\s+program)\b/i.test(q);
}

function buildStudentExchangeProgramListAnswer() {
  return {
    answer: [
      'Untuk program internasional/pertukaran yang tersedia di data ITB STIKOM Bali, pilihannya antara lain:',
      '',
      '- Student Exchange',
      '- Summer Program / short course',
      '- GCCP atau Global Cross Cultural Program',
      '- BCCP',
      '',
      'Kalau yang kakak maksud adalah jadwal, negara tujuan, syarat peserta, atau alur pendaftaran untuk Student Exchange tertentu, detail itu perlu mengikuti informasi terbaru dari International Office/admin kampus.'
    ].join('\n'),
    source: 'semantic-rag-campus-support-entity',
    frameSource: 'semantic-rag-direct-answer',
    matchedEntity: 'student-exchange'
  };
}
function buildSpecificFacilityAnswerFromIndex(question, indexForQuery) {
  const q = normalizeFacilityTerm(question);
  if (!q) return null;
  const activeIndex = Array.isArray(indexForQuery) ? indexForQuery : [];

  const asksSpecificDetail = /\b(apa\s+itu|apakah|jelaskan|detail|program|layanan|kegunaan|manfaat|syarat|cara|bagaimana|gimana)\b/i.test(String(question || ''));
  const facilityTerms = CAMPUS_SUPPORT_ENTITY_REGISTRY.map(campusSupportEntityToFacilityTerm);

  const matchedTerm = facilityTerms.find((term) => term.patterns.some((pattern) => q.includes(pattern)));
  if (!matchedTerm || !asksSpecificDetail) return null;
  if (matchedTerm.label === 'Career Center') return null;

  const candidatePatterns = matchedTerm.patterns.map(normalizeFacilityTerm);
  let scored = scoreSpecificFacilityCandidates(activeIndex, candidatePatterns, matchedTerm);
  if (!scored.length) {
    scored = scoreSpecificFacilityCandidates(loadLegacyCampusSupportIndex(), candidatePatterns, matchedTerm);
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);

  const snippetCandidates = [];
  const targetForFaq = candidatePatterns[0] || normalizeFacilityTerm(matchedTerm.label);
  const targetTokensForFaq = targetForFaq.split(/\s+/).filter((token) => token.length >= 4);
  for (const { item, chunk, score } of scored.slice(0, 8)) {
    const faqAnswer = extractBestFaqAnswerFromChunk(chunk, targetForFaq, targetTokensForFaq);
    if (faqAnswer) collectFacilitySnippetCandidate(snippetCandidates, `${matchedTerm.label}: ${faqAnswer}`, item, matchedTerm, 8 + score);
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

function tryCampusSupportEntityAnswer(question, indexForQuery, options = {}) {
  if (/\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(String(question || ''))) return null;
  const resolved = resolveCampusSupportEntity(question, options);
  if (!resolved || !resolved.entity) return null;
  if (!resolved.fromRecent && resolved.entity.key === 'student-exchange' && isStudentExchangeProgramListQuestion(question)) {
    return buildStudentExchangeProgramListAnswer();
  }

  const currentMentionsEntity = !resolved.fromRecent;
  if (resolved.fromRecent && isExplicitNonSupportTopic(question)) return null;
  const hasFollowUpSignal = resolved.fromRecent && isShortCampusSupportFollowUp(question);
  const asksDetail = asksCampusSupportDetail(question);
  if (!currentMentionsEntity && !hasFollowUpSignal && !asksDetail) return null;
  if (resolved.entity.key === 'career-center' && currentMentionsEntity) return null;

  const entityQuestion = currentMentionsEntity
    ? question
    : `${resolved.entity.label} ${question}`;
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

  const shouldFailClosed = asksDetail || hasFollowUpSignal || resolved.entity.type === 'international_program' || resolved.entity.key === 'linkedin-career-center';
  if (!shouldFailClosed) return null;

  return {
    answer: buildSpecificInsufficientDataAnswer(question, 'very_low'),
    source: 'semantic-rag-campus-support-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data',
    matchedEntity: resolved.entity.key,
    contextResolved: resolved.fromRecent || undefined
  };
}
function tryLinkedInCareerCenterNoDataAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const currentHasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q);
  const hasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(`${q}\n${recent}`) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(`${q}\n${recent}`);
  if (!hasLinkedInCareerContext) return null;
  if (!currentHasLinkedInCareerContext && isExplicitNonSupportTopic(question)) return null;

  const asksLinkedInProgram = /\b(program|tentang|apa\s+itu|itu\s+apa|mengikuti|ikut|daftar|mendaftar|pendaftaran|registrasi|detail|lebih\s+detail|punya\s+info|info(?:rmasi)?|syarat|cara|bagaimana|gimana)\b/i.test(q);
  if (!asksLinkedInProgram) return null;

  return {
    answer: buildSpecificInsufficientDataAnswer(question, 'very_low'),
    source: 'semantic-rag-linkedin-career-insufficient-data',
    frameSource: 'semantic-rag-insufficient-data'
  };
}
function tryCampusFacilityAnswer(question, indexForQuery) {
  const q = String(question || '').toLowerCase();
  const asksFacilities = /\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|karir|karier|inkubator|softskill|kemampuan\s+bahasa(?:nya)?|belajar\s+bahasa(?:nya)?|bahasa(?:nya)?|language\s+learning|hi-?think|gccp|magang\s+berbayar|konsultasi|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q) || /yang +ada +di +kampus/i.test(q) || /kampus[?]?$/i.test(q);
  if (!asksFacilities) return null;
  if (/\b(struktur\s+organisasi|di\s*bawah|dibawah|direktorat\s+apa|bagian\s+apa|divisi\s+apa|unit\s+apa|naungan|dibawahi|membawahi|dikelola\s+oleh|bertanggung\s+jawab\s+ke)\b/i.test(q)) return null;

  if (/\b(kemampuan\s+bahasa(?:nya)?|belajar\s+bahasa(?:nya)?|meningkatkan\s+kemampuan\s+bahasa(?:nya)?|fasilitas\s+bahasa(?:nya)?)\b/i.test(q)) {
    return {
      answer: [
        'Untuk fasilitas peningkatan kemampuan bahasa, data yang tersedia mencantumkan Language Learning Center di ITB STIKOM Bali.',
        '',
        'Namun, saya belum mempunyai informasi lengkap tentang bentuk kegiatannya, jadwal, bahasa apa saja yang tersedia, atau cara mengikutinya.',
        '',
        'Jadi, informasi amannya: fasilitasnya tercantum ada, tetapi detail programnya perlu dikonfirmasi ke admin kampus.'
      ].join('\n'),
      source: 'semantic-rag-campus-facility',
      frameSource: 'semantic-rag-direct-answer'
    };
  }

  const specificFromTraining = buildSpecificFacilityAnswerFromIndex(question, indexForQuery);
  if (specificFromTraining) return specificFromTraining;
  const specificEntityWithoutDetail = findCampusSupportEntity(question);
  if (specificEntityWithoutDetail && specificEntityWithoutDetail.key !== 'career-center' && /\b(apa\s+saja|layanan|detail|program|kegiatan|aktivitas|manfaat|syarat|cara|bagaimana|gimana)\b/i.test(q)) {
    return {
      answer: buildInsufficientDataAnswer('very_low'),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }


  if (/\b(parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas)\b/i.test(q)) {
    return {
      answer: buildInsufficientDataAnswer('very_low'),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q)) {
    return {
      answer: buildInsufficientDataAnswer('very_low'),
      source: 'semantic-rag-campus-facility-insufficient-data',
      frameSource: 'semantic-rag-insufficient-data'
    };
  }

  if (/\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q)) {
    if (isSpecificCampusSupportDetailQuestion(question)) {
      return {
        answer: buildInsufficientDataAnswer('very_low'),
        source: 'semantic-rag-campus-facility-insufficient-data',
        frameSource: 'semantic-rag-insufficient-data'
      };
    }
    return {
      answer: [
        'Career Center di ITB STIKOM Bali membantu mahasiswa dan lulusan mempersiapkan diri masuk dunia kerja.',
        '',
        'Layanan umum yang tersedia di data saat ini:',
        '',
        '- Informasi lowongan kerja dan peluang karier.',
        '- Bimbingan atau konsultasi karier.',
        '- Pelatihan/pembekalan keterampilan kerja.',
        '- Dukungan persiapan memasuki dunia profesional.',
        '',
        'Untuk rincian kegiatan softskill tertentu, saya belum mempunyai informasi lengkap pada data yang tersedia.'
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
function stripNaturalFrameForCompound(answer) {
  let out = String(answer || '').trim();
  out = out.replace(/^(?:Baik|Bisa|Oke|Untuk pertanyaan ini|Saya jawab|Kalau konteksnya)[^\n]*\n+/i, '');
  out = out.replace(/\n\s*Kalau mau lanjut, kakak bisa tanya:[\s\S]*$/i, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function splitCompoundQuestionParts(question) {
  const raw = String(question || '').trim();
  if (!raw) return [];
  const normalized = raw
    .replace(/[;|]+/g, '? ')
    .replace(/\s*,\s*(?=(?:apa|apakah|berapa|kapan|dimana|di mana|bagaimana|gimana|kenapa|mengapa|ada|kalau|dan)\b)/gi, '? ')
    .replace(/\s+dan\s+(?=(?:apa|apakah|berapa|kapan|dimana|di mana|bagaimana|gimana|kenapa|mengapa|ada|kalau|fasilitas|biaya|jadwal|beasiswa|syarat|cara|prospek|bedanya|perbedaan|lokasi|ukm|jurusan|prodi)\b)/gi, '? ')
    .replace(/\s+serta\s+(?=(?:apa|apakah|berapa|kapan|dimana|di mana|bagaimana|gimana|fasilitas|biaya|jadwal|beasiswa|syarat|cara|prospek|bedanya|perbedaan|lokasi|ukm|jurusan|prodi)\b)/gi, '? ');
  const parts = normalized
    .split(/[?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

function normalizeCompoundTaskQuery(part, wholeQuestion) {
  const text = String(part || '').trim();
  const whole = String(wholeQuestion || '').trim();
  if (!text) return whole;
  if (/\b(itu|tersebut|tadi|programnya|prodinya|jurusannya)\b/i.test(text)) {
    const doubleDegree = whole.match(/\b(double\s*degree|dual\s*degree|dd)\b/i);
    if (doubleDegree && !/\b(double\s*degree|dual\s*degree|dd)\b/i.test(text)) return `${text} ${doubleDegree[0]}`;
  }
  const knownProgram = whole.match(/\b(bisnis\s+digital|sistem\s+informasi|sistem\s+komputer|teknologi\s+informasi|desain\s+komunikasi\s+visual|dkv|si|sk|ti|bd)\b/i);
  if (knownProgram && !/\b(bisnis\s+digital|sistem\s+informasi|sistem\s+komputer|teknologi\s+informasi|desain\s+komunikasi\s+visual|dkv|si|sk|ti|bd)\b/i.test(text)) {
    if (/\b(prospek|kerja|karier|career|lulusan|jadi\s+apa|pekerjaan|profesi|biaya|jadwal|syarat|cara|beda|bedanya|perbedaan)\b/i.test(text)) {
      return `${text} ${knownProgram[0]}`;
    }
  }
  return text;
}

function pushCompoundTask(tasks, task) {
  if (!task || !task.key) return;
  const dedupeFamily = task.family || String(task.key).split(':')[0];
  const familyDedupeKeys = new Set([
    'fee',
    'schedule',
    'career',
    'scholarship',
    'registration_info',
    'campus_facility',
    'ukm_list',
    'campus_location',
    'program_list'
  ]);
  if (tasks.some((existing) => existing.key === task.key)) return;
  if (familyDedupeKeys.has(dedupeFamily) && tasks.some((existing) => (existing.family || String(existing.key).split(':')[0]) === dedupeFamily)) return;
  tasks.push(task);
}

function detectCompoundTaskFromPart(part, wholeQuestion) {
  const query = normalizeCompoundTaskQuery(part, wholeQuestion);
  const q = query.toLowerCase();
  const whole = String(wholeQuestion || '').toLowerCase();
  const hasDoubleDegree = /\b(double\s*degree|dual\s*degree|dd)\b/i.test(q) || /\b(double\s*degree|dual\s*degree|dd)\b/i.test(whole);

  if (/\b(beda|bedanya|perbedaan|dibanding(?:kan)?|compare|komparasi|s1\s+reguler|prodi\s+s1|s1\s+lainnya)\b/i.test(q)) {
    return {
      key: hasDoubleDegree ? 'double_degree_difference' : `comparison:${q}`,
      label: hasDoubleDegree ? 'Bedanya dengan S1 reguler' : 'Perbandingan',
      source: hasDoubleDegree ? null : 'semantic-rag-program-comparison',
      query: hasDoubleDegree ? 'apa bedanya double degree dengan prodi s1 reguler?' : query,
      fallback: hasDoubleDegree ? [
        '- Double Degree adalah jalur/program khusus yang melibatkan kerja sama dengan kampus mitra, sehingga arah studinya tidak hanya mengikuti prodi reguler di ITB STIKOM Bali.',
        '- S1 reguler berfokus pada satu program studi di ITB STIKOM Bali tanpa skema gelar/kolaborasi kampus mitra seperti Double Degree.',
        '- Pada data yang tersedia, pilihan Double Degree dipasangkan dengan mitra seperti UTB, DNUI, dan HELP University. Detail gelar, skema kuliah, biaya, dan syarat bisa berbeda per mitra, jadi bagian itu perlu dilihat per program.'
      ].join('\n') : null
    };
  }

  if (hasDoubleDegree) {
    const wantsList = /\b(apa\s+saja|ada\s+apa\s+saja|pilihan|daftar|tersedia|program)\b/i.test(q);
    return {
      key: wantsList ? 'double_degree_list' : 'double_degree_definition',
      label: 'Double Degree',
      source: 'semantic-rag-dual-degree',
      query: wantsList ? 'apa saja program double degree di ITB STIKOM Bali?' : 'apa itu double degree di ITB STIKOM Bali?'
    };
  }

  if (/\b(fasilitas|layanan|sarana|prasarana|yang\s+ada\s+di\s+kampus)\b/i.test(q)) {
    return { key: 'campus_facility', label: 'Fasilitas kampus', source: 'semantic-rag-campus-facility', query: 'fasilitas kampus apa saja?' };
  }

  if (/\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|komunitas)\b/i.test(q)) {
    return { key: 'ukm_list', label: 'UKM dan kegiatan mahasiswa', source: 'semantic-rag-ukm-list', query: query };
  }

  if (/\b(beasiswa|kip|potongan|diskon|bantuan\s+biaya)\b/i.test(q)) {
    return { key: 'scholarship', label: 'Beasiswa', source: 'semantic-rag-scholarship', query: query };
  }

  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|rincian\s+biaya)\b/i.test(q)) {
    const source = /\b(si|sistem\s+informasi|sk|sistem\s+komputer|ti|teknologi\s+informasi|bd|bisnis\s+digital|dkv|desain\s+komunikasi\s+visual|gelombang|kelas|reguler|malam|karyawan)\b/i.test(q)
      ? 'semantic-rag-fee-detail'
      : 'semantic-rag-fee-general';
    return { key: `fee:${source}:${q}`, label: 'Biaya', source, query };
  }

  if (/\b(jadwal|kapan|tanggal|periode|gelombang|masih\s+dibuka|dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan))\b/i.test(q)) {
    const source = /\b(gelombang|masih\s+dibuka|dibuka|bulan\s+(?:ini|depan)|sekarang)\b/i.test(q)
      ? 'semantic-rag-current-open-waves'
      : 'semantic-rag-schedule-window';
    return { key: `schedule:${source}:${q}`, label: 'Jadwal pendaftaran', source, query };
  }

  if (/\b(cara\s+daftar|cara\s+mendaftar|mendaftar|registrasi|pendaftaran\s+online|daftar\s+online|syarat\s+(?:daftar|pendaftaran(?:nya)?|pendaftarannya))\b/i.test(q)) {
    return { key: 'registration_info', label: 'Cara pendaftaran', source: 'semantic-rag-registration-info', query };
  }

  if (/\b(prospek|kerja|karier|career|lulusan|jadi\s+apa|pekerjaan|profesi)\b/i.test(q)) {
    return { key: `career:${q}`, label: 'Prospek karier', source: 'semantic-rag-career', query };
  }

  if (/\b(alamat|lokasi|dimana|di\s*mana|maps|rute|letak)\b/i.test(q) && /\b(kampus|stikom|itb\s*stikom|renon|jimbaran|abiansemal)\b/i.test(q)) {
    return { key: 'campus_location', label: 'Lokasi kampus', source: 'semantic-rag-campus-location', query };
  }

  if (/\b(jurusan|prodi|program\s+studi)\b/i.test(q) && /\b(apa\s+saja|daftar|pilihan|tersedia|ada)\b/i.test(q)) {
    return { key: 'program_list', label: 'Program studi', source: 'semantic-rag-program-list', query: 'program studi apa saja yang tersedia?' };
  }

  if (/\b(apa\s+itu|pengertian|maksud(?:nya)?)\b/i.test(q) && /\b(bisnis\s+digital|sistem\s+informasi|sistem\s+komputer|teknologi\s+informasi|dkv|desain\s+komunikasi\s+visual|program|prodi|jurusan)\b/i.test(q)) {
    return { key: `definition:${q}`, label: 'Penjelasan program', source: 'semantic-rag-program-definition', query };
  }

  return null;
}

function detectCompoundTasks(question) {
  const raw = String(question || '').trim();
  const q = raw.toLowerCase();
  if (!raw) return [];
  const tasks = [];
  for (const part of splitCompoundQuestionParts(raw)) {
    pushCompoundTask(tasks, detectCompoundTaskFromPart(part, raw));
  }

  if (/\b(double\s*degree|dual\s*degree|dd)\b/i.test(q)) {
    if (/\b(apa\s+saja|ada\s+apa\s+saja|pilihan|daftar|tersedia)\b/i.test(q)) {
      pushCompoundTask(tasks, { key: 'double_degree_list', label: 'Double Degree', source: 'semantic-rag-dual-degree', query: 'apa saja program double degree di ITB STIKOM Bali?' });
    } else {
      pushCompoundTask(tasks, { key: 'double_degree_definition', label: 'Double Degree', source: 'semantic-rag-dual-degree', query: 'apa itu double degree di ITB STIKOM Bali?' });
    }
  }
  if (/\b(fasilitas|layanan|sarana|prasarana|yang\s+ada\s+di\s+kampus)\b/i.test(q)) {
    pushCompoundTask(tasks, { key: 'campus_facility', label: 'Fasilitas kampus', source: 'semantic-rag-campus-facility', query: 'fasilitas kampus apa saja?' });
  }
  if (/\b(prospek|kerja|karier|career|lulusan|jadi\s+apa|pekerjaan|profesi)\b/i.test(q)) {
    pushCompoundTask(tasks, { key: `career:${q}`, label: 'Prospek karier', source: 'semantic-rag-career', query: raw });
  }
  if (/\b(beasiswa|kip|potongan|diskon|bantuan\s+biaya)\b/i.test(q)) {
    pushCompoundTask(tasks, { key: 'scholarship', label: 'Beasiswa', source: 'semantic-rag-scholarship', query: raw });
  }
  if (/\b(biaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|rincian\s+biaya)\b/i.test(q)) {
    const source = /\b(si|sistem\s+informasi|sk|sistem\s+komputer|ti|teknologi\s+informasi|bd|bisnis\s+digital|dkv|desain\s+komunikasi\s+visual|gelombang|kelas|reguler|malam|karyawan)\b/i.test(q)
      ? 'semantic-rag-fee-detail'
      : 'semantic-rag-fee-general';
    pushCompoundTask(tasks, { key: `fee:${source}`, label: 'Biaya', source, query: raw });
  }
  if (/\b(jadwal|kapan|tanggal|periode|gelombang|masih\s+dibuka|dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan))\b/i.test(q)) {
    const source = /\b(gelombang|masih\s+dibuka|dibuka|bulan\s+(?:ini|depan)|sekarang)\b/i.test(q)
      ? 'semantic-rag-current-open-waves'
      : 'semantic-rag-schedule-window';
    pushCompoundTask(tasks, { key: `schedule:${source}`, label: 'Jadwal pendaftaran', source, query: raw });
  }
  if (/\b(cara\s+daftar|cara\s+mendaftar|mendaftar|registrasi|pendaftaran\s+online|daftar\s+online|syarat\s+(?:daftar|pendaftaran(?:nya)?|pendaftarannya))\b/i.test(q)) {
    pushCompoundTask(tasks, { key: 'registration_info', label: 'Cara pendaftaran', source: 'semantic-rag-registration-info', query: raw });
  }

  return tasks.slice(0, 4);
}

function buildCompoundTaskFallback(task) {
  const source = String(task && task.source || '');
  if (source === 'semantic-rag-registration-info') {
    return 'Saya belum punya informasi lengkap tentang syarat/cara pendaftaran yang spesifik pada data yang tersedia. Kakak bisa menghubungi bagian PMB untuk memastikan dokumen, alur, dan ketentuan terbarunya.';
  }
  if (source === 'semantic-rag-schedule-window' || source === 'semantic-rag-current-open-waves') {
    return 'Saya belum punya informasi jadwal pendaftaran yang cukup spesifik untuk bagian ini pada data yang tersedia. Untuk memastikan tanggal/gelombang yang sedang berlaku, kakak bisa cek kanal PMB resmi ITB STIKOM Bali atau hubungi bagian PMB.';
  }
  return null;
}
function runCompoundTask(task, indexForQuery, options = {}) {
  if (!task) return null;
  if (task.fallback) return { answer: task.fallback, source: 'semantic-rag-compound-fallback' };
  const source = task.source;
  if (!source || source === 'semantic-rag-compound-question') return null;
  const handler = HANDLERS_BY_SOURCE && HANDLERS_BY_SOURCE.get(source);
  if (!handler) return null;
  const needsIndex = SOURCES_NEEDING_INDEX && SOURCES_NEEDING_INDEX.has(source);
  const result = needsIndex ? handler(task.query, indexForQuery, options) : handler(task.query, options);
  const fallback = buildCompoundTaskFallback(task);
  if (!result || !result.answer) return fallback ? { answer: fallback, source: 'semantic-rag-compound-task-fallback' } : null;
  const answer = stripNaturalFrameForCompound(result.answer);
  if (!answer || /^mohon\s+maaf/i.test(answer)) return fallback ? { answer: fallback, source: 'semantic-rag-compound-task-fallback' } : null;
  return { ...result, answer };
}

function tryCompoundCampusQuestion(question, indexForQuery, options = {}) {
  const tasks = detectCompoundTasks(question);
  if (tasks.length < 2) return null;

  const parts = [];
  const usedLabels = new Set();
  for (const task of tasks) {
    const result = runCompoundTask(task, indexForQuery, options);
    if (!result || !result.answer) continue;
    const label = task.label || 'Informasi';
    const labelKey = label.toLowerCase();
    const heading = usedLabels.has(labelKey) ? `${label} tambahan` : label;
    usedLabels.add(labelKey);
    parts.push(`${heading}:\n${result.answer}`);
  }

  if (parts.length < 2) return null;
  return {
    answer: parts.join('\n\n'),
    source: 'semantic-rag-compound-question',
    frameSource: 'semantic-rag-direct-answer',
    tasks: tasks.map((task) => ({ key: task.key, label: task.label, source: task.source }))
  };
}
function tryCampusLocationAnswer(question) {
  const q = String(question || '').toLowerCase();
  if (!/\b(lokasi|alamat|kampus|dimana|di\s*mana|where|letak|maps|rute)\b/i.test(q)) return null;
  if (/\b(fasilitas|layanan|sarana|prasarana|ukm|ormawa|organisasi|kegiatan\s+mahasiswa|komunitas|hobi|minat)\b/i.test(q)) return null;
  const asksMainCampus = /\b(kampus\s+(?:utama|pusat)|utama(?:nya)?|pusat(?:nya)?)\b/i.test(q);
  const asksGenericCampusLocation = /\b(kampus(?:nya)?|lokasi\s+kampus|alamat\s+kampus|campus(?:\s+location)?|campus\s+address)\b/i.test(q);
  const mentionsOtherCampus = /\b(udayana|unud|warmadewa|undiknas|unhi|unwar|politeknik|universitas\s+(?!teknologi\s+bandung))\b/i.test(q) && !/\b(stikom|itb\s*stikom|stikom\s*bali)\b/i.test(q);
  if (mentionsOtherCampus) return null;
  const mentionsStikomCampus = /\b(stikom|itb\s*stikom|stikom\s*bali|renon|denpasar|jimbaran|abiansemal)\b/i.test(q) || asksMainCampus || asksGenericCampusLocation;
  if (!mentionsStikomCampus) return null;
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

function tryUkmInterestRecommendation(question, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const currentHasLinkedInCareerContext = /\b(linked\s*in|linkedin)\b/i.test(q) && /\b(career\s*center|pusat\s+karier|karir|karier)\b/i.test(q);
  const profile = UKM_INTEREST_PROFILES.find((item) => item.re.test(q));
  if (!profile) return null;
  const hasCurrentUkmContext = /\b(ukm(?:nya)?|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(q);
  const asksActivityByInterest = /\b(kegiatan|aktivitas|komunitas|organisasi)\b/i.test(q) && /\b(bidang|dibidang|minat|kategori|jenis)\b/i.test(q);
  const asksUkm = /\b(ukm(?:nya)?|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|organisasi|unit\s+kegiatan|komunitas|himpunan|hima)\b/i.test(q) || hasCurrentUkmContext || asksActivityByInterest;
  const asksRecommendation = asksActivityByInterest || /\b(cocok|rekomendasi|saran|sarankan|pilih|ikut|gabung|masuk|ambil|hobi|hobby|suka|minat|ada|adakah|apakah\s+ada|ada\s+yang|ada\s+apa|apa\s+yang|apa\s+saja|bidang|dibidang|jenis|kategori|kalau|kalo|yang)\b/i.test(q);
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

function tryUkmAnswer(question, _indexForQuery, options = {}) {
  const q = String(question || '').toLowerCase();
  const recent = getRecentConversation(options && options.sessionData).toLowerCase();
  const names = loadUkmNames();
  const findMentionedUkm = (text) => {
    let best = null;
    let bestIndex = -1;
    for (const name of names) {
      const escaped = String(name || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escaped) continue;
      const re = new RegExp(`\\b${escaped}\\b`, 'gi');
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match.index >= bestIndex) {
          best = name;
          bestIndex = match.index;
        }
      }
    }
    return best;
  };
  const currentMentionedUkm = findMentionedUkm(q);
  const recentMentionedUkm = findMentionedUkm(recent);
  const hasKnownUkmName = !!currentMentionedUkm;
  const hasActivityByInterest = /\b(kegiatan|aktivitas|komunitas|organisasi)\b/i.test(q) && /\b(bidang|dibidang|minat|kategori|jenis)\b/i.test(q);
  const hasUkmSignal = /\b(ukm(?:nya)?|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|bem|hima|unit\s+kegiatan|komunitas|himpunan)\b/i.test(q) || hasKnownUkmName || hasActivityByInterest;
  const hasUkmContext = /\b(ukm(?:nya)?|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan)\b/i.test(recent);
  const isUkmFollowUp = hasUkmContext && /\b(ukm(?:nya)?|ormawa|kegiatan\s+mahasiswa|organisasi\s+mahasiswa|unit\s+kegiatan|daftar(?:nya)?|list(?:nya)?)\b/i.test(q);
  const hasExplicitDifferentTopic = /\b(indikator|institusi|akreditasi|mutu|pertanggung\s*jawaban|layanan\s+industri|inkubator\s+bisnis|stikom\s+bali\s+goes\s+to\s+school|goes\s+to\s+school|international\s+student|apply|admission|double\s*degree|dual\s*degree|dnui|help\s+university|utb|bccp|short\s*course|student\s*exchange|students\s*exchange|exchange\s+program|linked\s*in|linkedin|career\s*center|pmb|mahasiswa\s+baru|biaya|harga|tarif|ukt|dpp|gelombang|jadwal|beasiswa|kip|prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika|fasilitas|layanan|sarana|prasarana|parkir(?:an)?(?:nya)?|kantin(?:nya)?|perpustakaan(?:nya)?|wifi|wi-fi|laboratorium(?:nya)?|lab(?:nya)?|ruang\s+kelas|lokasi|alamat)\b/i.test(q);
  if (!hasUkmSignal && hasUkmContext && (hasExplicitDifferentTopic || !isUkmFollowUp)) return null;
  if (!hasUkmSignal && !isUkmFollowUp) return null;

  const recommendation = tryUkmInterestRecommendation(question, options);
  if (recommendation) return recommendation;

  const mentionedUkm = currentMentionedUkm || recentMentionedUkm;
  const shortUkmMention = currentMentionedUkm && q.split(/\s+/).filter(Boolean).length <= 4;
  const asksSpecificUkmDetail = mentionedUkm && (
    shortUkmMention
    || /\b(apa\s+itu|itu\s+apa|apa\s+ya|maksud(?:nya)?|kepanjangan|singkatan|kegiatan(?:nya)?|aktivitas(?:nya)?|program\s+kerja|proker|jadwal|latihan|tujuan|detail|tentang)\b/i.test(q)
  );
  if (asksSpecificUkmDetail) {
    return {
      answer: [
        `Maaf, saya belum punya informasi detail tentang kegiatan atau program kerja UKM ${mentionedUkm}.`,
        '',
        'Data yang tersedia baru cukup untuk menyebutkan bahwa UKM/Ormawa tersebut tercatat di daftar kampus. Untuk detail kegiatan, jadwal, atau pendaftaran anggota, sebaiknya kakak konfirmasi ke bagian kemahasiswaan atau pengurus UKM terkait.'
      ].join('\n'),
      source: 'semantic-rag-ukm-specific-insufficient-data'
    };
  }

  if (!/\b(stikom|itb\s*stikom|kampus|ada|apa|daftar|list|sebutkan|mana|saja|aja|jenis|kegiatan\s+mahasiswa)\b/i.test(q) && !hasUkmContext && !hasKnownUkmName) return null;

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
  if (src.includes('campus-facility') || /\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+karier|inkubator|softskill)\b/.test(q)) {
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

  if (src.includes('ukm') || /\b(ukm(?:nya)?|ormawa|organisasi\s+mahasiswa|bem|hima|esport|esports|musik)\b/.test(q)) {
    const asksUkmRecommendation = /\b(cocok|rekomendasi|saran|sarankan|pilih|ikut|gabung|masuk|hobi|hobby|suka|minat|esport|esports|musik|kalo|kalau|ada|adakah|apakah\s+ada)\b/.test(q);
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
  if (!envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) return [];
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
      'Saya jawab rincian biaya' + target + ' sesuai program yang kakak tanyakan.',
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
      'Baik, Kak. Saya rincikan biaya sesuai program yang ditanyakan.',
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
      'Baik, Kak. Saya rincikan biaya sesuai program yang ditanyakan.',
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
  if (src.includes('insufficient-data') || src.includes('small-talk') || src.includes('out-of-domain') || src.includes('feedback') || src.includes('unsupported-program') || src.includes('clarification') || src.includes('pmb-contact') || src.includes('pmb-requirements') || src.includes('direct-answer')) return body;
  const q = String(question || '').toLowerCase();
  if (/\b(apa\s+kabar|apa\s+khabar|kabar\s+apa|khabar\s+apa|gimana\s+kabar|gimana\s+khabar|kabar\s+kamu|khabar\s+kamu|kamu\s+gimana|gimana\s+kabarmu|apa\s+kabarmu|bagaimana\s+kabar|bagaimana\s+khabar)\b/i.test(q)) return body;
  if (/^\s*(halo|hallo|hai|hi|hello|haloo|halooo|assalamualaikum|assalamu\s+alaikum|om\s+swastiastu|swastiastu|shalom|namo\s+buddhaya|nammo\s+buddhaya|salam\s+kebajikan|rahayu|salam\s+rahayu|salam|selamat\s+pagi|selamat\s+siang|selamat\s+sore|selamat\s+malam)\s*(kak|min|admin|tiko)?\s*$/i.test(String(question || '').trim())) return body;

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
    'Gaya bahasa: gunakan bahasa yang sama dengan pertanyaan user. Jika user bertanya dalam bahasa Inggris, jawab dalam bahasa Inggris. Jika user bertanya dalam bahasa Indonesia, jawab dalam Bahasa Indonesia percakapan sehari-hari yang sopan, halus, dan natural seperti chat admin kampus yang ramah.',
    'Jangan terdengar seperti template/formulir. Hindari pembuka berulang seperti "Saya pahami..." kalau tidak perlu.',
    'Jawab langsung ke inti, tetap rapi, dan gunakan "Kak" secara wajar.',
    'Jangan menulis label "Question:", "Answer:", "Pertanyaan:", atau mengulang pertanyaan user di jawaban.',
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
      { role: 'system', content: 'You are a grounded campus assistant. Use only supplied context. Answer in the same language as the user question.' },
      { role: 'user', content: prompt }
    ],
    max_completion_tokens: parseInt(process.env.OPENAI_SEMANTIC_RAG_MAX_OUTPUT_TOKENS || process.env.OPENAI_RAG_MAX_OUTPUT_TOKENS || '550', 10),
    temperature: Number(process.env.OPENAI_SEMANTIC_RAG_TEMPERATURE || '0.3'),
    top_p: Number(process.env.OPENAI_SEMANTIC_RAG_TOP_P || '0.8')
  });

  return stripQuestionAnswerEnvelope(String(completion && completion.choices && completion.choices[0] && completion.choices[0].message ? completion.choices[0].message.content || '' : '').trim());
}

const DETERMINISTIC_HANDLERS = [
  ['semantic-rag-compound-question', tryCompoundCampusQuestion],
  ['semantic-rag-small-talk', trySmallTalkAnswer],
  ['semantic-rag-org-structure-unavailable', tryOrganizationalStructureAnswer],
  ['semantic-rag-clarification', tryShortClarificationAnswer],
  ['semantic-rag-out-of-domain', tryOutOfDomainAnswer],
  ['semantic-rag-dual-degree-followup', tryDoubleDegreeFollowUpAnswer],
  ['semantic-rag-feedback', tryFeedbackAnswer],
  ['semantic-rag-unsupported-program', tryUnsupportedProgramAnswer],
  ['semantic-rag-pmb-contact', tryPmbContactAnswer],
  ['semantic-rag-pmb-requirements', tryPmbRequirementsAnswer],
  ['semantic-rag-campus-support-entity', tryCampusSupportEntityAnswer],
  ['semantic-rag-registration-info', tryRegistrationHowAnswer],
  ['semantic-rag-schedule-window', tryScheduleWindowAnswer],
  ['semantic-rag-linkedin-career-insufficient-data', tryLinkedInCareerCenterNoDataAnswer],
  ['semantic-rag-ukm-list', tryUkmAnswer],
  ['semantic-rag-training-specific', tryTrainingSpecificAnswer],
  ['semantic-rag-campus-facility', tryCampusFacilityAnswer],
  ['semantic-rag-campus-location', tryCampusLocationAnswer],
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
  'semantic-rag-compound-question',
  'semantic-rag-registration-fee',
  'semantic-rag-fee-detail',
  'semantic-rag-fee-general',
  'semantic-rag-contextual-fee',
  'semantic-rag-fee-comparison',
  'semantic-rag-campus-support-entity',
  'semantic-rag-ukm-list',
  'semantic-rag-training-specific',
  'semantic-rag-campus-facility'
]);
const PRE_AI_HANDLER_SOURCES = new Set([
  'semantic-rag-small-talk',
  'semantic-rag-out-of-domain',
  'semantic-rag-dual-degree-followup',
  'semantic-rag-campus-support-entity',
  'semantic-rag-linkedin-career-insufficient-data',
  'semantic-rag-unsupported-program',
  'semantic-rag-ukm-list',
  'semantic-rag-training-specific',
  'semantic-rag-campus-facility'
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

function detectQuestionTopicFamilies(question) {
  const q = String(question || '').toLowerCase();
  const families = new Set();
  const add = (name, re) => { if (re.test(q)) families.add(name); };
  add('fee', /\b(biaya|harga|tarif|ongkos|bayar|uang|dpp|ukt|semester|pendaftaran\s+berapa|fee|fees|cost|costs|tuition|payment|payments)\b/i);
  add('registration', /\b(daftar|pendaftaran|registrasi|pmb|camaba|mahasiswa\s+baru|apply|application|admission|register|registration|enroll)\b/i);
  add('requirements', /\b(syarat|persyaratan|dokumen|berkas|lampiran|formulir|kelengkapan|requirement|requirements|document|documents|files?)\b/i);
  add('schedule', /\b(jadwal|gelombang|tanggal|deadline|buka|dibuka|kapan|schedule|wave|date|deadline|open|opened)\b/i);
  add('scholarship', /\b(beasiswa|kip|potongan|diskon|scholarship|discount)\b/i);
  add('program', /\b(prodi|program\s+studi|jurusan|major|study\s+program|sistem\s+informasi|teknologi\s+informasi|sistem\s+komputer|bisnis\s+digital|manajemen\s+informatika)\b/i);
  add('career', /\b(prospek|karir|karier|kerja|pekerjaan|career|job|work)\b/i);
  add('dual_degree', /\b(double\s*degree|dual\s*degree|dd|utb|dnui|help\s+university)\b/i);
  add('facility', /\b(fasilitas|layanan|sarana|prasarana|inkubator|career\s*center|hi-?think|gccp|student\s*exchange|goes\s+to\s+school|facility|facilities|services?)\b/i);
  add('ukm', /\b(ukm|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|kegiatan\s+mahasiswa|bem|hima)\b/i);
  add('location', /\b(lokasi|alamat|kampus\s+(?:utama|pusat)|where|location|address)\b/i);
  add('contact', /\b(kontak|hubungi|nomor|wa\b|whatsapp|admin|cs|contact|phone|helpdesk)\b/i);
  add('accreditation', /\b(akreditasi|ban-pt|lam\s+infokom|accreditation)\b/i);
  return families;
}

function sourceTopicFamilies(source) {
  const src = String(source || '').toLowerCase();
  const families = new Set();
  const add = (name) => families.add(name);
  if (src.includes('fee')) add('fee');
  if (src.includes('registration')) { add('registration'); add('fee'); }
  if (src.includes('requirements')) { add('requirements'); add('registration'); }
  if (src.includes('schedule') || src.includes('waves')) add('schedule');
  if (src.includes('scholarship')) add('scholarship');
  if (src.includes('compound-question')) { add('program'); add('facility'); }
  if (src.includes('program-definition') || src.includes('program-list') || src.includes('program-comparison') || src.includes('program-recommendation')) add('program');
  if (src.includes('program-recommendation')) add('career');
  if (src.includes('career')) add('career');
  if (src.includes('dual-degree')) { add('dual_degree'); add('program'); }
  if (src.includes('campus-facility') || src.includes('campus-support') || src.includes('training-specific') || src.includes('linkedin-career')) add('facility');
  if (src.includes('ukm')) add('ukm');
  if (src.includes('location')) add('location');
  if (src.includes('contact')) add('contact');
  if (src.includes('accreditation')) add('accreditation');
  if (src.includes('small-talk') || src.includes('feedback') || src.includes('out-of-domain') || src.includes('insufficient-data') || src.includes('unsupported')) add('meta');
  return families;
}

function isCompatibleDeterministicSource(question, source, result = null) {
  const qFamilies = detectQuestionTopicFamilies(question);
  if (!qFamilies.size) return true;
  const sFamilies = sourceTopicFamilies(source);
  if (!sFamilies.size || sFamilies.has('meta')) return true;
  for (const family of qFamilies) {
    if (sFamilies.has(family)) return true;
  }
  const answerSource = result && typeof result === 'object' ? String(result.source || result.frameSource || '') : '';
  if (answerSource && answerSource !== source) return isCompatibleDeterministicSource(question, answerSource, null);
  return false;
}

function answerHasIndonesianMarkers(answer) {
  return /\b(kakak|Kak|saya|mohon maaf|pendaftaran|biaya|prodi|jurusan|gelombang|beasiswa|kampus|kalau|jadi|untuk)\b/i.test(String(answer || ''));
}

async function polishEnglishDeterministicAnswer(client, question, result, options = {}) {
  if (!result || !result.answer || !client) return result;
  if (!isLikelyEnglishConversation(question, options) || !answerHasIndonesianMarkers(result.answer)) return result;
  try {
    const prompt = [
      'Translate only the assistant answer into natural English.',
      'Preserve all facts, numbers, URLs, names, bullet structure, and uncertainty. Do not add new information. Do not output Question/Answer labels and do not repeat the question.',
      '',
      `Question:\n${question}`,
      '',
      `Answer:\n${result.answer}`
    ].join('\n');
    const completion = await client.chat.completions.create({
      model: getModel(),
      messages: [
        { role: 'system', content: 'You translate grounded assistant answers into English without changing facts.' },
        { role: 'user', content: prompt }
      ],
      max_completion_tokens: parseInt(process.env.OPENAI_SEMANTIC_RAG_MAX_OUTPUT_TOKENS || process.env.OPENAI_RAG_MAX_OUTPUT_TOKENS || '550', 10),
      temperature: 0.1,
      top_p: 0.8
    });
    const translated = String(completion && completion.choices && completion.choices[0] && completion.choices[0].message ? completion.choices[0].message.content || '' : '').trim();
    if (translated) return { ...result, answer: stripQuestionAnswerEnvelope(translated), debug: { ...(result.debug || {}), englishPolished: true } };
  } catch (err) {
    logger.warn({ err: err && err.message ? err.message : String(err) }, '[SemanticRAG] English polish failed');
  }
  return result;
}

function buildDeterministicResponse(originalQuestion, source, result, debugExtra = {}, options = {}) {
  const frameSource = result.frameSource || source;
  const category = detectAnswerCategory(originalQuestion, frameSource);
  const confidenceTier = sourceConfidenceTier({ source: frameSource, score: result.confidenceScore || 1, answer: result.answer });
  const framed = formatNaturalAnswerFrame(originalQuestion, result.answer, frameSource);
  const formatted = formatAnswerByCategory(originalQuestion, framed, frameSource, confidenceTier);
  const answer = localizeAnswerLanguage(originalQuestion, formatted, frameSource, options);
  appendAnswerQualityLog({ question: originalQuestion, source, category, confidenceTier, confidenceScore: confidenceTier === 'VERY_LOW' ? 0 : 1, action: confidenceTier === 'VERY_LOW' ? 'fallback' : 'answer', answer });
  return {
    success: true,
    answer,
    source,
    contexts: [],
    confidenceScore: confidenceTier === 'VERY_LOW' ? 0 : 1,
    confidenceTier,
    answerCategory: category,
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
        if (!isCompatibleDeterministicSource(originalQuestion, source, result)) continue;
        return buildDeterministicResponse(originalQuestion, source, result, {
          ...debugExtra,
          semanticVariant: variant !== String(originalQuestion || '').trim() ? variant : undefined
        }, options);
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

function buildInsufficientDataAnswer(kind = 'very_low') {
  if (kind === 'low') {
    return 'Saya ragu apakah saya mempunyai cukup data untuk menjawab pertanyaan anda. Tapi akan saya coba menjawab.';
  }
  return 'Mohon maaf, saya kemungkinan tidak mempunyai jawaban yang mencukupi, untuk menjawab pertanyaan anda. Mungkin anda bisa mengubah pertanyaannya atau menanyakan hal lain yang ingin diketahui.';
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

  if (isClarificationLoopRisk(question, options)) {
    const response = { success: true, answer: buildClarificationLoopFallbackAnswer(question, options), source: 'semantic-rag-clarification-loop-fallback', contexts: [], confidenceTier: 'VERY_LOW' };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  if (isOperationalAcademicPolicyQuestion(question) || isVagueAcademicPolicyFollowUp(question, options)) {
    const policyQuestion = isOperationalAcademicPolicyQuestion(question) ? question : buildOperationalAcademicPolicyQuestionForFollowUp(question, options);
    const response = { success: true, answer: buildOperationalAcademicPolicyNoDataAnswer(policyQuestion), source: 'semantic-rag-operational-academic-policy-no-answer', contexts: [], confidenceTier: 'VERY_LOW' };
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  const directCompoundQuestion = /double degree/i.test(String(question || '')) && /fasilitas/i.test(String(question || ''))
    ? 'ada double degree apa saja dan fasilitas apa saja yang ada di kampus?'
    : question;
  const directCompoundResult = tryCompoundCampusQuestion(directCompoundQuestion, getCachedSemanticIndex(), options);
  if (directCompoundResult && directCompoundResult.answer) {
    const response = buildDeterministicResponse(question, 'semantic-rag-compound-question', directCompoundResult, { routeStage: 'pre-handler-compound' }, options);
    setCachedSemanticResult(resultCacheKey, response);
    return response;
  }

  const client = getClient();
  const preAiHandlers = DETERMINISTIC_HANDLERS.filter(([source]) => PRE_AI_HANDLER_SOURCES.has(source));
  let preAiResult = runDeterministicHandlers(question, preAiHandlers, options, [question], { routeStage: 'pre-ai' });
  if (preAiResult) {
    preAiResult = await polishEnglishDeterministicAnswer(client, question, preAiResult, options);
    setCachedSemanticResult(resultCacheKey, preAiResult);
    return preAiResult;
  }

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
    if (isGenericSemanticClarification(question, rewrite.clarificationQuestion)) {
      const response = {
        success: true,
        answer: isOperationalAcademicPolicyQuestion(question) ? buildOperationalAcademicPolicyNoDataAnswer(question) : buildInsufficientDataAnswer('very_low'),
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

  const semanticRouteEnabled = shouldUseSemanticDeterministicRoute(rewrite);
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
    const routedResult = runSemanticDeterministicRoute('ai-intent');
    if (routedResult) {
      setCachedSemanticResult(resultCacheKey, routedResult);
      return routedResult;
    }
  }


  const rawRetrieved = await retrieveSemanticContexts(rewrite.searchQueries, { topK: options.topK });
  const filteredContexts = filterSemanticContextsForQuestion(question, rawRetrieved.contexts);
  const retrieved = {
    ...rawRetrieved,
    contexts: filteredContexts,
    topScore: filteredContexts.length ? filteredContexts[0].score : 0,
    rawTopScore: rawRetrieved.topScore
  };
  const minScoreRaw = Number(process.env.SEMANTIC_RAG_MIN_SCORE || '0.18');
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : 0.18;
  if (!retrieved.contexts.length || retrieved.topScore < minScore) {
    const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-no-context') : null;
    if (fallbackResult) {
      setCachedSemanticResult(resultCacheKey, fallbackResult);
      return fallbackResult;
    }
    const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-no-context-deterministic-fallback');
    if (generalFallbackResult) {
      setCachedSemanticResult(resultCacheKey, generalFallbackResult);
      return generalFallbackResult;
    }
    const veryLowThresholdRaw = Number(process.env.SEMANTIC_RAG_VERY_LOW_SCORE || '0.12');
    const veryLowThreshold = Number.isFinite(veryLowThresholdRaw) ? veryLowThresholdRaw : 0.12;
    const category = detectAnswerCategory(question, 'semantic-rag-no-context');
    const confidenceTier = retrieved.topScore >= veryLowThreshold ? 'LOW' : 'VERY_LOW';
    const clarification = maybeBuildClarificationFromLowConfidence(question, category, confidenceTier);
    const answer = clarification || buildSpecificInsufficientDataAnswer(question, confidenceTier === 'LOW' ? 'low' : 'very_low');
    appendAnswerQualityLog({
      question,
      source: 'semantic-rag-no-context',
      category,
      confidenceTier,
      confidenceScore: retrieved.topScore,
      action: clarification ? 'clarify' : 'fallback',
      reason: 'no_context',
      answer
    });
    return {
      success: true,
      answer,
      source: 'semantic-rag-no-context',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      confidenceTier,
      answerCategory: category,
      debug: { rewrite, minScore, veryLowThreshold, indexSize: retrieved.indexSize, rawTopScore: retrieved.rawTopScore }
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
      const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-empty-answer-deterministic-fallback');
      if (generalFallbackResult) {
        setCachedSemanticResult(resultCacheKey, generalFallbackResult);
        return generalFallbackResult;
      }
      const category = detectAnswerCategory(question, 'semantic-rag-empty-answer');
      const answer = buildSpecificInsufficientDataAnswer(question, 'very_low');
      appendAnswerQualityLog({
        question,
        source: 'semantic-rag-empty-answer',
        category,
        confidenceTier: 'VERY_LOW',
        confidenceScore: retrieved.topScore,
        action: 'fallback',
        reason: 'empty_answer',
        answer
      });
      return { success: true, answer, source: 'semantic-rag-empty-answer', contexts: retrieved.contexts, confidenceScore: retrieved.topScore, confidenceTier: 'VERY_LOW', answerCategory: category, debug: { rewrite } };
    }
    if (rawAnswer.toUpperCase().includes('TIDAK_CUKUP_DATA')) {
      const fallbackResult = preferTrainingFirst ? runSemanticDeterministicRoute('ai-intent-fallback-after-rag-insufficient-context') : null;
      if (fallbackResult) {
        setCachedSemanticResult(resultCacheKey, fallbackResult);
        return fallbackResult;
      }
      const generalFallbackResult = runVettedDeterministicFallback(question, options, rewrite, 'rag-insufficient-context-deterministic-fallback');
      if (generalFallbackResult) {
        setCachedSemanticResult(resultCacheKey, generalFallbackResult);
        return generalFallbackResult;
      }
      const cleaned = rawAnswer.replace(/TIDAK_CUKUP_DATA[:\s-]*/i, '').trim();
      const allowClarifyingFallback = envFlag('SEMANTIC_RAG_RETURN_CLARIFICATION_ON_NO_DATA', true);
      const category = detectAnswerCategory(question, 'semantic-rag-insufficient-context');
      const baseFallback = buildSpecificInsufficientDataAnswer(question, 'very_low');
      const answer = allowClarifyingFallback && cleaned ? `${baseFallback} ${cleaned}` : baseFallback;
      appendAnswerQualityLog({
        question,
        source: 'semantic-rag-insufficient-context',
        category,
        confidenceTier: 'VERY_LOW',
        confidenceScore: retrieved.topScore,
        action: 'fallback',
        reason: 'insufficient_context',
        answer
      });
      return {
        success: true,
        answer,
        source: 'semantic-rag-insufficient-context',
        contexts: retrieved.contexts,
        confidenceScore: retrieved.topScore,
        confidenceTier: 'VERY_LOW',
        answerCategory: category,
        debug: { rewrite }
      };
    }

    const cleanedAnswer = ragEngine.cleanAnswerLanguage(rawAnswer);
    const category = detectAnswerCategory(question, 'semantic-rag');
    const confidenceTier = sourceConfidenceTier({ source: 'semantic-rag', score: retrieved.topScore, answer: cleanedAnswer });
    const answer = formatAnswerByCategory(
      question,
      formatNaturalAnswerFrame(question, cleanedAnswer, 'semantic-rag'),
      'semantic-rag',
      confidenceTier
    );
    if (confidenceTier !== 'HIGH') {
      appendAnswerQualityLog({
        question,
        source: 'semantic-rag',
        category,
        confidenceTier,
        confidenceScore: retrieved.topScore,
        action: 'answer_with_boundary',
        reason: 'non_high_confidence',
        answer
      });
    }
    const response = {
      success: true,
      answer,
      source: 'semantic-rag',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      confidenceTier,
      answerCategory: category,
      debug: { rewrite, indexSize: retrieved.indexSize, rawTopScore: retrieved.rawTopScore }
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
    const category = detectAnswerCategory(question, 'semantic-rag-error');
    const answer = 'Maaf, saya belum bisa mengambil jawaban dari data saat ini. Coba ulangi pertanyaannya sebentar lagi, atau tuliskan dengan lebih spesifik.';
    appendAnswerQualityLog({
      question,
      source: 'semantic-rag-error',
      category,
      confidenceTier: 'VERY_LOW',
      confidenceScore: retrieved.topScore,
      action: 'fallback',
      reason: 'rag_error',
      answer
    });
    return {
      success: true,
      answer,
      source: 'semantic-rag-error',
      contexts: retrieved.contexts,
      confidenceScore: retrieved.topScore,
      confidenceTier: 'VERY_LOW',
      answerCategory: category,
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




















