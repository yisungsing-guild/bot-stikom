'use strict';

/**
 * retrievalStrategy.js
 *
 * Phase 3 — Retrieval Strategy Orchestration.
 * Connects SemanticFrame -> RetrievalPlan -> RetrievalStrategy -> Candidate Retrieval -> Evidence Evaluation.
 *
 * Core Architecture & Invariants:
 * 1. STRATEGY SELECTION DERIVED FROM STRUCTURED RETRIEVAL PLAN:
 *    Selection is driven by plan dimensions: domain, intent, requestedFields, entitySpecs,
 *    temporalScope, locationScope, authorityRequirements, governanceRequirements, historicalPolicy, fallbackPolicy.
 *    No rawQuery regexes or exact-query special cases.
 * 2. BOUNDED TOP-K:
 *    Retains candidate chunks within configurable bounds (default 5, max bounded).
 *    Never collapses to single-document docs.slice(0, 1).
 * 3. DOCUMENT BOUNDARY ISOLATION:
 *    Each candidate retains independent provenance and document identity.
 *    Chunks from distinct documents are never concatenated into a pseudo-document before evaluation.
 * 4. GOVERNANCE & TEMPORAL INTEGRITY:
 *    Every candidate item passes through isChunkGovernanceAllowed / isTrainingGovernanceAllowed.
 *    Non-historical queries strictly reject expired, draft, archived, superseded, and future-valid items.
 *    Historical queries only allow expired items matching targetPeriod.
 * 5. SEPARATION OF CONCERNS:
 *    retrieval != evidence evaluation != answer generation.
 *    RetrievalStrategy outputs ranked evidence candidates with metrics, not marketing prose.
 * 6. SAFE LEGACY FALLBACK:
 *    If structured strategy yields no evidence, falls back to governance-aware LEGACY_LEXICAL.
 * 7. ZERO HARDCODED BUSINESS FACTS:
 *    Contains 0 business answers, 0 document exceptions, 0 keyword blacklists.
 */

const fs = require('fs');
const path = require('path');
const { isChunkGovernanceAllowed, isTrainingGovernanceAllowed } = require('./runtimeGovernance');
const { evaluatePlannedCandidate, rankPlannedCandidates } = require('./resolvedRetrievalPlan');
const { getRagIndexPath } = require('../utils/ragPaths');

let memoizedIndex = null;
let memoizedIndexPath = null;
let memoizedMtime = 0;

function loadDefaultCorpusIndex() {
  try {
    const indexPath = getRagIndexPath();
    if (fs.existsSync(indexPath)) {
      const stat = fs.statSync(indexPath);
      if (memoizedIndex && memoizedIndexPath === indexPath && memoizedMtime === stat.mtimeMs) {
        return memoizedIndex;
      }
      const raw = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        memoizedIndex = parsed;
        memoizedIndexPath = indexPath;
        memoizedMtime = stat.mtimeMs;
        return memoizedIndex;
      }
    }
  } catch (_) {}
  if (memoizedIndex) return memoizedIndex;
  return [];
}

function invalidateRetrievalStrategyCache() {
  memoizedIndex = null;
  memoizedIndexPath = null;
  memoizedMtime = 0;
}

/**
 * Base Retrieval Strategy
 */
class BaseRetrievalStrategy {
  constructor(name) {
    this.name = name;
  }

  supports(plan) {
    return false;
  }

  async retrieve(plan, context = {}) {
    throw new Error(`[RetrievalStrategy] retrieve() must be implemented by subclass ${this.name}`);
  }
}

/**
 * 1. LegacyLexicalStrategy (LEGACY_LEXICAL)
 * Bounded, governance-aware lexical candidate search across corpus index.
 */
class LegacyLexicalStrategy extends BaseRetrievalStrategy {
  constructor() {
    super('LEGACY_LEXICAL');
  }

  supports(plan) {
    // Universal baseline and fallback strategy
    return Boolean(plan);
  }

  async retrieve(plan, context = {}) {
    const corpus = Array.isArray(context.index)
      ? context.index
      : (Array.isArray(context.docs) ? context.docs : loadDefaultCorpusIndex());

    const totalCorpusCount = corpus.length;
    let evaluatedCount = 0;
    let governanceRejections = 0;

    const queryForGovernance = plan?.planQuery || (plan?.temporalScope?.targetPeriod ? `tahun ${plan.temporalScope.targetPeriod}` : '');
    const allowHistorical = Boolean(plan?.temporalScope?.allowHistorical);

    // Step 1: Governance & Authority Pre-Filter
    const governedCandidates = [];
    for (const item of corpus) {
      if (!item) continue;
      evaluatedCount++;

      // Check governance eligibility
      const isAllowed = isChunkGovernanceAllowed(item, {
        allowHistorical,
        query: queryForGovernance
      });

      if (!isAllowed) {
        governanceRejections++;
        continue;
      }

      // Check authority requirement if specified
      if (plan?.authorityRequirements?.mustBeAuthoritative) {
        const tier = Number(item.authorityTier || item.metadata?.authorityTier || 99);
        if (tier > 3) {
          continue;
        }
      }

      governedCandidates.push(item);
    }

    // Step 2: Plan-driven semantic compatibility scoring
    // Evaluate candidates with evaluatePlannedCandidate without violating document boundaries
    const scoredCandidates = [];
    for (const candidate of governedCandidates) {
      const metrics = evaluatePlannedCandidate(candidate, plan);
      if (metrics && metrics.compatible) {
        scoredCandidates.push({
          item: candidate,
          metrics,
          documentId: candidate.documentId || candidate.id || candidate.filename || 'unknown_doc',
          sourceFile: candidate.sourceFile || candidate.filename || 'unknown_source'
        });
      }
    }

    // Step 3: Rank candidates deterministically
    scoredCandidates.sort((a, b) => {
      // Primary: Entity score
      if (b.metrics.entityScore !== a.metrics.entityScore) {
        return b.metrics.entityScore - a.metrics.entityScore;
      }
      // Secondary: Field score
      if (b.metrics.fieldScore !== a.metrics.fieldScore) {
        return b.metrics.fieldScore - a.metrics.fieldScore;
      }
      // Tertiary: Contract score
      if (b.metrics.contractScore !== a.metrics.contractScore) {
        return b.metrics.contractScore - a.metrics.contractScore;
      }
      // Quaternary: Authority tier (lower tier is higher authority: tier 1 > tier 2 > tier 3)
      const tierA = Number(a.item.authorityTier || 99);
      const tierB = Number(b.item.authorityTier || 99);
      if (tierA !== tierB) {
        return tierA - tierB;
      }
      // Quinary: Original retrieval score
      return (b.metrics.semanticScore || 0) - (a.metrics.semanticScore || 0);
    });

    // Step 4: Bounded Top-K Selection
    // Configurable bound (default 5, min 1, bounded to candidate set)
    const configuredTopK = Math.max(1, Number(context.topK || 5));
    const topK = Math.min(scoredCandidates.length, configuredTopK);
    const selected = scoredCandidates.slice(0, topK);

    return {
      strategy: this.name,
      candidates: selected.map(s => ({
        ...s.item,
        metrics: s.metrics,
        documentId: s.documentId,
        sourceFile: s.sourceFile
      })),
      stats: {
        totalCorpusCount,
        evaluatedCount,
        governanceRejections,
        compatibleCount: scoredCandidates.length,
        selectedCount: selected.length,
        topK
      },
      fallbackPolicy: plan?.fallbackPolicy || 'safe_data_gap'
    };
  }
}

/**
 * 2. StructuredTrainingDataStrategy (STRUCTURED_TRAININGDATA)
 * Retrieves verified Q&A pairs from training data when plan target scope matches.
 */
class StructuredTrainingDataStrategy extends BaseRetrievalStrategy {
  constructor() {
    super('STRUCTURED_TRAININGDATA');
  }

  supports(plan) {
    if (!plan) return false;
    const scope = Array.isArray(plan.sourceScope) ? plan.sourceScope : [];
    const isFaq = plan.domain === 'faq' || plan.domain === 'procedure';
    const isQna = plan.intent && String(plan.intent).includes('qna');
    const isTrainingScope = scope.includes('training_data');
    return isFaq || isQna || isTrainingScope;
  }

  async retrieve(plan, context = {}) {
    let trainingData = Array.isArray(context.trainingData) ? context.trainingData : null;
    if (!trainingData && typeof context.getTrainingData === 'function') {
      try {
        trainingData = await context.getTrainingData();
      } catch (_) {}
    }
    if (!trainingData) {
      try {
        const { getActiveTrainingDataFromDb } = require('./semanticRagEngine');
        if (typeof getActiveTrainingDataFromDb === 'function') {
          trainingData = await getActiveTrainingDataFromDb();
        }
      } catch (_) {}
    }
    trainingData = Array.isArray(trainingData) ? trainingData : [];
    const allowHistorical = Boolean(plan?.temporalScope?.allowHistorical);
    const query = plan?.planQuery || '';

    const matched = [];
    let evaluatedCount = 0;

    for (const row of trainingData) {
      if (!row) continue;
      evaluatedCount++;

      // Enforce training data governance
      if (!isTrainingGovernanceAllowed(row, { allowHistorical, query })) {
        continue;
      }

      const q = String(row.input || row.question || '').toLowerCase();
      const a = String(row.output || row.answer || '').toLowerCase();
      const combined = `${q} ${a}`;

      // Entity matching
      const targetEntities = Array.isArray(plan.entities) ? plan.entities : [];
      let entityMatch = targetEntities.length === 0;
      if (!entityMatch) {
        entityMatch = targetEntities.some(ent => {
          const norm = String(ent).toLowerCase();
          return combined.includes(norm);
        });
      }

      if (entityMatch) {
        matched.push({
          id: row.id || `training_${matched.length}`,
          input: row.input || row.question,
          output: row.output || row.answer,
          source: row.source || 'training_data',
          authorityTier: row.authorityTier || 1,
          status: row.status || 'approved',
          metrics: {
            entityMatch,
            compatible: true
          }
        });
      }
    }

    const topK = Math.min(matched.length, Math.max(1, Number(context.topK || 5)));
    const selected = matched.slice(0, topK);

    return {
      strategy: this.name,
      candidates: selected,
      stats: {
        totalTrainingCount: trainingData.length,
        evaluatedCount,
        selectedCount: selected.length,
        topK
      },
      fallbackPolicy: plan?.fallbackPolicy || 'safe_data_gap'
    };
  }
}

/**
 * 3. ShadowComparisonStrategy (SHADOW_COMPARISON)
 * Test and local harness comparing plan-driven vs legacy retrieval candidates.
 */
class ShadowComparisonStrategy extends BaseRetrievalStrategy {
  constructor() {
    super('SHADOW_COMPARISON');
    this.lexicalStrategy = new LegacyLexicalStrategy();
  }

  supports(plan) {
    return Boolean(plan);
  }

  async retrieve(plan, context = {}) {
    // Run plan-driven lexical retrieval
    const planResult = await this.lexicalStrategy.retrieve(plan, context);

    // Run unconstrained legacy retrieval simulation (without plan constraints)
    const corpus = Array.isArray(context.index) ? context.index : (Array.isArray(context.docs) ? context.docs : loadDefaultCorpusIndex());
    const rawQuery = String(context.rawQuery || plan?.planQuery || '').toLowerCase();

    const legacyMatches = [];
    for (const item of corpus) {
      if (!item) continue;
      const text = String(item.chunk || item.text || item.content || '').toLowerCase();
      const fn = String(item.filename || '').toLowerCase();
      if (rawQuery.split(/\s+/).some(token => token.length > 3 && (text.includes(token) || fn.includes(token)))) {
        legacyMatches.push(item);
      }
    }

    const legacySelected = legacyMatches.slice(0, Math.min(legacyMatches.length, context.topK || 5));

    // Calculate candidate overlap and detect prohibited governance leakage in legacy
    const planDocIds = new Set(planResult.candidates.map(c => c.documentId || c.filename));
    const legacyDocIds = new Set(legacySelected.map(c => c.documentId || c.filename));
    const overlap = [...planDocIds].filter(id => legacyDocIds.has(id));

    let defectDetected = false;
    let defectReason = null;

    // Check if legacy selected expired documents on non-historical queries
    if (!plan?.temporalScope?.allowHistorical) {
      const leakedExpired = legacySelected.some(c => c.status === 'expired' || c.governanceStatus === 'expired');
      if (leakedExpired) {
        defectDetected = true;
        defectReason = 'legacy_selected_expired_document_on_current_query';
      }
    }

    // Check if legacy selected chunks matching defect patterns provided in context (e.g. during test audits)
    if (Array.isArray(context.defectPatterns) && context.defectPatterns.length > 0) {
      const contaminated = legacySelected.some(c => {
        const text = String(c.chunk || c.text || c.content || '');
        return context.defectPatterns.some(pat => {
          if (pat instanceof RegExp) return pat.test(text);
          return text.toLowerCase().includes(String(pat).toLowerCase());
        });
      });
      if (contaminated) {
        defectDetected = true;
        defectReason = 'legacy_selected_contaminated_chunk';
      }
    }

    return {
      strategy: this.name,
      mode: 'LOCAL SIMULATION',
      candidates: planResult.candidates,
      stats: planResult.stats,
      comparison: {
        mode: 'LOCAL SIMULATION',
        planCandidateCount: planResult.candidates.length,
        legacyCandidateCount: legacySelected.length,
        overlapCount: overlap.length,
        concordant: defectDetected === false && (overlap.length > 0 || planResult.candidates.length === 0),
        defectDetected,
        defectReason
      },
      fallbackPolicy: plan?.fallbackPolicy || 'safe_data_gap'
    };
  }
}

/**
 * Strategy Selector
 * Maps structured RetrievalPlan to the optimal RetrievalStrategy.
 * Explicitly derives decision from plan fields without checking rawQuery.
 */
function selectRetrievalStrategy(retrievalPlan, runtimeContext = {}) {
  if (runtimeContext.mode === 'shadow_comparison' || runtimeContext.enableShadowComparison) {
    return new ShadowComparisonStrategy();
  }

  if (retrievalPlan) {
    const trainingStrategy = new StructuredTrainingDataStrategy();
    if (trainingStrategy.supports(retrievalPlan)) {
      return trainingStrategy;
    }
  }

  return new LegacyLexicalStrategy();
}

/**
 * Evaluates candidate evidence against answerability threshold.
 * Separates candidate retrieval from evidence acceptance.
 */
function evaluateRetrievalEvidence(candidates = [], plan = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      answerable: false,
      selectedEvidence: [],
      policy: plan.fallbackPolicy || 'safe_data_gap',
      reason: 'no_candidates_retrieved'
    };
  }

  // Top candidate must be compatible and possess positive entity & domain score
  const top = candidates[0];
  const isCompatible = top.metrics ? Boolean(top.metrics.compatible) : true;
  const entityScore = top.metrics?.entityScore !== undefined ? top.metrics.entityScore : 1.0;
  const domainScore = top.metrics?.domainScore !== undefined ? top.metrics.domainScore : 1.0;

  if (!isCompatible || entityScore < 0.5 || domainScore === 0) {
    return {
      answerable: false,
      selectedEvidence: [],
      policy: plan.fallbackPolicy || 'safe_data_gap',
      reason: 'top_candidate_fails_compatibility_threshold'
    };
  }

  // If the plan itself dictates ambiguity clarification, do not force answerable
  if (plan.fallbackPolicy === 'clarify_ambiguity') {
    return {
      answerable: false,
      selectedEvidence: candidates,
      policy: 'clarify_ambiguity',
      reason: 'plan_policy_requires_clarification'
    };
  }

  return {
    answerable: true,
    selectedEvidence: candidates,
    policy: 'proceed_to_answer',
    reason: 'evidence_compatible'
  };
}

/**
 * High-level Plan-Driven Retrieval Orchestrator
 * Executes: selectRetrievalStrategy -> retrieve -> evaluateRetrievalEvidence -> fallback if needed
 */
async function orchestratePlanDrivenRetrieval(retrievalPlan, runtimeContext = {}) {
  const strategy = selectRetrievalStrategy(retrievalPlan, runtimeContext);
  let result = await strategy.retrieve(retrievalPlan, runtimeContext);

  // Safe fallback to LegacyLexical if non-lexical strategy returned empty
  let fallbackUsed = false;
  if ((!result.candidates || result.candidates.length === 0) && strategy.name !== 'LEGACY_LEXICAL') {
    const fallbackStrategy = new LegacyLexicalStrategy();
    result = await fallbackStrategy.retrieve(retrievalPlan, runtimeContext);
    fallbackUsed = true;
  }

  const evidenceEvaluation = evaluateRetrievalEvidence(result.candidates, retrievalPlan);

  return {
    strategyName: strategy.name,
    fallbackUsed,
    candidates: result.candidates,
    stats: result.stats,
    evidenceEvaluation,
    comparison: result.comparison || null,
    plan: retrievalPlan
  };
}

module.exports = {
  BaseRetrievalStrategy,
  LegacyLexicalStrategy,
  StructuredTrainingDataStrategy,
  ShadowComparisonStrategy,
  selectRetrievalStrategy,
  evaluateRetrievalEvidence,
  orchestratePlanDrivenRetrieval,
  invalidateRetrievalStrategyCache
};
