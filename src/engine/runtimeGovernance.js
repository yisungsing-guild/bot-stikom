const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const ensuredRuntimeTables = new Set();

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === 'true' || v === '1' || v === 'yes' || v === 'y' || v === 'on';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function clamp(value, max = 500) {
  const s = String(value || '');
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['approved', 'active', 'published', 'valid'].includes(status)) return 'approved';
  if (['draft', 'pending', 'review'].includes(status)) return 'draft';
  if (['expired', 'inactive'].includes(status)) return 'expired';
  if (['rejected', 'blocked'].includes(status)) return 'rejected';
  return 'approved';
}

function buildDocumentGovernanceMetadata(input = {}) {
  const filename = String(input.filename || '').trim();
  const divisionKey = String(input.divisionKey || '').trim() || null;
  const nowIso = new Date().toISOString();
  const explicitOwner = String(input.owner || input.governanceOwner || '').trim();
  const source = String(input.source || '').trim() || 'unknown';

  return {
    owner: explicitOwner || divisionKey || 'general',
    status: normalizeStatus(input.status || input.governanceStatus || 'approved'),
    version: String(input.version || input.governanceVersion || '').trim() || `${source}-${sha256(filename || nowIso).slice(0, 10)}`,
    validFrom: input.validFrom || nowIso,
    validTo: input.validTo || null,
    sourceAuthority: String(input.sourceAuthority || input.authority || '').trim() || (source === 'upload' ? 'admin_upload' : source),
    notes: String(input.notes || '').trim() || null
  };
}

function parseDateMs(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getTrainingGovernance(row = {}) {
  const metadata = row.governanceMetadata && typeof row.governanceMetadata === 'object'
    ? row.governanceMetadata
    : {};
  const createdAt = row.createdAt || new Date();
  return {
    owner: row.governanceOwner || metadata.owner || row.divisionKey || 'general',
    status: normalizeStatus(row.governanceStatus || metadata.status || 'approved'),
    version: row.governanceVersion || metadata.version || null,
    validFrom: row.validFrom || metadata.validFrom || createdAt,
    validTo: row.validTo || metadata.validTo || null,
    sourceAuthority: metadata.sourceAuthority || row.source || 'unknown'
  };
}

function isTrainingGovernanceAllowed(row = {}) {
  const governance = getTrainingGovernance(row);
  if (envFlag('RAG_ALLOW_DRAFT_DOCUMENTS', false) && governance.status === 'draft') return true;
  if (!['approved'].includes(governance.status)) return false;

  const now = Date.now();
  const from = parseDateMs(governance.validFrom);
  const to = parseDateMs(governance.validTo);
  if (from && from > now && !envFlag('RAG_ALLOW_FUTURE_DOCUMENTS', false)) return false;
  if (to && to < now && !envFlag('RAG_ALLOW_EXPIRED_DOCUMENTS', false)) return false;
  return true;
}

function filterGovernedTrainingRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter(isTrainingGovernanceAllowed);
}

async function safeEnsureRuntimeTable(prisma, tableName, sql) {
  if (!prisma || !tableName || !sql || ensuredRuntimeTables.has(tableName)) return;
  try {
    await prisma.$executeRawUnsafe(sql);
    ensuredRuntimeTables.add(tableName);
  } catch (err) {
    safeWarn({ tableName, err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to ensure runtime table');
  }
}

async function ensureRuntimeAuditTables(prisma) {
  if (!prisma) return;
  await safeEnsureRuntimeTable(prisma, 'InboundEventDedupe', `
    CREATE TABLE IF NOT EXISTS "InboundEventDedupe" (
      "id" TEXT PRIMARY KEY,
      "provider" TEXT NOT NULL DEFAULT 'whatsapp',
      "chatId" TEXT NOT NULL,
      "messageId" TEXT,
      "dedupeKey" TEXT NOT NULL UNIQUE,
      "textHash" TEXT,
      "inboundTs" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await safeEnsureRuntimeTable(prisma, 'UserFeedback', `
    CREATE TABLE IF NOT EXISTS "UserFeedback" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT NOT NULL,
      "feedbackType" TEXT NOT NULL,
      "userText" TEXT NOT NULL,
      "lastBotAnswer" TEXT,
      "lastBotSource" TEXT,
      "status" TEXT NOT NULL DEFAULT 'open',
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await safeEnsureRuntimeTable(prisma, 'RagTrace', `
    CREATE TABLE IF NOT EXISTS "RagTrace" (
      "id" TEXT PRIMARY KEY,
      "chatId" TEXT,
      "question" TEXT NOT NULL,
      "normalizedQuestion" TEXT,
      "intent" TEXT,
      "source" TEXT,
      "confidenceScore" DOUBLE PRECISION,
      "confidenceTier" TEXT,
      "routeStage" TEXT,
      "selectedContextCount" INTEGER NOT NULL DEFAULT 0,
      "topSources" JSONB,
      "debug" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function buildInboundDedupeKey(event = {}) {
  const chatId = String(event.chatId || '').trim();
  const provider = String(event.provider || event.source || 'whatsapp').trim().toLowerCase();
  const messageId = String(event.messageId || event.fonnteMessageId || '').trim();
  const inboundTs = event.inboundTs || event.ts || event.timestamp || '';
  const textHash = sha256(String(event.text || event.normalizedText || '').replace(/\s+/g, ' ').trim().toLowerCase());
  if (messageId) return `${provider}:id:${messageId}`;
  return `${provider}:text:${chatId}:${String(inboundTs || '').trim()}:${textHash}`;
}

async function rememberInboundEventPersistent(prisma, event = {}) {
  if (!envFlag('PERSISTENT_INBOUND_DEDUPE', true)) return { duplicate: false, skipped: true };
  const chatId = String(event.chatId || '').trim();
  const text = String(event.text || '').trim();
  if (!prisma || !chatId || !text) return { duplicate: false, skipped: true };

  await ensureRuntimeAuditTables(prisma);
  const dedupeKey = buildInboundDedupeKey(event);
  const id = sha256(dedupeKey);
  try {
    await prisma.inboundEventDedupe.create({
      data: {
        id,
        provider: String(event.provider || event.source || 'whatsapp').slice(0, 40),
        chatId,
        messageId: event.messageId ? String(event.messageId).slice(0, 160) : null,
        dedupeKey,
        textHash: sha256(text),
        inboundTs: event.inboundTs ? new Date(event.inboundTs) : null
      }
    });
    return { duplicate: false, dedupeKey };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (err && err.code === 'P2002') return { duplicate: true, dedupeKey, reason: 'unique_dedupe_key' };
    if (/does not exist|Unknown arg|Unknown field|no such table|column .* does not exist/i.test(msg)) {
      safeWarn({ err: msg }, '[RuntimeGovernance] persistent inbound dedupe unavailable');
      return { duplicate: false, skipped: true, reason: 'schema_unavailable' };
    }
    safeWarn({ err: msg }, '[RuntimeGovernance] persistent inbound dedupe failed');
    return { duplicate: false, skipped: true, reason: 'error' };
  }
}

function detectUserFeedback(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/\b(?:jawaban|jawabannya|respon|respons|balasan)\b.*\b(?:salah|keliru|ngaco|tidak\s+sesuai|ga\s+sesuai|nggak\s+sesuai|tidak\s+nyambung|ga\s+nyambung|kurang\s+tepat)\b/i.test(t)) return 'wrong_answer';
  if (/\b(?:salah\s+jawab|jawabannya\s+salah|kurang\s+tepat|tidak\s+nyambung|ga\s+nyambung|nggak\s+nyambung)\b/i.test(t)) return 'wrong_answer';
  if (/\b(?:sudah\s+benar|jawabannya\s+benar|terjawab|sesuai)\b/i.test(t)) return 'positive';
  return null;
}

async function recordUserFeedback(prisma, payload = {}) {
  const feedbackType = payload.feedbackType || detectUserFeedback(payload.userText);
  if (!feedbackType || !prisma) return { recorded: false };
  await ensureRuntimeAuditTables(prisma);
  const id = crypto.randomUUID ? crypto.randomUUID() : sha256(`${Date.now()}:${Math.random()}`);
  const data = {
    id,
    chatId: String(payload.chatId || ''),
    feedbackType,
    userText: clamp(payload.userText, 1200),
    lastBotAnswer: payload.lastBotAnswer ? clamp(payload.lastBotAnswer, 2500) : null,
    lastBotSource: payload.lastBotSource ? clamp(payload.lastBotSource, 180) : null,
    status: feedbackType === 'positive' ? 'closed' : 'open',
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}
  };
  try {
    await prisma.userFeedback.create({ data });
    return { recorded: true, id, feedbackType };
  } catch (err) {
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to record user feedback');
    return { recorded: false, feedbackType };
  }
}


async function queueFeedbackForReview(prisma, payload = {}) {
  if (!prisma || !prisma.ragEvalItem || typeof prisma.ragEvalItem.upsert !== 'function') return { queued: false };
  const feedbackType = payload.feedbackType || detectUserFeedback(payload.userText);
  if (!feedbackType || feedbackType === 'positive') return { queued: false, skipped: true, feedbackType };
  await ensureRuntimeAuditTables(prisma);

  const rawQ = clamp(payload.question || payload.userText || 'User feedback requires review', 2000);
  const normalized = clamp(String(rawQ || '').toLowerCase().replace(/s+/g, ' ').trim(), 2000) || 'feedback-review';
  const reason = feedbackType === 'wrong_answer' ? 'feedback_wrong_answer' : `feedback_${feedbackType}`;
  const keySeed = `${payload.divisionKey || 'global'}|${reason}|${normalized}|${payload.lastBotSource || ''}`;
  const key = sha256(keySeed);
  const contexts = {
    chatId: payload.chatId || null,
    feedbackId: payload.feedbackId || null,
    feedbackType,
    userText: clamp(payload.userText, 1200),
    lastBotSource: payload.lastBotSource ? clamp(payload.lastBotSource, 180) : null,
    lastBotAnswer: payload.lastBotAnswer ? clamp(payload.lastBotAnswer, 1800) : null,
    reviewType: 'admin_review_queue'
  };

  try {
    await prisma.ragEvalItem.upsert({
      where: { key },
      create: {
        key,
        question: rawQ || keySeed,
        normalized: normalized || keySeed,
        divisionKey: payload.divisionKey || null,
        reason,
        minScore: null,
        topScore: null,
        contexts
      },
      update: {
        occurrences: { increment: 1 },
        question: rawQ || undefined,
        divisionKey: payload.divisionKey || null,
        reason,
        contexts,
        resolvedAt: null
      }
    });
    return { queued: true, reason, key };
  } catch (err) {
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to queue feedback review');
    return { queued: false, reason };
  }
}
function extractLastBotMessage(sessionData = {}) {
  const messages = Array.isArray(sessionData.messages) ? sessionData.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i] || {};
    if (String(item.direction || '').toLowerCase() === 'bot' && String(item.message || '').trim()) {
      return String(item.message || '');
    }
  }
  return sessionData.lastBotAnswer ? String(sessionData.lastBotAnswer) : '';
}

function extractLastBotSource(sessionData = {}) {
  if (sessionData.composerLastSource) return String(sessionData.composerLastSource);
  if (sessionData.composerTelemetry && sessionData.composerTelemetry.source) return String(sessionData.composerTelemetry.source);
  return '';
}

function inferMemoryTopic(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(double\s*degree|dual\s*degree|dnui|help|utb)\b/i.test(t)) return 'double_degree';
  if (/\b(pmb|pendaftaran|daftar|maba|calon\s+mahasiswa)\b/i.test(t)) return 'pmb';
  if (/\b(biaya|ukt|dpp|pembayaran|bayar|potongan)\b/i.test(t)) return 'fee';
  if (/\b(beasiswa|kip|1k1s|skss|prestasi)\b/i.test(t)) return 'scholarship';
  if (/\b(rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(t)) return 'rpl';
  if (/\b(yudisium|wisuda|sidang|skripsi|tugas\s+akhir|semester)\b/i.test(t)) return 'academic';
  if (/\b(career|karir|karier|lowongan|magang|pelatihan|pekerjaan)\b/i.test(t)) return 'career';
  if (/\b(prodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika)\b/i.test(t)) return 'program';
  return null;
}

async function updateConversationMemory(prisma, chatId, patch = {}) {
  if (!prisma || !chatId) return false;
  try {
    const session = await prisma.session.findUnique({ where: { chatId } });
    const currentState = session && session.state ? session.state : 'root';
    const prevData = session && session.data && typeof session.data === 'object' ? session.data : {};
    const nowIso = new Date().toISOString();
    const prevMemory = prevData.conversationMemory && typeof prevData.conversationMemory === 'object' ? prevData.conversationMemory : {};
    const topic = patch.topic || inferMemoryTopic(patch.userText || patch.answer || '') || prevMemory.lastTopic || null;
    const nextMemory = {
      ...prevMemory,
      lastTopic: topic,
      lastUserText: patch.userText ? clamp(patch.userText, 500) : prevMemory.lastUserText || null,
      lastAnswerPreview: patch.answer ? clamp(patch.answer, 500) : prevMemory.lastAnswerPreview || null,
      lastSource: patch.source || prevMemory.lastSource || null,
      lastConfidenceScore: typeof patch.confidenceScore === 'number' ? patch.confidenceScore : prevMemory.lastConfidenceScore || null,
      updatedAt: nowIso
    };
    await prisma.session.upsert({
      where: { chatId },
      create: { chatId, state: currentState, data: { ...prevData, conversationMemory: nextMemory } },
      update: { state: currentState, data: { ...prevData, conversationMemory: nextMemory } }
    });
    return true;
  } catch (err) {
    safeWarn({ chatId, err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to update conversation memory');
    return false;
  }
}

function buildTopSources(contexts = []) {
  return (Array.isArray(contexts) ? contexts : []).slice(0, 5).map((ctx, idx) => ({
    rank: idx + 1,
    id: ctx && (ctx.id || ctx.chunkId || ctx.sourceId || ctx.trainingId) ? String(ctx.id || ctx.chunkId || ctx.sourceId || ctx.trainingId).slice(0, 160) : null,
    source: ctx && (ctx.filename || ctx.source || ctx.sourceFile) ? String(ctx.filename || ctx.source || ctx.sourceFile).slice(0, 220) : null,
    trainingId: ctx && ctx.trainingId ? String(ctx.trainingId) : null,
    score: Number.isFinite(Number(ctx && ctx.score)) ? Number(ctx.score) : null,
    reason: ctx && ctx.reason ? String(ctx.reason).slice(0, 160) : null,
    governance: ctx && ctx.metadata && ctx.metadata.governance ? ctx.metadata.governance : (ctx && ctx.governance ? ctx.governance : null)
  }));
}

async function recordRagTrace(prisma, payload = {}) {
  if (!envFlag('RAG_TRACE_PERSIST', true)) return { recorded: false, skipped: true };
  if (!prisma || !payload.question) return { recorded: false };
  await ensureRuntimeAuditTables(prisma);
  const id = crypto.randomUUID ? crypto.randomUUID() : sha256(`${Date.now()}:${Math.random()}`);
  const data = {
    id,
    chatId: payload.chatId ? String(payload.chatId) : null,
    question: clamp(payload.question, 2000),
    normalizedQuestion: payload.normalizedQuestion ? clamp(payload.normalizedQuestion, 2000) : null,
    intent: payload.intent ? clamp(payload.intent, 120) : null,
    source: payload.source ? clamp(payload.source, 180) : null,
    confidenceScore: Number.isFinite(Number(payload.confidenceScore)) ? Number(payload.confidenceScore) : null,
    confidenceTier: payload.confidenceTier ? clamp(payload.confidenceTier, 40) : null,
    routeStage: payload.routeStage ? clamp(payload.routeStage, 160) : null,
    selectedContextCount: Array.isArray(payload.contexts) ? payload.contexts.length : 0,
    topSources: buildTopSources(payload.contexts),
    debug: payload.debug && typeof payload.debug === 'object' ? payload.debug : {}
  };
  try {
    await prisma.ragTrace.create({ data });
    return { recorded: true, id };
  } catch (err) {
    safeWarn({ err: err && err.message ? err.message : String(err) }, '[RuntimeGovernance] failed to record RAG trace');
    return { recorded: false };
  }
}

function appendRuntimeAuditJsonl(filename, payload) {
  try {
    const outDir = path.join(__dirname, '..', '..', 'tmp');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(path.join(outDir, filename), JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
  } catch (err) {
    // ignore file audit errors
  }
}

module.exports = {
  buildDocumentGovernanceMetadata,
  getTrainingGovernance,
  isTrainingGovernanceAllowed,
  filterGovernedTrainingRows,
  rememberInboundEventPersistent,
  detectUserFeedback,
  recordUserFeedback,
  queueFeedbackForReview,
  extractLastBotMessage,
  extractLastBotSource,
  updateConversationMemory,
  recordRagTrace,
  appendRuntimeAuditJsonl,
  buildTopSources
};
