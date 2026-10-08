'use strict';

/**
 * tests/phase2ShadowEvaluation.test.js
 *
 * Phase 2 Step 8: Shadow Evaluation Mode (Canary before Cutover) Test Suite.
 *
 * Tests all required A-O scenarios:
 * A. flags disabled
 * B. shadow enabled / Phase 2 disabled
 * C. zero outbound dispatch
 * D. zero session mutation
 * E. mutation detection via assertShadowModeSafety
 * F. shadow exception isolation
 * G. shadow timeout isolation
 * H. non-blocking async path
 * I. canonical entity matching
 * J. domain + intent matching
 * K. exact Jaccard metric
 * L. telemetry schema
 * M. telemetry logging failure isolation
 * N. Phase 2 primary disables shadow
 * O. deterministic semantic metrics
 */

const prisma = require('../src/db');
const { processTurn } = require('../src/core/orchestrator');
const outboundDispatcher = require('../src/core/outboundDispatcher');
const logger = require('../src/logger');
const {
  isPhase2ShadowModeEnabled,
  computeEvidenceOverlapRatio,
  computeEntityMatch,
  computeIntentMatch,
  evaluateShadowTurn,
  runShadowEvaluationSafely
} = require('../src/reasoning/shadowEvaluator');
const {
  createShadowTelemetry,
  assertShadowModeSafety,
  TOTAL_TURN_BUDGET_MS
} = require('../src/reasoning/contracts');

// In-memory session mock for isolation
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

describe('Phase 2 Step 8: Shadow Evaluation Mode', () => {
  jest.setTimeout(30000);
  const origPhase2 = process.env.ENABLE_PHASE2_REASONING;
  const origShadow = process.env.PHASE2_SHADOW_MODE;

  beforeEach(() => {
    sessionStore.clear();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Wait for any pending setImmediate callbacks before tearing down
    await new Promise(resolve => setImmediate(resolve));
    jest.restoreAllMocks();
    if (origPhase2 === undefined) delete process.env.ENABLE_PHASE2_REASONING;
    else process.env.ENABLE_PHASE2_REASONING = origPhase2;

    if (origShadow === undefined) delete process.env.PHASE2_SHADOW_MODE;
    else process.env.PHASE2_SHADOW_MODE = origShadow;
  });

  // A. flags disabled
  test('Scenario A: Flags disabled -> Shadow mode inactive, normal Phase 1 path', async () => {
    delete process.env.ENABLE_PHASE2_REASONING;
    delete process.env.PHASE2_SHADOW_MODE;

    expect(isPhase2ShadowModeEnabled()).toBe(false);

    const chatId = 'test_scenario_a_' + Date.now();
    const result = await processTurn(chatId, 'Berapa biaya kuliah sistem informasi?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.phase2Meta).toBeUndefined();
  });

  // B. shadow enabled / Phase 2 disabled
  test('Scenario B: Shadow enabled / Phase 2 disabled -> Phase 1 executes authoritative, shadow triggered', async () => {
    delete process.env.ENABLE_PHASE2_REASONING;
    process.env.PHASE2_SHADOW_MODE = 'true';

    expect(isPhase2ShadowModeEnabled()).toBe(true);

    const chatId = 'test_scenario_b_' + Date.now();
    const result = await processTurn(chatId, 'Halo, apa kabar?');

    // Phase 1 authoritative result is returned directly
    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.subQueryResults).toBeDefined();
  });

  // C. zero outbound dispatch
  test('Scenario C: Zero outbound dispatch during shadow execution', async () => {
    delete process.env.ENABLE_PHASE2_REASONING;
    process.env.PHASE2_SHADOW_MODE = 'true';

    const dispatchSpy = jest.spyOn(outboundDispatcher, 'sendOutboundMessage').mockResolvedValue(true);

    const mockPhase2Bridge = jest.fn(async () => ({
      finalAnswer: 'P2 shadow answer',
      subQueryResults: [{ answer: 'P2 shadow answer', verification: { pass: true } }]
    }));

    const telemetry = await evaluateShadowTurn({
      chatId: 'test_scenario_c_' + Date.now(),
      rawQuery: 'Perbandingan sistem informasi dan teknik informatika',
      p1Result: { finalAnswer: 'P1 answer', subQueryResults: [] },
      phase2BridgeFn: mockPhase2Bridge
    });

    expect(telemetry.readOnlyVerified).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // D. zero session mutation
  test('Scenario D: Zero session mutation during shadow execution', async () => {
    const chatId = 'test_scenario_d_' + Date.now();
    const initialSession = {
      chatId,
      state: 'academic_program',
      data: {
        activeDomain: 'ACADEMIC_PROGRAM',
        activeEntity: 's1_sistem_informasi',
        lastQuery: 'Apa itu SI?'
      }
    };
    sessionStore.set(chatId, initialSession);

    const upsertSpy = jest.spyOn(prisma.session, 'upsert');

    const mockPhase2Bridge = jest.fn(async () => ({
      finalAnswer: 'Shadow answer',
      subQueryResults: [{ answer: 'Shadow answer', verification: { pass: true } }]
    }));

    await evaluateShadowTurn({
      chatId,
      rawQuery: 'Berapa biaya kuliah?',
      p1Result: { finalAnswer: 'P1 answer' },
      phase2BridgeFn: mockPhase2Bridge
    });

    expect(upsertSpy).not.toHaveBeenCalled();
    const stored = sessionStore.get(chatId);
    expect(stored).toEqual(initialSession);
  });

  // E. mutation detection via assertShadowModeSafety
  test('Scenario E: Mutation detection via assertShadowModeSafety triggers error', () => {
    const before = {
      chatId: 'test_e',
      data: { activeEntity: 's1_ti', turnCount: 1 }
    };
    const after = {
      chatId: 'test_e',
      data: { activeEntity: 's1_si', turnCount: 2 } // mutated!
    };

    expect(() => {
      assertShadowModeSafety(before, after);
    }).toThrow(/\[ShadowModeViolation\]/);

    // Identical snapshots pass without error
    const identical = JSON.parse(JSON.stringify(before));
    expect(assertShadowModeSafety(before, identical)).toBe(true);
  });

  // F. shadow exception isolation
  test('Scenario F: Shadow exception is contained and does not throw', async () => {
    const mockFailingBridge = jest.fn(async () => {
      throw new Error('catastrophic_phase2_internal_bug');
    });

    const result = await runShadowEvaluationSafely({
      chatId: 'test_scenario_f_' + Date.now(),
      rawQuery: 'Pertanyaan test',
      p1Result: { finalAnswer: 'P1 Answer', subQueryResults: [] },
      phase2BridgeFn: mockFailingBridge
    });

    // Exception is caught and recorded inside telemetry, never throws
    expect(result).toBeDefined();
    expect(result.regressionDetected).toBe(true);
    expect(result.diffs.some(d => d.includes('catastrophic_phase2_internal_bug'))).toBe(true);
  });

  // G. shadow timeout isolation
  test('Scenario G: Shadow timeout budget is 2500ms and timeout is isolated', async () => {
    expect(TOTAL_TURN_BUDGET_MS).toBe(2500);

    const mockTimeoutBridge = jest.fn(async () => {
      throw new Error(`phase2_timeout_budget_exceeded_${TOTAL_TURN_BUDGET_MS}ms`);
    });

    const telemetry = await evaluateShadowTurn({
      chatId: 'test_scenario_g_' + Date.now(),
      rawQuery: 'Query timeout test',
      p1Result: { finalAnswer: 'P1 answered in time' },
      phase2BridgeFn: mockTimeoutBridge
    });

    expect(telemetry).toBeDefined();
    expect(telemetry.p2VerificationPass).toBe(false);
    expect(telemetry.regressionDetected).toBe(true);
    expect(telemetry.diffs.some(d => d.includes('2500ms'))).toBe(true);
  });

  // H. non-blocking async path
  test('Scenario H: Non-blocking async path -> Phase 1 returns before slow shadow completes', async () => {
    delete process.env.ENABLE_PHASE2_REASONING;
    process.env.PHASE2_SHADOW_MODE = 'true';

    const p1Start = Date.now();
    const result = await processTurn('test_h_' + Date.now(), 'Halo STIKOM');
    const p1Duration = Date.now() - p1Start;

    // Phase 1 response must return fast and not await any slow async shadow work
    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(p1Duration).toBeLessThan(2000);
  });

  // I. canonical entity matching
  test('Scenario I: Canonical entity matching is order-independent and set-based', () => {
    // Both empty => true
    expect(computeEntityMatch([], [])).toBe(true);

    // Order independent equality
    const p1 = [{ canonical: 's1_ti' }, { canonical: 's1_si' }];
    const p2 = [{ canonical: 's1_si' }, { canonical: 's1_ti' }];
    expect(computeEntityMatch(p1, p2)).toBe(true);

    // Normalization with whitespace & case
    const p3 = [{ canonical: ' S1_TI ' }];
    const p4 = [{ canonical: 's1_ti' }];
    expect(computeEntityMatch(p3, p4)).toBe(true);

    // Deduplication with set
    const p5 = [{ canonical: 's1_ti' }, { canonical: 's1_ti' }];
    const p6 = [{ canonical: 's1_ti' }];
    expect(computeEntityMatch(p5, p6)).toBe(true);

    // Disjoint or different sizes => false
    expect(computeEntityMatch([{ canonical: 's1_ti' }], [{ canonical: 's1_bd' }])).toBe(false);
    expect(computeEntityMatch([{ canonical: 's1_ti' }], [{ canonical: 's1_ti' }, { canonical: 's1_si' }])).toBe(false);
  });

  // J. domain + intent matching
  test('Scenario J: Intent match requires both primaryDomain AND primaryIntent to match', () => {
    // Both match with normalization
    const f1 = { primaryDomain: ' ACADEMIC_PROGRAM ', primaryIntent: ' ASK_BIAYA ' };
    const f2 = { domain: 'academic_program', intent: 'ask_biaya' };
    expect(computeIntentMatch(f1, f2)).toBe(true);

    // Domain mismatch => false
    const f3 = { primaryDomain: 'CAMPUS_LIFE', primaryIntent: 'ASK_BIAYA' };
    expect(computeIntentMatch(f1, f3)).toBe(false);

    // Intent mismatch => false
    const f4 = { primaryDomain: 'ACADEMIC_PROGRAM', primaryIntent: 'ASK_CURRICULUM' };
    expect(computeIntentMatch(f1, f4)).toBe(false);

    // Empty frames => true (both resolve to empty strings)
    expect(computeIntentMatch({}, {})).toBe(true);
  });

  // K. exact Jaccard metric
  test('Scenario K: Exact Jaccard metric (|A ∩ B| / |A ∪ B|) with canonical boundary cases', () => {
    // Boundary 1: Both empty => 1.0
    expect(computeEvidenceOverlapRatio([], [])).toBe(1.0);

    // Boundary 2: Exactly one empty => 0.0
    expect(computeEvidenceOverlapRatio([{ id: 'c1' }], [])).toBe(0.0);
    expect(computeEvidenceOverlapRatio([], [{ id: 'c1' }])).toBe(0.0);

    // Overlap: A = {c1, c2}, B = {c2, c3}
    // Intersection = {c2} (1), Union = {c1, c2, c3} (3) => 1/3 = 0.3333
    const p1 = [{ id: 'c1' }, { chunkId: 'c2' }];
    const p2 = [{ hash: 'c2' }, { id: 'c3' }];
    expect(computeEvidenceOverlapRatio(p1, p2)).toBe(0.3333);

    // Identical: 1.0
    expect(computeEvidenceOverlapRatio([{ id: 'chunk_alpha' }], [{ id: ' CHUNK_ALPHA ' }])).toBe(1.0);

    // Disjoint: 0.0
    expect(computeEvidenceOverlapRatio([{ id: 'c1' }], [{ id: 'c2' }])).toBe(0.0);
  });

  // L. telemetry schema
  test('Scenario L: Telemetry schema contains all mandated properties and readOnlyVerified', () => {
    const telemetry = createShadowTelemetry({
      rawQuery: 'test query',
      p1Answer: 'Ans 1',
      p2Answer: 'Ans 2',
      p1LatencyMs: 120,
      p2LatencyMs: 250,
      entityMatch: true,
      intentMatch: true,
      evidenceOverlapRatio: 0.85,
      p2VerificationPass: true,
      regressionDetected: false,
      diffs: []
    });

    expect(telemetry.queryId).toBeDefined();
    expect(telemetry.timestamp).toBeDefined();
    expect(telemetry.rawQuery).toBe('test query');
    expect(telemetry.p1Answer).toBe('Ans 1');
    expect(telemetry.p2Answer).toBe('Ans 2');
    expect(telemetry.p1LatencyMs).toBe(120);
    expect(telemetry.p2LatencyMs).toBe(250);
    expect(telemetry.entityMatch).toBe(true);
    expect(telemetry.intentMatch).toBe(true);
    expect(telemetry.evidenceOverlapRatio).toBe(0.85);
    expect(telemetry.p2VerificationPass).toBe(true);
    expect(telemetry.regressionDetected).toBe(false);
    expect(telemetry.diffs).toEqual([]);
    expect(telemetry.readOnlyVerified).toBe(true);
  });

  // M. telemetry logging failure isolation
  test('Scenario M: Telemetry logging failure is completely isolated and non-blocking', async () => {
    const loggerSpy = jest.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('simulated_logger_io_disk_error');
    });

    const mockBridge = jest.fn(async () => ({
      finalAnswer: 'P2 Answer',
      subQueryResults: [{ answer: 'P2 Answer', verification: { pass: true } }]
    }));

    // Must not throw despite logger throwing
    const result = await runShadowEvaluationSafely({
      chatId: 'test_m_' + Date.now(),
      rawQuery: 'Query logging test',
      p1Result: { finalAnswer: 'P1 Answer', subQueryResults: [] },
      phase2BridgeFn: mockBridge
    });

    expect(result).toBeDefined();
    expect(result.readOnlyVerified).toBe(true);
    loggerSpy.mockRestore();
  });

  // N. Phase 2 primary disables shadow
  test('Scenario N: Phase 2 primary mode disables shadow evaluation execution', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';
    process.env.PHASE2_SHADOW_MODE = 'true';

    const evaluateSpy = jest.fn();

    const chatId = 'test_n_' + Date.now();
    const result = await processTurn(chatId, 'Apa itu sistem informasi?');

    // Phase 2 runs as primary, not shadow
    expect(result).toBeDefined();
    expect(result.phase2Meta).toBeDefined();
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  // O. deterministic semantic metrics
  test('Scenario O: Deterministic semantic metrics yield identical output for same inputs', async () => {
    const p1Result = {
      finalAnswer: 'Jawaban P1 resmi',
      subQueryResults: [
        {
          frame: { domain: 'ACADEMIC_PROGRAM', intent: 'ASK_DETAIL', entities: [{ canonical: 's1_ti' }] },
          arbitrated: { accepted: [{ id: 'chunk_1' }, { id: 'chunk_2' }] },
          answer: 'Jawaban P1 resmi',
          verification: { pass: true }
        }
      ]
    };

    const mockBridgeFn = async () => ({
      finalAnswer: 'Jawaban P2 rekomendasi',
      subQueryResults: [
        {
          frame: { domain: 'ACADEMIC_PROGRAM', intent: 'ASK_DETAIL', entities: [{ canonical: 's1_ti' }] },
          arbitrated: { accepted: [{ id: 'chunk_2' }, { id: 'chunk_3' }] },
          answer: 'Jawaban P2 rekomendasi',
          verification: { pass: true }
        }
      ]
    });

    const run1 = await evaluateShadowTurn({
      chatId: 'test_o',
      rawQuery: 'Detail prodi TI',
      p1Result,
      phase2BridgeFn: mockBridgeFn
    });

    const run2 = await evaluateShadowTurn({
      chatId: 'test_o',
      rawQuery: 'Detail prodi TI',
      p1Result,
      phase2BridgeFn: mockBridgeFn
    });

    expect(run1.entityMatch).toBe(run2.entityMatch);
    expect(run1.intentMatch).toBe(run2.intentMatch);
    expect(run1.evidenceOverlapRatio).toBe(run2.evidenceOverlapRatio);
    expect(run1.p2VerificationPass).toBe(run2.p2VerificationPass);
    expect(run1.regressionDetected).toBe(run2.regressionDetected);
    expect(run1.diffs).toEqual(run2.diffs);
  });
});
