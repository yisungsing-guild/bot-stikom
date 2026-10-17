'use strict';

/**
 * tests/crossDomainArchitecturePhaseC.test.js
 *
 * Comprehensive Regression & Diagnostic Suite for Tahap C:
 * - Natural Retrieval & Top-16 Candidate Selection
 * - Canonical Entity Aliasing & Symmetrical Scoring
 * - Evidence Arbitration & Cross-Category Evidence Admission
 * - Substantive Answerability Gate & Anti-Contamination Invariants
 */

const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence, evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');
const { findCanonicalEntity, areEntitiesEquivalent } = require('../src/engine/canonicalEntityRegistry');
const { getCorpusIndex, ensureCanonicalCorpus } = require('../src/engine/pgvectorShadowProvider');

describe('Chat Engine V2 — Phase C Architecture & Evidence Arbitration Suite', () => {
  const TARGET_CHUNK_ID = '63bcf8a2-6ce8-4f96-81b1-6d03eb0c94ee';
  const TARGET_SOURCE_FILE = 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf';

  let corpus;
  beforeAll(async () => {
    await ensureCanonicalCorpus({}, { requireCanonical: true });
    corpus = getCorpusIndex({}, { requireCanonical: true });
    expect(Array.isArray(corpus)).toBe(true);
    expect(corpus.length).toBeGreaterThanOrEqual(829);
  });


  // =========================================================================
  // Section 1: Mandatory Acceptance Criteria — Diagnostic Inquiries Q1, Q2, Q3
  // =========================================================================
  describe('Section 1: Mandatory Diagnostic Inquiries (Natural Target Chunk Discovery in Top-16)', () => {
    test('1.1: Q1 — "Apakah ada Double Degree nasional?" naturally discovers target chunk in Top-16 and accepts as ANSWERABLE', async () => {
      const q = 'Apakah ada Double Degree nasional?';
      const frame = resolveSemanticFrame(q);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.aspects).toContain('double_degree');
      expect(frame.aspects).toContain('national_program');

      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).toContain('Double Degree');
      expect(plan.requiredAspects).toContain('national_program');

      // Career variants must NOT be generated for non-career program overview
      expect(plan.queryVariants.some(v => /peluang kerja|karier masa depan/i.test(v))).toBe(false);
      // Generic synonyms must be included
      expect(plan.queryVariants.some(v => /dual degree/i.test(v))).toBe(true);

      const candidates = await retrieveCandidates(plan, { topK: 16 });
      expect(candidates.length).toBe(16);

      const targetCandidate = candidates.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetCandidate).toBeDefined();
      expect(targetCandidate.sourceFile).toBe(TARGET_SOURCE_FILE);
      expect(targetCandidate.score).toBeGreaterThan(100);

      const rank = candidates.findIndex(c => c.id === TARGET_CHUNK_ID) + 1;
      expect(rank).toBeLessThanOrEqual(16);

      const arbitration = arbitrateEvidence(candidates, plan);
      const targetAccepted = arbitration.accepted.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetAccepted).toBeDefined();
      expect(targetAccepted.disposition).toBe('SUPPORTS');
      expect(targetAccepted.reason).toBe('compatible_with_plan');
      expect(targetAccepted.providedAspects).toContain('national_program');
      expect(targetAccepted.providedAspects).toContain('double_degree');

      const answerability = evaluateAnswerability(frame, arbitration);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.reason).toBe('sufficient_supported_evidence');
      expect(answerability.coveredAspects).toContain('national_program');
    });

    test('1.2: Q2 — "Program Double Degree nasional apa saja?" naturally discovers target chunk in Top-16 and accepts as ANSWERABLE', async () => {
      const q = 'Program Double Degree nasional apa saja?';
      const frame = resolveSemanticFrame(q);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.aspects).toContain('double_degree');
      expect(frame.aspects).toContain('national_program');

      const plan = buildRetrievalPlan(frame);
      expect(plan.targetEntities).toContain('Double Degree');

      const candidates = await retrieveCandidates(plan, { topK: 16 });
      const targetCandidate = candidates.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetCandidate).toBeDefined();

      const rank = candidates.findIndex(c => c.id === TARGET_CHUNK_ID) + 1;
      expect(rank).toBeLessThanOrEqual(16);

      const arbitration = arbitrateEvidence(candidates, plan);
      const targetAccepted = arbitration.accepted.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetAccepted).toBeDefined();
      expect(targetAccepted.disposition).toBe('SUPPORTS');

      const answerability = evaluateAnswerability(frame, arbitration);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
    });

    test('1.3: Q3 — "Ada yang nasional?" following HELP/DNUI context inherits Double Degree and discovers target chunk', async () => {
      const priorSession = {
        activeDomain: 'INTERNATIONAL',
        activeIntent: 'INTERNATIONAL_PROGRAM_INFO',
        activeEntity: 'Double Degree',
        lastQuery: 'Bagaimana program double degree dengan HELP University dan DNUI?'
      };

      const q = 'Ada yang nasional?';
      const frame = resolveSemanticFrame(q, priorSession);

      expect(frame.domain).toBe('ACADEMIC_PROGRAM');
      expect(frame.intent).toBe('PROGRAM_OVERVIEW');
      expect(frame.entities.length).toBeGreaterThan(0);
      expect(frame.entities[0].canonical).toBe('Double Degree');
      expect(frame.aspects).toContain('national_program');

      const plan = buildRetrievalPlan(frame, { sessionData: priorSession });
      expect(plan.targetEntities).toContain('Double Degree');

      const candidates = await retrieveCandidates(plan, { topK: 16 });
      const targetCandidate = candidates.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetCandidate).toBeDefined();

      const rank = candidates.findIndex(c => c.id === TARGET_CHUNK_ID) + 1;
      expect(rank).toBeLessThanOrEqual(16);

      const arbitration = arbitrateEvidence(candidates, plan);
      const targetAccepted = arbitration.accepted.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetAccepted).toBeDefined();
      expect(targetAccepted.disposition).toBe('SUPPORTS');

      const answerability = evaluateAnswerability(frame, arbitration);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
    });
  });

  // =========================================================================
  // Section 2: Canonical Entity Registry & Aliasing Invariants
  // =========================================================================
  describe('Section 2: Canonical Entity Registry & Generic Aliasing Invariants', () => {
    test('2.1: Double Degree entity is registered canonically and not locked to international_program', () => {
      const entry = findCanonicalEntity('Double Degree');
      expect(entry).toBeDefined();
      expect(entry.canonical).toBe('Double Degree');
      expect(entry.family).toBe('academic_program');
      expect(entry.type).toBe('program');
      expect(entry.aliases).toContain('dual degree');
      expect(entry.aliases).toContain('dua gelar');
      expect(entry.aliases).toContain('gelar ganda');
    });

    test('2.2: Symmetrical equivalence between Double Degree, Dual Degree, and Gelar Ganda', () => {
      expect(areEntitiesEquivalent('Double Degree', 'Dual Degree')).toBe(true);
      expect(areEntitiesEquivalent('Double Degree', 'dua gelar')).toBe(true);
      expect(areEntitiesEquivalent('Dual Degree', 'gelar ganda')).toBe(true);
    });

    test('2.3: Target chunk DUAL DEGREE text matches target entity Double Degree in arbiter', () => {
      const targetDoc = corpus.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetDoc).toBeDefined();

      const evaluation = evaluateEvidenceCompatibility(targetDoc, {
        targetEntities: ['Double Degree'],
        requiredAspects: ['national_program'],
        intent: 'PROGRAM_OVERVIEW',
        domain: 'ACADEMIC_PROGRAM'
      });

      expect(evaluation.accepted).toBe(true);
      expect(evaluation.disposition).toBe('SUPPORTS');
      expect(evaluation.providedAspects).toContain('national_program');
    });
  });

  // =========================================================================
  // Section 3: Substantive Answerability Gate & Anti-False-Positive Invariants
  // =========================================================================
  describe('Section 3: Substantive Answerability Gate & Anti-Contamination Invariants', () => {
    test('3.1: International HELP & DNUI documents alone DO NOT satisfy national_program aspect', () => {
      const mockInternationalChunks = [
        {
          id: 'mock-help',
          sourceFile: 'CHATBOT - Double Degree.docx',
          text: 'Program Double Degree dengan HELP University Malaysia menawarkan gelar S.Kom dan BIT.',
          providedAspects: ['double_degree', 'international_program', 'degree_award']
        },
        {
          id: 'mock-dnui',
          sourceFile: 'CHATBOT - Double Degree.docx',
          text: 'Program Dual Degree dengan Dalian Neusoft University of Information (DNUI) China.',
          providedAspects: ['double_degree', 'international_program']
        }
      ];

      const fakeArbitration = {
        accepted: mockInternationalChunks,
        rejected: []
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['double_degree', 'national_program']
      };

      const ans = evaluateAnswerability(semanticFrame, fakeArbitration);
      expect(ans.status).not.toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(ans.coveredAspects).toContain('double_degree');
      expect(ans.missingAspects).toContain('national_program');
    });

    test('3.2: Standalone mention of "nasional" in campus facilities list does NOT satisfy national_program', () => {
      const mockFacilityChunk = [
        {
          id: 'mock-facility',
          sourceFile: 'fasilitas-stikom.pdf',
          text: 'Fasilitas dan program kampus:\n1. Lab Komputer\n2. Perpustakaan\n7. Program Double Degree Nasional\n8. Asrama Mahasiswa',
          providedAspects: ['facilities']
        }
      ];

      const fakeArbitration = {
        accepted: mockFacilityChunk,
        rejected: []
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['national_program']
      };

      const ans = evaluateAnswerability(semanticFrame, fakeArbitration);
      expect(ans.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(ans.missingAspects).toContain('national_program');
    });

    test('3.3: Accreditation certificates mentioning "akreditasi nasional" DO NOT satisfy national_program', () => {
      const mockAccreditationChunk = [
        {
          id: 'mock-accreditation',
          sourceFile: 'sertifikat-akreditasi-ban-pt.pdf',
          text: 'Badan Akreditasi Nasional Perguruan Tinggi (BAN-PT) menetapkan peringkat Akreditasi Baik Sekali.',
          providedAspects: ['akreditasi']
        }
      ];

      const fakeArbitration = {
        accepted: mockAccreditationChunk,
        rejected: []
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['national_program']
      };

      const ans = evaluateAnswerability(semanticFrame, fakeArbitration);
      expect(ans.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(ans.missingAspects).toContain('national_program');
    });

    test('3.4: Substantive UTB DUAL DEGREE (NATIONAL CLASS) chunk satisfies national_program and partnership', () => {
      const targetDoc = corpus.find(c => c.id === TARGET_CHUNK_ID);
      expect(targetDoc).toBeDefined();

      const fakeArbitration = {
        accepted: [{
          ...targetDoc,
          providedAspects: ['double_degree', 'national_program', 'partnership', 'fee']
        }],
        rejected: []
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_OVERVIEW',
        aspects: ['national_program', 'partnership']
      };

      const ans = evaluateAnswerability(semanticFrame, fakeArbitration);
      expect(ans.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(ans.coveredAspects).toContain('national_program');
      expect(ans.coveredAspects).toContain('partnership');
    });
  });

  // =========================================================================
  // Section 4: Cross-Domain & Unpolluted Retrieval Scoring Invariants
  // =========================================================================
  describe('Section 4: Cross-Domain & Unpolluted Retrieval Scoring Invariants', () => {
    test('4.1: Regular tuition fee inquiry retrieves correct BIAYA documents without contamination', async () => {
      const q = 'Berapa biaya kuliah S1 Sistem Informasi?';
      const frame = resolveSemanticFrame(q);
      const plan = buildRetrievalPlan(frame);

      const candidates = await retrieveCandidates(plan, { topK: 8 });
      expect(candidates.length).toBeGreaterThan(0);

      // Top candidate must be a fee document for S1 SI
      const topCand = candidates[0];
      expect(topCand.docCategory === 'BIAYA' || /rincian biaya/i.test(topCand.sourceFile)).toBe(true);
      expect(topCand.text).toMatch(/sistem informasi/i);
    });

    test('4.2: Campus facilities inquiry does NOT retrieve or get contaminated by fee documents', async () => {
      const q = 'Fasilitas apa saja yang ada di kampus ITB STIKOM Bali?';
      const frame = resolveSemanticFrame(q);
      const plan = buildRetrievalPlan(frame);

      const candidates = await retrieveCandidates(plan, { topK: 8 });
      expect(candidates.length).toBeGreaterThan(0);

      const arbitration = arbitrateEvidence(candidates, plan);
      // None of the accepted candidates should be tuition fee tables
      expect(arbitration.accepted.every(c => !/tabel rincian biaya/i.test(c.text))).toBe(true);
    });

    test('4.3: Pure fee documents lacking program overview are rejected for PROGRAM_OVERVIEW of other prodi', () => {
      const pureFeeDoc = {
        id: 'mock-pure-fee-si',
        sourceFile: 'rincian biaya kuliah si 2026.pdf',
        text: 'Tabel Pembayaran Biaya Kuliah Mahasiswa Baru S1 SI: DPP Rp 12.000.000, SPP Rp 4.500.000.',
        docCategory: 'BIAYA'
      };

      const evaluation = evaluateEvidenceCompatibility(pureFeeDoc, {
        targetEntities: ['S1 Sistem Informasi'],
        intent: 'PROGRAM_OVERVIEW',
        requiredAspects: ['overview'],
        domain: 'ACADEMIC_PROGRAM'
      });

      expect(evaluation.accepted).toBe(false);
      expect(evaluation.reason).toBe('evidence_from_fee_doc_lacks_overview');
    });

    test('4.4: Program inquiry without career intent does NOT apply career penalty to relevant docs', async () => {
      const q = 'Apa yang dipelajari di S1 Sistem Informasi?';
      const frame = resolveSemanticFrame(q);
      const plan = buildRetrievalPlan(frame);

      // Plan should not have career_prospects aspect
      expect(plan.requiredAspects).not.toContain('career_prospects');
      expect(plan.queryVariants.some(v => /peluang kerja|karier masa depan/i.test(v))).toBe(false);

      const candidates = await retrieveCandidates(plan, { topK: 16 });
      expect(candidates.length).toBe(16);
      expect(candidates.some(c => /sistem informasi/i.test(c.text))).toBe(true);
    });
  });
});
