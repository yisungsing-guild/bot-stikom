'use strict';

/**
 * tests/stage4RetrievalAndEvidenceReasoning.test.js
 *
 * STAGE 4 — GENERALIZED RETRIEVAL & EVIDENCE REASONING ENGINE TEST SUITE
 * Zero paid API calls. Tests compositional retrieval planning, cross-level & cross-entity
 * evidence arbitration, S1 vs S2 Sistem Informasi contextual disambiguation, inter-module
 * evidence contract, conflict & provenance detection, and aspect-driven answerability.
 */

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const {
  buildRetrievalPlan,
  buildInformationNeedPlans,
  normalizeAttributeForPlan,
  CONCEPT_RETRIEVAL_EXPANSIONS
} = require('../src/core/retrievalPlanner');
const {
  arbitrateEvidence,
  evaluateEvidenceCompatibility,
  buildEvidenceContractMetadata,
  detectSourceConflictsAndProvenance
} = require('../src/core/evidenceArbiter');
const {
  evaluateAnswerability,
  ANSWERABILITY_STATUS
} = require('../src/core/answerabilityGate');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { sanitizeWhatsAppMarkdown } = require('../src/core/outboundRenderer');
const { decomposeQuery } = require('../src/core/multiIntentResolver');
const { getCorpusIndex } = require('../src/engine/pgvectorShadowProvider');

describe('STAGE 4 — Generalized Retrieval & Evidence Reasoning Engine', () => {
  jest.setTimeout(30000);

  // =========================================================================
  // 1. Generalized Retrieval Planning from Stage 3 Semantic Representation
  // =========================================================================
  describe('1. Generalized Retrieval Planning & InformationNeeds Mapping', () => {
    test('1a. Maps unseen paraphrases to normalized attributes and compositional InformationNeed plans', () => {
      const unseenQueries = [
        {
          q: 'Berapa kisaran dana pendidikan yang perlu disiapkan kalau ambil S1 Sistem Komputer?',
          expectedEntity: 'S1 Sistem Komputer',
          expectedAttr: 'fee',
          expectedScopeMode: 'SINGLE_ENTITY_FOCUS'
        },
        {
          q: 'Program Magister Sistem Informasi S2 bernaung di bawah fakultas mana di STIKOM Bali?',
          expectedEntity: 'S2 Sistem Informasi',
          expectedAttr: 'faculty',
          expectedScopeMode: 'PRODI_FACULTY_MEMBERSHIP'
        },
        {
          q: 'Apa predikat akreditasi resmi untuk jurusan D3 Manajemen Informatika saat ini?',
          expectedEntity: 'D3 Manajemen Informatika',
          expectedAttr: 'accreditation',
          expectedScopeMode: 'SINGLE_ENTITY_FOCUS'
        }
      ];

      for (const item of unseenQueries) {
        const frame = resolveSemanticFrame(item.q);
        const plan = buildRetrievalPlan(frame);

        expect(plan.targetEntities).toContain(item.expectedEntity);
        expect(plan.requestedAttributes).toContain(item.expectedAttr);
        expect(plan.retrievalScopeMode).toBe(item.expectedScopeMode);
        expect(Array.isArray(plan.informationNeedPlans)).toBe(true);
        expect(plan.informationNeedPlans.length).toBeGreaterThan(0);

        const matchingNeedPlan = plan.informationNeedPlans.find(
          np => np.entity === item.expectedEntity && np.attribute === item.expectedAttr
        );
        expect(matchingNeedPlan).toBeDefined();
        expect(matchingNeedPlan.queryVariants.length).toBeGreaterThan(0);
      }
    });

    test('1b. Multi-attribute single-entity query generates retrieval plans for ALL requested attributes', () => {
      const frame = resolveSemanticFrame('Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?');
      const plan = buildRetrievalPlan(frame);

      expect(plan.targetEntities).toContain('S1 Sistem Informasi');
      expect(plan.requestedAttributes).toEqual(expect.arrayContaining(['fee', 'accreditation']));
      expect(plan.requiredAspects).toEqual(expect.arrayContaining(['fee', 'accreditation']));
      expect(plan.retrievalScopeMode).toBe('SINGLE_ENTITY_MULTI_ATTRIBUTE');

      // Query variants must cover both fee and accreditation for S1 Sistem Informasi
      const joinedVariants = plan.queryVariants.join(' | ').toLowerCase();
      expect(joinedVariants).toMatch(/biaya.*s1 sistem informasi/i);
      expect(joinedVariants).toMatch(/akreditasi.*s1 sistem informasi/i);
    });

    test('1c. Negated entities from Stage 3 are propagated into excludedConflictingEntities', () => {
      const frame = resolveSemanticFrame('Berapa rincian biaya kuliah S1 Teknologi Informasi, bukan S1 Bisnis Digital?');
      const plan = buildRetrievalPlan(frame);

      expect(plan.targetEntities).toContain('S1 Teknologi Informasi');
      expect(plan.targetEntities).not.toContain('S1 Bisnis Digital');
      expect(plan.excludedConflictingEntities).toContain('S1 Bisnis Digital');
    });

    test('1d. Retrieval Generalization: Unseen variations (fee synonyms, multi-program faculty, multi-attribute, similar entity names, cross-document, informal phrasing) actively use informationNeeds in RetrievalPlan', () => {
      const generalizationCases = [
        {
          category: 'Sinonim biaya',
          q: 'Kira-kira butuh dana kuliah berapa per semester kalau masuk S1 Bisnis Digital?',
          expectedEntities: ['S1 Bisnis Digital'],
          expectedAttrs: ['fee'],
          expectedNeedIds: ['S1 Bisnis Digital::fee']
        },
        {
          category: 'Fakultas dengan dokumen multi-program',
          q: 'Untuk prodi S1 Teknologi Informasi itu berada di bawah naungan fakultas apa ya?',
          expectedEntities: ['S1 Teknologi Informasi'],
          expectedAttrs: ['faculty'],
          expectedNeedIds: ['S1 Teknologi Informasi::faculty']
        },
        {
          category: 'Pertanyaan beberapa atribut',
          q: 'Berapa rincian biaya kuliah serta status akreditasi untuk S1 Sistem Komputer?',
          expectedEntities: ['S1 Sistem Komputer'],
          expectedAttrs: ['fee', 'accreditation'],
          expectedNeedIds: ['S1 Sistem Komputer::fee', 'S1 Sistem Komputer::accreditation']
        },
        {
          category: 'Entitas dengan nama mirip (S2 vs S1 Sistem Informasi)',
          q: 'Berapa beban studi SKS untuk jenjang Magister S2 Sistem Informasi?',
          expectedEntities: ['S2 Sistem Informasi'],
          expectedAttrs: ['sks'],
          expectedNeedIds: ['S2 Sistem Informasi::sks']
        },
        {
          category: 'Pertanyaan lintas dokumen (kurikulum + prospek karir)',
          q: 'Apa saja mata kuliah yang dipelajari dan peluang karir lulusan D3 Manajemen Informatika?',
          expectedEntities: ['D3 Manajemen Informatika'],
          expectedAttrs: ['curriculum', 'career_prospects'],
          expectedNeedIds: ['D3 Manajemen Informatika::curriculum', 'D3 Manajemen Informatika::career_prospects']
        },
        {
          category: 'Pertanyaan informal dan tidak langsung',
          q: 'Kak, kalau mau kuliah sambil kerja ambil kelas malam di S1 Sistem Informasi itu gimana sistem kuliahnya?',
          expectedEntities: ['S1 Sistem Informasi'],
          expectedAttrs: ['study_mode'],
          expectedNeedIds: ['S1 Sistem Informasi::study_mode']
        }
      ];

      for (const tc of generalizationCases) {
        const frame = resolveSemanticFrame(tc.q);
        const plan = buildRetrievalPlan(frame);

        expect(plan.targetEntities).toEqual(expect.arrayContaining(tc.expectedEntities));
        expect(plan.requestedAttributes).toEqual(expect.arrayContaining(tc.expectedAttrs));

        const planNeedIds = plan.informationNeedPlans.map(np => np.id);
        expect(planNeedIds).toEqual(expect.arrayContaining(tc.expectedNeedIds));

        // Prove that informationNeeds actively influence queryVariants (every needPlan variant is injected into plan.queryVariants)
        for (const needId of tc.expectedNeedIds) {
          const needObj = plan.informationNeedPlans.find(np => np.id === needId);
          expect(needObj).toBeDefined();
          expect(needObj.queryVariants.length).toBeGreaterThan(0);
          for (const qv of needObj.queryVariants) {
            expect(plan.queryVariants).toContain(qv);
          }
        }
      }
    });
  });

  // =========================================================================
  // 2. Cross-Level & Cross-Entity Evidence Arbitration
  // =========================================================================
  describe('2. Generalized Evidence Arbitration (Cross-Level ALL, S1 vs S2 SI, Sibling Isolation)', () => {
    test('2a. Preserves academicLevel="ALL" institutional faculty document across S1, D3, and S2 faculty inquiries', () => {
      const corpus = getCorpusIndex({}, { requireCanonical: true });
      const officialFacultyChunk = corpus.find(c => c.id === 'official-web-pasca-tentang-sejarah-fakultas');
      expect(officialFacultyChunk).toBeDefined();
      expect(officialFacultyChunk.academicLevel).toBe('ALL');

      const testPrograms = [
        'S1 Teknologi Informasi masuk fakultas apa?',
        'D3 Manajemen Informatika masuk fakultas apa?',
        'S1 Bisnis Digital masuk fakultas apa?',
        'S2 Magister Sistem Informasi masuk fakultas apa?'
      ];

      for (const q of testPrograms) {
        const frame = resolveSemanticFrame(q);
        const plan = buildRetrievalPlan(frame);
        const arbitrated = arbitrateEvidence([officialFacultyChunk], plan);

        expect(arbitrated.accepted.length).toBe(1);
        expect(arbitrated.accepted[0].id).toBe('official-web-pasca-tentang-sejarah-fakultas');
        expect(arbitrated.accepted[0].supportedAttributes).toContain('faculty');
      }
    });

    test('2b. Contextual disambiguation distinguishes S1 Sistem Informasi vs S2 Sistem Informasi', () => {
      const s2OnlyWithUndergradSiblingChunk = {
        id: 'chunk-s2-si-with-s1-bd',
        source_file: 'brosur_ringkasan.pdf',
        academicLevel: 'ALL',
        scope: 'PROGRAM_MULTI',
        text: 'ITB STIKOM Bali membuka pendaftaran untuk S1 Bisnis Digital dan Program S2 Magister Sistem Informasi dengan fokus kepemimpinan TI.'
      };

      const s1OnlyChunk = {
        id: 'chunk-s1-si-only',
        source_file: 'profil_prodi.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        text: 'Program Studi S1 Sistem Informasi mempelajari analisis dan perancangan sistem informasi enterprise dengan beban 144 SKS.'
      };

      const s2OnlyChunk = {
        id: 'chunk-s2-si-only',
        source_file: 'kurikulum_pascasarjana.pdf',
        academicLevel: 'S2',
        scope: 'PROGRAM_SINGLE',
        program: 'S2',
        text: 'Program Studi Magister Sistem Informasi (S2) dirancang dengan beban studi lulus minimal 41 SKS.'
      };

      // Query for S1 Sistem Informasi must reject chunk where "Sistem Informasi" is ONLY S2 Magister Sistem Informasi
      const s1Frame = resolveSemanticFrame('Apa profil kurikulum S1 Sistem Informasi?');
      const s1Plan = buildRetrievalPlan(s1Frame);
      const s1Arbitrated = arbitrateEvidence([s2OnlyWithUndergradSiblingChunk, s1OnlyChunk, s2OnlyChunk], s1Plan);

      const s1AcceptedIds = s1Arbitrated.accepted.map(c => c.id);
      expect(s1AcceptedIds).toContain('chunk-s1-si-only');
      expect(s1AcceptedIds).not.toContain('chunk-s2-si-with-s1-bd');
      expect(s1AcceptedIds).not.toContain('chunk-s2-si-only');

      // Query for S2 Sistem Informasi must reject S1 Sistem Informasi chunk and accept S2 chunk
      const s2Frame = resolveSemanticFrame('Berapa SKS kurikulum S2 Sistem Informasi?');
      const s2Plan = buildRetrievalPlan(s2Frame);
      const s2Arbitrated = arbitrateEvidence([s1OnlyChunk, s2OnlyChunk], s2Plan);

      const s2AcceptedIds = s2Arbitrated.accepted.map(c => c.id);
      expect(s2AcceptedIds).toContain('chunk-s2-si-only');
      expect(s2AcceptedIds).not.toContain('chunk-s1-si-only');
    });

    test('2c. Rejects sibling program contamination when inquiring about a single study program', () => {
      const tiChunk = {
        id: 'chunk-ti-fee',
        source_file: 'rincian_biaya.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'TI',
        docCategory: 'BIAYA',
        text: '[Program: S1 Teknologi Informasi] Biaya pendidikan per semester S1 Teknologi Informasi adalah Rp 5.100.000.'
      };
      const skChunk = {
        id: 'chunk-sk-fee',
        source_file: 'rincian_biaya.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SK',
        docCategory: 'BIAYA',
        text: '[Program: S1 Sistem Komputer] Biaya pendidikan per semester S1 Sistem Komputer adalah Rp 5.100.000.'
      };

      const frame = resolveSemanticFrame('Berapa biaya kuliah S1 Teknologi Informasi?');
      const plan = buildRetrievalPlan(frame);
      const arbitrated = arbitrateEvidence([tiChunk, skChunk], plan);

      expect(arbitrated.accepted.map(c => c.id)).toEqual(['chunk-ti-fee']);
      expect(arbitrated.rejected.map(c => c.id)).toContain('chunk-sk-fee');
    });
  });

  // =========================================================================
  // 3. Inter-Module Evidence Contract & Conflict/Provenance Detection
  // =========================================================================
  describe('3. Inter-Module Evidence Contract & Conflict/Provenance Detection', () => {
    test('3a. Every arbitrated chunk carries the complete Stage 4 Evidence Contract fields', () => {
      const candidate = {
        id: 'cert-si-2026',
        source_file: 'Sertifikat_Akreditasi_S1_Sistem_Informasi_2026.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        text: 'Program Studi S1 Sistem Informasi ITB STIKOM Bali terakreditasi Baik Sekali berdasarkan SK LAM INFOKOM berlaku sampai 2028.'
      };

      const frame = resolveSemanticFrame('Apa akreditasi S1 Sistem Informasi saat ini?');
      const plan = buildRetrievalPlan(frame);
      const arbitrated = arbitrateEvidence([candidate], plan);

      expect(arbitrated.accepted.length).toBe(1);
      const item = arbitrated.accepted[0];

      expect(item.canonicalEntity).toBe('S1 Sistem Informasi');
      expect(item.matchedEntities).toContain('S1 Sistem Informasi');
      expect(item.sourceDocument).toBe('Sertifikat_Akreditasi_S1_Sistem_Informasi_2026.pdf');
      expect(item.academicLevel).toBe('S1');
      expect(item.scope).toBe('PROGRAM_SINGLE');
      expect(item.supportedAttributes).toContain('accreditation');
      expect(Array.isArray(item.supportedInformationNeeds)).toBe(true);
      expect(item.temporalRelevance).toBe('CURRENT');
      expect(item.provenance).toEqual(expect.objectContaining({
        sourceDocument: 'Sertifikat_Akreditasi_S1_Sistem_Informasi_2026.pdf',
        authorityTier: 1,
        isPrimarySource: true
      }));
      expect(item.evidenceRole).toBe('SUPPORTING');
      expect(item.verificationStatus).toBe('VERIFIED');
    });

    test('3b. Detects conflicting numeric/SKS claims and provenance tiers across chunks', () => {
      const chunk110 = {
        id: 'mi-sks-110',
        source_file: 'ringkasan_prodi_mi.txt',
        academicLevel: 'D3',
        scope: 'PROGRAM_SINGLE',
        program: 'MI',
        text: 'Program Studi D3 Manajemen Informatika memiliki beban studi kurikulum sebanyak 110 SKS.'
      };
      const chunk115 = {
        id: 'mi-sks-115',
        source_file: 'catatan_audit_lama_mi.txt',
        academicLevel: 'D3',
        scope: 'PROGRAM_SINGLE',
        program: 'MI',
        text: 'Program Studi D3 Manajemen Informatika memiliki total beban studi kelulusan 115 SKS.'
      };

      const frame = resolveSemanticFrame('Berapa total SKS kurikulum D3 Manajemen Informatika?');
      const plan = buildRetrievalPlan(frame);
      const arbitrated = arbitrateEvidence([chunk110, chunk115], plan);

      expect(arbitrated.hasSourceConflict).toBe(true);
      expect(arbitrated.sourceConflicts.length).toBeGreaterThan(0);
      expect(arbitrated.sourceConflicts[0]).toEqual(expect.objectContaining({
        entity: 'D3 Manajemen Informatika',
        attribute: 'sks',
        values: expect.arrayContaining(['110 SKS', '115 SKS'])
      }));
    });

    test('3c. Entity-Attribute Conflict Gate: DPP vs SPP is NOT a conflict; same-component contradicting nominals ARE conflicts; historical vs active and primary vs secondary are distinguished', () => {
      const frame = resolveSemanticFrame('Berapa rincian biaya kuliah S1 Sistem Informasi?');
      const plan = buildRetrievalPlan(frame);

      // 1. Different fee components (DPP Rp 10.500.000 vs SPP Rp 5.400.000) on the same prodi are NOT conflicts
      const dppChunk = {
        id: 'si-dpp-only',
        source_file: 'SK_Tarif_Biaya_Pendidikan_2026.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        docCategory: 'BIAYA',
        governanceMetadata: { authorityTier: 1 },
        text: '[Program: S1 Sistem Informasi] Tahun Akademik 2026/2027 Dana Pendidikan Pokok (DPP) sebesar Rp 10.500.000.'
      };
      const sppPrimaryChunk = {
        id: 'si-spp-primary',
        source_file: 'SK_Tarif_Biaya_Pendidikan_2026.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        docCategory: 'BIAYA',
        governanceMetadata: { authorityTier: 1 },
        text: '[Program: S1 Sistem Informasi] Tahun Akademik 2026/2027 Biaya Pendidikan Per Semester (SPP) sebesar Rp 5.400.000.'
      };

      const nonConflictingRes = arbitrateEvidence([dppChunk, sppPrimaryChunk], plan);
      expect(nonConflictingRes.hasSourceConflict).toBe(false);
      expect(nonConflictingRes.sourceConflicts).toEqual([]);

      // 2 & 5. Same attribute (fee:spp) with two contradicting nominals from Primary (Tier 1) vs Secondary (Tier 2) in the same active period IS detected as conflict
      const sppSecondaryContradicting = {
        id: 'si-spp-secondary-conflict',
        source_file: 'brosur_ringkasan_sekunder.txt',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        docCategory: 'BIAYA',
        governanceMetadata: { authorityTier: 2 },
        text: '[Program: S1 Sistem Informasi] Tahun Akademik 2026/2027 Biaya Pendidikan Per Semester (SPP) sebesar Rp 6.900.000.'
      };

      // 4. Historical archive chunk (2022/2023) must be tagged HISTORICAL_ARCHIVE / HISTORICAL_CONTEXT and NOT conflated as active
      const sppHistoricalArchive = {
        id: 'si-spp-historical-2022',
        source_file: 'arsip_biaya_2022_2023.pdf',
        academicLevel: 'S1',
        scope: 'PROGRAM_SINGLE',
        program: 'SI',
        docCategory: 'BIAYA',
        isHistorical: true,
        text: '[Program: S1 Sistem Informasi] Arsip Lama Tahun Akademik 2022/2023 Biaya Pendidikan Per Semester (SPP) sebesar Rp 4.200.000.'
      };

      const conflictRes = arbitrateEvidence([dppChunk, sppPrimaryChunk, sppSecondaryContradicting, sppHistoricalArchive], plan);
      expect(conflictRes.hasSourceConflict).toBe(true);
      expect(conflictRes.sourceConflicts.length).toBe(1);
      expect(conflictRes.sourceConflicts[0]).toEqual(expect.objectContaining({
        entity: 'S1 Sistem Informasi',
        attribute: 'fee:spp',
        period: '2026/2027',
        values: expect.arrayContaining(['Rp 5.400.000', 'Rp 6.900.000'])
      }));

      const primaryAccepted = conflictRes.accepted.find(c => c.id === 'si-spp-primary');
      const secondaryAccepted = conflictRes.accepted.find(c => c.id === 'si-spp-secondary-conflict');
      const historicalAccepted = conflictRes.accepted.find(c => c.id === 'si-spp-historical-2022');

      expect(primaryAccepted.provenance.isPrimarySource).toBe(true);
      expect(primaryAccepted.provenance.authorityTier).toBe(1);
      expect(primaryAccepted.verificationStatus).toBe('VERIFIED');

      expect(secondaryAccepted.provenance.isPrimarySource).toBe(false);
      expect(secondaryAccepted.provenance.authorityTier).toBe(2);
      expect(secondaryAccepted.evidenceRole).toBe('CONTRADICTING');
      expect(secondaryAccepted.verificationStatus).toBe('CONFLICT_DETECTED');

      expect(historicalAccepted.temporalRelevance).toBe('HISTORICAL_ARCHIVE');
      expect(historicalAccepted.evidenceRole).toBe('HISTORICAL_CONTEXT');
      expect(historicalAccepted.verificationStatus).toBe('HISTORICAL_ONLY');
    });
  });

  // =========================================================================
  // 4. Aspect-Driven Answerability & Multi-Attribute Partial Evidence
  // =========================================================================
  describe('4. Aspect-Driven Answerability & Multi-Attribute Partial Synthesis', () => {
    const feeChunkSi = {
      id: 'fee-si-chunk',
      source_file: 'Rincian_Biaya_Kuliah_Reguler.pdf',
      academicLevel: 'S1',
      scope: 'PROGRAM_SINGLE',
      program: 'SI',
      docCategory: 'BIAYA',
      text: '[Program: S1 Sistem Informasi] Rincian Biaya Pendidikan Mahasiswa Baru Kelas Reguler S1 Sistem Informasi: Dana Pendidikan Pokok (DPP) Rp 12.000.000, Biaya Pendidikan Per Semester (SPP) Rp 5.100.000.'
    };

    const accChunkSi = {
      id: 'acc-si-chunk',
      source_file: 'Sertifikat_Akreditasi_S1_SI.pdf',
      academicLevel: 'S1',
      scope: 'PROGRAM_SINGLE',
      program: 'SI',
      text: 'Program Studi S1 Sistem Informasi ITB STIKOM Bali terakreditasi Baik Sekali berdasarkan Keputusan LAM INFOKOM.'
    };

    test('4a. Multi-attribute query with partial evidence (fee supported, accreditation missing) yields PARTIAL answerability and explicit missing-attribute disclosure', async () => {
      const frame = resolveSemanticFrame('Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?');
      const plan = buildRetrievalPlan(frame);

      // Only fee evidence is provided; accreditation evidence is absent
      const arbitrated = arbitrateEvidence([feeChunkSi], plan);
      expect(arbitrated.accepted.length).toBe(1);

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.PARTIAL);
      expect(answerability.coveredAspects).toContain('fee');
      expect(answerability.missingAspects).toContain('accreditation');
      expect(answerability.attributeEvaluation.fee.status).toBe('SUPPORTED');
      expect(answerability.attributeEvaluation.accreditation.status).toBe('MISSING');

      const synth = await synthesizeAnswer(frame, arbitrated);
      expect(synth.success).toBe(true);
      // 1. Must contain the verified tuition fee information
      expect(synth.answer).toMatch(/S1 Sistem Informasi/i);
      expect(synth.answer).toMatch(/Rp|\d+\.\d+/i);
      // 2. Must NOT fabricate accreditation rank and MUST explicitly disclose missing accreditation
      expect(synth.answer).not.toMatch(/terakreditasi\s+(?:Unggul|Baik\s+Sekali|Baik)/i);
      expect(synth.answer).toMatch(/Catatan:.*akreditasi.*belum ter(?:konfirmasi|cantum)/i);

      // 3 & 4. Universal Final Verifier must preserve PARTIAL status and NOT turn PARTIAL into SAFE_UNKNOWN
      const subFrames = decomposeQuery('Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?', {});
      expect(subFrames.length).toBe(1);
      const verif = verifyFinalAnswer(synth.answer, frame, arbitrated);
      expect(verif.pass).toBe(true);
      expect(verif.outcome).toBe('PARTIAL');
      expect(verif.status).toBe('PARTIAL');
      expect(verif.isGrounded).toBe(true);
      expect(verif.handledSafely).toBe(true);

      // 5. Outbound Renderer produces a natural WhatsApp message and leaks zero internal metadata
      const rendered = sanitizeWhatsAppMarkdown(synth.answer);
      expect(rendered).toMatch(/S1 Sistem Informasi/i);
      expect(rendered).toMatch(/Catatan:.*akreditasi.*belum ter(?:konfirmasi|cantum)/i);
      expect(rendered).not.toMatch(/\[chunk_|governanceMetadata|training_data_id|\[Program:/i);
    });

    test('4b. Multi-attribute query with full evidence (both fee and accreditation present) yields ANSWERABLE status with both attributes SUPPORTED', () => {
      const frame = resolveSemanticFrame('Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?');
      const plan = buildRetrievalPlan(frame);

      const arbitrated = arbitrateEvidence([feeChunkSi, accChunkSi], plan);
      // Both fee and accreditation chunks must be accepted
      expect(arbitrated.accepted.map(c => c.id)).toEqual(expect.arrayContaining(['fee-si-chunk', 'acc-si-chunk']));

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.coveredAspects).toEqual(expect.arrayContaining(['fee', 'accreditation']));
      expect(answerability.missingAspects).toEqual([]);
      expect(answerability.attributeEvaluation.fee.status).toBe('SUPPORTED');
      expect(answerability.attributeEvaluation.accreditation.status).toBe('SUPPORTED');
    });

    test('4c. Source gap (no evidence supporting any requested attribute) fails closed with UNKNOWN', () => {
      const frame = resolveSemanticFrame('Berapa biaya kuliah dan akreditasi S1 Sistem Informasi?');
      const plan = buildRetrievalPlan(frame);

      const unrelatedChunk = {
        id: 'unrelated-ukm',
        source_file: 'ukm_olahraga.pdf',
        academicLevel: 'UMUM',
        text: 'UKM Futsal rutin mengadakan latihan setiap hari Sabtu.'
      };

      const arbitrated = arbitrateEvidence([unrelatedChunk], plan);
      expect(arbitrated.accepted.length).toBe(0);

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
    });
  });
});
