/**
 * tests/truthAuditFourDefects.test.js
 *
 * Targeted regression and negative control tests for the 4 INCORRECT cases
 * identified in Tiko_Batch_Test_Audit_Kebenaran.xlsx:
 *
 * 1. BATCH-019: Dual Degree fee context inheritance (prevents regular S1 clarification, grounds official DD fee)
 * 2. BATCH-029: D3 Manajemen Informatika admission requirements (verifier distinguishes institutional listing/metadata from true conflict)
 * 3. BATCH-064: S2 Sistem Informasi admission requirements (prerequisite S1/Sarjana degree not flagged as sibling conflict)
 * 4. BATCH-068: S2 Sistem Informasi total SKS (grounds official 36 SKS in 4 semesters, passes verifier)
 * 5. Negative Controls: True sibling contradictions must remain strictly blocked.
 */

'use strict';

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { evaluateContextDependency } = require('../src/core/contextResolver');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { PLAN_TYPE, VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');
const { buildGroundedDeterministicSummary } = require('../src/core/groundedAnswerGenerator');
const { generateFeeAnswer } = require('../src/core/feeCalculationEngine');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');

describe('Targeted Regression Tests: 4 Truth Audit Defect Fixes', () => {

  describe('1. BATCH-019 — Pewarisan Konteks Biaya Dual Degree', () => {
    test('1a: Multi-turn turn 2 fee inquiry inherits Double Degree context from turn 1', () => {
      const priorSession = {
        activeEntity: 'International Dual Degree',
        activeDomain: 'INTERNATIONAL',
        lastQuery: 'di STIKOM Bali ada program internasional apa saja',
        conversationState: {
          activeEntity: 'International Dual Degree',
          lastEntity: 'International Dual Degree'
        }
      };

      const followUpQuery = 'Berapa rincian biayanya ?';
      const contextDep = evaluateContextDependency(followUpQuery, priorSession);
      expect(contextDep.shouldInherit).toBe(true);

      const planResult = buildExecutionPlan(followUpQuery, priorSession);
      expect(planResult.success).toBe(true);
      // Must NOT be ambiguous clarification redirecting to 4 regular S1 options
      expect(planResult.plan.planType).not.toBe(PLAN_TYPE.AMBIGUOUS_CLARIFICATION);
      expect(planResult.plan.planType).toBe(PLAN_TYPE.DIRECT);

      // Verify the generated answer mentions Double Degree partners and fees, not regular S1 prodi options
      const semanticFrame = resolveSemanticFrame(followUpQuery, priorSession);
      const feeResult = generateFeeAnswer(followUpQuery, priorSession, { semanticFrame });
      expect(feeResult.success).toBe(true);
      const answer = feeResult.answer;

      expect(answer).toMatch(/Double\s*\/?\s*Dual\s*Degree/i);
      expect(answer).toMatch(/HELP\s+University/i);
      expect(answer).toMatch(/DNUI/i);
      expect(answer).not.toMatch(/1\.\s+S1\s+Sistem\s+Informasi\s*\n2\.\s+S1\s+Teknologi\s+Informasi/i);
    });

    test('1b: Parenthetical follow-up query extracts Double Degree entity and provides official fee breakdown', () => {
      const query = 'Berapa rincian biayanya ? (lanjutan dari pertanyaan tentang penjelasan program double degree)';
      const semanticFrame = resolveSemanticFrame(query, {});

      const hasDDEntity = (semanticFrame.entities || []).some(
        e => /double\s*degree|dual\s*degree/i.test(e.canonical || e.name || String(e))
      );
      expect(hasDDEntity).toBe(true);

      const planResult = buildExecutionPlan(query, {}, { semanticFrame });
      expect(planResult.success).toBe(true);
      expect(planResult.plan.planType).not.toBe(PLAN_TYPE.AMBIGUOUS_CLARIFICATION);

      const feeResult = generateFeeAnswer(query, {}, { semanticFrame });
      expect(feeResult.success).toBe(true);
      const answer = feeResult.answer;

      // Grounded in official fee numbers: DNUI (DPP 20jt, pendaftaran 3jt, Mandarin 5jt) & HELP (DPP 20jt, pendaftaran 3jt, Inggris 5jt)
      expect(answer).toMatch(/HELP\s+University/i);
      expect(answer).toMatch(/DNUI/i);
      expect(answer).toMatch(/20\.000\.000/);
      expect(answer).toMatch(/3\.000\.000/);
      expect(answer).not.toMatch(/Silakan sebutkan program studi pilihan Kakak/i);
    });
  });

  describe('2. BATCH-029 — Syarat Masuk D3 Manajemen Informatika', () => {
    test('2a: Query with "syarat untuk mendaftar" resolves to admission requirements for D3 MI', () => {
      const query = 'Apa saja syarat untuk mendaftar di D3 Manajemen Informatika?';
      const semanticFrame = resolveSemanticFrame(query, {});

      const answer = buildGroundedDeterministicSummary(
        semanticFrame,
        [{ text: 'Syarat Pendaftaran Mahasiswa Baru D3 Manajemen Informatika ITB STIKOM Bali' }],
        {}
      );
      expect(answer).toBeTruthy();

      // Must provide admission requirements
      expect(answer).toMatch(/persyaratan\s+umum|berkas\s+yang\s+diperlukan/i);
      expect(answer).toMatch(/ijazah|surat\s+keterangan\s+lulus/i);
      expect(answer).toMatch(/kartu\s+keluarga/i);
      expect(answer).toMatch(/pasfoto/i);

      // Verifier must accept the answer and not trigger conflicting sibling error
      const verif = verifyFinalAnswer(answer, {
        rawQuery: query,
        entities: [{ canonical: 'D3 Manajemen Informatika' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi',
              'S1 Bisnis Digital'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });

    test('2b: Institutional portal options in procedure do not trigger false contradiction for D3', () => {
      const query = 'Bagaimana alur pendaftaran D3 Manajemen Informatika?';
      const semanticFrame = resolveSemanticFrame(query, {});

      const answer = buildGroundedDeterministicSummary(
        semanticFrame,
        [{ text: 'Alur dan Prosedur Pendaftaran Online PMB ITB STIKOM Bali' }],
        {}
      );
      expect(answer).toBeTruthy();

      const verif = verifyFinalAnswer(answer, {
        rawQuery: query,
        entities: [{ canonical: 'D3 Manajemen Informatika' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi',
              'S1 Bisnis Digital'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });
  });

  describe('3. BATCH-064 — Syarat Masuk S2 Sistem Informasi', () => {
    test('3a: S2 admission requirements legitimately mention S1/Sarjana prerequisite degree without verifier conflict', () => {
      const query = 'Apa syarat masuk S2 Sistem Informasi ITB STIKOM Bali?';
      const semanticFrame = resolveSemanticFrame(query, {});

      const answer = buildGroundedDeterministicSummary(
        semanticFrame,
        [{ text: 'Syarat Pendaftaran Pascasarjana S2 Sistem Informasi ITB STIKOM Bali' }],
        {}
      );
      expect(answer).toBeTruthy();

      // Must provide postgraduate criteria from official Pascasarjana dataset
      expect(answer).toMatch(/ijazah\s+Sarjana\s*\(S1\s*\/\s*D4\)/i);
      expect(answer).toMatch(/matrikulasi/i);
      expect(answer).toMatch(/transkrip/i);
      expect(answer).not.toMatch(/Lulusan SMA\/SMK\/MA/i);

      // Verifier must NOT block S1 mention because it is a prerequisite degree for S2
      const verif = verifyFinalAnswer(answer, {
        rawQuery: query,
        entities: [{ canonical: 'S2 Sistem Informasi' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi',
              'S1 Bisnis Digital',
              'D3 Manajemen Informatika'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });

    test('3b: Text containing S1 background degree explicitly passes verifier for S2 target', () => {
      const s2AnswerWithS1Mention =
        'Untuk mendaftar di Program Pascasarjana S2 Magister Sistem Informasi ITB STIKOM Bali:\n' +
        '1. Calon pendaftar memiliki ijazah Sarjana (S1 Sistem Informasi, S1 Komputer, atau S1/D4 non-komputer dengan matrikulasi).\n' +
        '2. Melampirkan transkrip nilai akademik dan pasfoto terbaru.';

      const verif = verifyFinalAnswer(s2AnswerWithS1Mention, {
        rawQuery: 'Apa syarat masuk S2 Sistem Informasi?',
        entities: [{ canonical: 'S2 Sistem Informasi' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });
  });

  describe('4. BATCH-068 — Total SKS S2 Sistem Informasi', () => {
    test('4a: Query about total SKS for S2 Sistem Informasi returns 36 SKS in 4 semesters grounded in catalog', () => {
      const query = 'Berapa total SKS yang harus ditempuh mahasiswa S2 Sistem Informasi?';
      const semanticFrame = resolveSemanticFrame(query, {});

      const answer = buildGroundedDeterministicSummary(
        semanticFrame,
        [{ text: 'Kurikulum dan Beban Studi Program Magister S2 Sistem Informasi ITB STIKOM Bali' }],
        {}
      );
      expect(answer).toBeTruthy();

      // Must be official 36 SKS and 4 semesters (not 144 SKS / 8 semesters of S1!)
      expect(answer).toMatch(/36\s*SKS/i);
      expect(answer).toMatch(/4\s*semester/i);
      expect(answer).toMatch(/M\.Kom/i);
      expect(answer).not.toMatch(/144\s*SKS/i);
      expect(answer).not.toMatch(/8\s*semester/i);

      // Must NOT contain unverified course titles or unverified 12+12+6+6 SKS breakdown
      expect(answer).not.toMatch(/Metodologi Penelitian Lanjut/i);
      expect(answer).not.toMatch(/Arsitektur Enterprise/i);
      expect(answer).not.toMatch(/\b12\s*SKS\b/i);
      expect(answer).not.toMatch(/\b6\s*SKS\b/i);

      // Must include verified research focus areas
      expect(answer).toMatch(/Cyber Security/i);
      expect(answer).toMatch(/Data Science/i);

      // Verifier must accept this answer
      const verif = verifyFinalAnswer(answer, {
        rawQuery: query,
        entities: [{ canonical: 'S2 Sistem Informasi' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi',
              'S1 Bisnis Digital'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });

    test('4b: Query about courses in a specific semester for S2 responds honestly without fabricated course list', () => {
      const query = 'Semester 1 S2 Sistem Informasi ada mata kuliah apa saja?';
      const semanticFrame = resolveSemanticFrame(query, {});

      const answer = buildGroundedDeterministicSummary(
        semanticFrame,
        [{ text: 'Kurikulum dan Beban Studi Program Magister S2 Sistem Informasi ITB STIKOM Bali' }],
        {}
      );
      expect(answer).toBeTruthy();

      // Must state that specific course list per semester is not yet in public verified curriculum documents
      expect(answer).toMatch(/belum tercantum/i);
      expect(answer).toMatch(/Pascasarjana/i);
      expect(answer).toMatch(/36\s*SKS/i);
      expect(answer).toMatch(/4\s*semester/i);

      // Must NOT return fabricated course names
      expect(answer).not.toMatch(/Metodologi Penelitian Lanjut/i);
      expect(answer).not.toMatch(/Arsitektur Enterprise/i);

      // Verifier must accept this answer
      const verif = verifyFinalAnswer(answer, {
        rawQuery: query,
        entities: [{ canonical: 'S2 Sistem Informasi' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi',
              'S1 Bisnis Digital'
            ]
          }
        }
      });

      expect(verif.outcome).not.toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    });
  });

  describe('5. Negative Controls — True Contradictions Strictly Blocked', () => {
    test('5a: Direct subject assertion of S1 Sistem Informasi for S1 Teknologi Informasi query is BLOCKED', () => {
      const wrongAnswer =
        'Kurikulum 2025 untuk S1 Sistem Informasi ITB STIKOM Bali dirancang untuk 8 semester (total 144 SKS).\n' +
        'Program studi S1 Sistem Informasi adalah pilihan tepat untuk Kakak.';

      const verif = verifyFinalAnswer(wrongAnswer, {
        rawQuery: 'Bagaimana kurikulum S1 Teknologi Informasi?',
        entities: [{ canonical: 'S1 Teknologi Informasi' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Bisnis Digital'
            ]
          }
        }
      });

      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
      expect(verif.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer:\s*S1 Sistem Informasi/i);
    });

    test('5b: Conflicting tuition fee assertion for sibling prodi is BLOCKED', () => {
      const wrongFeeAnswer =
        'Biaya kuliah S1 Sistem Komputer memiliki DPP Rp 11.000.000.\n' +
        'S1 Sistem Komputer merupakan program studi hardware.';

      const verif = verifyFinalAnswer(wrongFeeAnswer, {
        rawQuery: 'Berapa biaya DPP untuk S1 Bisnis Digital?',
        entities: [{ canonical: 'S1 Bisnis Digital' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Komputer',
              'S1 Sistem Informasi',
              'S1 Teknologi Informasi'
            ]
          }
        }
      });

      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
      expect(verif.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer:\s*S1 Sistem Komputer/i);
    });

    test('5c: Claiming S1 curriculum for D3 query without comparative framing is BLOCKED', () => {
      const wrongD3Answer =
        'Program studi S1 Sistem Informasi berfokus pada analisis data dan sistem enterprise.';

      const verif = verifyFinalAnswer(wrongD3Answer, {
        rawQuery: 'Apa fokus program D3 Manajemen Informatika?',
        entities: [{ canonical: 'D3 Manajemen Informatika' }]
      }, {
        arbitratedEvidence: {
          retrievalPlan: {
            excludedConflictingEntities: [
              'S1 Sistem Informasi',
              'S1 Sistem Komputer',
              'S1 Teknologi Informasi'
            ]
          }
        }
      });

      expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
      expect(verif.reason).toMatch(/entity_contradiction_conflicting_sibling_in_answer:\s*S1 Sistem Informasi/i);
    });
  });

});
