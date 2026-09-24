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

/**
 * Builds deterministic query representation for a single binding.
 * Avoids reconstructing whole-chat raw-string concatenations.
 */
function buildBindingQueryText(binding) {
  if (!binding) return '';
  const parts = [];

  if (binding.entity && binding.entity.canonical) {
    parts.push(binding.entity.canonical);
  }
  if (binding.requestedField) {
    parts.push(binding.requestedField);
  }
  if (Array.isArray(binding.retrievalHints) && binding.retrievalHints.length > 0) {
    parts.push(binding.retrievalHints.slice(0, 5).join(' '));
  }
  if (binding.clauseText) {
    parts.push(String(binding.clauseText).slice(0, 200));
  }

  return parts.join(' ').trim() || String(binding.rawText || '').slice(0, 200);
}

/**
 * Computes query embedding using OpenAI with timeout and AbortSignal support.
 */
async function computeQueryEmbedding(text, timeoutMs = 1500, abortSignal = null) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured for query embedding.');
  }

  const client = new OpenAI({ apiKey, timeout: timeoutMs });
  const requestOptions = abortSignal ? { signal: abortSignal } : {};
  const resp = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  }, requestOptions);

  const emb = resp.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length !== 1536) {
    throw new Error(`Unexpected query embedding dimension: ${emb?.length}`);
  }

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
 * Computes telemetry comparing legacy and vector candidates.
 * Bounded: logs IDs and scores only, never full chunks or 1536-dim vectors.
 */
function computeComparisonTelemetry(binding, legacyCandidates = [], vectorCandidates = [], latencies = {}, error = null, extra = {}) {
  const legacyIds = legacyCandidates.map(c => c.sourceRecordId || c.chunk?.id || c.chunkIndex || c.id).filter(Boolean);
  const vectorIds = vectorCandidates.map(c => c.source_record_id || c.vector_chunk_id).filter(Boolean);

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

  // Simulated acceptance check (pure, zero mutation)
  let vectorEvaluatorAcceptCount = 0;
  let vectorEvaluatorRejectCount = 0;
  for (const vc of vectorCandidates) {
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

  const isTimeout = Boolean(error && String(error.message || error).includes('timed out'));

  return {
    request_trace_id: extra.request_trace_id || null,
    binding_id: binding.bindingId || null,
    shadow_selected: true,
    shadow_job_started: true,
    shadow_skipped_reason: error ? (isTimeout ? 'timeout' : 'error') : null,
    query_embedding_called: Boolean(extra.query_embedding_called),
    pgvector_query_called: Boolean(extra.pgvector_query_called),
    vector_result_count: vectorCandidates.length,
    vector_top5: vectorTop5Structured,
    shadow_total_latency_ms: latencies.totalMs || 0,
    shadow_timeout: isTimeout,
    vector_error: error ? String(error.message || error) : null,

    // Backward-compatibility and audit fields
    entity: binding.entity ? binding.entity.canonical : 'INSTITUTION_ROOT',
    requestedField: binding.requestedField,
    legacy_top_5: legacyTop5,
    legacy_top_10: legacyTop10,
    vector_top_5: vectorTop5,
    vector_top_10: vectorTop10,
    overlap_at_5: overlap5,
    overlap_at_10: overlap10,
    top1_source_agreement: top1SourceAgreement,
    vector_evaluator_accept_count: vectorEvaluatorAcceptCount,
    vector_evaluator_reject_count: vectorEvaluatorRejectCount,
    query_embedding_latency_ms: latencies.embeddingMs || 0,
    vector_db_latency_ms: latencies.dbMs || 0,
    total_shadow_latency_ms: latencies.totalMs || 0,
    fallback_reason: error ? 'error_fallback' : null
  };
}

/**
 * Executes shadow vector retrieval for all bindings in a plan.
 * Completely fire-and-forget: never throws, never blocks the caller.
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

    for (const bResult of bindingResults) {
      const bindingId = bResult.bindingId || null;
      const binding = {
        bindingId,
        entity: bResult.entity ? { canonical: bResult.entity } : null,
        requestedField: bResult.field,
        retrievalHints: bResult.retrievalHints || [],
        constraints: bResult.constraints || {}
      };

      const legacyCandidates = bResult.candidates || [];
      let vectorCandidates = [];
      let embeddingMs = 0;
      let dbMs = 0;
      let error = null;
      let queryEmbeddingCalled = false;
      let pgvectorQueryCalled = false;

      try {
        const queryText = buildBindingQueryText(binding);
        if (queryText) {
          queryEmbeddingCalled = true;
          const tEmb0 = Date.now();
          const queryEmbedding = await module.exports.computeQueryEmbedding(queryText, timeoutMs, abortController.signal);
          embeddingMs = Date.now() - tEmb0;

          pgvectorQueryCalled = true;
          const tDb0 = Date.now();
          vectorCandidates = await module.exports.searchVectorChunks(queryEmbedding, binding, 10);
          dbMs = Date.now() - tDb0;
        }
      } catch (err) {
        error = err;
      }

      const totalMs = Date.now() - t0;
      const telem = computeComparisonTelemetry(
        binding,
        legacyCandidates,
        vectorCandidates,
        { embeddingMs, dbMs, totalMs },
        error,
        {
          request_trace_id: requestTraceId,
          query_embedding_called: queryEmbeddingCalled,
          pgvector_query_called: pgvectorQueryCalled
        }
      );
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
  isShadowEnabled,
  isRetrievalEnabled,
  getMaxConcurrency,
  getSampleRate,
  getTimeoutMs,
  getActiveShadowJobs,
  setTelemetrySink,
  emitTelemetry,
  buildBindingQueryText,
  computeQueryEmbedding,
  searchVectorChunks,
  computeComparisonTelemetry,
  observeShadowRetrieval,
  pureEvaluateShadowCandidates
};
