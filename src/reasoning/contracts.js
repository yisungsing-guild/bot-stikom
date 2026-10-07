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

// 5. CONTEXT REPAIR & DELTA CONTRACT (STEP 4)
const CONTEXT_ACTION = Object.freeze({
  ENTITY_ADDED: 'entity_added',
  ENTITY_REMOVED: 'entity_removed',
  ENTITY_REPLACED: 'entity_replaced',
  DOMAIN_ADDED: 'domain_added',
  DOMAIN_REPLACED: 'domain_replaced',
  ASPECT_ADDED: 'aspect_added',
  ASPECT_REPLACED: 'aspect_replaced',
  TEMPORAL_CONSTRAINT_ADDED: 'temporal_constraint_added',
  TEMPORAL_CONSTRAINT_REPLACED: 'temporal_constraint_replaced',
  CONTEXT_PRESERVED: 'context_preserved',
  CONTEXT_RESET: 'context_reset',
  AMBIGUITY_DETECTED: 'ambiguity_detected'
});

const ENTITY_PROVENANCE = Object.freeze({
  EXPLICIT_CURRENT_TURN: 'explicit_current_turn',
  INHERITED_FROM_SESSION: 'inherited_from_session',
  DERIVED_COMPOSITE: 'derived_composite',
  NONE: 'none'
});

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL baseline

const CAMPUS_WIDE_DOMAINS = Object.freeze([
  'FACILITIES',
  'ORGANIZATION',
  'SCHOLARSHIP',
  'SCHEDULE',
  'PMB_SCHEDULE',
  'CAMPUS_LIFE',
  'GENERAL_ADMISSION'
]);

function validateContextDelta(delta) {
  if (!delta || typeof delta !== 'object') {
    return { valid: false, reason: 'delta_not_an_object' };
  }
  if (!Array.isArray(delta.actions)) {
    return { valid: false, reason: 'delta_actions_must_be_array' };
  }
  const validActionValues = new Set(Object.values(CONTEXT_ACTION));
  for (const act of delta.actions) {
    if (!validActionValues.has(act)) {
      return { valid: false, reason: `invalid_context_action: ${act}` };
    }
  }
  if (!delta.resolvedState || typeof delta.resolvedState !== 'object') {
    return { valid: false, reason: 'missing_resolved_state' };
  }
  if (delta.resolvedState.activeEntity && !Object.values(ENTITY_PROVENANCE).includes(delta.resolvedState.entityProvenance)) {
    return { valid: false, reason: `invalid_entity_provenance: ${delta.resolvedState.entityProvenance}` };
  }
  return { valid: true };
}

// 6. MULTI-STEP TASK GRAPH / TASK DAG CONTRACTS (STEP 5)
const TASK_TYPE = Object.freeze({
  RETRIEVAL_QUERY: 'RETRIEVAL_QUERY',
  DETERMINISTIC_TRANSFORM: 'DETERMINISTIC_TRANSFORM',
  EVIDENCE_AGGREGATION: 'EVIDENCE_AGGREGATION'
});

const TASK_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  READY: 'READY',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
});

const TASK_CRITICALITY = Object.freeze({
  REQUIRED: 'REQUIRED',
  OPTIONAL: 'OPTIONAL'
});

const NODE_CONTROL_SIGNAL = Object.freeze({
  NONE: 'NONE',
  REPLAN_REQUESTED: 'REPLAN_REQUESTED'
});

const EXECUTION_POLICY = Object.freeze({
  FAIL_FAST: 'FAIL_FAST',
  BEST_EFFORT: 'BEST_EFFORT'
});

const GRAPH_COMPLETION_STATE = Object.freeze({
  PENDING: 'PENDING',
  COMPLETE_SUCCESS: 'COMPLETE_SUCCESS',
  PARTIAL_COMPLETION: 'PARTIAL_COMPLETION',
  FAILED_GRAPH: 'FAILED_GRAPH',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  TIMEOUT_GRAPH: 'TIMEOUT_GRAPH',
  INVALID_TOPOLOGY: 'INVALID_TOPOLOGY'
});

const TRANSFORM_OPERATION = Object.freeze({
  FILTER: 'FILTER',
  SORT: 'SORT',
  MERGE: 'MERGE',
  ARITHMETIC: 'ARITHMETIC'
});

const FACT_TYPE = Object.freeze({
  VERIFIED_FACT: 'VERIFIED_FACT',
  DERIVED_FACT: 'DERIVED_FACT'
});

const MAX_GRAPH_NODES = 5;
const MAX_GRAPH_DEPTH = 3;
const NODE_EFFECTIVE_BUDGET_MS = 600;
const GRAPH_EXECUTION_DEADLINE_MS = 2100;
const GRAPH_RESERVED_FINALIZATION_MS = 400;

/**
 * Validates that a value is completely JSON-serializable, finite, and contains
 * no executable functions, symbols, promises, class instances, or circular references.
 */
function isFiniteJSONSafe(value, seen = new WeakSet()) {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false; // Rejects functions, symbols, undefined

  // Reject specialized built-in objects/classes
  if (value instanceof Date || value instanceof RegExp || value instanceof Map ||
      value instanceof Set || value instanceof Promise || value instanceof Error) {
    return false;
  }

  // Reject circular references
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.every(item => isFiniteJSONSafe(item, seen));
  }

  // Reject custom prototype class instances (must be plain object)
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  return Object.keys(value).every(key => isFiniteJSONSafe(value[key], seen));
}

/**
 * Derives directed edges strictly from dependsOn.
 * Single source of truth is node.dependsOn.
 */
function deriveEdges(nodesMap) {
  const edges = [];
  const nodes = nodesMap instanceof Map ? nodesMap : new Map(Object.entries(nodesMap || {}));
  for (const [taskId, node] of nodes.entries()) {
    if (Array.isArray(node.dependsOn)) {
      for (const depId of node.dependsOn) {
        edges.push({ from: depId, to: taskId });
      }
    }
  }
  return edges;
}

/**
 * Computes canonical topological depth of graph nodes.
 * root node = 1, A->B = 2, A->B->C = 3.
 */
function computeTopologicalDepth(nodesMap) {
  const nodes = nodesMap instanceof Map ? nodesMap : new Map(Object.entries(nodesMap || {}));
  const depthMemo = new Map();
  const visiting = new Set();

  function getDepth(taskId) {
    if (visiting.has(taskId)) {
      return Infinity; // Cycle detected
    }
    if (depthMemo.has(taskId)) {
      return depthMemo.get(taskId);
    }
    const node = nodes.get(taskId);
    if (!node || !Array.isArray(node.dependsOn) || node.dependsOn.length === 0) {
      depthMemo.set(taskId, 1);
      return 1;
    }
    visiting.add(taskId);
    let maxParentDepth = 0;
    for (const depId of node.dependsOn) {
      const parentDepth = getDepth(depId);
      if (parentDepth === Infinity) return Infinity;
      if (parentDepth > maxParentDepth) {
        maxParentDepth = parentDepth;
      }
    }
    visiting.delete(taskId);
    const nodeDepth = 1 + maxParentDepth;
    depthMemo.set(taskId, nodeDepth);
    return nodeDepth;
  }

  let maxGraphDepth = 0;
  for (const taskId of nodes.keys()) {
    const d = getDepth(taskId);
    if (d === Infinity) return Infinity;
    if (d > maxGraphDepth) {
      maxGraphDepth = d;
    }
  }
  return maxGraphDepth;
}

/**
 * Validates a structured fact object against strict factKey and value contract.
 */
function validateStructuredFact(dictKey, fact) {
  if (!fact || typeof fact !== 'object') {
    return { valid: false, reason: 'fact_not_an_object' };
  }
  if (!fact.factKey || typeof fact.factKey !== 'string') {
    return { valid: false, reason: 'missing_fact_key' };
  }
  if (fact.factKey !== dictKey) {
    return { valid: false, reason: `fact_key_divergence: dictionary key "${dictKey}" !== fact.factKey "${fact.factKey}"` };
  }
  if (!isFiniteJSONSafe(fact.value)) {
    return { valid: false, reason: `invalid_structured_fact_value_for_${dictKey}: must be finite JSON-safe` };
  }
  if (!fact.entity || typeof fact.entity !== 'string') {
    return { valid: false, reason: `missing_entity_in_fact_${dictKey}` };
  }
  if (!fact.aspect || typeof fact.aspect !== 'string') {
    return { valid: false, reason: `missing_aspect_in_fact_${dictKey}` };
  }
  if (![FACT_TYPE.VERIFIED_FACT, FACT_TYPE.DERIVED_FACT].includes(fact.factType)) {
    return { valid: false, reason: `invalid_fact_type_in_${dictKey}: ${fact.factType}` };
  }
  if (!Array.isArray(fact.sourceAuthorities) || fact.sourceAuthorities.length === 0) {
    return { valid: false, reason: `missing_source_authorities_in_${dictKey}` };
  }
  if (!Array.isArray(fact.evidenceRefs) || fact.evidenceRefs.length === 0) {
    return { valid: false, reason: `missing_evidence_refs_in_${dictKey}` };
  }
  if (!Object.values(ENTITY_PROVENANCE).includes(fact.provenance)) {
    return { valid: false, reason: `invalid_provenance_in_${dictKey}: ${fact.provenance}` };
  }
  if (fact.factType === FACT_TYPE.DERIVED_FACT) {
    if (!fact.transitiveLineage || typeof fact.transitiveLineage !== 'object') {
      return { valid: false, reason: `derived_fact_${dictKey}_missing_transitive_lineage` };
    }
    const lineage = fact.transitiveLineage;
    if (!Array.isArray(lineage.directSourceFactRefs) || lineage.directSourceFactRefs.length === 0) {
      return { valid: false, reason: `derived_fact_${dictKey}_missing_direct_source_fact_refs` };
    }
    if (!Array.isArray(lineage.rootVerifiedFactKeys) || lineage.rootVerifiedFactKeys.length === 0) {
      return { valid: false, reason: `derived_fact_${dictKey}_missing_root_verified_fact_keys` };
    }
    if (!Array.isArray(lineage.rootEvidenceChunkIds) || lineage.rootEvidenceChunkIds.length === 0) {
      return { valid: false, reason: `derived_fact_${dictKey}_missing_root_evidence_chunk_ids` };
    }
    if (!Array.isArray(lineage.derivationSteps) || lineage.derivationSteps.length === 0) {
      return { valid: false, reason: `derived_fact_${dictKey}_missing_derivation_steps` };
    }
  }
  return { valid: true };
}

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

const COMPARISON_GLOBAL_STATE = Object.freeze({
  COMPLETE_COMPARISON: 'COMPLETE_COMPARISON',
  PARTIAL_COMPARISON: 'PARTIAL_COMPARISON',
  CONFLICTED_COMPARISON: 'CONFLICTED_COMPARISON',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  INVALID_COMPARISON: 'INVALID_COMPARISON'
});

const ASPECT_ALIGNMENT_STATUS = Object.freeze({
  ALIGNED: 'ALIGNED',
  INCOMPATIBLE_UNITS: 'INCOMPATIBLE_UNITS',
  INCOMPATIBLE_PERIOD: 'INCOMPATIBLE_PERIOD',
  TEMPORAL_MISMATCH: 'TEMPORAL_MISMATCH',
  TEMPORAL_METADATA_MISSING: 'TEMPORAL_METADATA_MISSING',
  UNSUPPORTED_ASPECT: 'UNSUPPORTED_ASPECT',
  ONE_SIDED_MISSING: 'ONE_SIDED_MISSING',
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  EVIDENCE_CONFLICTED: 'EVIDENCE_CONFLICTED'
});

const COMPARISON_DELTA_TYPE = Object.freeze({
  IDENTICAL: 'IDENTICAL',
  GREATER_THAN: 'GREATER_THAN',
  LESS_THAN: 'LESS_THAN',
  SUPERSET: 'SUPERSET',
  SUBSET: 'SUBSET',
  OVERLAPPING: 'OVERLAPPING',
  DISJOINT: 'DISJOINT',
  DIVERGENT: 'DIVERGENT',
  INCOMPARABLE: 'INCOMPARABLE'
});

const COMPARISON_DIAGNOSTIC_CODE = Object.freeze({
  INCOMPARABLE_ASPECTS: 'INCOMPARABLE_ASPECTS',
  INVALID_SCOPE_OR_ENTITIES: 'INVALID_SCOPE_OR_ENTITIES',
  EMPTY_ASPECTS: 'EMPTY_ASPECTS',
  ENTITY_COUNT_OUT_OF_BOUNDS: 'ENTITY_COUNT_OUT_OF_BOUNDS',
  ENTITY_FAMILY_MISMATCH: 'ENTITY_FAMILY_MISMATCH',
  ZERO_EVIDENCE: 'ZERO_EVIDENCE',
  LINEAGE_VALIDATION_FAILED: 'LINEAGE_VALIDATION_FAILED',
  SIDECAR_OWNERSHIP_MISMATCH: 'SIDECAR_OWNERSHIP_MISMATCH',
  UNRESOLVED_EVIDENCE_CONFLICT: 'UNRESOLVED_EVIDENCE_CONFLICT'
});

const COMPARISON_TEMPLATE_ID = Object.freeze({
  NUMERIC_DIFFERENCE: 'NUMERIC_DIFFERENCE',
  NUMERIC_RANKING_SUMMARY: 'NUMERIC_RANKING_SUMMARY',
  ORDERED_SEQUENCE_DIFF: 'ORDERED_SEQUENCE_DIFF',
  SET_MEMBERSHIP_DIFF: 'SET_MEMBERSHIP_DIFF',
  MULTI_ENTITY_SET_DIFF: 'MULTI_ENTITY_SET_DIFF',
  SCALAR_EQUALITY_DIFF: 'SCALAR_EQUALITY_DIFF',
  ASPECT_NOTICE: 'ASPECT_NOTICE',
  GLOBAL_STATUS_HEADER: 'GLOBAL_STATUS_HEADER'
});

const GLOBAL_STATUS_HEADER_CODE = Object.freeze({
  HEADER_PARTIAL: 'HEADER_PARTIAL',
  HEADER_CONFLICTED: 'HEADER_CONFLICTED',
  HEADER_INSUFFICIENT: 'HEADER_INSUFFICIENT',
  HEADER_INVALID: 'HEADER_INVALID'
});

const PRESENTATION_NOTICE_CODE = Object.freeze({
  NOTICE_DATA_UNAVAILABLE: 'NOTICE_DATA_UNAVAILABLE',
  NOTICE_ASPECT_NOT_APPLICABLE: 'NOTICE_ASPECT_NOT_APPLICABLE',
  NOTICE_DATA_CONFLICT: 'NOTICE_DATA_CONFLICT'
});

const COMPARATIVE_TRANSPORT_VALIDATION_CODE = Object.freeze({
  MALFORMED_TEMPLATE_PARAMS: 'MALFORMED_TEMPLATE_PARAMS',
  MISSING_REQUIRED_TEMPLATE_PARAMS: 'MISSING_REQUIRED_TEMPLATE_PARAMS',
  UNKNOWN_TEMPLATE_PROPERTY: 'UNKNOWN_TEMPLATE_PROPERTY',
  MALFORMED_IDR_VALUE: 'MALFORMED_IDR_VALUE',
  INVALID_RENDER_PLAN_STRUCTURE: 'INVALID_RENDER_PLAN_STRUCTURE',
  RENDER_PLAN_STRUCTURAL_MISMATCH: 'RENDER_PLAN_STRUCTURAL_MISMATCH',
  TRANSPORT_ENVELOPE_MISSING: 'TRANSPORT_ENVELOPE_MISSING',
  SEMANTIC_SIGNAL_CONTRADICTION: 'SEMANTIC_SIGNAL_CONTRADICTION',
  STRUCTURAL_BOUND_EXCEEDED: 'STRUCTURAL_BOUND_EXCEEDED'
});

const COMPUTATION_STATE = Object.freeze({
  VALID_SCOPE: 'VALID_SCOPE',
  INVALID_SCOPE: 'INVALID_SCOPE'
});

const ASPECT_COMPARATOR_REGISTRY = Object.freeze({
  tuition_fee: 'NUMERIC_PERIOD',
  registration_fee: 'NUMERIC_PERIOD',
  dpp_wave: 'NUMERIC_PERIOD',
  spp: 'NUMERIC_PERIOD',
  development_fee: 'NUMERIC_PERIOD',
  total_fee: 'NUMERIC_PERIOD',
  semester_count: 'NUMERIC_PERIOD',
  duration_months: 'NUMERIC_PERIOD',
  credit_count: 'NUMERIC_PERIOD',
  double_degree_sequence: 'ORDERED_SEQUENCE',
  procedure_steps: 'ORDERED_SEQUENCE',
  curriculum_flow: 'ORDERED_SEQUENCE',
  career_opportunities: 'UNORDERED_SET',
  career_prospects: 'UNORDERED_SET',
  job_roles: 'UNORDERED_SET',
  facilities: 'UNORDERED_SET',
  competency_certifications: 'UNORDERED_SET',
  vendor_certifications: 'UNORDERED_SET',
  degree: 'SCALAR_EQUALITY',
  degree_title: 'SCALAR_EQUALITY',
  accreditation: 'SCALAR_EQUALITY',
  study_mode: 'SCALAR_EQUALITY',
  campus_location: 'SCALAR_EQUALITY'
});

module.exports = {
  TOTAL_TURN_BUDGET_MS,
  REPLAN_START_DEADLINE_MS,
  canStartReplan,
  isBudgetExceeded,
  PLAN_TYPE,
  CONTEXT_ACTION,
  ENTITY_PROVENANCE,
  CONTEXT_TTL_MS,
  CAMPUS_WIDE_DOMAINS,
  validateContextDelta,
  TASK_TYPE,
  TASK_STATUS,
  TASK_CRITICALITY,
  NODE_CONTROL_SIGNAL,
  EXECUTION_POLICY,
  GRAPH_COMPLETION_STATE,
  TRANSFORM_OPERATION,
  FACT_TYPE,
  MAX_GRAPH_NODES,
  MAX_GRAPH_DEPTH,
  NODE_EFFECTIVE_BUDGET_MS,
  GRAPH_EXECUTION_DEADLINE_MS,
  GRAPH_RESERVED_FINALIZATION_MS,
  isFiniteJSONSafe,
  deriveEdges,
  computeTopologicalDepth,
  validateStructuredFact,
  validateProgramFeature,
  getAuthoritativeProgramOptions,
  createShadowTelemetry,
  assertShadowModeSafety,
  validateClaimProvenance,
  validateExecutionPlan,
  COMPARISON_GLOBAL_STATE,
  ASPECT_ALIGNMENT_STATUS,
  COMPARISON_DELTA_TYPE,
  COMPARISON_DIAGNOSTIC_CODE,
  COMPARISON_TEMPLATE_ID,
  GLOBAL_STATUS_HEADER_CODE,
  PRESENTATION_NOTICE_CODE,
  COMPARATIVE_TRANSPORT_VALIDATION_CODE,
  ASPECT_COMPARATOR_REGISTRY,
  COMPUTATION_STATE
};
