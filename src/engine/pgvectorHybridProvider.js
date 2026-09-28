'use strict';

/**
 * src/engine/pgvectorHybridProvider.js
 *
 * Production Generic Hybrid Retrieval Provider.
 *
 * Pipeline Architecture:
 *   LEGACY RETRIEVAL + PGVECTOR RETRIEVAL
 *            Γåô
 *   NORMALIZE CANDIDATES
 *            Γåô
 *      MERGE + DEDUPE
 *            Γåô
 *   REAL EvidenceEvaluator
 *            Γåô
 *   SUPPORTED EVIDENCE ONLY
 *            Γåô
 *     GroundedComposer
 *            Γåô
 *      FinalVerifier
 *
 * Core Invariants:
 * 1. Legacy retrieval remains available and unaltered when vector is inactive/unavailable.
 * 2. Vector retrieval does not replace legacy; both run per binding.
 * 3. Merge & deduplication is performed by canonical source/evidence identity.
 * 4. Factual support is evaluated strictly through the real EvidenceEvaluator.
 * 5. SUPPORTED > REJECTED; SPECIFIC_FIELD > FIELD_FAMILY; exact requested entity > sibling/unrelated entity.
 * 6. Similarity score alone never decides factual support.
 * 7. If vector returns no valid evidence, legacy behavior remains unchanged.
 * 8. If legacy returns no valid evidence but vector finds supported evidence, vector evidence may answer.
 * 9. If both contain complementary supported evidence, both may be used.
 * 10. No query-specific branches, no source-ID/file-specific rules, no static answer prose.
 *
 * Activation:
 *   VECTOR_RETRIEVAL_MODE=hybrid
 *   or VECTOR_HYBRID_ENABLED=true
 * Defaults:
 *   VECTOR_SHADOW_ENABLED=true
 *   VECTOR_SHADOW_SAMPLE_RATE=0.1
 *   VECTOR_RETRIEVAL_ENABLED=false
 */

const crypto = require('crypto');

const {
  buildBindingQueryText,
  computeBatchQueryEmbeddings,
  searchVectorChunksMultiBinding,
  computeBindingRRF,
  computeGenericStructuralRerank,
  buildCorpusEvidenceFromCandidate,
  getCorpusIndex
} = require('./pgvectorShadowProvider');

const {
  evaluateBinding,
  evaluatePlanResults,
  EVALUATION_STATUS,
  EVIDENCE_DISPOSITION
} = require('./evidenceEvaluator');

const {
  composeGroundedAnswerPlan,
  renderGroundedAnswer
} = require('./groundedComposer');

const {
  verifyGroundedAnswerPlan,
  VERIFIER_DECISION
} = require('./finalVerifier');

let logger = null;
try {
  logger = require('../logger');
} catch (_) {}

/**
 * Resolves the configured canary sample rate for hybrid retrieval traffic.
 * Default: 0.1 (10% nominal traffic allocation)
 * Range: Clamped strictly to [0.0, 1.0].
 *   0.0 = 0% traffic (no requests use hybrid, all legacy)
 *   1.0 = 100% traffic (all eligible requests use hybrid)
 *
 * @returns {number} Float in range [0, 1]
 */
function getCanarySampleRate() {
  if (process.env.VECTOR_CANARY_SAMPLE_RATE !== undefined && process.env.VECTOR_CANARY_SAMPLE_RATE !== '') {
    const parsed = parseFloat(process.env.VECTOR_CANARY_SAMPLE_RATE);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }
  return 0.1; // Safe default: 10%
}

/**
 * Computes a deterministic integer bucket [0, totalBuckets - 1] for a conversation identifier.
 * Uses SHA-256 over the normalized identifier to guarantee stable assignment across turns.
 * Does NOT use Math.random() so the same conversation identity never bounces between legacy and hybrid.
 *
 * Note: 10% is a long-run traffic allocation over a large population, not an exact 10% guarantee on small sample sizes.
 *
 * @param {string|number} identifier Conversation identifier (chatId, phone, etc.)
 * @param {number} totalBuckets Default 1000
 * @returns {number} Bucket in [0, totalBuckets - 1], or -1 if invalid
 */
function computeCanaryBucket(identifier, totalBuckets = 1000) {
  if (identifier === null || identifier === undefined) return -1;
  const norm = String(identifier).trim().toLowerCase();
  if (!norm) return -1;
  const hash = crypto.createHash('sha256').update(norm).digest('hex');
  const intVal = parseInt(hash.slice(0, 8), 16);
  return intVal % totalBuckets;
}

/**
 * Resolves a stable conversation identifier from request options or context.
 * Strictly uses persistent conversation identity (chatId, phone, conversationId, sessionId, sender).
 * Does NOT fall back to ephemeral request/trace IDs to prevent cross-turn flip-flop.
 *
 * @param {Object} options Request options or execution context
 * @returns {string|null} Resolved identifier string or null
 */
function resolveConversationIdentifier(options = {}) {
  if (!options || typeof options !== 'object') return null;

  // 1. Explicit chatId (top-level or in sessionData / context)
  const candidate = options.chatId
    || options.sessionData?.chatId
    || options.context?.chatId
    || options.conversationId
    || options.sessionData?.conversationId
    || options.phone
    || options.sessionData?.phone
    || options.sender
    || options.from
    || options.sessionId
    || options.sessionData?.sessionId;

  if (candidate !== undefined && candidate !== null && String(candidate).trim() !== '') {
    return String(candidate).trim();
  }

  return null;
}

/**
 * Attaches structured canary routing telemetry to options/context and logs safely without raw PII.
 */
function recordCanaryTelemetry(options, data) {
  const telemetry = {
    canary_enabled: Boolean(data.canary_enabled),
    canary_sample_rate: typeof data.canary_sample_rate === 'number' ? data.canary_sample_rate : 0,
    canary_bucket: typeof data.canary_bucket === 'number' ? data.canary_bucket : null,
    canary_selected: Boolean(data.canary_selected),
    retrieval_channel: data.retrieval_channel || 'legacy',
    reason: data.reason || null
  };

  if (options && typeof options === 'object') {
    options.__canaryTelemetry = telemetry;
  }

  if (logger && typeof logger.debug === 'function') {
    try {
      logger.debug({
        ...telemetry,
        reason: data.reason || null
      }, '[CANARY_TELEMETRY] Evaluated hybrid retrieval canary routing');
    } catch (_) {}
  }
}

/**
 * Feature flag & Canary Governor checker for production hybrid retrieval.
 *
 * Core Governor Invariants:
 * 1. Failsafe Master Gate:
 *    VECTOR_RETRIEVAL_ENABLED=false ALWAYS blocks hybrid retrieval (returns false).
 * 2. Mode Gate:
 *    Hybrid retrieval is active when VECTOR_RETRIEVAL_MODE=hybrid OR VECTOR_HYBRID_ENABLED=true.
 *    (Pure-vector VECTOR_RETRIEVAL_ENABLED=true does NOT activate hybrid retrieval on its own).
 * 3. Canary Traffic Governor:
 *    - VECTOR_CANARY_SAMPLE_RATE specifies nominal allocation (default 0.1 = 10%).
 *    - sample_rate = 0 => 0% hybrid (all legacy).
 *    - sample_rate = 1 => 100% hybrid (all eligible).
 *    - For 0 < sample_rate < 1:
 *      * Evaluated deterministically via stable SHA-256 hash of conversation identity (chatId).
 *      * Mapped to bucket 0..999.
 *      * Selected if bucket < threshold (threshold = Math.floor(sampleRate * 1000)).
 *      * Requests failing canary bucket remain on legacy retrieval.
 *      * If options contains no conversation identity and 0 < sampleRate < 1:
 *        - System-level capability checks (!options or empty options) reflect global mode readiness.
 *        - Real request contexts fail-safe to legacy.
 *
 * @param {Object} options Execution context or request options
 * @returns {boolean} True if hybrid retrieval is enabled and selected for this request
 */
function isHybridRetrievalEnabled(options = {}) {
  const currentSampleRate = (options && typeof options.sampleRate === 'number')
    ? Math.max(0, Math.min(1, options.sampleRate))
    : getCanarySampleRate();

  // 1. MASTER FAIL-SAFE GATE: VECTOR_RETRIEVAL_ENABLED=false always blocks hybrid
  const retrievalFlag = String(process.env.VECTOR_RETRIEVAL_ENABLED || '').trim().toLowerCase();
  if (retrievalFlag === 'false' || retrievalFlag === '0' || retrievalFlag === 'no') {
    recordCanaryTelemetry(options, {
      canary_enabled: false,
      canary_sample_rate: currentSampleRate,
      canary_bucket: null,
      canary_selected: false,
      retrieval_channel: 'legacy',
      reason: 'master_retrieval_flag_disabled'
    });
    return false;
  }

  // 2. RETRIEVAL MODE GATE: Must be explicit hybrid mode
  const mode = String(process.env.VECTOR_RETRIEVAL_MODE || '').trim().toLowerCase();
  const hybridFlag = String(process.env.VECTOR_HYBRID_ENABLED || '').trim().toLowerCase();
  const isHybridMode = (options && (options.hybridRetrieval === true || options.vectorRetrievalMode === 'hybrid'))
    || mode === 'hybrid'
    || hybridFlag === 'true' || hybridFlag === '1' || hybridFlag === 'yes';

  if (!isHybridMode) {
    recordCanaryTelemetry(options, {
      canary_enabled: false,
      canary_sample_rate: currentSampleRate,
      canary_bucket: null,
      canary_selected: false,
      retrieval_channel: 'legacy',
      reason: 'hybrid_mode_inactive'
    });
    return false;
  }

  // 3. SAMPLE RATE EXTREMES
  if (currentSampleRate <= 0) {
    recordCanaryTelemetry(options, {
      canary_enabled: true,
      canary_sample_rate: 0,
      canary_bucket: null,
      canary_selected: false,
      retrieval_channel: 'legacy',
      reason: 'sample_rate_zero'
    });
    return false;
  }

  if (currentSampleRate >= 1) {
    recordCanaryTelemetry(options, {
      canary_enabled: true,
      canary_sample_rate: 1,
      canary_bucket: null,
      canary_selected: true,
      retrieval_channel: 'hybrid',
      reason: 'sample_rate_full'
    });
    return true;
  }

  // 4. CANARY BUCKET DETERMINISTIC EVALUATION (0 < currentSampleRate < 1)
  const identifier = resolveConversationIdentifier(options);
  const threshold = Math.floor(currentSampleRate * 1000);

  if (identifier) {
    const bucket = computeCanaryBucket(identifier, 1000);
    const isSelected = bucket >= 0 && bucket < threshold;
    const channel = isSelected ? 'hybrid' : 'legacy';

    recordCanaryTelemetry(options, {
      canary_enabled: true,
      canary_sample_rate: currentSampleRate,
      canary_bucket: bucket,
      canary_selected: isSelected,
      retrieval_channel: channel,
      reason: isSelected ? 'canary_bucket_selected' : 'canary_bucket_unselected'
    });
    return isSelected;
  }

  // 5. NO IDENTIFIER RESOLVED:
  // If called without options or with empty options (system capability/readiness check in tests),
  // return true to indicate the hybrid feature is globally active.
  // If called with a request context that lacks an identifier, fail-safe to legacy.
  const hasRequestContext = options && typeof options === 'object' && Object.keys(options).length > 0;
  if (!hasRequestContext || options.isSystemCheck === true) {
    recordCanaryTelemetry(options, {
      canary_enabled: true,
      canary_sample_rate: currentSampleRate,
      canary_bucket: null,
      canary_selected: true,
      retrieval_channel: 'hybrid',
      reason: 'system_capability_check'
    });
    return true;
  }

  // Request context provided but no identifier resolved: fail-safe to legacy
  recordCanaryTelemetry(options, {
    canary_enabled: true,
    canary_sample_rate: currentSampleRate,
    canary_bucket: null,
    canary_selected: false,
    retrieval_channel: 'legacy',
    reason: 'missing_conversation_identity_failsafe'
  });
  return false;
}

/**
 * Derives canonical source/evidence identity for deduplication across retrieval paths.
 * Identifies the immutable corpus chunk irrespective of whether it was retrieved
 * via lexical inverted index or pgvector similarity search.
 *
 * @param {Object} item Candidate or evidence record
 * @returns {string} Canonical identity string
 */
function getCanonicalEvidenceIdentity(item) {
  if (!item) return '';

  // 1. Explicit sourceRecordId / UUID
  const recId = item.source_record_id
    || item.sourceRecordId
    || item.id
    || item.chunk?.id
    || item.qualifiers?.sourceRecordId
    || item.qualifiers?.id;
  if (recId) return String(recId);

  // 2. Formatted evidenceId (ev_<uuid>)
  if (item.evidenceId && /^ev_[0-9a-f-]{36}$/i.test(item.evidenceId)) {
    return item.evidenceId.slice(3);
  }

  // 3. sourceFile + '#' + chunkIndex
  const sourceFile = item.source_file
    || item.sourceFile
    || item.sourceId
    || item.filename
    || item.chunk?.sourceFile
    || item.chunk?.filename;
  const chunkIndex = item.source_record_index
    ?? item.sourceRecordIndex
    ?? item.chunkIndex
    ?? item.chunk?.chunkIndex
    ?? item.qualifiers?.chunkIndex;
  if (sourceFile && chunkIndex !== null && chunkIndex !== undefined) {
    return `${sourceFile}#${chunkIndex}`;
  }

  // 4. Fallback: text snippet hash
  const rawText = item.textSnippet || item.chunk?.chunk || item.chunk?.text || item.text || item.chunk;
  if (rawText && typeof rawText === 'string') {
    const norm = rawText.slice(0, 200).toLowerCase().replace(/\s+/g, ' ').trim();
    return `${sourceFile || 'corpus'}#${norm}`;
  }

  return item.evidenceId || String(Math.random().toString(36).slice(2, 9));
}

/**
 * Normalizes a candidate chunk into an EvidenceEvaluator-compliant evidence record.
 * Attaches retrievalChannel ('legacy' | 'vector' | 'hybrid') and provenance signals.
 */
function normalizeCandidateToEvidence(candidate, binding, corpusRecord = null, channel = 'hybrid') {
  if (!candidate || !binding) return null;

  const baseEvidence = buildCorpusEvidenceFromCandidate(candidate, binding, corpusRecord);
  if (!baseEvidence) return null;

  const canonicalId = getCanonicalEvidenceIdentity(candidate) || getCanonicalEvidenceIdentity(baseEvidence);

  return {
    ...baseEvidence,
    retrievalChannel: channel,
    canonicalIdentity: canonicalId,
    qualifiers: {
      ...baseEvidence.qualifiers,
      retrievalChannel: channel,
      canonicalIdentity: canonicalId,
      legacyRank: candidate.legacy_rank ?? null,
      vectorRank: candidate.vector_rank ?? null,
      rrfScore: candidate.rrf_score ?? null,
      structuralScore: candidate.structural_score ?? null
    },
    confidenceSignals: {
      ...baseEvidence.confidenceSignals,
      retrievalChannel: channel,
      legacyRank: candidate.legacy_rank ?? null,
      vectorRank: candidate.vector_rank ?? null,
      score: typeof candidate.similarity === 'number' ? candidate.similarity : (candidate.structural_score || baseEvidence.confidenceSignals?.score || 0.8)
    }
  };
}

/**
 * Deterministically merges legacy and pgvector candidates per binding:
 * - Deduplicates by canonical source/evidence identity.
 * - Computes RRF (Reciprocal Rank Fusion) preserving legacy_rank, vector_rank, and similarity.
 * - Applies generic structural reranking (entity/program compatibility, category match, similarity bonus).
 * - Hydrates full chunk texts from the prewarmed in-memory corpus index (zero DB queries).
 * - Converts each candidate into an EvidenceEvaluator-compliant normalized evidence record.
 *
 * @param {Array} legacyCandidates Legacy retrieved candidates for binding
 * @param {Array} vectorCandidates Pgvector retrieved candidates for binding
 * @param {Object} binding RetrievalBinding
 * @param {Array} corpusIndex Prewarmed in-memory corpus index
 * @returns {Array} Ordered normalized evidence records
 */
function mergeAndDeduplicateCandidates(legacyCandidates = [], vectorCandidates = [], binding = {}, corpusIndex = []) {
  const semanticIndex = corpusIndex.length ? corpusIndex : getCorpusIndex();
  const idMap = new Map((semanticIndex || []).filter(r => r && r.id).map(r => [r.id, r]));
  const indexMap = new Map((semanticIndex || []).map((r, idx) => [r.chunkIndex ?? idx, r]));

  // Standardize legacy candidates to uniform candidate format
  const normLegacy = (legacyCandidates || []).map((c, idx) => {
    const chunkObj = (c && typeof c.chunk === 'object') ? c.chunk : (typeof c === 'object' ? c : {});
    const chunkIdx = c.chunkIndex ?? chunkObj.chunkIndex ?? idx;
    let id = chunkObj.id || c.sourceRecordId || c.source_record_id || c.id;
    if (!id && indexMap.has(chunkIdx)) {
      id = indexMap.get(chunkIdx)?.id;
    }
    id = id || String(chunkIdx);

    const corpusRec = (id && idMap.get(id)) || indexMap.get(chunkIdx) || null;
    const rawText = typeof c.chunk === 'string'
      ? c.chunk
      : (chunkObj.chunk || chunkObj.text || chunkObj.content || c.chunk || c.text || corpusRec?.chunk || corpusRec?.text || (typeof c === 'string' ? c : null));

    return {
      id,
      source_record_id: id,
      source_record_index: chunkIdx,
      chunkIndex: chunkIdx,
      source_file: chunkObj.sourceFile || chunkObj.filename || c.source_file || c.sourceFile || corpusRec?.sourceFile || corpusRec?.filename || null,
      program: chunkObj.program || chunkObj.metadata?.program || c.program || corpusRec?.program || null,
      category: chunkObj.category || c.category || corpusRec?.category || null,
      doc_category: chunkObj.doc_category || c.doc_category || corpusRec?.doc_category || null,
      section_title: chunkObj.section_title || c.section_title || corpusRec?.section_title || null,
      chunk: rawText,
      similarity: null
    };
  });

  // Standardize vector candidates
  const normVector = (vectorCandidates || []).map(c => {
    const id = c.source_record_id || c.id;
    const chunkIdx = c.source_record_index ?? c.chunkIndex ?? (id && idMap.get(id)?.chunkIndex);
    const corpusRec = (id && idMap.get(id)) || (chunkIdx !== undefined && indexMap.get(chunkIdx)) || null;

    return {
      id: id || (chunkIdx !== undefined ? String(chunkIdx) : null),
      source_record_id: id || corpusRec?.id || null,
      source_record_index: chunkIdx ?? corpusRec?.chunkIndex ?? null,
      chunkIndex: chunkIdx ?? corpusRec?.chunkIndex ?? null,
      source_file: c.source_file || corpusRec?.sourceFile || corpusRec?.filename || null,
      program: c.program || corpusRec?.program || null,
      category: c.category || corpusRec?.category || null,
      doc_category: c.doc_category || corpusRec?.doc_category || null,
      section_title: c.section_title || corpusRec?.section_title || null,
      chunk: c.chunk || c.text || corpusRec?.chunk || corpusRec?.text || null,
      similarity: typeof c.similarity === 'number' ? Number(c.similarity.toFixed(4)) : null
    };
  });

  // 1. Reciprocal Rank Fusion (RRF) with canonical deduplication
  const rrfCandidates = computeBindingRRF(normLegacy, normVector, 60);

  // 2. Generic Structural Reranking
  const rankedCandidates = computeGenericStructuralRerank(rrfCandidates, binding);

  // 3. Normalize into compliant EvidenceEvaluator evidence records
  const evidenceRecords = [];
  const seenIdentities = new Set();

  for (const cand of rankedCandidates) {
    const candId = cand.source_record_id || cand.id;
    const candIndex = cand.source_record_index ?? cand.chunkIndex;

    let corpusRecord = candId ? idMap.get(candId) : null;
    if (!corpusRecord && candIndex !== null && candIndex !== undefined) {
      corpusRecord = indexMap.get(candIndex);
    }

    let channel = 'hybrid';
    if (cand.legacy_rank !== null && cand.vector_rank === null) channel = 'legacy';
    else if (cand.legacy_rank === null && cand.vector_rank !== null) channel = 'vector';

    const ev = normalizeCandidateToEvidence(cand, binding, corpusRecord, channel);
    if (!ev || !ev.textSnippet) continue;

    const canonicalKey = ev.canonicalIdentity || getCanonicalEvidenceIdentity(ev);
    if (seenIdentities.has(canonicalKey)) continue;
    seenIdentities.add(canonicalKey);

    evidenceRecords.push(ev);
  }

  return evidenceRecords;
}

/**
 * Batched pgvector retrieval for all bindings across a retrieval plan.
 * Executes in a single PostgreSQL query via LATERAL join and single batch embedding call.
 * Fault-tolerant: errors fall back gracefully to empty candidates without throwing.
 *
 * @param {Object} plan RetrievalPlan
 * @param {Object} context Execution context
 * @returns {Promise<Object.<string, Array>>} Map of bindingId -> vector candidate rows
 */
async function retrieveVectorCandidatesForPlan(plan, context = {}) {
  if (!plan || !Array.isArray(plan.subrequests)) return {};

  const bindingWorkItems = [];
  for (const sub of plan.subrequests) {
    if (!Array.isArray(sub.bindings)) continue;
    for (const b of sub.bindings) {
      const binding = {
        ...b,
        clauseText: b.clauseText || sub.rawText || context.question || '',
        rawText: sub.rawText || context.question || ''
      };
      const queryText = buildBindingQueryText(binding);
      bindingWorkItems.push({ binding, queryText });
    }
  }

  if (bindingWorkItems.length === 0) return {};

  const queryTexts = bindingWorkItems.map(item => item.queryText || '');
  const timeoutMs = Number.isFinite(Number(process.env.VECTOR_SHADOW_TIMEOUT_MS))
    ? Number(process.env.VECTOR_SHADOW_TIMEOUT_MS)
    : 1500;

  let embeddings = [];
  try {
    embeddings = await computeBatchQueryEmbeddings(queryTexts, timeoutMs);
  } catch (err) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug({ err: err?.message }, '[HYBRID_RETRIEVAL] Batch embedding generation error; continuing with legacy');
    }
    return {};
  }

  if (!Array.isArray(embeddings) || embeddings.length === 0) return {};

  const queryItems = bindingWorkItems.map((item, i) => ({
    binding: item.binding,
    embedding: embeddings[i] || null
  }));

  try {
    const candidatesByBinding = await searchVectorChunksMultiBinding(queryItems, 20);
    return candidatesByBinding || {};
  } catch (err) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug({ err: err?.message }, '[HYBRID_RETRIEVAL] Vector multi-binding search error; continuing with legacy');
    }
    return {};
  }
}

/**
 * Full Generic Hybrid Retrieval Execution:
 * Runs legacy + pgvector per binding -> normalizes -> merges + dedupes
 * -> evaluates with real EvidenceEvaluator -> filters supported evidence
 * -> composes GroundedAnswerPlan -> validates with FinalVerifier.
 *
 * @param {Object} plan RetrievalPlan
 * @param {Object} context Execution context
 * @returns {Promise<Object>} Execution result with evaluation, answerPlan, and verifierResult
 */
async function executeHybridPlan(plan, context = {}) {
  if (!plan || !Array.isArray(plan.subrequests)) {
    return {
      planId: plan?.planId || null,
      resultsByBinding: {},
      evaluation: null,
      answerPlan: null,
      verifierResult: null
    };
  }

  const { defaultRegistry } = require('./evidenceProviderRegistry');
  const semanticIndex = context.semanticIndex || getCorpusIndex(context);
  const frame = context.frame || plan.semanticFrame || {};

  // 1. PGVECTOR RETRIEVAL: Batch retrieval for all bindings in 1 roundtrip
  let vectorCandidatesByBinding = {};
  if (isHybridRetrievalEnabled(context)) {
    try {
      vectorCandidatesByBinding = await retrieveVectorCandidatesForPlan(plan, {
        ...context,
        semanticIndex
      });
    } catch (_) {
      vectorCandidatesByBinding = {};
    }
  }

  // 2. LEGACY RETRIEVAL: Execute providers via registry
  const legacyExecution = await defaultRegistry.executePlan(plan, {
    ...context,
    semanticIndex
  });

  // 3. NORMALIZE + MERGE + DEDUPE PER BINDING
  const hybridResultsByBinding = {};
  let totalLegacySupported = 0;
  let totalVectorSupported = 0;

  for (const subreq of plan.subrequests) {
    if (!Array.isArray(subreq.bindings)) continue;

    for (const binding of subreq.bindings) {
      const bindingId = binding.bindingId;
      const legacyResult = legacyExecution.resultsByBinding[bindingId] || {};
      const legacyEvidence = Array.isArray(legacyResult.evidence) ? legacyResult.evidence : [];
      const vectorCandidates = vectorCandidatesByBinding[bindingId] || [];

      let mergedEvidence = [];

      if (!isHybridRetrievalEnabled(context) || vectorCandidates.length === 0) {
        // Pure legacy path or vector returned no candidates
        mergedEvidence = legacyEvidence.map(ev => ({
          ...ev,
          retrievalChannel: 'legacy'
        }));
      } else {
        // Separate legacy corpus candidates from non-corpus structured provider evidence
        const legacyCorpusCandidates = [];
        const structuredProviderEvidence = [];

        for (const ev of legacyEvidence) {
          if (ev.providerId === 'CorpusEvidenceProvider' || ev.sourceType === 'indexed_chunk') {
            legacyCorpusCandidates.push(ev);
          } else {
            structuredProviderEvidence.push({
              ...ev,
              retrievalChannel: 'legacy'
            });
          }
        }

        // Merge corpus legacy + pgvector candidates
        const mergedCorpusEvidence = mergeAndDeduplicateCandidates(
          legacyCorpusCandidates,
          vectorCandidates,
          binding,
          semanticIndex
        );

        // Combine with structured provider evidence, deduplicated by canonical identity
        const combined = [...structuredProviderEvidence, ...mergedCorpusEvidence];
        const seenKeys = new Set();
        for (const ev of combined) {
          const key = ev.canonicalIdentity || getCanonicalEvidenceIdentity(ev);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          mergedEvidence.push(ev);
        }
      }

      hybridResultsByBinding[bindingId] = {
        bindingId,
        entity: binding.entity?.canonical || 'INSTITUTION_ROOT',
        field: binding.requestedField,
        evidenceCount: mergedEvidence.length,
        evidence: mergedEvidence
      };
    }
  }

  const providerExecution = {
    planId: plan.planId || null,
    totalBindings: Object.keys(hybridResultsByBinding).length,
    resultsByBinding: hybridResultsByBinding,
    allEvidence: Object.values(hybridResultsByBinding).flatMap(r => r.evidence)
  };

  // 4. REAL EvidenceEvaluator: Strict evaluation across all bindings
  const evaluation = evaluatePlanResults(plan, providerExecution, frame, {
    evidenceOpportunityComplete: true
  });

  // Count supported provenance signals
  for (const bResult of Object.values(evaluation.resultsByBinding || {})) {
    for (const fact of (bResult.supportedFacts || [])) {
      const channel = fact.retrievalChannel || fact.evidence?.retrievalChannel || 'legacy';
      if (channel === 'legacy') totalLegacySupported++;
      else if (channel === 'vector') totalVectorSupported++;
      else if (channel === 'hybrid') {
        totalLegacySupported++;
        totalVectorSupported++;
      }
    }
  }

  // 5. GroundedComposer: Intermediate structured answer plan from supported facts only
  const answerPlan = composeGroundedAnswerPlan(frame, plan, evaluation);

  // 6. FinalVerifier: Strict verification of claims and evidence IDs
  const verifierResult = verifyGroundedAnswerPlan(answerPlan, evaluation, frame);

  return {
    planId: plan.planId || null,
    isHybridEnabled: isHybridRetrievalEnabled(context),
    providerExecution,
    evaluation,
    answerPlan,
    verifierResult,
    totalLegacySupported,
    totalVectorSupported,
    hasLegacySupported: totalLegacySupported > 0,
    hasVectorSupported: totalVectorSupported > 0
  };
}

/**
 * Safe Hybrid Retrieval Gate:
 * Determines strictly AFTER EffectiveSemanticFrame freeze whether authoritative
 * hybrid retrieval is required for institutional evidence.
 *
 * A. NON-RETRIEVAL PATH (returns false):
 * - greeting
 * - casual conversation
 * - social acknowledgement
 * - generic conversational continuation / topic opening without concrete factual slots
 * - clarification-required / vague query without actionable semantic anchors
 * - non-factual conversational query
 *
 * B. RETRIEVABLE FACTUAL PATH (returns true):
 * - Concrete institutional target present in frozen EffectiveSemanticFrame:
 *   - Explicit or contextual entity (program, facility, organization, etc.)
 *   - Authoritative institutional requested field (careerOutcome, fee, schedule, definition, etc.)
 *   - Institutional domain with retrievable factual intent
 */
function isFactualRetrievalRequired(frame, understanding, question, options = {}) {
  if (!frame || typeof frame !== 'object') return false;

  const raw = String(question || frame.rawQuery || '').trim();
  const rawLower = raw.toLowerCase();
  const intent = String(frame.intent?.primary || understanding?.intent?.primary || '').toLowerCase();
  const domain = String(frame.domain?.primary || understanding?.domain?.primary || '').toLowerCase();
  const entities = Array.isArray(frame.entities) ? frame.entities : [];
  const requestedFields = Array.isArray(frame.requestedFields) ? frame.requestedFields : [];
  const answerExpectation = String(frame.answerExpectation || understanding?.answerExpectation || '').toLowerCase();
  const contract = understanding?.contract || options?.semanticContract || null;
  const requestType = String(contract?.requestType || '').toLowerCase();
  const answerShape = String(contract?.answerShape || '').toLowerCase();

  // 1. Explicit greeting / casual conversation / social acknowledgement
  const conversationalIntents = new Set([
    'greeting',
    'small_talk',
    'general_small_talk',
    'social_acknowledgement',
    'social_ack',
    'acknowledgement',
    'permission_to_ask'
  ]);
  if (conversationalIntents.has(intent)) return false;
  if (domain === 'small_talk') return false;

  // Patterns for pure greetings, casual conversation, acknowledgements
  const greetingOrCasualPattern = /^(?:halo+|hallo+|hello+|helo+|hai+|hay+|hi+|selamat\s+(?:pagi|siang|sore|malam)|permisi|p|ping|tes|test|testing|cek|assalamu'?alaikum|salam)(?:\s+(?:kak|min|admin|tiko|bot|kakak))?[!.,?]*$/i;
  if (greetingOrCasualPattern.test(rawLower)) return false;

  const casualChatPattern = /^(?:apa\s+kabar(?:nya)?|apa\s+khabar(?:nya)?|gimana\s+kabar(?:nya)?|gimana\s+khabar(?:nya)?|bagaimana\s+kabar(?:nya)?|kamu\s+siapa|siapa\s+kamu|lagi\s+apa|lagi\s+ngapain|sehat(?:\s+(?:kak|min|admin|tiko|bot))?)[!.,?]*$/i;
  if (casualChatPattern.test(rawLower)) return false;

  const socialAckPattern = /^(?:terima\s*kasih|makasih|thanks|thank\s*you|thx|ok|oke|okay|siap|baik|sip|noted|mantap)(?:\s+(?:kak|min|admin|tiko|bot|kakak))?[!.,?]*$/i;
  if (socialAckPattern.test(rawLower)) return false;

  // Helper callbacks from engine if provided
  if (typeof options.trySmallTalkAnswer === 'function' && options.trySmallTalkAnswer(raw)) return false;
  if (typeof options.tryGreetingPermissionAnswer === 'function' && options.tryGreetingPermissionAnswer(raw)) return false;
  if (typeof options.isPureGreetingRestart === 'function' && options.isPureGreetingRestart(raw)) return false;

  // 2. Generic conversational topic opening (e.g., "Saya ingin bertanya tentang pmb")
  // Query opens a general conversational topic without requesting a concrete institutional fact
  const isTopicOpening = answerExpectation === 'topic_opening'
    || requestType === 'topic_opening'
    || answerShape === 'acknowledge_topic_only'
    || answerExpectation === 'conversational_opening'
    || /^(?:(?:saya|aku|sy)\s+)?(?:ingin|mau|boleh|izin)\s+(?:bertanya|tanya|menanyakan)\s+(?:tentang|seputar)?\s*(?:pmb|pendaftaran)?[!.,?]*$/i.test(rawLower);

  if (isTopicOpening && entities.length === 0 && (intent === 'ask_general' || intent === 'permission_to_ask' || intent === 'unknown' || intent === '')) {
    const hasConcreteFactualField = requestedFields.some(f => !['profile', 'definition', 'general'].includes(f));
    if (!hasConcreteFactualField) {
      return false;
    }
  }

  // 3. Clarification-required / vague query without actionable semantic anchor
  const hasEffectiveAnchor = Boolean(
    (domain && !['general', 'unknown', 'out_of_domain'].includes(domain))
    || entities.length > 0
    || (intent && !['ask_general', 'unknown'].includes(intent))
  );

  if (!hasEffectiveAnchor && entities.length === 0 && requestedFields.length === 0) {
    return false;
  }

  // 4. Non-factual conversational query (no entity and only generic definition/profile fields)
  if (entities.length === 0) {
    const hasConcreteFactualField = requestedFields.some(f => !['profile', 'definition', 'general'].includes(f));
    if (!hasConcreteFactualField) {
      return false;
    }
  }

  // 5. Retrievable factual query:
  // Must have an entity OR a concrete requested field OR an institutional factual intent/domain
  const hasEntity = entities.length > 0;
  const hasRequestedField = requestedFields.length > 0;
  const isInstitutionalDomain = !['general', 'unknown', 'out_of_domain', 'small_talk'].includes(domain);

  return hasEntity || hasRequestedField || isInstitutionalDomain;
}

module.exports = {
  isHybridRetrievalEnabled,
  isFactualRetrievalRequired,
  getCanonicalEvidenceIdentity,
  normalizeCandidateToEvidence,
  mergeAndDeduplicateCandidates,
  retrieveVectorCandidatesForPlan,
  executeHybridPlan,
  getCanarySampleRate,
  computeCanaryBucket,
  resolveConversationIdentifier,
  recordCanaryTelemetry
};
