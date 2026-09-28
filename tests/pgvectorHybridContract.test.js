'use strict';

/**
 * tests/pgvectorHybridContract.test.js
 *
 * Production Safe Hybrid Retrieval Verification Suite.
 *
 * Requirements:
 * 1. Activation Flags & Safe Defaults:
 *    - VECTOR_RETRIEVAL_MODE=hybrid OR VECTOR_HYBRID_ENABLED=true
 *    - Safe defaults: VECTOR_SHADOW_ENABLED=true, VECTOR_SHADOW_SAMPLE_RATE=0.1, VECTOR_RETRIEVAL_ENABLED=false
 *    - Pure-vector VECTOR_RETRIEVAL_ENABLED=true does not activate hybrid
 * 2. Canonical Identity & Deduplication
 * 3. Legacy-only fallback PASS
 * 4. Vector-only supported fallback PASS
 * 5. Complementary hybrid merge PASS
 * 6. Safe Hybrid Retrieval Gate Contracts:
 *    - GREETING_BYPASSES_HYBRID: "Hallo" -> HYBRID_RETRIEVAL_EXECUTED=NO
 *    - CASUAL_BYPASSES_HYBRID: "Apa khabar" -> HYBRID_RETRIEVAL_EXECUTED=NO, not NO_DATA
 *    - GENERIC_PMB_NO_RANDOM_EVIDENCE: "Saya ingin bertanya tentang pmb" -> HYBRID_RETRIEVAL_EXECUTED=NO, no HIMATOGRAPHY
 *    - CONTEXTUAL_FOLLOWUP_PASS: "Apa itu si?" after PMB context -> HYBRID_RETRIEVAL_EXECUTED=YES
 *    - FACTUAL_SI_USES_HYBRID: "Apa itu sistem informasi?" -> HYBRID_RETRIEVAL_EXECUTED=YES
 * 7. Trace 1, 2, 3 False Accept Count = 0
 * 8. Trace 3 Vector Evidence Rank #1 (96693416-2f1e-4db6-a457-307c08936404) remains SUPPORTED
 */

const {
  isHybridRetrievalEnabled,
  isFactualRetrievalRequired,
  getCanonicalEvidenceIdentity,
  normalizeCandidateToEvidence,
  mergeAndDeduplicateCandidates,
  retrieveVectorCandidatesForPlan,
  executeHybridPlan,
  getCanarySampleRate,
  computeCanaryBucket,
  resolveConversationIdentifier,
  recordCanaryTelemetry
} = require('../src/engine/pgvectorHybridProvider');

const {
  evaluatePlanResults,
  evaluateBinding,
  EVALUATION_STATUS,
  EVIDENCE_DISPOSITION
} = require('../src/engine/evidenceEvaluator');

const {
  buildCorpusEvidenceFromCandidate
} = require('../src/engine/pgvectorShadowProvider');

const {
  defaultRegistry,
  createEvidenceRecord
} = require('../src/engine/evidenceProviderRegistry');

const {
  querySemanticRag
} = require('../src/engine/semanticRagEngine');

const {
  resolveEffectiveSemanticFrame
} = require('../src/engine/semanticFrameResolver');

describe('Safe Hybrid Retrieval Gate Contracts', () => {
  jest.setTimeout(60000);
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  describe('1. Activation Flags & Safe Defaults', () => {
    test('Default environment has hybrid retrieval disabled and preserves shadow defaults', () => {
      delete process.env.VECTOR_RETRIEVAL_MODE;
      delete process.env.VECTOR_HYBRID_ENABLED;
      process.env.VECTOR_RETRIEVAL_ENABLED = 'false';
      process.env.VECTOR_SHADOW_ENABLED = 'true';
      process.env.VECTOR_SHADOW_SAMPLE_RATE = '0.1';

      expect(isHybridRetrievalEnabled()).toBe(false);
      expect(process.env.VECTOR_SHADOW_ENABLED).toBe('true');
      expect(process.env.VECTOR_SHADOW_SAMPLE_RATE).toBe('0.1');
      expect(process.env.VECTOR_RETRIEVAL_ENABLED).toBe('false');
    });

    test('VECTOR_RETRIEVAL_MODE=hybrid activates hybrid retrieval', () => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';
      delete process.env.VECTOR_HYBRID_ENABLED;
      expect(isHybridRetrievalEnabled()).toBe(true);
    });

    test('VECTOR_HYBRID_ENABLED=true activates hybrid retrieval', () => {
      delete process.env.VECTOR_RETRIEVAL_MODE;
      process.env.VECTOR_HYBRID_ENABLED = 'true';
      expect(isHybridRetrievalEnabled()).toBe(true);
    });

    test('Ambiguous pure-vector flag VECTOR_RETRIEVAL_ENABLED=true does NOT activate hybrid retrieval', () => {
      delete process.env.VECTOR_RETRIEVAL_MODE;
      delete process.env.VECTOR_HYBRID_ENABLED;
      process.env.VECTOR_RETRIEVAL_ENABLED = 'true';
      expect(isHybridRetrievalEnabled()).toBe(false);
    });
  });

  describe('2. Safe Hybrid Retrieval Gate Decision (Unit)', () => {
    test('Path A: Greeting query bypasses factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Hallo');
      const required = isFactualRetrievalRequired(frame, null, 'Hallo');
      expect(required).toBe(false);
    });

    test('Path A: Casual small talk query "Apa khabar" bypasses factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Apa khabar');
      const required = isFactualRetrievalRequired(frame, null, 'Apa khabar');
      expect(required).toBe(false);
    });

    test('Path A: Generic PMB query "Saya ingin bertanya tentang pmb" bypasses factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Saya ingin bertanya tentang pmb');
      const required = isFactualRetrievalRequired(frame, null, 'Saya ingin bertanya tentang pmb');
      expect(required).toBe(false);
    });

    test('Path A: Social acknowledgement "Terima kasih banyak" bypasses factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Terima kasih banyak');
      const required = isFactualRetrievalRequired(frame, null, 'Terima kasih banyak');
      expect(required).toBe(false);
    });

    test('Path B: Factual entity query "Apa itu sistem informasi?" requires factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Apa itu sistem informasi?');
      const required = isFactualRetrievalRequired(frame, null, 'Apa itu sistem informasi?');
      expect(required).toBe(true);
    });

    test('Path B: Career query "Prospek karir teknologi informasi" requires factual retrieval', () => {
      const frame = resolveEffectiveSemanticFrame('Prospek karir teknologi informasi');
      const required = isFactualRetrievalRequired(frame, null, 'Prospek karir teknologi informasi');
      expect(required).toBe(true);
    });
  });

  describe('3. Canonical Identity & Deduplication', () => {
    test('Correctly identifies matching canonical identity by source_record_id / UUID', () => {
      const item1 = { source_record_id: '96693416-2f1e-4db6-a457-307c08936404' };
      const item2 = { id: '96693416-2f1e-4db6-a457-307c08936404' };
      const item3 = { evidenceId: 'ev_96693416-2f1e-4db6-a457-307c08936404' };

      expect(getCanonicalEvidenceIdentity(item1)).toBe('96693416-2f1e-4db6-a457-307c08936404');
      expect(getCanonicalEvidenceIdentity(item2)).toBe('96693416-2f1e-4db6-a457-307c08936404');
      expect(getCanonicalEvidenceIdentity(item3)).toBe('96693416-2f1e-4db6-a457-307c08936404');
    });

    test('Correctly identifies matching canonical identity by sourceFile + chunkIndex', () => {
      const item1 = { source_file: 'ISIAN WEBSITE (1).pdf', source_record_index: 42 };
      const item2 = { chunk: { filename: 'ISIAN WEBSITE (1).pdf', chunkIndex: 42 } };

      expect(getCanonicalEvidenceIdentity(item1)).toBe('ISIAN WEBSITE (1).pdf#42');
      expect(getCanonicalEvidenceIdentity(item2)).toBe('ISIAN WEBSITE (1).pdf#42');
    });

    test('Deduplicates candidates appearing in both legacy and vector retrieval with RRF fusion', () => {
      const binding = {
        bindingId: 'b_test_ti',
        requestedField: 'careerOutcome',
        entity: { canonical: 'Teknologi Informasi', family: 'program' }
      };

      const legacyCand = {
        source_record_id: 'chunk-uuid-1',
        source_file: 'ISIAN WEBSITE (1).pdf',
        source_record_index: 10,
        program: 'TI',
        category: 'career',
        chunk: 'Lulusan program studi Teknologi Informasi STIKOM Bali bekerja sebagai Network Engineer dan Cybersecurity Analyst.'
      };

      const vectorCand = {
        source_record_id: 'chunk-uuid-1',
        source_file: 'ISIAN WEBSITE (1).pdf',
        source_record_index: 10,
        program: 'TI',
        category: 'career',
        chunk: 'Lulusan program studi Teknologi Informasi STIKOM Bali bekerja sebagai Network Engineer dan Cybersecurity Analyst.',
        similarity: 0.85
      };

      const merged = mergeAndDeduplicateCandidates([legacyCand], [vectorCand], binding, []);
      expect(merged.length).toBe(1);
      expect(merged[0].retrievalChannel).toBe('hybrid');
      expect(merged[0].qualifiers.legacyRank).toBe(1);
      expect(merged[0].qualifiers.vectorRank).toBe(1);
      expect(merged[0].confidenceSignals.score).toBe(0.85);
    });
  });

  describe('4. Fallback & Merging Contracts', () => {
    test('LEGACY_FALLBACK: When vector retrieval returns no candidates, legacy behavior remains unchanged', async () => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';

      const binding = {
        bindingId: 'b_leg_1',
        requestedField: 'tuitionFee',
        entity: { canonical: 'Teknologi Informasi', family: 'program' }
      };

      const legacyCand = {
        source_record_id: 'chunk-leg-fee',
        chunkIndex: 5,
        source_file: 'brosur_biaya.pdf',
        chunk: 'Biaya kuliah per semester untuk program studi Teknologi Informasi adalah Rp 6.000.000.',
        program: 'TI'
      };

      const vectorCandidates = [];
      const merged = mergeAndDeduplicateCandidates([legacyCand], vectorCandidates, binding, []);

      expect(merged.length).toBe(1);
      expect(merged[0].retrievalChannel).toBe('legacy');
      expect(merged[0].qualifiers.legacyRank).toBe(1);
      expect(merged[0].qualifiers.vectorRank).toBeNull();
      expect(merged[0].textSnippet).toContain('Rp 6.000.000');

      const evalRes = evaluateBinding(binding, merged, {}, { evidenceOpportunityComplete: true });
      expect(evalRes.status).toBe(EVALUATION_STATUS.SUPPORTED);
      expect(evalRes.supportedFacts.length).toBe(1);
      expect(evalRes.supportedFacts[0].retrievalChannel).toBe('legacy');
    });

    test('VECTOR_SUPPORTED_FALLBACK: When legacy returns no candidates but vector finds supported evidence, vector evidence answers', async () => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';

      const binding = {
        bindingId: 'b_vec_only',
        requestedField: 'careerOutcome',
        entity: { canonical: 'Teknologi Informasi', family: 'program' }
      };

      const legacyCandidates = [];
      const vectorCand = {
        source_record_id: '96693416-2f1e-4db6-a457-307c08936404',
        source_file: 'ISIAN WEBSITE (1).pdf',
        source_record_index: 22,
        program: 'TI',
        category: 'career',
        doc_category: 'PRODI_PROFILE',
        chunk: 'Program Studi S1 Teknologi Informasi STIKOM Bali menghasilkan lulusan dengan profil profesional: Information Security Analyst, Systems Integrator, dan Cloud Architect.',
        similarity: 0.88
      };

      const merged = mergeAndDeduplicateCandidates(legacyCandidates, [vectorCand], binding, []);
      expect(merged.length).toBe(1);
      expect(merged[0].retrievalChannel).toBe('vector');
      expect(merged[0].qualifiers.legacyRank).toBeNull();
      expect(merged[0].qualifiers.vectorRank).toBe(1);

      const evalRes = evaluateBinding(binding, merged, {}, { evidenceOpportunityComplete: true });
      expect(evalRes.status).toBe(EVALUATION_STATUS.SUPPORTED);
      expect(evalRes.supportedFacts.length).toBe(1);
      expect(evalRes.supportedFacts[0].retrievalChannel).toBe('vector');
      expect(evalRes.supportedFacts[0].value).toContain('Information Security Analyst');
    });

    test('HYBRID_COMPLEMENTARY_MERGE: When both legacy and vector contain complementary supported evidence, both are merged and used', async () => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';

      const binding = {
        bindingId: 'b_comp_merge',
        requestedField: 'careerOutcome',
        entity: { canonical: 'Teknologi Informasi', family: 'program' }
      };

      const legacyCand = {
        source_record_id: 'uuid-legacy-1',
        source_file: 'kurikulum_ti.pdf',
        source_record_index: 3,
        program: 'TI',
        chunk: 'Profil lulusan Teknologi Informasi ITB STIKOM Bali meliputi Software Engineer dan Mobile Developer.'
      };

      const vectorCand = {
        source_record_id: 'uuid-vector-2',
        source_file: 'ISIAN WEBSITE (1).pdf',
        source_record_index: 44,
        program: 'TI',
        category: 'PROSPEK_KERJA',
        doc_category: 'PRODI_PROFILE',
        chunk: 'Profil lulusan dan prospek kerja S1 Teknologi Informasi STIKOM Bali dipersiapkan menjadi IT Security Specialist dan Network Administrator.',
        similarity: 0.82
      };

      const merged = mergeAndDeduplicateCandidates([legacyCand], [vectorCand], binding, []);
      expect(merged.length).toBe(2);

      const evalRes = evaluateBinding(binding, merged, {}, { evidenceOpportunityComplete: true });
      expect(evalRes.status).toBe(EVALUATION_STATUS.SUPPORTED);
      expect(evalRes.supportedFacts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('5. End-to-End Conversational Boundary & Gate Invariance', () => {
    beforeEach(() => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';
      process.env.VECTOR_CANARY_SAMPLE_RATE = '1.0';
    });

    test('GREETING_BYPASSES_HYBRID: "Hallo" yields conversational greeting without invoking hybrid retrieval', async () => {
      const res = await querySemanticRag('Hallo', { skipCache: true });
      expect(res.source).toBe('semantic-rag-small-talk');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(res.debug?.isFactualRetrievalRequired).toBe(false);
      expect(res.answer).toMatch(/Halo|Tiko|asisten/i);
    });

    test('CASUAL_BYPASSES_HYBRID: "Apa khabar" yields conversational greeting, NOT NO_DATA, without hybrid retrieval', async () => {
      const res = await querySemanticRag('Apa khabar', { skipCache: true });
      expect(res.source).toBe('semantic-rag-small-talk');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(res.debug?.isFactualRetrievalRequired).toBe(false);
      expect(res.answer).toMatch(/baik/i);
      expect(res.answer).not.toMatch(/belum menemukan data/i);
    });

    test('GENERIC_PMB_NO_RANDOM_EVIDENCE: "Saya ingin bertanya tentang pmb" yields PMB overview without invoking hybrid retrieval or random fragments', async () => {
      const res = await querySemanticRag('Saya ingin bertanya tentang pmb', { skipCache: true });
      expect(res.source).toBe('semantic-rag-pmb-info');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(res.debug?.isFactualRetrievalRequired).toBe(false);
      expect(res.answer).toMatch(/PMB|pendaftaran|STIKOM/i);
      expect(res.answer).not.toMatch(/HIMATOGRAPHY|fotografi/i);
    });

    test('PMB_FOLLOWUP_PASS: "Apa itu si?" after PMB context MUST NOT resolve to Sistem Informasi and executes HYBRID_RETRIEVAL_EXECUTED=NO', async () => {
      const sessionState = { lastDomain: 'pmb', lastEntity: 'pmb' };
      const res = await querySemanticRag('Apa itu si?', { skipCache: true, conversationState: sessionState });
      console.log('JEST PMB_FOLLOWUP SOURCE:', res.source, 'ROUTESTAGE:', res.debug?.routeStage);
      expect(res.source).not.toBe('semantic-rag-program-definition');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(res.debug?.isFactualRetrievalRequired).toBe(false);
      expect(res.answer).not.toMatch(/Sistem Informasi/i);
    });

    test('EXPLICIT_SISTEM_INFORMASI_PASS: "Apa itu sistem informasi?" invokes hybrid retrieval and produces grounded definition', async () => {
      const res = await querySemanticRag('Apa itu sistem informasi?', { skipCache: true });
      expect(res.source).toBe('semantic-rag-program-definition');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('YES');
      expect(res.debug?.isFactualRetrievalRequired).toBe(true);
      expect(res.answer).toMatch(/Sistem Informasi/i);
      expect(res.answer).not.toMatch(/belum menemukan data/i);
    });

    test('VALID_SI_ABBREVIATION_PASS: "Apa itu SI?" with explicit prior Sistem Informasi context resolves to Sistem Informasi and uses hybrid', async () => {
      const priorState = { lastDomain: 'program', lastEntity: 'Sistem Informasi', activeProgram: 'Sistem Informasi' };
      const res = await querySemanticRag('Apa itu SI?', { skipCache: true, conversationState: priorState });
      expect(res.source).toBe('semantic-rag-program-definition');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('YES');
      expect(res.debug?.isFactualRetrievalRequired).toBe(true);
      expect(res.answer).toMatch(/Sistem Informasi/i);
    });

    test('VALID_SI_ABBREVIATION_PASS: "SI itu belajar apa?" with independently validated SI program semantics resolves to Sistem Informasi and uses hybrid', async () => {
      const res = await querySemanticRag('SI itu belajar apa?', { skipCache: true });
      expect(res.source).toBe('semantic-rag-program-curriculum');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('YES');
      expect(res.debug?.isFactualRetrievalRequired).toBe(true);
      expect(res.answer).toMatch(/Sistem Informasi|materi|kuliah/i);
    });
  });

  describe('6. Evaluator Governance: False Accept Count = 0 & Trace 3 Vector Rank #1', () => {
    test('Trace 1: PMB Generic false accept count = 0', () => {
      const binding = {
        bindingId: 'bind_pmb_root',
        requestedField: 'pmbInfo',
        entity: { canonical: 'INSTITUTION_ROOT', family: 'institution' }
      };

      const noisyCand = {
        source_record_id: 'rec_himatography',
        source_file: 'HIMATOGRAPHY.pdf',
        category: 'ORMAWA',
        chunk: 'Himatography adalah Unit Kegiatan Mahasiswa di bidang fotografi dan multimedia.'
      };

      const ev = buildCorpusEvidenceFromCandidate(noisyCand, binding);
      const res = evaluateBinding(binding, [ev], {}, { evidenceOpportunityComplete: true });

      const isSupported = res.status === EVALUATION_STATUS.SUPPORTED || res.status === EVALUATION_STATUS.PARTIALLY_SUPPORTED;
      expect(isSupported).toBe(false);
    });

    test('Trace 3: False accept count = 0 & rank #1 vector candidate is SUPPORTED', () => {
      const binding = {
        bindingId: 'bind_0_0',
        requestedField: 'programRecommendation',
        entity: { canonical: 'INSTITUTION_ROOT', family: 'institution' }
      };

      // Rank #1 vector candidate in Trace 3 (ISIAN WEBSITE 1.pdf for TI careers/competency)
      const rank1VectorCandidate = {
        source_record_id: '96693416-2f1e-4db6-a457-307c08936404',
        source_file: 'ISIAN WEBSITE (1).pdf',
        category: 'KURIKULUM',
        doc_category: 'PRODI_PROFILE',
        program: 'TI',
        chunk: 'Profil Program Studi\nProgram Studi Teknologi Informasi di ITB STIKOM Bali berfokus pada pengembangan keahlian di bidang IT Security, Integrator Sistem, dan Technopreneurship. Visi prodi ini adalah menjadi program studi unggulan.',
        similarity: 0.6128
      };

      const clubNoise = {
        source_record_id: 'rec_club_noise',
        source_file: 'UKM STIKOM BALI.docx',
        category: 'ORMAWA',
        chunk: 'Unit Kegiatan Mahasiswa Modern Dance STIKOM Bali adalah wadah bagi mahasiswa yang menyukai seni tari modern dan koreografi panggung.'
      };

      const adminNoise = {
        source_record_id: 'rec_admin_noise',
        source_file: 'PEDOMAN TUGAS AKHIR.pdf',
        category: 'PEDOMAN',
        doc_category: 'PEDOMAN',
        chunk: 'Pedoman penyusunan proposal tugas akhir dan skripsi mahasiswa ITB STIKOM Bali semester genap.'
      };

      const cands = [rank1VectorCandidate, clubNoise, adminNoise];
      let falseAcceptCount = 0;
      let rank1Supported = false;

      for (let i = 0; i < cands.length; i++) {
        const cand = cands[i];
        const ev = buildCorpusEvidenceFromCandidate(cand, binding);
        const res = evaluateBinding(binding, [ev], {}, { evidenceOpportunityComplete: true });
        const isSupported = res.status === EVALUATION_STATUS.SUPPORTED || res.status === EVALUATION_STATUS.PARTIALLY_SUPPORTED;

        if (i === 0) {
          rank1Supported = isSupported;
        } else {
          if (isSupported) falseAcceptCount++;
        }
      }

      expect(rank1Supported).toBe(true);
      expect(falseAcceptCount).toBe(0);
      expect(rank1VectorCandidate.source_record_id).toBe('96693416-2f1e-4db6-a457-307c08936404');
    });
  });

  describe('7. Canary Traffic Governor Contracts', () => {
    beforeEach(() => {
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';
      delete process.env.VECTOR_RETRIEVAL_ENABLED;
      delete process.env.VECTOR_CANARY_SAMPLE_RATE;
    });

    test('CONTRACT 1: VECTOR_RETRIEVAL_ENABLED=false always blocks hybrid (0% hybrid failsafe)', () => {
      process.env.VECTOR_RETRIEVAL_ENABLED = 'false';
      process.env.VECTOR_RETRIEVAL_MODE = 'hybrid';
      process.env.VECTOR_CANARY_SAMPLE_RATE = '1.0';

      const res = isHybridRetrievalEnabled({ chatId: '628123456789' });
      expect(res).toBe(false);

      const resNoChat = isHybridRetrievalEnabled();
      expect(resNoChat).toBe(false);
    });

    test('CONTRACT 2: Sample rate 0 => 0% hybrid', () => {
      process.env.VECTOR_CANARY_SAMPLE_RATE = '0';
      const res = isHybridRetrievalEnabled({ chatId: '628123456789' });
      expect(res).toBe(false);

      const res2 = isHybridRetrievalEnabled({ sampleRate: 0, chatId: '628999999999' });
      expect(res2).toBe(false);
    });

    test('CONTRACT 3: Sample rate 1 => 100% hybrid for eligible requests', () => {
      process.env.VECTOR_CANARY_SAMPLE_RATE = '1';
      const res = isHybridRetrievalEnabled({ chatId: '628123456789' });
      expect(res).toBe(true);

      const res2 = isHybridRetrievalEnabled({ sampleRate: 1, chatId: '628999999999' });
      expect(res2).toBe(true);
    });

    test('CONTRACT 4: Deterministic stability - same chatId always yields identical bucket and decision', () => {
      const chatId = '628198765432@s.whatsapp.net';
      const bucket1 = computeCanaryBucket(chatId, 1000);
      const bucket2 = computeCanaryBucket(chatId, 1000);
      const bucket3 = computeCanaryBucket(chatId, 1000);

      expect(bucket1).toBeGreaterThanOrEqual(0);
      expect(bucket1).toBeLessThan(1000);
      expect(bucket1).toBe(bucket2);
      expect(bucket2).toBe(bucket3);

      const decision1 = isHybridRetrievalEnabled({ chatId });
      const decision2 = isHybridRetrievalEnabled({ chatId });
      expect(decision1).toBe(decision2);
    });

    test('CONTRACT 5: Different chatIds distribute across different buckets in [0, 999]', () => {
      const chatA = '628111111111@s.whatsapp.net';
      const chatB = '628222222222@s.whatsapp.net';
      const chatC = '628333333333@s.whatsapp.net';

      const bucketA = computeCanaryBucket(chatA, 1000);
      const bucketB = computeCanaryBucket(chatB, 1000);
      const bucketC = computeCanaryBucket(chatC, 1000);

      const uniqueBuckets = new Set([bucketA, bucketB, bucketC]);
      expect(uniqueBuckets.size).toBeGreaterThan(1);
    });

    test('CONTRACT 6: Sample rate 0.1 yields ~10% proportion over large population (long-run allocation)', () => {
      const populationSize = 5000;
      let selectedCount = 0;
      const buckets = new Array(1000).fill(0);

      for (let i = 0; i < populationSize; i++) {
        const testId = `user_phone_628555${100000 + i}`;
        const b = computeCanaryBucket(testId, 1000);
        buckets[b]++;
        if (b < 100) {
          selectedCount++;
        }
      }

      const fraction = selectedCount / populationSize;
      // In a uniform distribution of 5,000 samples, 10% expected (0.10) with standard error ~0.0042
      // 3-sigma tolerance: [0.085, 0.115]
      expect(fraction).toBeGreaterThanOrEqual(0.085);
      expect(fraction).toBeLessThanOrEqual(0.115);
    });

    test('CONTRACT 7: Non-canary request strictly stays on legacy retrieval', async () => {
      // Find a chatId guaranteed to fall into bucket >= 100 (non-canary)
      let nonCanaryChatId = null;
      for (let i = 1; i <= 200; i++) {
        const candidate = `6287700000${i}`;
        if (computeCanaryBucket(candidate, 1000) >= 100) {
          nonCanaryChatId = candidate;
          break;
        }
      }
      expect(nonCanaryChatId).toBeTruthy();

      const options = { chatId: nonCanaryChatId, sampleRate: 0.1 };
      const enabled = isHybridRetrievalEnabled(options);
      expect(enabled).toBe(false);
      expect(options.__canaryTelemetry).toBeDefined();
      expect(options.__canaryTelemetry.canary_selected).toBe(false);
      expect(options.__canaryTelemetry.retrieval_channel).toBe('legacy');

      // Verify full RAG query execution strictly maintains legacy channel
      const res = await querySemanticRag('Apa itu sistem informasi?', {
        skipCache: true,
        chatId: nonCanaryChatId,
        sampleRate: 0.1
      });
      expect(res.debug?.canary_selected).toBe(false);
      expect(res.debug?.retrieval_channel).toBe('legacy');
    });

    test('CONTRACT 8: Canary request runs hybrid retrieval when eligible', async () => {
      // Find a chatId guaranteed to fall into bucket 0..99 (canary)
      let canaryChatId = null;
      for (let i = 1; i <= 200; i++) {
        const candidate = `6287700000${i}`;
        if (computeCanaryBucket(candidate, 1000) < 100) {
          canaryChatId = candidate;
          break;
        }
      }
      expect(canaryChatId).toBeTruthy();

      const options = { chatId: canaryChatId, sampleRate: 0.1 };
      const enabled = isHybridRetrievalEnabled(options);
      expect(enabled).toBe(true);
      expect(options.__canaryTelemetry).toBeDefined();
      expect(options.__canaryTelemetry.canary_selected).toBe(true);
      expect(options.__canaryTelemetry.retrieval_channel).toBe('hybrid');

      // Verify full RAG query execution executes hybrid channel
      const res = await querySemanticRag('Apa itu sistem informasi?', {
        skipCache: true,
        chatId: canaryChatId,
        sampleRate: 0.1
      });
      expect(res.debug?.canary_selected).toBe(true);
      expect(res.debug?.retrieval_channel).toBe('hybrid');
      expect(res.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('YES');
    });

    test('CONTRACT 9: Telemetry contains explicit fields without raw PII', () => {
      const options = { chatId: '081234567890_sensitive_pii', sampleRate: 0.1 };
      isHybridRetrievalEnabled(options);

      const tel = options.__canaryTelemetry;
      expect(tel).toBeDefined();
      expect(tel.canary_enabled).toBe(true);
      expect(tel.canary_sample_rate).toBe(0.1);
      expect(typeof tel.canary_bucket).toBe('number');
      expect(typeof tel.canary_selected).toBe('boolean');
      expect(['legacy', 'hybrid']).toContain(tel.retrieval_channel);

      // Verify no raw PII in telemetry keys or values
      const telemetryStr = JSON.stringify(tel);
      expect(telemetryStr).not.toContain('081234567890');
      expect(telemetryStr).not.toContain('sensitive_pii');
    });

    test('CONTRACT 10: Shadow sampling rate is strictly independent of canary rate', () => {
      delete process.env.VECTOR_CANARY_SAMPLE_RATE;
      process.env.VECTOR_SHADOW_SAMPLE_RATE = '0.75';

      // getCanarySampleRate must remain its safe default 0.1
      expect(getCanarySampleRate()).toBe(0.1);

      process.env.VECTOR_CANARY_SAMPLE_RATE = '0.05';
      expect(getCanarySampleRate()).toBe(0.05);
      expect(parseFloat(process.env.VECTOR_SHADOW_SAMPLE_RATE)).toBe(0.75);
    });

    test('CONTRACT 11: Conversational bypass queries (greeting, small-talk, PMB overview) bypass retrieval regardless of canary status', async () => {
      // Find canary-selected chatId
      let canaryChatId = null;
      for (let i = 1; i <= 200; i++) {
        const candidate = `6287700000${i}`;
        if (computeCanaryBucket(candidate, 1000) < 100) {
          canaryChatId = candidate;
          break;
        }
      }

      const resGreeting = await querySemanticRag('Hallo', { skipCache: true, chatId: canaryChatId });
      expect(resGreeting.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(resGreeting.debug?.isFactualRetrievalRequired).toBe(false);

      const resCasual = await querySemanticRag('Apa khabar', { skipCache: true, chatId: canaryChatId });
      expect(resCasual.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(resCasual.debug?.isFactualRetrievalRequired).toBe(false);

      const resPmb = await querySemanticRag('Saya ingin bertanya tentang pmb', { skipCache: true, chatId: canaryChatId });
      expect(resPmb.debug?.HYBRID_RETRIEVAL_EXECUTED).toBe('NO');
      expect(resPmb.debug?.isFactualRetrievalRequired).toBe(false);
    });

    test('CONTRACT 12: Provider level verification - evidenceProviderRegistry executes hybrid pre-fetch ONLY for canary-selected identity', async () => {
      const { createRetrievalPlan } = require('../src/engine/bindingRetrievalPlanner');
      const frame = resolveEffectiveSemanticFrame('Apa itu sistem informasi?');
      const plan = createRetrievalPlan(frame);

      // 1. Canary selected
      let canaryChatId = null;
      for (let i = 1; i <= 200; i++) {
        const candidate = `6287700000${i}`;
        if (computeCanaryBucket(candidate, 1000) < 100) {
          canaryChatId = candidate;
          break;
        }
      }

      const canaryExec = await defaultRegistry.executePlan(plan, {
        question: 'Apa itu sistem informasi?',
        chatId: canaryChatId,
        sampleRate: 0.1,
        isFactualRetrievalRequired: true
      });
      // Canary selected -> vectorCandidatesByBinding pre-fetched
      expect(canaryExec.vectorCandidatesByBinding).not.toBeNull();

      // 2. Non-canary selected
      let nonCanaryChatId = null;
      for (let i = 1; i <= 200; i++) {
        const candidate = `6287700000${i}`;
        if (computeCanaryBucket(candidate, 1000) >= 100) {
          nonCanaryChatId = candidate;
          break;
        }
      }

      const nonCanaryExec = await defaultRegistry.executePlan(plan, {
        question: 'Apa itu sistem informasi?',
        chatId: nonCanaryChatId,
        sampleRate: 0.1,
        isFactualRetrievalRequired: true
      });
      // Non-canary selected -> vectorCandidatesByBinding remains null, pure legacy
      expect(nonCanaryExec.vectorCandidatesByBinding).toBeNull();

      // 3. Master flag disabled (VECTOR_RETRIEVAL_ENABLED=false) with canary chatId
      process.env.VECTOR_RETRIEVAL_ENABLED = 'false';
      const disabledExec = await defaultRegistry.executePlan(plan, {
        question: 'Apa itu sistem informasi?',
        chatId: canaryChatId,
        sampleRate: 0.1,
        isFactualRetrievalRequired: true
      });
      expect(disabledExec.vectorCandidatesByBinding).toBeNull();
      delete process.env.VECTOR_RETRIEVAL_ENABLED;
    });

    test('CONTRACT 13: Conversation continuity - multi-turn conversation maintains identical canary bucket and channel without flip-flop across turns', () => {
      const chatId = '628123456789@s.whatsapp.net';
      const initialBucket = computeCanaryBucket(chatId, 1000);
      const initialDecision = isHybridRetrievalEnabled({ chatId, sampleRate: 0.1 });

      for (let turn = 1; turn <= 10; turn++) {
        // Ephemeral trace changes per turn, but persistent chatId remains identical
        const turnContext = {
          chatId,
          traceId: `trace_turn_${turn}_${Date.now()}_${Math.random()}`,
          turnNumber: turn,
          sampleRate: 0.1
        };
        const turnBucket = computeCanaryBucket(resolveConversationIdentifier(turnContext), 1000);
        const turnDecision = isHybridRetrievalEnabled(turnContext);

        expect(turnBucket).toBe(initialBucket);
        expect(turnDecision).toBe(initialDecision);
      }
    });

    test('CONTRACT 14: Group chat vs Private chat identity stability - both formats stably hash to fixed buckets without flip-flop', () => {
      const privateJid = '628123456789@s.whatsapp.net';
      const groupJid = '120363023456789@g.us';

      const privBucket1 = computeCanaryBucket(privateJid, 1000);
      const privBucket2 = computeCanaryBucket(privateJid, 1000);
      expect(privBucket1).toBe(privBucket2);

      const groupBucket1 = computeCanaryBucket(groupJid, 1000);
      const groupBucket2 = computeCanaryBucket(groupJid, 1000);
      expect(groupBucket1).toBe(groupBucket2);

      expect(privBucket1).toBeGreaterThanOrEqual(0);
      expect(privBucket1).toBeLessThan(1000);
      expect(groupBucket1).toBeGreaterThanOrEqual(0);
      expect(groupBucket1).toBeLessThan(1000);
    });

    test('CONTRACT 15: Missing conversation identity strictly routes to legacy - no random allocation, no hybrid forcing', () => {
      // Ephemeral trace only without any persistent conversation identity
      const contextWithoutChatId = {
        traceId: 'trace_ephemeral_12345',
        requestId: 'req_xyz_999',
        sampleRate: 0.1
      };

      const id = resolveConversationIdentifier(contextWithoutChatId);
      expect(id).toBeNull();

      const isHybrid = isHybridRetrievalEnabled(contextWithoutChatId);
      expect(isHybrid).toBe(false);
      expect(contextWithoutChatId.__canaryTelemetry.canary_selected).toBe(false);
      expect(contextWithoutChatId.__canaryTelemetry.retrieval_channel).toBe('legacy');
      expect(contextWithoutChatId.__canaryTelemetry.reason).toBe('missing_conversation_identity_failsafe');
    });
  });
});
