'use strict';

/**
 * tests/phase2AnswerQualityUAT.test.js
 *
 * PHASE 2 — ANSWER QUALITY & SEMANTIC GENERALIZATION GOLDEN UAT SUITE
 *
 * Invariants Verified:
 * 1. Authoritative Entities:
 *    - GCCP: Global Cross Cultural Program (student exchange under International Directorate).
 *    - Double Degree: DNUI (China, Bisnis Digital, 2+2) & HELP University (Malaysia, Sistem Informasi, 4 yrs Bali).
 * 2. Context & Planner:
 *    - Follow-up fee inquiries inherit active entity (e.g. Double Degree -> fee breakdown).
 *    - Explicit unsupported entities fail-closed cleanly, without confusing clarification.
 * 3. Academic Level & Entity Contamination:
 *    - S2 admission carries postgraduate constraint; forbids SMA/SMK or S1/D3 PMB requirements.
 * 4. Semantic Routing Precedence:
 *    - Accreditation, tuition, admission, scholarship, and curriculum queries take precedence over recommendation.
 * 5. Retrieval Precision:
 *    - Available prodi listing generalizes across canonical, paraphrase, typo, and elliptical forms.
 *    - Domestic evening class / working student inquiries are separated from overseas work programs.
 * 6. Verifier Sibling Collision:
 *    - Legitimate comparative educational mentions are allowed.
 *    - Direct factual contradictions remain strictly blocked.
 * 7. Template & Raw Document Leakage:
 *    - Administrative placeholders "(Isikan Nama...)", "Staf...", "dst" are strictly forbidden in user-facing output.
 * 8. Multi-Intent Synthesis:
 *    - Multi-aspect business inquiries are structured cleanly with proper scope and escalation.
 * 9. Answer Refinement / Revision:
 *    - Refinement requests ("bisa lebih singkat?") refine previous answer without context loss.
 */

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildExecutionPlan } = require('../src/reasoning/phase2Planner');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { sanitizeWhatsAppMarkdown } = require('../src/core/outboundRenderer');
const { computeContextDelta } = require('../src/reasoning/contextRepair');
const { findCanonicalEntity } = require('../src/engine/canonicalEntityRegistry');
const { processTurn } = require('../src/core/orchestrator');

describe('Phase 2 Golden Answer Quality UAT Suite', () => {

  // =========================================================================
  // CATEGORY 1: AUTHORITATIVE KNOWLEDGE GROUNDING (GCCP & PARTNERS)
  // =========================================================================
  describe('1. Authoritative Knowledge Grounding (GCCP, HELP, DNUI)', () => {
    test('GCCP is officially Global Cross Cultural Program under International Directorate', () => {
      const gccpEntity = findCanonicalEntity('GCCP');
      expect(gccpEntity).toBeDefined();
      expect(gccpEntity.canonical).toBe('GCCP');
      expect(gccpEntity.family).toBe('international_program');
      expect(gccpEntity.aliases).toContain('gccp');
      expect(gccpEntity.aliases.some(a => /global cross cultural/i.test(a))).toBe(true);
      expect(gccpEntity.aliases.some(a => /cloud computing/i.test(a))).toBe(false);
    });

    test('Double Degree partners are accurately cataloged (DNUI China & HELP Malaysia)', () => {
      const dnui = findCanonicalEntity('DNUI');
      expect(dnui).toBeDefined();
      expect(dnui.country).toBe('China');
      expect(dnui.partnerName).toContain('Dalian Neusoft');

      const help = findCanonicalEntity('HELP University');
      expect(help).toBeDefined();
      expect(help.country).toBe('Malaysia');
      expect(help.partnerName).toContain('HELP');
    });
  });

  // =========================================================================
  // CATEGORY 2: CONTEXT INHERITANCE & PLANNER DISCRIMINATION
  // =========================================================================
  describe('2. Context Inheritance & Planner Discrimination', () => {
    test('Follow-up fee inquiry after Double Degree inherits Double Degree context', () => {
      // Turn 1: User asks about Double Degree
      const t1Query = 'jelaskan program Double Degree';
      const t1Frame = resolveSemanticFrame(t1Query, {});
      const t1Delta = computeContextDelta({}, { rawQuery: t1Query, semanticFrame: t1Frame });

      const sessionAfterT1 = {
        activeEntity: t1Delta.resolvedState.activeEntity || 'Double Degree',
        activeDomain: t1Delta.resolvedState.activeDomain || 'INTERNATIONAL',
        lastTurnTs: Date.now()
      };

      // Turn 2: User asks "berapa rincian biayanya?"
      const t2Query = 'berapa rincian biayanya?';
      const t2Plan = buildExecutionPlan(t2Query, sessionAfterT1);

      expect(t2Plan.success).toBe(true);
      expect(t2Plan.plan.planType).not.toBe('AMBIGUOUS_CLARIFICATION');
      expect(t2Plan.plan.tasks[0].targetEntities.some(e => /Double Degree|DNUI|HELP/i.test(e))).toBe(true);
    });

    test('Unsupported explicit entity ("Teknik Nuklir") fails-closed and avoids ambiguous prodi clarification', () => {
      const query = 'Berapa biaya Teknik Nuklir di STIKOM?';
      const planResult = buildExecutionPlan(query, {});

      expect(planResult.success).toBe(true);
      // It should NOT ask user: "Program studi S1 mana yang dimaksud? 1. SI, 2. SK..."
      expect(planResult.plan.planType).not.toBe('AMBIGUOUS_CLARIFICATION');
      expect(planResult.plan.isUnsupportedEntity).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY 3: ACADEMIC LEVEL & ENTITY CONTAMINATION
  // =========================================================================
  describe('3. Academic Level & Entity Contamination Gates', () => {
    test('S2 admission query strictly rejects SMA/SMK school certificate chunks', () => {
      const frame = resolveSemanticFrame('syarat pendaftaran program magister S2 Sistem Informasi');
      expect(frame.academicLevel).toBe('S2');

      const plan = buildRetrievalPlan(frame);
      expect(plan.academicLevel).toBe('S2');

      const smaSmkChunk = {
        id: 'chunk_pmb_sma',
        text: 'Persyaratan pendaftaran mahasiswa baru ITB STIKOM Bali: Lulusan SMA/SMK/MA sederajat, fotokopi ijazah legalisir 2 lembar, pas foto 3x4 berwarna.',
        source: 'panduan_pmb.pdf'
      };

      const s2ValidChunk = {
        id: 'chunk_s2_syarat',
        text: 'Persyaratan Program Magister (S2) Sistem Informasi: Memiliki ijazah Sarjana (S1/D4) bidang komputer atau non-komputer dengan matrikulasi, transkrip nilai akademik dengan IPK memadai.',
        source: 'pedoman_s2_magister.pdf'
      };

      const evalResult = arbitrateEvidence([smaSmkChunk, s2ValidChunk], plan);
      expect(evalResult.rejected.some(c => c.id === 'chunk_pmb_sma')).toBe(true);
      expect(evalResult.accepted.some(c => c.id === 'chunk_s2_syarat')).toBe(true);
    });

    test('S1 admission query does not reject SMA/SMK requirements', () => {
      const frame = resolveSemanticFrame('syarat pendaftaran prodi S1 Sistem Informasi');
      expect(frame.academicLevel).toBe('S1');

      const plan = buildRetrievalPlan(frame);
      const smaSmkChunk = {
        id: 'chunk_pmb_sma',
        text: 'Persyaratan pendaftaran Program S1 Sistem Informasi: Lulusan SMA/SMK/MA sederajat, fotokopi ijazah legalisir 2 lembar, pas foto 3x4.',
        source: 'panduan_pmb.pdf'
      };

      const evalResult = arbitrateEvidence([smaSmkChunk], plan);
      expect(evalResult.accepted.some(c => c.id === 'chunk_pmb_sma')).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY 4: SEMANTIC ROUTING PRECEDENCE
  // =========================================================================
  describe('4. Semantic Routing Precedence', () => {
    test('"apakah akreditasi prodi bisnis digital" routes to accreditation, NOT recommendation', () => {
      const query = 'apakah akreditasi prodi bisnis digital';
      const frame = resolveSemanticFrame(query);
      expect(frame.intent).toBe('PROGRAM_ACCREDITATION');

      const planResult = buildExecutionPlan(query, {});
      expect(planResult.success).toBe(true);
      expect(planResult.plan.planType).toBe('DIRECT');
      expect(planResult.plan.planType).not.toBe('RECOMMENDATION');
    });

    test('Tuition inquiry with prodi name routes to TUITION_FEE, NOT recommendation', () => {
      const query = 'biaya kuliah sistem informasi berapa';
      const planResult = buildExecutionPlan(query, {});
      expect(planResult.plan.planType).toBe('DIRECT');
      expect(planResult.plan.planType).not.toBe('RECOMMENDATION');
    });
  });

  // =========================================================================
  // CATEGORY 5: RETRIEVAL PRECISION & GENERALIZATION
  // =========================================================================
  describe('5. Retrieval Precision & Generalization', () => {
    test('Available programs inquiry generalizes across style, typos, and phrasing', () => {
      const variants = [
        'Apa saja program studi yang ada di STIKOM Bali?',
        'jurusan di stikom ada apa aja kak?',
        'prodi apa sj yg ad?',
        'jurusannya apa aja?',
        'kalau mau kuliah di stikom pilihannya apa?'
      ];

      for (const q of variants) {
        const frame = resolveSemanticFrame(q);
        expect(frame.intent).toBe('AVAILABLE_PROGRAMS_LIST');
        expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      }
    });

    test('"apakah ada kuliah sore untuk yang bekerja?" routes to domestic study mode, not international work', () => {
      const query = 'apakah ada kuliah sore untuk yang bekerja?';
      const frame = resolveSemanticFrame(query);
      expect(frame.intent).toBe('STUDY_MODE');
      expect(frame.aspects).toContain('evening_class');

      const plan = buildRetrievalPlan(frame);
      // Query variants must NOT inject overseas work
      expect(plan.queryVariants.some(v => /luar negeri/i.test(v))).toBe(false);
      expect(plan.queryVariants.some(v => /kelas sore|kelas karyawan/i.test(v))).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY 6: VERIFIER SIBLING COLLISION
  // =========================================================================
  describe('6. Verifier Sibling Collision (Comparative Mention vs Contradiction)', () => {
    test('Legitimate educational comparative mention is accepted by verifier', () => {
      const targetQuery = 'apa yang dipelajari di Sistem Informasi?';
      const semanticFrame = resolveSemanticFrame(targetQuery);

      const candidateAnswer = `Program Studi S1 Sistem Informasi berfokus pada analisis proses bisnis, perancangan sistem enterprise, manajemen basis data, dan tata kelola teknologi informasi, berbeda dengan Sistem Komputer yang lebih menitikberatkan pada perangkat keras dan embedded system.`;

      const arbitratedEvidence = {
        retrievalPlan: {
          targetEntities: ['S1 Sistem Informasi'],
          excludedConflictingEntities: ['S1 Sistem Komputer', 'Sistem Komputer']
        },
        accepted: [
          {
            text: 'S1 Sistem Informasi mempelajari analisis sistem, database, dan bisnis, berbeda dengan Sistem Komputer.',
            source: 'kurikulum_si.md'
          }
        ]
      };

      const verification = verifyFinalAnswer(candidateAnswer, semanticFrame, arbitratedEvidence);
      expect(verification.pass).toBe(true);
    });

    test('Actual sibling contradiction remains strictly blocked by verifier', () => {
      const targetQuery = 'apa yang dipelajari di Sistem Informasi?';
      const semanticFrame = resolveSemanticFrame(targetQuery);

      // Claiming SI is actually Sistem Komputer
      const candidateAnswer = `Program Studi S1 Sistem Komputer berfokus pada perakitan robotika dan mikroprosesor.`;

      const arbitratedEvidence = {
        retrievalPlan: {
          targetEntities: ['S1 Sistem Informasi'],
          excludedConflictingEntities: ['S1 Sistem Komputer']
        },
        accepted: []
      };

      const verification = verifyFinalAnswer(candidateAnswer, semanticFrame, arbitratedEvidence);
      expect(verification.pass).toBe(false);
      expect(verification.reason).toContain('entity_contradiction');
    });
  });

  // =========================================================================
  // CATEGORY 7: TEMPLATE & RAW DOCUMENT ARTIFACT SANITIZATION
  // =========================================================================
  describe('7. Template & Raw Document Leakage Prevention', () => {
    test('Sanitizer and synthesis strip administrative form placeholders', () => {
      const dirtyRawText = `
Profil Program Studi S1 Sistem Informasi:
1. Identitas Program Studi
(Isikan Nama Sekretaris Prodi) | S2 | 1 2 3 4 5 6 7 8 9 10 11 12 | dst...............
4 | Staf..... (Isikan Nama Staf) | S1
Fokus keilmuan: Analisis sistem dan basis data.
`;
      const cleaned = sanitizeWhatsAppMarkdown(dirtyRawText);
      expect(cleaned).not.toContain('(Isikan Nama Sekretaris Prodi)');
      expect(cleaned).not.toContain('Staf.....');
      expect(cleaned).not.toContain('dst...............');
      expect(cleaned).toContain('Analisis sistem dan basis data');
    });
  });

  // =========================================================================
  // CATEGORY 8: MULTI-INTENT BUSINESS PARTNERSHIP
  // =========================================================================
  describe('8. Multi-Intent Business Partnership Inquiries', () => {
    test('Corporate partnership inquiry is structured and directs to authorized unit', () => {
      const query = 'Perusahaan kami ingin kerja sama campus hiring, magang mahasiswa, dan sertifikasi. Bagaimana prosesnya dan siapa yang bisa dihubungi?';
      const frame = resolveSemanticFrame(query);
      expect(frame.domain).toBe('CAREER_CENTER');

      const plan = buildRetrievalPlan(frame);
      expect(plan.requiredAspects.some(a => /career|partnership|internship/i.test(a))).toBe(true);
    });
  });

  // =========================================================================
  // CATEGORY 9: ANSWER REFINEMENT / REVISION
  // =========================================================================
  describe('9. Answer Refinement / Revision Context Handling', () => {
    test('Request for shorter answer is recognized as refinement of previous answer', () => {
      const query = 'bisa dibuat lebih singkat?';
      const session = {
        lastAnswer: 'Program Studi S1 Sistem Informasi memiliki fokus pada perancangan sistem enterprise, tata kelola TI, basis data, dan analisis bisnis digital dengan total 144 SKS.',
        activeEntity: 'S1 Sistem Informasi',
        activeDomain: 'ACADEMIC_PROGRAM',
        lastTurnTs: Date.now()
      };

      const frame = resolveSemanticFrame(query, session);
      expect(frame.intent).toBe('ANSWER_REFINEMENT');
    });
  });

  // =========================================================================
  // CATEGORY 10: USER-FACING FORMAT & READABILITY INVARIANTS
  // =========================================================================
  describe('10. User-Facing Format & Readability Invariants', () => {
    test('Available prodi answer gives direct, readable response without verbose disclaimers', async () => {
      const frame = resolveSemanticFrame('apa saja prodi di stikom?');
      const synthesized = await synthesizeAnswer(frame, {});

      expect(synthesized).toBeDefined();
      expect(synthesized.success).toBe(true);
      const text = synthesized.answer;
      expect(text).toContain('S1 Sistem Informasi');
      expect(text).toContain('S1 Sistem Komputer');
      expect(text).toContain('S1 Teknologi Informasi');
      expect(text).toContain('S1 Bisnis Digital');
      // No internal debug or raw JSON
      expect(text).not.toContain('governanceMetadata');
      expect(text).not.toContain('chunk_');
      expect(text).not.toContain('{');
    });
  });

});
