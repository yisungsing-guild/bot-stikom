'use strict';

/**
 * tests/contextEntityReasoning.test.js
 *
 * Permanent regression test suite for Stage 2B: Systemic Context & Entity Reasoning.
 * Verifies multi-turn conversation state retention, ordinal reference resolution,
 * domain-aware antecedent binding, partial entity correction, context TTL expiry,
 * and cross-session isolation without mock drift.
 */

process.env.NODE_ENV = 'test';
delete process.env.OPENAI_API_KEY;

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const {
  evaluateContextDependency,
  resolveOrdinalReference,
  hasOrdinalReferenceMarker,
  extractOrderedSessionEntities
} = require('../src/core/contextResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');
const {
  getSession,
  updateSession,
  resetSession,
  applyContextTtlPolicy,
  getConversationContextTtlMs
} = require('../src/core/conversationState');

jest.setTimeout(45000);

describe('TIKO V2 — Stage 2B: Context & Entity Reasoning Suite', () => {

  // =========================================================================
  // 1. Comparison Ordinal Resolution: Yang Pertama & Yang Kedua
  // =========================================================================
  describe('1. Comparison Ordinal Resolution ("Yang Pertama" & "Yang Kedua")', () => {
    const chatId = 'test_ordinal_comparison_chat_1';

    beforeEach(async () => {
      await resetSession(chatId);
    });

    test('1a. Turn 1 stores entities in exact user mention order [BD, SI]', async () => {
      const res1 = await runPhase1DeterministicPipeline(
        chatId,
        'Apa bedanya Bisnis Digital dan Sistem Informasi?',
        { executeDispatch: false }
      );

      const session = await getSession(chatId);
      expect(session.data.activeEntities).toEqual(['S1 Bisnis Digital', 'S1 Sistem Informasi']);
      expect(session.data.activeEntity).toBe('S1 Bisnis Digital');
      expect(res1.finalAnswer).toBeTruthy();
    });

    test('1b. Turn 2 "Kalau yang kedua biayanya berapa?" resolves to S1 Sistem Informasi (index 1)', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'ACADEMIC_PROGRAM',
          activeIntent: 'PROGRAM_COMPARISON',
          activeEntity: 'S1 Bisnis Digital',
          activeEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
          lastQuery: 'Apa bedanya Bisnis Digital dan Sistem Informasi?'
        }
      });

      const sessionBefore = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Kalau yang kedua biayanya berapa?', sessionBefore);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.reason).toBe('ordinal_entity_reference');
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Informasi');

      const frame = resolveSemanticFrame('Kalau yang kedua biayanya berapa?', sessionBefore);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);
      expect(frame.requestedAttributes).toContain('fee');

      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).toContain('S1 Sistem Informasi');
      expect(plan.targetEntities).not.toContain('S1 Bisnis Digital');

      const res2 = await runPhase1DeterministicPipeline(
        chatId,
        'Kalau yang kedua biayanya berapa?',
        { executeDispatch: false }
      );

      const sessionAfter = await getSession(chatId);
      expect(sessionAfter.data.activeEntity).toBe('S1 Sistem Informasi');
      expect(sessionAfter.data.activeDomain).toBe('TUITION_FEE');
      const ans = String(res2.finalAnswer || res2.answer || '');
      expect(ans).toMatch(/Sistem Informasi/i);
      expect(ans).toMatch(/Biaya Kuliah|Rincian Biaya/i);
    });

    test('1c. Turn 2 alternative "Kalau yang pertama biayanya berapa?" resolves to S1 Bisnis Digital (index 0)', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'ACADEMIC_PROGRAM',
          activeIntent: 'PROGRAM_COMPARISON',
          activeEntity: 'S1 Bisnis Digital',
          activeEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
          lastQuery: 'Apa bedanya Bisnis Digital dan Sistem Informasi?'
        }
      });

      const sessionBefore = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Kalau yang pertama biayanya berapa?', sessionBefore);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.reason).toBe('ordinal_entity_reference');
      expect(contextDep.inheritedEntity).toBe('S1 Bisnis Digital');

      const frame = resolveSemanticFrame('Kalau yang pertama biayanya berapa?', sessionBefore);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).toEqual(['S1 Bisnis Digital']);
    });
  });

  // =========================================================================
  // 2. Program Satunya (Alternative Program Resolution)
  // =========================================================================
  describe('2. Alternative Program Resolution ("Program Satunya")', () => {
    test('"Kalau program satunya?" resolves to the non-active entity from previous comparison', () => {
      const session = {
        activeEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
        activeEntity: 'S1 Bisnis Digital',
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        requestedAttributes: ['fee', 'dpp', 'tuition'],
        lastQuery: 'Kalau yang pertama biayanya berapa?'
      };

      const contextDep = evaluateContextDependency('Kalau program satunya?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.reason).toBe('ordinal_entity_reference');
      expect(contextDep.ordinalResolution.ordinalType).toBe('OTHER');
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Informasi');

      const frame = resolveSemanticFrame('Kalau program satunya?', session);
      expect(frame.entities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
    });

    test('"Bagaimana dengan program satunya lagi?" switches to S1 Bisnis Digital when SI is active', () => {
      const session = {
        activeEntities: ['S1 Bisnis Digital', 'S1 Sistem Informasi'],
        activeEntity: 'S1 Sistem Informasi',
        activeDomain: 'ACADEMIC_CURRICULUM',
        activeIntent: 'CURRICULUM_INQUIRY',
        lastQuery: 'Bagaimana kurikulum Sistem Informasi?'
      };

      const contextDep = evaluateContextDependency('Bagaimana dengan program satunya lagi?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedEntity).toBe('S1 Bisnis Digital');
    });
  });

  // =========================================================================
  // 3. Fee Follow-up & "Uang Gedung" Domain Compatibility
  // =========================================================================
  describe('3. Fee Follow-up & "Uang Gedung" Domain Compatibility', () => {
    const chatId = 'test_fee_uang_gedung_chat';

    beforeEach(async () => {
      await resetSession(chatId);
    });

    test('3a. Follow-up "Kalau uang gedung?" inherits active academic entity as fee component (NOT campus-wide isolation)', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'TUITION_FEE',
          activeIntent: 'TUITION_FEE_INQUIRY',
          activeEntity: 'S1 Sistem Informasi',
          requestedAttributes: ['fee', 'dpp', 'tuition'],
          lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
        }
      });

      const session = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Kalau uang gedung?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.reason).toBe('fee_continuation');
      expect(contextDep.inheritedDomain).toBe('TUITION_FEE');
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Informasi');

      const frame = resolveSemanticFrame('Kalau uang gedung?', session);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);
      expect(frame.requestedAttributes).toContain('fee');
      expect(frame.requestedAttributes).toContain('dpp');
    });

    test('3b. Standalone "Uang gedung BD berapa?" classifies as TUITION_FEE with S1 Bisnis Digital', () => {
      const frame = resolveSemanticFrame('Uang gedung BD berapa?');
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');
      expect(frame.requestedAttributes).toContain('fee');
    });

    test('3c. Negative control: "Gedung kampus ada di mana?" classifies as FACILITIES', () => {
      const frame = resolveSemanticFrame('Gedung kampus ada di mana?');
      expect(frame.domain).toBe('FACILITIES');
      expect(['CAMPUS_LOCATION', 'FACILITY_INQUIRY']).toContain(frame.intent);
      expect(frame.aspects).not.toContain('dpp');
      expect(frame.aspects).not.toContain('fee');
    });

    test('3d. Negative control: "Fasilitas gedung kampus bagaimana?" classifies as FACILITIES / FACILITY_INQUIRY', () => {
      const frame = resolveSemanticFrame('Fasilitas gedung kampus bagaimana?');
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('FACILITY_INQUIRY');
      expect(frame.aspects).toContain('facilities');
      expect(frame.aspects).not.toContain('fee');
    });
  });

  // =========================================================================
  // 4. Campus Branch -> PMB Procedure Antecedent Isolation
  // =========================================================================
  describe('4. Campus Branch vs Central PMB Procedure Antecedent Isolation', () => {
    const chatId = 'test_branch_pmb_chat';

    beforeEach(async () => {
      await resetSession(chatId);
    });

    test('4a. "Bagaimana cara pendaftarannya?" after Kampus Jimbaran does NOT inherit branch campus constraint', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'FACILITIES',
          activeIntent: 'CAMPUS_LOCATION',
          activeEntity: 'Kampus Jimbaran',
          requestedAttributes: ['location', 'address'],
          lastQuery: 'Lokasi Kampus Jimbaran di mana?'
        }
      });

      const session = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Bagaimana cara pendaftarannya?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.reason).toBe('general_pmb_procedural_continuation');
      expect(contextDep.inheritedDomain).toBe('PMB');
      expect(contextDep.inheritedEntity).toBeNull(); // Branch campus not inherited

      const frame = resolveSemanticFrame('Bagaimana cara pendaftarannya?', session);
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('GENERAL_PMB_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).not.toContain('Kampus Jimbaran');

      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).not.toContain('Kampus Jimbaran');

      const res = await runPhase1DeterministicPipeline(
        chatId,
        'Bagaimana cara pendaftarannya?',
        { executeDispatch: false }
      );

      const ans = String(res.finalAnswer || res.answer || '');
      expect(ans).toMatch(/Portal PMB|tahapan online|pendaftaran/i);
    });

    test('4b. "Alamatnya di mana?" after Kampus Jimbaran retains Kampus Jimbaran entity', async () => {
      const session = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        activeEntity: 'Kampus Jimbaran',
        lastQuery: 'Kampus Jimbaran'
      };

      const contextDep = evaluateContextDependency('Alamatnya di mana?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedEntity).toBe('Kampus Jimbaran');

      const frame = resolveSemanticFrame('Alamatnya di mana?', session);
      expect(frame.entities.map(e => e.canonical)).toContain('Kampus Jimbaran');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
    });

    test('4c. "Syarat masuknya apa?" after discussing S1 Sistem Informasi retains program entity', async () => {
      const session = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
      };

      const contextDep = evaluateContextDependency('Syarat masuknya apa?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Informasi');

      const frame = resolveSemanticFrame('Syarat masuknya apa?', session);
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(['ADMISSION_REQUIREMENTS', 'ADMISSION_PROCEDURE']).toContain(frame.intent);
    });

    test('4d. "Prospek kerjanya bagaimana?" after discussing prodi retains program entity', async () => {
      const session = {
        activeDomain: 'ACADEMIC_CURRICULUM',
        activeIntent: 'CURRICULUM_INQUIRY',
        activeEntity: 'S1 Bisnis Digital',
        lastQuery: 'Bagaimana kurikulum Bisnis Digital?'
      };

      const contextDep = evaluateContextDependency('Prospek kerjanya bagaimana?', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.inheritedEntity).toBe('S1 Bisnis Digital');

      const frame = resolveSemanticFrame('Prospek kerjanya bagaimana?', session);
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Bisnis Digital');
      expect(frame.requestedAttributes).toContain('career_prospects');
    });
  });

  // =========================================================================
  // 5. Partial Entity Correction with Intent Preservation
  // =========================================================================
  describe('5. Partial Entity Correction with Intent Preservation', () => {
    const chatId = 'test_entity_correction_chat';

    beforeEach(async () => {
      await resetSession(chatId);
    });

    test('5a. "Maaf, maksud saya Sistem Informasi" preserves fee intent from prior turn', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'TUITION_FEE',
          activeIntent: 'TUITION_FEE_INQUIRY',
          activeEntity: 'S1 Bisnis Digital',
          requestedAttributes: ['fee', 'dpp', 'tuition'],
          lastQuery: 'Berapa biaya Bisnis Digital?'
        }
      });

      const session = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Maaf, maksud saya Sistem Informasi.', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.isEntityCorrection).toBe(true);
      expect(contextDep.reason).toBe('explicit_entity_correction');
      expect(contextDep.inheritedEntity).toBe('S1 Sistem Informasi');
      expect(contextDep.inheritedDomain).toBe('TUITION_FEE');
      expect(contextDep.inheritedIntent).toBe('TUITION_FEE_INQUIRY');

      const frame = resolveSemanticFrame('Maaf, maksud saya Sistem Informasi.', session);
      expect(frame.domain).toBe('TUITION_FEE');
      expect(frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(frame.entities.map(e => e.canonical)).toEqual(['S1 Sistem Informasi']);
      expect(frame.requestedAttributes).toContain('fee');

      const res = await runPhase1DeterministicPipeline(
        chatId,
        'Maaf, maksud saya Sistem Informasi.',
        { executeDispatch: false }
      );

      const ans = String(res.finalAnswer || res.answer || '');
      expect(ans).toMatch(/Sistem Informasi/i);
      expect(ans).toMatch(/Biaya Kuliah|Rincian Biaya/i);

      const sessionAfter = await getSession(chatId);
      expect(sessionAfter.data.activeEntity).toBe('S1 Sistem Informasi');
      expect(sessionAfter.data.activeDomain).toBe('TUITION_FEE');
    });

    test('5b. Campus location entity correction: "Maaf, maksud saya Kampus Jimbaran"', () => {
      const session = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        activeEntity: 'Kampus Denpasar (Renon)',
        requestedAttributes: ['location', 'address'],
        lastQuery: 'Lokasi Kampus Renon di mana?'
      };

      const contextDep = evaluateContextDependency('Maaf, maksud saya Kampus Jimbaran.', session);
      expect(contextDep.shouldInherit).toBe(true);
      expect(contextDep.isEntityCorrection).toBe(true);
      expect(contextDep.inheritedEntity).toBe('Kampus Jimbaran');
      expect(contextDep.inheritedDomain).toBe('FACILITIES');
      expect(contextDep.inheritedIntent).toBe('CAMPUS_LOCATION');

      const frame = resolveSemanticFrame('Maaf, maksud saya Kampus Jimbaran.', session);
      expect(frame.domain).toBe('FACILITIES');
      expect(frame.intent).toBe('CAMPUS_LOCATION');
      expect(frame.entities.map(e => e.canonical)).toEqual(['Kampus Jimbaran']);
    });

    test('5c. Correction with explicit new topic switches topic: "Maaf, maksud saya syarat masuk Sistem Informasi"', () => {
      const session = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Bisnis Digital',
        lastQuery: 'Berapa biaya Bisnis Digital?'
      };

      const frame = resolveSemanticFrame('Maaf, maksud saya syarat masuk Sistem Informasi', session);
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(['ADMISSION_REQUIREMENTS', 'ADMISSION_PROCEDURE']).toContain(frame.intent);
      expect(frame.requestedAttributes.some(a => ['admission_requirements', 'requirements'].includes(a))).toBe(true);
    });
  });

  // =========================================================================
  // 6. Explicit Context Reset
  // =========================================================================
  describe('6. Explicit Context Reset', () => {
    const chatId = 'test_explicit_reset_chat';

    beforeEach(async () => {
      await resetSession(chatId);
    });

    test('6a. Explicit reset pattern resets active context and starts fresh with new entity', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'ACADEMIC_RECOMMENDATION',
          activeIntent: 'PROGRAM_RECOMMENDATION',
          activeEntity: 'S1 Bisnis Digital',
          preservedBackgroundEntity: 'S1 Bisnis Digital',
          lastQuery: 'Saya tertarik Bisnis Digital.'
        }
      });

      const session = (await getSession(chatId)).data;
      const contextDep = evaluateContextDependency('Lupakan konteks sebelumnya, saya ingin tanya Sistem Komputer.', session);
      expect(contextDep.explicitReset).toBe(true);
      expect(contextDep.shouldInherit).toBe(false);

      const res = await runPhase1DeterministicPipeline(
        chatId,
        'Lupakan konteks sebelumnya, saya ingin tanya Sistem Komputer.',
        { executeDispatch: false }
      );

      const sessionAfter = await getSession(chatId);
      expect(sessionAfter.data.activeEntity).toBe('S1 Sistem Komputer');
      expect(sessionAfter.data.preservedBackgroundEntity).toBeNull();
    });

    test('6b. "Mulai dari awal" without entity completely clears active state', async () => {
      await updateSession(chatId, {
        dataPatch: {
          activeDomain: 'TUITION_FEE',
          activeEntity: 'S1 Bisnis Digital',
          preservedBackgroundEntity: 'S1 Bisnis Digital'
        }
      });

      const contextDep = evaluateContextDependency('Mulai dari awal', (await getSession(chatId)).data);
      expect(contextDep.explicitReset).toBe(true);
      expect(contextDep.shouldInherit).toBe(false);
    });
  });

  // =========================================================================
  // 7. Stale Context TTL Policy
  // =========================================================================
  describe('7. Greenfield Session Context TTL Policy', () => {
    test('7a. getConversationContextTtlMs returns 24 hours by default', () => {
      const ttlMs = getConversationContextTtlMs();
      expect(ttlMs).toBe(24 * 60 * 60 * 1000);
    });

    test('7b. Active session within TTL window retains all context fields', () => {
      const freshData = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Sistem Informasi',
        activeEntities: ['S1 Sistem Informasi'],
        requestedAttributes: ['fee'],
        lastTurnTs: Date.now() - (2 * 60 * 60 * 1000), // 2 hours ago
        turnCount: 3,
        conversationHistory: [{ user: 'Berapa biaya SI?', bot: 'Biaya SI...' }]
      };

      const result = applyContextTtlPolicy(freshData);
      expect(result.activeEntity).toBe('S1 Sistem Informasi');
      expect(result.activeDomain).toBe('TUITION_FEE');
      expect(result.isContextExpired).toBeUndefined();
      expect(result.conversationHistory).toHaveLength(1);
    });

    test('7c. Active session just before TTL boundary (23h 59m ago) retains context', () => {
      const boundaryData = {
        activeEntity: 'S1 Bisnis Digital',
        activeDomain: 'TUITION_FEE',
        lastTurnTs: Date.now() - (24 * 60 * 60 * 1000 - 60000), // 23h 59m
        turnCount: 1
      };

      const result = applyContextTtlPolicy(boundaryData);
      expect(result.activeEntity).toBe('S1 Bisnis Digital');
      expect(result.isContextExpired).toBeUndefined();
    });

    test('7d. Active session past TTL boundary (24h 1m ago) clears active context while preserving history', () => {
      const expiredData = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Bisnis Digital',
        activeEntities: ['S1 Bisnis Digital'],
        preservedBackgroundEntity: 'S1 Bisnis Digital',
        lastAcademicProgramEntity: 'S1 Bisnis Digital',
        lastTurnTs: Date.now() - (24 * 60 * 60 * 1000 + 60000), // 24h 1m ago
        turnCount: 5,
        userOrigin: 'Denpasar',
        historicalAcademicYear: '2026/2027',
        conversationHistory: [{ user: 'Q1', bot: 'A1' }, { user: 'Q2', bot: 'A2' }]
      };

      const result = applyContextTtlPolicy(expiredData);
      expect(result.activeEntity).toBeNull();
      expect(result.activeDomain).toBeNull();
      expect(result.activeEntities).toEqual([]);
      expect(result.preservedBackgroundEntity).toBeNull();
      expect(result.lastAcademicProgramEntity).toBeNull();
      expect(result.isContextExpired).toBe(true);
      // Preserved history
      expect(result.turnCount).toBe(5);
      expect(result.userOrigin).toBe('Denpasar');
      expect(result.historicalAcademicYear).toBe('2026/2027');
      expect(result.conversationHistory).toHaveLength(2);
    });

    test('7e. Missing or invalid timestamp falls back safely to clearing active context', () => {
      const invalidTsData = {
        activeEntity: 'S1 Bisnis Digital',
        activeDomain: 'TUITION_FEE',
        lastTurnTs: null
      };

      const result = applyContextTtlPolicy(invalidTsData);
      expect(result.activeEntity).toBeNull();
      expect(result.isContextExpired).toBe(true);
    });
  });

  // =========================================================================
  // 8. Ambiguous Follow-up without History
  // =========================================================================
  describe('8. Ambiguous Follow-up without Prior History', () => {
    test('8a. "Yang itu berapa?" with empty session triggers AMBIGUOUS_CLARIFICATION without hallucination', () => {
      const contextDep = evaluateContextDependency('Yang itu berapa?', {});
      expect(contextDep.shouldInherit).toBe(false);

      const frame = resolveSemanticFrame('Yang itu berapa?', {});
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
      expect(frame.entities).toEqual([]);
    });

    test('8b. Unresolved ordinal reference "Kalau yang kedua biayanya berapa?" without session triggers clarification', () => {
      const contextDep = evaluateContextDependency('Kalau yang kedua biayanya berapa?', {});
      expect(contextDep.shouldInherit).toBe(false);
      expect(contextDep.isAmbiguous).toBe(true);
      expect(contextDep.reason).toBe('unresolved_ordinal_reference');

      const frame = resolveSemanticFrame('Kalau yang kedua biayanya berapa?', {});
      expect(frame.domain).toBe('GENERAL');
      expect(frame.intent).toBe('AMBIGUOUS_CLARIFICATION');
      expect(frame.desiredAction).toBe('ASK_CLARIFICATION');
    });
  });

  // =========================================================================
  // 9. Cross-Session Isolation
  // =========================================================================
  describe('9. Cross-Session Isolation', () => {
    const userA = 'test_user_isolation_A';
    const userB = 'test_user_isolation_B';

    beforeEach(async () => {
      await resetSession(userA);
      await resetSession(userB);
    });

    test('User A context has zero leakage into User B session', async () => {
      // User A chats about Bisnis Digital
      await runPhase1DeterministicPipeline(
        userA,
        'Berapa biaya kuliah Bisnis Digital?',
        { executeDispatch: false }
      );

      // User B chats about Sistem Komputer
      await runPhase1DeterministicPipeline(
        userB,
        'Berapa biaya kuliah Sistem Komputer?',
        { executeDispatch: false }
      );

      const sessionA = await getSession(userA);
      const sessionB = await getSession(userB);

      expect(sessionA.data.activeEntity).toBe('S1 Bisnis Digital');
      expect(sessionB.data.activeEntity).toBe('S1 Sistem Komputer');

      // User A asks "Bagaimana kurikulumnya?"
      const frameA = resolveSemanticFrame('Bagaimana kurikulumnya?', sessionA.data);
      expect(frameA.entities.map(e => e.canonical)).toEqual(['S1 Bisnis Digital']);

      // User B asks "Bagaimana kurikulumnya?"
      const frameB = resolveSemanticFrame('Bagaimana kurikulumnya?', sessionB.data);
      expect(frameB.entities.map(e => e.canonical)).toEqual(['S1 Sistem Komputer']);
    });
  });

  // =========================================================================
  // 10. Context Retention for Same Program
  // =========================================================================
  describe('10. Context Retention for Same Program across Multiple Topic Transitions', () => {
    test('Program context remains sticky through requirements, curriculum, and career transitions', () => {
      let session = {
        activeDomain: 'TUITION_FEE',
        activeIntent: 'TUITION_FEE_INQUIRY',
        activeEntity: 'S1 Sistem Informasi',
        lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
      };

      // Transition 1: Requirements
      const dep1 = evaluateContextDependency('Syarat masuknya apa?', session);
      expect(dep1.shouldInherit).toBe(true);
      expect(dep1.inheritedEntity).toBe('S1 Sistem Informasi');
      const frame1 = resolveSemanticFrame('Syarat masuknya apa?', session);
      expect(frame1.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(['ADMISSION_REQUIREMENTS', 'ADMISSION_PROCEDURE']).toContain(frame1.intent);

      // Update session to PMB domain
      session.activeDomain = 'PMB';
      session.activeIntent = 'ADMISSION_REQUIREMENTS';

      // Transition 2: Curriculum
      const dep2 = evaluateContextDependency('Bagaimana kurikulumnya?', session);
      expect(dep2.shouldInherit).toBe(true);
      expect(dep2.inheritedEntity).toBe('S1 Sistem Informasi');
      const frame2 = resolveSemanticFrame('Bagaimana kurikulumnya?', session);
      expect(frame2.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(frame2.intent).toBe('CURRICULUM_INQUIRY');

      // Update session to Curriculum domain
      session.activeDomain = 'ACADEMIC_CURRICULUM';
      session.activeIntent = 'CURRICULUM_INQUIRY';

      // Transition 3: Career
      const dep3 = evaluateContextDependency('Prospek kerjanya bagaimana?', session);
      expect(dep3.shouldInherit).toBe(true);
      expect(dep3.inheritedEntity).toBe('S1 Sistem Informasi');
      const frame3 = resolveSemanticFrame('Prospek kerjanya bagaimana?', session);
      expect(frame3.entities.map(e => e.canonical)).toContain('S1 Sistem Informasi');
      expect(frame3.requestedAttributes).toContain('career_prospects');
    });
  });

  // =========================================================================
  // 11. Context Switching without Entity Leakage
  // =========================================================================
  describe('11. Context Switching without Entity Leakage', () => {
    test('Switching from Academic to Facilities to UKM isolates entities properly', () => {
      // Start in Academic session
      const sessionAcademic = {
        activeDomain: 'ACADEMIC_CURRICULUM',
        activeIntent: 'CURRICULUM_INQUIRY',
        activeEntity: 'S1 Sistem Informasi'
      };

      // Switch to Facilities
      const depFac = evaluateContextDependency('Lokasi Kampus Renon di mana?', sessionAcademic);
      expect(depFac.shouldInherit).toBe(false);
      expect(depFac.reason).toBe('campus_wide_domain_isolation');

      const frameFac = resolveSemanticFrame('Lokasi Kampus Renon di mana?', sessionAcademic);
      expect(frameFac.domain).toBe('FACILITIES');
      expect(frameFac.intent).toBe('CAMPUS_LOCATION');
      expect(frameFac.entities.map(e => e.canonical)).toContain('Kampus Denpasar (Renon)');
      expect(frameFac.entities.map(e => e.canonical)).not.toContain('S1 Sistem Informasi');

      // Switch to UKM
      const sessionFac = {
        activeDomain: 'FACILITIES',
        activeIntent: 'CAMPUS_LOCATION',
        activeEntity: 'Kampus Denpasar (Renon)'
      };

      const depUkm = evaluateContextDependency('Ada UKM musik apa saja?', sessionFac);
      expect(depUkm.shouldInherit).toBe(false);

      const frameUkm = resolveSemanticFrame('Ada UKM musik apa saja?', sessionFac);
      expect(frameUkm.domain).toBe('ORGANIZATION_UKM');
      expect(frameUkm.intent).toBe('ORGANIZATION_INQUIRY');
      expect(frameUkm.entities.map(e => e.canonical)).toContain('UKM Musik');
      expect(frameUkm.entities.map(e => e.canonical)).not.toContain('Kampus Denpasar (Renon)');
    });
  });

  // =========================================================================
  // 12. Negative Control: Stale Entity Not Leaked into Retrieval Targets
  // =========================================================================
  describe('12. Negative Control: Stale Entity Not Leaked into Retrieval Targets', () => {
    test('12a. Institutional campus inquiry does not target prior academic program', () => {
      const session = {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        activeIntent: 'TUITION_FEE_INQUIRY'
      };

      const frame = resolveSemanticFrame('Alamat kampus pusat di mana?', session);
      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).not.toContain('S1 Sistem Informasi');
    });

    test('12b. Explicit new program query does not target prior branch campus', () => {
      const session = {
        activeDomain: 'FACILITIES',
        activeEntity: 'Kampus Jimbaran',
        activeIntent: 'CAMPUS_LOCATION'
      };

      const frame = resolveSemanticFrame('Berapa biaya kuliah prodi TI?', session);
      expect(frame.entities.map(e => e.canonical)).toContain('S1 Teknologi Informasi');
      expect(frame.entities.map(e => e.canonical)).not.toContain('Kampus Jimbaran');

      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).toContain('S1 Teknologi Informasi');
      expect(plan.targetEntities).not.toContain('Kampus Jimbaran');
    });
  });
});
