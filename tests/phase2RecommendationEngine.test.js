'use strict';

/**
 * tests/phase2RecommendationEngine.test.js
 *
 * Phase 2 Step 7 Test Suite: Deterministic Recommendation Engine & Scoring Contract.
 *
 * Tests:
 * 1. Presentation Type Boundary Conditions (Authorized Delta 3 Contract):
 *    A. rawGap = 2.01 -> DOMINANT_SINGLE
 *    B. rawGap = 2.00 -> DOMINANT_SINGLE (threshold exact boundary)
 *    C. rawGap = 1.99 -> BALANCED_DUAL
 *    D. rawScore tie -> canonical Unicode tie-break deterministic (Delta 1 Contract)
 *    E. broad profile -> BROAD_GUIDANCE
 *    F. single candidate -> DOMINANT_SINGLE
 * 2. Determinism & Idempotency:
 *    G. Repeated execution with identical input -> byte-identical structured result
 *    H. recommendationRelations deterministic structure
 *    K. Sanitizer fixed point: sanitizeWhatsAppMarkdown(renderedAnswer) === renderedAnswer
 * 3. Invariants & Grounding:
 *    I. Anti-absolute-claim invariant (forbids "pasti cocok", "pasti pilih")
 *    J. Official grounding provenance & validateProgramFeature adherence
 * 4. Architecture & Lifecycle Integration:
 *    - phase2Planner correctly selects PLAN_TYPE.RECOMMENDATION
 *    - phase2Bridge executes recommendation pipeline, passes universal verifier, and updates session context
 */

const {
  RAW_SCORE_DOMINANT_THRESHOLD,
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

describe('Phase 2 Step 7: Deterministic Recommendation Engine Suite', () => {

  describe('1. Presentation Type Boundary Conditions (Delta 3 Authorized Contract)', () => {
    test('Boundary A: rawGap = 2.01 produces DOMINANT_SINGLE', () => {
      const candidates = [
        { canonicalName: 'S1 Bisnis Digital', rawScore: 4.31 },
        { canonicalName: 'S1 Sistem Informasi', rawScore: 2.30 }
      ];
      // Gap is exactly 2.01
      expect(Number((candidates[0].rawScore - candidates[1].rawScore).toFixed(2))).toBe(2.01);
      const result = classifyPresentationType(false, candidates);
      expect(result).toBe('DOMINANT_SINGLE');
    });

    test('Boundary B: rawGap = 2.00 produces DOMINANT_SINGLE (exact threshold boundary)', () => {
      const candidates = [
        { canonicalName: 'S1 Bisnis Digital', rawScore: 4.30 },
        { canonicalName: 'S1 Sistem Informasi', rawScore: 2.30 }
      ];
      // Gap is exactly 2.00
      expect(Number((candidates[0].rawScore - candidates[1].rawScore).toFixed(2))).toBe(2.00);
      const result = classifyPresentationType(false, candidates);
      expect(result).toBe('DOMINANT_SINGLE');
    });

    test('Boundary C: rawGap = 1.99 produces BALANCED_DUAL', () => {
      const candidates = [
        { canonicalName: 'S1 Bisnis Digital', rawScore: 4.29 },
        { canonicalName: 'S1 Sistem Informasi', rawScore: 2.30 }
      ];
      // Gap is exactly 1.99
      expect(Number((candidates[0].rawScore - candidates[1].rawScore).toFixed(2))).toBe(1.99);
      const result = classifyPresentationType(false, candidates);
      expect(result).toBe('BALANCED_DUAL');
    });

    test('Boundary D: rawScore tie uses canonical Unicode tie-break (Delta 1 Contract)', () => {
      // Simulate rawScore tie: both candidates have 4.30
      // D3 Manajemen Informatika vs S1 Bisnis Digital
      const mockSignals = [
        {
          key: 'test_tie',
          label: 'test_tie_signal',
          candidates: [
            ['mi', 'primary', 'reason A'], // index 0: 4 + 0.3 = 4.3
            ['bd', 'primary', 'reason B']  // index 1: base 4 + offset... but we override rawScore directly
          ]
        }
      ];

      const candA = { canonicalName: 'S1 Sistem Komputer', rawScore: 4.0 };
      const candB = { canonicalName: 'S1 Bisnis Digital', rawScore: 4.0 };
      const list1 = [candA, candB];
      const list2 = [candB, candA];

      const sortFn = (a, b) => {
        if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
        return compareCodePoints(a.canonicalName, b.canonicalName);
      };

      const sorted1 = [...list1].sort(sortFn);
      const sorted2 = [...list2].sort(sortFn);

      // 'S1 Bisnis Digital' must strictly precede 'S1 Sistem Komputer' regardless of insertion order
      expect(sorted1[0].canonicalName).toBe('S1 Bisnis Digital');
      expect(sorted2[0].canonicalName).toBe('S1 Bisnis Digital');
      expect(sorted1).toEqual(sorted2);
    });

    test('Boundary E: broad profile without specific preference produces BROAD_GUIDANCE', () => {
      const broadCandidates = [
        { canonicalName: 'S1 Teknologi Informasi', rawScore: 2.0 },
        { canonicalName: 'S1 Sistem Informasi', rawScore: 2.0 }
      ];
      const result = classifyPresentationType(true, broadCandidates);
      expect(result).toBe('BROAD_GUIDANCE');

      // Also when candidates are empty
      expect(classifyPresentationType(false, [])).toBe('BROAD_GUIDANCE');
    });

    test('Boundary F: single candidate produces DOMINANT_SINGLE', () => {
      const singleCandidate = [
        { canonicalName: 'S1 Bisnis Digital', rawScore: 4.3 }
      ];
      const result = classifyPresentationType(false, singleCandidate);
      expect(result).toBe('DOMINANT_SINGLE');
    });
  });

  describe('2. Determinism & Idempotency', () => {
    test('Requirement G: Repeated execution with identical input produces byte-identical structured result', () => {
      const query = 'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?';
      const res1 = evaluateRecommendation(query);
      const res2 = evaluateRecommendation(query);

      const json1 = JSON.stringify(res1);
      const json2 = JSON.stringify(res2);
      expect(json1).toBe(json2);
    });

    test('Requirement H: recommendationRelations deterministic structure and content', () => {
      const query = 'Saya suka coding aplikasi dan web';
      const result = evaluateRecommendation(query);

      expect(Array.isArray(result.contextRelations)).toBe(true);
      expect(result.contextRelations.length).toBeGreaterThan(0);
      const rel = result.contextRelations[0];
      expect(rel.source).toBe(result.scoredCandidates[0].canonicalName);
      expect(rel.relation).toBe('alternative');
      expect(rel.target).toBe(result.scoredCandidates[1].canonicalName);
      expect(typeof rel.reason).toBe('string');
      expect(rel.reason.length).toBeGreaterThan(0);
    });

    test('Requirement K: Sanitizer fixed point invariant on rendered recommendation answers', () => {
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
    test('Requirement I: Anti-absolute-claim invariant strictly upheld in all render modes', () => {
      const testQueries = [
        'Anak saya suka main medsos dan live TikTok, jurusan apa yang pas?',
        'Saya takut matematika tapi ingin kuliah IT',
        'Saya suka bikin game',
        'Saya introvert dan suka kerja sendiri'
      ];

      for (const q of testQueries) {
        const structured = evaluateRecommendation(q);
        const rendered = renderRecommendationAnswer(structured);

        // Must NOT contain absolute assertions forbidden by contracts
        expect(rendered).not.toMatch(/\bpasti\s+cocok\b/i);
        expect(rendered).not.toMatch(/\bpasti\s+pilih\b/i);

        // Must contain PMB/admisi consultation advisory
        expect(rendered).toMatch(/admisi\s+PMB|ketentuan\s+resmi/i);
      }
    });

    test('Requirement J: Official grounding provenance and validateProgramFeature adherence', () => {
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

      expect(result.provenance.rule).toBe('DETERMINISTIC_RECOMMENDATION_V2');
      expect(result.provenance.dominantThreshold).toBe(RAW_SCORE_DOMINANT_THRESHOLD);
      expect(result.provenance.sourceAuthority).toBe('programFitReasoning_v1');
    });

    test('Double degree partner majors remain uninvented without official evidence', () => {
      const query = 'Saya ingin kuliah internasional bisnis digital';
      const result = evaluateRecommendation(query);

      // Verify DNUI or HELP do not invent ungrounded partner majors
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

      // Mock Phase 1 pipeline runner as fallback
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
      // Bridge does NOT own final answer lifecycle or outbound rendering
      expect(bridgeResult.finalAnswer).toBeUndefined();
      expect(bridgeResult.structuredRecommendation).toBeDefined();
      expect(bridgeResult.structuredRecommendation.scoredCandidates[0].canonicalName).toBe('S1 Teknologi Informasi');
      expect(bridgeResult.structuredRecommendation.presentationType).toBe('DOMINANT_SINGLE');
      expect(bridgeResult.subQueryResults[0].answerability).toBe('ANSWERABLE');

      // Phase 1 fallback must NOT be called when Phase 2 succeeds
      expect(mockPhase1).not.toHaveBeenCalled();
    });

    test('orchestrator processTurn executes end-to-end recommendation lifecycle with synthesis, verifier, and context commit', async () => {
      const originalEnv = process.env.ENABLE_PHASE2_REASONING;
      process.env.ENABLE_PHASE2_REASONING = 'true';

      try {
        const chatId = `rec_e2e_${Date.now()}`;
        const query = 'Saya suka coding software dan bikin aplikasi';

        const turnResult = await processTurn(chatId, query, { executeDispatch: false });

        expect(turnResult).toBeDefined();
        expect(turnResult.structuredRecommendation).toBeDefined();
        expect(turnResult.structuredRecommendation.scoredCandidates[0].canonicalName).toBe('S1 Teknologi Informasi');
        expect(turnResult.structuredRecommendation.presentationType).toBe('DOMINANT_SINGLE');

        // Final answer synthesized by groundedAnswerGenerator and verified by universal verifier
        expect(turnResult.finalAnswer).toMatch(/Teknologi Informasi/i);
        expect(turnResult.finalAnswer).toMatch(/admisi PMB/i);

        // Context commit verified in session
        const session = await getSession(chatId);
        expect(session).toBeDefined();
        expect(session.data.activeDomain).toBe('academic_recommendation');
        expect(session.data.activeEntity).toBe('S1 Teknologi Informasi');
        expect(Array.isArray(session.data.recommendationRelations)).toBe(true);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ENABLE_PHASE2_REASONING;
        } else {
          process.env.ENABLE_PHASE2_REASONING = originalEnv;
        }
      }
    });

    test('orchestrator processTurn executes balanced dual and broad guidance recommendations cleanly', async () => {
      const originalEnv = process.env.ENABLE_PHASE2_REASONING;
      process.env.ENABLE_PHASE2_REASONING = 'true';

      try {
        // 1. Balanced Dual
        const chatIdDual = `rec_dual_${Date.now()}`;
        const queryDual = 'Saya tertarik UI/UX dan desain produk digital';
        const resultDual = await processTurn(chatIdDual, queryDual, { executeDispatch: false });

        expect(resultDual.structuredRecommendation.presentationType).toBe('BALANCED_DUAL');
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
