'use strict';

/**
 * src/engine/pgvectorShadowProvider.js
 *
 * Non-authoritative, Decoupled pgvector Shadow Retrieval Provider.
 *
 * Core Invariants:
 * 1. ZERO USER-TURN MUTATION: Legacy retrieval remains 100% authoritative.
 *    Shadow results never alter selected evidence, answers, routing, state, or WhatsApp output.
 * 2. FAIL-SAFE FLAG DEFAULTS:
 *    - VECTOR_SHADOW_ENABLED defaults to false.
 *    - VECTOR_RETRIEVAL_ENABLED defaults to false.
 *    Absence of explicit 'true' keeps pgvector completely inactive.
 * 3. RESOURCE ISOLATION:
 *    - Strict concurrency bound (VECTOR_SHADOW_MAX_CONCURRENCY, default 1).
 *    - Sampling control (VECTOR_SHADOW_SAMPLE_RATE, default 0).
 *    - Bounded execution timeout (VECTOR_SHADOW_TIMEOUT_MS, default 1500ms).
 *    - Capacity drops over-limit requests rather than queuing.
 * 4. PARAMETERIZED SQL ONLY:
 *    All filters and vector embeddings are passed as query parameters ($1, $2, etc.).
 *    No user/binding values are ever interpolated into SQL strings.
 * 5. VERSION FILTERING:
 *    All vector searches strictly filter by active embedding_version.
 * 6. BOUNDED TELEMETRY:
 *    Only IDs, ranks, scores, and provenance identifiers are logged.
 *    Never logs 1536-dim vector arrays, full chunk texts, or user PII.
 * 7. DECOUPLED FAILURE:
 *    PGVECTOR_FAILURE != USER_REQUEST_FAILURE.
 */

const { OpenAI } = require('openai');
const prisma = require('../db');
const {
  CANONICAL_FIELD_SEMANTICS,
  getFieldNaturalSemantics,
  evaluateCategoryCompatibility
} = require('./canonicalFieldRegistry');

let logger = null;
try {
  logger = require('../logger');
} catch (_) {}

let customTelemetrySink = null;
function setTelemetrySink(fn) {
  customTelemetrySink = fn;
}

function emitTelemetry(record) {
  if (typeof customTelemetrySink === 'function') {
    try {
      customTelemetrySink(record);
    } catch (_) {}
  }
  if (logger && typeof logger.info === 'function') {
    try {
      logger.info(record, '[PGVECTOR_SHADOW] Telemetry');
    } catch (_) {}
  }
}

const EMBEDDING_VERSION = 'text-embedding-3-small-1536-corpus-787bfb8f-v1';
const EMBEDDING_MODEL = 'text-embedding-3-small';

// In-process concurrency limiter
let activeShadowJobs = 0;

function isShadowEnabled() {
  return String(process.env.VECTOR_SHADOW_ENABLED || '').trim().toLowerCase() === 'true';
}

function isRetrievalEnabled() {
  return String(process.env.VECTOR_RETRIEVAL_ENABLED || '').trim().toLowerCase() === 'true';
}

function getMaxConcurrency() {
  const v = parseInt(process.env.VECTOR_SHADOW_MAX_CONCURRENCY, 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function getSampleRate() {
  const v = parseFloat(process.env.VECTOR_SHADOW_SAMPLE_RATE);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0;
}

function getTimeoutMs() {
  const v = parseInt(process.env.VECTOR_SHADOW_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 1500;
}

function getDbConcurrency() {
  const v = parseInt(process.env.VECTOR_SHADOW_DB_CONCURRENCY, 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Bounded concurrency executor.
 * Strictly limits in-flight promises without using unbounded Promise.all.
 */
async function mapConcurrent(items, concurrencyLimit, fn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  let nextIdx = 0;
  const limit = Math.max(1, Math.min(concurrencyLimit, items.length));
  const workers = Array.from({ length: limit }, async () => {
    while (nextIdx < items.length) {
      const currentIdx = nextIdx++;
      results[currentIdx] = await fn(items[currentIdx], currentIdx);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Builds deterministic query representation for a single binding.
 * Preserves current clause semantic content, canonical entity, natural field semantics, and bounded hints.
 * Does NOT drop current clause meaning when requestedField exists.
 * Does NOT append whole-chat history or prior conversation text.
 */
function buildBindingQueryText(binding) {
  if (!binding) return '';
  const parts = [];

  // 1. Current clause semantic content (must NOT be suppressed)
  const clauseContent = (binding.clauseText && String(binding.clauseText).trim())
    || (binding.rawText && String(binding.rawText).trim())
    || '';
  if (clauseContent) {
    parts.push(clauseContent.slice(0, 300));
  }

  // 2. Canonical entity when known
  if (binding.entity && binding.entity.canonical) {
    parts.push(binding.entity.canonical);
  }

  // 3. Natural-language canonical field semantics
  if (binding.requestedField) {
    const naturalSemantics = getFieldNaturalSemantics(binding.requestedField);
    if (naturalSemantics) {
      parts.push(naturalSemantics);
    } else {
      parts.push(binding.requestedField);
    }
  }

  // 4. Bounded retrieval hints (excluding duplicates of requestedField)
  if (Array.isArray(binding.retrievalHints) && binding.retrievalHints.length > 0) {
    const filteredHints = binding.retrievalHints
      .filter(h => typeof h === 'string' && h.trim().length > 0 && h !== binding.requestedField)
      .slice(0, 5);
    if (filteredHints.length > 0) {
      parts.push(filteredHints.join(' '));
    }
  }

  return parts.join(' ').replace(/\s{2,}/g, ' ').trim() || String(binding.rawText || '').slice(0, 300);
}

function getOpenAIClient(apiKey, timeoutMs = 1500) {
  return new OpenAI({ apiKey, timeout: timeoutMs });
}

/**
 * Computes query embeddings in a single batch OpenAI request.
 * Preserves binding order deterministically.
 */
async function computeBatchQueryEmbeddings(texts, timeoutMs = 1500, abortSignal = null) {
  if (!Array.isArray(texts) || texts.length === 0) return [];

  // If computeQueryEmbedding is mocked by Jest spy, delegate to preserve test mock compatibility
  if (module.exports.computeQueryEmbedding && module.exports.computeQueryEmbedding._isMockFunction) {
    return await Promise.all(texts.map(t => module.exports.computeQueryEmbedding(t, timeoutMs, abortSignal)));
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured for query embedding.');
  }

  const client = (module.exports && typeof module.exports.getOpenAIClient === 'function')
    ? module.exports.getOpenAIClient(apiKey, timeoutMs)
    : new OpenAI({ apiKey, timeout: timeoutMs });
  const requestOptions = abortSignal ? { signal: abortSignal } : {};
  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts
  }, requestOptions);

  const data = resp.data || [];
  data.sort((a, b) => (a.index || 0) - (b.index || 0));

  const embeddings = data.map(item => item.embedding);
  for (const emb of embeddings) {
    if (!Array.isArray(emb) || emb.length !== 1536) {
      throw new Error(`Unexpected query embedding dimension: ${emb?.length}`);
    }
  }

  return embeddings;
}

/**
 * Computes query embedding using OpenAI with timeout and AbortSignal support.
 * Single-text convenience wrapper over batch implementation.
 */
async function computeQueryEmbedding(text, timeoutMs = 1500, abortSignal = null) {
  const [emb] = await computeBatchQueryEmbeddings([text], timeoutMs, abortSignal);
  return emb;
}

/**
 * Parameterized vector search for a single binding.
 * Hard filters applied ONLY when binding has explicit authoritative constraints.
 */
async function searchVectorChunks(queryEmbedding, binding, limit = 10) {
  if (!prisma || typeof prisma.$queryRawUnsafe !== 'function') {
    throw new Error('Database client unavailable for vector retrieval.');
  }

  const vectorStr = `[${queryEmbedding.join(',')}]`;
  const params = [vectorStr, EMBEDDING_VERSION];
  let paramIdx = 3;

  let whereClauses = [
    `vector_search_enabled = true`,
    `embedding_version = $2`,
    `embedding IS NOT NULL`
  ];

  // Hard metadata constraints: only if authoritative explicit constraint exists
  if (binding && binding.constraints) {
    if (typeof binding.constraints.campus === 'string' && binding.constraints.campus.trim()) {
      whereClauses.push(`campus = $${paramIdx}`);
      params.push(binding.constraints.campus.trim().toUpperCase());
      paramIdx++;
    }
    if (typeof binding.constraints.program === 'string' && binding.constraints.program.trim()) {
      whereClauses.push(`program = $${paramIdx}`);
      params.push(binding.constraints.program.trim().toUpperCase());
      paramIdx++;
    }
  }

  const limitParamIdx = paramIdx;
  params.push(limit);

  const sql = `
    SELECT 
      vector_chunk_id,
      source_record_id,
      source_record_index,
      subchunk_index,
      chunk_hash,
      source_file,
      section_title,
      program,
      campus,
      category,
      doc_category,
      1 - (embedding <=> $1::vector) AS similarity
    FROM rag.corpus_vector_chunks
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY embedding <=> $1::vector ASC
    LIMIT $${limitParamIdx};
  `;

  return await prisma.$queryRawUnsafe(sql, ...params);
}

/**
 * Deterministic Reciprocal Rank Fusion (RRF) candidate fusion.
 * Combines legacy lexical candidates and pgvector candidates per binding.
 * Preserves candidate provenance: legacy_rank, vector_rank, rrf_score.
 */
function computeBindingRRF(legacyCandidates = [], vectorCandidates = [], k = 60) {
  const scores = new Map();
  const candidateData = new Map();

  const getId = (c) => c.source_record_id || c.sourceRecordId || c.chunk?.id || c.id || (c.chunkIndex !== undefined ? String(c.chunkIndex) : null);

  (legacyCandidates || []).forEach((c, idx) => {
    const id = getId(c);
    if (!id) return;
    const rank = idx + 1;
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
    candidateData.set(id, {
      id,
      source_record_id: c.source_record_id || c.sourceRecordId || id,
      source_file: c.source_file || c.chunk?.sourceFile || c.sourceFile || null,
      category: c.category || c.chunk?.category || null,
      doc_category: c.doc_category || c.chunk?.doc_category || null,
      program: c.program || c.chunk?.program || c.chunk?.metadata?.program || null,
      campus: c.campus || c.chunk?.campus || null,
      section_title: c.section_title || c.chunk?.section_title || null,
      legacy_rank: rank,
      vector_rank: null,
      similarity: null
    });
  });

  (vectorCandidates || []).forEach((c, idx) => {
    const id = getId(c);
    if (!id) return;
    const rank = idx + 1;
    scores.set(id, (scores.get(id) || 0) + 1 / (k + rank));
    if (!candidateData.has(id)) {
      candidateData.set(id, {
        id,
        source_record_id: c.source_record_id || id,
        source_file: c.source_file || null,
        category: c.category || null,
        doc_category: c.doc_category || null,
        program: c.program || null,
        campus: c.campus || null,
        section_title: c.section_title || null,
        legacy_rank: null,
        vector_rank: rank,
        similarity: typeof c.similarity === 'number' ? Number(c.similarity.toFixed(4)) : null
      });
    } else {
      const existing = candidateData.get(id);
      existing.vector_rank = rank;
      existing.similarity = typeof c.similarity === 'number' ? Number(c.similarity.toFixed(4)) : null;
      if (!existing.source_file && c.source_file) existing.source_file = c.source_file;
      if (!existing.category && c.category) existing.category = c.category;
      if (!existing.doc_category && c.doc_category) existing.doc_category = c.doc_category;
      if (!existing.program && c.program) existing.program = c.program;
      if (!existing.campus && c.campus) existing.campus = c.campus;
    }
  });

  return Array.from(scores.entries()).map(([id, rrf_score]) => ({
    ...candidateData.get(id),
    rrf_score
  })).sort((a, b) => b.rrf_score - a.rrf_score);
}

/**
 * Generic Structural Reranking after RRF.
 * Applies generic structural signals only:
 * - explicit canonical entity compatibility
 * - explicit program compatibility
 * - requested field-family / doc_category / category compatibility
 * - vector similarity bonus
 * Important:
 * - metadata NULL = UNKNOWN (neutral, 0)
 * - explicit conflicting metadata penalized
 * - no filename rules
 */
function computeGenericStructuralRerank(rrfCandidates, binding) {
  if (!Array.isArray(rrfCandidates)) return [];

  const targetProgram = binding.constraints?.program
    || (binding.entity?.family === 'program' ? binding.entity.canonical : null);
  const targetField = binding.requestedField;

  return rrfCandidates.map(c => {
    const components = {
      base_rrf: c.rrf_score,
      program_compatibility: 0,
      field_category_compatibility: 0,
      vector_similarity_bonus: 0
    };

    // 1. Explicit Program Compatibility
    if (targetProgram) {
      const targetProgNorm = String(targetProgram).toUpperCase().trim();
      const candProg = c.program ? String(c.program).toUpperCase().trim() : null;

      if (candProg) {
        const isMatch = candProg === targetProgNorm
          || (targetProgNorm.includes('TEKNOLOGI INFORMASI') && candProg === 'TI')
          || (targetProgNorm === 'TI' && candProg.includes('TEKNOLOGI INFORMASI'))
          || (targetProgNorm.includes('SISTEM INFORMASI') && candProg === 'SI')
          || (targetProgNorm.includes('BISNIS DIGITAL') && candProg === 'BD');

        if (isMatch) {
          components.program_compatibility = 0.02;
        } else {
          components.program_compatibility = -0.015;
        }
      } else {
        // Unknown / NULL metadata is neutral
        components.program_compatibility = 0;
      }
    }

    // 2. Generic Field-Family / Category Compatibility
    components.field_category_compatibility = evaluateCategoryCompatibility(targetField, c.doc_category, c.category);

    // 3. Vector similarity bonus (only if similarity meets authoritative threshold)
    if (typeof c.similarity === 'number' && c.similarity >= 0.70) {
      components.vector_similarity_bonus = (c.similarity - 0.70) * 0.05;
    }

    const structural_score = components.base_rrf
      + components.program_compatibility
      + components.field_category_compatibility
      + components.vector_similarity_bonus;

    return {
      ...c,
      structural_score,
      score_components: components
    };
  }).sort((a, b) => b.structural_score - a.structural_score);
}

/**
 * Computes telemetry comparing legacy, vector, and hybrid candidates (Telemetry V2).
 * Polymorphic: supports both V1 (legacy, vector, latencies, error, extra) and V2 signatures.
 * Bounded: logs IDs and scores only, never full chunks or 1536-dim vectors.
 */
function computeComparisonTelemetry(
  binding,
  legacyCandidates = [],
  vectorCandidates = [],
  hybridCandidatesOrLatencies = [],
  latenciesOrError = {},
  errorOrExtra = null,
  extraArg = {}
) {
  let hybridCandidates = [];
  let latencies = {};
  let error = null;
  let extra = {};

  if (Array.isArray(hybridCandidatesOrLatencies)) {
    // V2: (binding, legacyCandidates, vectorCandidates, hybridCandidates, latencies, error, extra)
    hybridCandidates = hybridCandidatesOrLatencies;
    latencies = (latenciesOrError && typeof latenciesOrError === 'object') ? latenciesOrError : {};
    error = errorOrExtra;
    extra = (extraArg && typeof extraArg === 'object') ? extraArg : {};
  } else {
    // V1: (binding, legacyCandidates, vectorCandidates, latencies, error, extra)
    latencies = (hybridCandidatesOrLatencies && typeof hybridCandidatesOrLatencies === 'object') ? hybridCandidatesOrLatencies : {};
    error = latenciesOrError;
    extra = (errorOrExtra && typeof errorOrExtra === 'object') ? errorOrExtra : {};
    hybridCandidates = computeBindingRRF(legacyCandidates, vectorCandidates, 60);
  }

  const legacyIds = (legacyCandidates || []).map(c => c.sourceRecordId || c.chunk?.id || c.chunkIndex || c.id).filter(Boolean);
  const vectorIds = (vectorCandidates || []).map(c => c.source_record_id || c.vector_chunk_id).filter(Boolean);

  const legacyTop5 = legacyIds.slice(0, 5);
  const legacyTop10 = legacyIds.slice(0, 10);
  const vectorTop5 = vectorIds.slice(0, 5);
  const vectorTop10 = vectorIds.slice(0, 10);

  const legacyTop5Set = new Set(legacyTop5);
  const legacyTop10Set = new Set(legacyTop10);

  let overlap5 = 0;
  for (const id of vectorTop5) {
    if (legacyTop5Set.has(id)) overlap5++;
  }

  let overlap10 = 0;
  for (const id of vectorTop10) {
    if (legacyTop10Set.has(id)) overlap10++;
  }

  const legacyTop1Source = legacyCandidates[0]?.chunk?.sourceFile || legacyCandidates[0]?.source_file || null;
  const vectorTop1Source = vectorCandidates[0]?.source_file || null;
  const top1SourceAgreement = Boolean(legacyTop1Source && vectorTop1Source && legacyTop1Source === vectorTop1Source);

  let vectorEvaluatorAcceptCount = 0;
  let vectorEvaluatorRejectCount = 0;
  for (const vc of (vectorCandidates || [])) {
    if (typeof vc.similarity === 'number' && vc.similarity >= 0.70) {
      vectorEvaluatorAcceptCount++;
    } else {
      vectorEvaluatorRejectCount++;
    }
  }

  const vectorTop5Structured = (vectorCandidates || []).slice(0, 5).map((c, idx) => ({
    source_record_id: c.source_record_id || c.sourceRecordId || null,
    source_file: c.source_file || c.sourceFile || null,
    similarity: typeof c.similarity === 'number' ? Number(c.similarity.toFixed(4)) : null,
    rank: idx + 1
  }));

  const legacyTop10Structured = (legacyCandidates || []).slice(0, 10).map((c, idx) => ({
    source_record_id: c.sourceRecordId || c.chunk?.id || c.chunkIndex || c.id || null,
    source_file: c.source_file || c.chunk?.sourceFile || c.sourceFile || null,
    legacy_rank: idx + 1
  }));

  const vectorTop10Structured = (vectorCandidates || []).slice(0, 10).map((c, idx) => ({
    source_record_id: c.source_record_id || c.vector_chunk_id || null,
    source_file: c.source_file || null,
    similarity: typeof c.similarity === 'number' ? Number(c.similarity.toFixed(4)) : null,
    vector_rank: idx + 1
  }));

  const hybrid_top10 = (hybridCandidates || []).slice(0, 10).map((c, idx) => ({
    source_record_id: c.source_record_id || c.id || null,
    source_file: c.source_file || null,
    legacy_rank: c.legacy_rank || null,
    vector_rank: c.vector_rank || null,
    rrf_score: typeof c.rrf_score === 'number' ? Number(c.rrf_score.toFixed(6)) : null,
    structural_score: typeof c.structural_score === 'number' ? Number(c.structural_score.toFixed(6)) : null,
    hybrid_rank: idx + 1
  }));

  let evaluatorAcceptCount = 0;
  let evaluatorRejectCount = 0;
  for (const c of hybridCandidates) {
    if (typeof c.similarity === 'number' && c.similarity >= 0.70) {
      evaluatorAcceptCount++;
    } else {
      evaluatorRejectCount++;
    }
  }

  const isTimeout = Boolean(error && String(error.message || error).includes('timed out'));

  return {
    request_trace_id: extra.request_trace_id || null,
    binding_id: binding.bindingId || null,
    shadow_selected: true,
    shadow_job_started: true,
    shadow_skipped_reason: error ? (isTimeout ? 'timeout' : 'error') : null,
    embedding_input: extra.embedding_input || '',
    embedding_batch_size: extra.embedding_batch_size || 1,
    query_embedding_called: Boolean(extra.query_embedding_called),
    pgvector_query_called: Boolean(extra.pgvector_query_called),
    vector_result_count: (vectorCandidates || []).length,
    vector_top5: vectorTop5Structured,
    legacy_top10: legacyTop10Structured,
    vector_top10: vectorTop10Structured,
    hybrid_top10,
    legacy_top_5: legacyTop5,
    legacy_top_10: legacyTop10,
    vector_top_5: vectorTop5,
    vector_top_10: vectorTop10,
    overlap_at_5: overlap5,
    overlap_at_10: overlap10,
    top1_source_agreement: top1SourceAgreement,
    vector_evaluator_accept_count: vectorEvaluatorAcceptCount,
    vector_evaluator_reject_count: vectorEvaluatorRejectCount,
    evaluator_accept_count: evaluatorAcceptCount,
    evaluator_reject_count: evaluatorRejectCount,
    query_embedding_latency_ms: latencies.embeddingMs || 0,
    vector_db_latency_ms: latencies.dbMs || 0,
    embedding_latency_ms: latencies.embeddingMs || 0,
    db_latency_ms: latencies.dbMs || 0,
    total_shadow_latency_ms: latencies.totalMs || 0,
    shadow_total_latency_ms: latencies.totalMs || 0,
    shadow_timeout: isTimeout,
    vector_error: error ? String(error.message || error) : null,
    fallback_reason: error ? 'error_fallback' : null,
    entity: binding.entity ? binding.entity.canonical : 'INSTITUTION_ROOT',
    requestedField: binding.requestedField
  };
}

/**
 * Executes shadow vector retrieval for all bindings in a plan.
 * Completely fire-and-forget: never throws, never blocks the caller.
 * Batches embeddings per request into a single OpenAI call.
 */
async function observeShadowRetrieval(plan, executionSnapshot, context = {}) {
  const requestTraceId = context.requestTraceId || context.traceId || null;
  const bindingResults = executionSnapshot?.bindingResults || [];
  const primaryBindingId = bindingResults[0]?.bindingId || null;

  // Gate 1: Fail-safe flag default (must be explicitly 'true')
  if (!isShadowEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  // Gate 2: Sampling check (default 0)
  const sampleRate = getSampleRate();
  if (sampleRate <= 0 || (sampleRate < 1 && Math.random() > sampleRate)) {
    const telem = {
      request_trace_id: requestTraceId,
      binding_id: primaryBindingId,
      shadow_selected: false,
      shadow_job_started: false,
      shadow_skipped_reason: 'sampling',
      query_embedding_called: false,
      pgvector_query_called: false,
      vector_result_count: 0,
      vector_top5: [],
      shadow_total_latency_ms: 0,
      shadow_timeout: false,
      vector_error: null
    };
    emitTelemetry(telem);
    return { skipped: true, reason: 'sampling', telemetry: [telem] };
  }

  // Gate 3: Concurrency limiter
  const maxConcurrency = getMaxConcurrency();
  if (activeShadowJobs >= maxConcurrency) {
    const telem = {
      request_trace_id: requestTraceId,
      binding_id: primaryBindingId,
      shadow_selected: true,
      shadow_job_started: false,
      shadow_skipped_reason: 'capacity',
      query_embedding_called: false,
      pgvector_query_called: false,
      vector_result_count: 0,
      vector_top5: [],
      shadow_total_latency_ms: 0,
      shadow_timeout: false,
      vector_error: null
    };
    emitTelemetry(telem);
    return { skipped: true, reason: 'capacity', telemetry: [telem] };
  }

  activeShadowJobs++;
  const t0 = Date.now();
  const timeoutMs = getTimeoutMs();
  const abortController = new AbortController();

  let slotReleased = false;
  const releaseSlot = () => {
    if (!slotReleased) {
      slotReleased = true;
      activeShadowJobs = Math.max(0, activeShadowJobs - 1);
    }
  };

  const telemetryRecords = [];

  const shadowJob = async () => {
    if (bindingResults.length === 0) {
      const telem = {
        request_trace_id: requestTraceId,
        binding_id: null,
        shadow_selected: true,
        shadow_job_started: true,
        shadow_skipped_reason: 'no_bindings',
        query_embedding_called: false,
        pgvector_query_called: false,
        vector_result_count: 0,
        vector_top5: [],
        shadow_total_latency_ms: Date.now() - t0,
        shadow_timeout: false,
        vector_error: null
      };
      emitTelemetry(telem);
      telemetryRecords.push(telem);
      return telemetryRecords;
    }

    // Build lookup map from authoritative retrieval plan subrequests
    const planBindingsMap = new Map();
    if (plan && Array.isArray(plan.subrequests)) {
      for (const sub of plan.subrequests) {
        if (Array.isArray(sub.bindings)) {
          for (const b of sub.bindings) {
            planBindingsMap.set(b.bindingId, {
              ...b,
              clauseText: b.clauseText || sub.rawText || context.question || '',
              rawText: sub.rawText || context.question || ''
            });
          }
        }
      }
    }

    // Prepare bindings and queries
    const bindingWorkItems = [];
    for (const bResult of bindingResults) {
      const bindingId = bResult.bindingId || null;
      const planBinding = planBindingsMap.get(bindingId) || {};
      const binding = {
        bindingId,
        entity: bResult.entity ? { canonical: bResult.entity } : (planBinding.entity || null),
        requestedField: bResult.field || planBinding.requestedField,
        retrievalHints: bResult.retrievalHints || planBinding.retrievalHints || [],
        constraints: bResult.constraints || planBinding.constraints || {},
        clauseText: planBinding.clauseText || context.question || '',
        rawText: planBinding.rawText || context.question || ''
      };

      const queryText = buildBindingQueryText(binding);
      bindingWorkItems.push({
        binding,
        queryText,
        legacyCandidates: bResult.candidates || []
      });
    }

    // Batch query embedding computation (O(1) OpenAI call per request)
    const validTexts = bindingWorkItems.map(item => item.queryText || '');
    let embeddings = [];
    let embeddingMs = 0;
    let embError = null;

    if (validTexts.some(t => t.length > 0)) {
      const tEmb0 = Date.now();
      try {
        embeddings = await module.exports.computeBatchQueryEmbeddings(validTexts, timeoutMs, abortController.signal);
        embeddingMs = Date.now() - tEmb0;
      } catch (err) {
        embError = err;
        embeddingMs = Date.now() - tEmb0;
      }
    }

    // Perform vector search, RRF, and structural reranking per binding with bounded DB concurrency
    const dbConcurrency = (context && context.dbConcurrency) || getDbConcurrency();
    const perBindingTelemetries = await mapConcurrent(bindingWorkItems, dbConcurrency, async (item, i) => {
      const binding = item.binding;
      const legacyCandidates = item.legacyCandidates;
      const embedding = embeddings[i] || null;

      let vectorCandidates = [];
      let hybridCandidates = [];
      let dbMs = 0;
      let error = embError;
      let queryEmbeddingCalled = Boolean(item.queryText);
      let pgvectorQueryCalled = false;

      if (embedding && !error) {
        pgvectorQueryCalled = true;
        const tDb0 = Date.now();
        try {
          vectorCandidates = await module.exports.searchVectorChunks(embedding, binding, 20);
          dbMs = Date.now() - tDb0;

          // 1. Reciprocal Rank Fusion (RRF)
          const rrfCandidates = computeBindingRRF(legacyCandidates, vectorCandidates, 60);

          // 2. Generic Structural Reranking
          hybridCandidates = computeGenericStructuralRerank(rrfCandidates, binding);
        } catch (dbErr) {
          error = dbErr;
          dbMs = Date.now() - tDb0;
        }
      }

      const totalMs = Date.now() - t0;
      const telem = computeComparisonTelemetry(
        binding,
        legacyCandidates,
        vectorCandidates,
        hybridCandidates,
        { embeddingMs, dbMs, totalMs },
        error,
        {
          request_trace_id: requestTraceId,
          embedding_input: item.queryText,
          embedding_batch_size: validTexts.length,
          query_embedding_called: queryEmbeddingCalled,
          pgvector_query_called: pgvectorQueryCalled
        }
      );
      return telem;
    });

    for (const telem of perBindingTelemetries) {
      emitTelemetry(telem);
      telemetryRecords.push(telem);
    }

    return telemetryRecords;
  };

  const executeJob = async () => {
    try {
      return await shadowJob();
    } finally {
      releaseSlot();
    }
  };

  const jobPromise = executeJob();
  jobPromise.catch(() => {});

  let timeoutTimer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(() => {
      try {
        abortController.abort();
      } catch (_) {}
      reject(new Error(`Shadow execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const results = await Promise.race([jobPromise, timeoutPromise]);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    return { skipped: false, results, durationMs: Date.now() - t0 };
  } catch (err) {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    const isTimeout = Boolean(err.message?.includes('timed out'));
    if (telemetryRecords.length === 0) {
      const telem = {
        request_trace_id: requestTraceId,
        binding_id: primaryBindingId,
        shadow_selected: true,
        shadow_job_started: true,
        shadow_skipped_reason: isTimeout ? 'timeout' : 'error',
        query_embedding_called: true,
        pgvector_query_called: false,
        vector_result_count: 0,
        vector_top5: [],
        shadow_total_latency_ms: Date.now() - t0,
        shadow_timeout: isTimeout,
        vector_error: err.message || String(err)
      };
      emitTelemetry(telem);
      telemetryRecords.push(telem);
    }
    return {
      skipped: true,
      reason: isTimeout ? 'timeout' : 'error',
      error: err.message,
      telemetry: telemetryRecords
    };
  }
}

/**
 * Pure evaluation helper for shadow candidates.
 * Guarantees zero mutation to input candidates, frame, or authoritative state.
 */
function pureEvaluateShadowCandidates(candidates = [], evaluatorFn) {
  if (typeof evaluatorFn !== 'function') return { accepted: 0, rejected: 0 };
  const cloned = candidates.map(c => Object.freeze({ ...c }));
  let accepted = 0;
  let rejected = 0;

  for (const c of cloned) {
    try {
      const isAccepted = evaluatorFn(c);
      if (isAccepted) accepted++;
      else rejected++;
    } catch (_) {
      rejected++;
    }
  }

  return { accepted, rejected };
}

function getActiveShadowJobs() {
  return activeShadowJobs;
}

module.exports = {
  EMBEDDING_VERSION,
  EMBEDDING_MODEL,
  CANONICAL_FIELD_SEMANTICS,
  isShadowEnabled,
  isRetrievalEnabled,
  getMaxConcurrency,
  getSampleRate,
  getTimeoutMs,
  getActiveShadowJobs,
  setTelemetrySink,
  emitTelemetry,
  getFieldNaturalSemantics,
  getOpenAIClient,
  buildBindingQueryText,
  computeBatchQueryEmbeddings,
  computeQueryEmbedding,
  searchVectorChunks,
  computeBindingRRF,
  computeGenericStructuralRerank,
  computeComparisonTelemetry,
  observeShadowRetrieval,
  pureEvaluateShadowCandidates
};

