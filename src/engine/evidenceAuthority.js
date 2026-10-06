'use strict';

/**
 * evidenceAuthority.js
 *
 * Canonical Answer Authority & Evidence Status Model.
 *
 * Provides a generic, non-whitelist-based representation of candidate answer
 * authority and grounding status for all stages of the RAG pipeline.
 *
 * Invariant:
 * Evaluators, routers, and verifiers MUST NOT equate `contexts.length === 0`
 * or `overallStatus === 'UNSUPPORTED'` to "no evidence" when the answer
 * originates from authoritative structured KB or specialized deterministic handlers.
 */

/**
 * Evidence types recognized across the pipeline:
 * 1. RETRIEVED_DOCUMENT: Grounded in retrieved corpus text chunks
 * 2. STRUCTURED_KB: Grounded in structured knowledge base (catalogs, profiles, fee matrix)
 * 3. SPECIALIZED_AUTHORITATIVE_HANDLER: Grounded in deterministic domain handler with verified facts
 * 4. PARTIAL_EVIDENCE: Partially supported facts with clear boundaries
 * 5. NO_EVIDENCE: Fallback, missing data, or unanswerable query
 */
const EVIDENCE_TYPES = Object.freeze({
  RETRIEVED_DOCUMENT: 'RETRIEVED_DOCUMENT',
  STRUCTURED_KB: 'STRUCTURED_KB',
  SPECIALIZED_AUTHORITATIVE_HANDLER: 'SPECIALIZED_AUTHORITATIVE_HANDLER',
  PARTIAL_EVIDENCE: 'PARTIAL_EVIDENCE',
  NO_EVIDENCE: 'NO_EVIDENCE'
});

const GROUNDING_STATUS = Object.freeze({
  GROUNDED: 'GROUNDED',
  PARTIALLY_GROUNDED: 'PARTIALLY_GROUNDED',
  UNSUPPORTED: 'UNSUPPORTED'
});

const SOURCE_AUTHORITY = Object.freeze({
  AUTHORITATIVE: 'AUTHORITATIVE',
  PARTIAL: 'PARTIAL',
  FALLBACK: 'FALLBACK'
});

/**
 * Checks whether an answer contains explicit fallback / missing data phrases.
 * @param {string} text
 * @returns {boolean}
 */
function isFallbackOrNoDataText(text) {
  const s = String(text || '').trim();
  if (!s || s.length < 20) return true;
  return /data\s+yang\s+(?:anda|kakak)\s+minta\s+tidak\s+tersedia|belum\s+menemukan\s+(?:data|informasi)\s+yang\s+(?:sesuai|cukup|lengkap)|tidak\s+menemukan\s+informasi|belum\s+memiliki\s+informasi\s+resmi|informasi\s+tersebut\s+belum\s+tersedia|belum\s+bisa\s+mengambil\s+jawaban|belum\s+ada\s+daftar|(?:mohon\s+)?maaf.*belum/i.test(s);
}

/**
 * Checks whether a source identifier represents an explicit fallback or blocked state.
 * @param {string} source
 * @returns {boolean}
 */
function isExplicitFallbackSource(source) {
  const s = String(source || '').toLowerCase();
  return /insufficient|no-evidence|no-data|no-training|fallback|blocked|mismatch|error|out-of-domain|unanswerable/i.test(s);
}

/**
 * Resolves the generic evidence status and answer authority for any candidate result.
 *
 * @param {object} params
 * @param {string} [params.source]
 * @param {string} [params.answer]
 * @param {Array} [params.contexts]
 * @param {number} [params.confidenceScore]
 * @param {string} [params.confidenceTier]
 * @param {object} [params.evaluation]
 * @param {object} [params.evidenceStatus] Existing status if already attached
 * @returns {object} Canonical evidence status
 */
function resolveEvidenceStatus(params = {}, maybeSource, maybeAnswer) {
  let p = params;
  if (Array.isArray(params)) {
    p = {
      contexts: params,
      source: maybeSource,
      answer: maybeAnswer
    };
  } else if (params && typeof params === 'object') {
    p = params;
  } else {
    p = {};
  }

  if (p.evidenceStatus && typeof p.evidenceStatus === 'object') {
    return p.evidenceStatus;
  }

  const source = String(p.source || maybeSource || '').trim();
  const sourceLower = source.toLowerCase();
  const textAnswer = String(p.answer || maybeAnswer || '').trim();
  const contexts = Array.isArray(p.contexts) ? p.contexts : (Array.isArray(params) ? params : []);
  const evalObj = p.evaluation;

  const isNoData = isFallbackOrNoDataText(textAnswer);
  const isFallbackSrc = isExplicitFallbackSource(source);

  // Case 1: Explicit fallback or no-data text (even if contexts exist or empty)
  if (isFallbackSrc || isNoData) {
    const isIntentionalEscalation = /academic-credit-no-data|intentional-escalation|safe-escalation/i.test(sourceLower);
    const hasPartialGrounding = contexts.length > 0 && !isIntentionalEscalation;
    return {
      hasAuthoritativeEvidence: false,
      evidenceType: isIntentionalEscalation ? EVIDENCE_TYPES.PARTIAL_EVIDENCE : (hasPartialGrounding ? EVIDENCE_TYPES.PARTIAL_EVIDENCE : EVIDENCE_TYPES.NO_EVIDENCE),
      evidenceRefs: contexts.map(c => c.source || c.filename || c.title || 'document').filter(Boolean),
      evidenceConfidence: typeof params.confidenceScore === 'number' ? params.confidenceScore : 0.2,
      evidenceQuality: isIntentionalEscalation || hasPartialGrounding ? 'PARTIAL' : 'NONE',
      sourceAuthority: SOURCE_AUTHORITY.FALLBACK,
      answerOrigin: source || 'fallback',
      answerGroundingStatus: isIntentionalEscalation || hasPartialGrounding ? GROUNDING_STATUS.PARTIALLY_GROUNDED : GROUNDING_STATUS.UNSUPPORTED
    };
  }

  // Case 2: Retrieved documents present and answer is substantive
  if (contexts.length > 0) {
    const isEvalSupported = !evalObj || evalObj.overallStatus === 'SUPPORTED' || evalObj.overallStatus === 'PARTIALLY_SUPPORTED';
    return {
      hasAuthoritativeEvidence: true,
      evidenceType: EVIDENCE_TYPES.RETRIEVED_DOCUMENT,
      evidenceRefs: contexts.map(c => c.source || c.filename || c.title || 'document').filter(Boolean),
      evidenceConfidence: typeof params.confidenceScore === 'number' ? params.confidenceScore : 0.9,
      evidenceQuality: contexts.length >= 2 ? 'HIGH' : 'MEDIUM',
      sourceAuthority: SOURCE_AUTHORITY.AUTHORITATIVE,
      answerOrigin: source || 'retrieved_document',
      answerGroundingStatus: isEvalSupported ? GROUNDING_STATUS.GROUNDED : GROUNDING_STATUS.PARTIALLY_GROUNDED
    };
  }

  // Case 3: Structured KB or Specialized Authoritative Handlers (contexts: [])
  // Validated by substantive factual answer without fallback markers
  if (textAnswer.length > 25 && !isNoData && !isFallbackSrc) {
    const isStructured = /catalog|structure|profile|matrix|tuition|curriculum|policy|schedule|deterministic/i.test(sourceLower);
    return {
      hasAuthoritativeEvidence: true,
      evidenceType: isStructured ? EVIDENCE_TYPES.STRUCTURED_KB : EVIDENCE_TYPES.SPECIALIZED_AUTHORITATIVE_HANDLER,
      evidenceRefs: [source || 'structured_kb'],
      evidenceConfidence: typeof params.confidenceScore === 'number' && params.confidenceScore > 0 ? params.confidenceScore : 0.88,
      evidenceQuality: 'HIGH',
      sourceAuthority: SOURCE_AUTHORITY.AUTHORITATIVE,
      answerOrigin: source || 'structured_handler',
      answerGroundingStatus: GROUNDING_STATUS.GROUNDED
    };
  }

  // Default: No evidence
  return {
    hasAuthoritativeEvidence: false,
    evidenceType: EVIDENCE_TYPES.NO_EVIDENCE,
    evidenceRefs: [],
    evidenceConfidence: 0.1,
    evidenceQuality: 'NONE',
    sourceAuthority: SOURCE_AUTHORITY.FALLBACK,
    answerOrigin: source || 'unknown',
    answerGroundingStatus: GROUNDING_STATUS.UNSUPPORTED
  };
}

module.exports = {
  EVIDENCE_TYPES,
  GROUNDING_STATUS,
  SOURCE_AUTHORITY,
  isFallbackOrNoDataText,
  isExplicitFallbackSource,
  resolveEvidenceStatus
};
