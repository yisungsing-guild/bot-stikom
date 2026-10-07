'use strict';

/**
 * src/reasoning/phase2Bridge.js
 * 
 * Phase 2 Step 2: Orchestrator Handoff & Phase 1 Bridge.
 * 
 * Constraints:
 * 1. Safe Feature Flag: ENABLE_PHASE2_REASONING=true to enable, false/unknown treats as false.
 * 2. Single Source of Truth: Never duplicates Phase 1 retrieval, arbiter, or verifier.
 * 3. Exactly One Fallback: On exception or timeout, falls back to Phase 1 exactly once. Zero double response.
 * 4. Backward-Compatible Response Contract: Preserves response shape expected by consumers.
 * 5. Session State Safety: Session state remains consistent; never corrupted on fallback.
 */

const { TOTAL_TURN_BUDGET_MS, PLAN_TYPE } = require('./contracts');
const plannerModule = require('./phase2Planner');
const { getSession, updateSession } = require('../core/conversationState');
const outboundDispatcher = require('../core/outboundDispatcher');
const { verifyFinalAnswer } = require('../core/finalAnswerVerifier');
const { ANSWERABILITY_STATUS } = require('../core/answerabilityGate');
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
 * Executes a turn through Phase 2 Bridge with strict timeout and Phase 1 fallback guarantee.
 * 
 * @param {string} chatId
 * @param {string} rawQuery
 * @param {object} options
 * @param {function} phase1PipelineFn - The deterministic Phase 1 pipeline runner
 */
async function executePhase2Bridge(chatId, rawQuery, options = {}, phase1PipelineFn) {
  const startTime = Date.now();
  const shouldDispatch = Boolean(options && options.executeDispatch);
  const internalOptions = { ...options, executeDispatch: false };
  let timedOut = false;

  // Global turn timeout Promise race against TOTAL_TURN_BUDGET_MS
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error(`phase2_timeout_budget_exceeded_${TOTAL_TURN_BUDGET_MS}ms`));
    }, TOTAL_TURN_BUDGET_MS);
  });

  const executionPromise = (async () => {
    // 1. Read-only session snapshot
    const session = await getSession(chatId);
    const sessionData = session ? (session.data || {}) : {};

    // 2. Build execution plan via Phase 2 planner
    const planResult = await plannerModule.buildExecutionPlan(rawQuery, sessionData, { startTime });
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

      // Safe session state update (only after verification passed)
      await updateSession(chatId, {
        dataPatch: {
          lastQuery: rawQuery,
          lastAnswer: clarificationAnswer
        }
      });

      // Single Outbound Dispatch if requested
      if (shouldDispatch && chatId) {
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
        phase2Meta: {
          handledBy: 'phase2_bridge',
          planType: plan.planType,
          latencyMs: Date.now() - startTime,
          fallbackTriggered: false
        }
      };
    }

    // 4. Standard Handoff to Phase 1 Deterministic Execution Core
    // Phase 1 executes retrieval, arbitration, answerability, synthesis, & verification
    const phase1Result = await phase1PipelineFn(chatId, rawQuery, internalOptions);

    // Single Outbound Dispatch if requested
    if (shouldDispatch && chatId && phase1Result.finalAnswer) {
      await outboundDispatcher.sendOutboundMessage(chatId, phase1Result.finalAnswer);
    }

    // Attach backward-compatible Phase 2 metadata
    phase1Result.phase2Meta = {
      handledBy: 'phase2_bridge',
      planType: plan.planType,
      latencyMs: Date.now() - startTime,
      fallbackTriggered: false
    };

    return phase1Result;
  })();

  try {
    const result = await Promise.race([executionPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return result;
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    logger.warn({
      chatId,
      error: err.message,
      timedOut,
      elapsedMs: Date.now() - startTime
    }, '[Phase2Bridge] Phase 2 failed or timed out; executing single fallback to Phase 1');

    // Single Fallback to Phase 1 Core (Zero double dispatch)
    const fallbackResult = await phase1PipelineFn(chatId, rawQuery, { ...options, executeDispatch: shouldDispatch });
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
