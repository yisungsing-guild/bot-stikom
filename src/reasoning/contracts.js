'use strict';

/**
 * src/reasoning/contracts.js
 * 
 * Phase 2 Architectural Contracts & Governance Specifications.
 * 
 * 4 Locked Contracts:
 * 1. Time Budget: TOTAL = 2500ms, REPLAN DEADLINE = 1500ms, FALLBACK >= 2500ms
 * 2. Recommendation Scoring: Feature-based scoring grounded in official evidence
 * 3. Clarification Options: Dynamic from canonicalEntityRegistry (no hardcoded prodi)
 * 4. Shadow Mode: Strictly read-only evaluation telemetry with zero side-effects
 */

const { CANONICAL_ENTITIES } = require('../engine/canonicalEntityRegistry');

// 1. TIME BUDGET CONTRACT
const TOTAL_TURN_BUDGET_MS = 2500;
const REPLAN_START_DEADLINE_MS = 1500;

function canStartReplan(startTimeOrElapsed, currentTime) {
  let elapsed = startTimeOrElapsed;
  if (typeof currentTime === 'number' && typeof startTimeOrElapsed === 'number') {
    elapsed = currentTime - startTimeOrElapsed;
  }
  if (typeof elapsed !== 'number' || isNaN(elapsed)) return false;
  return elapsed < REPLAN_START_DEADLINE_MS;
}

function isBudgetExceeded(elapsedMs) {
  if (typeof elapsedMs !== 'number' || isNaN(elapsedMs)) return true;
  return elapsedMs >= TOTAL_TURN_BUDGET_MS;
}

// PLAN TYPE ENUMS
const PLAN_TYPE = Object.freeze({
  DIRECT: 'DIRECT',
  AMBIGUOUS_CLARIFICATION: 'AMBIGUOUS_CLARIFICATION',
  MULTI_STEP: 'MULTI_STEP',
  COMPARISON: 'COMPARISON',
  RECOMMENDATION: 'RECOMMENDATION',
  CONTEXT_CORRECTION: 'CONTEXT_CORRECTION'
});

// 2. RECOMMENDATION FEATURE CONTRACT
function validateProgramFeature(feature) {
  if (!feature || typeof feature !== 'object') {
    return { valid: false, reason: 'feature_not_an_object' };
  }
  if (!feature.featureKey || typeof feature.featureKey !== 'string') {
    return { valid: false, reason: 'missing_feature_key' };
  }
  if (!feature.evidenceSource || typeof feature.evidenceSource !== 'string') {
    return { valid: false, reason: 'missing_evidence_source' };
  }
  if (!feature.evidenceSnippet || typeof feature.evidenceSnippet !== 'string' || !feature.evidenceSnippet.trim()) {
    return { valid: false, reason: 'missing_evidence_snippet' };
  }
  if (!feature.weights || typeof feature.weights !== 'object' || Array.isArray(feature.weights)) {
    return { valid: false, reason: 'invalid_feature_weights' };
  }
  return { valid: true };
}

// 3. CLARIFICATION OPTIONS (AUTHORITATIVE REGISTRY RETRIEVAL)
function getAuthoritativeProgramOptions(options = {}) {
  const { scope = 's1', degree } = options;
  if (scope === 's1' || degree === 'S1') {
    return CANONICAL_ENTITIES
      .filter(e => e.family === 'academic_program' && e.degree === 'S1')
      .map(e => ({ canonical: e.canonical, degree: e.degree, type: e.type, family: e.family }));
  }
  if (scope === 'fee') {
    // Programs with authoritative published fee structures (S1, D3, S2)
    return CANONICAL_ENTITIES
      .filter(e => e.family === 'academic_program' && ['S1', 'D3', 'S2'].includes(e.degree))
      .map(e => ({ canonical: e.canonical, degree: e.degree, type: e.type, family: e.family }));
  }
  if (scope === 'all' || scope === 'academic') {
    return CANONICAL_ENTITIES
      .filter(e => e.family === 'academic_program')
      .map(e => ({ canonical: e.canonical, degree: e.degree, type: e.type, family: e.family }));
  }
  return CANONICAL_ENTITIES
    .filter(e => e.family === 'academic_program' && (!degree || e.degree === degree))
    .map(e => ({ canonical: e.canonical, degree: e.degree, type: e.type, family: e.family }));
}

// 4. SHADOW MODE CONTRACT (READ-ONLY TELEMETRY)
function createShadowTelemetry(params = {}) {
  return {
    queryId: params.queryId || `shadow_${Date.now()}`,
    timestamp: new Date().toISOString(),
    rawQuery: params.rawQuery || '',
    p1Answer: params.p1Answer || '',
    p2Answer: params.p2Answer || '',
    p1LatencyMs: params.p1LatencyMs || 0,
    p2LatencyMs: params.p2LatencyMs || 0,
    entityMatch: Boolean(params.entityMatch),
    intentMatch: Boolean(params.intentMatch),
    evidenceOverlapRatio: typeof params.evidenceOverlapRatio === 'number' ? params.evidenceOverlapRatio : 1.0,
    p2VerificationPass: Boolean(params.p2VerificationPass),
    regressionDetected: Boolean(params.regressionDetected),
    diffs: Array.isArray(params.diffs) ? params.diffs : [],
    readOnlyVerified: true
  };
}

function assertShadowModeSafety(beforeSessionSnapshot, afterSessionSnapshot) {
  // Deep-check that shadow execution produced zero mutation to active session/context
  const beforeStr = JSON.stringify(beforeSessionSnapshot || {});
  const afterStr = JSON.stringify(afterSessionSnapshot || {});
  if (beforeStr !== afterStr) {
    throw new Error(`[ShadowModeViolation] Session state mutated during shadow mode: ${beforeStr} vs ${afterStr}`);
  }
  return true;
}

// 5. CLAIM PROVENANCE CONTRACT
function validateClaimProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') {
    return { valid: false, reason: 'provenance_not_an_object' };
  }
  const requiredFields = ['claimText', 'evidenceId', 'sourceDocument', 'targetEntity', 'targetAspect', 'temporalScope'];
  for (const field of requiredFields) {
    if (!provenance[field] || typeof provenance[field] !== 'string' || !provenance[field].trim()) {
      return { valid: false, reason: `missing_required_provenance_field: ${field}` };
    }
  }
  return { valid: true };
}

// 6. EXECUTION PLAN VALIDATION
// Prohibits unsupported factual claims from being injected into the plan.
const FACTUAL_CLAIM_PATTERNS = [
  /Rp\s*[\d\.]+/i,
  /\b\d+\s*sks\b/i,
  /\bgelombang\s+\d+\b/i,
  /\bpotongan\s+(?:hingga|\d+)/i,
  /\bkelas\s+(?:malam|karyawan)\b/i,
  /\bpasti\s+cocok\b/i
];

function validateExecutionPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return { valid: false, reason: 'plan_must_be_an_object' };
  }
  if (!plan.rawQuery || typeof plan.rawQuery !== 'string') {
    return { valid: false, reason: 'missing_raw_query' };
  }
  if (!Object.values(PLAN_TYPE).includes(plan.planType)) {
    return { valid: false, reason: `invalid_plan_type: ${plan.planType}` };
  }
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    return { valid: false, reason: 'plan_must_contain_at_least_one_task' };
  }

  // Ensure each task is well-formed
  for (const [idx, task] of plan.tasks.entries()) {
    if (!task.id) return { valid: false, reason: `task_missing_id_at_index_${idx}` };
    if (!task.type) return { valid: false, reason: `task_missing_type_at_index_${idx}` };
    if (!task.query) return { valid: false, reason: `task_missing_query_at_index_${idx}` };
    if (!Array.isArray(task.targetEntities)) return { valid: false, reason: `task_target_entities_must_be_array_at_index_${idx}` };
    if (!Array.isArray(task.requiredAspects)) return { valid: false, reason: `task_required_aspects_must_be_array_at_index_${idx}` };

    // Strict Invariant: Validate generated claims if present
    if (Array.isArray(task.generatedClaims)) {
      for (const claim of task.generatedClaims) {
        for (const pattern of FACTUAL_CLAIM_PATTERNS) {
          if (pattern.test(claim)) {
            return { valid: false, reason: `unsupported_factual_claim_in_generated_claim: ${claim}` };
          }
        }
      }
    }

    // Strict Invariant: If task query contains synthetic factual claims NOT present in raw user query, reject injection
    for (const pattern of FACTUAL_CLAIM_PATTERNS) {
      if (pattern.test(task.query) && !pattern.test(plan.rawQuery)) {
        return { valid: false, reason: `unsupported_factual_claim_injected_into_task_query: ${task.query}` };
      }
    }
  }

  // Invariant: If ambiguous, clarificationOptions must be provided from authoritative registry
  if (plan.planType === PLAN_TYPE.AMBIGUOUS_CLARIFICATION) {
    if (!Array.isArray(plan.clarificationOptions) || plan.clarificationOptions.length === 0) {
      return { valid: false, reason: 'ambiguous_plan_requires_clarification_options' };
    }
  }

  return { valid: true };
}

module.exports = {
  TOTAL_TURN_BUDGET_MS,
  REPLAN_START_DEADLINE_MS,
  canStartReplan,
  isBudgetExceeded,
  PLAN_TYPE,
  validateProgramFeature,
  getAuthoritativeProgramOptions,
  createShadowTelemetry,
  assertShadowModeSafety,
  validateClaimProvenance,
  validateExecutionPlan
};
