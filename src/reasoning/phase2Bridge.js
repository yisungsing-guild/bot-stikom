'use strict';

/**
 * src/reasoning/phase2Bridge.js
 * 
 * Phase 2 Step 2 & 3: Orchestrator Handoff, Phase 1 Bridge, Bounded Reflection & Replan.
 * 
 * Strict Invariants:
 * 1. Safe Feature Flag: ENABLE_PHASE2_REASONING=true to enable, false/unknown treats as false.
 * 2. Single Source of Truth: Never duplicates Phase 1 retrieval, arbiter, or verifier.
 * 3. Exactly One Fallback: On exception or timeout, falls back to Phase 1 exactly once. Zero double dispatch.
 * 4. Backward-Compatible Response Contract: Preserves response shape expected by consumers.
 * 5. Bounded Reflection: Maksimal 1 replan per turn, hanya dijalankan jika elapsedMs < 1500ms.
 * 6. Provenance Continuity: Factual claims must be backed by accepted evidence.
 */

const {
  TOTAL_TURN_BUDGET_MS,
  REPLAN_START_DEADLINE_MS,
  GRAPH_EXECUTION_DEADLINE_MS,
  GRAPH_RESERVED_FINALIZATION_MS,
  PLAN_TYPE,
  GRAPH_COMPLETION_STATE
} = require('./contracts');
const { executeTaskGraph } = require('./taskGraphExecutor');
const plannerModule = require('./phase2Planner');
const { getSession, updateSession } = require('../core/conversationState');
const outboundDispatcher = require('../core/outboundDispatcher');
const { verifyFinalAnswer } = require('../core/finalAnswerVerifier');
const { synthesizeAnswer } = require('../core/groundedAnswerGenerator');
const { ANSWERABILITY_STATUS } = require('../core/answerabilityGate');
const boundedReflection = require('./boundedReflection');
const { createTurnController } = require('./turnController');
const logger = require('../logger');

/**
 * Safe Feature Flag Evaluation
 * Only 'true' enables Phase 2; undefined, empty, 'false', or malformed values resolve to false.
 */
function isPhase2Enabled() {
  const val = process.env.ENABLE_PHASE2_REASONING;
  return typeof val === 'string' && val.trim().toLowerCase() === 'true';
}

/**
 * Executes a turn through Phase 2 Bridge with strict timeout, reflection, and Phase 1 fallback guarantee.
 * 
 * @param {string} chatId
 * @param {string} rawQuery
 * @param {object} options
 * @param {function} phase1PipelineFn - The deterministic Phase 1 pipeline runner
 */
async function executePhase2Bridge(chatId, rawQuery, options = {}, phase1PipelineFn) {
  const startTime = Date.now();
  const isShadowMode = Boolean(options && options.executionMode === 'SHADOW');
  const shouldDispatch = Boolean(options && options.executeDispatch) && !isShadowMode;
  const turnControl = options.turnControl || createTurnController({ timeoutMs: TOTAL_TURN_BUDGET_MS });
  const internalOptions = { ...options, executeDispatch: false, turnControl, signal: turnControl.signal };
  let timedOut = false;

  // Execution cutoff uses existing frozen REPLAN_START_DEADLINE_MS (1500ms) authority,
  // leaving adequate finalization/fallback budget (1000ms) to ensure processTurn completes <= TOTAL_TURN_BUDGET_MS (2500ms)
  const bridgeTimeoutMs = options.timeoutMs || REPLAN_START_DEADLINE_MS;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      turnControl.tryAcceptFallback(`phase2_timeout_budget_exceeded_${bridgeTimeoutMs}ms`);
      reject(new Error(`phase2_timeout_budget_exceeded_${bridgeTimeoutMs}ms`));
    }, bridgeTimeoutMs);
  });

  const executionPromise = (async () => {
    // 1. Read-only session snapshot
    const session = (options && options.sessionSnapshot)
      ? JSON.parse(JSON.stringify(options.sessionSnapshot))
      : await getSession(chatId);
    const sessionData = session ? (session.data || {}) : {};

    // 2. Build execution plan via Phase 2 planner
    const planResult = await plannerModule.buildExecutionPlan(rawQuery, sessionData, { ...options, startTime });
    if (!planResult || !planResult.success || !planResult.plan) {
      throw new Error(`invalid_plan: ${planResult ? planResult.error : 'null_plan'}`);
    }

    const { plan } = planResult;

    // 3. Ambiguous Clarification Handling (Step 1/2 Scope)
    if (plan.planType === PLAN_TYPE.AMBIGUOUS_CLARIFICATION) {
      const optionsList = (plan.clarificationOptions || [])
        .map((opt, idx) => `${idx + 1}. ${opt.canonical}`)
        .join('\n');

      const clarificationAnswer = `Untuk memberikan informasi yang tepat, program studi mana yang ingin Kakak tanyakan?\n\n${optionsList}\n\nSilakan sebutkan nama program studi di atas.`;

      // Verification via Phase 1 Universal Verifier
      const verification = verifyFinalAnswer(clarificationAnswer, { rawQuery, entities: [] }, {});
      if (!verification.pass) {
        throw new Error(`clarification_verifier_failure: ${verification.reason}`);
      }

      // Atomically claim terminal Phase 2 acceptance before committing or dispatching
      const won = turnControl.tryAcceptPhase2();
      if (!won) {
        return null;
      }

      // Safe session state update (only after verification passed and not in shadow mode)
      if (!isShadowMode && chatId && turnControl.canCommitSession('phase2')) {
        await updateSession(chatId, {
          dataPatch: {
            lastQuery: rawQuery,
            lastAnswer: clarificationAnswer
          }
        });
      }

      // Single Outbound Dispatch if requested
      if (shouldDispatch && chatId && turnControl.canDispatch('phase2')) {
        await outboundDispatcher.sendOutboundMessage(chatId, clarificationAnswer);
      }

      const subQueryResult = {
        frame: { domain: 'GENERAL', intent: 'AMBIGUOUS_CLARIFICATION', entities: [] },
        plan,
        candidatesCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        answerability: ANSWERABILITY_STATUS.ANSWERABLE,
        answer: clarificationAnswer,
        verification
      };

      return {
        chatId,
        rawQuery,
        subQueryResults: [subQueryResult],
        finalAnswer: clarificationAnswer,
        turnControl,
        phase2Meta: {
          handledBy: 'phase2_bridge',
          planType: plan.planType,
          replan: {
            replanExecuted: false,
            replanDecision: boundedReflection.REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
            replanAttempts: 0
          },
          latencyMs: Date.now() - startTime,
          fallbackTriggered: false
        }
      };
    }

    // 3.5 Step 7: Deterministic Recommendation Engine Handling
    // phase2Bridge owns task execution, recommendation result packaging, and context delta preparation only.
    // Natural language rendering, verification, fallback, context commit, and outbound dispatch are owned by orchestrator.
    if (plan.planType === PLAN_TYPE.RECOMMENDATION) {
      const { evaluateRecommendation } = require('./recommendationEngine');
      const recResult = evaluateRecommendation(rawQuery, options);

      const topEntity = recResult.scoredCandidates[0]?.canonicalName || null;
      const subQueryResult = {
        frame: { domain: 'ACADEMIC_RECOMMENDATION', intent: 'PROGRAM_RECOMMENDATION', entities: topEntity ? [{ canonical: topEntity }] : [] },
        plan,
        candidatesCount: recResult.scoredCandidates.length,
        acceptedCount: recResult.detectedSignals.length,
        rejectedCount: 0,
        answerability: ANSWERABILITY_STATUS.ANSWERABLE
      };

      const won = turnControl.tryAcceptPhase2();
      if (!won) {
        return null;
      }

      return {
        chatId,
        rawQuery,
        subQueryResults: [subQueryResult],
        structuredRecommendation: recResult,
        plan,
        turnControl,
        phase2Meta: {
          handledBy: 'phase2_recommendation_engine',
          planType: plan.planType,
          presentationType: recResult.presentationType,
          replan: {
            replanExecuted: false,
            replanDecision: boundedReflection.REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
            replanAttempts: 0
          },
          latencyMs: Date.now() - startTime,
          fallbackTriggered: false
        }
      };
    }

    // 4. Step 5: Multi-Step Task Graph Execution
    if (plan.taskGraph) {
      const graphResult = await executeTaskGraph(plan.taskGraph, {
        phase1BridgeFn: async (queryText, queryOpts = {}) => {
          const subRes = await phase1PipelineFn(chatId, queryText, { ...internalOptions, executeDispatch: false });
          const firstSub = (subRes.subQueryResults && subRes.subQueryResults[0]) || {};
          const accepted = (firstSub.arbitrated && firstSub.arbitrated.accepted) || [];
          return {
            answerability: firstSub.answerability || 'UNKNOWN',
            acceptedEvidence: accepted.map(c => ({
              chunkId: c.id || c.chunkId || 'chunk',
              chunkHash: c.hash || 'hash',
              source: c.source || 'doc',
              sourceAuthority: c.sourceAuthority || c.source || 'SK_PMB',
              confidenceScore: c.confidenceScore || 0.9
            })),
            verifiedEntities: (firstSub.frame && firstSub.frame.entities) ? firstSub.frame.entities.map(e => e.canonical || String(e)) : (queryOpts.targetEntity ? [queryOpts.targetEntity] : []),
            verifiedAspects: (firstSub.frame && firstSub.frame.aspects) || (queryOpts.aspects || []),
            structuredFacts: firstSub.structuredFacts || {}
          };
        },
        replanBridgeFn: async (node, graph) => {
          const replanQuery = node.input.queryText || rawQuery;
          const replanSubRes = await phase1PipelineFn(chatId, replanQuery, { ...internalOptions, executeDispatch: false });
          const firstSub = (replanSubRes.subQueryResults && replanSubRes.subQueryResults[0]) || {};
          const accepted = (firstSub.arbitrated && firstSub.arbitrated.accepted) || [];
          if (accepted.length > 0 && firstSub.answerability === 'ANSWERABLE') {
            return {
              status: 'SUCCEEDED',
              output: {
                verifiedEntities: (firstSub.frame && firstSub.frame.entities) ? firstSub.frame.entities.map(e => e.canonical || String(e)) : (node.input.targetEntity ? [node.input.targetEntity] : []),
                verifiedAspects: (firstSub.frame && firstSub.frame.aspects) || (node.input.aspects || []),
                structuredFacts: firstSub.structuredFacts || {},
                acceptedEvidence: accepted.map(c => ({
                  chunkId: c.id || c.chunkId || 'chunk',
                  chunkHash: c.hash || 'hash',
                  source: c.source || 'doc',
                  sourceAuthority: c.sourceAuthority || c.source || 'SK_PMB',
                  confidenceScore: c.confidenceScore || 0.9
                })),
                answerability: firstSub.answerability
              }
            };
          }
          return { status: 'INSUFFICIENT_EVIDENCE' };
        }
      });

      if (graphResult.completionState === GRAPH_COMPLETION_STATE.TIMEOUT_GRAPH) {
        throw new Error('graph_execution_timeout');
      }

      const isSuccessfulGraph = [GRAPH_COMPLETION_STATE.COMPLETE_SUCCESS, GRAPH_COMPLETION_STATE.PARTIAL_COMPLETION].includes(graphResult.completionState);

      let finalGraphAnswer = '';
      let comparisonEnvelope = null;
      let targetEntities = [];
      let isComparative = false;

      if (isSuccessfulGraph) {
        // Check if plan or graph contains a comparative evaluation request
        isComparative = (plan.planType === PLAN_TYPE.COMPARATIVE_EVALUATION) ||
          (plan.taskGraph && plan.taskGraph.goalType === 'COMPARISON') ||
          (plan.comparisonRequest && plan.comparisonRequest.enabled);

        if (isComparative) {
          const { buildComparisonMatrix, compileRenderPlan } = require('./comparativeSynthesis');
          targetEntities = plan.comparisonRequest?.targetEntities ||
            plan.taskGraph?.targetEntities ||
            [];
          const requestedAspects = plan.comparisonRequest?.requestedAspects ||
            plan.taskGraph?.requestedAspects ||
            [];

          // Group consolidatedFacts by entity
          const factsByEntity = {};
          for (const ent of targetEntities) {
            factsByEntity[ent] = [];
          }
          for (const fact of Object.values(graphResult.consolidatedFacts || {})) {
            const ent = fact.entity;
            if (ent && factsByEntity[ent]) {
              factsByEntity[ent].push({
                aspect: fact.aspect,
                value: fact.value,
                presence: 'PRESENT'
              });
            }
          }

          const matrix = buildComparisonMatrix({
            comparedEntities: targetEntities,
            requestedAspects,
            factsByEntity,
            scopedConflicts: graphResult.scopedConflicts || []
          });

          const renderPlan = compileRenderPlan(matrix);

          comparisonEnvelope = Object.freeze({
            mode: 'COMPARATIVE',
            matrix,
            renderPlan
          });
        } else {
          const factsText = Object.values(graphResult.consolidatedFacts || {}).map(f => `${f.aspect}: ${JSON.stringify(f.value)}`).join(', ');
          finalGraphAnswer = factsText || 'Informasi berhasil diproses.';
        }
      } else {
        // Graph did not succeed -> zero session mutation
        finalGraphAnswer = 'Maaf, informasi yang diminta belum dapat dipenuhi secara lengkap.';
      }

      const won = turnControl.tryAcceptPhase2();
      if (!won) {
        return null;
      }

      if (isSuccessfulGraph && !isComparative) {
        // Atomic session persistence (Step 4 & Step 5) for non-comparative graph tasks
        if (!isShadowMode && chatId && plan.contextDelta && plan.contextDelta.resolvedState && turnControl.canCommitSession('phase2')) {
          const deltaState = plan.contextDelta.resolvedState;
          await updateSession(chatId, {
            dataPatch: {
              activeDomain: deltaState.activeDomain,
              activeEntity: deltaState.activeEntity,
              preservedBackgroundEntity: deltaState.preservedBackgroundEntity,
              entityProvenance: deltaState.entityProvenance,
              lastQuery: rawQuery,
              lastAnswer: finalGraphAnswer
            }
          });
        }
      }

      if (!isComparative && shouldDispatch && chatId && finalGraphAnswer && turnControl.canDispatch('phase2')) {
        await outboundDispatcher.sendOutboundMessage(chatId, finalGraphAnswer);
      }

      return {
        chatId,
        rawQuery,
        graphResult,
        comparisonEnvelope,
        targetEntities,
        plan,
        turnControl,
        finalAnswer: finalGraphAnswer,
        phase2Meta: {
          handledBy: 'phase2_task_graph',
          planType: plan.planType,
          completionState: graphResult.completionState,
          allGoalsSatisfied: graphResult.allGoalsSatisfied,
          latencyMs: Date.now() - startTime,
          fallbackTriggered: false
        }
      };
    }

    // 5. Standard Handoff to Phase 1 Deterministic Execution Core
    // Phase 1 executes retrieval, arbitration, answerability, synthesis, & verification
    const phase1Result = await phase1PipelineFn(chatId, rawQuery, internalOptions);

    let replanMetadata = {
      replanExecuted: false,
      replanDecision: boundedReflection.REPLAN_DECISION.NO_REPLAN_SUFFICIENT,
      replanAttempts: 0,
      newEvidenceFound: false
    };

    // 5. Step 3: Bounded Reflection & Controlled Replan
    if (Array.isArray(phase1Result.subQueryResults)) {
      for (const sub of phase1Result.subQueryResults) {
        const sufficiency = boundedReflection.evaluateEvidenceSufficiency(
          sub.frame,
          sub.arbitrated || { accepted: [] },
          { status: sub.answerability, missingAspects: (sub.arbitrated && sub.arbitrated.missingAspects) || [] }
        );

        if (!sufficiency.sufficient) {
          const replanResult = await boundedReflection.executeBoundedReplan({
            semanticFrame: sub.frame,
            initialPlan: sub.plan,
            initialArbitrated: sub.arbitrated || { accepted: [] },
            initialAnswerability: { status: sub.answerability },
            startTime,
            replanAttempts: replanMetadata.replanAttempts
          });

          replanMetadata = {
            replanExecuted: replanResult.replanExecuted,
            replanDecision: replanResult.decision,
            replanAttempts: replanResult.replanExecuted ? 1 : 0,
            newEvidenceFound: replanResult.newEvidenceFound || false
          };

          if (replanResult.newEvidenceFound && replanResult.arbitrated) {
            // Re-synthesize answer with the newly acquired verified evidence
            const synthesis = await synthesizeAnswer(sub.frame, replanResult.arbitrated);
            if (synthesis.success && synthesis.answer) {
              const verification = verifyFinalAnswer(synthesis.answer, sub.frame, replanResult.arbitrated);
              if (verification.pass) {
                sub.answer = synthesis.answer;
                sub.verification = verification;
                sub.answerability = replanResult.answerability.status;
                sub.acceptedCount = replanResult.arbitrated.accepted.length;
              }
            }
          }
          break; // Bounded Invariant: exactly 1 replan attempt per turn
        }
      }

      // Re-assemble finalAnswer if replan updated any subquery answer
      phase1Result.finalAnswer = phase1Result.subQueryResults.map(r => r.answer).filter(Boolean).join('\n\n');
    }

    const won = turnControl.tryAcceptPhase2();
    if (!won) {
      return null;
    }

    // Atomically commit context delta to session only after verified completion (Step 4)
    if (!isShadowMode && chatId && plan.contextDelta && plan.contextDelta.resolvedState && turnControl.canCommitSession('phase2')) {
      const deltaState = plan.contextDelta.resolvedState;
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: deltaState.activeDomain,
          activeEntity: deltaState.activeEntity,
          preservedBackgroundEntity: deltaState.preservedBackgroundEntity,
          entityProvenance: deltaState.entityProvenance,
          lastQuery: rawQuery,
          lastAnswer: phase1Result.finalAnswer
        }
      });
    }

    // Single Outbound Dispatch if requested
    if (shouldDispatch && chatId && phase1Result.finalAnswer && turnControl.canDispatch('phase2')) {
      await outboundDispatcher.sendOutboundMessage(chatId, phase1Result.finalAnswer);
    }

    // Attach backward-compatible Phase 2 metadata
    phase1Result.turnControl = turnControl;
    phase1Result.phase2Meta = {
      handledBy: 'phase2_bridge',
      planType: plan.planType,
      replan: replanMetadata,
      latencyMs: Date.now() - startTime,
      fallbackTriggered: false
    };

    return phase1Result;
  })();

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (!result) {
      throw new Error(turnControl.fallbackReason || 'phase2_superseded_by_fallback');
    }
    result.turnControl = turnControl;
    return result;
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    turnControl.tryAcceptFallback(err.message);

    logger.warn({
      chatId,
      error: err.message,
      timedOut: timedOut || Boolean(err.message && err.message.includes('timeout')),
      elapsedMs: Date.now() - startTime
    }, '[Phase2Bridge] Phase 2 failed or timed out; executing single fallback to Phase 1');

    // Single Fallback to Phase 1 Core (Zero double dispatch)
    const fallbackOptions = {
      ...options,
      executeDispatch: shouldDispatch,
      turnControl,
      fastFallback: true
    };
    const fallbackResult = await phase1PipelineFn(chatId, rawQuery, fallbackOptions);
    fallbackResult.turnControl = turnControl;
    fallbackResult.phase2Meta = {
      handledBy: 'phase1_fallback',
      reason: err.message,
      latencyMs: Date.now() - startTime,
      fallbackTriggered: true
    };
    return fallbackResult;
  }
}

module.exports = {
  isPhase2Enabled,
  executePhase2Bridge
};
