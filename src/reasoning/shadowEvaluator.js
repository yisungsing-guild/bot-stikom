'use strict';

/**
 * src/reasoning/shadowEvaluator.js
 *
 * Phase 2 Step 8: Shadow Evaluation Mode (Canary Before Cutover).
 *
 * Invariants:
 * 1. Zero User Impact: User always receives 100% Phase 1 authoritative response.
 * 2. Zero Outbound Dispatch: Shadow execution is forbidden from calling outboundDispatcher.
 * 3. Preventive Read-Only: Shadow execution runs in executionMode: 'SHADOW' with isolated
 *    session snapshots and zero database/session mutation.
 * 4. Dual Safety Gate: assertShadowModeSafety(before, after) verifies zero mutation.
 * 5. Non-Blocking Execution: Shadow execution runs asynchronously without blocking Phase 1.
 * 6. Non-Blocking Telemetry: Telemetry failures are contained within the shadow boundary.
 * 7. Canonical Metrics:
 *    - evidenceOverlapRatio: Strict Jaccard similarity (|A ∩ B| / |A ∪ B|).
 *    - entityMatch: Canonical set equality (order-independent, deduplicated).
 *    - intentMatch: Both primaryDomain AND primaryIntent match (trimmed, case-insensitive).
 */

const {
  TOTAL_TURN_BUDGET_MS,
  createShadowTelemetry,
  assertShadowModeSafety,
  VERIFICATION_OUTCOME
} = require('./contracts');
const { getSession } = require('../core/conversationState');
const { synthesizeAnswer } = require('../core/groundedAnswerGenerator');
const { verifyFinalAnswer } = require('../core/finalAnswerVerifier');
const { executePhase2Bridge } = require('./phase2Bridge');
const logger = require('../logger');

/**
 * Safe Feature Flag Evaluation for Shadow Mode
 * Only 'true' enables shadow mode; unset, false, or malformed resolve to false.
 */
function isPhase2ShadowModeEnabled() {
  const val = process.env.PHASE2_SHADOW_MODE;
  return typeof val === 'string' && val.trim().toLowerCase() === 'true';
}

/**
 * Computes Jaccard Evidence Overlap Ratio between P1 and P2 accepted evidence chunks.
 *
 * Canonical key: String(c.id || c.chunkId || c.hash || '').trim().toLowerCase()
 * Boundary conditions:
 * - both empty => 1.0
 * - exactly one empty => 0.0
 * - otherwise => Number((intersection / union).toFixed(4))
 *
 * @param {Array} p1Evidence
 * @param {Array} p2Evidence
 * @returns {number}
 */
function computeEvidenceOverlapRatio(p1Evidence = [], p2Evidence = []) {
  const setA = new Set();
  const setB = new Set();

  for (const c of (p1Evidence || [])) {
    if (!c) continue;
    const rawKey = (c && typeof c === 'object') ? (c.id || c.chunkId || c.hash || '') : c;
    const key = String(rawKey || '').trim().toLowerCase();
    if (key) setA.add(key);
  }

  for (const c of (p2Evidence || [])) {
    if (!c) continue;
    const rawKey = (c && typeof c === 'object') ? (c.id || c.chunkId || c.hash || '') : c;
    const key = String(rawKey || '').trim().toLowerCase();
    if (key) setB.add(key);
  }

  if (setA.size === 0 && setB.size === 0) {
    return 1.0;
  }

  if (setA.size === 0 || setB.size === 0) {
    return 0.0;
  }

  let intersectionCount = 0;
  for (const key of setA) {
    if (setB.has(key)) {
      intersectionCount++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionCount;
  if (unionSize === 0) return 1.0;

  return Number((intersectionCount / unionSize).toFixed(4));
}

/**
 * Computes canonical Entity Match between P1 and P2 detected entities.
 *
 * Canonical key: String(e.canonical || e.name || e).trim().toLowerCase()
 * Deduplicated with Set, order independent.
 * Empty/empty => true.
 *
 * @param {Array} p1Entities
 * @param {Array} p2Entities
 * @returns {boolean}
 */
function computeEntityMatch(p1Entities = [], p2Entities = []) {
  const setA = new Set();
  const setB = new Set();

  for (const e of (p1Entities || [])) {
    if (!e) continue;
    const rawKey = (e && typeof e === 'object') ? (e.canonical || e.name || e) : e;
    const key = String(rawKey || '').trim().toLowerCase();
    if (key) setA.add(key);
  }

  for (const e of (p2Entities || [])) {
    if (!e) continue;
    const rawKey = (e && typeof e === 'object') ? (e.canonical || e.name || e) : e;
    const key = String(rawKey || '').trim().toLowerCase();
    if (key) setB.add(key);
  }

  if (setA.size !== setB.size) {
    return false;
  }

  for (const key of setA) {
    if (!setB.has(key)) {
      return false;
    }
  }

  return true;
}

/**
 * Computes Intent Match between P1 and P2.
 * True iff BOTH primaryDomain AND primaryIntent match (normalized with trim + lowercase).
 *
 * @param {object} p1Frame
 * @param {object} p2Frame
 * @returns {boolean}
 */
function computeIntentMatch(p1Frame = {}, p2Frame = {}) {
  const d1 = String((p1Frame && (p1Frame.primaryDomain || p1Frame.domain)) || '').trim().toLowerCase();
  const d2 = String((p2Frame && (p2Frame.primaryDomain || p2Frame.domain)) || '').trim().toLowerCase();
  const i1 = String((p1Frame && (p1Frame.primaryIntent || p1Frame.intent)) || '').trim().toLowerCase();
  const i2 = String((p2Frame && (p2Frame.primaryIntent || p2Frame.intent)) || '').trim().toLowerCase();

  return Boolean(d1 === d2 && i1 === i2);
}

/**
 * Extracts accepted evidence items from pipeline result
 */
function extractEvidenceItems(result) {
  const items = [];
  if (!result || typeof result !== 'object') return items;

  if (Array.isArray(result.subQueryResults)) {
    for (const sub of result.subQueryResults) {
      if (sub.arbitrated && Array.isArray(sub.arbitrated.accepted)) {
        items.push(...sub.arbitrated.accepted);
      }
    }
  }

  if (result.graphResult && result.graphResult.consolidatedFacts) {
    for (const fact of Object.values(result.graphResult.consolidatedFacts)) {
      if (Array.isArray(fact.evidenceChunks)) {
        items.push(...fact.evidenceChunks);
      }
    }
  }

  if (result.structuredRecommendation && Array.isArray(result.structuredRecommendation.detectedSignals)) {
    for (const sig of result.structuredRecommendation.detectedSignals) {
      items.push({ id: sig.featureKey || sig.label });
    }
  }

  return items;
}

/**
 * Extracts entities from pipeline result
 */
function extractEntities(result) {
  const entities = [];
  if (!result || typeof result !== 'object') return entities;

  if (Array.isArray(result.subQueryResults)) {
    for (const sub of result.subQueryResults) {
      if (sub.frame && Array.isArray(sub.frame.entities)) {
        entities.push(...sub.frame.entities);
      }
    }
  }

  if (Array.isArray(result.targetEntities)) {
    entities.push(...result.targetEntities);
  }

  if (result.structuredRecommendation && Array.isArray(result.structuredRecommendation.scoredCandidates)) {
    for (const cand of result.structuredRecommendation.scoredCandidates) {
      entities.push({ canonical: cand.canonicalName });
    }
  }

  return entities;
}

/**
 * Extracts domain and intent frame from result
 */
function extractFrame(result) {
  if (!result || typeof result !== 'object') return { domain: '', intent: '' };

  if (Array.isArray(result.subQueryResults) && result.subQueryResults[0] && result.subQueryResults[0].frame) {
    const f = result.subQueryResults[0].frame;
    return {
      domain: f.domain || '',
      intent: f.intent || ''
    };
  }

  if (result.plan) {
    return {
      domain: result.plan.metadata?.frameDomain || '',
      intent: result.plan.metadata?.frameIntent || result.plan.planType || ''
    };
  }

  return { domain: '', intent: '' };
}

/**
 * Synchronous / Direct Evaluator of a shadow turn.
 * Executes Phase 2 in preventive read-only mode (executionMode: 'SHADOW')
 * and produces a validated createShadowTelemetry object.
 *
 * @param {object} params
 * @returns {Promise<object>} ShadowTelemetry record
 */
async function evaluateShadowTurn(params = {}) {
  const {
    chatId,
    rawQuery,
    p1Result,
    p1LatencyMs = 0,
    sessionSnapshot = null,
    phase2BridgeFn = null
  } = params;

  const startTime = Date.now();
  const diffs = [];

  // 1. Capture before-execution session snapshot
  const beforeSnapshot = sessionSnapshot
    ? JSON.parse(JSON.stringify(sessionSnapshot))
    : (chatId ? JSON.parse(JSON.stringify((await getSession(chatId)) || {})) : {});

  const isolatedSnapshot = JSON.parse(JSON.stringify(beforeSnapshot));

  // 2. Execute Phase 2 in strict read-only SHADOW execution mode
  let p2Result = null;
  let p2FactualVerificationPass = false;
  let p2OperationalSafetyPass = false;
  let safeUnknownCount = 0;
  let normalEscalationCount = 0;
  let integrityFailureCount = 0;
  let interceptedFailureCount = 0;
  let p2Error = null;

  try {
    const bridgeRunner = phase2BridgeFn || executePhase2Bridge;
    const p1Pipeline = params.phase1PipelineFn || require('../core/orchestrator').runPhase1DeterministicPipeline;

    const rawBridgeRes = await bridgeRunner(
      chatId,
      rawQuery,
      {
        executionMode: 'SHADOW',
        executeDispatch: false,
        sessionSnapshot: isolatedSnapshot
      },
      p1Pipeline
    );

    p2Result = rawBridgeRes;

    // Handle orchestrator-level synthesis/verification in shadow mode if needed
    if (p2Result) {
      if (p2Result.structuredRecommendation) {
        const recResult = p2Result.structuredRecommendation;
        const topEntity = recResult.scoredCandidates[0]?.canonicalName || null;
        const frame = {
          domain: 'ACADEMIC_RECOMMENDATION',
          intent: 'PROGRAM_RECOMMENDATION',
          rawQuery,
          entities: topEntity ? [{ canonical: topEntity }] : []
        };
        const synthRes = await synthesizeAnswer(frame, {}, null, recResult);
        if (synthRes && synthRes.success && synthRes.answer) {
          const verifRes = verifyFinalAnswer(synthRes.answer, frame, {}, null, recResult);
          const isFactual = verifRes && (verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL ||
            (verifRes.pass === true && verifRes.outcome !== VERIFICATION_OUTCOME.SAFE_UNKNOWN && verifRes.outcome !== VERIFICATION_OUTCOME.ESCALATION_GUIDANCE));
          p2FactualVerificationPass = Boolean(isFactual);
          p2OperationalSafetyPass = Boolean(verifRes && (verifRes.handledSafely || verifRes.outcome !== VERIFICATION_OUTCOME.VERIFICATION_FAILED));
          if (!p2OperationalSafetyPass || (verifRes && verifRes.outcome === VERIFICATION_OUTCOME.VERIFICATION_FAILED)) {
            integrityFailureCount++;
          }
          if (verifRes) {
            if (verifRes.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN) {
              safeUnknownCount++;
            } else if (verifRes.outcome === VERIFICATION_OUTCOME.ESCALATION_GUIDANCE) {
              if (verifRes.interceptedFrom === VERIFICATION_OUTCOME.VERIFICATION_FAILED || verifRes.isInterception) {
                interceptedFailureCount++;
                integrityFailureCount++;
              } else {
                normalEscalationCount++;
              }
            }
          }
          p2Result.finalAnswer = synthRes.answer;
        } else {
          p2FactualVerificationPass = false;
          p2OperationalSafetyPass = false;
          integrityFailureCount++;
        }
      } else if (p2Result.comparisonEnvelope) {
        const targetEntities = p2Result.targetEntities || [];
        const frame = { domain: 'ACADEMIC_PROGRAM', intent: 'ask_program_comparison', entities: targetEntities };
        const synthRes = await synthesizeAnswer(frame, {}, p2Result.comparisonEnvelope);
        if (synthRes && synthRes.success && synthRes.answer) {
          const verifRes = verifyFinalAnswer(synthRes.answer, frame, {}, p2Result.comparisonEnvelope);
          const isFactual = verifRes && (verifRes.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL ||
            (verifRes.pass === true && verifRes.outcome !== VERIFICATION_OUTCOME.SAFE_UNKNOWN && verifRes.outcome !== VERIFICATION_OUTCOME.ESCALATION_GUIDANCE));
          p2FactualVerificationPass = Boolean(isFactual);
          p2OperationalSafetyPass = Boolean(verifRes && (verifRes.handledSafely || verifRes.outcome !== VERIFICATION_OUTCOME.VERIFICATION_FAILED));
          if (!p2OperationalSafetyPass || (verifRes && verifRes.outcome === VERIFICATION_OUTCOME.VERIFICATION_FAILED)) {
            integrityFailureCount++;
          }
          if (verifRes) {
            if (verifRes.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN) {
              safeUnknownCount++;
            } else if (verifRes.outcome === VERIFICATION_OUTCOME.ESCALATION_GUIDANCE) {
              if (verifRes.interceptedFrom === VERIFICATION_OUTCOME.VERIFICATION_FAILED || verifRes.isInterception) {
                interceptedFailureCount++;
                integrityFailureCount++;
              } else {
                normalEscalationCount++;
              }
            }
          }
          p2Result.finalAnswer = synthRes.answer;
        } else {
          p2FactualVerificationPass = false;
          p2OperationalSafetyPass = false;
          integrityFailureCount++;
        }
      } else if (Array.isArray(p2Result.subQueryResults)) {
        if (p2Result.subQueryResults.length === 0) {
          p2FactualVerificationPass = Boolean(p2Result.finalAnswer);
          p2OperationalSafetyPass = Boolean(p2Result.finalAnswer);
        } else {
          p2FactualVerificationPass = true;
          p2OperationalSafetyPass = true;

          for (const s of p2Result.subQueryResults) {
            const v = s.verification;
            if (!v) {
              if (!s.answer) {
                p2OperationalSafetyPass = false;
                p2FactualVerificationPass = false;
              }
              continue;
            }

            const isFactual = v.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL ||
              (v.pass === true && v.outcome !== VERIFICATION_OUTCOME.SAFE_UNKNOWN && v.outcome !== VERIFICATION_OUTCOME.ESCALATION_GUIDANCE);
            if (!isFactual) {
              p2FactualVerificationPass = false;
            }

            if (!v.handledSafely || v.outcome === VERIFICATION_OUTCOME.VERIFICATION_FAILED) {
              p2OperationalSafetyPass = false;
              integrityFailureCount++;
            }

            if (v.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN) {
              safeUnknownCount++;
            } else if (v.outcome === VERIFICATION_OUTCOME.ESCALATION_GUIDANCE) {
              if (v.interceptedFrom === VERIFICATION_OUTCOME.VERIFICATION_FAILED || v.isInterception) {
                interceptedFailureCount++;
                integrityFailureCount++;
              } else {
                normalEscalationCount++;
              }
            }
          }
        }
      } else {
        p2FactualVerificationPass = Boolean(p2Result.finalAnswer);
        p2OperationalSafetyPass = Boolean(p2Result.finalAnswer);
      }
    }
  } catch (err) {
    p2Error = err;
    diffs.push(`phase2_execution_exception: ${err.message}`);
  }

  const p2LatencyMs = Date.now() - startTime;

  // 3. Second Safety Gate: Assert zero session mutation
  const afterSnapshot = sessionSnapshot
    ? JSON.parse(JSON.stringify(sessionSnapshot))
    : (chatId ? JSON.parse(JSON.stringify((await getSession(chatId)) || {})) : {});

  assertShadowModeSafety(beforeSnapshot, afterSnapshot);

  // 4. Comparative Metrics Calculation
  const p1Evidence = extractEvidenceItems(p1Result);
  const p2Evidence = p2Result ? extractEvidenceItems(p2Result) : [];
  const evidenceOverlapRatio = computeEvidenceOverlapRatio(p1Evidence, p2Evidence);

  const p1Entities = extractEntities(p1Result);
  const p2Entities = p2Result ? extractEntities(p2Result) : [];
  const entityMatch = computeEntityMatch(p1Entities, p2Entities);
  if (!entityMatch) {
    diffs.push('entity_mismatch');
  }

  const p1Frame = extractFrame(p1Result);
  const p2Frame = p2Result ? extractFrame(p2Result) : { domain: '', intent: '' };
  const intentMatch = computeIntentMatch(p1Frame, p2Frame);
  if (!intentMatch) {
    diffs.push('intent_mismatch');
  }

  const p2VerificationPass = p2OperationalSafetyPass;

  if (!p2OperationalSafetyPass) {
    diffs.push('p2_safety_failure');
    diffs.push('p2_verification_failure');
  }

  // Regression definition: P1 produced a valid verified answer, but P2 threw error or failed safety
  const p1Success = Boolean(p1Result && p1Result.finalAnswer && !p1Result.error);
  const safetyRegressionDetected = Boolean(p1Success && (!p2Result || !p2OperationalSafetyPass || p2Error));

  const p1FactualPass = Boolean(
    p1Result?.subQueryResults?.length > 0
      ? p1Result.subQueryResults.every(s =>
          s.verification?.pass === true &&
          (s.verification?.outcome === VERIFICATION_OUTCOME.VERIFIED_FACTUAL ||
           (s.verification?.outcome !== VERIFICATION_OUTCOME.SAFE_UNKNOWN && s.verification?.outcome !== VERIFICATION_OUTCOME.ESCALATION_GUIDANCE))
        )
      : p1Result?.finalAnswer
  );

  const p1HasAcceptedEvidence = p1Evidence.length > 0;
  const p2HasAcceptedEvidence = p2Evidence.length > 0;

  // Did P1 have any subquery where evidence was explicitly grounded?
  const p1HasGroundedEvidence = Boolean(
    p1HasAcceptedEvidence && (
      p1Result?.subQueryResults?.length > 0
        ? p1Result.subQueryResults.some(s => s.verification?.isGrounded === true || (s.acceptedCount > 0 && s.verification?.pass))
        : true
    )
  );

  const p2HasSafeUnknown = Boolean(
    safeUnknownCount > 0 ||
    p2Result?.subQueryResults?.some(s => s.verification?.outcome === VERIFICATION_OUTCOME.SAFE_UNKNOWN || s.answerability === 'UNKNOWN')
  );

  const isUnsupportedEntity = Boolean(
    p2Result?.subQueryResults?.some(s => s.status === 'unsupported_program' || s.frame?.unsupportedEntity || s.frame?.isUnsupportedEntity) ||
    p1Result?.subQueryResults?.some(s => s.status === 'unsupported_program' || s.frame?.unsupportedEntity || s.frame?.isUnsupportedEntity)
  );

  const isCorpusGap = Boolean(
    !p2HasAcceptedEvidence && (
      p2Result?.subQueryResults?.some(s => s.status === 'corpus_gap' || s.answerability === 'UNKNOWN') ||
      p2HasSafeUnknown
    )
  );

  const isJustifiedRefusal = p2HasSafeUnknown && (!p2HasAcceptedEvidence) && (isCorpusGap || isUnsupportedEntity);

  // Grounded refusal difference: P2 safely abstains because evidence is absent (corpus gap or unsupported program),
  // while P1 produced an answer without trusted grounded evidence, or on an unsupported entity.
  const groundedRefusalDifference = Boolean(
    isJustifiedRefusal && (!p1HasGroundedEvidence || isUnsupportedEntity)
  );

  // Factual regression: P1 had verified factual answer, P2 failed factual verification,
  // and this was NOT a justified safe refusal for proven corpus gap or unsupported entity.
  const factualRegressionDetected = Boolean(
    p1FactualPass && !p2FactualVerificationPass && !groundedRefusalDifference
  );

  const p1Answerable = Boolean(
    p1Result?.subQueryResults?.length > 0
      ? p1Result.subQueryResults.some(s => s.answerability === 'ANSWERABLE')
      : Boolean(p1Result?.finalAnswer)
  );
  const p2Answerable = Boolean(
    p2Result?.subQueryResults?.length > 0
      ? p2Result.subQueryResults.some(s => s.answerability === 'ANSWERABLE')
      : Boolean(p2Result?.finalAnswer && !p2HasSafeUnknown)
  );

  const answerabilityDifference = Boolean(p1Answerable !== p2Answerable);
  const answerabilityRegressionDetected = Boolean(
    p1Answerable && !p2Answerable && !groundedRefusalDifference
  );

  if (groundedRefusalDifference) {
    diffs.push('grounded_refusal_difference');
  }
  if (answerabilityDifference && !diffs.includes('answerability_difference')) {
    diffs.push('answerability_difference');
  }
  if (factualRegressionDetected && !diffs.includes('factual_regression')) {
    diffs.push('factual_regression');
  }

  const regressionDetected = Boolean(safetyRegressionDetected || (p1Success && !p2Result));

  // 5. Build official telemetry payload
  return createShadowTelemetry({
    rawQuery: rawQuery || '',
    p1Answer: p1Result?.finalAnswer || '',
    p2Answer: p2Result?.finalAnswer || '',
    p1LatencyMs,
    p2LatencyMs,
    entityMatch,
    intentMatch,
    evidenceOverlapRatio,
    p2FactualVerificationPass,
    p2OperationalSafetyPass,
    p2HandledSafely: p2OperationalSafetyPass,
    safeUnknownCount,
    normalEscalationCount,
    integrityFailureCount,
    interceptedFailureCount,
    safetyRegressionDetected,
    factualRegressionDetected,
    answerabilityRegressionDetected,
    groundedRefusalDifference,
    answerabilityDifference,
    p2VerificationPass,
    regressionDetected,
    diffs
  });
}

/**
 * Asynchronous, non-blocking shadow evaluation runner with isolated failure handling.
 * Invoked from orchestrator without awaiting on the Phase 1 critical path.
 *
 * @param {object} params
 */
async function runShadowEvaluationSafely(params = {}) {
  try {
    const telemetry = await evaluateShadowTurn(params);
    try {
      logger.info(telemetry, '[PHASE2_SHADOW] Telemetry');
    } catch (logErr) {
      // Telemetry logging failure is completely suppressed
    }
    return telemetry;
  } catch (err) {
    // Shadow evaluation error is contained; never throws to caller
    try {
      logger.warn({ err: err.message }, '[PHASE2_SHADOW] Shadow evaluation error contained');
    } catch (_) {}
    return null;
  }
}

module.exports = {
  isPhase2ShadowModeEnabled,
  computeEvidenceOverlapRatio,
  computeEntityMatch,
  computeIntentMatch,
  evaluateShadowTurn,
  runShadowEvaluationSafely
};
