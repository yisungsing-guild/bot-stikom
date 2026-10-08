'use strict';

/**
 * tests/phase2TurnConcurrency.test.js
 *
 * Dedicated regression test suite for Turn Lifecycle Concurrency & Settlement Gate.
 * Validates:
 * A. Phase2 completes before timeout -> Phase2 wins, exactly 1 dispatch, Phase1 fallback not used
 * B. Phase2 times out -> Phase1 fallback wins, exactly 1 dispatch, processTurn returns within timeout budget, late Phase2 cannot dispatch
 * C. Late Phase2 completion after fallback -> zero additional dispatch, zero session commit, zero answer replacement
 * D. Session state after timeout -> identical to state produced by valid fallback lifecycle, no late Phase2 mutation
 * E. Phase2 failure before timeout -> single fallback, exactly 1 dispatch
 * F. Phase2 failure after timeout -> ignored as stale/late, no side effect
 * G. Repeated timeout/fallback signals -> only first terminal owner wins
 * H. Concurrent Phase2 success + timeout boundary -> exactly one owner, exactly one dispatch
 * I. User-facing completion time -> assert processTurn does not await stale Phase2 completion
 * J. Existing successful Phase2 smoke probes -> remain unchanged
 */

const { processTurn } = require('../src/core/orchestrator');
const plannerModule = require('../src/reasoning/phase2Planner');
const outboundDispatcher = require('../src/core/outboundDispatcher');
const { getSession, updateSession } = require('../src/core/conversationState');
const { createTurnController, TURN_STATUS } = require('../src/reasoning/turnController');

describe('Phase 2 Turn Lifecycle Concurrency & Settlement Gate', () => {
  const originalEnv = process.env.ENABLE_PHASE2_REASONING;
  const originalShadow = process.env.PHASE2_SHADOW_MODE;
  const originalBuildPlan = plannerModule.buildExecutionPlan;
  let dispatchSpy;
  beforeAll(async () => {
    // Warm up deterministic retrieval engine & vector index cache to isolate turn-budget measurement from disk I/O cold-start
    await processTurn('test_warmup_' + Date.now(), 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: false });
  }, 15000);

  beforeEach(() => {
    process.env.ENABLE_PHASE2_REASONING = 'true';
    delete process.env.PHASE2_SHADOW_MODE;
    plannerModule.buildExecutionPlan = originalBuildPlan;
    dispatchSpy = jest.spyOn(outboundDispatcher, 'sendOutboundMessage').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    process.env.ENABLE_PHASE2_REASONING = originalEnv;
    if (originalShadow !== undefined) {
      process.env.PHASE2_SHADOW_MODE = originalShadow;
    } else {
      delete process.env.PHASE2_SHADOW_MODE;
    }
    plannerModule.buildExecutionPlan = originalBuildPlan;
    jest.restoreAllMocks();
  });

  // TEST A
  test('A. Phase2 completes before timeout -> Phase2 wins, exactly 1 dispatch, Phase1 fallback not used', async () => {
    const chatId = 'test_conc_a_' + Date.now();
    jest.spyOn(plannerModule, 'buildExecutionPlan').mockResolvedValue({
      success: true,
      plan: {
        planType: 'AMBIGUOUS_CLARIFICATION',
        clarificationOptions: [
          { canonical: 'S1 Sistem Informasi' },
          { canonical: 'S1 Teknologi Informasi' }
        ]
      }
    });

    const result = await processTurn(chatId, 'Berapa biaya kuliah?', { executeDispatch: true });

    expect(result).toBeDefined();
    expect(result.phase2Meta).toBeDefined();
    expect(result.phase2Meta.handledBy).toBe('phase2_bridge');
    expect(result.phase2Meta.fallbackTriggered).toBe(false);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(chatId, result.finalAnswer);
  });

  // TEST B
  test('B. Phase2 times out -> Phase1 fallback wins, exactly 1 dispatch, processTurn returns within 2500ms budget', async () => {
    const chatId = 'test_conc_b_' + Date.now();
    let deferredPhase2Resolve;
    const slowPhase2Promise = new Promise((resolve) => {
      deferredPhase2Resolve = resolve;
    });

    const origBuildPlan = plannerModule.buildExecutionPlan;
    plannerModule.buildExecutionPlan = jest.fn().mockImplementation(async (...args) => {
      // Delay Phase 2 beyond turn execution cutoff
      await slowPhase2Promise;
      return origBuildPlan.apply(plannerModule, args);
    });

    const tStart = Date.now();
    // processTurn will hit execution cutoff and fall back to Phase 1
    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: true });
    const turnElapsed = Date.now() - tStart;

    // Must return strictly within the 2500ms turn budget
    expect(turnElapsed).toBeLessThanOrEqual(2500);
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Clean up background promise
    deferredPhase2Resolve();
  });

  // TEST C
  test('C. Late Phase2 completion after fallback -> zero additional dispatch, zero session commit, zero answer replacement', async () => {
    const chatId = 'test_conc_c_' + Date.now();
    let deferredPhase2Resolve;
    const slowPhase2Promise = new Promise((resolve) => {
      deferredPhase2Resolve = resolve;
    });

    const origBuildPlan = plannerModule.buildExecutionPlan;
    plannerModule.buildExecutionPlan = jest.fn().mockImplementation(async (...args) => {
      await slowPhase2Promise;
      return origBuildPlan.apply(plannerModule, args);
    });

    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: true });
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const fallbackAnswer = result.finalAnswer;
    const sessionAfterFallback = await getSession(chatId);
    expect(sessionAfterFallback).toBeDefined();

    // Now resolve the slow Phase 2 promise in the background
    deferredPhase2Resolve();
    // Allow background event loop cycles to settle
    await new Promise((r) => setTimeout(r, 100));

    // INVARIANTS: Late Phase 2 must NOT dispatch again and must NOT mutate session
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const sessionAfterLatePhase2 = await getSession(chatId);
    expect(sessionAfterLatePhase2.data.lastAnswer).toBe(fallbackAnswer);
  });

  // TEST D
  test('D. Session state after timeout -> identical to state produced by valid fallback lifecycle, no late Phase2 mutation', async () => {
    const chatId = 'test_conc_d_' + Date.now();
    let deferredResolve;
    const slowPromise = new Promise((r) => { deferredResolve = r; });

    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(async () => {
      await slowPromise;
      return {
        success: true,
        plan: {
          planType: 'DIRECT',
          contextDelta: {
            resolvedState: {
              activeDomain: 'unauthorized_late_domain',
              activeEntity: 'unauthorized_late_entity'
            }
          }
        }
      };
    });

    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: false });
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');

    const sessionAtCutover = await getSession(chatId);
    expect(sessionAtCutover.activeEntity).not.toBe('unauthorized_late_entity');

    // Release late Phase 2 execution
    deferredResolve();
    await new Promise((r) => setTimeout(r, 100));

    const sessionAfterLateExecution = await getSession(chatId);
    expect(sessionAfterLateExecution.activeEntity).not.toBe('unauthorized_late_entity');
    expect(sessionAfterLateExecution.activeDomain).toBe(sessionAtCutover.activeDomain);
  });

  // TEST E
  test('E. Phase2 failure before timeout -> single fallback, exactly 1 dispatch', async () => {
    const chatId = 'test_conc_e_' + Date.now();
    jest.spyOn(plannerModule, 'buildExecutionPlan').mockRejectedValue(new Error('immediate_planner_crash'));

    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: true });

    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  // TEST F
  test('F. Phase2 failure after timeout -> ignored as stale/late, no side effect', async () => {
    const chatId = 'test_conc_f_' + Date.now();
    let deferredReject;
    const slowPromise = new Promise((_, reject) => { deferredReject = reject; });

    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(async () => {
      await slowPromise;
    });

    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: true });
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    // Reject late Phase 2 promise in background
    deferredReject(new Error('late_delayed_crash'));
    await new Promise((r) => setTimeout(r, 100));

    // No uncaught exception, no secondary dispatch
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  // TEST G
  test('G. Repeated timeout/fallback signals -> only first terminal owner wins', () => {
    const turn = createTurnController({ timeoutMs: 2500 });
    expect(turn.status).toBe(TURN_STATUS.OPEN);

    const firstWin = turn.tryAcceptFallback('first_timeout');
    expect(firstWin).toBe(true);
    expect(turn.status).toBe(TURN_STATUS.FALLBACK_ACCEPTED);

    // Second fallback call must be rejected as redundant
    const secondWin = turn.tryAcceptFallback('second_timeout');
    expect(secondWin).toBe(false);

    // Phase 2 accept attempt must be rejected
    const phase2Win = turn.tryAcceptPhase2();
    expect(phase2Win).toBe(false);
    expect(turn.status).toBe(TURN_STATUS.FALLBACK_ACCEPTED);

    // Dispatch permission
    expect(turn.canDispatch('fallback')).toBe(true);
    // Second dispatch permission must be rejected
    expect(turn.canDispatch('fallback')).toBe(false);
    expect(turn.canDispatch('phase2')).toBe(false);
  });

  // TEST H
  test('H. Concurrent Phase2 success + timeout boundary -> exactly one owner, exactly one dispatch', () => {
    const turn = createTurnController({ timeoutMs: 2500 });

    // Simulate Phase 2 winning right before timeout
    const p2Won = turn.tryAcceptPhase2();
    expect(p2Won).toBe(true);
    expect(turn.status).toBe(TURN_STATUS.PHASE2_ACCEPTED);

    // Timeout occurs immediately after
    const fbWon = turn.tryAcceptFallback('timeout_at_boundary');
    expect(fbWon).toBe(false);
    expect(turn.status).toBe(TURN_STATUS.PHASE2_ACCEPTED);

    // Only Phase 2 can dispatch, and exactly once
    expect(turn.canDispatch('phase2')).toBe(true);
    expect(turn.canDispatch('phase2')).toBe(false);
    expect(turn.canDispatch('fallback')).toBe(false);
  });

  // TEST I
  test('I. User-facing completion time -> assert processTurn does not await stale Phase2 completion', async () => {
    const chatId = 'test_conc_i_' + Date.now();
    let deferredResolve;
    const hangingPromise = new Promise((resolve) => {
      deferredResolve = resolve;
    });
    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(() => hangingPromise);

    const start = Date.now();
    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?', { executeDispatch: false });
    const duration = Date.now() - start;

    // Measurement covers: start of processTurn -> Phase 2 timeout -> fallback ownership -> fallback answer -> final return boundary
    expect(result).toBeDefined();
    expect(result.turnControl).toBeDefined();
    expect(result.turnControl.isFallbackAccepted()).toBe(true);
    expect(result.turnControl.winner).toBe('fallback');
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(result.finalAnswer).toBeTruthy();
    // Must return strictly within the 2500ms turn budget (elapsedMs <= 2500)
    expect(duration).toBeLessThanOrEqual(2500);

    // Clean up hanging promise
    deferredResolve();
  });

  // TEST J
  test('J. Existing successful Phase2 smoke probes -> remain unchanged', async () => {
    const chatId = 'test_conc_j_' + Date.now();
    const result = await processTurn(chatId, 'Apa perbedaan Sistem Informasi dan Sistem Komputer?', { executeDispatch: false });

    expect(result).toBeDefined();
    expect(result.phase2Meta).toBeDefined();
    expect(['phase2_bridge', 'phase2_task_graph']).toContain(result.phase2Meta.handledBy);
    expect(result.phase2Meta.fallbackTriggered).toBe(false);
    expect(result.finalAnswer).toMatch(/S1 Sistem Informasi/i);
    expect(result.finalAnswer).toMatch(/S1 Sistem Komputer/i);
  });
});
