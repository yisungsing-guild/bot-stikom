'use strict';

/**
 * tests/call1TruncationAndAccountingValidation.test.js
 *
 * Local Mock Test Suite for Call 1 Output Truncation Handling,
 * Exact Cost Accounting on Failures, Reservation Ceilings, and Safety Invariants.
 *
 * Covers requirements C.1 to C.9:
 * 1. Respons sukses dengan JSON lengkap diproses normal.
 * 2. Respons finish_reason: "length" ditolak secara aman (tanpa parsial).
 * 3. Usage nonzero pada respons terpotong tetap direkonsiliasi.
 * 4. Usage yang tidak diketahui tidak dicatat sebagai biaya nol (ambigu null).
 * 5. Tidak ada retry otomatis setelah output terpotong.
 * 6. Call 2 tidak dipanggil jika Call 1 gagal.
 * 7. Total reservasi dua panggilan tidak melebihi batas per pertanyaan ($0.000920).
 * 8. Pertanyaan multi-aspek tidak kehilangan aspek penting akibat pembatasan output.
 * 9. Kontrol grounding, filter sumber publik, dan budget ledger tetap berfungsi.
 */

const {
  processUnifiedTurn,
  filterAllowedEvidence,
  verifyUnifiedClaimsAndFacts,
  TIKO_SEMANTIC_UNDERSTANDING_SCHEMA
} = require('../src/core/unifiedSemanticEngine');

const {
  BudgetLedgerManager,
  MemoryPersistentAdapter,
  RESERVATION_TOKEN_CEILINGS,
  calculateReservationUSD,
  calculateModelCostUSD,
  getMakassarDateYMD
} = require('../src/core/budgetLedger');

describe('Call 1 Truncation and Cost Accounting Validation Suite', () => {
  let adapter;
  let ledger;
  const todayYMD = getMakassarDateYMD();

  beforeEach(() => {
    adapter = new MemoryPersistentAdapter();
    ledger = new BudgetLedgerManager(adapter);
  });

  // =========================================================================
  // 1. Respons sukses dengan JSON lengkap diproses normal
  // =========================================================================
  test('1. Respons sukses dengan JSON lengkap diproses normal melalui Call 1 dan Call 2', async () => {
    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          usage: { prompt_tokens: 220, completion_tokens: 150 },
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [
              { raw: 'S1 TI', canonicalId: 's1_ti', category: 'academic_program', confidence: 0.95, isUnmapped: false }
            ],
            requestedAspects: [
              { aspect: 'tuition_fee', customAspectDescription: 'biaya semester', targetEntityCanonicalId: 's1_ti' }
            ],
            normalizedSearchQueries: ['biaya kuliah S1 TI per semester'],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          usage: { prompt_tokens: 450, completion_tokens: 200 },
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CHUNK_TI_FEE'], unsupportedAspects: [] },
            factualClaims: [
              {
                claimText: 'Biaya kuliah S1 TI adalah Rp 6.500.000 per semester',
                targetEntityId: 's1_ti',
                supportedByChunkId: 'CHUNK_TI_FEE',
                evidenceQuote: 'Biaya kuliah S1 TI adalah Rp 6.500.000 per semester'
              }
            ],
            uncoveredAspects: [],
            naturalAnswer: 'Halo Kak! Biaya kuliah S1 TI di ITB STIKOM Bali adalah Rp 6.500.000 per semester.'
          }
        })
    };

    const candidates = [
      {
        id: 'CHUNK_TI_FEE',
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        access_classification: 'PUBLIC_OFFICIAL',
        status: 'ACTIVE',
        text: 'Biaya kuliah S1 TI adalah Rp 6.500.000 per semester'
      }
    ];

    const result = await processUnifiedTurn('chat_success_turn', 'Berapa biaya S1 TI?', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna',
      candidateEvidence: candidates
    });

    expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);
    expect(result.isLocalFallback).toBeUndefined();
    expect(result.finalAnswer).toContain('Rp 6.500.000');
    expect(result.apiStatuses.call1Request).toBe('API_REQUEST_SUCCESS');
    expect(result.apiStatuses.call1Parsing).toBe('PARSING_SUCCESS');
    expect(result.apiStatuses.call1Understanding).toBe('VALID');
    expect(result.apiStatuses.call2Request).toBe('API_REQUEST_SUCCESS');
    expect(result.apiStatuses.groundedSynthesis).toBe('VALID');
    expect(result.apiStatuses.finalAnswer).toBe('SUCCESS');

    // Both calls reconciled
    const dayLedger = await adapter.getDayLedger(todayYMD);
    expect(dayLedger.reservedUSD).toBe(0);
    expect(dayLedger.spentUSD).toBeGreaterThan(0);
  });

  // =========================================================================
  // 2. Respons finish_reason: "length" ditolak secara aman
  // =========================================================================
  test('2. Respons finish_reason: "length" ditolak secara aman dan tidak mengembalikan JSON parsial', async () => {
    const mockAiClient = {
      chatCompletionsCreate: jest.fn().mockResolvedValueOnce({
        finish_reason: 'length',
        usage: { prompt_tokens: 300, completion_tokens: 500 },
        content: '{"speechAct":"INQUIRE_FACT","isPureSocialGreeting":false,"entities":[{"raw":"DNUI"'
      })
    };

    const result = await processUnifiedTurn('chat_trunc_test', 'Bagaimana program DNUI China?', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna'
    });

    expect(result.isLocalFallback).toBe(true);
    expect(result.fallbackReason).toBe('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS');
    expect(result.error).toBe('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS');
    // Ensure partial raw JSON is NEVER returned as final answer
    expect(result.finalAnswer).not.toContain('"entities"');
    expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');

    expect(result.apiStatuses.call1Request).toBe('API_REQUEST_SUCCESS');
    expect(result.apiStatuses.call1Parsing).toBe('PARSING_SKIPPED');
    expect(result.apiStatuses.call1Understanding).toBe('OUTPUT_TRUNCATED');
    expect(result.apiStatuses.finalAnswer).toBe('SAFE_LOCAL_FALLBACK');
  });

  // =========================================================================
  // 3. Usage nonzero pada respons terpotong tetap direkonsiliasi
  // =========================================================================
  test('3. Usage nonzero pada respons terpotong tetap direkonsiliasi dan dicatat ke spentUSD', async () => {
    const promptTokens = 250;
    const completionTokens = 500;
    const expectedCost = calculateModelCostUSD(promptTokens, completionTokens, 'gpt-6-luna');
    expect(expectedCost).toBeGreaterThan(0);

    const mockAiClient = {
      chatCompletionsCreate: jest.fn().mockResolvedValueOnce({
        finish_reason: 'length',
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
        content: '{"partial": true'
      })
    };

    await processUnifiedTurn('chat_nonzero_usage', 'Ceritakan prodi kampus', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna'
    });

    const dayLedger = await adapter.getDayLedger(todayYMD);
    // Billed tokens must be settled and added to spentUSD, NOT zeroed out
    expect(dayLedger.spentUSD).toBeCloseTo(expectedCost, 8);
    expect(dayLedger.reservedUSD).toBe(0);
    expect(dayLedger.ambiguousUSD).toBe(0);

    // Settlement state must be SETTLED / RECONCILED
    const settlementKeys = Object.keys(dayLedger.settlements);
    expect(settlementKeys.length).toBe(1);
    const st = dayLedger.settlements[settlementKeys[0]];
    expect(st.status).toBe('SETTLED');
    expect(st.costStatus).toBe('RECONCILED');
    expect(st.actualCostUSD).toBeCloseTo(expectedCost, 8);
  });

  // =========================================================================
  // 4. Usage yang tidak diketahui tidak dicatat sebagai biaya nol
  // =========================================================================
  test('4. Usage yang tidak diketahui pada in-flight error tidak dicatat sebagai 0.0, melainkan retained ambiguously', async () => {
    const mockAiClient = {
      chatCompletionsCreate: jest.fn().mockResolvedValueOnce({
        finish_reason: 'length',
        usage: null, // Unknown usage!
        content: '{"partial": true'
      })
    };

    const result = await processUnifiedTurn('chat_unknown_usage', 'Ceritakan UKM', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna'
    });

    expect(result.isLocalFallback).toBe(true);

    const dayLedger = await adapter.getDayLedger(todayYMD);
    // In-flight with unknown usage must NOT claim spentUSD = 0; must retain reservation in ambiguousUSD
    expect(dayLedger.spentUSD).toBe(0);
    expect(dayLedger.ambiguousUSD).toBeGreaterThan(0);
    expect(dayLedger.reservedUSD).toBe(0);

    const settlementKeys = Object.keys(dayLedger.settlements);
    const st = dayLedger.settlements[settlementKeys[0]];
    expect(st.status).toBe('AMBIGUOUS_RETAINED');
    expect(st.costStatus).toBe('UNKNOWN');
    expect(st.actualCostUSD).toBeNull(); // Strictly null, NEVER 0.0!
  });

  // =========================================================================
  // 5. Tidak ada retry otomatis setelah output terpotong
  // =========================================================================
  test('5. Tidak ada retry otomatis setelah output terpotong (tepat 1 invocation)', async () => {
    const mockAiClient = {
      chatCompletionsCreate: jest.fn().mockResolvedValue({
        finish_reason: 'length',
        usage: { prompt_tokens: 200, completion_tokens: 500 },
        content: '{"incomplete": true'
      })
    };

    await processUnifiedTurn('chat_no_retry', 'Pertanyaan terpotong', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna'
    });

    // Zero automatic retries
    expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 6. Call 2 tidak dipanggil jika Call 1 gagal
  // =========================================================================
  test('6. Call 2 tidak dipanggil jika Call 1 mengalami kegagalan atau pemotongan', async () => {
    const mockAiClient = {
      chatCompletionsCreate: jest.fn().mockResolvedValueOnce({
        finish_reason: 'length',
        usage: { prompt_tokens: 180, completion_tokens: 500 },
        content: '{"cut": true'
      })
    };

    const candidates = [
      { id: 'C1', access_classification: 'PUBLIC_OFFICIAL', status: 'ACTIVE', text: 'Valid evidence' }
    ];

    const result = await processUnifiedTurn('chat_call2_skipped', 'Info kampus', {
      budgetLedger: ledger,
      aiClient: mockAiClient,
      model: 'gpt-6-luna',
      candidateEvidence: candidates
    });

    expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(1);
    expect(result.apiStatuses.call2Request).toBe('NOT_CALLED');
    expect(result.apiStatuses.groundedSynthesis).toBe('NOT_CALLED');

    // Only 1 settlement created for Call 1
    const dayLedger = await adapter.getDayLedger(todayYMD);
    const settlements = Object.values(dayLedger.settlements);
    expect(settlements.length).toBe(1);
    expect(settlements[0].purpose).toBe('call_1');
  });

  // =========================================================================
  // 7. Total reservasi dua panggilan tidak melebihi batas per pertanyaan
  // =========================================================================
  test('7. Total reservasi dua panggilan tidak melebihi batas per pertanyaan ($0.000920)', () => {
    const targetModel = 'gpt-6-luna';

    // Call 1 reservation calculation
    const call1ResUSD = calculateReservationUSD({
      model: targetModel,
      purpose: 'call_1'
    });
    // Call 2 reservation calculation
    const call2ResUSD = calculateReservationUSD({
      model: targetModel,
      purpose: 'call_2'
    });

    const totalTurnReservation = call1ResUSD + call2ResUSD;

    // Requirements:
    // Call 1: max $0.000370 USD
    // Call 2: max $0.000550 USD
    // Total per turn: max $0.000920 USD
    expect(call1ResUSD).toBeLessThanOrEqual(0.000370001);
    expect(call2ResUSD).toBeLessThanOrEqual(0.000550001);
    expect(totalTurnReservation).toBeLessThanOrEqual(0.000920001);

    // Two turns must fit inside the hard $0.002000 ceiling
    const twoTurnTotal = totalTurnReservation * 2;
    expect(twoTurnTotal).toBeLessThanOrEqual(0.002000);
  });

  // =========================================================================
  // 8. Pertanyaan multi-aspek tidak kehilangan aspek penting akibat pembatasan output
  // =========================================================================
  test('8. Pertanyaan multi-aspek memelihara entitas dan aspek esensial dalam batas schema', async () => {
    // Simulated realistic understanding for Double Degree DNUI China (2 entities, 2 aspects, 2 search queries)
    const mockAiClient = {
      chatCompletionsCreate: jest.fn()
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          usage: { prompt_tokens: 310, completion_tokens: 180 },
          content: {
            speechAct: 'INQUIRE_FACT',
            isPureSocialGreeting: false,
            entities: [
              { raw: 'Double Degree', canonicalId: 'double_degree', category: 'academic_program', confidence: 0.95, isUnmapped: true },
              { raw: 'DNUI China', canonicalId: 'dnui_china', category: 'institution', confidence: 0.95, isUnmapped: true }
            ],
            requestedAspects: [
              { aspect: 'international_program', customAspectDescription: 'skema kuliah Indonesia dan China', targetEntityCanonicalId: 'double_degree' },
              { aspect: 'degree_award', customAspectDescription: 'gelar ganda lulusan', targetEntityCanonicalId: 'double_degree' }
            ],
            normalizedSearchQueries: [
              'program double degree DNUI China sistem kuliah',
              'gelar ganda lulusan double degree DNUI'
            ],
            requiresClarification: false,
            clarificationReason: ''
          }
        })
        .mockResolvedValueOnce({
          finish_reason: 'stop',
          usage: { prompt_tokens: 550, completion_tokens: 280 },
          content: {
            evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['CHUNK_DNUI'], unsupportedAspects: [] },
            factualClaims: [
              {
                claimText: 'Kuliah 2 tahun di Bali, tahun ke-3 online, dan tahun ke-4 di China',
                targetEntityId: 'double_degree',
                supportedByChunkId: 'CHUNK_DNUI',
                evidenceQuote: 'Kuliah 2 tahun di Bali, tahun ke-3 online, dan tahun ke-4 di China'
              },
              {
                claimText: 'Gelar Sarjana Bisnis (S.Bns) dan Bachelor of Management (BM)',
                targetEntityId: 'double_degree',
                supportedByChunkId: 'CHUNK_DNUI',
                evidenceQuote: 'Gelar Sarjana Bisnis (S.Bns) dan Bachelor of Management (BM)'
              }
            ],
            uncoveredAspects: [],
            naturalAnswer: 'Program Double Degree DNUI: 2 tahun di Bali, th ke-3 daring, th ke-4 di China. Gelar: S.Bns & BM.'
          }
        })
    };

    const candidates = [
      {
        id: 'CHUNK_DNUI',
        sourceFile: 'CHATBOT - Double Degree.docx',
        access_classification: 'PUBLIC_OFFICIAL',
        status: 'ACTIVE',
        text: 'Program Double Degree DNUI: Kuliah 2 tahun di Bali, tahun ke-3 online, dan tahun ke-4 di China. Gelar Sarjana Bisnis (S.Bns) dan Bachelor of Management (BM).'
      }
    ];

    const result = await processUnifiedTurn(
      'chat_multi_aspect_dnui',
      'kak mau nanya dong, program double degree ke DNUI China itu sistem kuliahnya gimana ya? Apakah full di China atau ada di Bali juga, terus nanti gelarnya apa?',
      {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna',
        candidateEvidence: candidates
      }
    );

    expect(result.understanding).toBeDefined();
    // Verify entities are kept (max 3, here exactly 2)
    expect(result.understanding.entities.length).toBe(2);
    // Verify both aspects are preserved (max 4, here exactly 2)
    expect(result.understanding.requestedAspects.length).toBe(2);
    expect(result.understanding.requestedAspects.map(a => a.aspect)).toContain('international_program');
    expect(result.understanding.requestedAspects.map(a => a.aspect)).toContain('degree_award');
    // Verify search queries are kept (max 3, here exactly 2)
    expect(result.understanding.normalizedSearchQueries.length).toBe(2);

    expect(result.finalAnswer).toContain('S.Bns');
  });

  // =========================================================================
  // 9. Kontrol grounding, filter sumber publik, dan budget ledger tetap berfungsi
  // =========================================================================
  test('9. Kontrol grounding, filter dokumen publik, dan isolasi budget ledger tetap utuh', async () => {
    // 9.1 Filter dokumen publik
    const testChunks = [
      {
        id: 'C_PUB',
        sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
        access_classification: 'PUBLIC_OFFICIAL',
        status: 'ACTIVE',
        text: 'Dokumen biaya publik aktif'
      },
      {
        id: 'C_INT',
        sourceFile: 'slip_gaji_dosen.pdf',
        is_internal: true,
        text: 'Dokumen internal rahasia'
      },
      {
        id: 'C_EXP',
        sourceFile: 'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf',
        governanceStatus: 'EXPIRED',
        text: 'Dokumen kadaluarsa'
      }
    ];

    const filtered = filterAllowedEvidence(testChunks);
    expect(filtered.map(c => c.id)).toEqual(['C_PUB']);

    // 9.2 Grounding verification blocks ungrounded claims
    const badSynthesis = {
      evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['C_PUB'], unsupportedAspects: [] },
      factualClaims: [
        {
          claimText: 'Semua mahasiswa dapat laptop gratis',
          targetEntityId: 's1_ti',
          supportedByChunkId: 'C_PUB',
          evidenceQuote: 'Kutipan palsu tidak ada dalam teks chunk'
        }
      ],
      uncoveredAspects: [],
      naturalAnswer: 'Dapat laptop gratis!'
    };

    const verif = verifyUnifiedClaimsAndFacts(badSynthesis, filtered);
    expect(verif.isValid).toBe(false);
    expect(verif.ungroundedClaims.length).toBeGreaterThan(0);

    // 9.3 Budget ledger blocks when daily ceiling is exceeded
    const lowCeilingLedger = new BudgetLedgerManager(new MemoryPersistentAdapter());
    // Attempt reserving $0.000370 when ceiling is $0.000100
    const res = await lowCeilingLedger.reserveBudget({
      purpose: 'call_1',
      model: 'gpt-6-luna',
      maxBudgetUSD: 0.000100
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe('DAILY_BUDGET_EXCEEDED');
  });
});
