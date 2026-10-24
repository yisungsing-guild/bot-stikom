'use strict';

/**
 * tests/budgetCostAndReconciliation.test.js
 *
 * Targeted Offline Unit Tests for Model-Aware Budget Calculation & Reconciliation (Tiko V2).
 * Verifies:
 * 1. Configured model pricing constants (GPT-6 Luna, text-embedding-3-small, etc.)
 * 2. Explicit conservative fallback policy for unverified/unknown models (no silent rate guessing)
 * 3. Exact actual cost calculations based on token usage and model rates
 * 4. Strict separation between conservative initial reservation and actual cost
 * 5. Embedding costs: cache hit ($0.00 actual cost) vs cache miss (paid token rate)
 * 6. Model-proportional initial reservations & pre-network budget blocking
 * 7. Ambiguous in-flight failure handling vs confirmed pre-request failures
 * 8. Idempotent reconciliation under all outcomes
 *
 * 100% Offline: No external paid API calls.
 */

const {
  MODEL_PRICING_CATALOG,
  CONSERVATIVE_FALLBACK_RATES,
  RESERVATION_TOKEN_CEILINGS,
  getModelRate,
  calculateModelCostUSD,
  calculateEmbeddingCostUSD,
  calculateEmbeddingCacheMetrics,
  calculateReservationUSD,
  classifyApiFailure,
  BudgetLedgerManager,
  MemoryPersistentAdapter,
  getMakassarDateYMD
} = require('../src/core/budgetLedger');

const {
  processUnifiedTurn,
  estimatePromptTokens
} = require('../src/core/unifiedSemanticEngine');

const {
  computeBatchQueryEmbeddings,
  clearQueryEmbeddingCache,
  setBudgetLedger
} = require('../src/engine/pgvectorShadowProvider');

describe('Model-Aware Budget Ledger & Cost Reconciliation', () => {

  describe('1. Model Pricing Catalog & Rate Resolution', () => {
    test('contains verified rates for GPT-6 Luna ($0.10/1M input, $0.50/1M output)', () => {
      const luna = MODEL_PRICING_CATALOG['gpt-6-luna'];
      expect(luna).toBeDefined();
      expect(luna.inputPerMillion).toBe(0.10);
      expect(luna.outputPerMillion).toBe(0.50);
      expect(luna.type).toBe('generative');
    });

    test('contains verified rates for text-embedding-3-small ($0.02/1M input, $0.00 output)', () => {
      const embed = MODEL_PRICING_CATALOG['text-embedding-3-small'];
      expect(embed).toBeDefined();
      expect(embed.inputPerMillion).toBe(0.02);
      expect(embed.outputPerMillion).toBe(0.00);
      expect(embed.type).toBe('embedding');
    });

    test('resolves known model rates via getModelRate', () => {
      const rate = getModelRate('gpt-6-luna');
      expect(rate.isFallback).toBe(false);
      expect(rate.source).toBe('KNOWN_CATALOG');
      expect(rate.inputPerMillion).toBe(0.10);
      expect(rate.outputPerMillion).toBe(0.50);
    });

    test('applies explicit conservative fallback for unknown generative models (no silent assumption)', () => {
      const unknownRate = getModelRate('unverified-future-model-x');
      expect(unknownRate.isFallback).toBe(true);
      expect(unknownRate.source).toBe('EXPLICIT_CONSERVATIVE_FALLBACK');
      expect(unknownRate.policy).toBe('EXPLICIT_CONSERVATIVE_UNVERIFIED_GENERATIVE');
      expect(unknownRate.inputPerMillion).toBe(CONSERVATIVE_FALLBACK_RATES.generative.inputPerMillion);
      expect(unknownRate.outputPerMillion).toBe(CONSERVATIVE_FALLBACK_RATES.generative.outputPerMillion);
      // Must not silently assume gpt-6-luna rate
      expect(unknownRate.inputPerMillion).not.toBe(0.10);
    });

    test('applies explicit conservative fallback for unknown embedding models', () => {
      const unknownEmbedRate = getModelRate('custom-embedding-v9', { type: 'embedding' });
      expect(unknownEmbedRate.isFallback).toBe(true);
      expect(unknownEmbedRate.source).toBe('EXPLICIT_CONSERVATIVE_FALLBACK');
      expect(unknownEmbedRate.policy).toBe('EXPLICIT_CONSERVATIVE_UNVERIFIED_EMBEDDING');
      expect(unknownEmbedRate.inputPerMillion).toBe(CONSERVATIVE_FALLBACK_RATES.embedding.inputPerMillion);
    });

    test('honors explicit custom rates when supplied in options', () => {
      const custom = getModelRate('my-private-llm', {
        customRates: { inputPerMillion: 0.08, outputPerMillion: 0.32 }
      });
      expect(custom.source).toBe('CUSTOM_OVERRIDE');
      expect(custom.isFallback).toBe(false);
      expect(custom.inputPerMillion).toBe(0.08);
      expect(custom.outputPerMillion).toBe(0.32);
    });
  });

  describe('2. Generative Model Cost Calculation', () => {
    test('computes exact cost for GPT-6 Luna token usage', () => {
      // 1000 prompt tokens * $0.10/1M = $0.000100
      // 500 completion tokens * $0.50/1M = $0.000250
      // Total = $0.000350
      const cost = calculateModelCostUSD(1000, 500, 'gpt-6-luna');
      expect(cost).toBeCloseTo(0.000350, 7);
    });

    test('computes different cost when a different model is specified (e.g. gpt-4o-mini)', () => {
      // 1000 prompt tokens * $0.15/1M = $0.000150
      // 500 completion tokens * $0.60/1M = $0.000300
      // Total = $0.000450
      const costMini = calculateModelCostUSD(1000, 500, 'gpt-4o-mini');
      expect(costMini).toBeCloseTo(0.000450, 7);
      expect(costMini).not.toBe(calculateModelCostUSD(1000, 500, 'gpt-6-luna'));
    });

    test('handles zero and negative token inputs gracefully', () => {
      expect(calculateModelCostUSD(0, 0, 'gpt-6-luna')).toBe(0.0);
      expect(calculateModelCostUSD(-50, -20, 'gpt-6-luna')).toBe(0.0);
    });
  });

  describe('3. Embedding Token Cost & Cache Separation', () => {
    test('computes embedding cost using text-embedding-3-small rate ($0.02/1M)', () => {
      // 5,000 prompt tokens * $0.02/1M = $0.000100
      const embedCost = calculateEmbeddingCostUSD(5000, 'text-embedding-3-small');
      expect(embedCost).toBeCloseTo(0.000100, 7);

      // Verify embedding rate is NOT confused with generative model rate ($0.10/1M)
      const genCost = calculateModelCostUSD(5000, 0, 'gpt-6-luna');
      expect(genCost).toBeCloseTo(0.000500, 7);
      expect(genCost).toBe(embedCost * 5); // 5x difference verified
    });

    test('strictly separates cache hit ($0.00 actual cost) vs cache miss in metrics', () => {
      const metrics = calculateEmbeddingCacheMetrics({
        totalQueries: 10,
        cacheHits: 7,
        cacheMisses: 3,
        missPromptTokens: 150,
        estimatedTokensPerHit: 25,
        model: 'text-embedding-3-small'
      });

      expect(metrics.totalQueries).toBe(10);
      expect(metrics.cacheHits).toBe(7);
      expect(metrics.cacheMisses).toBe(3);
      expect(metrics.missPromptTokens).toBe(150);

      // Actual cost is ONLY from cache misses
      // 150 tokens * $0.02 / 1M = $0.000003
      expect(metrics.actualCostUSD).toBeCloseTo(0.000003, 8);

      // Avoided tokens from 7 cache hits = 7 * 25 = 175 tokens
      // Avoided cost = 175 * $0.02 / 1M = $0.0000035
      expect(metrics.avoidedTokens).toBe(175);
      expect(metrics.avoidedCostUSD).toBeCloseTo(0.0000035, 8);
      expect(metrics.isPureCache).toBe(false);
    });

    test('pure cache hit batch incurs strictly $0.00 actual cost', () => {
      const pureMetrics = calculateEmbeddingCacheMetrics({
        totalQueries: 5,
        cacheHits: 5,
        cacheMisses: 0,
        missPromptTokens: 0,
        estimatedTokensPerHit: 30,
        model: 'text-embedding-3-small'
      });

      expect(metricsCostZero(pureMetrics.actualCostUSD)).toBe(true);
      expect(pureMetrics.isPureCache).toBe(true);
      expect(pureMetrics.avoidedCostUSD).toBeGreaterThan(0.0);
    });
  });

  describe('4. Model-Proportional Reservations & Pre-Network Blocking', () => {
    test('calculateReservationUSD scales reservation with effective model rate', () => {
      // gpt-6-luna: 1200 prompt * 0.10/1M + 500 completion * 0.50/1M = 0.00012 + 0.000250 = $0.000370
      const lunaRes = calculateReservationUSD({
        model: 'gpt-6-luna',
        purpose: 'semantic_understanding'
      });
      expect(lunaRes).toBeCloseTo(0.000370, 6);

      // unverified-model: 1200 prompt * 2.50/1M + 500 completion * 10.00/1M = 0.00300 + 0.00500 = $0.008000
      const unverifiedRes = calculateReservationUSD({
        model: 'unverified-unknown-model',
        purpose: 'semantic_understanding'
      });
      expect(unverifiedRes).toBeCloseTo(0.008000, 6);
      expect(unverifiedRes).toBeGreaterThan(lunaRes * 20); // Much higher conservative reservation
    });

    test('reserveBudget blocks unverified model call and blocks verified model if budget ceiling exceeded', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const testDate = new Date('2026-10-22T08:00:00Z');

      // Daily budget ceiling is set to $0.00100
      const maxBudgetUSD = 0.00100;

      // 1. gpt-6-luna requires ~$0.000370 -> ALLOWED
      const allowedRes = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'gpt-6-luna',
        maxBudgetUSD,
        now: testDate
      });
      expect(allowedRes.allowed).toBe(true);

      // 2. unverified model -> REJECT_UNVERIFIED_MODEL before network call!
      const unverifiedRes = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'unverified-model-z',
        maxBudgetUSD,
        now: testDate
      });
      expect(unverifiedRes.allowed).toBe(false);
      expect(unverifiedRes.reason).toBe('REJECT_UNVERIFIED_MODEL');

      // 3. verified model gpt-4o requires $0.008000 > remaining ceiling ($0.00100 - $0.000370) -> DAILY_BUDGET_EXCEEDED!
      const exceededRes = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'gpt-4o',
        maxBudgetUSD,
        now: testDate
      });
      expect(exceededRes.allowed).toBe(false);
      expect(exceededRes.reason).toBe('DAILY_BUDGET_EXCEEDED');
      expect(exceededRes.attemptedReservationUSD).toBeCloseTo(0.008000, 5);
    });
  });

  describe('5. Error Classification & Ambiguous Failure Budget Retention', () => {
    test('classifyApiFailure distinguishes pre-request vs ambiguous in-flight errors', () => {
      // Pre-request:
      expect(classifyApiFailure(new Error('OPENAI_API_KEY_MISSING'))).toBe('PRE_REQUEST');
      expect(classifyApiFailure({ code: 'ECONNREFUSED' })).toBe('PRE_REQUEST');
      expect(classifyApiFailure({ status: 401 })).toBe('PRE_REQUEST');

      // Ambiguous in-flight:
      expect(classifyApiFailure(new Error('Request timed out after 4000ms'))).toBe('AMBIGUOUS_IN_FLIGHT');
      expect(classifyApiFailure({ name: 'AbortError' })).toBe('AMBIGUOUS_IN_FLIGHT');
      expect(classifyApiFailure({ code: 'ETIMEDOUT' })).toBe('AMBIGUOUS_IN_FLIGHT');
      expect(classifyApiFailure(new Error('socket hang up'))).toBe('AMBIGUOUS_IN_FLIGHT');
      expect(classifyApiFailure({ status: 504 })).toBe('AMBIGUOUS_IN_FLIGHT');
    });

    test('confirmed pre-request failure releases reservation completely with verified zero cost', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const testDate = new Date('2026-10-22T08:00:00Z');

      const res = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'gpt-6-luna',
        now: testDate
      });
      expect(res.allowed).toBe(true);

      const rec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        error: new Error('OPENAI_API_KEY_MISSING'),
        status: 'FAILED',
        now: testDate
      });

      expect(rec.reconciled).toBe(true);
      expect(rec.status).toBe('RELEASED');
      expect(rec.costStatus).toBe('VERIFIED_ZERO');
      expect(rec.actualCostUSD).toBe(0.0);

      const state = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(state.spentUSD).toBe(0.0);
      expect(state.reservedUSD).toBe(0.0);
      expect(state.ambiguousUSD).toBe(0.0);
    });

    test('ambiguous in-flight timeout retains reservation in ambiguousUSD against daily ceiling', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const testDate = new Date('2026-10-22T08:00:00Z');

      const maxBudgetUSD = 0.00050;

      const res = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'gpt-6-luna',
        maxBudgetUSD,
        now: testDate
      });
      expect(res.allowed).toBe(true);
      const reservedAmount = res.reservedUSD;

      // Reconcile timeout error
      const timeoutErr = new Error('Connection timed out while waiting for completion');
      timeoutErr.code = 'ETIMEDOUT';

      const rec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        error: timeoutErr,
        status: 'FAILED',
        now: testDate
      });

      // Crucial: Must NOT report zero actual cost or reconcile as successful
      expect(rec.reconciled).toBe(false);
      expect(rec.status).toBe('AMBIGUOUS_RETAINED');
      expect(rec.costStatus).toBe('UNKNOWN');
      expect(rec.actualCostUSD).toBeNull();
      expect(rec.ambiguousRetainedUSD).toBe(reservedAmount);

      const state = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(state.spentUSD).toBe(0.0);
      expect(state.reservedUSD).toBe(0.0);
      expect(state.ambiguousUSD).toBe(reservedAmount); // Retained against ceiling!

      // Attempting another large reservation that would exceed (ambiguousUSD + newRes > ceiling) is blocked!
      const blockedNext = await ledger.reserveBudget({
        purpose: 'grounded_synthesis', // requires ~$0.000550
        model: 'gpt-6-luna',
        maxBudgetUSD,
        now: testDate
      });
      expect(blockedNext.allowed).toBe(false);
      expect(blockedNext.reason).toBe('DAILY_BUDGET_EXCEEDED');
      expect(blockedNext.ambiguousUSD).toBe(reservedAmount);
    });

    test('repeated reconciliation calls on ambiguous failure are idempotent', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const testDate = new Date('2026-10-22T08:00:00Z');

      const res = await ledger.reserveBudget({
        purpose: 'semantic_understanding',
        model: 'gpt-6-luna',
        now: testDate
      });

      const rec1 = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        error: new Error('socket hang up'),
        status: 'FAILED',
        now: testDate
      });

      expect(rec1.status).toBe('AMBIGUOUS_RETAINED');
      expect(rec1.costStatus).toBe('UNKNOWN');

      // Call reconcile again with same reservationId
      const rec2 = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        error: new Error('socket hang up'),
        status: 'FAILED',
        now: testDate
      });

      expect(rec2.idempotentSkip).toBe(true);
      expect(rec2.status).toBe('AMBIGUOUS_RETAINED');
      expect(rec2.costStatus).toBe('UNKNOWN');
      expect(rec2.actualCostUSD).toBeNull();

      // ambiguousUSD should not be double-added
      const state = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(state.ambiguousUSD).toBe(res.reservedUSD);
    });

    test('getRemainingBudget strictly deducts ambiguousUSD alongside spentUSD and reservedUSD', async () => {
      const adapter = new MemoryPersistentAdapter();
      const ledger = new BudgetLedgerManager(adapter);
      const testDate = new Date('2026-10-22T08:00:00Z');

      const res = await ledger.reserveBudget({
        purpose: 'ambiguous_test_2',
        model: 'gpt-6-luna',
        now: testDate,
        maxBudgetUSD: 0.002
      });

      // Timeout in-flight failure
      await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        status: 'AMBIGUOUS_FAILURE',
        error: new Error('Request timed out.'),
        now: testDate
      });

      const budgetStatus = await ledger.getRemainingBudget({
        dateYMD: getMakassarDateYMD(testDate),
        maxBudgetUSD: 0.002
      });

      expect(budgetStatus.spentUSD).toBe(0.0);
      expect(budgetStatus.reservedUSD).toBe(0.0);
      expect(budgetStatus.ambiguousUSD).toBe(res.reservedUSD);
      expect(budgetStatus.remainingUSD).toBeCloseTo(0.002 - res.reservedUSD, 6);
      expect(budgetStatus.remainingUSD).not.toBe(0.002);
    });
  });

  describe('6. Ledger Reconciliation: Actual vs Conservative Reservation', () => {
    let adapter;
    let ledger;
    const testDate = new Date('2026-10-22T08:00:00Z');

    beforeEach(() => {
      adapter = new MemoryPersistentAdapter();
      ledger = new BudgetLedgerManager(adapter);
    });

    test('reconciles actual cost based on token usage and model, returning delta to budget pool', async () => {
      const res = await ledger.reserveBudget({
        purpose: 'grounded_synthesis',
        model: 'gpt-6-luna',
        now: testDate
      });

      expect(res.allowed).toBe(true);
      const initialReserved = res.reservedUSD;

      const rec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        actualPromptTokens: 400,
        actualCompletionTokens: 100,
        model: 'gpt-6-luna',
        status: 'SUCCESS',
        now: testDate
      });

      expect(rec.reconciled).toBe(true);
      expect(rec.status).toBe('SETTLED');
      expect(rec.costStatus).toBe('RECONCILED');
      expect(rec.actualCostUSD).toBeCloseTo(0.000090, 7);
      expect(rec.reservedUSD).toBe(initialReserved);
      expect(rec.differenceUSD).toBeCloseTo(initialReserved - 0.000090, 7);

      const finalState = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(finalState.spentUSD).toBeCloseTo(0.000090, 7);
      expect(finalState.reservedUSD).toBe(0.0);
      expect(finalState.spentUSD).not.toBe(initialReserved);
    });

    test('reconciles embedding batch at embedding rate, not generative model rate', async () => {
      const res = await ledger.reserveBudget({
        estimatedUSD: 0.000010,
        purpose: 'embedding_batch',
        model: 'text-embedding-3-small',
        now: testDate
      });

      const rec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        actualPromptTokens: 1000,
        actualCompletionTokens: 0,
        model: 'text-embedding-3-small',
        status: 'SUCCESS',
        now: testDate
      });

      expect(rec.reconciled).toBe(true);
      expect(rec.actualCostUSD).toBeCloseTo(0.000020, 7);
      expect(rec.ratePolicy).toBe('VERIFIED_CATALOG_RATE');
      expect(rec.isFallbackRate).toBe(false);

      const finalState = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(finalState.spentUSD).toBeCloseTo(0.000020, 7);
    });

    test('settling same reservation twice is idempotent and does not double charge', async () => {
      const res = await ledger.reserveBudget({
        purpose: 'idempotent_test',
        model: 'gpt-6-luna',
        now: testDate
      });

      const firstRec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        actualPromptTokens: 200,
        actualCompletionTokens: 50,
        model: 'gpt-6-luna',
        status: 'SUCCESS',
        now: testDate
      });

      expect(firstRec.reconciled).toBe(true);
      const spentAfterFirst = firstRec.totalSpentToday;

      const secondRec = await ledger.reconcileBudget({
        reservationId: res.reservationId,
        reservedUSD: res.reservedUSD,
        actualPromptTokens: 200,
        actualCompletionTokens: 50,
        model: 'gpt-6-luna',
        status: 'SUCCESS',
        now: testDate
      });

      expect(secondRec.reconciled).toBe(true);
      expect(secondRec.idempotentSkip).toBe(true);

      const state = await adapter.getDayLedger(getMakassarDateYMD(testDate));
      expect(state.spentUSD).toBe(spentAfterFirst);
    });
  });

  describe('7. Enforcement of Token Ceilings, Prompt Bounding, & Truncation Handling in Unified Engine', () => {
    let adapter;
    let ledger;

    beforeEach(() => {
      adapter = new MemoryPersistentAdapter();
      ledger = new BudgetLedgerManager(adapter);
    });

    test('Call 1 sends max_completion_tokens: 500 and Call 2 sends max_completion_tokens: 600 matching shared RESERVATION_TOKEN_CEILINGS', async () => {
      expect(RESERVATION_TOKEN_CEILINGS.call_1.maxCompletionTokens).toBe(500);
      expect(RESERVATION_TOKEN_CEILINGS.call_2.maxCompletionTokens).toBe(600);

      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 200, completion_tokens: 80 },
            content: {
              speechAct: 'INQUIRE_FACT',
              isPureSocialGreeting: false,
              entities: [{ raw: 'TI', canonicalId: 's1_ti' }],
              requestedAspects: [{ aspect: 'tuition_fee' }],
              normalizedSearchQueries: ['biaya TI']
            }
          })
          .mockResolvedValueOnce({
            usage: { prompt_tokens: 500, completion_tokens: 120 },
            content: {
              evidenceArbitration: { status: 'FULLY_SUPPORTED', usedChunkIds: ['C1'], unsupportedAspects: [] },
              factualClaims: [
                { claimText: 'Biaya S1 TI Rp 6.500.000', supportedByChunkId: 'C1', evidenceQuote: 'Biaya S1 TI Rp 6.500.000' }
              ],
              uncoveredAspects: [],
              naturalAnswer: 'Halo Kak! Biaya S1 TI adalah Rp 6.500.000 per semester.'
            }
          })
      };

      const candidates = [
        { id: 'C1', access_classification: 'PUBLIC_OFFICIAL', text: 'Biaya S1 TI Rp 6.500.000 per semester.' }
      ];

      await processUnifiedTurn('chat_ceilings_test', 'Berapa biaya TI?', {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        candidateEvidence: candidates
      });

      expect(mockAiClient.chatCompletionsCreate).toHaveBeenCalledTimes(2);

      // Verify exact parameter sent to API matches shared ceiling configuration
      const call1Args = mockAiClient.chatCompletionsCreate.mock.calls[0][0];
      expect(call1Args.max_completion_tokens).toBe(RESERVATION_TOKEN_CEILINGS.call_1.maxCompletionTokens);
      expect(call1Args.max_completion_tokens).toBe(500);

      const call2Args = mockAiClient.chatCompletionsCreate.mock.calls[1][0];
      expect(call2Args.max_completion_tokens).toBe(RESERVATION_TOKEN_CEILINGS.call_2.maxCompletionTokens);
      expect(call2Args.max_completion_tokens).toBe(600);
    });

    test('processUnifiedTurn dynamically calculates reservation for configured model and does not use hardcoded amounts', async () => {
      const mockAiClient = {
        chatCompletionsCreate: jest.fn().mockResolvedValue({
          usage: { prompt_tokens: 150, completion_tokens: 40 },
          content: {
            speechAct: 'GENERAL_GREETING',
            isPureSocialGreeting: true,
            entities: [],
            requestedAspects: [],
            normalizedSearchQueries: []
          }
        })
      };

      // Turn on gpt-4o-mini (rate: $0.15/1M prompt, $0.60/1M completion)
      // Call 1 ceiling: 1200 * 0.15/1M + 500 * 0.60/1M = 0.00018 + 0.00030 = $0.00048
      const result = await processUnifiedTurn('chat_dynamic_rate', 'Halo selamat pagi', {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        model: 'gpt-4o-mini'
      });

      expect(result.telemetry.reservedCostUSD).toBeCloseTo(0.00048, 5);
      // Confirmed: does NOT use the old static $0.00020
      expect(result.telemetry.reservedCostUSD).not.toBe(0.00020);
    });

    test('unverified generative model is rejected pre-network with REJECT_UNVERIFIED_MODEL without calling mock API', async () => {
      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
      };

      const result = await processUnifiedTurn('chat_unverified_model', 'Berapa biaya?', {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        model: 'unapproved-unknown-model-xyz'
      });

      expect(mockAiClient.chatCompletionsCreate).not.toHaveBeenCalled();
      expect(result.isLocalFallback).toBe(true);
      expect(result.unverifiedModel).toBe(true);
      expect(result.fallbackReason).toBe('REJECT_UNVERIFIED_MODEL');
    });

    test('oversized input prompt exceeding maxPromptTokens is rejected pre-network and does not call mock API', async () => {
      const mockAiClient = {
        chatCompletionsCreate: jest.fn()
      };

      // An enormous single query of 4,000 characters (> 1,200 tokens)
      const massiveQuery = 'Berapa biaya kuliah prodi ' + 'sangat panjang '.repeat(400);

      const result = await processUnifiedTurn('chat_huge_prompt', massiveQuery, {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      expect(mockAiClient.chatCompletionsCreate).not.toHaveBeenCalled();
      expect(result.isLocalFallback).toBe(true);
      expect(result.fallbackReason).toBe('PROMPT_CEILING_EXCEEDED');
    });

    test('response truncated by token limit (finish_reason: length) triggers safe local fallback and does not return unvalidated output', async () => {
      const mockAiClient = {
        chatCompletionsCreate: jest.fn().mockResolvedValue({
          finish_reason: 'length',
          content: '{"speechAct":"INQUIRE_FACT","partial...'
        })
      };

      const result = await processUnifiedTurn('chat_truncated_length', 'Berapa biaya?', {
        budgetLedger: ledger,
        aiClient: mockAiClient,
        model: 'gpt-6-luna'
      });

      expect(result.isLocalFallback).toBe(true);
      expect(result.fallbackReason).toContain('OUTPUT_TRUNCATED_BY_MAX_COMPLETION_TOKENS');
      expect(result.finalAnswer).toContain('Layanan Informasi PMB ITB STIKOM Bali');
    });

    test('uncached embedding request with unverified model is rejected and falls back safely to lexical/BM25 without network call', async () => {
      clearQueryEmbeddingCache();
      setBudgetLedger(ledger);

      const originalEmbedModel = process.env.EMBEDDING_MODEL;

      try {
        process.env.EMBEDDING_MODEL = 'unverified-custom-embedder';

        // An uncached query
        const results = await computeBatchQueryEmbeddings(['pertanyaan unik tak tercache ' + Date.now()]);

        // Fail-closed to lexical/BM25 mode: returns array with null vector so caller falls back to lexical
        expect(Array.isArray(results)).toBe(true);
        expect(results[0]).toBeNull();
      } finally {
        if (originalEmbedModel !== undefined) {
          process.env.EMBEDDING_MODEL = originalEmbedModel;
        } else {
          delete process.env.EMBEDDING_MODEL;
        }
      }
    });
  });

});

function metricsCostZero(val) {
  return val === 0 || Math.abs(val) < 1e-12;
}
