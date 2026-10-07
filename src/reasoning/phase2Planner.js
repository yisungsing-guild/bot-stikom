'use strict';

/**
 * src/reasoning/phase2Planner.js
 * 
 * Phase 2 Initial Planning Layer (Step 1 Implementation).
 * 
 * Invariants:
 * 1. Derives execution plans with strict validation from contracts.js.
 * 2. Rejects invalid plans and prevents unsupported factual claims from entering the plan.
 * 3. Ambiguity policy:
 *    - If sessionData has activeEntity: INHERIT CONTEXT.
 *    - If sessionData lacks activeEntity and query requires program disambiguation:
 *      AMBIGUOUS_CLARIFICATION with authoritative options from canonical registry.
 * 4. Preserves verified entity and context fields from Phase 1 without mutation.
 */

const {
  PLAN_TYPE,
  ENTITY_PROVENANCE,
  getAuthoritativeProgramOptions,
  validateExecutionPlan
} = require('./contracts');
const { resolveSemanticFrame } = require('../core/semanticFrameResolver');
const { CANONICAL_ENTITIES, findCanonicalEntity } = require('../engine/canonicalEntityRegistry');
const { computeContextDelta } = require('./contextRepair');

// Queries that require a specific program entity to give an accurate answer
const AMBIGUITY_INDUCING_INTENTS = new Set([
  'TUITION_FEE',
  'ACADEMIC_CURRICULUM',
  'ACADEMIC_PROGRAM',
  'ADMISSION_REQUIREMENTS'
]);

const AMBIGUOUS_FEE_REGEX = /^(?:berapa\s+)?(?:biaya(?:nya)?|uang\s+kuliah|spp(?:nya)?|tarif(?:nya)?|bayar(?:nya)?)\s*\??$/i;
const AMBIGUOUS_REQUIREMENT_REGEX = /^(?:apa\s+saja\s+)?(?:syarat(?:nya)?|persyaratan(?:nya)?|dokumen(?:nya)?)\s*\??$/i;
const AMBIGUOUS_CURRICULUM_REGEX = /^(?:apa\s+saja\s+)?(?:mata\s+kuliah(?:nya)?|matkul(?:nya)?|kurikulum(?:nya)?|belajar\s+apa)\s*\??$/i;

/**
 * Detects whether a query is ambiguous and lacks an entity discriminator
 */
function isAmbiguousEntityInquiry(rawQuery, semanticFrame) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (AMBIGUOUS_FEE_REGEX.test(q) || AMBIGUOUS_REQUIREMENT_REGEX.test(q) || AMBIGUOUS_CURRICULUM_REGEX.test(q)) {
    return true;
  }
  // If domain is fee or curriculum but zero entities detected
  if ((semanticFrame.domain === 'TUITION_FEE' || semanticFrame.domain === 'ACADEMIC_CURRICULUM') &&
      (!semanticFrame.entities || semanticFrame.entities.length === 0)) {
    return true;
  }
  return false;
}

/**
 * Builds an initial validated ExecutionPlan for inbound query
 */
function buildExecutionPlan(rawQuery, sessionData = {}, options = {}) {
  const query = String(rawQuery || '').trim();
  if (!query) {
    return {
      success: false,
      error: 'empty_query',
      plan: null
    };
  }

  // 1. Resolve semantic frame via Phase 1 core (deterministic)
  const semanticFrame = resolveSemanticFrame(query, sessionData);

  // 2. Compute explicit Context Delta (Step 4 integration)
  const contextDelta = computeContextDelta({ data: sessionData }, { rawQuery: query, semanticFrame });
  const deltaState = contextDelta.resolvedState || {};

  const entities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const contextActiveEntity = deltaState.activeEntity || null;

  let planType = PLAN_TYPE.DIRECT;
  let clarificationOptions = [];
  let isAmbiguous = false;
  let targetEntities = contextActiveEntity ? [contextActiveEntity] : [...entities];

  // 3. Ambiguity & Context Inheritance Resolution
  if (isAmbiguousEntityInquiry(query, semanticFrame)) {
    if (contextActiveEntity && typeof contextActiveEntity === 'string') {
      // INHERIT CONTEXT: activeEntity in sessionData provides sufficient discriminator
      targetEntities = [contextActiveEntity];
      planType = PLAN_TYPE.DIRECT;
      isAmbiguous = false;
    } else if (entities.length === 0) {
      // NO ACTIVE CONTEXT: Query is ambiguous. Request clarification with authoritative options.
      planType = PLAN_TYPE.AMBIGUOUS_CLARIFICATION;
      isAmbiguous = true;
      // Scope clarification options according to domain/intent (Constraint 8)
      if (semanticFrame.domain === 'TUITION_FEE') {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 'fee' });
      } else if (semanticFrame.domain === 'ACADEMIC_CURRICULUM' || semanticFrame.domain === 'ACADEMIC_PROGRAM') {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 'all' });
      } else {
        clarificationOptions = getAuthoritativeProgramOptions({ scope: 's1' });
      }
    }
  }

  // 4. Build task graph
  const tasks = [];
  if (planType === PLAN_TYPE.AMBIGUOUS_CLARIFICATION) {
    tasks.push({
      id: 'task_clarify_0',
      stepIndex: 0,
      type: 'CLARIFICATION_TASK',
      query: query,
      targetEntities: [],
      requiredAspects: semanticFrame.aspects || [],
      dependsOn: [],
      verifiedInputs: {
        inheritedEntity: null,
        sessionActiveDomain: sessionData.activeDomain || null
      }
    });
  } else {
    tasks.push({
      id: 'task_0',
      stepIndex: 0,
      type: 'RETRIEVAL_TASK',
      query: semanticFrame.normalizedQuery || query,
      targetEntities: targetEntities,
      requiredAspects: semanticFrame.aspects || [],
      dependsOn: [],
      verifiedInputs: {
        inheritedEntity: contextActiveEntity,
        sessionActiveDomain: sessionData.activeDomain || null
      }
    });
  }

  const isInherited = Boolean(
    contextActiveEntity &&
    (deltaState.entityProvenance === ENTITY_PROVENANCE.INHERITED_FROM_SESSION ||
     (sessionData.activeEntity && targetEntities.includes(sessionData.activeEntity) && entities.length === 0))
  );

  const plan = {
    id: `plan_${Date.now()}`,
    rawQuery: query,
    planType: options.taskGraph ? PLAN_TYPE.MULTI_STEP : planType,
    isAmbiguous,
    clarificationOptions,
    tasks,
    taskGraph: options.taskGraph || null,
    contextDelta: {
      ...contextDelta,
      activeDomain: deltaState.activeDomain || semanticFrame.domain,
      activeEntity: contextActiveEntity,
      inheritedFromSession: isInherited
    },
    metadata: {
      plannerVersion: 'phase2-step5',
      frameDomain: semanticFrame.domain,
      frameIntent: semanticFrame.intent
    }
  };

  // 5. Strict Execution Plan Validation
  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.reason,
      plan: null
    };
  }

  return {
    success: true,
    error: null,
    plan
  };
}

module.exports = {
  buildExecutionPlan,
  isAmbiguousEntityInquiry
};
