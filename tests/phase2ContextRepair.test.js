'use strict';

/**
 * tests/phase2ContextRepair.test.js
 * 
 * Phase 2 Step 4: Context Repair & Delta State Management Suite.
 * 
 * Required Coverage:
 * A. entity inheritance
 * B. entity replacement
 * C. domain switch
 * D. context preservation
 * E. explicit correction
 * F. neutral interruption
 * G. stale context
 * H. enclitic inheritance
 * I. ambiguous follow-up
 * J. campus-wide exception
 * K. atomic session update
 * L. inherited-vs-explicit provenance
 * M. context repair + existing bounded replan compatibility
 * N. failure rollback
 * O. no recursive loop
 * + 5 Comprehensive multi-turn real-user scenarios.
 */

const {
  CONTEXT_ACTION,
  ENTITY_PROVENANCE,
  CONTEXT_TTL_MS,
  validateContextDelta
} = require('../src/reasoning/contracts');

const {
  computeContextDelta,
  parseExplicitCorrection,
  isNeutralTurn,
  isContextStale,
  isCampusWideDomain,
  applyContextTransaction
} = require('../src/reasoning/contextRepair');

const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { executePhase2Bridge } = require('../src/reasoning/phase2Bridge');
const { getSession, updateSession } = require('../src/core/conversationState');
const { ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');

// Mock prisma for isolated session testing
jest.mock('../src/db', () => {
  const store = new Map();
  return {
    session: {
      findUnique: jest.fn(async ({ where }) => {
        return store.get(where.chatId) || null;
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const existing = store.get(where.chatId);
        const data = existing ? { ...existing.data, ...update.data } : create.data;
        const record = {
          chatId: where.chatId,
          state: (existing ? update.state : create.state) || 'root',
          data
        };
        store.set(where.chatId, record);
        return record;
      })
    },
    $transaction: jest.fn(async (cb) => cb()),
    _store: store
  };
});

describe('Phase 2 Step 4: Context Repair & Delta State Management', () => {

  beforeEach(() => {
    delete process.env.ENABLE_PHASE2_REASONING;
    const db = require('../src/db');
    if (db._store) db._store.clear();
  });

  // A. Entity Inheritance
  test('A. entity inheritance: inherits active prodi when follow-up lacks explicit entity', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, { rawQuery: 'kurikulumnya bagaimana?' });
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
  });

  // B. Entity Replacement
  test('B. entity replacement: switches entity cleanly without lingering to previous entity', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, { rawQuery: 'Bagaimana dengan Sistem Komputer?' });
    expect(delta.actions).toContain(CONTEXT_ACTION.ENTITY_REPLACED);
    expect(delta.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);
    expect(delta.resolvedState.activeEntity).not.toBe('S1 Teknologi Informasi');
  });

  // C. Domain Switch
  test('C. domain switch: switches domain while retaining coherent active entity', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, { rawQuery: 'Bagaimana kurikulumnya?' });
    expect(delta.actions).toContain(CONTEXT_ACTION.DOMAIN_REPLACED);
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta.resolvedState.activeDomain).toBe('ACADEMIC_CURRICULUM');
    expect(delta.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
  });

  // D. Context Preservation
  test('D. context preservation: identical domain and entity maintains preserved status', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, { rawQuery: 'Berapa biaya kuliah S1 Sistem Informasi?' });
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta.resolvedState.activeEntity).toBe('S1 Sistem Informasi');
  });

  // E. Explicit Correction
  test('E. explicit correction: handles "bukan X, maksud saya Y" correctly', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, {
      rawQuery: 'bukan Sistem Informasi, maksud saya Sistem Komputer'
    });
    expect(delta.actions).toContain(CONTEXT_ACTION.ENTITY_REMOVED);
    expect(delta.actions).toContain(CONTEXT_ACTION.ENTITY_REPLACED);
    expect(delta.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);
    expect(delta.correction).not.toBeNull();
    expect(delta.correction.negatedEntity).toBe('S1 Sistem Informasi');
    expect(delta.correction.targetEntity).toBe('S1 Sistem Komputer');
  });

  test('E2. explicit correction: handles "bukan biaya, saya mau tahu kurikulumnya"', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, {
      rawQuery: 'bukan biaya, saya mau tahu kurikulumnya'
    });
    expect(delta.actions).toContain(CONTEXT_ACTION.DOMAIN_REPLACED);
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    expect(delta.resolvedState.activeDomain).toBe('ACADEMIC_CURRICULUM');
  });

  test('E3. explicit correction: handles "yang saya maksud Dual Degree DNUI"', () => {
    const session = {
      data: {
        activeDomain: 'INTERNATIONAL_PROGRAM',
        activeEntity: 'HELP University',
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(session, {
      rawQuery: 'yang saya maksud Dual Degree DNUI'
    });
    expect(delta.actions).toContain(CONTEXT_ACTION.ENTITY_REPLACED);
    expect(delta.resolvedState.activeEntity).toBe('Double Degree DNUI');
    expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);
  });

  // F. Neutral Interruption
  test('F. neutral interruption: "Oke", "terima kasih" does not erase or pollute valid context', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    };
    const delta1 = computeContextDelta(session, { rawQuery: 'Oke terima kasih min' });
    expect(delta1.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta1.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    expect(delta1.resolvedState.isNeutral).toBe(true);

    const delta2 = computeContextDelta(session, { rawQuery: 'sip noted' });
    expect(delta2.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(delta2.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
  });

  // G. Stale Context
  test('G. stale context: contexts older than 30 minutes trigger CONTEXT_RESET and clear state', () => {
    const now = Date.now();
    const freshSession = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: now - (15 * 60 * 1000) // 15 mins ago
      }
    };
    expect(isContextStale(freshSession.data.lastTurnTs, now)).toBe(false);

    const expiredSession = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: now - (31 * 60 * 1000) // 31 mins ago
      }
    };
    expect(isContextStale(expiredSession.data.lastTurnTs, now)).toBe(true);

    const delta = computeContextDelta(expiredSession, { rawQuery: 'biayanya berapa?', currentTime: now });
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_RESET);
    expect(delta.resolvedState.activeEntity).toBeNull();
    expect(delta.resolvedState.isStale).toBe(true);
  });

  // H. Enclitic Inheritance
  test('H. enclitic inheritance: "-nya" references safely inherit active entity', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Bisnis Digital',
        lastTurnTs: Date.now()
      }
    };
    for (const q of ['syaratnya apa saja?', 'kurikulumnya apa?', 'prospeknya bagaimana?']) {
      const delta = computeContextDelta(session, { rawQuery: q });
      expect(delta.resolvedState.activeEntity).toBe('S1 Bisnis Digital');
      expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
    }
  });

  // I. Ambiguous Follow-up
  test('I. ambiguous follow-up: ambiguous query without context triggers AMBIGUITY_DETECTED', () => {
    const emptySession = { data: {} };
    const delta = computeContextDelta(emptySession, { rawQuery: 'biayanya berapa?' });
    expect(delta.actions).toContain(CONTEXT_ACTION.AMBIGUITY_DETECTED);
    expect(delta.resolvedState.activeEntity).toBeNull();
  });

  // J. Campus-Wide Exception
  test('J. campus-wide exception: general facilities decoupled from prodi, preserved in background', () => {
    const session = {
      data: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        lastTurnTs: Date.now()
      }
    };
    // User asks about lab facilities (campus-wide)
    const delta1 = computeContextDelta(session, { rawQuery: 'Bagaimana fasilitas labnya?' });
    expect(delta1.resolvedState.activeDomain).toBe('FACILITIES');
    expect(delta1.resolvedState.activeEntity).toBeNull(); // not restricted to prodi
    expect(delta1.resolvedState.preservedBackgroundEntity).toBe('S1 Sistem Informasi');

    // Follow-up: asks about curriculum (prodi-specific), prodi is seamlessly restored!
    const updatedSession = { data: delta1.resolvedState };
    const delta2 = computeContextDelta(updatedSession, { rawQuery: 'Kalau kurikulumnya?' });
    expect(delta2.resolvedState.activeDomain).toBe('ACADEMIC_CURRICULUM');
    expect(delta2.resolvedState.activeEntity).toBe('S1 Sistem Informasi');
    expect(delta2.resolvedState.preservedBackgroundEntity).toBeNull();
  });

  // K. Atomic Session Update
  test('K. atomic session update: updates session DB atomically after successful turn', async () => {
    const chatId = 'chat_atomicity_test';
    const previousSession = {
      data: {
        activeDomain: 'GENERAL',
        activeEntity: null,
        lastTurnTs: Date.now()
      }
    };
    const delta = computeContextDelta(previousSession, { rawQuery: 'Berapa biaya S1 TI?' });
    
    await applyContextTransaction(chatId, previousSession, delta, async () => {
      return { answer: 'Biaya S1 TI adalah Rp6.500.000/semester' };
    });

    const sessionInDb = await getSession(chatId);
    expect(sessionInDb.data.activeEntity).toBe('S1 Teknologi Informasi');
    expect(sessionInDb.data.activeDomain).toBe('TUITION_FEE');
    expect(sessionInDb.data.entityProvenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);
  });

  // L. Inherited vs Explicit Provenance
  test('L. inherited-vs-explicit provenance: tags explicit entity vs inherited accurately', () => {
    const emptySession = { data: {} };
    const deltaExplicit = computeContextDelta(emptySession, { rawQuery: 'Prospek kerja TI?' });
    expect(deltaExplicit.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.EXPLICIT_CURRENT_TURN);

    const sessionWithTI = { data: deltaExplicit.resolvedState };
    const deltaInherited = computeContextDelta(sessionWithTI, { rawQuery: 'Kalau kurikulumnya?' });
    expect(deltaInherited.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
  });

  // M. Compatibility with Bounded Replan
  test('M. context repair + existing bounded replan compatibility in phase2Bridge', async () => {
    process.env.ENABLE_PHASE2_REASONING = 'true';
    const chatId = 'replan_compat_chat';
    
    // Seed initial session with explicit prodi
    await updateSession(chatId, {
      dataPatch: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Teknologi Informasi',
        lastTurnTs: Date.now()
      }
    });

    let mockPhase1Calls = 0;
    const mockPhase1Fn = jest.fn(async (cId, q) => {
      mockPhase1Calls++;
      return {
        chatId: cId,
        rawQuery: q,
        subQueryResults: [
          {
            frame: { domain: 'ACADEMIC_CURRICULUM', intent: 'CURRICULUM_DETAIL', entities: ['S1 Teknologi Informasi'], aspects: ['curriculum'] },
            plan: { tasks: [{ id: 't1' }] },
            arbitrated: { accepted: [{ id: 'chunk1', confidenceScore: 0.95 }] },
            answerability: ANSWERABILITY_STATUS.ANSWERABLE,
            answer: 'Kurikulum S1 TI mencakup Pemrograman Web dan Cloud Computing.'
          }
        ],
        finalAnswer: 'Kurikulum S1 TI mencakup Pemrograman Web dan Cloud Computing.'
      };
    });

    const result = await executePhase2Bridge(chatId, 'kurikulumnya apa saja?', {}, mockPhase1Fn);
    expect(result.phase2Meta.handledBy).toBe('phase2_bridge');
    expect(mockPhase1Calls).toBe(1);

    // Verify session updated atomically with inherited provenance
    const updatedSession = await getSession(chatId);
    expect(updatedSession.data.activeEntity).toBe('S1 Teknologi Informasi');
    expect(updatedSession.data.activeDomain).toBe('ACADEMIC_CURRICULUM');
  });

  // N. Failure Rollback
  test('N. failure rollback: failed turn leaves DB session unmodified without corruption', async () => {
    const chatId = 'chat_rollback_test';
    await updateSession(chatId, {
      dataPatch: {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        lastTurnTs: Date.now()
      }
    });

    const previousSession = await getSession(chatId);
    const delta = computeContextDelta(previousSession, { rawQuery: 'Bagaimana dengan Sistem Komputer?' });

    // Simulate unexpected crash during pipeline execution
    await expect(applyContextTransaction(chatId, previousSession, delta, async () => {
      throw new Error('Database connection reset during retrieval');
    })).rejects.toThrow('Database connection reset during retrieval');

    // Verify session was NOT corrupted by the aborted turn
    const sessionAfterFail = await getSession(chatId);
    expect(sessionAfterFail.data.activeEntity).toBe('S1 Sistem Informasi');
    expect(sessionAfterFail.data.activeEntity).not.toBe('S1 Sistem Komputer');
  });

  // O. No Recursive Loop
  test('O. no recursive loop: recursion guard caps nested repair passes', () => {
    const session = { data: { activeEntity: 'S1 TI' } };
    const delta = computeContextDelta(session, {
      rawQuery: 'test recursive',
      repairDepth: 2 // Simulated nested invocation
    });
    expect(delta.recursionPrevented).toBe(true);
    expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
  });
});

describe('Phase 2 Step 4: 5 Multi-Turn Real-User Scenarios', () => {

  test('Scenario 1: Multi-Turn Entity Switch (TI -> SK -> Semester 3)', () => {
    // Turn 1: Biaya TI
    let session = { data: {} };
    const t1 = computeContextDelta(session, { rawQuery: 'Berapa biaya kuliah TI?' });
    expect(t1.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    session.data = t1.resolvedState;

    // Turn 2: Bagaimana dengan Sistem Komputer?
    const t2 = computeContextDelta(session, { rawQuery: 'Bagaimana dengan Sistem Komputer?' });
    expect(t2.actions).toContain(CONTEXT_ACTION.ENTITY_REPLACED);
    expect(t2.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    session.data = t2.resolvedState;

    // Turn 3: Kalau semester 3? (Must inherit SK, NEVER revert to TI)
    const t3 = computeContextDelta(session, { rawQuery: 'Kalau semester 3?' });
    expect(t3.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    expect(t3.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    expect(t3.resolvedState.activeEntity).not.toBe('S1 Teknologi Informasi');
  });

  test('Scenario 2: Explicit Correction ("bukan SI, maksud saya SK" -> "kurikulumnya")', () => {
    // Turn 1: SI
    let session = { data: { activeEntity: 'S1 Sistem Informasi', activeDomain: 'ACADEMIC_PROGRAM' } };

    // Turn 2: Explicit correction
    const t2 = computeContextDelta(session, { rawQuery: 'bukan Sistem Informasi, maksud saya Sistem Komputer' });
    expect(t2.actions).toContain(CONTEXT_ACTION.ENTITY_REPLACED);
    expect(t2.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    session.data = t2.resolvedState;

    // Turn 3: kurikulumnya
    const t3 = computeContextDelta(session, { rawQuery: 'kurikulumnya apa saja?' });
    expect(t3.resolvedState.activeEntity).toBe('S1 Sistem Komputer');
    expect(t3.resolvedState.activeDomain).toBe('ACADEMIC_CURRICULUM');
  });

  test('Scenario 3: Domain Switch with Campus-Wide Exception & Restoration (Biaya SI -> Fasilitas lab -> Kurikulum)', () => {
    // Turn 1: Biaya Sistem Informasi
    let session = { data: {} };
    const t1 = computeContextDelta(session, { rawQuery: 'Biaya Sistem Informasi berapa?' });
    expect(t1.resolvedState.activeEntity).toBe('S1 Sistem Informasi');
    session.data = t1.resolvedState;

    // Turn 2: Bagaimana fasilitas labnya? (Campus-wide facilities)
    const t2 = computeContextDelta(session, { rawQuery: 'Bagaimana fasilitas labnya?' });
    expect(t2.resolvedState.activeDomain).toBe('FACILITIES');
    expect(t2.resolvedState.activeEntity).toBeNull();
    expect(t2.resolvedState.preservedBackgroundEntity).toBe('S1 Sistem Informasi');
    session.data = t2.resolvedState;

    // Turn 3: Kalau kurikulumnya? (Restores SI seamlessly)
    const t3 = computeContextDelta(session, { rawQuery: 'Kalau kurikulumnya?' });
    expect(t3.resolvedState.activeDomain).toBe('ACADEMIC_CURRICULUM');
    expect(t3.resolvedState.activeEntity).toBe('S1 Sistem Informasi');
  });

  test('Scenario 4: Neutral Interruption Invariance (Biaya TI -> "Oke terima kasih" -> "kurikulumnya")', () => {
    // Turn 1: Biaya TI
    let session = { data: {} };
    const t1 = computeContextDelta(session, { rawQuery: 'Berapa biaya TI?' });
    expect(t1.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    session.data = t1.resolvedState;

    // Turn 2: Neutral
    const t2 = computeContextDelta(session, { rawQuery: 'Oke terima kasih banyak kak' });
    expect(t2.resolvedState.isNeutral).toBe(true);
    expect(t2.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
    session.data = t2.resolvedState;

    // Turn 3: kurikulumnya
    const t3 = computeContextDelta(session, { rawQuery: 'kurikulumnya seperti apa?' });
    expect(t3.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');
  });

  test('Scenario 5: Stale Context Boundary (>30m triggers clarification, zero leak of expired entity)', () => {
    const baseTime = 1700000000000;
    // Turn 1: User asks fee for TI
    let session = {
      data: {
        activeEntity: 'S1 Teknologi Informasi',
        activeDomain: 'TUITION_FEE',
        lastTurnTs: baseTime
      }
    };

    // Case 5A: Follow-up at 29 minutes (Fresh, still inherits TI)
    const tFresh = computeContextDelta(session, {
      rawQuery: 'biayanya berapa?',
      currentTime: baseTime + (29 * 60 * 1000)
    });
    expect(tFresh.resolvedState.isStale).toBe(false);
    expect(tFresh.resolvedState.activeEntity).toBe('S1 Teknologi Informasi');

    // Case 5B: Follow-up at 31 minutes (Stale, resets state)
    const tStale = computeContextDelta(session, {
      rawQuery: 'biayanya berapa?',
      currentTime: baseTime + (31 * 60 * 1000)
    });
    expect(tStale.resolvedState.isStale).toBe(true);
    expect(tStale.resolvedState.activeEntity).toBeNull();

    // Verify planner produces AMBIGUOUS_CLARIFICATION for stale session
    const planResult = buildExecutionPlan('biayanya berapa?', tStale.resolvedState);
    expect(planResult.plan.planType).toBe('AMBIGUOUS_CLARIFICATION');
    expect(planResult.plan.isAmbiguous).toBe(true);
  });
});
