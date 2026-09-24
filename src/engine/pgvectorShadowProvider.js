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
function computeComparisonTelemetry(binding, legacyCandidates = [], vectorCandidates = [], latencies = {}, error = null) {
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
    // Basic similarity threshold check for candidate viability
    if (typeof vc.similarity === 'number' && vc.similarity >= 0.70) {
      vectorEvaluatorAcceptCount++;
    } else {
      vectorEvaluatorRejectCount++;
    }
  }

  return {
    binding_id: binding.bindingId,
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
    vector_error: error ? String(error.message || error) : null,
    fallback_reason: error ? 'error_fallback' : null
  };
}

/**
 * Executes shadow vector retrieval for all bindings in a plan.
 * Completely fire-and-forget: never throws, never blocks the caller.
 */
async function observeShadowRetrieval(plan, executionSnapshot, context = {}) {
  // Gate 1: Fail-safe flag default (must be explicitly 'true')
  if (!isShadowEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  // Gate 2: Sampling check (default 0)
  const sampleRate = getSampleRate();
  if (sampleRate <= 0 || (sampleRate < 1 && Math.random() > sampleRate)) {
    return { skipped: true, reason: 'sampling' };
  }

  // Gate 3: Concurrency limiter
  const maxConcurrency = getMaxConcurrency();
  if (activeShadowJobs >= maxConcurrency) {
    return { skipped: true, reason: 'capacity' };
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

  const shadowJob = async () => {
    const telemetryRecords = [];
    const bindingResults = executionSnapshot?.bindingResults || [];

    for (const bResult of bindingResults) {
      const binding = {
        bindingId: bResult.bindingId,
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

      try {
        const queryText = buildBindingQueryText(binding);
        if (queryText) {
          const tEmb0 = Date.now();
          const queryEmbedding = await computeQueryEmbedding(queryText, timeoutMs, abortController.signal);
          embeddingMs = Date.now() - tEmb0;

          const tDb0 = Date.now();
          vectorCandidates = await searchVectorChunks(queryEmbedding, binding, 10);
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
        error
      );
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
  // Absorb background rejection/abort errors so they never trigger unhandled rejection
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
    return {
      skipped: true,
      reason: err.message?.includes('timed out') ? 'timeout' : 'error',
      error: err.message
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
  buildBindingQueryText,
  computeQueryEmbedding,
  searchVectorChunks,
  computeComparisonTelemetry,
  observeShadowRetrieval,
  pureEvaluateShadowCandidates
};
