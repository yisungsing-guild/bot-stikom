'use strict';

/**
 * tests/greenfieldCore.test.js
 * 
 * Unit & Integration Test Suite for Greenfield Rewrite Architecture (src/core/)
 * Tests:
 * 1. SemanticFrameResolver (Domain, Intent, Entities, Temporal, UserState)
 * 2. ContextResolver (Turn Authority: Turn 1 PMB -> Turn 2 Kuliah sore independent)
 * 3. MultiIntentResolver (Decomposition of "GCCP dan keuntungannya")
 * 4. EvidenceArbiter & RetrievalPlanner (Entity Lock: DNUI rejects HELP University)
 * 5. AnswerabilityGate & Grounded Generator
 * 6. FinalAnswerVerifier (Zero raw leak, entity contradiction block)
 * 7. Outbound Renderer & Dispatcher
 */

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { decomposeQuery } = require('../src/core/multiIntentResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { sanitizeWhatsAppMarkdown, splitLongMessage } = require('../src/core/outboundRenderer');
const { processTurn } = require('../src/core/orchestrator');

describe('Greenfield Rewrite Core Architecture', () => {

  describe('1. Semantic Frame Resolver', () => {
    test('Case A: "pendaftaran S1 masih dibuka?" -> PMB / CURRENT_ENROLLMENT_STATUS / S1 / NOW', () => {
      const frame = resolveSemanticFrame('pendaftaran S1 masih dibuka?');
      expect(frame.domain).toBe('PMB');
      expect(frame.intent).toBe('CURRENT_ENROLLMENT_STATUS');
      expect(frame.temporal.constraint).toBe('NOW');
      expect(frame.entities.some(e => e.canonical.includes('S1'))).toBe(true);
    });

    test('Case B: "kuliah sore untuk yang bekerja?" -> ACADEMIC_PROGRAM / STUDY_MODE / WORKING_STUDENTS', () => {
      const frame = resolveSemanticFrame('kuliah sore untuk yang bekerja?');
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('STUDY_MODE');
      expect(frame.aspects).toContain('working_students');
    });

    test('Case C: "saya terlambat perwalian" -> ACADEMIC / MISSED_ACADEMIC_PROCESS / LATE / NEXT_STEP', () => {
      const frame = resolveSemanticFrame('saya terlambat perwalian');
      expect(frame.domain).toBe('ACADEMIC');
      expect(frame.intent).toBe('MISSED_ACADEMIC_PROCESS');
      expect(frame.userState).toBe('LATE');
      expect(frame.desiredAction).toBe('NEXT_STEP_PROCEDURE');
    });

    test('Case D: "Double Degree DNUI full di STIKOM?" -> INTERNATIONAL / STUDY_LOCATION / DNUI', () => {
      const frame = resolveSemanticFrame('Double Degree DNUI full di STIKOM?');
      expect(frame.domain).toBe('INTERNATIONAL');
      expect(frame.intent).toBe('STUDY_LOCATION');
      expect(frame.entities.some(e => e.canonical.includes('DNUI'))).toBe(true);
      expect(frame.aspects).toContain('study_location');
    });
  });

  describe('2. Context Isolation (Turn Authority)', () => {
    test('Turn 1 PMB followed by Turn 2 "kuliah sore untuk yang bekerja" MUST BE INDEPENDENT', () => {
      const sessionData = {
        activeDomain: 'PMB',
        activeEntity: 'PMB Schedule',
        lastQuery: 'jadwal PMB kapan?'
      };

      const dep = evaluateContextDependency('apakah ada kuliah sore untuk yang bekerja?', sessionData);
      expect(dep.shouldInherit).toBe(false);
      expect(dep.reason).toBe('independent_current_turn');

      const frame = resolveSemanticFrame('apakah ada kuliah sore untuk yang bekerja?', sessionData);
      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.domain).not.toBe('PMB');
    });

    test('Genuine ellipsis inherits context properly', () => {
      const sessionData = {
        activeDomain: 'INTERNATIONAL',
        activeEntity: 'Dual Degree',
        lastQuery: 'informasi dual degree'
      };

      const dep = evaluateContextDependency('Bagaimana dengan DNUI?', sessionData);
      expect(dep.shouldInherit).toBe(true);
      expect(dep.reason).toBe('genuine_ellipsis');
    });
  });

  describe('3. Multi-Intent Decomposition', () => {
    test('"apa itu GCCP dan apa keuntungannya?" decomposes into 2 subqueries preserving entity', () => {
      const subFrames = decomposeQuery('apa itu GCCP dan apa keuntungannya?');
      expect(subFrames.length).toBe(2);

      // Subquery 1: Definition
      expect(subFrames[0].domain).toBe('INTERNATIONAL');
      expect(subFrames[0].intent).toBe('DEFINITION');
      expect(subFrames[0].entities.some(e => e.canonical.includes('GCCP'))).toBe(true);

      // Subquery 2: Benefit
      expect(subFrames[1].domain).toBe('INTERNATIONAL');
      expect(subFrames[1].intent).toBe('PROGRAM_BENEFIT');
      expect(subFrames[1].entities.some(e => e.canonical.includes('GCCP'))).toBe(true);
    });
  });

  describe('4. Retrieval Plan & Evidence Arbitration (Entity Lock)', () => {
    test('DNUI query strictly excludes and rejects HELP University evidence', () => {
      const frame = resolveSemanticFrame('Double Degree DNUI full di STIKOM?');
      const plan = buildRetrievalPlan(frame);

      expect(plan.targetEntities.some(e => e.includes('DNUI'))).toBe(true);
      expect(plan.excludedConflictingEntities.some(e => e.toLowerCase().includes('help'))).toBe(true);

      const mockCandidates = [
        {
          id: 'c1',
          text: 'Program Double Degree DNUI di Dalian Neusoft University of Information ditempuh 2 tahun di Bali dan 2 tahun di China.',
          source: 'kerjasama_dnui.pdf'
        },
        {
          id: 'c2',
          text: 'Program Dual Degree dengan HELP University Malaysia menawarkan gelar Bachelor of IT.',
          source: 'kerjasama_help.pdf'
        }
      ];

      const arbitrated = arbitrateEvidence(mockCandidates, plan);
      expect(arbitrated.accepted.length).toBe(1);
      expect(arbitrated.accepted[0].text).toContain('DNUI');

      expect(arbitrated.rejected.length).toBe(1);
      expect(arbitrated.rejected[0].dispositionReason).toMatch(/contains_conflicting_entity/i);
    });
  });

  describe('5. Answerability & Grounding Gate', () => {
    test('Zero accepted evidence on late process returns ESCALATE status with guidance', () => {
      const frame = resolveSemanticFrame('saya terlambat perwalian');
      const answerability = evaluateAnswerability(frame, { accepted: [] });

      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ESCALATE);
      expect(answerability.guidance).toContain('Akademik');
    });
  });

  describe('6. Final Verifier Universal (Zero Raw Leak & No Contradiction)', () => {
    test('Blocks answers containing internal raw database tags', () => {
      const frame = resolveSemanticFrame('apa itu S1 Sistem Informasi?');
      const rawLeakAnswer = 'S1 SI adalah program studi. GǪchunk_123_dataGǪ select * from training_data';

      const result = verifyFinalAnswer(rawLeakAnswer, frame, { accepted: [] });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe('raw_document_metadata_leak_detected');
    });

    test('Blocks answers claiming HELP University when query asked about DNUI', () => {
      const frame = resolveSemanticFrame('Double Degree DNUI di mana kuliahnya?');
      const plan = buildRetrievalPlan(frame);
      const contradictoryAnswer = 'Mahasiswa akan belajar di HELP University Malaysia selama 3 tahun.';

      const result = verifyFinalAnswer(contradictoryAnswer, frame, { accepted: [], retrievalPlan: plan });
      expect(result.pass).toBe(false);
      expect(result.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer/i);
    });
  });

  describe('7. Outbound Renderer', () => {
    test('Sanitizes Markdown to WhatsApp formatting without data corruption', () => {
      const input = '### Informasi Biaya\n\nTotal biaya adalah **Rp 5000000** per semester.';
      const rendered = sanitizeWhatsAppMarkdown(input);

      expect(rendered).toContain('*Informasi Biaya*');
      expect(rendered).toContain('*Rp 5000000*');
      expect(rendered).not.toContain('###');
    });

    test('Splits long message cleanly at paragraph boundary', () => {
      const longText = 'A'.repeat(2000) + '\n\n' + 'B'.repeat(2000);
      const parts = splitLongMessage(longText, 2500);

      expect(parts.length).toBe(2);
      expect(parts[0].length).toBeLessThanOrEqual(2500);
      expect(parts[1].length).toBeLessThanOrEqual(2500);
    });
  });

  describe('8. Orchestrator End-to-End Simulation', () => {
    test('End-to-end turn execution with greenfield single decision maker', async () => {
      const result = await processTurn('628123456789', 'kuliah sore untuk yang bekerja?');
      expect(result).toBeDefined();
      expect(result.chatId).toBe('628123456789');
      expect(result.subQueryResults.length).toBe(1);
      expect(result.finalAnswer).toBeDefined();
      expect(typeof result.finalAnswer).toBe('string');
    }, 25000);
  });
});
