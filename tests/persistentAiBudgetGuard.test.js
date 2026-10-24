'use strict';

const {
  BudgetLedgerManager,
  MemoryPersistentAdapter,
  PrismaSettingAdapter,
  getMakassarDateYMD,
  calculateModelCostUSD,
  MODEL_PRICING_CATALOG
} = require('../src/core/budgetLedger');
const { parseSemanticInterpretation } = require('../src/core/modelSemanticParser');
const { synthesizeAnswer } = require('../src/core/groundedAnswerGenerator');

describe('Persistent AI Budget Guard — Comprehensive Verification', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('1. Fail-Closed & Configuration Governance', () => {
    test('refuses reservation when adapter is not available (fail-closed)', async () => {
      const ledger = new BudgetLedgerManager(null);
      const res = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('PERSISTENT_LEDGER_UNAVAILABLE');
    });

    test('refuses reservation when daily ceiling is not configured or invalid (no hardcoded spending)', async () => {
      delete process.env.AI_DAILY_BUDGET_CEILING_USD;
      delete process.env.MAX_DAILY_API_BUDGET_USD;

      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const res = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna'
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('DAILY_BUDGET_CEILING_NOT_CONFIGURED');
    });

    test('refuses reservation for unverified model without catalog rate', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const res = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'unknown-experimental-llm-99',
        maxBudgetUSD: 1.00
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('REJECT_UNVERIFIED_MODEL');
    });
  });

  describe('2. Atomic Reservation & Concurrency Race Protection', () => {
    test('successfully acquires reservation within budget', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const res = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00
      });

      expect(res.allowed).toBe(true);
      expect(res.reservationId).toMatch(/^res_/);
      expect(res.reservedUSD).toBeGreaterThan(0);
    });

    test('idempotently handles retry with the same operationId without double-reserving', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const operationId = 'op_unique_12345';

      const firstRes = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00,
        operationId
      });
      expect(firstRes.allowed).toBe(true);
      expect(firstRes.idempotentSkip).toBeUndefined();

      // Retry with same operationId
      const secondRes = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00,
        operationId
      });
      expect(secondRes.allowed).toBe(true);
      expect(secondRes.idempotentSkip).toBe(true);
      expect(secondRes.reservationId).toBe(firstRes.reservationId);

      // Verify that total reserved is exactly the single reservation
      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: 1.00 });
      expect(remaining.reservedUSD).toBe(firstRes.reservedUSD);
    });

    test('rejects reservation when ceiling would be exceeded', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const tinyBudget = 0.0001; // smaller than reservation for gpt-6-luna

      const res = await ledger.reserveBudget({
        purpose: 'call_2_grounded_generator',
        model: 'gpt-6-luna',
        maxBudgetUSD: tinyBudget
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('DAILY_BUDGET_EXCEEDED');
      expect(res.attemptedReservationUSD).toBeGreaterThan(tinyBudget);
    });

    test('prevents over-spending under high concurrency (no race condition bypass)', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      // Set ceiling to exactly allow only 3 reservations of ~0.00042 USD each
      const ceiling = 0.0013;

      // Spawn 15 concurrent reservation attempts
      const attempts = Array.from({ length: 15 }, (_, i) =>
        ledger.reserveBudget({
          purpose: 'call_1_semantic_parser',
          model: 'gpt-6-luna',
          maxBudgetUSD: ceiling
        })
      );

      const results = await Promise.all(attempts);
      const allowedCount = results.filter(r => r.allowed).length;
      const deniedCount = results.filter(r => !r.allowed && r.reason === 'DAILY_BUDGET_EXCEEDED').length;

      expect(allowedCount).toBeGreaterThanOrEqual(1);
      expect(allowedCount).toBeLessThanOrEqual(4);
      expect(allowedCount + deniedCount).toBe(15);

      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: ceiling });
      expect(remaining.reservedUSD).toBeLessThanOrEqual(ceiling);
    });
  });

  describe('3. Reconciliation, Token Metadata & Ambiguous Timeout Handling', () => {
    test('reconciles reservation with actual token usage on SUCCESS', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const reservation = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00
      });
      expect(reservation.allowed).toBe(true);

      const reconcileRes = await ledger.reconcileBudget({
        reservationId: reservation.reservationId,
        reservedUSD: reservation.reservedUSD,
        actualPromptTokens: 200,
        actualCompletionTokens: 50,
        model: 'gpt-6-luna',
        status: 'SUCCESS'
      });

      expect(reconcileRes.reconciled).toBe(true);
      expect(reconcileRes.status).toBe('SETTLED');
      expect(reconcileRes.actualCostUSD).toBeGreaterThan(0);
      expect(reconcileRes.totalReservedToday).toBe(0); // released reservation
      expect(reconcileRes.totalSpentToday).toBe(reconcileRes.actualCostUSD);
    });

    test('retains ambiguous reservation against daily ceiling on timeout in-flight (NOT zeroed out)', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const reservation = await ledger.reserveBudget({
        purpose: 'call_2_grounded_generator',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00
      });
      expect(reservation.allowed).toBe(true);

      const reconcileRes = await ledger.reconcileBudget({
        reservationId: reservation.reservationId,
        reservedUSD: reservation.reservedUSD,
        model: 'gpt-6-luna',
        error: new Error('APIConnectionTimeoutError: Request timed out after 15000ms'),
        status: 'AMBIGUOUS_FAILURE'
      });

      expect(reconcileRes.reconciled).toBe(false);
      expect(reconcileRes.status).toBe('AMBIGUOUS_RETAINED');
      expect(reconcileRes.costStatus).toBe('UNKNOWN');
      expect(reconcileRes.actualCostUSD).toBeNull(); // strictly null, not 0.0
      expect(reconcileRes.totalAmbiguousToday).toBe(reservation.reservedUSD);

      // Verify that remaining budget accounts for ambiguous retained spend
      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: 1.00 });
      expect(remaining.ambiguousUSD).toBe(reservation.reservedUSD);
      expect(remaining.remainingUSD).toBe(1.00 - reservation.reservedUSD);
    });

    test('releases reservation to $0.00 when pre-request failure is verified', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const reservation = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 1.00
      });

      const reconcileRes = await ledger.reconcileBudget({
        reservationId: reservation.reservationId,
        reservedUSD: reservation.reservedUSD,
        isPreRequest: true,
        model: 'gpt-6-luna',
        status: 'FAILED'
      });

      expect(reconcileRes.reconciled).toBe(true);
      expect(reconcileRes.status).toBe('RELEASED');
      expect(reconcileRes.costStatus).toBe('VERIFIED_ZERO');
      expect(reconcileRes.actualCostUSD).toBe(0.0);

      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: 1.00 });
      expect(remaining.spentUSD).toBe(0.0);
      expect(remaining.reservedUSD).toBe(0.0);
      expect(remaining.remainingUSD).toBe(1.00);
    });
  });

  describe('4. Process Restart & Storage Persistence', () => {
    test('persists ledger state across process restart simulation', async () => {
      // Shared persistent underlying store (e.g. simulated DB table / Map)
      const persistentStore = new Map();

      // Process 1: Makes a reservation and settles spend
      const adapter1 = new MemoryPersistentAdapter();
      adapter1.store = persistentStore;
      const ledger1 = new BudgetLedgerManager(adapter1);

      const res1 = await ledger1.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 5.00
      });
      await ledger1.reconcileBudget({
        reservationId: res1.reservationId,
        reservedUSD: res1.reservedUSD,
        actualPromptTokens: 500,
        actualCompletionTokens: 100,
        model: 'gpt-6-luna',
        status: 'SUCCESS'
      });

      // Process 2: (Simulated Node.js restart with new instance pointing to same persistent store)
      const adapter2 = new MemoryPersistentAdapter();
      adapter2.store = persistentStore;
      const ledger2 = new BudgetLedgerManager(adapter2);

      const remaining = await ledger2.getRemainingBudget({ maxBudgetUSD: 5.00 });
      expect(remaining.spentUSD).toBeGreaterThan(0);
      expect(remaining.remainingUSD).toBeLessThan(5.00);
    });

    test('PrismaSettingAdapter safely serializes and updates Setting table records', async () => {
      const mockSettings = new Map();
      const mockPrisma = {
        $transaction: async (fn) => {
          const tx = {
            $queryRaw: async () => {},
            setting: {
              findUnique: async ({ where }) => mockSettings.get(where.key) || null,
              create: async ({ data }) => {
                const rec = { id: 'uuid-1', key: data.key, value: data.value };
                mockSettings.set(data.key, rec);
                return rec;
              },
              update: async ({ where, data }) => {
                const rec = { id: 'uuid-1', key: where.key, value: data.value };
                mockSettings.set(where.key, rec);
                return rec;
              }
            }
          };
          return await fn(tx);
        },
        setting: {
          findUnique: async ({ where }) => mockSettings.get(where.key) || null
        }
      };

      const adapter = new PrismaSettingAdapter(mockPrisma);
      const ledger = new BudgetLedgerManager(adapter);

      const res = await ledger.reserveBudget({
        purpose: 'call_1_semantic_parser',
        model: 'gpt-6-luna',
        maxBudgetUSD: 2.00
      });
      expect(res.allowed).toBe(true);

      const todayKey = adapter.getSettingKey(getMakassarDateYMD());
      expect(mockSettings.has(todayKey)).toBe(true);
      const record = mockSettings.get(todayKey);
      const parsed = JSON.parse(record.value);
      expect(parsed.reservedUSD).toBe(res.reservedUSD);
    });
  });

  describe('5. Pipeline Integration (modelSemanticParser & groundedAnswerGenerator)', () => {
    const validInterpretationJson = JSON.stringify({
      speechAct: 'INQUIRE_PROPERTY',
      semanticConcepts: ['ACADEMIC_OFFERING'],
      candidateEntities: [
        {
          rawMention: 'informatika',
          inferredCategory: 'academic_program',
          academicLevel: 'S1'
        }
      ],
      requestedAspects: ['procedure'],
      scopeConstraints: {
        academicLevel: null,
        studyMode: null,
        locationConstraint: null
      },
      contextDependency: {
        isFollowUp: false,
        referenceType: 'none'
      },
      confidence: 0.95,
      ambiguityLevel: 'LOW'
    });

    test('modelSemanticParser fails closed when budget is exhausted', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      // Mock OpenAI client
      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: validInterpretationJson } }],
              usage: { prompt_tokens: 100, completion_tokens: 30 }
            })
          }
        }
      };

      // Set budget ceiling to 0.0 to simulate exhausted budget
      const result = await parseSemanticInterpretation('apa kurikulum informatika?', {
        client: mockClient,
        budgetLedger: ledger,
        maxBudgetUSD: 0.00000001
      });

      expect(mockClient.chat.completions.create).not.toHaveBeenCalled();
      expect(result.speechAct).toBe('UNKNOWN');
      expect(result.metadata.fallbackInvoked).toBe(true);
      expect(result.metadata.reason).toBe('DAILY_BUDGET_EXCEEDED');
    });

    test('modelSemanticParser reserves and reconciles when budget is available', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const mockClient = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{ message: { content: validInterpretationJson } }],
              usage: { prompt_tokens: 150, completion_tokens: 40 }
            })
          }
        }
      };

      const result = await parseSemanticInterpretation('apa kurikulum informatika?', {
        client: mockClient,
        budgetLedger: ledger,
        maxBudgetUSD: 5.00
      });

      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(result.speechAct).toBe('INQUIRE_PROPERTY');

      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: 5.00 });
      expect(remaining.spentUSD).toBeGreaterThan(0);
      expect(remaining.reservedUSD).toBe(0); // successfully settled
    });

    test('groundedAnswerGenerator falls back to deterministic summary when budget is exhausted', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      // Exhaust budget by setting tiny ceiling
      const mockAiEngine = {
        apiKey: 'real-key-for-test',
        model: 'gpt-6-luna',
        client: {
          chat: {
            completions: {
              create: jest.fn()
            }
          }
        }
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        speechAct: 'INQUIRE_PROPERTY',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        primaryEntities: ['Informatika'],
        normalizedEntityId: 'prodi_ti',
        entities: [{ canonical: 'S1 Informatika', name: 'Informatika' }]
      };

      const acceptedEvidence = [{
        text: 'Program Studi S1 Informatika menghasilkan lulusan di bidang software engineering dan AI yang unggul.',
        cleanText: 'Program Studi S1 Informatika menghasilkan lulusan di bidang software engineering dan AI yang unggul.',
        source: 'katalog_ti.pdf'
      }];

      const arbitratedEvidence = {
        accepted: acceptedEvidence,
        budgetLedger: ledger,
        maxBudgetUSD: 0.00000001, // tiny budget -> rejected
        aiEngine: mockAiEngine
      };

      const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

      // Verify model was NOT called
      expect(mockAiEngine.client.chat.completions.create).not.toHaveBeenCalled();
      // Verify safe deterministic grounded answer was generated
      expect(result.success).toBe(true);
      expect(result.source).toBe('grounded_deterministic_summary');
      expect(result.budgetExceeded).toBe(true);
      expect(result.answer).toContain('Informatika');
    });

    test('groundedAnswerGenerator reserves and reconciles when budget is available', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);

      const mockAiEngine = {
        apiKey: 'real-mock-key',
        model: 'gpt-6-luna',
        client: {
          chat: {
            completions: {
              create: jest.fn().mockResolvedValue({
                choices: [{ message: { content: 'Program Studi Informatika berfokus pada rekayasa perangkat lunak dan kecerdasan buatan.' } }],
                usage: { prompt_tokens: 300, completion_tokens: 45 }
              })
            }
          }
        }
      };

      const semanticFrame = {
        domain: 'ACADEMIC_PROGRAM',
        speechAct: 'INQUIRE_PROPERTY',
        semanticConcepts: ['ACADEMIC_OFFERING'],
        primaryEntities: ['Informatika'],
        normalizedEntityId: 'prodi_ti',
        entities: [{ canonical: 'S1 Informatika', name: 'Informatika' }]
      };

      const acceptedEvidence = [{
        text: 'Program Studi S1 Informatika menghasilkan lulusan di bidang software engineering dan AI yang unggul.',
        cleanText: 'Program Studi S1 Informatika menghasilkan lulusan di bidang software engineering dan AI yang unggul.',
        source: 'katalog_ti.pdf'
      }];

      const arbitratedEvidence = {
        accepted: acceptedEvidence,
        budgetLedger: ledger,
        maxBudgetUSD: 5.00,
        aiEngine: mockAiEngine
      };

      const result = await synthesizeAnswer(semanticFrame, arbitratedEvidence);

      expect(mockAiEngine.client.chat.completions.create).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.source).toBe('llm_grounded_synthesis');
      expect(result.reservationId).toMatch(/^res_/);

      const remaining = await ledger.getRemainingBudget({ maxBudgetUSD: 5.00 });
      expect(remaining.spentUSD).toBeGreaterThan(0);
      expect(remaining.reservedUSD).toBe(0); // settled
    });
  });
});
