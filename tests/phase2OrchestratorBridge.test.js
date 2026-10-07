'use strict';

/**
 * tests/phase2OrchestratorBridge.test.js
 * 
 * Phase 2 Step 2: Orchestrator Handoff & Phase 1 Bridge Verification Suite.
 * 
 * Verifies all 8 required Step 2 constraints:
 * A. Feature flag OFF -> Phase 1 behavior unchanged.
 * B. Feature flag ON -> Phase 2 planner called.
 * C. Phase 2 success -> result passed to Phase 1 verification.
 * D. Phase 2 exception -> fallback Phase 1 (single answer).
 * E. Phase 2 timeout -> fallback Phase 1 (single answer).
 * F. No duplicate response -> single processTurn = single outbound result.
 * G. Session state unchanged / consistent on fallback.
 * H. Raw query dengan nominal / tanggal tetap diterima.
 */

const prisma = require('../src/db');
const { processTurn } = require('../src/core/orchestrator');
const { isPhase2Enabled } = require('../src/reasoning/phase2Bridge');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { getSession } = require('../src/core/conversationState');
const outboundDispatcher = require('../src/core/outboundDispatcher');
const plannerModule = require('../src/reasoning/phase2Planner');

// In-memory mock for prisma.session to avoid external DB network latency in test runner
const sessionStore = new Map();
prisma.session = {
  findUnique: jest.fn(async ({ where }) => {
    return sessionStore.get(where.chatId) || null;
  }),
  upsert: jest.fn(async ({ where, update, create }) => {
    const existing = sessionStore.get(where.chatId);
    const saved = existing
      ? {
          chatId: where.chatId,
          state: update.state || existing.state || 'root',
          data: { ...(existing.data || {}), ...((update.data && update.data) || {}) }
        }
      : {
          chatId: where.chatId,
          state: create.state || 'root',
          data: create.data || {}
        };
    sessionStore.set(where.chatId, saved);
    return saved;
  })
};

describe('Phase 2 Step 2: Orchestrator Handoff & Phase 1 Bridge', () => {
  jest.setTimeout(30000);
  const originalEnv = process.env.ENABLE_PHASE2_REASONING;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.ENABLE_PHASE2_REASONING;
    } else {
      process.env.ENABLE_PHASE2_REASONING = originalEnv;
    }
  });

  test('Constraint A: Feature flag OFF -> Phase 1 behavior unchanged', async () => {
    delete process.env.ENABLE_PHASE2_REASONING;
    expect(isPhase2Enabled()).toBe(false);

    const chatId = 'test_ff_off_' + Date.now();
    const result = await processTurn(chatId, 'Apa itu sistem informasi?');

    expect(result.finalAnswer).toMatch(/sistem informasi/i);
    // phase2Meta should not be set because Phase 2 bridge was bypassed
    expect(result.phase2Meta).toBeUndefined();
  });

  test('Constraint A2: Malformed feature flag values resolve strictly to false', () => {
    process.env.ENABLE_PHASE2_REASONING = '1';
    expect(isPhase2Enabled()).toBe(false);

    process.env.ENABLE_PHASE2_REASONING = 'yes';
    expect(isPhase2Enabled()).toBe(false);

    process.env.ENABLE_PHASE2_REASONING = 'TRUE_BUT_EXTRA';
    expect(isPhase2Enabled()).toBe(false);

    process.env.ENABLE_PHASE2_REASONING = 'true';
    expect(isPhase2Enabled()).toBe(true);
  });

  test('Constraint B & C: Feature flag ON -> Phase 2 planner called & results verified', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';
    expect(isPhase2Enabled()).toBe(true);

    const chatId = 'test_ff_on_' + Date.now();
    const result = await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?');

    expect(result.finalAnswer).toMatch(/6\.500\.000/);
    expect(result.phase2Meta).toBeDefined();
    expect(result.phase2Meta.handledBy).toBe('phase2_bridge');
    expect(result.phase2Meta.fallbackTriggered).toBe(false);
  });

  test('Constraint D: Phase 2 exception -> clean fallback to Phase 1 exactly once', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    // Force planner crash via module method spy
    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(() => {
      throw new Error('Simulated Planner Sudden Failure');
    });

    const chatId = 'test_exception_' + Date.now();
    const result = await processTurn(chatId, 'Apa itu sistem komputer?');

    // Must return valid Phase 1 answer without crashing
    expect(result.finalAnswer).toMatch(/sistem komputer/i);
    expect(result.phase2Meta).toBeDefined();
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(result.phase2Meta.reason).toContain('Simulated Planner Sudden Failure');
  });

  test('Constraint E: Phase 2 timeout -> fallback to Phase 1 exactly once', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    // Simulate planner delay exceeding timeout
    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(() => {
      return new Promise((resolve) => setTimeout(resolve, 3500));
    });

    const chatId = 'test_timeout_' + Date.now();
    const result = await processTurn(chatId, 'Apa itu sistem informasi?');

    expect(result.finalAnswer).toMatch(/sistem informasi/i);
    expect(result.phase2Meta).toBeDefined();
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(result.phase2Meta.reason).toMatch(/timeout_budget_exceeded/);
  });

  test('Constraint F: No duplicate response -> exactly one outbound dispatch', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    const dispatchSpy = jest.spyOn(outboundDispatcher, 'sendOutboundMessage').mockResolvedValue({ success: true });

    const chatId = 'test_dispatch_' + Date.now();
    await processTurn(chatId, 'Apa itu teknologi informasi?', { executeDispatch: true });

    // Must dispatch exactly ONCE
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  test('Constraint F2: Fallback scenario also dispatches exactly ONCE', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(() => {
      throw new Error('Crashing before dispatch');
    });

    const dispatchSpy = jest.spyOn(outboundDispatcher, 'sendOutboundMessage').mockResolvedValue({ success: true });

    const chatId = 'test_dispatch_fallback_' + Date.now();
    await processTurn(chatId, 'Apa itu teknologi informasi?', { executeDispatch: true });

    // Must dispatch exactly ONCE
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  test('Constraint G: Session state remains consistent and uncorrupted on fallback', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    jest.spyOn(plannerModule, 'buildExecutionPlan').mockImplementation(() => {
      throw new Error('Simulated Planner Failure');
    });

    const chatId = 'test_session_consistency_' + Date.now();
    await processTurn(chatId, 'Berapa biaya kuliah S1 Teknologi Informasi?');

    const session = await getSession(chatId);
    expect(session).toBeDefined();
    expect(session.data).toBeDefined();
    // activeDomain and activeEntity from Phase 1 path must be intact
    expect(session.data.activeDomain).toBe('TUITION_FEE');
    expect(session.data.activeEntity).toBe('S1 Teknologi Informasi');
  });

  test('Constraint H: Raw user queries containing numbers and dates are accepted without false rejection', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    // 1. Query with rupiah amount
    const q1 = 'Biaya Rp6.500.000 itu untuk apa?';
    const plan1 = buildExecutionPlan(q1, {});
    expect(plan1.success).toBe(true);
    expect(plan1.plan.tasks[0].query).toMatch(/Rp6\.500\.000/i);

    // 2. Query with wave and date
    const q2 = 'Gelombang 2 tanggal 7 Juli masih buka?';
    const plan2 = buildExecutionPlan(q2, {});
    expect(plan2.success).toBe(true);
    expect(plan2.plan.tasks[0].query).toMatch(/7 Juli/i);

    // End-to-end execution through bridge
    const res1 = await processTurn('test_amount_' + Date.now(), q1);
    expect(res1.finalAnswer).toBeDefined();
    expect(res1.finalAnswer.length).toBeGreaterThan(0);

    const res2 = await processTurn('test_date_' + Date.now(), q2);
    expect(res2.finalAnswer).toBeDefined();
    expect(res2.finalAnswer.length).toBeGreaterThan(0);
  });

  test('Constraint 8: Ambiguous clarification returns authoritative scoped options', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';

    const chatId = 'test_ambig_' + Date.now();
    const result = await processTurn(chatId, 'Berapa biayanya?');

    expect(result.finalAnswer).toMatch(/program studi mana yang ingin Kakak tanyakan/i);
    expect(result.finalAnswer).toMatch(/S1 Sistem Informasi/i);
    expect(result.finalAnswer).toMatch(/S1 Teknologi Informasi/i);
    expect(result.phase2Meta.planType).toBe('AMBIGUOUS_CLARIFICATION');
  });
});
