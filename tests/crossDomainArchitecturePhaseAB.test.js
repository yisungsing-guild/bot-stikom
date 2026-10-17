'use strict';

/**
 * tests/crossDomainArchitecturePhaseAB.test.js
 *
 * CHAT ENGINE V2 — PHASE A+B ARCHITECTURAL VALIDATION SUITE
 *
 * Validates the core architectural invariants of Stage A+B:
 * 1. 4-Class Context Decision Model:
 *    - TOPIC_SHIFT
 *    - BOUND_CONTINUATION
 *    - ENTITY_SCOPE_MODIFICATION
 *    - AMBIGUOUS_FOLLOW_UP
 * 2. Double Degree Context Inheritance & Scope Modification:
 *    - "Ada yang nasional?" retains Double Degree entity while mapping to ACADEMIC_PROGRAM.
 *    - Not locked to INTERNATIONAL domain.
 * 3. Institutional PMB Wave Topic Boundary:
 *    - "Sekarang buka gelombang berapa?" cuts context from Double Degree, creates standalone PMB frame.
 *    - Decouples active entity into preserved background without false prodi clarification.
 * 4. Generic Schedule Disambiguation:
 *    - "Jadwalnya kapan?" following PMB continues as BOUND_CONTINUATION (ADMISSION_SCHEDULE).
 *    - "Jadwalnya kapan?" following TUITION_FEE resolves to AMBIGUOUS_FOLLOW_UP safely.
 * 5. Campus-Wide Facility Isolation:
 *    - "Fasilitas olahraga apa saja?" cuts context from academic prodi.
 *    - "Fasilitas olahraganya apa saja?" prevents false pronoun inheritance from non-referential "-nya".
 * 6. Single-Word Underspecified Follow-Up:
 *    - "Berapa?" resolves to AMBIGUOUS_FOLLOW_UP without blind inheritance.
 * 7. Multi-Intent State Isolation:
 *    - Compound query "Berapa biaya kuliah S1 SI dan fasilitas olahraga apa saja?"
 *    - Subquery 2 resolves to FACILITIES without forced domain/intent copy or entity contamination.
 * 8. Phase 2 -> Phase 1 Handoff Integrity:
 *    - Phase 1 reuses valid Phase 2 semanticFrame directly for single-intent queries.
 *    - Standalone Phase 1 execution without pre-computed frame functions deterministically.
 */

const {
  resolveSemanticFrame,
  resolveSemanticFrameAsync
} = require('../src/core/semanticFrameResolver');
const {
  evaluateContextDependency,
  CONTEXT_DECISION
} = require('../src/core/contextResolver');
const {
  computeContextDelta
} = require('../src/reasoning/contextRepair');
const {
  hasMultipleIntents,
  decomposeQuery,
  decomposeQueryAsync,
  isolateSubquerySession
} = require('../src/core/multiIntentResolver');
const {
  evaluateAnswerability,
  ANSWERABILITY_STATUS
} = require('../src/core/answerabilityGate');
const {
  buildExecutionPlan
} = require('../src/reasoning/phase2Planner');
const {
  runPhase1DeterministicPipeline,
  processTurn
} = require('../src/core/orchestrator');
const {
  PLAN_TYPE,
  CONTEXT_ACTION,
  ENTITY_PROVENANCE,
  CAMPUS_WIDE_DOMAINS
} = require('../src/reasoning/contracts');

describe('Chat Engine V2 — Phase A+B Architecture Suite', () => {

  // =========================================================================
  // Scenario 1: Double Degree -> "Ada yang nasional?"
  // =========================================================================
  describe('Scenario 1: Double Degree Scope Modification ("Ada yang nasional?")', () => {
    const priorSession = {
      activeDomain: 'INTERNATIONAL',
      activeEntity: 'Double Degree',
      lastQuery: 'Apa itu double degree? Dan double degree apa saja yang ada di stikom Bali?'
    };

    test('1.1: Context evaluation produces ENTITY_SCOPE_MODIFICATION', () => {
      const q = 'Ada yang nasional?';
      const evalRes = evaluateContextDependency(q, priorSession);

      expect(evalRes.shouldInherit).toBe(true);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.ENTITY_SCOPE_MODIFICATION);
      expect(evalRes.inheritedEntity).toBe('Double Degree');
      expect(evalRes.inheritedDomain).toBe('ACADEMIC_PROGRAM');
      expect(evalRes.scopeModifier).toBe('national');
    });

    test('1.2: Semantic frame resolves to ACADEMIC_PROGRAM and retains Double Degree entity', () => {
      const q = 'Ada yang nasional?';
      const frame = resolveSemanticFrame(q, priorSession);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.relation).toBe('NATIONAL_DOUBLE_DEGREE');
      expect(frame.aspects).toContain('national_program');
      expect(frame.aspects).toContain('double_degree');
      expect(frame.contextDecision).toBe(CONTEXT_DECISION.ENTITY_SCOPE_MODIFICATION);

      // Entity must retain Double Degree connection
      expect(frame.entities.length).toBeGreaterThan(0);
      expect(frame.entities[0].canonical).toBe('Double Degree');
    });

    test('1.3: Context repair delta preserves entity and updates activeDomain', () => {
      const q = 'Ada yang nasional?';
      const frame = resolveSemanticFrame(q, priorSession);
      const delta = computeContextDelta({ data: priorSession }, { rawQuery: q, semanticFrame: frame });

      expect(delta.resolvedState.activeEntity).toBe('Double Degree');
      expect(delta.resolvedState.activeDomain).toBe('ACADEMIC_PROGRAM');
      expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
      expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    });

    test('1.4: Phase 2 planner produces DIRECT plan and avoids false prodi clarification', () => {
      const q = 'Ada yang nasional?';
      const frame = resolveSemanticFrame(q, priorSession);
      const planRes = buildExecutionPlan(q, priorSession, { semanticFrame: frame });

      expect(planRes.success).toBe(true);
      expect(planRes.plan.planType).toBe(PLAN_TYPE.DIRECT);
      expect(planRes.plan.planType).not.toBe(PLAN_TYPE.AMBIGUOUS_CLARIFICATION);
    });
  });

  // =========================================================================
  // Scenario 2: Double Degree -> "Sekarang buka gelombang berapa?"
  // =========================================================================
  describe('Scenario 2: Institutional PMB Wave Topic Boundary ("Sekarang buka gelombang berapa?")', () => {
    const priorSession = {
      activeDomain: 'INTERNATIONAL',
      activeEntity: 'Double Degree',
      lastQuery: 'Cuma 2 aja double Degree di stikom bali?'
    };

    test('2.1: Context evaluation produces TOPIC_SHIFT and cuts Double Degree inheritance', () => {
      const q = 'Sekarang buka gelombang berapa?';
      const evalRes = evaluateContextDependency(q, priorSession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);
      expect(evalRes.reason).toBe('independent_pmb_inquiry');
    });

    test('2.2: Semantic frame establishes independent PMB domain with zero inherited academic entity', () => {
      const q = 'Sekarang buka gelombang berapa?';
      const frame = resolveSemanticFrame(q, priorSession);

      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('CURRENT_ENROLLMENT_STATUS');
      expect(frame.aspects).toContain('wave_info');
      expect(frame.contextDecision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);

      // Must NOT inherit Double Degree
      expect(frame.entities.some(e => /double\s*degree/i.test(e.canonical))).toBe(false);
    });

    test('2.3: Context repair decouples activeEntity into preservedBackgroundEntity', () => {
      const q = 'Sekarang buka gelombang berapa?';
      const frame = resolveSemanticFrame(q, priorSession);
      const delta = computeContextDelta({ data: priorSession }, { rawQuery: q, semanticFrame: frame });

      expect(delta.resolvedState.activeDomain).toBe('PMB');
      expect(delta.resolvedState.activeEntity).toBeNull();
      expect(delta.resolvedState.preservedBackgroundEntity).toBe('Double Degree');
      expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.NONE);
    });

    test('2.4: Phase 2 planner recognizes CURRENT_ENROLLMENT_STATUS as institutional and does not trigger clarification', () => {
      const q = 'Sekarang buka gelombang berapa?';
      const frame = resolveSemanticFrame(q, priorSession);
      const planRes = buildExecutionPlan(q, priorSession, { semanticFrame: frame });

      expect(planRes.success).toBe(true);
      expect(planRes.plan.planType).not.toBe(PLAN_TYPE.AMBIGUOUS_CLARIFICATION);
    });
  });

  // =========================================================================
  // Scenario 3: PMB Context -> "Jadwalnya kapan?"
  // =========================================================================
  describe('Scenario 3: Admission Schedule Follow-Up ("Jadwalnya kapan?" following PMB)', () => {
    const pmbSession = {
      activeDomain: 'PMB',
      activeIntent: 'ADMISSION_SCHEDULE',
      lastQuery: 'Informasi pendaftaran mahasiswa baru'
    };

    test('3.1: Context evaluation produces BOUND_CONTINUATION for PMB schedule context', () => {
      const q = 'Jadwalnya kapan?';
      const evalRes = evaluateContextDependency(q, pmbSession);

      expect(evalRes.shouldInherit).toBe(true);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.BOUND_CONTINUATION);
      expect(evalRes.inheritedDomain).toBe('PMB');
      expect(evalRes.inheritedIntent).toBe('ADMISSION_SCHEDULE');
    });

    test('3.2: Context delta maintains PMB domain continuity without entity collision', () => {
      const q = 'Jadwalnya kapan?';
      const frame = resolveSemanticFrame(q, pmbSession);
      const delta = computeContextDelta({ data: pmbSession }, { rawQuery: q, semanticFrame: frame });

      expect(delta.resolvedState.activeDomain).toBe('PMB');
      expect(delta.actions).toContain(CONTEXT_ACTION.CONTEXT_PRESERVED);
    });
  });

  // =========================================================================
  // Scenario 4: Tuition Fee Context -> "Jadwalnya kapan?"
  // =========================================================================
  describe('Scenario 4: Ambiguous Schedule Disambiguation ("Jadwalnya kapan?" following TUITION_FEE)', () => {
    const feeSession = {
      activeDomain: 'TUITION_FEE',
      activeIntent: 'TUITION_FEE_INQUIRY',
      activeEntity: 'S1 Sistem Informasi',
      lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
    };

    test('4.1: Context evaluation detects ambiguity and flags AMBIGUOUS_FOLLOW_UP', () => {
      const q = 'Jadwalnya kapan?';
      const evalRes = evaluateContextDependency(q, feeSession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP);
      expect(evalRes.reason).toBe('ambiguous_schedule_followup');
    });

    test('4.2: Does not blindly inherit PMB schedule or hijack fee entity into admission window', () => {
      const q = 'Jadwalnya kapan?';
      const evalRes = evaluateContextDependency(q, feeSession);

      expect(evalRes.inheritedIntent).toBeUndefined();
    });

    test('4.3: Decouples activeEntity to null and preserves it as background clarification anchor', () => {
      const q = 'Jadwalnya kapan?';
      const frame = resolveSemanticFrame(q, feeSession);
      const delta = computeContextDelta({ data: feeSession }, { rawQuery: q, semanticFrame: frame });

      expect(delta.resolvedState.activeEntity).toBeNull();
      expect(delta.resolvedState.preservedBackgroundEntity).toBe('S1 Sistem Informasi');
      expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.NONE);
      expect(delta.actions).toContain(CONTEXT_ACTION.AMBIGUITY_DETECTED);
    });

    test('4.4: Subsequent prodi-relevant clarification can explicitly restore preservedBackgroundEntity', () => {
      const clarifiedQuery = 'Bagaimana kurikulumnya?';
      const sessionWithBackground = {
        activeDomain: 'TUITION_FEE',
        activeEntity: null,
        preservedBackgroundEntity: 'S1 Sistem Informasi'
      };
      const frame = resolveSemanticFrame(clarifiedQuery, sessionWithBackground);
      const delta = computeContextDelta({ data: sessionWithBackground }, { rawQuery: clarifiedQuery, semanticFrame: frame });

      expect(delta.resolvedState.activeEntity).toBe('S1 Sistem Informasi');
      expect(delta.resolvedState.preservedBackgroundEntity).toBeNull();
      expect(delta.resolvedState.entityProvenance).toBe(ENTITY_PROVENANCE.INHERITED_FROM_SESSION);
    });
  });

  // =========================================================================
  // Scenario 5: Tuition Fee Context -> "Fasilitas olahraga apa saja?"
  // =========================================================================
  describe('Scenario 5: Campus-Wide Facility Decoupling ("Fasilitas olahraga apa saja?")', () => {
    const feeSession = {
      activeDomain: 'TUITION_FEE',
      activeEntity: 'S1 Sistem Informasi',
      lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
    };

    test('5.1: Context evaluation recognizes campus-wide isolation and triggers TOPIC_SHIFT', () => {
      const q = 'Fasilitas olahraga apa saja?';
      const evalRes = evaluateContextDependency(q, feeSession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);
      expect(evalRes.reason).toBe('campus_wide_domain_isolation');
    });

    test('5.2: Semantic frame establishes facility domain and does NOT inherit academic program entity', () => {
      const q = 'Fasilitas olahraga apa saja?';
      const frame = resolveSemanticFrame(q, feeSession);

      expect(frame.domain).toBe('FACILITIES');
      expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
      expect(frame.contextDecision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);
    });

    test('5.3: Context repair decouples prodi entity into background', () => {
      const q = 'Fasilitas olahraga apa saja?';
      const frame = resolveSemanticFrame(q, feeSession);
      const delta = computeContextDelta({ data: feeSession }, { rawQuery: q, semanticFrame: frame });

      expect(delta.resolvedState.activeDomain).toBe('FACILITIES');
      expect(delta.resolvedState.activeEntity).toBeNull();
      expect(delta.resolvedState.preservedBackgroundEntity).toBe('S1 Sistem Informasi');
    });
  });

  // =========================================================================
  // Scenario 6: Non-Referential Definiteness ("Fasilitas olahraganya apa saja?")
  // =========================================================================
  describe('Scenario 6: Non-Referential "-nya" Enclitic Guard ("Fasilitas olahraganya apa saja?")', () => {
    const feeSession = {
      activeDomain: 'TUITION_FEE',
      activeEntity: 'S1 Sistem Informasi',
      lastQuery: 'Berapa biaya kuliah S1 Sistem Informasi?'
    };

    test('6.1: Grammatical definiteness on "olahraganya" is recognized as non-referential', () => {
      const q = 'Fasilitas olahraganya apa saja?';
      const evalRes = evaluateContextDependency(q, feeSession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.TOPIC_SHIFT);
      expect(evalRes.reason).toBe('campus_wide_domain_isolation');
    });

    test('6.2: Frame resolution isolates facilities from academic program entity', () => {
      const q = 'Fasilitas olahraganya apa saja?';
      const frame = resolveSemanticFrame(q, feeSession);

      expect(frame.domain).toBe('FACILITIES');
      expect(frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
    });
  });

  // =========================================================================
  // Scenario 7: Underspecified Single-Word Query ("Berapa?")
  // =========================================================================
  describe('Scenario 7: Single-Word Underspecified Inquiry ("Berapa?")', () => {
    const anySession = {
      activeDomain: 'ACADEMIC_PROGRAM',
      activeEntity: 'S1 Sistem Informasi',
      lastQuery: 'Apa saja mata kuliah S1 Sistem Informasi?'
    };

    test('7.1: Single-word query without predicate returns AMBIGUOUS_FOLLOW_UP', () => {
      const q = 'Berapa?';
      const evalRes = evaluateContextDependency(q, anySession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP);
      expect(evalRes.reason).toBe('ambiguous_query');
    });

    test('7.2: Variations like "Kapan?" also resolve safely to AMBIGUOUS_FOLLOW_UP', () => {
      const q = 'Kapan?';
      const evalRes = evaluateContextDependency(q, anySession);

      expect(evalRes.shouldInherit).toBe(false);
      expect(evalRes.decision).toBe(CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP);
    });
  });

  // =========================================================================
  // Scenario 8: Multi-Intent State Isolation (Fee SI + Facility)
  // =========================================================================
  describe('Scenario 8: Multi-Intent State Isolation', () => {
    const q = 'Berapa biaya kuliah S1 Sistem Informasi dan fasilitas olahraga apa saja yang tersedia?';

    test('8.1: hasMultipleIntents identifies compound conjunction structure', () => {
      expect(hasMultipleIntents(q)).toBe(true);
    });

    test('8.2: decomposeQuery decomposes into discrete frames without domain forcing', () => {
      const frames = decomposeQuery(q);

      expect(frames.length).toBe(2);

      // SubQuery 1: Tuition Fee for S1 Sistem Informasi
      const sub1 = frames[0];
      expect(sub1.domain).toBe('TUITION_FEE');
      expect(sub1.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);

      // SubQuery 2: Facilities - MUST NOT be forced into TUITION_FEE domain!
      const sub2 = frames[1];
      expect(sub2.domain).toBe('FACILITIES');
      expect(sub2.domain).not.toBe('TUITION_FEE');

      // SubQuery 2 MUST NOT inherit S1 Sistem Informasi entity
      expect(sub2.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
    });

    test('8.3: decomposeQueryAsync exhibits identical state isolation', async () => {
      const frames = await decomposeQueryAsync(q);

      expect(frames.length).toBe(2);
      expect(frames[0].domain).toBe('TUITION_FEE');
      expect(frames[1].domain).toBe('FACILITIES');
      expect(frames[1].entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
    }, 30000);

    test('8.4: Compound Query (Fee SI + Syarat Pendaftaran) inherits S1 Sistem Informasi to PMB subquery', () => {
      const compoundQ = 'Berapa biaya kuliah S1 Sistem Informasi dan apa syarat pendaftarannya?';
      const frames = decomposeQuery(compoundQ);

      expect(frames.length).toBe(2);

      // Subquery 1: S1 SI Fee
      expect(frames[0].domain).toBe('TUITION_FEE');
      expect(frames[0].entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);

      // Subquery 2: PMB Admission Procedure - MUST retain S1 Sistem Informasi entity
      expect(frames[1].domain).toBe('PMB');
      expect(frames[1].entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
    });

    test('8.5: Compound Query (Fee SI + Fasilitas Olahraga) keeps facilities subquery strictly decoupled', () => {
      const compoundQ = 'Berapa biaya kuliah S1 Sistem Informasi dan fasilitas olahraga kampus apa saja?';
      const frames = decomposeQuery(compoundQ);

      expect(frames.length).toBe(2);

      // Subquery 1: S1 SI Fee
      expect(frames[0].domain).toBe('TUITION_FEE');
      expect(frames[0].entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);

      // Subquery 2: Facilities - MUST NOT inherit S1 Sistem Informasi
      expect(frames[1].domain).toBe('FACILITIES');
      expect(frames[1].entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
      expect(frames[1].entities.length).toBe(0);
    });

    test('8.6: Session snapshot isolation prevents mutation leakage across subqueries', () => {
      const sharedSession = {
        activeDomain: 'TUITION_FEE',
        activeEntity: 'S1 Sistem Informasi',
        contextHistory: [{ turn: 1, text: 'initial' }],
        recentEntities: ['S1 Sistem Informasi'],
        data: { customField: 'original_value' }
      };

      const frames = decomposeQuery('Berapa biaya kuliah S1 Sistem Informasi dan apa fasilitasnya?', sharedSession);
      expect(frames.length).toBe(2);

      // Verify original session structure was not mutated or polluted
      expect(sharedSession.contextHistory.length).toBe(1);
      expect(sharedSession.contextHistory[0].text).toBe('initial');
      expect(sharedSession.recentEntities.length).toBe(1);
      expect(sharedSession.data.customField).toBe('original_value');
    });

    test('8.7: isolateSubquerySession guarantees deep isolation of nested mutable objects', () => {
      const complexSession = {
        activeDomain: 'TUITION_FEE',
        activeEntity: { canonical: 'S1 Sistem Informasi', type: 'program' },
        preservedBackgroundEntity: { canonical: 'S1 Sistem Informasi', type: 'program' },
        contextHistory: [
          {
            turn: 1,
            text: 'Berapa biaya S1 SI?',
            entities: [{ canonical: 'S1 Sistem Informasi' }],
            activeEntity: { canonical: 'S1 Sistem Informasi' }
          }
        ],
        recentEntities: [
          { name: 'S1 Sistem Informasi', canonical: 'S1 Sistem Informasi', type: 'program' }
        ],
        pendingClarification: {
          prompt: 'Pilih program studi',
          candidates: [{ name: 'S1 Sistem Informasi' }, { name: 'S1 Teknik Informatika' }],
          options: ['A', 'B']
        },
        data: {
          slots: { major: 'S1 Sistem Informasi' },
          entities: [{ id: 'ent_1', name: 'S1 Sistem Informasi' }]
        },
        lastRetrievedPrograms: [{ id: 'prog_1', name: 'S1 Sistem Informasi' }]
      };

      const clone1 = isolateSubquerySession(complexSession);
      const clone2 = isolateSubquerySession(complexSession);

      // Mutate clone1 deeply across all nested mutable properties
      clone1.activeEntity.canonical = 'MUTATED_ACTIVE';
      clone1.preservedBackgroundEntity.canonical = 'MUTATED_PRESERVED';
      clone1.contextHistory[0].text = 'MUTATED_TEXT';
      clone1.contextHistory[0].entities[0].canonical = 'MUTATED_ENTITY';
      clone1.contextHistory[0].activeEntity.canonical = 'MUTATED_TURN_ACTIVE';
      clone1.recentEntities[0].name = 'MUTATED_RECENT';
      clone1.pendingClarification.candidates[0].name = 'MUTATED_CANDIDATE';
      clone1.pendingClarification.options.push('C');
      clone1.data.slots.major = 'MUTATED_SLOT';
      clone1.data.entities[0].id = 'MUTATED_ENT_ID';
      clone1.lastRetrievedPrograms[0].name = 'MUTATED_PROG';

      // Verify original complexSession is completely unaffected
      expect(complexSession.activeEntity.canonical).toBe('S1 Sistem Informasi');
      expect(complexSession.preservedBackgroundEntity.canonical).toBe('S1 Sistem Informasi');
      expect(complexSession.contextHistory[0].text).toBe('Berapa biaya S1 SI?');
      expect(complexSession.contextHistory[0].entities[0].canonical).toBe('S1 Sistem Informasi');
      expect(complexSession.contextHistory[0].activeEntity.canonical).toBe('S1 Sistem Informasi');
      expect(complexSession.recentEntities[0].name).toBe('S1 Sistem Informasi');
      expect(complexSession.pendingClarification.candidates[0].name).toBe('S1 Sistem Informasi');
      expect(complexSession.pendingClarification.options).toEqual(['A', 'B']);
      expect(complexSession.data.slots.major).toBe('S1 Sistem Informasi');
      expect(complexSession.data.entities[0].id).toBe('ent_1');
      expect(complexSession.lastRetrievedPrograms[0].name).toBe('S1 Sistem Informasi');

      // Verify clone2 is completely unaffected
      expect(clone2.activeEntity.canonical).toBe('S1 Sistem Informasi');
      expect(clone2.contextHistory[0].entities[0].canonical).toBe('S1 Sistem Informasi');
      expect(clone2.recentEntities[0].name).toBe('S1 Sistem Informasi');
      expect(clone2.pendingClarification.candidates[0].name).toBe('S1 Sistem Informasi');
      expect(clone2.pendingClarification.options).toEqual(['A', 'B']);
      expect(clone2.data.slots.major).toBe('S1 Sistem Informasi');
    });
  });

  // =========================================================================
  // Scenario 9: Phase 2 -> Phase 1 Semantic Frame Reuse
  // =========================================================================
  describe('Scenario 9: Phase 2 -> Phase 1 Semantic Frame Reuse', () => {
    test('9.1: Phase 1 deterministic pipeline reuses provided semanticFrame without re-interpretation', async () => {
      const rawQuery = 'Apakah ada program Double Degree nasional?';
      const precomputedFrame = {
        rawQuery,
        normalizedQuery: 'apakah ada program double degree nasional',
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['double_degree', 'national_program', 'partnership'],
        entities: [{ canonical: 'Double Degree', type: 'international_program', family: 'international_program' }],
        relation: 'NATIONAL_DOUBLE_DEGREE',
        retrievalRequired: true,
        userState: 'INQUIRING',
        desiredAction: 'PROVIDE_PROGRAM_INFO',
        language: 'id',
        subQueries: [],
        contextDependencies: [],
        contextDecision: CONTEXT_DECISION.BOUND_CONTINUATION
      };

      const result = await runPhase1DeterministicPipeline('test-reuse-chat', rawQuery, {
        semanticFrame: precomputedFrame,
        syncOnly: true
      });

      expect(result).toBeDefined();
      expect(result.subQueryResults.length).toBe(1);

      const executedFrame = result.subQueryResults[0].frame;
      expect(executedFrame.domain).toBe('ACADEMIC_PROGRAM');
      expect(executedFrame.intent).toBe('PROGRAM_OVERVIEW');
      expect(executedFrame.relation).toBe('NATIONAL_DOUBLE_DEGREE');
      expect(executedFrame.entities[0].canonical).toBe('Double Degree');
      expect(executedFrame.aspects).toContain('national_program');
    }, 30000);

    test('9.2: Standalone Phase 1 execution without precomputed frame functions deterministically', async () => {
      const rawQuery = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const result = await runPhase1DeterministicPipeline('test-standalone-p1', rawQuery, {
        syncOnly: true
      });

      expect(result).toBeDefined();
      expect(result.subQueryResults.length).toBeGreaterThan(0);

      const executedFrame = result.subQueryResults[0].frame;
      expect(executedFrame.domain).toBe('TUITION_FEE');
      expect(executedFrame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
      expect(result.finalAnswer).toBeDefined();
      expect(result.finalAnswer.length).toBeGreaterThan(20);
    }, 30000);

    test('9.3: Mismatched precomputed frame is safely rejected and falls back to decomposing rawQuery', async () => {
      const rawQuery = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const staleMismatchedFrame = {
        rawQuery: 'Apa itu double degree?',
        normalizedQuery: 'apa itu double degree',
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        aspects: ['overview'],
        entities: [{ canonical: 'Double Degree' }]
      };

      const result = await runPhase1DeterministicPipeline('test-mismatched-frame', rawQuery, {
        semanticFrame: staleMismatchedFrame,
        syncOnly: true
      });

      expect(result).toBeDefined();
      expect(result.subQueryResults.length).toBeGreaterThan(0);

      // Frame must NOT be the stale INTERNATIONAL frame; must resolve correctly to TUITION_FEE for rawQuery
      const executedFrame = result.subQueryResults[0].frame;
      expect(executedFrame.domain).toBe('TUITION_FEE');
      expect(executedFrame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(true);
    }, 30000);

    test('9.4: Turn isolation guarantees subsequent turns do not leak or reuse precomputed frame from previous turn', async () => {
      const rawQuery = 'Berapa biaya kuliah?';

      // Turn 1: Processed with an explicit precomputed frame bound to S1 Sistem Informasi
      const turn1Frame = {
        rawQuery,
        normalizedQuery: 'berapa biaya kuliah',
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        aspects: ['fee'],
        entities: [{ canonical: 'S1 Sistem Informasi' }]
      };

      const turn1Result = await runPhase1DeterministicPipeline('turn-isolation-chat-1', rawQuery, {
        semanticFrame: turn1Frame,
        syncOnly: true
      });
      expect(turn1Result.subQueryResults[0].frame.entities[0].canonical).toBe('S1 Sistem Informasi');

      // Turn 2: Exact same query text arrives in another turn
      // No options.semanticFrame is passed — proves no module/global frame caching occurs
      const turn2Result = await runPhase1DeterministicPipeline('turn-isolation-chat-1', rawQuery, {
        syncOnly: true
      });

      // Turn 2 must NOT inherit Turn 1's precomputed frame entity (S1 Sistem Informasi)
      // Since rawQuery has no prodi mention, a fresh decomposition yields 0 entities
      const turn2Frame = turn2Result.subQueryResults[0].frame;
      expect(turn2Frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
      expect(turn2Frame.entities.length).toBe(0);

      // Turn 3: Query with different program arrives even if a stale options.semanticFrame from Turn 1 is passed
      const turn3Query = 'Berapa biaya kuliah S1 Teknologi Informasi?';
      const turn3Result = await runPhase1DeterministicPipeline('turn-isolation-chat-1', turn3Query, {
        semanticFrame: turn1Frame, // stale frame from turn 1
        syncOnly: true
      });

      // Stale frame must be rejected by isSemanticFrameMatchingQuery; frame resolves freshly to S1 Teknologi Informasi
      const turn3Frame = turn3Result.subQueryResults[0].frame;
      expect(turn3Frame.entities.some(e => e.canonical === 'S1 Sistem Informasi')).toBe(false);
      expect(turn3Frame.entities.some(e => e.canonical === 'S1 Teknologi Informasi')).toBe(true);
    }, 30000);

    test('9.5: Multi-intent query with single-intent precomputed frame safely bypasses stale frame reuse', async () => {
      const compoundQuery = 'Berapa biaya kuliah S1 Sistem Informasi dan fasilitas apa saja?';
      const singleIntentFrame = {
        rawQuery: compoundQuery,
        normalizedQuery: 'berapa biaya kuliah s1 sistem informasi dan fasilitas apa saja',
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        aspects: ['fee'],
        entities: [{ canonical: 'S1 Sistem Informasi' }]
      };

      // Since rawQuery has multiple intents, isFrameReusable must be false and decompose both intents
      const result = await runPhase1DeterministicPipeline('multi-intent-bypass-chat', compoundQuery, {
        semanticFrame: singleIntentFrame,
        syncOnly: true
      });

      expect(result.subQueryResults.length).toBe(2);
      expect(result.subQueryResults[0].frame.domain).toBe('TUITION_FEE');
      expect(result.subQueryResults[1].frame.domain).toBe('FACILITIES');
    }, 30000);
  });

  // =========================================================================
  // Scenario 10: Contractual Invariants
  // =========================================================================
  describe('Scenario 10: Contractual Invariants Verification', () => {
    test('10.1: CONTEXT_DECISION enum covers exactly 4 distinct decision types', () => {
      expect(Object.keys(CONTEXT_DECISION).sort()).toEqual([
        'AMBIGUOUS_FOLLOW_UP',
        'BOUND_CONTINUATION',
        'ENTITY_SCOPE_MODIFICATION',
        'TOPIC_SHIFT'
      ].sort());

      expect(CONTEXT_DECISION.TOPIC_SHIFT).toBe('topic_shift');
      expect(CONTEXT_DECISION.BOUND_CONTINUATION).toBe('bound_continuation');
      expect(CONTEXT_DECISION.ENTITY_SCOPE_MODIFICATION).toBe('entity_scope_modification');
      expect(CONTEXT_DECISION.AMBIGUOUS_FOLLOW_UP).toBe('ambiguous_follow_up');
    });

    test('10.2: CAMPUS_WIDE_DOMAINS contains PMB and ADMISSION alongside FACILITIES and UKM', () => {
      expect(CAMPUS_WIDE_DOMAINS).toContain('PMB');
      expect(CAMPUS_WIDE_DOMAINS).toContain('ADMISSION');
      expect(CAMPUS_WIDE_DOMAINS).toContain('FACILITIES');
      expect(CAMPUS_WIDE_DOMAINS).toContain('ORGANIZATION_UKM');
      expect(CAMPUS_WIDE_DOMAINS).toContain('SCHOLARSHIP');
    });
  });

  // =========================================================================
  // Scenario 11: Answerability Gate Aspect Verification
  // =========================================================================
  describe('Scenario 11: Answerability Gate Aspect Verification (National Program vs Partnership vs Double Degree)', () => {
    test('11.1: Bukti Double Degree internasional HELP/DNUI yang tidak menyebut cakupan nasional tidak menutupi aspek national_program', () => {
      const frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['double_degree', 'national_program', 'partnership'],
        entities: [{ canonical: 'Double Degree' }]
      };

      const internationalEvidence = {
        accepted: [
          {
            id: 'help_dnui_chunk',
            text: 'Program Dual Degree dengan HELP University di Malaysia dan DNUI China memberikan dua gelar internasional bagi lulusan ITB STIKOM Bali.',
            providedAspects: ['double_degree', 'partnership']
          }
        ]
      };

      const result = evaluateAnswerability(frame, internationalEvidence);

      // double_degree and partnership are covered, but national_program MUST NOT be covered
      expect(result.coveredAspects).toContain('double_degree');
      expect(result.coveredAspects).toContain('partnership');
      expect(result.coveredAspects).not.toContain('national_program');
      expect(result.missingAspects).toContain('national_program');
      expect(result.status).toBe(ANSWERABILITY_STATUS.PARTIAL);
    });

    test('11.2: Bukti eksplisit DUAL DEGREE (NATIONAL CLASS) dengan Universitas Teknologi Bandung mendukung aspek national_program dan partnership', () => {
      const frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['double_degree', 'national_program', 'partnership'],
        entities: [{ canonical: 'Double Degree' }]
      };

      const nationalClassEvidence = {
        accepted: [
          {
            id: '63bcf8a2-6ce8-4f96-81b1-6d03eb0c94ee',
            text: 'SK No. 629/ITBSTIKOM/WDS/X/25: DUAL DEGREE (NATIONAL CLASS) dengan Universitas Teknologi Bandung (UTB), gelar S.Bns. dan S.Ds.',
            providedAspects: []
          }
        ]
      };

      const result = evaluateAnswerability(frame, nationalClassEvidence);

      expect(result.coveredAspects).toContain('double_degree');
      expect(result.coveredAspects).toContain('national_program');
      expect(result.coveredAspects).toContain('partnership');
      expect(result.missingAspects.length).toBe(0);
      expect(result.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
    });

    test('11.3: Aspek partnership tetap dinilai berdasarkan bukti kerja sama yang relevan', () => {
      const frame = {
        domain: 'INSTITUTIONAL',
        intent: 'PARTNERSHIP_INFO',
        aspects: ['partnership'],
        entities: []
      };

      const partnerEvidence = {
        accepted: [
          {
            id: 'partner_chunk',
            text: 'ITB STIKOM Bali menjalin kerjasama kemitraan strategis dengan institusi partner dan perguruan tinggi mitra resmi.',
            providedAspects: []
          }
        ]
      };

      const result = evaluateAnswerability(frame, partnerEvidence);

      expect(result.coveredAspects).toContain('partnership');
      expect(result.missingAspects.length).toBe(0);
      expect(result.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
    });

    test('11.4: Bukti yang hanya menyebut "nasional" dalam konteks lain tidak otomatis membuktikan program Double Degree nasional', () => {
      const frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['double_degree', 'national_program'],
        entities: [{ canonical: 'Double Degree' }]
      };

      const unrelatedNationalEvidence = {
        accepted: [
          {
            id: 'unrelated_nasional_chunk',
            text: 'ITB STIKOM Bali memiliki akreditasi nasional Baik Sekali dari BAN-PT dan prestasi mahasiswa tingkat nasional.',
            providedAspects: []
          }
        ]
      };

      const result = evaluateAnswerability(frame, unrelatedNationalEvidence);

      // Neither double_degree nor national_program should be satisfied by standalone national accreditation/awards
      expect(result.coveredAspects).not.toContain('national_program');
      expect(result.coveredAspects).not.toContain('double_degree');
      expect(result.missingAspects).toContain('national_program');
      expect(result.missingAspects).toContain('double_degree');
      expect(result.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    });

    test('11.5: Kata "Double Degree" saja tidak cukup untuk memenuhi aspek national_program', () => {
      const frame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['national_program'],
        entities: [{ canonical: 'Double Degree' }]
      };

      const genericDoubleDegreeEvidence = {
        accepted: [
          {
            id: 'generic_dd_chunk',
            text: 'Informasi umum mengenai pendaftaran program Double Degree di kampus ITB STIKOM Bali.',
            providedAspects: []
          }
        ]
      };

      const result = evaluateAnswerability(frame, genericDoubleDegreeEvidence);

      expect(result.coveredAspects).not.toContain('national_program');
      expect(result.missingAspects).toContain('national_program');
      expect(result.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    });
  });
});
