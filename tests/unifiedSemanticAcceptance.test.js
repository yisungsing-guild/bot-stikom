'use strict';

/**
 * tests/unifiedSemanticAcceptance.test.js
 *
 * Targeted Acceptance Test Suite: Tiko V2 Semantic Understanding & Real-Corpus Retrieval.
 * 100% Offline: Uses actual local canonical corpus (829 chunks) and mock AI client ($0 API cost).
 *
 * Covers 17 Targeted Acceptance Scenarios:
 * 1. S1 Sistem Informasi tuition per semester (Exact canonical evidence: Rp 6.500.000).
 * 2. Slang, informal language, abbreviations, and typos ("ongkos per smt prodi SI").
 * 3. Comparative inquiry between two academic programs in a single turn (SI vs TI).
 * 4. Academic program and degree award correctness (S1 Bisnis Digital -> S.Bns).
 * 5. Double Degree with partner universities/countries (HELP Malaysia BIT & DNUI China).
 * 6. PMB scholarship and wave discounts (Gelombang I: Rp 250.000 registration, Rp 2.000.000 DPP).
 * 7. Unsupported/non-corpus terminology (SKSS -> Safe fallback).
 * 8. Extracurriculars and Student Life (UKM Musik, DOS Dance from SK Ormawa 2026).
 * 9. Homonym collision protection ("hukum gravitasi Newton" -> OUT_OF_SCOPE).
 * 10. Multi-turn conversational follow-up ("kalau gelombang berikutnya bagaimana?").
 * 11. Multi-intent and multi-entity inquiry in one message (SI tuition + UKM Basket).
 * 12. Non-existent program (Kedokteran -> unoffered in ITB STIKOM Bali).
 * 13. Fail-closed document access quarantine (Analisis Jabatan Dir INBIS -> blocked).
 * 14. Unsupported fabricated claim rejection (invented tuition amount -> blocked).
 * 15. Polarity inversion contradiction rejection (prohibition violated -> blocked).
 * 16. Universal quantifier overclaim contradiction rejection (semua vs khusus -> blocked).
 * 17. Flag isolation: Feature flag OFF strictly preserves legacy pipeline.
 */

const {
  processUnifiedTurn,
  filterAllowedEvidence,
  verifyUnifiedClaimsAndFacts
} = require('../src/core/unifiedSemanticEngine');

const { retrieveCandidates } = require('../src/core/retrievalService');
const { ensureCanonicalCorpus } = require('../src/engine/pgvectorShadowProvider');
const { BudgetLedgerManager, MemoryPersistentAdapter } = require('../src/core/budgetLedger');
const orchestrator = require('../src/core/orchestrator');

describe('Tiko V2 Targeted Acceptance Suite (Real Corpus & Semantic Engine)', () => {
  let memAdapter;
  let localLedger;
  let canonicalCorpus;

  beforeAll(async () => {
    canonicalCorpus = await ensureCanonicalCorpus();
    expect(canonicalCorpus.length).toBeGreaterThanOrEqual(800);
  });

  beforeEach(() => {
    memAdapter = new MemoryPersistentAdapter();
    localLedger = new BudgetLedgerManager(memAdapter);
  });

  // =========================================================================
  // Case 1: Biaya S1 Sistem Informasi per Semester
  // =========================================================================
  test('Case 1: Pertanyaan biaya S1 Sistem Informasi per semester didukung korpus resmi Rp 6.500.000', async () => {
    const rawQuery = 'Berapa biaya kuliah per semester untuk S1 Sistem Informasi di ITB STIKOM Bali?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        // Call 1: Semantic Understanding
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'S1 Sistem Informasi', canonicalId: 'S1 Sistem Informasi', category: 'academic_program', confidence: 0.98, isUnmapped: false }],
            requestedAspects: [{ aspect: 'tuition_fee', customAspectDescription: 'biaya per semester', targetEntityCanonicalId: 'S1 Sistem Informasi' }],
            normalizedSearchQueries: ['rincian biaya pendidikan Sistem Informasi per semester reguler'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        // Call 2: Grounded Synthesis
        .mockImplementationOnce(async ({ messages }) => {
          return {
            finish_reason: 'stop',
            content: {
              evidenceArbitration: {
                status: 'FULLY_SUPPORTED',
                usedChunkIds: ['f2b9448a-4234-4778-afde-1bba50da4057'],
                unsupportedAspects: []
              },
              factualClaims: [{
                claimText: 'Biaya pendidikan per semester untuk S1 Sistem Informasi adalah Rp 6.500.000.',
                supportedByChunkId: 'f2b9448a-4234-4778-afde-1bba50da4057',
                evidenceQuote: '5. Biaya Pendidikan Per Semester 6.500.000'
              }],
              uncoveredAspects: [],
              naturalAnswer: 'Biaya pendidikan per semester untuk Program Studi S1 Sistem Informasi di ITB STIKOM Bali adalah Rp 6.500.000.'
            }
          };
        })
    };

    const result = await processUnifiedTurn('test_c1', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.understanding.speechAct).toBe('INQUIRE_FACT');
    expect(result.understanding.entities[0].canonicalId).toBe('S1 Sistem Informasi');
    expect(result.understanding.requestedAspects[0].aspect).toBe('tuition_fee');

    // Verify real retrieval was called with normalized query
    const retrieved = await retrieveCandidates({
      query: result.understanding.normalizedSearchQueries.join(' '),
      queryVariants: result.understanding.normalizedSearchQueries
    }, { topK: 5 });

    const siFeeChunk = retrieved.find(c => String(c.chunk || c.text).includes('6.500.000'));
    expect(siFeeChunk).toBeDefined();
    expect(siFeeChunk.sourceFile).toContain('rincian Biaya SI,TI dan BD');

    // Verify grounding
    expect(result.groundingVerification.isValid).toBe(true);
    expect(result.finalAnswer).toContain('6.500.000');
    expect(result.isLocalFallback).toBeUndefined();
  });

  // =========================================================================
  // Case 2: Biaya dengan Typo, Singkatan, dan Bahasa Informal
  // =========================================================================
  test('Case 2: Pertanyaan biaya dengan typo dan bahasa informal dinormalisasi dan menemukan korpus resmi', async () => {
    const rawQuery = 'kak mau nanya dong brapa ongkos per smt prodi SI reguler 2026?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'prodi SI', canonicalId: 'S1 Sistem Informasi', category: 'academic_program', confidence: 0.95, isUnmapped: false }],
            requestedAspects: [{ aspect: 'tuition_fee', customAspectDescription: 'biaya per semester', targetEntityCanonicalId: 'S1 Sistem Informasi' }],
            normalizedSearchQueries: ['rincian biaya pendidikan Sistem Informasi per semester'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['f2b9448a-4234-4778-afde-1bba50da4057'], unsupportedAspects: [] },
            factualClaims: [{
              claimText: 'Biaya per semester S1 Sistem Informasi adalah Rp 6.500.000.',
              supportedByChunkId: 'f2b9448a-4234-4778-afde-1bba50da4057',
              evidenceQuote: 'Biaya Pendidikan Per Semester 6.500.000'
            }],
            uncoveredAspects: [],
            naturalAnswer: 'Biaya kuliah per semester untuk program studi S1 Sistem Informasi adalah Rp 6.500.000.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c2', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.understanding.entities[0].canonicalId).toBe('S1 Sistem Informasi');
    expect(result.finalAnswer).toContain('6.500.000');
  });

  // =========================================================================
  // Case 3: Perbandingan Dua Program Studi dalam Satu Pesan
  // =========================================================================
  test('Case 3: Perbandingan dua program studi (SI vs TI) dalam satu pesan mengekstrak kedua entitas', async () => {
    const rawQuery = 'Apa bedanya S1 Sistem Informasi sama S1 Teknologi Informasi?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'COMPARE',
            isPureSocialGreeting: false,
            entities: [
              { raw: 'S1 Sistem Informasi', canonicalId: 'S1 Sistem Informasi', category: 'academic_program', confidence: 0.98, isUnmapped: false },
              { raw: 'S1 Teknologi Informasi', canonicalId: 'S1 Teknologi Informasi', category: 'academic_program', confidence: 0.98, isUnmapped: false }
            ],
            requestedAspects: [
              { aspect: 'curriculum', customAspectDescription: 'fokus kurikulum dan perbedaan bidang', targetEntityCanonicalId: 'S1 Sistem Informasi' }
            ],
            normalizedSearchQueries: ['profil kurikulum Sistem Informasi', 'profil kurikulum Teknologi Informasi'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CATALOG_OFFICIAL_REGISTRY'], unsupportedAspects: [] },
            factualClaims: [{
              claimText: 'S1 Sistem Informasi berfokus pada manajemen data dan bisnis TI, sedangkan S1 Teknologi Informasi berfokus pada infrastruktur teknologi.',
              supportedByChunkId: 'CATALOG_OFFICIAL_REGISTRY',
              evidenceQuote: 'S1 Sistem Informasi'
            }],
            uncoveredAspects: [],
            naturalAnswer: 'S1 Sistem Informasi berfokus pada integrasi proses bisnis dan sistem informasi, sedangkan S1 Teknologi Informasi lebih berfokus pada infrastruktur teknologi dan rekayasa perangkat lunak.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c3', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.understanding.speechAct).toBe('COMPARE');
    expect(result.understanding.entities).toHaveLength(2);
    expect(result.understanding.entities.map(e => e.canonicalId)).toEqual(['S1 Sistem Informasi', 'S1 Teknologi Informasi']);
  });

  // =========================================================================
  // Case 4: Program Studi dan Gelar Akademik yang Benar
  // =========================================================================
  test('Case 4: Gelar akademik resmi S1 Bisnis Digital adalah S.Bns dan menolak gelar keliru S.Kom', async () => {
    // 4a. Correct synthesis passes
    const validSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CATALOG_OFFICIAL_REGISTRY'], unsupportedAspects: [] },
      factualClaims: [{
        claimText: 'Lulusan S1 Bisnis Digital memperoleh gelar Sarjana Bisnis Digital (S.Bns).',
        supportedByChunkId: 'CATALOG_OFFICIAL_REGISTRY',
        evidenceQuote: 'S.Bns'
      }],
      uncoveredAspects: [],
      naturalAnswer: 'Lulusan Program Studi S1 Bisnis Digital di ITB STIKOM Bali memperoleh gelar Sarjana Bisnis Digital (S.Bns).'
    };

    const checkPass = verifyUnifiedClaimsAndFacts(validSynthesis, []);
    expect(checkPass.isValid).toBe(true);

    // 4b. Wrong synthesis claiming S.Kom for Bisnis Digital must be rejected
    const invalidSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CATALOG_OFFICIAL_REGISTRY'], unsupportedAspects: [] },
      factualClaims: [{
        claimText: 'Lulusan S1 Bisnis Digital memperoleh gelar Sarjana Komputer (S.Kom).',
        supportedByChunkId: 'CATALOG_OFFICIAL_REGISTRY',
        evidenceQuote: 'S.Kom'
      }],
      uncoveredAspects: [],
      naturalAnswer: 'Lulusan S1 Bisnis Digital bergelar S.Kom.'
    };

    const checkFail = verifyUnifiedClaimsAndFacts(invalidSynthesis, []);
    expect(checkFail.isValid).toBe(false);
    expect(checkFail.degreeMismatch).toBe(true);
  });

  // =========================================================================
  // Case 5: Double Degree dan Mitra Internasional (Malaysia & China)
  // =========================================================================
  test('Case 5: Double Degree menemukan mitra resmi HELP University Malaysia dan Dalian Neusoft China', async () => {
    const rawQuery = 'Apakah ada program Double Degree dengan universitas di Malaysia atau China?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'Double Degree', canonicalId: 'Double Degree', category: 'academic_program', confidence: 0.95, isUnmapped: false }],
            requestedAspects: [{ aspect: 'international_program', customAspectDescription: 'mitra double degree Malaysia dan China', targetEntityCanonicalId: 'Double Degree' }],
            normalizedSearchQueries: ['Double Degree HELP University Malaysia Dalian Neusoft'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['3011ea2e-7f21-4c6d-966d-c2aa2817a5c9'], unsupportedAspects: [] },
            factualClaims: [{
              claimText: 'Program Double Degree bermitra dengan HELP University Malaysia dan Dalian Neusoft University of Information China.',
              supportedByChunkId: '3011ea2e-7f21-4c6d-966d-c2aa2817a5c9',
              evidenceQuote: 'HELP University, Malaysia 2. Program Double Degree - Dalian Neusoft University of Information, China'
            }],
            uncoveredAspects: [],
            naturalAnswer: 'Ya, ITB STIKOM Bali memiliki program Double Degree bekerja sama dengan HELP University, Malaysia dan Dalian Neusoft University of Information, China.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c5', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.finalAnswer).toContain('HELP University, Malaysia');
    expect(result.finalAnswer).toContain('Dalian Neusoft');
    expect(result.groundingVerification.isValid).toBe(true);
  });

  // =========================================================================
  // Case 6: Beasiswa dan Potongan Gelombang PMB
  // =========================================================================
  test('Case 6: Potongan biaya pendaftaran dan beasiswa DPP Gelombang I diverifikasi dari korpus', async () => {
    const rawQuery = 'Berapa potongan pendaftaran dan beasiswa DPP kalau daftar Gelombang I?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'Gelombang I', canonicalId: 'PMB Gelombang I', category: 'general_topic', confidence: 0.92, isUnmapped: false }],
            requestedAspects: [{ aspect: 'tuition_fee', customAspectDescription: 'potongan pendaftaran dan DPP gelombang 1', targetEntityCanonicalId: 'general' }],
            normalizedSearchQueries: ['Potongan Biaya Pendaftaran Gelombang I', 'Registrasi pada Gelombang I'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['1694f683-a067-421a-bc4c-fa6d7465e651'], unsupportedAspects: [] },
            factualClaims: [
              {
                claimText: 'Potongan biaya pendaftaran pada Gelombang I adalah Rp 250.000.',
                supportedByChunkId: '1694f683-a067-421a-bc4c-fa6d7465e651',
                evidenceQuote: 'Rp. 250.000,- Jika Mendaftar pada Gelombang I'
              },
              {
                claimText: 'Beasiswa untuk Dana Pendidikan Pokok (DPP) pada Gelombang I adalah Rp 2.000.000.',
                supportedByChunkId: '02673de9-6ede-4140-a4b8-c5cc7a587c6f',
                evidenceQuote: 'Rp. 2.000.000,- Jika Registrasi pada Gelombang I'
              }
            ],
            uncoveredAspects: [],
            naturalAnswer: 'Untuk pendaftaran pada Gelombang I, terdapat potongan biaya pendaftaran sebesar Rp 250.000 dan beasiswa potongan DPP sebesar Rp 2.000.000.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c6', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.finalAnswer).toContain('250.000');
    expect(result.finalAnswer).toContain('2.000.000');
    expect(result.groundingVerification.isValid).toBe(true);
  });

  // =========================================================================
  // Case 7: Istilah tidak ada dalam korpus (SKSS)
  // =========================================================================
  test('Case 7: Pertanyaan istilah yang tidak memiliki evidence dalam korpus (SKSS) mengaktifkan safe fallback', async () => {
    const rawQuery = 'Bagaimana syarat pengajuan SKSS di STIKOM Bali?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'SKSS', canonicalId: 'SKSS', category: 'other', confidence: 0.5, isUnmapped: true }],
            requestedAspects: [{ aspect: 'other_aspect', customAspectDescription: 'syarat pengajuan SKSS', targetEntityCanonicalId: 'SKSS' }],
            normalizedSearchQueries: ['syarat pengajuan SKSS ITB STIKOM Bali'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
    };

    // Candidate evidence is empty for SKSS
    const result = await processUnifiedTurn('test_c7', rawQuery, {
      aiClient: mockAiClient,
      candidateEvidence: [],
      budgetLedger: localLedger
    });

    // When retrieved candidates have no valid public evidence for SKSS, local safe fallback is activated
    expect(result.isLocalFallback).toBe(true);
    expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
  });

  // =========================================================================
  // Case 8: UKM Seni & Musik dari SK Ormawa Resmi
  // =========================================================================
  test('Case 8: Pertanyaan UKM seni dan musik didukung korpus resmi SK Pembina Ormawa 2026', async () => {
    const rawQuery = 'Apakah ada UKM musik atau seni di ITB STIKOM Bali?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'UKM musik seni', canonicalId: 'UKM', category: 'organization', confidence: 0.95, isUnmapped: false }],
            requestedAspects: [{ aspect: 'extracurricular_profile', customAspectDescription: 'UKM bidang musik dan kesenian', targetEntityCanonicalId: 'UKM' }],
            normalizedSearchQueries: ['UKM MUSIK ITB STIKOM Bali', 'UKM DOS Dance of STIKOM Bali'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['SK_ORMAWA_CHUNK_1'], unsupportedAspects: [] },
            factualClaims: [{
              claimText: 'Di ITB STIKOM Bali terdapat UKM Musik dan UKM Dance of STIKOM Bali (DOS).',
              supportedByChunkId: '6fc1406d-ea65-4bae-970e-574a07b18384',
              evidenceQuote: 'Unit Kegiatan Mahasiswa Dance of STIKOM Bali (UKM DOS)'
            }],
            uncoveredAspects: [],
            naturalAnswer: 'Ya, di ITB STIKOM Bali terdapat kegiatan kemahasiswaan bidang seni seperti UKM Musik dan UKM DOS (Dance of STIKOM Bali).'
          }
        })
    };

    const result = await processUnifiedTurn('test_c8', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.finalAnswer).toContain('UKM Musik');
    expect(result.finalAnswer).toContain('DOS');
    expect(result.groundingVerification.isValid).toBe(true);
  });

  // =========================================================================
  // Case 9: Homonim Fisika "hukum gravitasi Newton"
  // =========================================================================
  test('Case 9: Homonim hukum fisika diklasifikasikan OUT_OF_SCOPE dan tidak disalahartikan sebagai prodi Hukum', async () => {
    const rawQuery = 'Jelaskan hukum gravitasi Newton dan rumusnya.';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'OUT_OF_SCOPE',
            isPureSocialGreeting: false,
            entities: [{ raw: 'hukum gravitasi Newton', canonicalId: 'physics_law_newton', category: 'general_topic', confidence: 0.99, isUnmapped: true }],
            requestedAspects: [],
            normalizedSearchQueries: [],
            requiresClarification: false,
            clarificationReason: 'Pertanyaan seputar fisika murni di luar ranah layanan informasi kampus'
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'UNSUPPORTED_IN_CORPUS', usedChunkIds: [], unsupportedAspects: ['general_physics'] },
            factualClaims: [],
            uncoveredAspects: ['physics'],
            naturalAnswer: 'Mohon maaf, Tiko hanya melayani pertanyaan seputar informasi kampus, program studi, biaya kuliah, dan PMB ITB STIKOM Bali.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c9', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.understanding.speechAct).toBe('OUT_OF_SCOPE');
    expect(result.finalAnswer).toContain('Mohon maaf');
    // Must NOT mention law school / program studi hukum
    expect(result.finalAnswer.toLowerCase()).not.toContain('program studi hukum');
  });

  // =========================================================================
  // Case 10: Multi-Turn Context Follow-Up ("kalau gelombang berikutnya?")
  // =========================================================================
  test('Case 10: Pertanyaan lanjutan menggunakan konteks turn sebelumnya untuk memahami gelombang berikutnya', async () => {
    const contextTurns = [
      {
        query: 'Berapa potongan pendaftaran di Gelombang I PMB?',
        answer: 'Potongan biaya pendaftaran untuk Gelombang I adalah Rp 250.000.'
      }
    ];

    const rawQuery = 'Kalau gelombang berikutnya bagaimana?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockImplementationOnce(async ({ messages }) => {
          const userPrompt = messages.find(m => m.role === 'user').content;
          // Verify context was passed into Call 1 prompt
          expect(userPrompt).toContain('Gelombang I');

          return {
            finish_reason: 'stop',
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [{ raw: 'gelombang berikutnya', canonicalId: 'PMB Gelombang II', category: 'general_topic', confidence: 0.95, isUnmapped: false }],
              requestedAspects: [{ aspect: 'tuition_fee', customAspectDescription: 'potongan pendaftaran gelombang 2', targetEntityCanonicalId: 'general' }],
              normalizedSearchQueries: ['Potongan Biaya Pendaftaran Gelombang II'],
              requiresClarification: false,
              clarificationReason: ''
            }
          };
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['1694f683-a067-421a-bc4c-fa6d7465e651'], unsupportedAspects: [] },
            factualClaims: [{
              claimText: 'Potongan biaya pendaftaran untuk Gelombang II adalah Rp 200.000.',
              supportedByChunkId: '1694f683-a067-421a-bc4c-fa6d7465e651',
              evidenceQuote: 'Rp. 200.000,- Jika Mendaftar pada Gelombang II'
            }],
            uncoveredAspects: [],
            naturalAnswer: 'Untuk gelombang berikutnya (Gelombang II), potongan biaya pendaftaran adalah sebesar Rp 200.000.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c10', rawQuery, {
      aiClient: mockAiClient,
      contextTurns,
      budgetLedger: localLedger
    });

    expect(result.finalAnswer).toContain('200.000');
    expect(result.finalAnswer).toContain('Gelombang II');
    expect(result.groundingVerification.isValid).toBe(true);
  });

  // =========================================================================
  // Case 11: Multi-Intent dan Multi-Entity dalam Satu Pesan
  // =========================================================================
  test('Case 11: Multi-intent dan multi-entity (biaya SI + UKM basket) terurai lengkap', async () => {
    const rawQuery = 'Berapa biaya pendaftaran S1 Sistem Informasi dan apakah ada UKM basket di STIKOM?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [
              { raw: 'S1 Sistem Informasi', canonicalId: 'S1 Sistem Informasi', category: 'academic_program', confidence: 0.98, isUnmapped: false },
              { raw: 'UKM basket', canonicalId: 'UKM Basket', category: 'organization', confidence: 0.95, isUnmapped: false }
            ],
            requestedAspects: [
              { aspect: 'tuition_fee', customAspectDescription: 'biaya pendaftaran SI', targetEntityCanonicalId: 'S1 Sistem Informasi' },
              { aspect: 'extracurricular_profile', customAspectDescription: 'ketersediaan UKM basket', targetEntityCanonicalId: 'UKM Basket' }
            ],
            normalizedSearchQueries: ['biaya pendaftaran Sistem Informasi', 'Pofile UKM Basket ITB Stikom Bali'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['f2b9448a-4234-4778-afde-1bba50da4057', 'e9f4a56a-1111-2222-3333-444455556666'], unsupportedAspects: [] },
            factualClaims: [
              {
                claimText: 'Biaya pendaftaran untuk S1 Sistem Informasi adalah Rp 500.000.',
                supportedByChunkId: 'f2b9448a-4234-4778-afde-1bba50da4057',
                evidenceQuote: '1. Pendaftaran 500.000 Pada Saat Daftar'
              },
              {
                claimText: 'ITB STIKOM Bali memiliki UKM Basket.',
                supportedByChunkId: 'd559644d-f5d4-458e-a8f2-7590d2d0263b',
                evidenceQuote: 'Unit Kegiatan Mahasiswa Basket ITB STIKOM Bali'
              }
            ],
            uncoveredAspects: [],
            naturalAnswer: 'Biaya pendaftaran untuk S1 Sistem Informasi adalah Rp 500.000, dan di ITB STIKOM Bali tersedia kegiatan kemahasiswaan UKM Basket.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c11', rawQuery, {
      aiClient: mockAiClient,
      budgetLedger: localLedger
    });

    expect(result.understanding.entities).toHaveLength(2);
    expect(result.understanding.requestedAspects).toHaveLength(2);
    expect(result.finalAnswer).toContain('500.000');
    expect(result.finalAnswer).toContain('UKM Basket');
    expect(result.groundingVerification.isValid).toBe(true);
  });

  // =========================================================================
  // Case 12: Pertanyaan Program Tidak Ditawarkan (Kedokteran)
  // =========================================================================
  test('Case 12: Pertanyaan jurusan tidak ada (Kedokteran) dijawab jujur tanpa mengarang rincian biaya', async () => {
    const rawQuery = 'Berapa biaya kuliah jurusan Kedokteran di ITB STIKOM Bali?';

    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [{ raw: 'Kedokteran', canonicalId: 'Kedokteran', category: 'academic_program', confidence: 0.99, isUnmapped: true }],
            requestedAspects: [{ aspect: 'tuition_fee', customAspectDescription: 'biaya jurusan kedokteran', targetEntityCanonicalId: 'Kedokteran' }],
            normalizedSearchQueries: ['jurusan kedokteran ITB STIKOM Bali'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          content: {
            evidenceArbitration: { status: 'UNSUPPORTED_IN_CORPUS', usedChunkIds: [], unsupportedAspects: ['kedokteran'] },
            factualClaims: [],
            uncoveredAspects: ['tuition_fee_kedokteran'],
            naturalAnswer: 'Mohon maaf, ITB STIKOM Bali saat ini tidak memiliki Program Studi Kedokteran. Program studi yang tersedia berfokus pada bidang teknologi dan bisnis digital.'
          }
        })
    };

    const result = await processUnifiedTurn('test_c12', rawQuery, {
      aiClient: mockAiClient,
      candidateEvidence: [],
      budgetLedger: localLedger
    });

    expect(result.finalAnswer).toContain('tidak memiliki Program Studi Kedokteran');
    expect(result.finalAnswer).not.toContain('Rp');
  });

  // =========================================================================
  // Case 13: Proteksi Dokumen Internal, Draft, Expired, dan Analisis Jabatan
  // =========================================================================
  test('Case 13: Dokumen internal, draft, expired, analisis jabatan, atau draf website dikarantina dan tidak boleh lolos filter', async () => {
    const internalCandidateChunks = [
      { id: 'c_int_1', sourceFile: 'Analisis Jabatan Dir KL-INBIS.xlsx', text: 'Standar gaji direktur dan uraian tugas internal', is_internal: true },
      { id: 'c_int_2', sourceFile: 'Draft Biaya 2027.docx', text: 'Draft biaya belum disahkan', is_draft: true },
      { id: 'c_int_3', sourceFile: 'Biaya Expired 2020.pdf', text: 'Tarif lama', status: 'EXPIRED' },
      { id: 'c_int_4', sourceFile: 'SSK-92951-internal.pdf', text: 'Surat tertutup akreditasi', access_classification: 'INTERNAL' },
      { id: 'c_int_5', sourceFile: 'ISIAN WEBSITE (1).pdf', text: 'Formulir draf konten website belum dipublikasi resmi' },
      { id: 'c_pub_1', sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', text: '5. Biaya Pendidikan Per Semester 6.500.000', status: 'ACTIVE', access_classification: 'PUBLIC' }
    ];

    const filtered = filterAllowedEvidence(internalCandidateChunks);

    // Exactly 1 public official chunk passes, all 5 internal/draft/expired/classified/unreleased are quarantined
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('c_pub_1');
    expect(filtered.map(c => c.id)).not.toContain('c_int_1');
    expect(filtered.map(c => c.id)).not.toContain('c_int_2');
    expect(filtered.map(c => c.id)).not.toContain('c_int_3');
    expect(filtered.map(c => c.id)).not.toContain('c_int_4');
    expect(filtered.map(c => c.id)).not.toContain('c_int_5');
  });

  // =========================================================================
  // Case 14: Verifikasi Penolakan Klaim Nominal yang Mengarang
  // =========================================================================
  test('Case 14: Server-Side Grounding menolak klaim nominal yang tidak terdapat pada kutipan evidence', () => {
    const allowedEvidence = [{
      id: 'f2b9448a-4234-4778-afde-1bba50da4057',
      text: '5. Biaya Pendidikan Per Semester 6.500.000 Menjelang Perwalian'
    }];

    // Synthesis tries to claim Rp 15.000.000, which is nowhere in the quote or chunk
    const fabricatedSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['f2b9448a-4234-4778-afde-1bba50da4057'], unsupportedAspects: [] },
      factualClaims: [{
        claimText: 'Biaya pendidikan per semester adalah Rp 15.000.000.',
        supportedByChunkId: 'f2b9448a-4234-4778-afde-1bba50da4057',
        evidenceQuote: '5. Biaya Pendidikan Per Semester 6.500.000'
      }],
      uncoveredAspects: [],
      naturalAnswer: 'Biaya pendidikan per semester adalah Rp 15.000.000.'
    };

    const verif = verifyUnifiedClaimsAndFacts(fabricatedSynthesis, allowedEvidence);
    expect(verif.isValid).toBe(false);
    expect(verif.ungroundedClaims[0].reason).toContain('NUMERICAL_CONTRADICTION');
  });

  // =========================================================================
  // Case 15: Verifikasi Pembalikan Polaritas (Larangan vs Pembolehan)
  // =========================================================================
  test('Case 15: Penolakan pembalikan polaritas jika evidence melarang tetapi klaim membolehkan/mewajibkan', () => {
    const allowedEvidence = [{
      id: 'c_reg_rule',
      text: 'Mahasiswa dilarang mengikuti perkuliahan tanpa melunasi biaya registrasi semester.'
    }];

    const invertedSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['c_reg_rule'], unsupportedAspects: [] },
      factualClaims: [{
        claimText: 'Mahasiswa bebas boleh mengikuti perkuliahan tanpa melunasi biaya registrasi.',
        supportedByChunkId: 'c_reg_rule',
        evidenceQuote: 'Mahasiswa dilarang mengikuti perkuliahan tanpa melunasi biaya registrasi'
      }],
      uncoveredAspects: [],
      naturalAnswer: 'Mahasiswa bebas mengikuti kuliah.'
    };

    const verif = verifyUnifiedClaimsAndFacts(invertedSynthesis, allowedEvidence);
    expect(verif.isValid).toBe(false);
    expect(verif.ungroundedClaims[0].reason).toBe('POLARITY_CONTRADICTION_PROHIBITION_VIOLATED');
  });

  // =========================================================================
  // Case 16: Verifikasi Overclaim Universal (Semua vs Sebagian/Khusus)
  // =========================================================================
  test('Case 16: Penolakan klaim universal (semua/seluruh) jika evidence membatasi (khusus/terbatas)', () => {
    const allowedEvidence = [{
      id: 'c_disc_spec',
      text: 'Potongan biaya pendaftaran hanya khusus diberikan kepada pendaftar Gelombang Khusus.'
    }];

    const universalOverclaimSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['c_disc_spec'], unsupportedAspects: [] },
      factualClaims: [{
        claimText: 'Semua seluruh pendaftar tanpa terkecuali mendapatkan potongan biaya pendaftaran.',
        supportedByChunkId: 'c_disc_spec',
        evidenceQuote: 'Potongan biaya pendaftaran hanya khusus diberikan kepada pendaftar Gelombang Khusus'
      }],
      uncoveredAspects: [],
      naturalAnswer: 'Semua pendaftar mendapatkan potongan.'
    };

    const verif = verifyUnifiedClaimsAndFacts(universalOverclaimSynthesis, allowedEvidence);
    expect(verif.isValid).toBe(false);
    expect(verif.ungroundedClaims[0].reason).toBe('QUANTIFIER_CONTRADICTION_UNIVERSAL_OVERCLAIM');
  });

  // =========================================================================
  // Case 17: Isolasi Feature Flag — Flag OFF Tetap Menggunakan Jalur Lama
  // =========================================================================
  test('Case 17: Saat FEATURE_UNIFIED_AI_SEMANTIC OFF, processTurn menjalankan jalur lama tanpa memanggil unified pipeline', async () => {
    delete process.env.FEATURE_UNIFIED_AI_SEMANTIC;

    // Call orchestrator.processTurn with a real query
    const res = await orchestrator.processTurn('chat_legacy_check', 'Halo');

    expect(res).toBeDefined();
    // Legacy result does NOT contain unified telemetry or unified schemas
    expect(res.understanding).toBeUndefined();
    expect(res.evidenceArbitration).toBeUndefined();
    // Final answer is produced cleanly by deterministic pipeline
    expect(typeof res.finalAnswer).toBe('string');
    expect(res.finalAnswer.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // Case 18: Targeted Source Governance Review — Provenance Sah vs Mirip Ditolak
  // =========================================================================
  test('Case 18: Sumber publik sah lolos filter dan dokumen bernama mirip tanpa provenance terbukti tetap ditolak', () => {
    // 18a. Proven institutional canonical documents MUST be allowed
    const provenCanonicalDocs = [
      { id: 'p1', sourceFile: 'CamScanner 12-02-2026 14.39 (1).pdf', text: 'BIAYA PENDIDIKAN MAHASISWA BARU PASCASARJANA' },
      { id: 'p2', sourceFile: 'SERTIFIKAT AKREDITASI - SISTEM INFORMASI (14 DES 2023 - 14 DES 2028) LAM INFOKOM.pdf', text: 'Akreditasi Baik Sekali' },
      { id: 'p3', sourceFile: 'SERTIFIKAT AKREDITASI BD (05 OKT 2022 - 05 OKT 2027).pdf', text: 'Akreditasi Program Studi Bisnis Digital' },
      { id: 'p4', sourceFile: 'CHATBOT - Double Degree.docx', text: 'Program Double Degree HELP University Malaysia' },
      { id: 'p5', sourceFile: 'Apa itu Student Exchange di ITB STIKOM Bali.docx', text: 'Program Student Exchange ke luar negeri' },
      { id: 'p6', sourceFile: 'QNA Bot - Hi-Think.docx', text: 'Panduan inkubator bisnis dan program startup' },
      { id: 'p7', sourceFile: 'SK PEMBINA ORMAWA 2026.pdf', text: 'Penetapan Pembina Organisasi Mahasiswa dan UKM' },
      { id: 'p8', sourceFile: 'Profil UKM DOS.docx', text: 'Unit Kegiatan Mahasiswa Dance of STIKOM Bali' },
      { id: 'p9', sourceFile: 'Pofile UKM Basket ITB Stikom Bali.docx', text: 'Unit Kegiatan Mahasiswa Basket' },
      { id: 'p10', sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', text: 'Biaya Pendidikan S1 SI TI BD' },
      { id: 'p11', sourceFile: 'Penjelasan Prodi dan Karier Masa Depan (1).xlsx', text: 'Profil lulusan dan kurikulum Sistem Informasi' },
      { id: 'p12', sourceFile: 'CATALOG_OFFICIAL_REGISTRY', text: 'Institutional registry catalog' }
    ];

    const provenFiltered = filterAllowedEvidence(provenCanonicalDocs);
    expect(provenFiltered).toHaveLength(provenCanonicalDocs.length);
    expect(provenFiltered.map(c => c.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12']);

    // 18b. Documents with similar keyword names but unproven / unreleased provenance MUST be rejected (quarantined)
    const unprovenSimilarDocs = [
      // Similar administrative CamScanner scans
      { id: 'u1', sourceFile: 'CamScanner-Nota-Dinas-Keuangan.pdf', text: 'Nota dinas scanning CamScanner internal' },
      { id: 'u2', sourceFile: 'CamScanner-Surat-Tugas-Administratif.pdf', text: 'Surat tugas CamScanner administratif' },
      { id: 'u3', sourceFile: 'CamScanner 10-01-2025 memo internal.pdf', text: 'Memo acak hasil CamScanner' },
      // Similar internal accreditation letters and submissions
      { id: 'u4', sourceFile: 'SSK-92951-internal-akreditasi.pdf', text: 'Surat konversi internal akreditasi' },
      { id: 'u5', sourceFile: 'Surat Pengantar Akreditasi Rahasia.pdf', text: 'Korespondensi BAN-PT tertutup' },
      { id: 'u6', sourceFile: 'Surat Internal Evaluasi Akreditasi BAN-PT.pdf', text: 'Evaluasi internal reakreditasi belum rilis' },
      // Similar unreleased double degree / student exchange drafts
      { id: 'u7', sourceFile: 'Draft Kerjasama Double Degree Belum TTD.docx', text: 'Draf MoU double degree unverified' },
      { id: 'u8', sourceFile: 'Student Exchange Internal Evaluation.docx', text: 'Evaluasi internal pertukaran mahasiswa' },
      // Similar unreleased startup / incubation developer notes
      { id: 'u9', sourceFile: 'Hi-Think Developer Notes & Budget.xlsx', text: 'Rincian anggaran pengembang internal' },
      // Pre-release website forms & drafts
      { id: 'u10', sourceFile: 'ISIAN WEBSITE (1).pdf', text: 'Draf isian formulir web belum rilis' },
      { id: 'u11', sourceFile: 'Draft ISIAN WEBSITE Prodi.pdf', text: 'Draf konten website prodi' },
      // Similar draft UKM profiles and internal student affairs notes
      { id: 'u12', sourceFile: 'Draft Profil UKM DOS.docx', text: 'Draf profil UKM belum divalidasi pembina' },
      { id: 'u13', sourceFile: 'Profil UKM Basket Draf Belum Final.docx', text: 'Draf materi profil UKM' },
      { id: 'u14', sourceFile: 'SK Pembina Ormawa Revisi Draf.pdf', text: 'Draf SK yang belum disahkan rektor' },
      { id: 'u15', sourceFile: 'UKM Evaluasi Anggaran Rahasia.docx', text: 'Catatan anggaran internal kemahasiswaan' }
    ];

    const unprovenFiltered = filterAllowedEvidence(unprovenSimilarDocs);
    expect(unprovenFiltered).toHaveLength(0);
  });

  // =========================================================================
  // Case 19: Allowlist Nama File Tidak Pernah Mengalahkan Status Akses / Masa Berlaku
  // =========================================================================
  test('Case 19: Allowlist nama file tidak pernah mengalahkan status akses (INTERNAL_RESTRICTED), status tata kelola (EXPIRED, SUPERSEDED), draf, atau masa berlaku', () => {
    const canonicalFilename = 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf';

    // 19a. Normal metadata must pass
    const normalCandidate = [{
      id: 'c_norm',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      status: 'ACTIVE'
    }];
    expect(filterAllowedEvidence(normalCandidate)).toHaveLength(1);

    // 19b. Marked is_internal: true MUST be rejected
    const internalCandidate = [{
      id: 'c_int',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      is_internal: true
    }];
    expect(filterAllowedEvidence(internalCandidate)).toHaveLength(0);

    // 19c. Marked is_draft: true MUST be rejected
    const draftCandidate = [{
      id: 'c_draft',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      is_draft: true
    }];
    expect(filterAllowedEvidence(draftCandidate)).toHaveLength(0);

    // 19d. Marked INTERNAL_RESTRICTED MUST be rejected
    const restrictedCandidate = [{
      id: 'c_restr',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      access_classification: 'INTERNAL_RESTRICTED'
    }];
    expect(filterAllowedEvidence(restrictedCandidate)).toHaveLength(0);

    // 19e. Marked EXPIRED MUST be rejected
    const expiredCandidate = [{
      id: 'c_exp',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      status: 'EXPIRED'
    }];
    expect(filterAllowedEvidence(expiredCandidate)).toHaveLength(0);

    // 19f. Marked SUPERSEDED MUST be rejected
    const supersededCandidate = [{
      id: 'c_sup',
      sourceFile: canonicalFilename,
      text: 'Biaya Pendidikan S1 SI TI BD 6.500.000',
      status: 'SUPERSEDED'
    }];
    expect(filterAllowedEvidence(supersededCandidate)).toHaveLength(0);

    // 19g. Other canonical sources with restricted or expired status MUST also be rejected
    const multiCanonicalBreaches = [
      { id: 'b1', sourceFile: 'CamScanner 12-02-2026 14.39 (1).pdf', text: 'Pascasarjana', access_classification: 'INTERNAL_RESTRICTED' },
      { id: 'b2', sourceFile: 'SK PEMBINA ORMAWA 2026.pdf', text: 'Pembina UKM', status: 'SUPERSEDED' },
      { id: 'b3', sourceFile: 'CHATBOT - Double Degree.docx', text: 'HELP University', validUntil: '2020-01-01' },
      { id: 'b4', sourceFile: 'Profil UKM DOS.docx', text: 'UKM DOS', validFrom: '2099-01-01' }
    ];
    expect(filterAllowedEvidence(multiCanonicalBreaches)).toHaveLength(0);
  });
});
