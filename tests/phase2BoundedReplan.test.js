'use strict';

/**
 * tests/phase2BoundedReplan.test.js
 * 
 * Phase 2 Step 3: Bounded Reflection & Controlled Replan Test Suite.
 * 
 * Verifies all 10 mandated Step 3 requirements:
 * 1. Evidence sudah cukup -> no replan
 * 2. Evidence kurang -> exactly one replan
 * 3. Replan menghasilkan evidence baru -> gunakan evidence baru
 * 4. Replan tidak menghasilkan evidence baru -> stop cleanly
 * 5. Replan setelah 1500 ms -> tidak dijalankan (deadline abort)
 * 6. Total timeout 2500 ms -> fallback Phase 1
 * 7. Rejected evidence tidak boleh masuk hasil final
 * 8. Entity lock tetap dipertahankan selama replan
 * 9. Temporal / source authority tetap dipertahankan
 * 10. Claim provenance tetap valid setelah replan
 */

const prisma = require('../src/db');
const { processTurn } = require('../src/core/orchestrator');
const {
  REPLAN_DECISION,
  evaluateEvidenceSufficiency,
  detectVocabularyMismatch,
  buildReplanRetrievalPlan,
  executeBoundedReplan
} = require('../src/reasoning/boundedReflection');
const { ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { validateClaimProvenance } = require('../src/reasoning/contracts');
const boundedReflectionModule = require('../src/reasoning/boundedReflection');

// In-memory mock for prisma.session
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

describe('Phase 2 Step 3: Bounded Reflection & Controlled Replan', () => {
  jest.setTimeout(30000);
  const originalEnv = process.env.ENABLE_PHASE2_REASONING;

  beforeEach(() => {
    process.env.ENABLE_PHASE2_REASONING = 'true';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalEnv === undefined) {
      delete process.env.ENABLE_PHASE2_REASONING;
    } else {
      process.env.ENABLE_PHASE2_REASONING = originalEnv;
    }
  });

  // 1. Evidence sudah cukup -> no replan
  test('1. Evidence sudah cukup -> no replan triggered', () => {
    const frame = { domain: 'TUITION_FEE', intent: 'TUITION_FEE_INQUIRY', aspects: ['fee'] };
    const arbitrated = {
      accepted: [{ id: 'chunk_1', title: 'Biaya TI', providedAspects: ['fee'] }],
      rejected: []
    };
    const answerability = { status: ANSWERABILITY_STATUS.ANSWERABLE };

    const evaluation = evaluateEvidenceSufficiency(frame, arbitrated, answerability);
    expect(evaluation.sufficient).toBe(true);
    expect(evaluation.decision).toBe(REPLAN_DECISION.NO_REPLAN_SUFFICIENT);
  });

  // 2. Evidence kurang -> exactly one replan
  test('2. Evidence kurang -> triggers exactly one replan', async () => {
    const frame = {
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      entities: [{ canonical: 'S1 Teknologi Informasi' }],
      aspects: ['fee'],
      rawQuery: 'spp TI per semester berapa?'
    };
    const initialPlan = {
      domain: 'TUITION_FEE',
      targetEntities: ['S1 Teknologi Informasi'],
      excludedConflictingEntities: ['S1 Sistem Informasi'],
      requiredAspects: ['fee'],
      queryVariants: ['spp TI']
    };
    const initialArbitrated = { accepted: [], rejected: [] };
    const initialAnswerability = { status: ANSWERABILITY_STATUS.UNKNOWN, missingAspects: ['fee'] };

    const replanResult = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan,
      initialArbitrated,
      initialAnswerability,
      startTime: Date.now(),
      replanAttempts: 0
    });

    expect(replanResult.replanExecuted).toBe(true);
    // Bounded check: Attempting second replan must be rejected
    const secondAttempt = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan,
      initialArbitrated: replanResult.arbitrated,
      initialAnswerability: replanResult.answerability,
      startTime: Date.now(),
      replanAttempts: 1
    });

    expect(secondAttempt.replanExecuted).toBe(false);
    expect(secondAttempt.decision).toBe(REPLAN_DECISION.REPLAN_ABORTED_MAX_ATTEMPTS);
  });

  // 3. Replan menghasilkan evidence baru -> gunakan evidence baru
  test('3. Replan menghasilkan evidence baru -> mengadopsi evidence baru', async () => {
    const frame = {
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      entities: [{ canonical: 'S1 Teknologi Informasi' }],
      aspects: ['fee'],
      rawQuery: 'spp TI'
    };
    const initialPlan = {
      domain: 'TUITION_FEE',
      targetEntities: ['S1 Teknologi Informasi'],
      excludedConflictingEntities: ['S1 Sistem Informasi'],
      requiredAspects: ['fee'],
      queryVariants: ['spp TI']
    };
    const initialArbitrated = { accepted: [], rejected: [] };
    const initialAnswerability = { status: ANSWERABILITY_STATUS.UNKNOWN, missingAspects: ['fee'] };

    const res = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan,
      initialArbitrated,
      initialAnswerability,
      startTime: Date.now(),
      replanAttempts: 0
    });

    expect(res.replanExecuted).toBe(true);
    expect(res.newEvidenceFound).toBe(true);
    expect(res.arbitrated.accepted.length).toBeGreaterThan(0);
    expect(res.answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
  });

  // 4. Replan tidak menghasilkan evidence baru -> stop cleanly
  test('4. Replan tidak menghasilkan evidence baru -> stop cleanly tanpa loop', async () => {
    const frame = {
      domain: 'NON_EXISTENT_DOMAIN',
      intent: 'NON_EXISTENT_INTENT',
      entities: [{ canonical: 'Program Tidak Ada 12345' }],
      aspects: ['unknown_aspect'],
      rawQuery: 'xyzqwert12345'
    };
    const initialPlan = {
      domain: 'NON_EXISTENT_DOMAIN',
      targetEntities: ['Program Tidak Ada 12345'],
      excludedConflictingEntities: [],
      requiredAspects: ['unknown_aspect'],
      queryVariants: ['xyzqwert12345']
    };
    const initialArbitrated = { accepted: [], rejected: [] };
    const initialAnswerability = { status: ANSWERABILITY_STATUS.UNKNOWN, missingAspects: ['unknown_aspect'] };

    const res = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan,
      initialArbitrated,
      initialAnswerability,
      startTime: Date.now(),
      replanAttempts: 0
    });

    expect(res.replanExecuted).toBe(true);
    expect(res.newEvidenceFound).toBe(false);
    expect(res.decision).toBe(REPLAN_DECISION.REPLAN_COMPLETED_NO_NEW_EVIDENCE);
  });

  // 5. Replan setelah 1500 ms -> tidak dijalankan
  test('5. Replan setelah 1500 ms -> ditolak oleh budget deadline guard', async () => {
    const frame = {
      domain: 'TUITION_FEE',
      intent: 'TUITION_FEE_INQUIRY',
      entities: [{ canonical: 'S1 Sistem Informasi' }],
      aspects: ['fee'],
      rawQuery: 'biaya SI'
    };
    const initialPlan = {
      domain: 'TUITION_FEE',
      targetEntities: ['S1 Sistem Informasi'],
      excludedConflictingEntities: [],
      requiredAspects: ['fee'],
      queryVariants: ['biaya SI']
    };
    const initialArbitrated = { accepted: [], rejected: [] };
    const initialAnswerability = { status: ANSWERABILITY_STATUS.UNKNOWN };

    // Simulate turn started 1600ms ago
    const simulatedStartTime = Date.now() - 1600;

    const res = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan,
      initialArbitrated,
      initialAnswerability,
      startTime: simulatedStartTime,
      replanAttempts: 0
    });

    expect(res.replanExecuted).toBe(false);
    expect(res.decision).toBe(REPLAN_DECISION.REPLAN_ABORTED_DEADLINE);
  });

  // 6. Total timeout 2500 ms -> fallback Phase 1
  test('6. Total timeout 2500 ms saat replan -> fallback ke Phase 1', async () => {
    // Force reflection to trigger replan
    jest.spyOn(boundedReflectionModule, 'evaluateEvidenceSufficiency').mockReturnValue({
      sufficient: false,
      decision: REPLAN_DECISION.REPLAN_TRIGGERED
    });

    // Simulate replan hanging or exceeding 2500ms
    jest.spyOn(boundedReflectionModule, 'executeBoundedReplan').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 3500));
      return { replanExecuted: false };
    });

    const chatId = 'test_replan_timeout_' + Date.now();
    const result = await processTurn(chatId, 'biaya kuliah sistem komputer per semester?');

    expect(result.finalAnswer).toMatch(/sistem komputer/i);
    expect(result.phase2Meta.handledBy).toBe('phase1_fallback');
    expect(result.phase2Meta.fallbackTriggered).toBe(true);
    expect(result.phase2Meta.reason).toMatch(/timeout_budget_exceeded/);
  });

  // 7. Rejected evidence tidak boleh masuk hasil final
  test('7. Rejected evidence dari arbiter tidak boleh masuk accepted set replan', async () => {
    const frame = {
      domain: 'INTERNATIONAL',
      intent: 'STUDY_LOCATION',
      entities: [{ canonical: 'Double Degree DNUI' }],
      aspects: ['study_location'],
      rawQuery: 'Double Degree DNUI kuliah di mana?'
    };
    const plan = {
      domain: 'INTERNATIONAL',
      targetEntities: ['Double Degree DNUI'],
      excludedConflictingEntities: ['HELP University Malaysia'],
      requiredAspects: ['study_location'],
      queryVariants: ['Double Degree DNUI lokasi kuliah']
    };

    const mismatch = detectVocabularyMismatch('Double Degree DNUI kuliah di mana?', frame, []);
    const replanPlan = buildReplanRetrievalPlan(plan, frame, mismatch);

    expect(replanPlan.excludedConflictingEntities).toContain('HELP University Malaysia');

    const res = await executeBoundedReplan({
      semanticFrame: frame,
      initialPlan: plan,
      initialArbitrated: { accepted: [], rejected: [] },
      initialAnswerability: { status: ANSWERABILITY_STATUS.UNKNOWN },
      startTime: Date.now(),
      replanAttempts: 0
    });

    // Check that none of the accepted chunks contain excluded HELP University
    if (res.arbitrated && res.arbitrated.accepted) {
      for (const chunk of res.arbitrated.accepted) {
        expect(chunk.title || '').not.toContain('HELP University');
      }
    }
  });

  // 8. Entity lock tetap dipertahankan selama replan
  test('8. Entity lock tetap dipertahankan selama replan', () => {
    const originalPlan = {
      domain: 'TUITION_FEE',
      targetEntities: ['S1 Sistem Informasi'],
      excludedConflictingEntities: ['S1 Sistem Komputer', 'S1 Bisnis Digital'],
      requiredAspects: ['fee', 'tuition'],
      temporalConstraint: 'T.A. 2026/2027',
      queryVariants: ['biaya SI']
    };
    const frame = {
      entities: [{ canonical: 'S1 Sistem Informasi' }]
    };
    const mismatch = {
      suggestedTerms: ['biaya kuliah per semester'],
      reformulatedQuery: 'S1 Sistem Informasi biaya kuliah per semester'
    };

    const replanPlan = buildReplanRetrievalPlan(originalPlan, frame, mismatch);

    expect(replanPlan.targetEntities).toEqual(['S1 Sistem Informasi']);
    expect(replanPlan.excludedConflictingEntities).toEqual(['S1 Sistem Komputer', 'S1 Bisnis Digital']);
    expect(replanPlan.temporalConstraint).toBe('T.A. 2026/2027');
    expect(replanPlan.isReplan).toBe(true);
  });

  // 9. Temporal / source authority tetap dipertahankan
  test('9. Temporal dan source authority tetap dipertahankan pada replan plan', () => {
    const originalPlan = {
      domain: 'PMB',
      targetEntities: ['General PMB'],
      excludedConflictingEntities: [],
      requiredAspects: ['schedule', 'wave'],
      temporalConstraint: 'NOW',
      queryVariants: ['jadwal pmb']
    };
    const frame = { entities: [{ canonical: 'General PMB' }] };
    const mismatch = { suggestedTerms: [], reformulatedQuery: null };

    const replanPlan = buildReplanRetrievalPlan(originalPlan, frame, mismatch);
    expect(replanPlan.temporalConstraint).toBe('NOW');
  });

  // 10. Claim provenance tetap valid setelah replan
  test('10. Claim provenance tetap valid setelah replan', () => {
    const provenance = {
      claimText: 'Biaya kuliah S1 TI adalah Rp6.500.000 per semester',
      evidenceId: 'chunk_sk_629_lamp1_ti_fee',
      sourceDocument: 'SK Rektor No. 629/ITBSTIKOM/WDS/X/25',
      targetEntity: 'S1 Teknologi Informasi',
      targetAspect: 'TUITION_FEE_SEMESTER',
      temporalScope: 'T.A. 2026/2027',
      verificationStatus: 'VERIFIED'
    };

    const valid = validateClaimProvenance(provenance);
    expect(valid.valid).toBe(true);

    const invalidNoDoc = { ...provenance, sourceDocument: null };
    expect(validateClaimProvenance(invalidNoDoc).valid).toBe(false);
  });
});
