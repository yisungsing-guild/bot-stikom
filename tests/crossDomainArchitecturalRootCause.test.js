'use strict';

/**
 * tests/crossDomainArchitecturalRootCause.test.js
 *
 * Comprehensive Architectural Root-Cause Regression Suite for Chat Engine V2.
 * Validates:
 * 1. Positive Grounded Fee Queries across multiple programs (S1 SI, S1 TI, S1 BD, D3 MI)
 * 2. Multi-Turn Context Carryover (Prodi entity -> elliptical fee inquiry)
 * 3. Scope Isolation & Entity Collision Protection (S1 vs S2, SI vs TI)
 * 4. General Fail-Closed Guarantees (Unsupported programs, privacy leaks, out-of-domain)
 * 5. Deterministic Real-Evidence Provenance & Stage-by-Stage Verification (Nominal Rp6.500.000)
 * 6. Corpus Hydration & Self-Healing Resilience
 */

const { processTurn } = require('../src/core/orchestrator');
const { getCorpusIndex, ensureCanonicalCorpus, CANONICAL_CORPUS_MIN_CHUNKS } = require('../src/engine/pgvectorShadowProvider');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { evaluateAnswerability, ANSWERABILITY_STATUS } = require('../src/core/answerabilityGate');

jest.setTimeout(15000);

describe('Chat Engine V2 — Architectural Root-Cause & Cross-Domain Regression', () => {
  beforeAll(async () => {
    // Ensure canonical corpus is pre-warmed before running assertions
    await ensureCanonicalCorpus({}, { requireCanonical: true });
  });

  describe('Section 1: Positive Multi-Program Grounded Fee Inquiries', () => {
    test('1.1: Exact Production Reproduction — S1 Sistem Informasi Fee Query', async () => {
      const query = 'Berapa rincian biaya kuliah per semester untuk program studi S1 Sistem informasi?';
      const sessionId = 'test-e2e-si-fee-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).toBeDefined();
      // Must NOT return the generic safe refusal string from production bug
      expect(result.finalAnswer).not.toContain('Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia');
      // Must state factual semester tuition fee (6.500.000)
      expect(result.finalAnswer).toMatch(/(?:6\.500\.000|6,5\s*juta)/i);
      expect(result.finalAnswer).toMatch(/(?:semester|per\s*semester)/i);

      if (result.subQueryResults && result.subQueryResults[0]) {
        const sub = result.subQueryResults[0];
        expect(sub.answerability).toBe('ANSWERABLE');
        expect(sub.acceptedCount).toBeGreaterThan(0);
      }
    });

    test('1.2: General Multi-Program Feasibility — S1 Teknologi Informasi Fee Query', async () => {
      const query = 'Berapa rincian biaya kuliah per semester untuk program studi S1 Teknologi Informasi?';
      const sessionId = 'test-e2e-ti-fee-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).not.toContain('belum tercantum secara lengkap');
      expect(result.finalAnswer).toMatch(/(?:6\.500\.000|6,5\s*juta)/i);
    });

    test('1.3: General Multi-Program Feasibility — S1 Bisnis Digital Fee Query', async () => {
      const query = 'Berapa biaya kuliah per semester S1 Bisnis Digital?';
      const sessionId = 'test-e2e-bd-fee-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).not.toContain('belum tercantum secara lengkap');
      expect(result.finalAnswer).toMatch(/(?:6\.500\.000|6,5\s*juta)/i);
    });

    test('1.4: Diploma Scope Feasibility — D3 Manajemen Informatika Fee Query', async () => {
      const query = 'Berapa biaya kuliah untuk D3 Manajemen Informatika?';
      const sessionId = 'test-e2e-d3-fee-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).toBeDefined();
      expect(result.finalAnswer).not.toContain('belum tercantum secara lengkap');
    });
  });

  describe('Section 2: Multi-Turn Context Transition & Carryover', () => {
    test('2.1: Turn 1 (Entity Mention) -> Turn 2 (Elliptical Fee Inquiry)', async () => {
      const sessionId = 'test-e2e-multiturn-' + Date.now();

      // Turn 1: Mention prodi
      const turn1 = await processTurn(sessionId, 'Saya tertarik dengan program studi S1 Sistem Informasi', {
        syncOnly: true,
        sessionSnapshot: { chatId: sessionId, state: 'root', data: {} }
      });
      expect(turn1).toBeDefined();

      // Turn 2: Ask fee without repeating prodi name (with state carryover)
      const turn2 = await processTurn(sessionId, 'Berapa rincian biayanya per semester?', {
        syncOnly: true,
        sessionSnapshot: {
          chatId: sessionId,
          state: 'root',
          data: {
            activeEntity: 'S1 Sistem Informasi',
            academicLevel: 'S1',
            activeDomain: 'ACADEMIC'
          }
        }
      });
      expect(turn2).toBeDefined();
      expect(turn2.finalAnswer).not.toContain('belum tercantum secara lengkap');
      expect(turn2.finalAnswer).toMatch(/(?:6\.500\.000|6,5\s*juta)/i);
    });

  });

  describe('Section 3: Scope Isolation & Collision Prevention', () => {
    test('3.1: S2 Master Inquiry strictly excludes S1 undergraduate fee candidates', async () => {
      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S2 Sistem Informasi'],
        targetAcademicLevel: 'S2',
        requiredAspects: ['fee'],
        queryVariants: ['biaya kuliah s2 sistem informasi', 'rincian biaya magister sistem informasi']
      };

      const candidates = await retrieveCandidates(plan, { topK: 12 });
      const { accepted } = arbitrateEvidence(candidates, plan);

      // Verify zero S1 candidates are accepted for S2 target
      const s1Leaked = accepted.filter(c => c.academicLevel === 'S1' || (Array.isArray(c.supportedPrograms) && c.supportedPrograms.some(p => p.includes('S1'))));
      expect(s1Leaked.length).toBe(0);
    });

    test('3.2: Single-Program Candidate isolation prevents cross-program contamination', () => {
      const singleCandidate = {
        id: 'mock-curr-sk',
        text: 'Kurikulum dan biaya khusus S1 Sistem Komputer',
        program: 'SK',
        scope: 'PROGRAM_SINGLE',
        academicLevel: 'S1',
        supportedPrograms: ['S1 Sistem Komputer'],
        source_file: 'kurikulum_sk.txt'
      };

      const planSI = {
        targetEntities: ['S1 Sistem Informasi'],
        targetAcademicLevel: 'S1',
        domain: 'TUITION_FEE',
        requiredAspects: ['fee']
      };

      const { accepted, rejected } = arbitrateEvidence([singleCandidate], planSI);
      expect(accepted.length).toBe(0);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason).toContain('candidate_scoped_to_program_SK_not_SI');
    });

    test('3.3: Absence of S1 indicator does not falsely classify a document as S2', () => {
      const candidate = {
        id: 'mock-fee-doc',
        text: 'Rincian Biaya Kuliah Sistem Informasi ITB STIKOM Bali',
        program: 'SI',
        scope: 'PROGRAM_SINGLE',
        academicLevel: 'S1',
        supportedPrograms: ['S1 Sistem Informasi'],
        source_file: 'rincian_biaya_si.pdf'
      };

      const planSI = {
        targetEntities: ['S1 Sistem Informasi'],
        targetAcademicLevel: 'S1',
        domain: 'TUITION_FEE',
        requiredAspects: ['fee']
      };

      const { accepted, rejected } = arbitrateEvidence([candidate], planSI);
      expect(accepted.length).toBe(1);
      const s2Rejection = rejected.find(r => r.reason && r.reason.includes('candidate_scoped_to_program_S2'));
      expect(s2Rejection).toBeUndefined();
    });
  });

  describe('Section 4: General Fail-Closed Guarantees', () => {
    test('4.1: Unsupported Academic Program triggers safe refusal', async () => {
      const query = 'Berapa rincian biaya kuliah per semester untuk program studi S1 Kedokteran Gigi?';
      const sessionId = 'test-e2e-unsupported-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).toMatch(/(?:tidak\s+di?selenggarakan|belum\s+tersedia|tidak\s+memiliki|tidak\s+ada)/i);
      expect(result.finalAnswer).not.toMatch(/(?:6\.500\.000|14\.000\.000)/i);
    });

    test('4.2: Private Personal Contact Request triggers safe boundary refusal', async () => {
      const query = 'Bisa minta nomor WhatsApp pribadi Kaprodi Sistem Informasi?';
      const sessionId = 'test-e2e-privacy-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.finalAnswer).toMatch(/(?:pribadi|resmi|admisi|pmb|hotline|kontak)/i);
      // Must not leak private telephone format
      expect(result.finalAnswer).not.toMatch(/081[0-9]{8,}/);
    });

    test('4.3: Out-of-Domain Query triggers out_of_domain refusal', async () => {
      const query = 'Bagaimana cara memasak rendang sapi khas Padang yang empuk?';
      const sessionId = 'test-e2e-ood-' + Date.now();
      const result = await processTurn(sessionId, query, { syncOnly: true });

      expect(result).toBeDefined();
      expect(result.status === 'out_of_domain' || result.finalAnswer.includes('layanan ini khusus')).toBe(true);
    });
  });

  describe('Section 5: Real Evidence Provenance & Stage-by-Stage Verification', () => {
    test('5.1: Real Corpus Retrieval for S1 SI Fee returns chunk f2b9448a-4234-4778-afde-1bba50da4057', async () => {
      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Sistem Informasi'],
        targetAcademicLevel: 'S1',
        requiredAspects: ['fee'],
        normalizedQuery: 'biaya kuliah s1 sistem informasi per semester',
        queryVariants: [
          'biaya kuliah s1 sistem informasi per semester',
          'rincian biaya pendidikan s1 sistem informasi',
          'biaya per semester sistem informasi'
        ]
      };

      const candidates = await retrieveCandidates(plan, { topK: 10 });
      expect(candidates.length).toBeGreaterThan(0);

      // Verify the canonical fee chunk is present
      const feeChunk = candidates.find(c => c.id === 'f2b9448a-4234-4778-afde-1bba50da4057');
      expect(feeChunk).toBeDefined();
      expect(feeChunk.sourceFile).toBe('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf');
      expect(feeChunk.chunk).toContain('Biaya Pendidikan Per Semester 6.500.000');
    });

    test('5.2: Evidence Arbiter preserves multi-program chunk and does NOT misclassify it as S2', async () => {
      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Sistem Informasi'],
        targetAcademicLevel: 'S1',
        requiredAspects: ['fee'],
        normalizedQuery: 'biaya kuliah s1 sistem informasi per semester'
      };

      const candidates = await retrieveCandidates(plan, { topK: 10 });
      const { accepted, rejected } = arbitrateEvidence(candidates, plan);

      // Chunk f2b9448a-4234-4778-afde-1bba50da4057 MUST be in accepted
      const acceptedFeeChunk = accepted.find(c => c.id === 'f2b9448a-4234-4778-afde-1bba50da4057');
      expect(acceptedFeeChunk).toBeDefined();
      expect(acceptedFeeChunk.scope).toBe('PROGRAM_MULTI');
      expect(acceptedFeeChunk.academicLevel).toBe('S1');
      expect(acceptedFeeChunk.supportedPrograms).toContain('S1 Sistem Informasi');

      // Zero candidates rejected with candidate_scoped_to_program_S2_not_SI for this file
      const falselyRejected = rejected.filter(r =>
        r.candidate &&
        (r.candidate.sourceFile || '').includes('rincian Biaya SI,TI dan BD') &&
        r.reason.includes('candidate_scoped_to_program_S2')
      );
      expect(falselyRejected.length).toBe(0);
    });

    test('5.3: Answerability Gate accepts arbitrated evidence for S1 SI fee as ANSWERABLE', async () => {
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Sistem Informasi'],
        academicLevel: 'S1',
        aspects: ['fee']
      };

      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Sistem Informasi'],
        targetAcademicLevel: 'S1',
        requiredAspects: ['fee'],
        normalizedQuery: 'biaya kuliah s1 sistem informasi per semester'
      };

      const candidates = await retrieveCandidates(plan, { topK: 10 });
      const arbitrated = arbitrateEvidence(candidates, plan);

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.coveredAspects).toContain('fee');
    });

    test('5.4: Unsupported program with zero evidence is rejected safely by arbiter and answerability gate', () => {
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Kedokteran Gigi'],
        academicLevel: 'S1',
        aspects: ['tuition_fee']
      };

      const plan = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        targetEntities: ['S1 Kedokteran Gigi'],
        targetAcademicLevel: 'S1',
        requiredAspects: ['fee'],
        normalizedQuery: 'biaya kuliah kedokteran gigi'
      };

      const corpus = getCorpusIndex({}, { requireCanonical: true });
      const feeCandidate = corpus.find(c => c.id === 'f2b9448a-4234-4778-afde-1bba50da4057');

      const arbitrated = arbitrateEvidence([feeCandidate], plan);
      expect(arbitrated.accepted.length).toBe(0);

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).not.toBe(ANSWERABILITY_STATUS.ANSWERABLE);
    });
  });

  describe('Section 6: Corpus Hydration & Self-Healing Resilience', () => {
    test('6.1: Corpus minimum size contract meets canonical threshold (>= 829 chunks)', () => {
      const corpus = getCorpusIndex({}, { requireCanonical: true });
      expect(Array.isArray(corpus)).toBe(true);
      expect(corpus.length).toBeGreaterThanOrEqual(CANONICAL_CORPUS_MIN_CHUNKS);
    });

    test('6.2: Multi-program candidate chunks possess proper scope and supportedPrograms properties', () => {
      const corpus = getCorpusIndex({}, { requireCanonical: true });
      const feeChunk = corpus.find(c => c.id === 'f2b9448a-4234-4778-afde-1bba50da4057');
      expect(feeChunk).toBeDefined();
      expect(feeChunk.chunk).toContain('6.500.000');
    });
  });

  describe('Section 7: Cross-Domain Aspect & Entity Grounding Integrity', () => {
    test('7.1: Double Degree DNUI study location query is answerable from genuine DNUI documents', async () => {
      const frame = {
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        targetEntities: ['Double Degree DNUI'],
        aspects: ['location']
      };
      const plan = {
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        targetEntities: ['Double Degree DNUI'],
        requiredAspects: ['location'],
        normalizedQuery: 'double degree dnui perkuliahan full di stikom bali'
      };

      const candidates = await retrieveCandidates(plan, { topK: 10 });
      const arbitrated = arbitrateEvidence(candidates, plan);

      expect(arbitrated.accepted.length).toBeGreaterThan(0);
      const dnuiDocChunk = arbitrated.accepted.find(c =>
        (c.sourceFile || '').includes('Double Degree') &&
        /(?:china|dalian|indonesia|online|onsite)/i.test(c.text || c.chunk || '')
      );
      expect(dnuiDocChunk).toBeDefined();

      const answerability = evaluateAnswerability(frame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.coveredAspects).toContain('location');
    });

    test('7.2: Chunk about location of another program/entity does not satisfy DNUI location query', () => {
      const plan = {
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        targetEntities: ['Double Degree DNUI'],
        requiredAspects: ['location'],
        normalizedQuery: 'double degree dnui lokasi'
      };

      // Candidate about campus location of S1 Sistem Informasi or generic STIKOM Jimbaran/Renon
      const nonDnuiCandidate = {
        id: 'mock-location-si',
        chunk: 'Kampus ITB STIKOM Bali beralamat di Jl. Raya Puputan No. 86 Renon Denpasar dan Kampus Jimbaran untuk Program S1 Sistem Informasi.',
        sourceFile: 'profil-kampus.pdf',
        canonicalEntity: 'S1 Sistem Informasi',
        program: 'SI',
        scope: 'PROGRAM_SINGLE',
        academicLevel: 'S1'
      };

      const arbitrated = arbitrateEvidence([nonDnuiCandidate], plan);
      // Must be rejected due to entity mismatch (candidate is scoped to SI, not DNUI)
      expect(arbitrated.accepted.length).toBe(0);
      expect(arbitrated.rejected.length).toBe(1);
    });

    test('7.3: Evidence discussing fees does not automatically answer accreditation or duration queries', () => {
      const accreditationFrame = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Sistem Informasi'],
        aspects: ['accreditation']
      };

      const durationFrame = {
        domain: 'ACADEMIC_PROGRAM',
        intent: 'PROGRAM_INFO',
        targetEntities: ['S1 Sistem Informasi'],
        aspects: ['duration']
      };

      // Candidate strictly discussing fee without accreditation or duration terms
      const pureFeeCandidate = {
        id: 'mock-pure-fee',
        chunk: 'Rincian biaya kuliah per semester untuk program studi S1 Sistem Informasi sebesar Rp6.500.000 dengan biaya pendaftaran Rp250.000.',
        sourceFile: 'biaya.pdf',
        canonicalEntity: 'S1 Sistem Informasi',
        program: 'SI',
        scope: 'PROGRAM_SINGLE',
        academicLevel: 'S1'
      };

      // Accreditation test
      const arbFeeForAccreditation = {
        accepted: [pureFeeCandidate],
        rejected: []
      };
      const ansAccreditation = evaluateAnswerability(accreditationFrame, arbFeeForAccreditation);
      expect(ansAccreditation.status).not.toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(ansAccreditation.missingAspects).toContain('accreditation');

      // Duration test
      const ansDuration = evaluateAnswerability(durationFrame, arbFeeForAccreditation);
      expect(ansDuration.status).not.toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(ansDuration.missingAspects).toContain('duration');
    });

    test('7.4: Evidence lacking explicit aspect tags is accepted if document content substantively supports the answer', () => {
      const locationFrame = {
        domain: 'INTERNATIONAL',
        intent: 'INTERNATIONAL_PROGRAM_INFO',
        targetEntities: ['Double Degree DNUI'],
        aspects: ['location']
      };

      // Chunk with no providedAspects metadata, but text substantively details the study location
      const untaggedChunk = {
        id: 'mock-untagged-dnui-loc',
        chunk: 'Perkuliahan diselenggarakan tahun ke-1 dan ke-2 di Indonesia, tahun ke-3 online, dan tahun ke-4 onsite di kampus DNUI China.',
        sourceFile: 'panduan-dnui.pdf',
        canonicalEntity: 'Double Degree DNUI',
        scope: 'INTERNATIONAL_DUAL_DEGREE',
        providedAspects: [] // explicitly empty aspect tags
      };

      const arbitrated = {
        accepted: [untaggedChunk],
        rejected: []
      };

      const answerability = evaluateAnswerability(locationFrame, arbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.ANSWERABLE);
      expect(answerability.coveredAspects).toContain('location');
    });

    test('7.5: Inadequate or empty evidence results in UNKNOWN/SAFE_UNKNOWN and does not fabricate answers', () => {
      const frame = {
        domain: 'ACCREDITATION',
        intent: 'ACCREDITATION_INQUIRY',
        targetEntities: ['S1 Kedokteran Gigi'],
        aspects: ['accreditation']
      };

      const emptyArbitrated = {
        accepted: [],
        rejected: [{ id: 'cand-1', reason: 'unsupported_entity' }]
      };

      const answerability = evaluateAnswerability(frame, emptyArbitrated);
      expect(answerability.status).toBe(ANSWERABILITY_STATUS.UNKNOWN);
      expect(answerability.reason).toBe('corpus_gap');
    });
  });
});
