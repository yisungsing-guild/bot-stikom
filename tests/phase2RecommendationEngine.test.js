'use strict';

/**
 * tests/phase2RecommendationEngine.test.js
 *
 * Phase 2 Step 7 & Wave 2 Final Test Suite:
 * Neutral Curriculum Profile Gathering & Grounded Recommendation Contract.
 */

const {
  compareCodePoints,
  classifyPresentationType,
  computeCandidateScores,
  evaluateRecommendation
} = require('../src/reasoning/recommendationEngine');

const { renderRecommendationAnswer } = require('../src/core/groundedAnswerGenerator');
const { validateProgramFeature } = require('../src/reasoning/contracts');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { executePhase2Bridge } = require('../src/reasoning/phase2Bridge');
const { processTurn } = require('../src/core/orchestrator');
const { getSession } = require('../src/core/conversationState');
const { sanitizeWhatsAppMarkdown } = require('../src/core/outboundRenderer');

describe('Phase 2 Step 7 & Wave 2: Neutral Curriculum Recommendation Engine Suite', () => {

  describe('1. Presentation Classification & Neutral Ordering', () => {
    test('Canonical Unicode tie-break ordering is deterministic', () => {
      const candA = { canonicalName: 'S1 Sistem Komputer' };
      const candB = { canonicalName: 'S1 Bisnis Digital' };
      const list1 = [candA, candB];
      const list2 = [candB, candA];

      const sortFn = (a, b) => compareCodePoints(a.canonicalName, b.canonicalName);

      const sorted1 = [...list1].sort(sortFn);
      const sorted2 = [...list2].sort(sortFn);

      expect(sorted1[0].canonicalName).toBe('S1 Bisnis Digital');
      expect(sorted2[0].canonicalName).toBe('S1 Bisnis Digital');
      expect(sorted1).toEqual(sorted2);
    });

    test('Broad profile or high ambiguity produces BROAD_GUIDANCE', () => {
      const candidates = [
        { canonicalName: 'S1 Teknologi Informasi' },
        { canonicalName: 'S1 Sistem Informasi' }
      ];
      expect(classifyPresentationType(true, candidates)).toBe('BROAD_GUIDANCE');
      expect(classifyPresentationType(false, [])).toBe('BROAD_GUIDANCE');
      expect(classifyPresentationType(false, candidates, { ambiguityLevel: 'HIGH' })).toBe('BROAD_GUIDANCE');
    });

    test('Candidate curriculum profiles produce NEUTRAL_CURRICULUM_OVERVIEW without crowning DOMINANT_SINGLE', () => {
      const candidates = [
        { canonicalName: 'S1 Bisnis Digital' },
        { canonicalName: 'S1 Sistem Informasi' }
      ];
      expect(classifyPresentationType(false, candidates)).toBe('NEUTRAL_CURRICULUM_OVERVIEW');
    });
  });

  describe('2. Determinism & Idempotency', () => {
    test('Repeated execution with identical input produces byte-identical structured result', () => {
      const query = 'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?';
      const res1 = evaluateRecommendation(query);
      const res2 = evaluateRecommendation(query);

      expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
    });

    test('contextRelations deterministic structure and content', () => {
      const query = 'Saya suka coding aplikasi dan web';
      const result = evaluateRecommendation(query);

      expect(Array.isArray(result.contextRelations)).toBe(true);
      expect(result.contextRelations.length).toBeGreaterThan(0);
      const rel = result.contextRelations[0];
      expect(rel.source).toBe(result.scoredCandidates[0].canonicalName);
      expect(rel.relation).toBe('curriculum_option');
      expect(rel.target).toBe(result.scoredCandidates[1].canonicalName);
      expect(typeof rel.reason).toBe('string');
      expect(rel.reason.length).toBeGreaterThan(0);
    });

    test('Sanitizer fixed point invariant on rendered recommendation answers', () => {
      const queries = [
        'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?',
        'Saya suka desain poster dan gambar DKV',
        'Saya tertarik UI/UX dan produk digital',
        'Saya lulusan SMK komputer'
      ];

      for (const q of queries) {
        const structured = evaluateRecommendation(q);
        const rendered = renderRecommendationAnswer(structured);
        const sanitized = sanitizeWhatsAppMarkdown(rendered);
        expect(sanitized).toBe(rendered);
      }
    });
  });

  describe('3. Invariants & Official Grounding', () => {
    test('Anti-absolute-claim invariant strictly upheld in all render modes', () => {
      const testQueries = [
        'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?',
        'Saya takut matematika tapi ingin kuliah IT',
        'Saya suka bikin game',
        'Saya introvert dan suka kerja sendiri'
      ];

      for (const q of testQueries) {
        const structured = evaluateRecommendation(q);
        const rendered = renderRecommendationAnswer(structured);

        expect(rendered).not.toMatch(/\bpasti\s+cocok\b/i);
        expect(rendered).not.toMatch(/\bpasti\s+pilih\b/i);
        expect(rendered).toMatch(/admisi\s+PMB|ketentuan\s+resmi/i);
      }
    });

    test('Official grounding provenance and validateProgramFeature adherence', () => {
      const query = 'Saya suka data analysis dan bisnis intelligence';
      const result = evaluateRecommendation(query);

      expect(result.detectedSignals.length).toBeGreaterThan(0);
      for (const sig of result.detectedSignals) {
        const validation = validateProgramFeature(sig);
        expect(validation.valid).toBe(true);
        expect(sig.evidenceSource).toContain('Pedoman Akademik & Kurikulum Resmi');
        expect(sig.evidenceSnippet.length).toBeGreaterThan(0);
        expect(typeof sig.weights).toBe('object');
      }

      expect(result.provenance.rule).toBe('AI_LED_CURRICULUM_SYNTHESIS_V3');
      expect(result.provenance.sourceAuthority).toBe('programFitReasoning_v2_neutral_profiles');
    });

    test('Double degree partner majors remain uninvented without official evidence', () => {
      const query = 'Saya ingin kuliah internasional bisnis digital';
      const result = evaluateRecommendation(query);

      for (const cand of result.scoredCandidates) {
        if (cand.programKey === 'dnui') {
          expect(cand.grounding).toContain('belum tercantum');
        }
        if (cand.programKey === 'help') {
          expect(cand.grounding).toContain('belum tercantum');
        }
      }
    });
  });

  describe('4. Architecture & Lifecycle Integration (Phase 2 Planner & Bridge)', () => {
    test('phase2Planner detects recommendation queries as PLAN_TYPE.RECOMMENDATION', () => {
      const q1 = 'Saya suka menggambar dan desain poster, cocok jurusan apa?';
      const planRes1 = buildExecutionPlan(q1, {});
      expect(planRes1.success).toBe(true);
      expect(planRes1.plan.planType).toBe('RECOMMENDATION');
      expect(planRes1.plan.tasks[0].type).toBe('RECOMMENDATION_TASK');

      const q2 = 'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?';
      const planRes2 = buildExecutionPlan(q2, {});
      expect(planRes2.success).toBe(true);
      expect(planRes2.plan.planType).toBe('RECOMMENDATION');
    });

    test('phase2Bridge packages recommendation result and context delta without owning final answer lifecycle', async () => {
      const chatId = `rec_test_${Date.now()}`;
      const query = 'Saya suka coding software dan bikin aplikasi';

      const mockPhase1 = jest.fn(async () => ({
        chatId,
        rawQuery: query,
        subQueryResults: [],
        finalAnswer: 'Fallback answer'
      }));

      const bridgeResult = await executePhase2Bridge(chatId, query, {}, mockPhase1);

      expect(bridgeResult).toBeDefined();
      expect(bridgeResult.phase2Meta.handledBy).toBe('phase2_recommendation_engine');
      expect(bridgeResult.phase2Meta.planType).toBe('RECOMMENDATION');
      expect(bridgeResult.finalAnswer).toBeUndefined();
      expect(bridgeResult.structuredRecommendation).toBeDefined();
      expect(bridgeResult.structuredRecommendation.presentationType).toBe('NEUTRAL_CURRICULUM_OVERVIEW');
      expect(bridgeResult.subQueryResults[0].answerability).toBe('ANSWERABLE');

      expect(mockPhase1).not.toHaveBeenCalled();
    });

    test('orchestrator processTurn executes end-to-end recommendation lifecycle without locking a heuristic single winner in session', async () => {
      const originalEnv = process.env.ENABLE_PHASE2_REASONING;
      process.env.ENABLE_PHASE2_REASONING = 'true';

      try {
        const chatId = `rec_e2e_${Date.now()}`;
        const query = 'Saya suka coding software dan bikin aplikasi';

        const turnResult = await processTurn(chatId, query, { executeDispatch: false });

        expect(turnResult).toBeDefined();
        expect(turnResult.structuredRecommendation).toBeDefined();
        expect(turnResult.structuredRecommendation.presentationType).toBe('NEUTRAL_CURRICULUM_OVERVIEW');

        expect(turnResult.finalAnswer).toMatch(/Teknologi Informasi/i);
        expect(turnResult.finalAnswer).toMatch(/admisi PMB/i);

        const session = await getSession(chatId);
        expect(session).toBeDefined();
        expect(session.data.activeDomain).toBe('academic_recommendation');
        expect(session.data.activeEntity).toBeNull();
        expect(Array.isArray(session.data.recommendationRelations)).toBe(true);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ENABLE_PHASE2_REASONING;
        } else {
          process.env.ENABLE_PHASE2_REASONING = originalEnv;
        }
      }
    });

    test('orchestrator processTurn executes multi-program neutral overview and broad guidance cleanly', async () => {
      const originalEnv = process.env.ENABLE_PHASE2_REASONING;
      process.env.ENABLE_PHASE2_REASONING = 'true';

      try {
        // 1. Neutral Overview
        const chatIdDual = `rec_dual_${Date.now()}`;
        const queryDual = 'Saya tertarik UI/UX dan desain produk digital';
        const resultDual = await processTurn(chatIdDual, queryDual, { executeDispatch: false });

        expect(resultDual.structuredRecommendation.presentationType).toBe('NEUTRAL_CURRICULUM_OVERVIEW');
        expect(resultDual.finalAnswer).toMatch(/Bisnis Digital.*Teknologi Informasi|Teknologi Informasi.*Bisnis Digital/s);
        expect(resultDual.finalAnswer).toMatch(/admisi PMB/i);

        // 2. Broad Guidance
        const chatIdBroad = `rec_broad_${Date.now()}`;
        const queryBroad = 'Saya siswa SMK bidang komputer tapi masih bingung pilih prodi';
        const resultBroad = await processTurn(chatIdBroad, queryBroad, { executeDispatch: false });

        expect(resultBroad.structuredRecommendation.presentationType).toBe('BROAD_GUIDANCE');
        expect(resultBroad.finalAnswer).toMatch(/Teknologi Informasi.*Sistem Informasi.*Sistem Komputer/s);
        expect(resultBroad.finalAnswer).toMatch(/admisi PMB/i);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ENABLE_PHASE2_REASONING;
        } else {
          process.env.ENABLE_PHASE2_REASONING = originalEnv;
        }
      }
    });
  });
});
