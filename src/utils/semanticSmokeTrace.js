const { normalizeUserQuery } = require('./queryNormalizer');
const { buildCanonicalQueryUnderstanding } = require('../engine/queryUnderstanding');

const MAX_SNIPPET_CHARS = 240;
const MAX_ANSWER_CHARS = 4000;
const MAX_ITEMS = 8;

function compactString(value, limit = MAX_SNIPPET_CHARS) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? text.slice(0, limit) : text;
}

function cloneJson(value) {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
}

function summarizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  return {
    id: ctx.id ? String(ctx.id).slice(0, 120) : null,
    source: ctx.source || ctx.filename || ctx.file || ctx.sourceFile || null,
    category: ctx.category || (ctx.metadata && ctx.metadata.category) || null,
    topic: ctx.topic || (ctx.metadata && ctx.metadata.topic) || null,
    type: ctx.type || (ctx.metadata && ctx.metadata.type) || null,
    score: typeof ctx.score === 'number' ? ctx.score : null,
    selected: Boolean(ctx.isSelectedEvidence),
    snippet: compactString(ctx.text || ctx.chunk || '')
  };
}

function summarizeEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence.slice(0, MAX_ITEMS).map(summarizeContext).filter(Boolean);
}

function summarizeRetrieval(resultDebug, result) {
  const technique = resultDebug && resultDebug.techniquePipeline;
  const retrieval = technique && technique.retrieval ? technique.retrieval : null;
  const contexts = Array.isArray(result && result.contexts) ? result.contexts : [];
  return {
    indexSize: (resultDebug && resultDebug.indexSize)
      || (retrieval && retrieval.indexSize)
      || (technique && technique.indexSize)
      || null,
    candidateCount: retrieval && typeof retrieval.candidateCount === 'number' ? retrieval.candidateCount : null,
    returnedContextCount: contexts.length,
    candidates: Array.isArray(retrieval && retrieval.candidates)
      ? retrieval.candidates.slice(0, MAX_ITEMS).map(summarizeContext).filter(Boolean)
      : []
  };
}

function buildSemanticSmokeTrace({ query, result } = {}) {
  const raw = String(query || '').trim();
  const normalized = normalizeUserQuery(raw);
  const debug = result && result.debug && typeof result.debug === 'object' ? result.debug : {};
  const canonicalContract = cloneJson(
    debug.semanticContract
    || debug.canonicalContract
    || (buildCanonicalQueryUnderstanding(raw, { normalizedQuery: normalized.normalizedText }).contract)
  );
  const answerabilityResult = debug.answerabilityResult
    || (debug.techniquePipeline && debug.techniquePipeline.evidenceProcessing && debug.techniquePipeline.evidenceProcessing.answerabilityResult)
    || null;
  const verifierResult = debug.contractVerification || null;
  const contexts = Array.isArray(result && result.contexts) ? result.contexts : [];

  return {
    input: {
      raw,
      normalized: normalized && normalized.normalizedText ? normalized.normalizedText : raw,
      changed: Boolean(normalized && normalized.changed)
    },
    canonicalContract,
    effectiveContext: {
      inherited: Boolean(debug.contextReused || debug.inheritedContext || debug.followupResolutionChanged),
      reason: debug.contextReason || debug.followupReason || debug.reason || null,
      inheritedSlots: Array.isArray(debug.inheritedSlots) ? debug.inheritedSlots.slice(0, 12) : [],
      parentContractSummary: debug.parentContractSummary || null
    },
    routeDecision: {
      source: result && result.source ? result.source : null,
      routeStage: debug.routeStage || null,
      canonicalDomain: canonicalContract ? canonicalContract.domain || null : null,
      canonicalIntent: canonicalContract ? canonicalContract.intent || null : null,
      requestType: canonicalContract ? canonicalContract.requestType || null : null
    },
    retrieval: summarizeRetrieval(debug, result),
    selectedEvidence: summarizeEvidence(contexts),
    composer: {
      answerShape: canonicalContract ? canonicalContract.answerShape || null : null,
      requestedFields: canonicalContract && Array.isArray(canonicalContract.requestedFields) ? canonicalContract.requestedFields : [],
      draftSource: result && result.source ? result.source : null,
      confidenceScore: result && typeof result.confidenceScore === 'number' ? result.confidenceScore : null,
      confidenceTier: result && result.confidenceTier ? result.confidenceTier : null,
      answerPreview: compactString(result && result.answer, 500)
    },
    verifierResult: verifierResult ? cloneJson(verifierResult) : {
      ok: null,
      reason: answerabilityResult && answerabilityResult.reason ? answerabilityResult.reason : null,
      unavailable: true
    },
    finalAnswer: compactString(result && result.answer, MAX_ANSWER_CHARS)
  };
}

module.exports = {
  buildSemanticSmokeTrace
};
