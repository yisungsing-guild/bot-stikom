'use strict';

/**
 * tests/unifiedSemanticEngine.test.js
 *
 * Targeted Unit Tests for Tiko V2 Semantic-First Understanding Engine.
 * Tests 100% offline using mock AI adapters ($0 OpenAI API consumption).
 *
 * Covers:
 * 1. Concurrency & initial row race conditions in Budget Ledger.
 * 2. Truly fail-closed document access control with UKM provenance inclusion and internal quarantine.
 * 3. Verbatim quote & registry factual claim grounding.
 * 4. Semantic-First pipeline:
 *    - Pure social greeting fast-path: exactly 1 call.
 *    - Informational query: Call 1 (Semantic Understanding) -> Semantic-Guided Retrieval -> Call 2 (Grounded Synthesis).
 *    - Strict upper bound: max 2 calls per turn.
 * 5. Orchestrator routing & flag isolation.
 */

const {
  TIKO_SEMANTIC_UNDERSTANDING_SCHEMA,
  TIKO_GROUNDED_SYNTHESIS_SCHEMA,
  filterAllowedEvidence,
  verifyUnifiedClaimsAndFacts,
  buildSafeLocalFallback,
  processUnifiedTurn
} = require('../src/core/unifiedSemanticEngine');

const {
  BudgetLedgerManager,
  MemoryPersistentAdapter,
  PrismaSettingAdapter,
  globalBudgetLedger,
  getMakassarDateYMD,
  calculateModelCostUSD
} = require('../src/core/budgetLedger');

const {
  computeBatchQueryEmbeddings,
  clearQueryEmbeddingCache,
  setCachedEmbedding,
  setBudgetLedger
} = require('../src/engine/pgvectorShadowProvider');

const { retrieveCandidates } = require('../src/core/retrievalService');
const orchestrator = require('../src/core/orchestrator');

describe('Semantic-First Unified Understanding Engine (Tiko V2)', () => {

  describe('1. Concurrency & Initial Row Creation in Budget Ledger', () => {
    test('enforces Asia/Makassar operational date boundary', () => {
      const testDateUTC = new Date('2026-10-22T16:30:00Z');
      const makassarYMD = getMakassarDateYMD(testDateUTC);
      expect(makassarYMD).toBe('2026-10-23');
    });

    test('serializes concurrent reservations when initial row does not exist yet', async () => {
      const memAdapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(memAdapter);
      const testDate = new Date('2026-10-22T02:00:00Z');

      // Ceiling allows exactly 2 reservations of $0.00035 ($0.00070 max ceiling)
      const maxBudgetUSD = 0.00070;

      // 5 concurrent workers firing simultaneously on brand new date
      const promises = [
        ledger.reserveBudget({ estimatedUSD: 0.00035, purpose: 'worker_1', maxBudgetUSD, now: testDate }),
        ledger.reserveBudget({ estimatedUSD: 0.00035, purpose: 'worker_2', maxBudgetUSD, now: testDate }),
        ledger.reserveBudget({ estimatedUSD: 0.00035, purpose: 'worker_3', maxBudgetUSD, now: testDate }),
        ledger.reserveBudget({ estimatedUSD: 0.00035, purpose: 'worker_4', maxBudgetUSD, now: testDate }),
        ledger.reserveBudget({ estimatedUSD: 0.00035, purpose: 'worker_5', maxBudgetUSD, now: testDate })
      ];

      const results = await Promise.all(promises);
      const allowedCount = results.filter(r => r.allowed).length;
      const rejectedCount = results.filter(r => !r.allowed && r.reason === 'DAILY_BUDGET_EXCEEDED').length;

      // Exactly 2 must be allowed, exactly 3 must be blocked
      expect(allowedCount).toBe(2);
      expect(rejectedCount).toBe(3);

      const finalState = await memAdapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(finalState.reservedUSD).toBeCloseTo(0.00070, 5);
      expect(finalState.spentUSD).toBe(0.0);
    });

    test('fails closed when persistent ledger is unavailable', async () => {
      const unconfiguredLedger = new BudgetLedgerManager(null);
      expect(unconfiguredLedger.isAvailable()).toBe(false);

      const mockAiClient = { chatCompletionsCreate: jest.fn() };
      const result = await processUnifiedTurn('test_chat_fail_closed', 'Berapa biaya?', {
        budgetLedger: unconfiguredLedger,
        aiClient: mockAiClient
      });

      expect(mockAiClient.chatCompletionsCreate).not.toHaveBeenCalled();
      expect(result.isLocalFallback).toBe(true);
      expect(result.fallbackReason).toBe('PERSISTENT_LEDGER_UNAVAILABLE');
    });

    test('PrismaSettingAdapter uses $queryRaw with pg_advisory_xact_lock and coordinates operations within single transaction', async () => {
      const mockTx = {
        $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
        setting: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ key: data.key, value: data.value })),
          update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ value: data.value }))
        }
      };

      const mockPrisma = {
        $transaction: jest.fn().mockImplementation(async (callback, options) => {
          expect(options).toEqual({ isolationLevel: 'ReadCommitted', timeout: 5000 });
          return await callback(mockTx);
        })
      };

      const adapter = new PrismaSettingAdapter(mockPrisma);
      const testKey = '2026-10-22';
      const result = await adapter.executeAtomic(testKey, async (ledger) => {
        ledger.reservedUSD += 0.00035;
        return { updatedLedger: ledger, result: { success: true, reserved: ledger.reservedUSD } };
      });

      expect(result).toEqual({ success: true, reserved: 0.00035 });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // Verify lock was requested via $queryRaw tagged template with pg_advisory_xact_lock
      expect(mockTx.$queryRaw).toHaveBeenCalledTimes(1);
      const rawQueryCall = mockTx.$queryRaw.mock.calls[0];
      const templateStrings = rawQueryCall[0];
      expect(templateStrings.join('')).toContain('SELECT pg_advisory_xact_lock(hashtext(');

      // Verify all operations were routed to the transaction instance
      expect(mockTx.setting.findUnique).toHaveBeenCalledWith({ where: { key: `BUDGET_LEDGER_${testKey}` } });
      expect(mockTx.setting.create).toHaveBeenCalled();
      expect(mockTx.setting.update).toHaveBeenCalled();
    });
  });

  describe('2. Fail-Closed Document Access & UKM Provenance', () => {
    test('allows provable official public sources (PMB, prodi, and public UKM) and quarantines internal/draft', () => {
      const candidates = [
        { id: 'CHUNK_FEE_PUB', sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf', text: 'Biaya S1 SI Rp 6.500.000', status: 'active' },
        { id: 'CHUNK_PRODI_PUB', sourceFile: 'docs/retrieval/knowledge_domains/program_studi_sistem_informasi.md', text: 'S1 Sistem Informasi terakreditasi Baik Sekali', status: 'active' },
        { id: 'CHUNK_UKM_PUB', sourceFile: 'Company profile UKM Tabuh.pdf', text: 'UKM Tabuh Bramara Gita melestarikan seni karawitan Bali.', status: 'active' },
        { id: 'CHUNK_INBIS_PUB', sourceFile: 'INBIS PROFILE 2026.pdf', text: 'Inkubator Bisnis memfasilitasi startup mahasiswa.', status: 'active' },
        // Quarantined candidates
        { id: 'CHUNK_IKU_INTERNAL', sourceFile: 'FORM IKU PTS 2024 LLDIKTI.pdf', text: 'Laporan capaian indikator kinerja utama', status: 'active' },
        { id: 'CHUNK_JABATAN_INTERNAL', sourceFile: 'Analisis Jabatan Dir KL-INBIS.xlsx', text: 'Tugas pokok dan fungsi manajerial internal', status: 'active' },
        { id: 'CHUNK_SUPERSEDED', sourceFile: 'media-Kalender-Akademik-2025_versi30-01-2025-scaled.jpg', text: 'Jadwal lama 2024', status: 'superseded' },
        { id: 'CHUNK_IMAGE_OCR', sourceFile: 'WhatsApp Image 2026-07-23 at 13.22.28.jpeg', text: 'Foto jadwal', status: 'active' }
      ];

      const allowed = filterAllowedEvidence(candidates);
      const allowedIds = allowed.map(c => c.id);

      // Public & student life allowed
      expect(allowedIds).toContain('CHUNK_FEE_PUB');
      expect(allowedIds).toContain('CHUNK_PRODI_PUB');
      expect(allowedIds).toContain('CHUNK_UKM_PUB');
      expect(allowedIds).toContain('CHUNK_INBIS_PUB');

      // Internal / unverified quarantined
      expect(allowedIds).not.toContain('CHUNK_IKU_INTERNAL');
      expect(allowedIds).not.toContain('CHUNK_JABATAN_INTERNAL');
      expect(allowedIds).not.toContain('CHUNK_SUPERSEDED');
      expect(allowedIds).not.toContain('CHUNK_IMAGE_OCR');
    });
  });

  describe('3. Verbatim Quote Grounding & Registry Degree Verification', () => {
    const allowedEvidence = [
      { id: 'CHUNK_FEE_SI', text: 'Biaya kuliah per semester S1 Sistem Informasi adalah Rp 6.500.000 untuk kelas reguler.' }
    ];

    test('accepts claims with matching verbatim quote and correct registry degrees', () => {
      const response = {
        factualClaims: [
          {
            claimText: 'Lulusan S1 Sistem Informasi bergelar S.Kom',
            targetEntityId: 's1_si',
            supportedByChunkId: 'REGISTRY_ACADEMIC_CATALOG',
            evidenceQuote: 'S1 Sistem Informasi - Sarjana Komputer (S.Kom)'
          },
          {
            claimText: 'Biaya semester S1 SI adalah Rp 6.500.000',
            targetEntityId: 's1_si',
            supportedByChunkId: 'CHUNK_FEE_SI',
            evidenceQuote: 'Biaya kuliah per semester S1 Sistem Informasi adalah Rp 6.500.000'
          }
        ],
        naturalAnswer: 'Biaya kuliah S1 Sistem Informasi adalah Rp 6.500.000 dan bergelar S.Kom.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, allowedEvidence);
      expect(result.isValid).toBe(true);
      expect(result.ungroundedClaims).toHaveLength(0);
      expect(result.degreeMismatch).toBe(false);
    });

    test('rejects claims with fabricated quotes not in evidence', () => {
      const response = {
        factualClaims: [
          {
            claimText: 'Ada garansi penempatan kerja langsung di NASA',
            targetEntityId: 's1_si',
            supportedByChunkId: 'CHUNK_FEE_SI',
            evidenceQuote: 'garansi penempatan kerja langsung di NASA'
          }
        ],
        naturalAnswer: 'S1 SI menjamin penempatan kerja di NASA.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, allowedEvidence);
      expect(result.isValid).toBe(false);
      expect(result.ungroundedClaims).toHaveLength(1);
    });

    test('rejects claims with polarity contradiction (evidence prohibits, but claim mandates or permits)', () => {
      const contradictionEvidence = [
        {
          id: 'CHUNK_RULES_PARKING',
          text: 'Dilarang membawa mobil bagi mahasiswa baru angkatan pertama di kampus Renon.'
        }
      ];

      const response = {
        factualClaims: [
          {
            claimText: 'Mahasiswa baru wajib membawa mobil ke kampus',
            targetEntityId: 'stikom_general',
            supportedByChunkId: 'CHUNK_RULES_PARKING',
            evidenceQuote: 'Dilarang membawa mobil bagi mahasiswa baru'
          }
        ],
        naturalAnswer: 'Mahasiswa baru wajib membawa mobil ke kampus.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, contradictionEvidence);
      expect(result.isValid).toBe(false);
      expect(result.ungroundedClaims).toHaveLength(1);
      expect(result.ungroundedClaims[0].reason).toBe('POLARITY_CONTRADICTION_PROHIBITION_VIOLATED');
    });

    test('rejects claims with numerical or currency discrepancy', () => {
      const feeEvidence = [
        {
          id: 'CHUNK_FEE_SI_5M',
          text: 'Biaya kuliah per semester S1 Sistem Informasi adalah Rp 5.000.000 untuk kelas reguler.'
        }
      ];

      const response = {
        factualClaims: [
          {
            claimText: 'Biaya kuliah S1 Sistem Informasi adalah Rp 6.500.000 per semester',
            targetEntityId: 's1_si',
            supportedByChunkId: 'CHUNK_FEE_SI_5M',
            evidenceQuote: 'Biaya kuliah per semester S1 Sistem Informasi adalah Rp 5.000.000'
          }
        ],
        naturalAnswer: 'Biaya S1 SI adalah Rp 6.500.000.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, feeEvidence);
      expect(result.isValid).toBe(false);
      expect(result.ungroundedClaims).toHaveLength(1);
      expect(result.ungroundedClaims[0].reason).toContain('NUMERICAL_CONTRADICTION');
    });

    test('rejects claims with temporal or academic year discrepancy', () => {
      const calendarEvidence = [
        {
          id: 'CHUNK_PMB_PERIOD',
          text: 'Pendaftaran mahasiswa baru dibuka untuk tahun ajaran 2024/2025.'
        }
      ];

      const response = {
        factualClaims: [
          {
            claimText: 'Pendaftaran mahasiswa baru dibuka untuk tahun ajaran 2026/2027',
            targetEntityId: 'stikom_general',
            supportedByChunkId: 'CHUNK_PMB_PERIOD',
            evidenceQuote: 'Pendaftaran mahasiswa baru dibuka untuk tahun ajaran 2024'
          }
        ],
        naturalAnswer: 'Pendaftaran dibuka tahun 2026.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, calendarEvidence);
      expect(result.isValid).toBe(false);
      expect(result.ungroundedClaims).toHaveLength(1);
      expect(result.ungroundedClaims[0].reason).toContain('TEMPORAL_CONTRADICTION');
    });

    test('rejects claims with quantifier overclaim (evidence says restricted/specific, claim asserts universal)', () => {
      const waiverEvidence = [
        {
          id: 'CHUNK_BEASISWA',
          text: 'Beasiswa potongan SPP khusus untuk mahasiswa berprestasi dan kurang mampu.'
        }
      ];

      const response = {
        factualClaims: [
          {
            claimText: 'Beasiswa potongan SPP diberikan kepada semua mahasiswa tanpa terkecuali',
            targetEntityId: 'stikom_general',
            supportedByChunkId: 'CHUNK_BEASISWA',
            evidenceQuote: 'Beasiswa potongan SPP khusus untuk mahasiswa berprestasi'
          }
        ],
        naturalAnswer: 'Semua mahasiswa dapat beasiswa.'
      };

      const result = verifyUnifiedClaimsAndFacts(response, waiverEvidence);
      expect(result.isValid).toBe(false);
      expect(result.ungroundedClaims).toHaveLength(1);
      expect(result.ungroundedClaims[0].reason).toBe('QUANTIFIER_CONTRADICTION_UNIVERSAL_OVERCLAIM');
    });
  });

  describe('4. Semantic-First Flow: Pure Greeting vs Informational Query', () => {
    let mockLedger;

    beforeEach(() => {
      mockLedger = new BudgetLedgerManager(new MemoryPersistentAdapter());
    });

    test('Pure social greeting uses fast-path: exactly 1 model call', async () => {
      const mockAiClient = {
        chatCompletionsCreate: jest.fn().mockResolvedValue({
          usage: { prompt_tokens: 250, completion_tokens: 60 },
          content: {
            speechAct: 'GENERAL_GREETING',
            isPureSocialGreeting: true,
            entities: [],
            requestedAspects: [],
            normalizedSearchQueries: [],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
      };

      const result = await processUnifiedTurn('chat_greeting_1', 'Halo min selamat pagi', {
        budgetLedger: mockLedger,
        aiClient: mockAiClient
      });

      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(1);
      expect(result.telemetry.modelCallCount).toBe(1);
      expect(result.finalAnswer).toContain('Selamat datang di Layanan Informasi ITB STIKOM Bali');
    });

    test('Informational query executes true Semantic-First: Call 1 (Semantic) -> Retrieval -> Call 2 (Synthesis)', async () => {
      const mockRetriever = jest.fn().mockResolvedValue({
        candidates: [
          { id: 'CHUNK_FEE_BD', access_classification: 'PUBLIC_OFFICIAL', text: 'Biaya kuliah S1 Bisnis Digital Rp 5.800.000 per semester.' }
        ]
      });

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          // Call 1: Semantic Understanding
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 300, completion_tokens: 90 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [
                { raw: 'Bisnis Digital', canonicalId: 's1_bd', category: 'academic_program', confidence: 0.98, isUnmapped: false }
              ],
              requestedAspects: [
                { aspect: 'tuition_fee', customAspectDescription: 'biaya semester', targetEntityCanonicalId: 's1_bd' }
              ],
              normalizedSearchQueries: ['biaya kuliah S1 Bisnis Digital', 'uang kuliah prodi bisnis digital'],
              requiresClarification: false,
              clarificationReason: ''
            }
          })
          // Call 2: Grounded Synthesis
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 750, completion_tokens: 150 },
            content: {
              evidenceArbitration: {
                status: 'FULLY_SUPPORTED',
                usedChunkIds: ['CHUNK_FEE_BD'],
                unsupportedAspects: []
              },
              factualClaims: [
                {
                  claimText: 'Biaya kuliah S1 Bisnis Digital Rp 5.800.000 per semester',
                  targetEntityId: 's1_bd',
                  supportedByChunkId: 'CHUNK_FEE_BD',
                  evidenceQuote: 'Biaya kuliah S1 Bisnis Digital Rp 5.800.000 per semester'
                }
              ],
              uncoveredAspects: [],
              naturalAnswer: 'Halo Kak! Biaya kuliah S1 Bisnis Digital adalah Rp 5.800.000 per semester.'
            }
          })
      };

      const result = await processUnifiedTurn('chat_info_1', 'Halo, mau tanya dong brp biaya semesteran bisnis digital?', {
        budgetLedger: mockLedger,
        aiClient: mockAiClient,
        retrieveCandidatesFn: mockRetriever
      });

      // Exactly 2 model calls
      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);
      expect(result.telemetry.modelCallCount).toBe(2);

      // Verify retrieval was guided by normalizedSearchQueries from Call 1
      expect(mockRetriever).toHaveBeenCalled();
      const retrieverCallArgs = mockRetriever.mock.calls[0][0];
      expect(retrieverCallArgs.queryVariants).toContain('biaya kuliah S1 Bisnis Digital');
      expect(retrieverCallArgs.targetEntities).toContain('s1_bd');

      expect(result.finalAnswer).toContain('Rp 5.800.000');
      expect(result.groundingVerification.isValid).toBe(true);
    });
  });

  describe('5. Orchestrator Routing & Flag Isolation', () => {
    test('routes through legacy Phase 1/Phase 2 pipeline by default (flag OFF)', async () => {
      delete process.env.FEATURE_UNIFIED_AI_SEMANTIC;
      const res = await orchestrator.processTurn('chat_legacy_check', 'Halo');
      expect(res).toBeDefined();
      expect(res.subQueryResults || res.finalAnswer).toBeDefined();
    });
  });

  describe('6. Budget Coverage & Fallback for Paid Embeddings', () => {
    beforeEach(() => {
      clearQueryEmbeddingCache();
    });

    afterEach(() => {
      setBudgetLedger(null);
      clearQueryEmbeddingCache();
    });

    test('cache hit returns embedding without budget reservation or OpenAI request', async () => {
      const mockVec = new Array(1536).fill(0.01);
      setCachedEmbedding('biaya s1 ti', mockVec);

      const reserveSpy = jest.spyOn(globalBudgetLedger, 'reserveBudget');
      const results = await computeBatchQueryEmbeddings(['biaya s1 ti']);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(mockVec);
      expect(reserveSpy).not.toHaveBeenCalled();
      reserveSpy.mockRestore();
    });

    test('unavailable ledger skips embedding API and safely falls back to lexical/null candidates without crashing', async () => {
      // Create ledger without adapter (isAvailable = false)
      const unavailableLedger = new BudgetLedgerManager(null);
      setBudgetLedger(unavailableLedger);

      const results = await computeBatchQueryEmbeddings(['uncached query text unavailable ledger']);

      expect(results).toHaveLength(1);
      expect(results[0]).toBeNull();
    });

    test('budget denial skips embedding API and safely falls back to lexical/null candidates without crashing', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);
      setBudgetLedger(testLedger);

      // Force reservation to fail (simulating daily budget ceiling reached)
      const reserveSpy = jest.spyOn(testLedger, 'reserveBudget').mockResolvedValue({
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        spentUSD: 0.05
      });

      const results = await computeBatchQueryEmbeddings(['uncached query novel text']);

      // Should return array with null for the uncached query, NOT throw error
      expect(results).toHaveLength(1);
      expect(results[0]).toBeNull();
      expect(reserveSpy).toHaveBeenCalledTimes(1);

      reserveSpy.mockRestore();
    });

    test('handles mixed batch: returns cached vector for cached text and null for uncached when budget denied', async () => {
      const mockVec = new Array(1536).fill(0.02);
      setCachedEmbedding('query_cached_1', mockVec);

      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);
      setBudgetLedger(testLedger);

      const reserveSpy = jest.spyOn(testLedger, 'reserveBudget').mockResolvedValue({
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        spentUSD: 0.05
      });

      const results = await computeBatchQueryEmbeddings(['query_cached_1', 'query_uncached_2']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(mockVec); // Cached returned
      expect(results[1]).toBeNull();       // Uncached null (not requested from API)
      expect(reserveSpy).toHaveBeenCalledTimes(1);

      reserveSpy.mockRestore();
    });

    test('retrievalService.retrieveCandidates safely falls back to BM25 candidates when embedding budget is denied', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);
      setBudgetLedger(testLedger);

      // Force reservation to fail
      const reserveSpy = jest.spyOn(testLedger, 'reserveBudget').mockResolvedValue({
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        spentUSD: 0.05
      });

      const result = await retrieveCandidates(
        { queryVariants: ['biaya kuliah sistem informasi'], targetEntities: ['s1_si'] },
        { enableHybridShadow: true, topK: 5 }
      );

      // Must succeed and return BM25 candidates without error
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toHaveProperty('text');
      expect(result[0]).toHaveProperty('score');

      reserveSpy.mockRestore();
    });

    test('legacy orchestrator path operates cleanly with lexical fallback when embedding budget is denied (flag OFF)', async () => {
      delete process.env.FEATURE_UNIFIED_AI_SEMANTIC;

      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);
      setBudgetLedger(testLedger);

      const reserveSpy = jest.spyOn(testLedger, 'reserveBudget').mockResolvedValue({
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        spentUSD: 0.05
      });

      const res = await orchestrator.processTurn('chat_legacy_budget_denied', 'Berapa biaya kuliah S1 SI?');
      expect(res).toBeDefined();
      expect(res.finalAnswer || res.subQueryResults).toBeDefined();

      reserveSpy.mockRestore();
    });
  });

  describe('7. API Compatibility for gpt-6-luna and Safe Fallback Verification', () => {
    test('Call 1 and Call 2 omit temperature for gpt-6-luna while preserving max_completion_tokens and schemas', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 210, completion_tokens: 75 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [{ raw: 'S1 SI', canonicalId: 's1_si' }],
              requestedAspects: [{ aspect: 'tuition_fee' }],
              normalizedSearchQueries: ['biaya kuliah S1 Sistem Informasi']
            }
          })
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 580, completion_tokens: 130 },
            content: {
              evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CHUNK_SI_FEE'], unsupportedAspects: [] },
              factualClaims: [
                { claimText: 'Biaya S1 SI Rp 6.200.000', supportedByChunkId: 'CHUNK_SI_FEE', evidenceQuote: 'Biaya S1 SI Rp 6.200.000' }
              ],
              uncoveredAspects: [],
              naturalAnswer: 'Halo Kak! Biaya kuliah S1 Sistem Informasi adalah Rp 6.200.000 per semester.'
            }
          })
      };

      const result = await processUnifiedTurn('chat_compat_01', 'Berapa biaya per semester S1 SI 2026?', {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna',
        candidateEvidence: [
          { id: 'CHUNK_SI_FEE', access_classification: 'PUBLIC_OFFICIAL', text: 'Biaya S1 SI Rp 6.200.000 per semester.' }
        ]
      });

      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);

      // Verify Call 1 payload parameters
      const call1Args = mockAiClient.chatCompletionsCreate.mock.calls[0][0];
      expect(call1Args.model).toBe('gpt-6-luna');
      expect(call1Args.temperature).toBeUndefined();
      expect(call1Args).not.toHaveProperty('temperature');
      expect(call1Args.max_completion_tokens).toBe(500);
      expect(call1Args.response_format).toEqual({
        type: 'json_schema',
        json_schema: TIKO_SEMANTIC_UNDERSTANDING_SCHEMA
      });

      // Verify Call 2 payload parameters
      const call2Args = mockAiClient.chatCompletionsCreate.mock.calls[1][0];
      expect(call2Args.model).toBe('gpt-6-luna');
      expect(call2Args.temperature).toBeUndefined();
      expect(call2Args).not.toHaveProperty('temperature');
      expect(call2Args.max_completion_tokens).toBe(600);
      expect(call2Args.response_format).toEqual({
        type: 'json_schema',
        json_schema: TIKO_GROUNDED_SYNTHESIS_SCHEMA
      });

      // Verify answer validity
      expect(result.finalAnswer).toContain('Rp 6.200.000');
      expect(result.groundingVerification.isValid).toBe(true);
      expect(result.telemetry.modelCallCount).toBe(2);
    });

    test('Non-reasoning model (e.g. gpt-4o-mini) preserves configured temperature', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 150, completion_tokens: 50 },
            content: {
              speechAct: 'GENERAL_GREETING',
              isPureSocialGreeting: true,
              entities: [],
              requestedAspects: [],
              normalizedSearchQueries: []
            }
          })
      };

      await processUnifiedTurn('chat_compat_mini', 'Halo selamat pagi', {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-4o-mini'
      });

      const call1Args = mockAiClient.chatCompletionsCreate.mock.calls[0][0];
      expect(call1Args.model).toBe('gpt-4o-mini');
      expect(call1Args.temperature).toBe(0.1);
      expect(call1Args.max_completion_tokens).toBe(500);
    });

    test('API error in Call 1 executes Safe Local Fallback and is never treated as success', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn().mockRejectedValue(
          new Error("400 Unsupported value: 'temperature' does not support 0.1 with this model.")
        )
      };

      const result = await processUnifiedTurn('chat_err_call1', 'Berapa biaya kuliah?', {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      // Must NOT be treated as a successful answer
      expect(result.error).toContain('400 Unsupported value');
      expect(result.finalAnswer).toBeDefined();
      expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
      expect(result.isLocalFallback).toBe(true);
      expect(result.understanding.speechAct).toBe('INQUIRE_FACT');

      // Verify ledger reconciliation marked the reservation as FAILED with zero cost
      const todayYMD = getMakassarDateYMD();
      const ledgerState = await mockAdapter.getDayLedger(todayYMD);
      expect(ledgerState.spentUSD).toBe(0.0);
      expect(ledgerState.reservedUSD).toBe(0.0);
    });

    test('API error in Call 2 executes Safe Local Fallback and is never treated as success', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 200, completion_tokens: 80 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [{ raw: 'Double Degree', canonicalId: 'double_degree' }],
              requestedAspects: [{ aspect: 'international_program' }],
              normalizedSearchQueries: ['program double degree ITB STIKOM Bali']
            }
          })
          .mockRejectedValueOnce(
            new Error('500 Internal Server Error from Model Provider')
          )
      };

      const result = await processUnifiedTurn('chat_err_call2', 'Apakah ada double degree?', {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna',
        candidateEvidence: [
          { id: 'CHUNK_DD', access_classification: 'PUBLIC_OFFICIAL', text: 'Program Double Degree dengan HELP University Malaysia.' }
        ]
      });

      // Must NOT be treated as a successful answer
      expect(result.error).toContain('500 Internal Server Error');
      expect(result.finalAnswer).toBeDefined();
      expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
      expect(result.isLocalFallback).toBe(true);

      // Verify Call 2 failure safely reconciled
      const todayYMD = getMakassarDateYMD();
      const ledgerState = await mockAdapter.getDayLedger(todayYMD);
      // Call 1 succeeded and spent its tokens, Call 2 failed and released reservation
      expect(ledgerState.reservedUSD).toBe(0.0);
    });

    test('Invalid or truncated JSON response triggers Safe Local Fallback', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn().mockResolvedValue({
          usage: { prompt_tokens: 150, completion_tokens: 30 },
          finish_reason: 'length', // Truncated by token limit
          content: '{"speechAct": "INQUI'
        })
      };

      const result = await processUnifiedTurn('chat_trunc_json', 'Pertanyaan terpotong', {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      expect(result.error).toBe('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS');
      expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
      expect(result.isLocalFallback).toBe(true);
    });
  });

  describe('8. Semantic Understanding Root Cause Regression & Raw-Query Rescue', () => {
    test('Raw query rescues informal tuition inquiry when Call 1 returns OUT_OF_SCOPE with empty entities and queries', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const rawQuery = 'kak mau nanya dong brapa ongkos per smt prodi SI reguler 2026?';

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          // Call 1 returns OUT_OF_SCOPE and empty entities/queries (simulating root cause failure)
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 300, completion_tokens: 60 },
            content: {
              speechAct: 'OUT_OF_SCOPE',
              isPureSocialGreeting: false,
              entities: [],
              requestedAspects: [],
              normalizedSearchQueries: [],
              requiresClarification: false,
              clarificationReason: ''
            }
          })
          // Call 2 receives rescued evidence from raw-query retrieval and synthesizes grounded answer
          .mockImplementationOnce(async ({ messages }) => {
            const userContent = messages[1].content;
            expect(userContent).toContain('rincian Biaya SI,TI dan BD');

            let chunkId = 'CHUNK_1';
            let evidenceQuote = '5. Biaya Pendidikan Per Semester 6.500.000';
            const chunkMatches = Array.from(userContent.matchAll(/\[Chunk \d+\] ID: ([^|\n]+) \| Title: ([^\n]+)\nContent: ([^\n]+)/g));
            for (const m of chunkMatches) {
              const cid = m[1].trim();
              const cnt = m[3];
              if (cnt.includes('6.500.000')) {
                chunkId = cid;
                const qMatch = cnt.match(/5\.\s*Biaya Pendidikan Per Semester\s*6\.500\.000/i) || cnt.match(/6\.500\.000/);
                if (qMatch) evidenceQuote = qMatch[0];
                break;
              }
            }

            return {
              usage: { prompt_tokens: 600, completion_tokens: 120 },
              content: {
                evidenceArbitration: {
                  status: 'FULLY_SUPPORTED',
                  usedChunkIds: [chunkId],
                  unsupportedAspects: []
                },
                factualClaims: [{
                  claimText: `Biaya pendidikan per semester untuk S1 Sistem Informasi adalah ${evidenceQuote}.`,
                  supportedByChunkId: chunkId,
                  evidenceQuote
                }],
                uncoveredAspects: [],
                naturalAnswer: `Biaya kuliah per semester untuk program studi S1 Sistem Informasi reguler adalah ${evidenceQuote}.`
              }
            };
          })
      };

      const result = await processUnifiedTurn('chat_rescue_tuition_81', rawQuery, {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      // Assert that speechAct was rescued from OUT_OF_SCOPE to INQUIRE_FACT
      expect(result.understanding.speechAct).toBe('INQUIRE_FACT');
      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);
      expect(result.telemetry.modelCallCount).toBe(2);
      expect(result.finalAnswer).toContain('6.500.000');
      expect(result.isLocalFallback).toBeFalsy();
      expect(result.groundingVerification.isValid).toBe(true);
    });

    test('Raw query rescues Double Degree inquiry when Call 1 returns OUT_OF_SCOPE with empty entities and queries', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const rawQuery = 'Apakah ada program Double Degree dengan universitas di Malaysia atau China?';

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          // Call 1 returns OUT_OF_SCOPE and empty entities/queries
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 280, completion_tokens: 50 },
            content: {
              speechAct: 'OUT_OF_SCOPE',
              isPureSocialGreeting: false,
              entities: [],
              requestedAspects: [],
              normalizedSearchQueries: [],
              requiresClarification: false,
              clarificationReason: ''
            }
          })
          // Call 2 receives rescued evidence from CHATBOT - Double Degree.docx
          .mockImplementationOnce(async ({ messages }) => {
            const userContent = messages[1].content;
            expect(userContent).toContain('CHATBOT - Double Degree.docx');

            let chunkId = 'CHUNK_1';
            let evidenceQuote = 'HELP University, Malaysia';
            const chunkMatches = Array.from(userContent.matchAll(/\[Chunk \d+\] ID: ([^|\n]+) \| Title: ([^\n]+)\nContent: ([^\n]+)/g));
            for (const m of chunkMatches) {
              const cid = m[1].trim();
              const cnt = m[3];
              if (cnt.includes('HELP University')) {
                chunkId = cid;
                const qMatch = cnt.match(/HELP University,\s*Malaysia/i) || cnt.match(/HELP University/i);
                if (qMatch) evidenceQuote = qMatch[0];
                break;
              }
            }

            return {
              usage: { prompt_tokens: 650, completion_tokens: 140 },
              content: {
                evidenceArbitration: {
                  status: 'FULLY_SUPPORTED',
                  usedChunkIds: [chunkId],
                  unsupportedAspects: []
                },
                factualClaims: [{
                  claimText: 'Terdapat program Double Degree dengan HELP University, Malaysia.',
                  supportedByChunkId: chunkId,
                  evidenceQuote
                }],
                uncoveredAspects: [],
                naturalAnswer: 'Ya, ITB STIKOM Bali memiliki program Double Degree dengan HELP University, Malaysia.'
              }
            };
          })
      };

      const result = await processUnifiedTurn('chat_rescue_dd_82', rawQuery, {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      // Assert speechAct was rescued to INQUIRE_FACT
      expect(result.understanding.speechAct).toBe('INQUIRE_FACT');
      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);
      expect(result.telemetry.modelCallCount).toBe(2);
      expect(result.finalAnswer).toContain('HELP University');
      expect(result.isLocalFallback).toBeFalsy();
      expect(result.groundingVerification.isValid).toBe(true);
    });

    test('Multi-entity inquiries search each query individually, deduplicate by ID, and combine evidence', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const rawQuery = 'Berapa biaya kuliah Sistem Informasi dan apa profil UKM Futsal?';

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 310, completion_tokens: 90 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [
                { raw: 'Sistem Informasi', canonicalId: 'S1 Sistem Informasi', category: 'academic_program', confidence: 0.95, isUnmapped: false },
                { raw: 'UKM Futsal', canonicalId: 'UKM Futsal', category: 'organization', confidence: 0.92, isUnmapped: true }
              ],
              requestedAspects: [
                { aspect: 'tuition_fee', customAspectDescription: 'biaya kuliah', targetEntityCanonicalId: 'S1 Sistem Informasi' },
                { aspect: 'extracurricular_profile', customAspectDescription: 'profil ukm futsal', targetEntityCanonicalId: 'UKM Futsal' }
              ],
              normalizedSearchQueries: [
                'rincian biaya kuliah S1 Sistem Informasi per semester',
                'profil kegiatan organisasi UKM Futsal STIKOM Bali'
              ],
              requiresClarification: false,
              clarificationReason: ''
            }
          })
          .mockImplementationOnce(async ({ messages }) => {
            const userContent = messages[1].content;
            // Both distinct evidence sources must be present in the prompt
            expect(userContent).toContain('rincian Biaya SI,TI dan BD');
            expect(userContent).toContain('PROFIL SINGKAT UKM FUTSAL.docx');

            let feeChunkId = 'FEE_CHUNK';
            let feeQuote = '5. Biaya Pendidikan Per Semester 6.500.000';
            let futsalChunkId = 'FUTSAL_CHUNK';
            let futsalQuote = 'Unit Kegiatan Mahasiswa FUTSAL';

            const chunkMatches = Array.from(userContent.matchAll(/\[Chunk \d+\] ID: ([^|\n]+) \| Title: ([^\n]+)\nContent: ([^\n]+)/g));
            for (const m of chunkMatches) {
              const cid = m[1].trim();
              const title = m[2];
              const cnt = m[3];
              if (cnt.includes('6.500.000') && feeChunkId === 'FEE_CHUNK') {
                feeChunkId = cid;
                const q = cnt.match(/5\.\s*Biaya Pendidikan Per Semester\s*6\.500\.000/i) || cnt.match(/6\.500\.000/);
                if (q) feeQuote = q[0];
              }
              if ((title.includes('FUTSAL') || cnt.includes('FUTSAL')) && futsalChunkId === 'FUTSAL_CHUNK') {
                futsalChunkId = cid;
                const q = cnt.match(/Unit Kegiatan Mahasiswa FUTSAL/i) || cnt.match(/olahraga FUTSAL/i) || cnt.match(/UKM FUTSAL/i);
                if (q) futsalQuote = q[0];
              }
            }

            return {
              usage: { prompt_tokens: 750, completion_tokens: 160 },
              content: {
                evidenceArbitration: {
                  status: 'FULLY_SUPPORTED',
                  usedChunkIds: [feeChunkId, futsalChunkId],
                  unsupportedAspects: []
                },
                factualClaims: [
                  {
                    claimText: `Biaya per semester S1 SI adalah ${feeQuote}.`,
                    supportedByChunkId: feeChunkId,
                    evidenceQuote: feeQuote
                  },
                  {
                    claimText: `Organisasi ${futsalQuote} memfasilitasi mahasiswa di bidang futsal.`,
                    supportedByChunkId: futsalChunkId,
                    evidenceQuote: futsalQuote
                  }
                ],
                uncoveredAspects: [],
                naturalAnswer: `Biaya kuliah S1 Sistem Informasi adalah ${feeQuote}, dan ${futsalQuote} memfasilitasi minat futsal mahasiswa.`
              }
            };
          })
      };

      const result = await processUnifiedTurn('chat_multi_entity_83', rawQuery, {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);
      expect(result.finalAnswer).toContain('6.500.000');
      expect(result.finalAnswer).toMatch(/futsal/i);
      expect(result.isLocalFallback).toBeFalsy();
    });

    test('Zero allowed evidence after retrieval skips Call 2 and returns honest safe fallback', async () => {
      const mockAdapter = new MemoryPersistentAdapter();
      const testLedger = new BudgetLedgerManager(mockAdapter);

      const rawQuery = 'Bagaimana tata cara reparasi mesin roket antariksa di ITB STIKOM Bali?';

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          // Call 1 returns an inquiry with normalized query that has no evidence in campus corpus
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 250, completion_tokens: 60 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [{ raw: 'mesin roket antariksa', canonicalId: 'mesin_roket', category: 'other', confidence: 0.5, isUnmapped: true }],
              requestedAspects: [{ aspect: 'other_aspect', customAspectDescription: 'reparasi mesin roket', targetEntityCanonicalId: 'general' }],
              normalizedSearchQueries: ['reparasi mesin roket antariksa ITB STIKOM Bali'],
              requiresClarification: false,
              clarificationReason: ''
            }
          })
      };

      const result = await processUnifiedTurn('chat_zero_evidence', rawQuery, {
        budgetLedger: testLedger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna',
        retrieveCandidatesFn: async () => []
      });

      // Call 2 MUST NOT be called! Saves budget and prevents hallucination
      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(1);
      expect(result.telemetry.modelCallCount).toBe(1);
      expect(result.isLocalFallback).toBe(true);
      expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
      expect(result.evidenceArbitration.status).toBe('UNSUPPORTED_IN_CORPUS');
    });
  });

});
