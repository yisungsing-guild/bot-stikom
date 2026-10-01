'use strict';

/**
 * src/engine/shadowIntegration.js
 *
 * Phase 4A — Controlled Shadow Integration & Security Hardening.
 * Connects organic query execution to Plan-Driven Retrieval in SHADOW-ONLY mode.
 *
 * Core Architecture & Security Invariants:
 * 1. STRICT PRODUCTION GATE (FAIL-CLOSED, NO OPTIONS BYPASS):
 *    observePlanDrivenShadow checks PLAN_DRIVEN_SHADOW_ENABLED environment variable ONLY.
 *    Caller options CANNOT bypass or enable the production gate.
 * 2. KEYED HMAC PRIVACY (NO HARDCODED SALTS):
 *    Pseudonymization uses HMAC-SHA256 with pepper key from PLAN_DRIVEN_SHADOW_PRIVACY_SECRET.
 *    If privacy secret is absent when shadow is enabled, execution FAILS CLOSED.
 *    Security model: HMAC-based one-way pseudonymization; strength relies on secret confidentiality.
 * 3. KEYED QUERY & ANSWER HASHING:
 *    Queries and answers are hashed with HMAC-SHA256 using the same privacy secret,
 *    preventing dictionary/rainbow table attacks against normalized terms.
 * 4. STRICT ALLOWLIST TELEMETRY SERIALIZER (ZERO PII):
 *    Telemetries pass through an explicit allowlist serializer.
 *    Never logs raw queries, phone numbers, WhatsApp IDs, full answers, or document chunks.
 * 5. CONCURRENCY & EVENT-LOOP SAFETY:
 *    Shadow execution is non-blocking with respect to the awaited user response,
 *    but consumes background CPU/event-loop resources. Concurrency is strictly bounded
 *    (MAX_CONCURRENT_SHADOW_JOBS) to prevent event-loop starvation.
 * 6. ZERO BUSINESS HARDCODING:
 *    No business facts, no exact answers, no document/filename exception tables.
 */

const crypto = require('crypto');
const { resolveEffectiveSemanticFrame } = require('./semanticFrameResolver');
const { buildRetrievalPlanFromSemanticFrame } = require('./resolvedRetrievalPlan');
const {
  selectRetrievalStrategy,
  evaluateRetrievalEvidence,
  LegacyLexicalStrategy,
  invalidateRetrievalStrategyCache
} = require('./retrievalStrategy');
const { isChunkGovernanceAllowed } = require('./runtimeGovernance');

let logger = null;
try {
  logger = require('../logger');
} catch (_) {}

/**
 * 10 Canonical Disagreement Classes (Phase 4A)
 */
const SHADOW_DISAGREEMENT_CLASSES = Object.freeze({
  NO_MATERIAL_DIFFERENCE: 'NO_MATERIAL_DIFFERENCE',
  SHADOW_MORE_GROUNDED: 'SHADOW_MORE_GROUNDED',
  LEGACY_MORE_GROUNDED: 'LEGACY_MORE_GROUNDED',
  RETRIEVAL_DISAGREEMENT: 'RETRIEVAL_DISAGREEMENT',
  SEMANTIC_DISAGREEMENT: 'SEMANTIC_DISAGREEMENT',
  GOVERNANCE_DISAGREEMENT: 'GOVERNANCE_DISAGREEMENT',
  AUTHORITY_DISAGREEMENT: 'AUTHORITY_DISAGREEMENT',
  ANSWERABILITY_DISAGREEMENT: 'ANSWERABILITY_DISAGREEMENT',
  SHADOW_ERROR: 'SHADOW_ERROR',
  LEGACY_ERROR: 'LEGACY_ERROR'
});

/**
 * Production Gate Check: ENV ONLY.
 * Options CANNOT bypass this in production.
 */
function isPlanDrivenShadowEnabledFromEnv() {
  return String(process.env.PLAN_DRIVEN_SHADOW_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Privacy Secret Retrieval.
 * Must be at least 8 characters. Defaults to fail-closed null if missing.
 */
function getPrivacySecretFromEnv() {
  const s = process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;
  if (typeof s === 'string' && s.trim().length >= 8) {
    return s.trim();
  }
  return null;
}

function getPrivacySecret(options = {}) {
  // Test-only dependency injection hook (strictly ignored in production observer)
  if (options && typeof options.__testPrivacySecret === 'string' && options.__testPrivacySecret.trim().length >= 8) {
    return options.__testPrivacySecret.trim();
  }
  return getPrivacySecretFromEnv();
}

/**
 * Keyed HMAC Helper for Privacy-Safe Identifiers
 * HMAC-based one-way pseudonymization (security relies on secret secrecy)
 */
function createPrivacyHash(value, secret, length = 16) {
  if (!secret) return null;
  const norm = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHmac('sha256', secret).update(norm).digest('hex').slice(0, length);
}
const createPrivacyHmac = createPrivacyHash;

/**
 * Concurrency Limiter: Strict in-process backpressure
 */
const MAX_CONCURRENT_SHADOW_JOBS = 2;
let activeShadowJobs = 0;

function getActiveShadowJobs() {
  return activeShadowJobs;
}

function resetActiveShadowJobs() {
  activeShadowJobs = 0;
}

/**
 * Telemetry sink management
 */
let customTelemetrySink = null;

function setShadowTelemetrySink(fn) {
  customTelemetrySink = typeof fn === 'function' ? fn : null;
}

function getShadowTelemetrySink() {
  return customTelemetrySink;
}

/**
 * Explicit Allowlist Telemetry Serializer
 */
const ALLOWED_TELEMETRY_KEYS = Object.freeze([
  'correlationId',
  'queryHash',
  'organicShadowEligible',
  'semanticFrameResolved',
  'retrievalPlanResolved',
  'shadowStrategy',
  'shadowCandidateCount',
  'shadowSelectedCount',
  'shadowAnswerable',
  'legacyAnswerable',
  'comparisonClass',
  'potentialRetrievalDefect',
  'potentialSemanticDefect',
  'potentialGovernanceDefect',
  'shadowError',
  'shadowLatencyMs',
  'errorType'
]);

function serializeTelemetry(rawRecord) {
  if (!rawRecord || typeof rawRecord !== 'object') return {};
  const sanitized = {};
  for (const key of ALLOWED_TELEMETRY_KEYS) {
    if (rawRecord[key] !== undefined) {
      sanitized[key] = rawRecord[key];
    }
  }
  return Object.freeze(sanitized);
}

function sanitizeErrorType(errName) {
  if (!errName) return 'UNKNOWN_ERROR';
  const str = String(errName).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
  return str || 'ERROR';
}

function emitShadowTelemetry(rawRecord) {
  const record = serializeTelemetry(rawRecord);
  if (typeof customTelemetrySink === 'function') {
    try {
      customTelemetrySink(record);
    } catch (_) {}
  }
  if (logger && typeof logger.info === 'function') {
    try {
      logger.info(record, '[PLAN_DRIVEN_SHADOW] Telemetry');
    } catch (_) {}
  }
}

/**
 * Deterministic sampling helper (no Math.random, clamped [0, 1])
 */
function getShadowSampleRate(options = {}) {
  const val = options.shadowSampleRate !== undefined
    ? Number(options.shadowSampleRate)
    : (process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE !== undefined
        ? Number(process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE)
        : 1.0);
  return Number.isFinite(val) ? Math.max(0.0, Math.min(1.0, val)) : 1.0;
}

function isShadowSampled(pseudonymousId, sampleRate = 1.0) {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  let hash = 0;
  const s = String(pseudonymousId || 'anon');
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  const normalized = (Math.abs(hash) % 10000) / 10000;
  return normalized < sampleRate;
}

/**
 * Latency metrics accumulator (strictly bounded in-memory sliding window)
 */
const MAX_LATENCY_HISTORY = 500;
const latencyHistory = [];

function recordShadowLatency(ms) {
  if (typeof ms === 'number' && Number.isFinite(ms)) {
    if (latencyHistory.length >= MAX_LATENCY_HISTORY) {
      latencyHistory.shift();
    }
    latencyHistory.push(ms);
  }
}

function getShadowLatencyMetrics() {
  if (!latencyHistory.length) {
    return { p50: 0, p95: 0, p99: 0, count: 0 };
  }
  const sorted = [...latencyHistory].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { p50, p95, p99, count: sorted.length };
}

function resetShadowLatencyMetrics() {
  latencyHistory.length = 0;
}

/**
 * Extract canonical legacy result summary (Privacy-safe: no raw text stored)
 */
function extractLegacyResultSummary(result, secret) {
  if (!result || typeof result !== 'object') {
    return {
      answerable: false,
      source: 'none',
      evidenceIds: [],
      answerHash: ''
    };
  }

  const answer = String(result.answer || '').trim();
  const source = String(result.source || 'unknown');
  const isFallback = Boolean(result.isFallback);
  const isDataGap = Boolean(
    result.dataGap ||
    /out-of-scope|no-data|data-gap|unsupported/i.test(source) ||
    (/belum\s+tersedia|tidak\s+ditemukan|belum\s+ada\s+informasi/i.test(answer) && answer.length < 150)
  );

  const answerable = Boolean(answer && !isFallback && !isDataGap);

  const evidenceIds = [];
  const rawEv = Array.isArray(result.contexts)
    ? result.contexts
    : (Array.isArray(result.candidates) ? result.candidates : []);

  for (const item of rawEv) {
    const id = item?.id || item?.documentId || item?.file || item?.sourceFile || item?.metadata?.sourceFile || null;
    if (id && !evidenceIds.includes(String(id))) {
      evidenceIds.push(String(id));
    }
  }

  return {
    answerable,
    source,
    evidenceIds,
    answerHash: secret ? createPrivacyHmac(answer, secret, 16) : ''
  };
}

/**
 * Strip document text from candidate evidence for audit safety (Zero Document Leakage)
 */
function sanitizeEvidenceForAudit(ev) {
  if (!ev || typeof ev !== 'object') return {};
  return Object.freeze({
    id: ev.id ? String(ev.id).slice(0, 50) : null,
    sourceFile: ev.sourceFile || ev.file || ev.metadata?.sourceFile ? String(ev.sourceFile || ev.file || ev.metadata?.sourceFile).slice(0, 80) : null,
    documentId: ev.documentId || ev.id ? String(ev.documentId || ev.id).slice(0, 50) : null,
    authorityTier: Number.isFinite(ev.authorityTier || ev.metadata?.authorityTier) ? Number(ev.authorityTier || ev.metadata?.authorityTier) : null,
    governanceStatus: ev.governanceStatus || ev.status ? String(ev.governanceStatus || ev.status).slice(0, 20) : null,
    compatibilityScore: typeof ev.compatibilityScore === 'number' ? Number(ev.compatibilityScore.toFixed(4)) : null
  });
}

function extractCandidateEvidenceId(item) {
  if (!item || typeof item !== 'object') return null;
  return item.id || item.documentId || item.sourceFile || item.file || item.metadata?.sourceFile || null;
}

/**
 * Disagreement & Defect Classifier
 */
function classifyShadowComparison({
  rawQuery,
  semanticFrame,
  retrievalPlan,
  legacySummary,
  shadowResult,
  error
}) {
  if (error && error.shadowError) {
    return {
      semanticAgreement: false,
      evidenceOverlap: 0,
      authorityAgreement: false,
      governanceAgreement: false,
      answerabilityAgreement: false,
      legacyOnly: false,
      shadowOnly: false,
      potentialRetrievalDefect: false,
      potentialSemanticDefect: false,
      potentialGovernanceDefect: false,
      potentialGroundingDefect: false,
      comparisonClass: SHADOW_DISAGREEMENT_CLASSES.SHADOW_ERROR
    };
  }

  if (!legacySummary || (!legacySummary.answerable && !legacySummary.source)) {
    return {
      semanticAgreement: false,
      evidenceOverlap: 0,
      authorityAgreement: false,
      governanceAgreement: false,
      answerabilityAgreement: false,
      legacyOnly: false,
      shadowOnly: false,
      potentialRetrievalDefect: false,
      potentialSemanticDefect: false,
      potentialGovernanceDefect: false,
      potentialGroundingDefect: false,
      comparisonClass: SHADOW_DISAGREEMENT_CLASSES.LEGACY_ERROR
    };
  }

  // 1. Evidence overlap (Jaccard similarity on identifiers)
  const legacySet = new Set(legacySummary.evidenceIds || []);
  const shadowSet = new Set(shadowResult?.evidenceIds || []);
  let intersectionCount = 0;
  for (const id of shadowSet) {
    if (legacySet.has(id)) intersectionCount++;
  }
  const unionCount = new Set([...legacySet, ...shadowSet]).size;
  const evidenceOverlap = unionCount === 0 ? 1.0 : Number((intersectionCount / unionCount).toFixed(4));

  // 2. Semantic Agreement & Defect Detection
  let semanticAgreement = true;
  let potentialSemanticDefect = false;
  if (semanticFrame) {
    const qLower = String(rawQuery || '').toLowerCase();
    const frameDomain = String(semanticFrame.domain?.primary || semanticFrame.domain || '').toLowerCase();
    const frameEntities = Array.isArray(semanticFrame.entities)
      ? semanticFrame.entities.map(e => String(e.canonical || e || '').toLowerCase())
      : [];

    if (/\b(?:s2|magister)\b/i.test(qLower) && frameDomain !== 's2_postgraduate' && !frameEntities.some(e => /s2|magister/i.test(e))) {
      potentialSemanticDefect = true;
      semanticAgreement = false;
    }
    if (/\b(?:yudisium)\b/i.test(qLower) && !frameEntities.some(e => /yudisium/i.test(e))) {
      potentialSemanticDefect = true;
      semanticAgreement = false;
    }
    if (/\b(?:biaya|uang|tarif)\b/i.test(qLower) && !semanticFrame.requestedFields?.some(f => /fee|biaya|amount/i.test(f))) {
      potentialSemanticDefect = true;
      semanticAgreement = false;
    }
    if (/\b(?:online|offline|daring|luring)\b/i.test(qLower) && !semanticFrame.requestedFields?.some(f => /deliveryMode|modality/i.test(f))) {
      potentialSemanticDefect = true;
      semanticAgreement = false;
    }
  }

  // 3. Governance Agreement & Defect Detection
  let governanceAgreement = true;
  let potentialGovernanceDefect = false;
  const isHistoricalQuery = Boolean(retrievalPlan?.temporalScope?.allowHistorical);

  if (!isHistoricalQuery && Array.isArray(legacySummary.evidenceIds)) {
    const legacyEvidenceItems = Array.isArray(legacySummary.rawEvidence) ? legacySummary.rawEvidence : [];
    for (const ev of legacyEvidenceItems) {
      if (ev && (ev.governanceStatus === 'expired' || ev.status === 'expired' || ev.isExpired === true)) {
        potentialGovernanceDefect = true;
        governanceAgreement = false;
        break;
      }
    }
  }

  // 4. Authority Agreement
  let authorityAgreement = true;
  if (retrievalPlan?.authorityRequirements?.minAuthorityTier === 'OFFICIAL_REGULATION') {
    if (legacySummary.source === 'semantic-rag-small-talk' && shadowResult?.answerable) {
      authorityAgreement = false;
    }
  }

  // 5. Answerability Agreement
  const answerabilityAgreement = legacySummary.answerable === shadowResult?.answerable;
  const legacyOnly = legacySummary.answerable && !shadowResult?.answerable;
  const shadowOnly = !legacySummary.answerable && Boolean(shadowResult?.answerable);

  // 6. Retrieval Defect Rule:
  // Knowledge available + legacy safe data gap / unanswerable + shadow retrieved valid evidence -> POTENTIAL_RETRIEVAL_DEFECT
  let potentialRetrievalDefect = false;
  if (shadowOnly && shadowResult?.answerable && shadowResult?.candidateCount > 0) {
    potentialRetrievalDefect = true;
  }

  // 7. Grounding Defect
  const potentialGroundingDefect = Boolean(
    (shadowResult?.answerable && (!shadowResult.selectedEvidence || shadowResult.selectedEvidence.length === 0)) ||
    (legacySummary.answerable && (!legacySummary.evidenceIds || legacySummary.evidenceIds.length === 0) && legacySummary.source !== 'semantic-rag-small-talk')
  );

  // 8. Canonical Disagreement Classification
  let comparisonClass = SHADOW_DISAGREEMENT_CLASSES.NO_MATERIAL_DIFFERENCE;

  if (potentialGovernanceDefect || !governanceAgreement) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.GOVERNANCE_DISAGREEMENT;
  } else if (potentialSemanticDefect || !semanticAgreement) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.SEMANTIC_DISAGREEMENT;
  } else if (!authorityAgreement) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.AUTHORITY_DISAGREEMENT;
  } else if (potentialRetrievalDefect || (shadowOnly && shadowResult?.answerable)) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.SHADOW_MORE_GROUNDED;
  } else if (legacyOnly) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.LEGACY_MORE_GROUNDED;
  } else if (!answerabilityAgreement) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.ANSWERABILITY_DISAGREEMENT;
  } else if (evidenceOverlap < 0.3 && (legacySummary.answerable || shadowResult?.answerable)) {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.RETRIEVAL_DISAGREEMENT;
  } else {
    comparisonClass = SHADOW_DISAGREEMENT_CLASSES.NO_MATERIAL_DIFFERENCE;
  }

  return {
    semanticAgreement,
    evidenceOverlap,
    authorityAgreement,
    governanceAgreement,
    answerabilityAgreement,
    legacyOnly,
    shadowOnly,
    potentialRetrievalDefect,
    potentialSemanticDefect,
    potentialGovernanceDefect,
    potentialGroundingDefect,
    comparisonClass
  };
}

/**
 * Execute Plan-Driven Shadow Pipeline in isolation
 */
async function runShadowEvaluation(rawQuery, legacyResult, options = {}) {
  const queryStart = Date.now();

  // Gate 1: Fail-Closed Feature Gate (ENV or explicit unit test direct execution flag)
  const isEnabled = isPlanDrivenShadowEnabledFromEnv() || Boolean(options && options.__testDirectExecution);
  if (!isEnabled) {
    return {
      enabled: false,
      executed: false,
      reason: 'feature_disabled',
      error: null
    };
  }

  // Gate 2: Privacy Secret Verification (FAIL-CLOSED if secret missing)
  const secret = getPrivacySecret(options);
  if (!secret) {
    return {
      enabled: true,
      executed: false,
      reason: 'privacy_config_missing',
      error: {
        shadowError: true,
        errorType: 'PRIVACY_CONFIG_MISSING'
      }
    };
  }

  // Derive pseudonymous identifiers using HMAC-SHA256 (Zero plaintext storage)
  const rawId = options.chatId
    || (options.sessionData && options.sessionData.chatId)
    || (options.session && options.session.chatId)
    || 'anonymous';
  const correlationId = createPrivacyHmac(rawId, secret, 16);
  const queryHash = createPrivacyHmac(rawQuery, secret, 16);
  const queryId = options.traceId || options.requestId || `q_${queryHash}`;

  // Gate 3: Deterministic Sampling (Derived strictly from HMAC-pseudonymized correlation identity)
  const sampleRate = getShadowSampleRate(options);
  const isEligible = isShadowSampled(correlationId, sampleRate);
  if (!isEligible) {
    return {
      enabled: true,
      executed: false,
      sampled: false,
      correlationId,
      queryHash,
      reason: 'not_sampled',
      error: null
    };
  }

  let semanticFrame = null;
  let retrievalPlan = null;
  let shadowResult = null;
  let errorObj = null;

  let semanticFrameMs = 0;
  let retrievalPlanMs = 0;
  let strategyMs = 0;
  let evidenceEvaluationMs = 0;

  try {
    const priorState = options.conversationState
      || options.sessionState
      || (options.sessionData && (options.sessionData.sessionState || options.sessionData.conversationState || options.sessionData.state))
      || null;

    // 1. SemanticFrame
    const t0 = Date.now();
    const frameOptions = {
      ...options,
      sessionState: priorState || options.sessionState,
      conversationState: priorState || options.conversationState
    };
    semanticFrame = resolveEffectiveSemanticFrame(rawQuery, frameOptions);
    semanticFrameMs = Date.now() - t0;

    // 2. RetrievalPlan
    const t1 = Date.now();
    retrievalPlan = buildRetrievalPlanFromSemanticFrame(semanticFrame, options);
    retrievalPlanMs = Date.now() - t1;

    // 3. Strategy & Candidate Retrieval
    const t2 = Date.now();
    const strategy = selectRetrievalStrategy(retrievalPlan, options);
    let retrievalResult = await strategy.retrieve(retrievalPlan, options);
    if ((!retrievalResult.candidates || retrievalResult.candidates.length === 0) && strategy.name !== 'LEGACY_LEXICAL') {
      const fallbackStrategy = new LegacyLexicalStrategy();
      retrievalResult = await fallbackStrategy.retrieve(retrievalPlan, options);
    }
    strategyMs = Date.now() - t2;

    // 4. Evidence Evaluation
    const t3 = Date.now();
    const evidenceEvaluation = evaluateRetrievalEvidence(retrievalResult.candidates, retrievalPlan);
    evidenceEvaluationMs = Date.now() - t3;

    // Sanitize evidence items (strip full texts/chunks for privacy audit)
    const sanitizedSelectedEvidence = (evidenceEvaluation.selectedEvidence || []).map(sanitizeEvidenceForAudit);

    shadowResult = {
      strategy: strategy.name,
      answerable: Boolean(evidenceEvaluation && evidenceEvaluation.answerable),
      candidateCount: Array.isArray(retrievalResult.candidates) ? retrievalResult.candidates.length : 0,
      selectedEvidence: sanitizedSelectedEvidence,
      evidenceIds: (evidenceEvaluation.selectedEvidence || []).map(extractCandidateEvidenceId).filter(Boolean),
      policy: evidenceEvaluation.policy || retrievalPlan.fallbackPolicy || 'safe_data_gap'
    };
  } catch (err) {
    errorObj = {
      shadowError: true,
      errorType: sanitizeErrorType(err?.name),
      message: 'shadow_processing_error'
    };
    shadowResult = {
      strategy: 'ERROR',
      answerable: false,
      candidateCount: 0,
      selectedEvidence: [],
      evidenceIds: [],
      policy: 'shadow_error'
    };
  }

  const totalShadowMs = Date.now() - queryStart;
  recordShadowLatency(totalShadowMs);

  const legacySummary = extractLegacyResultSummary(legacyResult, secret);

  const comparison = classifyShadowComparison({
    rawQuery,
    semanticFrame,
    retrievalPlan,
    legacySummary,
    shadowResult,
    error: errorObj
  });

  const contract = {
    enabled: true,
    executed: true,
    correlationId,
    queryHash,
    queryId,
    semanticFrame,
    retrievalPlan,
    legacyResult: legacySummary,
    shadowResult,
    comparison,
    latency: {
      semanticFrameMs,
      retrievalPlanMs,
      strategyMs,
      evidenceEvaluationMs,
      totalShadowMs
    },
    error: errorObj
  };

  // Telemetry Emission: Strictly privacy-safe through allowlist serializer
  emitShadowTelemetry({
    correlationId,
    queryHash,
    organicShadowEligible: true,
    semanticFrameResolved: Boolean(semanticFrame),
    retrievalPlanResolved: Boolean(retrievalPlan),
    shadowStrategy: shadowResult.strategy,
    shadowCandidateCount: shadowResult.candidateCount,
    shadowSelectedCount: (shadowResult.selectedEvidence || []).length,
    shadowAnswerable: shadowResult.answerable,
    legacyAnswerable: legacySummary.answerable,
    comparisonClass: comparison.comparisonClass,
    potentialRetrievalDefect: comparison.potentialRetrievalDefect,
    potentialSemanticDefect: comparison.potentialSemanticDefect,
    potentialGovernanceDefect: comparison.potentialGovernanceDefect,
    shadowError: Boolean(errorObj?.shadowError),
    errorType: errorObj ? errorObj.errorType : undefined,
    shadowLatencyMs: totalShadowMs
  });

  return contract;
}

/**
 * Safe Hook to observe shadow retrieval from production pipeline.
 * - Respects fail-closed feature gate PLAN_DRIVEN_SHADOW_ENABLED (ENV ONLY)
 * - Fails closed if PLAN_DRIVEN_SHADOW_PRIVACY_SECRET is missing
 * - Enforces bounded concurrency (MAX_CONCURRENT_SHADOW_JOBS)
 * - In production, fires asynchronously via setImmediate without blocking
 */
function observePlanDrivenShadow(question, legacyResult, options = {}) {
  // CRITICAL GATE 1: Production observer checks ENV ONLY. Options cannot bypass this.
  if (!isPlanDrivenShadowEnabledFromEnv()) {
    return null;
  }

  // CRITICAL GATE 2: Secret must be available in ENV. Fail-closed if missing.
  const secret = getPrivacySecretFromEnv();
  if (!secret) {
    return null;
  }

  // CRITICAL GATE 3: Deterministic Sampling. Fail-closed if not sampled.
  const rawId = options.chatId
    || (options.sessionData && options.sessionData.chatId)
    || (options.session && options.session.chatId)
    || 'anonymous';
  const correlationId = createPrivacyHash(rawId, secret, 16);
  const sampleRate = getShadowSampleRate(options);
  if (!isShadowSampled(correlationId, sampleRate)) {
    return null;
  }

  // If sync requested in test mode (only if ENV is enabled, secret present, and sampled)
  if (options && options.__syncShadow) {
    return runShadowEvaluation(question, legacyResult, options);
  }

  // CRITICAL GATE 4: Concurrency limit (bounded backpressure)
  if (activeShadowJobs >= MAX_CONCURRENT_SHADOW_JOBS) {
    return null;
  }

  activeShadowJobs++;
  setImmediate(async () => {
    try {
      await runShadowEvaluation(question, legacyResult, options);
    } catch (err) {
      try {
        emitShadowTelemetry({
          correlationId: 'error_correl',
          queryHash: 'error_query',
          organicShadowEligible: true,
          shadowError: true,
          errorType: sanitizeErrorType(err?.name)
        });
      } catch (_) {}
    } finally {
      activeShadowJobs = Math.max(0, activeShadowJobs - 1);
    }
  });

  return null;
}

module.exports = {
  SHADOW_DISAGREEMENT_CLASSES,
  isPlanDrivenShadowEnabledFromEnv,
  getPrivacySecret,
  getPrivacySecretFromEnv,
  createPrivacyHash,
  createPrivacyHmac,
  getActiveShadowJobs,
  resetActiveShadowJobs,
  setShadowTelemetrySink,
  getShadowTelemetrySink,
  emitShadowTelemetry,
  serializeTelemetry,
  getShadowSampleRate,
  isShadowSampled,
  recordShadowLatency,
  getShadowLatencyMetrics,
  resetShadowLatencyMetrics,
  extractLegacyResultSummary,
  sanitizeEvidenceForAudit,
  classifyShadowComparison,
  runShadowEvaluation,
  observePlanDrivenShadow,
  invalidateRetrievalStrategyCache
};
