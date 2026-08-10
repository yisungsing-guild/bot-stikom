const { normalizeUserQuery } = require('../utils/queryNormalizer');

const ID_STOPWORDS = new Set([
  'aku', 'saya', 'kami', 'kita', 'mau', 'ingin', 'pengen', 'boleh', 'bisa',
  'tolong', 'dong', 'ya', 'yah', 'nih', 'kak', 'min', 'admin', 'tentang',
  'untuk', 'yang', 'di', 'ke', 'dari', 'dan', 'atau', 'itu', 'ini', 'ada',
  'apa', 'apakah', 'bagaimana', 'gimana', 'berapa', 'kapan'
]);

const EN_STOPWORDS = new Set([
  'i', 'me', 'my', 'we', 'want', 'need', 'please', 'about', 'the', 'a', 'an',
  'to', 'for', 'of', 'and', 'or', 'is', 'are', 'what', 'how', 'when', 'where'
]);

const STATIC_RESPONSE_PATTERNS = [
  { type: 'reset', pattern: /\b(?:reset|mulai\s+ulang|hapus\s+(?:sesi|session|percakapan)|bersihkan\s+chat|ulang\s+dari\s+awal)\b/i },
  { type: 'help', pattern: /\b(?:help|bantuan|menu|bisa\s+(?:bantu|bertanya)\s+apa|panduan)\b/i },
  { type: 'thanks', pattern: /\b(?:terima\s+kasih|makasih|thanks|thank\s+you|thx)\b/i },
  { type: 'greeting', pattern: /^(?:halo|hallo|hai|hi|hello|selamat\s+(?:pagi|siang|sore|malam)|assalamualaikum)\b/i }
];

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return compactText(value).toLowerCase().split(/\s+/).filter(Boolean);
}

function detectLanguage(text) {
  const q = ` ${compactText(text).toLowerCase()} `;
  if (!q.trim()) return { language: 'unknown', confidence: 0 };
  const idHits = (q.match(/\b(?:apa|apakah|bagaimana|berapa|kapan|dimana|jurusan|prodi|kuliah|biaya|beasiswa|pendaftaran|kampus|yang|dan|untuk)\b/g) || []).length;
  const enHits = (q.match(/\b(?:what|how|when|where|tuition|scholarship|admission|campus|program|major|fee|and|for)\b/g) || []).length;
  if (idHits === 0 && enHits === 0) return { language: 'unknown', confidence: 0.3 };
  if (idHits >= enHits) return { language: 'id', confidence: Math.min(0.98, 0.55 + idHits * 0.08) };
  return { language: 'en', confidence: Math.min(0.98, 0.55 + enHits * 0.08) };
}

function stripStopwords(text, language = 'id') {
  const stopwords = language === 'en' ? EN_STOPWORDS : ID_STOPWORDS;
  const kept = [];
  const removed = [];
  for (const token of tokenize(text)) {
    if (stopwords.has(token)) removed.push(token);
    else kept.push(token);
  }
  return {
    text: kept.join(' '),
    removed
  };
}

function detectUrgency(text) {
  const q = compactText(text).toLowerCase();
  let score = 0;
  const reasons = [];
  if (/\b(?:segera|urgent|mendesak|cepat|hari\s+ini|sekarang|deadline|terakhir|ditutup|tutup)\b/i.test(q)) {
    score += 0.55;
    reasons.push('urgency_terms');
  }
  if (/\b(?:kapan|sampai\s+kapan|batas\s+akhir|masih\s+buka)\b/i.test(q)) {
    score += 0.25;
    reasons.push('time_sensitive_question');
  }
  return {
    level: score >= 0.7 ? 'high' : score >= 0.35 ? 'medium' : 'low',
    score: Math.min(1, score),
    reasons
  };
}

function detectSentiment(text) {
  const q = compactText(text).toLowerCase();
  let score = 0;
  const reasons = [];
  if (/\b(?:bingung|takut|khawatir|cemas|kurang|tidak\s+bisa|ga\s+bisa|gak\s+bisa|susah|mahal)\b/i.test(q)) {
    score -= 0.5;
    reasons.push('concern_terms');
  }
  if (/\b(?:terima\s+kasih|makasih|bagus|mantap|senang|tertarik|suka)\b/i.test(q)) {
    score += 0.45;
    reasons.push('positive_terms');
  }
  return {
    label: score <= -0.35 ? 'concerned' : score >= 0.35 ? 'positive' : 'neutral',
    score,
    reasons
  };
}

function detectStaticResponse(text) {
  const q = compactText(text);
  for (const item of STATIC_RESPONSE_PATTERNS) {
    if (item.pattern.test(q)) {
      return { type: item.type, confidence: item.type === 'reset' ? 0.95 : 0.85 };
    }
  }
  return { type: null, confidence: 0 };
}

function detectContextSignals(text, sessionData = {}) {
  const q = compactText(text).toLowerCase();
  const followUp = /\b(?:itu|tadi|lanjut|detailnya|yang\s+mana|berapa|gimana)\b/i.test(q) || tokenize(q).length <= 3;
  const lastProgram = sessionData && (sessionData.lastProgramHint || sessionData.currentProgramHint || sessionData.programHint) || null;
  const hasMemory = Boolean(lastProgram || (sessionData && sessionData.lastIntent));
  return {
    followUp,
    hasMemory,
    lastProgram: lastProgram ? String(lastProgram) : null,
    lastIntent: sessionData && sessionData.lastIntent ? String(sessionData.lastIntent) : null
  };
}

function buildPromptPlan({ persona = 'TIKO - Assistant STIKOM', instruction = '', retrievedContext = '', conversationHistory = '', memory = {} } = {}) {
  return {
    orchestrator: 'LLM Orchestrator',
    persona,
    instruction: instruction || 'Jawab sebagai asisten informasi ITB STIKOM Bali. Gunakan hanya konteks yang tersedia, jangan mengarang.',
    retrievedContext: retrievedContext ? 'included' : 'empty',
    conversationHistory: conversationHistory ? 'included' : 'empty',
    memory: memory && Object.keys(memory).length ? 'included' : 'empty',
    responseContract: {
      grounded: true,
      conciseWhatsapp: true,
      noRawSourceLeak: true
    }
  };
}

function buildTechniqueEnvelope(rawText, options = {}) {
  const normalization = normalizeUserQuery(rawText);
  const language = detectLanguage(normalization.normalizedText || rawText);
  const stopwords = stripStopwords(normalization.normalizedText || rawText, language.language);
  const urgency = detectUrgency(rawText);
  const sentiment = detectSentiment(rawText);
  const staticResponse = detectStaticResponse(rawText);
  const context = detectContextSignals(rawText, options.sessionData || {});

  return {
    normalizedQuery: normalization.normalizedText,
    normalization,
    language,
    stopwords,
    urgency,
    sentiment,
    staticResponse,
    context,
    resetRequested: staticResponse.type === 'reset'
  };
}

function detectSensitiveInformation(text) {
  const out = String(text || '');
  const hits = [];
  if (/\b(?:api[_-]?key|token|secret|password|passwd|authorization)\b/i.test(out)) hits.push('secret_or_token');
  if (/\b(?:\+?62|0)8\d{7,12}\b/.test(out)) hits.push('phone_number');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(out)) hits.push('email');
  if (/\b\d{10,18}\b/.test(out)) hits.push('long_numeric_identifier');
  return {
    hasSensitiveInfo: hits.length > 0,
    hits: Array.from(new Set(hits))
  };
}

function maskPii(text) {
  return String(text || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email disamarkan]')
    .replace(/\b(?:\+?62|0)8\d{7,12}\b/g, '[nomor disamarkan]')
    .replace(/\b(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*\S+/gi, (_, label) => `${label}=[disamarkan]`);
}

function validateBusinessRules(answer, userQuery = '') {
  const text = String(answer || '');
  const q = String(userQuery || '');
  const issues = [];
  if (/\b(?:biaya|ukt|dpp|pendaftaran|potongan)\b/i.test(q) && /\bRp\.?\s*\d/i.test(text) && !/\b(?:data|tersedia|gelombang|prodi|program|biaya)\b/i.test(text)) {
    issues.push('fee_answer_missing_context');
  }
  if (/\b(?:akreditasi|ban-pt)\b/i.test(q) && /\b(?:unggul|baik\s+sekali|baik)\b/i.test(text) && !/\b(?:BAN\s*-?\s*PT|akreditasi)\b/i.test(text)) {
    issues.push('accreditation_without_authority_context');
  }
  return { ok: issues.length === 0, issues };
}

function validateCitation(answer, meta = {}) {
  const source = String(meta.source || '');
  const contexts = Array.isArray(meta.contexts) ? meta.contexts : [];
  const needsGrounding = /rag|uploaded|semantic/i.test(source) && !/small-talk|greeting|feedback/i.test(source);
  return {
    ok: !needsGrounding || contexts.length > 0 || /no-data|insufficient|fallback|academic-credit-no-data|schedule/i.test(source),
    needsGrounding,
    contextCount: contexts.length
  };
}

function estimateFinalConfidence({ retrievalScore = 0, intentConfidence = 0, safetyIssues = [], answerable = true } = {}) {
  let score = Math.max(Number(retrievalScore) || 0, Number(intentConfidence) || 0);
  if (!score) score = answerable ? 0.55 : 0.25;
  if (!answerable) score = Math.min(score, 0.45);
  score -= Math.min(0.45, (Array.isArray(safetyIssues) ? safetyIssues.length : 0) * 0.08);
  score = Math.max(0, Math.min(1, score));
  return {
    score,
    tier: score >= 0.75 ? 'HIGH' : score >= 0.5 ? 'MEDIUM' : score >= 0.3 ? 'LOW' : 'VERY_LOW'
  };
}

module.exports = {
  buildTechniqueEnvelope,
  detectLanguage,
  stripStopwords,
  detectUrgency,
  detectSentiment,
  detectStaticResponse,
  detectContextSignals,
  buildPromptPlan,
  detectSensitiveInformation,
  maskPii,
  validateBusinessRules,
  validateCitation,
  estimateFinalConfidence
};
