'use strict';

/**
 * src/core/budgetLedger.js
 *
 * Persistent, Atomic, Multi-Worker API Budget Ledger for Tiko V2.
 * Enforces hard daily spend limits across distributed workers and containers using PostgreSQL/Prisma.
 *
 * Invariants:
 * 1. Timezone: Operational day boundary is strictly Asia/Makassar (WITA / UTC+8).
 * 2. Fail-Closed: If persistent ledger is unavailable or unreachable, no paid API calls are allowed.
 * 3. Per-Call Reservation: Every model invocation (Call 1 and Call 2) must acquire an atomic reservation.
 * 4. Idempotent Reconciliation: Settling or releasing a reservation ID can be called multiple times safely.
 * 5. Multi-Worker Concurrency: Uses database-level transaction and advisory xact lock to serialize concurrent
 *    reservations, including handling the initial row creation race condition.
 */

const logger = require('../logger');

/**
 * Formats a Date into YYYY-MM-DD in Asia/Makassar timezone.
 */
function getMakassarDateYMD(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * Known model pricing catalog (USD per 1,000,000 tokens).
 * Public OpenAI standard rates:
 * - GPT-6 Luna: $0.10 / 1M input tokens, $0.50 / 1M output tokens
 * - text-embedding-3-small: $0.02 / 1M input tokens
 * - text-embedding-3-large: $0.13 / 1M input tokens
 * - GPT-4o-mini: $0.15 / 1M input tokens, $0.60 / 1M output tokens
 * - GPT-4o: $2.50 / 1M input tokens, $10.00 / 1M output tokens
 */
const MODEL_PRICING_CATALOG = Object.freeze({
  'gpt-6-luna': {
    inputPerMillion: 0.10,
    outputPerMillion: 0.50,
    type: 'generative',
    description: 'OpenAI GPT-6 Luna standard rates ($0.10/1M input, $0.50/1M output)'
  },
  'text-embedding-3-small': {
    inputPerMillion: 0.02,
    outputPerMillion: 0.00,
    type: 'embedding',
    description: 'OpenAI text-embedding-3-small rate ($0.02/1M input)'
  },
  'text-embedding-3-large': {
    inputPerMillion: 0.13,
    outputPerMillion: 0.00,
    type: 'embedding',
    description: 'OpenAI text-embedding-3-large rate ($0.13/1M input)'
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.60,
    type: 'generative',
    description: 'OpenAI GPT-4o-mini standard rates ($0.15/1M input, $0.60/1M output)'
  },
  'gpt-4o': {
    inputPerMillion: 2.50,
    outputPerMillion: 10.00,
    type: 'generative',
    description: 'OpenAI GPT-4o standard rates ($2.50/1M input, $10.00/1M output)'
  }
});

/**
 * Explicit conservative fallback policy when model pricing is unverified or unknown.
 * Invariant: Never silently assume another model's rate (e.g. gpt-6-luna) for an unverified model.
 */
const CONSERVATIVE_FALLBACK_RATES = Object.freeze({
  generative: {
    inputPerMillion: 2.50,
    outputPerMillion: 10.00,
    policy: 'EXPLICIT_CONSERVATIVE_UNVERIFIED_GENERATIVE',
    description: 'Conservative upper-tier fallback rate for unverified generative models ($2.50/1M input, $10.00/1M output)'
  },
  embedding: {
    inputPerMillion: 0.13,
    outputPerMillion: 0.00,
    policy: 'EXPLICIT_CONSERVATIVE_UNVERIFIED_EMBEDDING',
    description: 'Conservative upper-tier fallback rate for unverified embedding models ($0.13/1M input)'
  }
});

/**
 * Resolves token rates for a configured model.
 * If model is known in catalog, returns verified rate.
 * If custom override provided in options, returns custom rate.
 * If model is unverified/unknown, applies explicit conservative fallback policy without guessing.
 */
function getModelRate(modelName, options = {}) {
  if (options.customRates && typeof options.customRates.inputPerMillion === 'number') {
    return {
      model: modelName || 'custom',
      inputPerMillion: options.customRates.inputPerMillion,
      outputPerMillion: typeof options.customRates.outputPerMillion === 'number' ? options.customRates.outputPerMillion : 0.0,
      type: options.type || (options.customRates.outputPerMillion > 0 ? 'generative' : 'embedding'),
      source: 'CUSTOM_OVERRIDE',
      policy: 'CUSTOM_OVERRIDE',
      isFallback: false
    };
  }

  const normalized = (modelName || '').toString().trim().toLowerCase();

  if (normalized && MODEL_PRICING_CATALOG[normalized]) {
    const entry = MODEL_PRICING_CATALOG[normalized];
    return {
      model: normalized,
      inputPerMillion: entry.inputPerMillion,
      outputPerMillion: entry.outputPerMillion,
      type: entry.type,
      source: 'KNOWN_CATALOG',
      policy: 'VERIFIED_CATALOG_RATE',
      isFallback: false,
      description: entry.description
    };
  }

  // Model is unknown or unverified. Apply explicit conservative fallback.
  const isEmbedding = options.type === 'embedding' ||
                      (normalized && (normalized.includes('embedding') || normalized.includes('embed')));
  const fallback = isEmbedding
    ? CONSERVATIVE_FALLBACK_RATES.embedding
    : CONSERVATIVE_FALLBACK_RATES.generative;

  if (normalized && logger && typeof logger.warn === 'function') {
    logger.warn({ model: modelName, policy: fallback.policy }, '[BudgetLedger] Model price unverified; applying explicit conservative fallback policy');
  }

  return {
    model: normalized || 'unspecified_model',
    inputPerMillion: fallback.inputPerMillion,
    outputPerMillion: fallback.outputPerMillion,
    type: isEmbedding ? 'embedding' : 'generative',
    source: 'EXPLICIT_CONSERVATIVE_FALLBACK',
    policy: fallback.policy,
    isFallback: true,
    description: fallback.description
  };
}

/**
 * Calculates actual generative model cost in USD based on token counts and model rates.
 * Defaults to configured GPT-6 Luna rates if model is not specified.
 */
function calculateModelCostUSD(promptTokens = 0, completionTokens = 0, modelOrOptions = 'gpt-6-luna') {
  const pTokens = Math.max(0, Number(promptTokens) || 0);
  const cTokens = Math.max(0, Number(completionTokens) || 0);

  const rateInfo = typeof modelOrOptions === 'object' && modelOrOptions !== null
    ? getModelRate(modelOrOptions.model, modelOrOptions)
    : getModelRate(modelOrOptions);

  const inputCost = (pTokens * rateInfo.inputPerMillion) / 1000000;
  const outputCost = (cTokens * rateInfo.outputPerMillion) / 1000000;
  return inputCost + outputCost;
}

/**
 * Calculates actual embedding cost in USD based on input prompt tokens and embedding model rates.
 * Defaults to configured text-embedding-3-small rates ($0.02 / 1M tokens).
 */
function calculateEmbeddingCostUSD(promptTokens = 0, modelOrOptions = 'text-embedding-3-small') {
  const pTokens = Math.max(0, Number(promptTokens) || 0);
  const rateInfo = typeof modelOrOptions === 'object' && modelOrOptions !== null
    ? getModelRate(modelOrOptions.model || 'text-embedding-3-small', { ...modelOrOptions, type: 'embedding' })
    : getModelRate(modelOrOptions, { type: 'embedding' });

  return (pTokens * rateInfo.inputPerMillion) / 1000000;
}

/**
 * Detailed embedding cost & cache metrics calculator.
 * Strictly separates cache hits ($0.00 actual cost) and cache misses (paid API calls).
 */
function calculateEmbeddingCacheMetrics({
  totalQueries = 0,
  cacheHits = 0,
  cacheMisses = 0,
  missPromptTokens = 0,
  estimatedTokensPerHit = 25,
  model = 'text-embedding-3-small'
} = {}) {
  const actualCostUSD = calculateEmbeddingCostUSD(missPromptTokens, model);
  const avoidedTokens = cacheHits * estimatedTokensPerHit;
  const avoidedCostUSD = calculateEmbeddingCostUSD(avoidedTokens, model);

  return {
    model,
    totalQueries,
    cacheHits,
    cacheMisses,
    missPromptTokens,
    avoidedTokens,
    actualCostUSD,
    avoidedCostUSD,
    isPureCache: cacheMisses === 0 && cacheHits > 0
  };
}

/**
 * Upper-bound token estimates for conservative budget reservations before API calls.
 */
const RESERVATION_TOKEN_CEILINGS = Object.freeze({
  call_1: {
    maxPromptTokens: 1200,
    maxCompletionTokens: 500
  },
  semantic_understanding: {
    maxPromptTokens: 1200,
    maxCompletionTokens: 500
  },
  call_2: {
    maxPromptTokens: 2500,
    maxCompletionTokens: 600
  },
  grounded_synthesis: {
    maxPromptTokens: 2500,
    maxCompletionTokens: 600
  },
  default_generative: {
    maxPromptTokens: 2000,
    maxCompletionTokens: 500
  },
  embedding_batch: {
    maxPromptTokens: 128
  },
  embedding: {
    maxPromptTokens: 128
  }
});

/**
 * Calculates conservative initial reservation cost in USD based on purpose, token ceilings, and model rates.
 * Invariant: Never under-reserves; scales strictly with the configured model rate (including unverified models).
 */
function calculateReservationUSD({
  model = null,
  purpose = 'semantic_understanding',
  maxPromptTokens = null,
  maxCompletionTokens = null,
  estimatedUSD = null,
  customRates = null
} = {}) {
  if (estimatedUSD != null && typeof estimatedUSD === 'number') {
    return estimatedUSD;
  }

  const normalizedModel = model || process.env.OPENAI_MODEL || 'gpt-6-luna';
  const isEmbedding = purpose === 'embedding_batch' || purpose === 'embedding' || (normalizedModel && (normalizedModel.includes('embedding') || normalizedModel.includes('embed')));

  if (isEmbedding) {
    const embedModel = model || 'text-embedding-3-small';
    const tokens = maxPromptTokens != null ? maxPromptTokens : RESERVATION_TOKEN_CEILINGS.embedding_batch.maxPromptTokens;
    return Math.max(0.000001, calculateEmbeddingCostUSD(tokens, embedModel));
  }

  const ceilings = RESERVATION_TOKEN_CEILINGS[purpose] || RESERVATION_TOKEN_CEILINGS.default_generative;
  const pTokens = maxPromptTokens != null ? maxPromptTokens : ceilings.maxPromptTokens;
  const cTokens = maxCompletionTokens != null ? maxCompletionTokens : ceilings.maxCompletionTokens;

  return calculateModelCostUSD(pTokens, cTokens, customRates ? { model: normalizedModel, customRates } : normalizedModel);
}

/**
 * Classifies an API error to determine if failure occurred provably before request dispatch
 * or in-flight where server-side processing/token consumption is ambiguous.
 */
function classifyApiFailure(error) {
  if (!error) return 'PRE_REQUEST';

  const msg = (error.message || '').toLowerCase();
  const code = (error.code || '').toUpperCase();
  const name = error.name || '';
  const status = Number(error.status) || 0;

  // Definite pre-request failures: request was blocked or rejected before reaching API server
  if (
    msg.includes('api_key_missing') ||
    msg.includes('persistent_ledger_unavailable') ||
    msg.includes('validation') ||
    msg.includes('bad request') ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    msg.includes('getaddrinfo enotfound')
  ) {
    return 'PRE_REQUEST';
  }

  // Ambiguous failures: request was in-flight / dispatched; server processing state is unknown
  if (
    name === 'AbortError' ||
    name === 'APIConnectionTimeoutError' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('socket hang up') ||
    msg.includes('connection reset') ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return 'AMBIGUOUS_IN_FLIGHT';
  }

  // Any other communication error defaults conservatively to ambiguous in-flight
  return 'AMBIGUOUS_IN_FLIGHT';
}

/**
 * Resolves maximum daily budget from environment or default $0.50.
 */
function getDailyBudgetCeiling() {
  const envVal = parseFloat(process.env.MAX_DAILY_API_BUDGET_USD);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 0.50;
}

/**
 * In-memory ledger adapter for test injection or isolated mock environments.
 * Implements strict async queue mutex to serialize concurrent reservations per date.
 */
class MemoryPersistentAdapter {
  constructor() {
    this.store = new Map();
    this.mutexQueues = new Map();
  }

  async acquireMutex(dateYMD) {
    while (this.mutexQueues.get(dateYMD)) {
      await this.mutexQueues.get(dateYMD);
    }
    let release;
    const p = new Promise(resolve => { release = resolve; });
    this.mutexQueues.set(dateYMD, p);
    return () => {
      this.mutexQueues.delete(dateYMD);
      release();
    };
  }

  async executeAtomic(dateYMD, mutatorFn) {
    const release = await this.acquireMutex(dateYMD);
    try {
      const raw = this.store.get(dateYMD);
      const ledger = raw
        ? JSON.parse(JSON.stringify(raw))
        : { dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} };

      const { updatedLedger, result } = await mutatorFn(ledger);
      if (updatedLedger) {
        this.store.set(dateYMD, JSON.parse(JSON.stringify(updatedLedger)));
      }
      return result;
    } finally {
      release();
    }
  }

  async getDayLedger(dateYMD) {
    const raw = this.store.get(dateYMD);
    if (!raw) return { dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} };
    return JSON.parse(JSON.stringify(raw));
  }
}

/**
 * Prisma / PostgreSQL Persistent Ledger Adapter.
 * Uses Prisma's Setting model (key: BUDGET_LEDGER_YYYY-MM-DD) inside an interactive transaction.
 *
 * Concurrency & Initial Row Race Condition:
 * 1. Acquires a PostgreSQL transaction-level advisory lock: pg_advisory_xact_lock(hashtext(key)).
 *    This serializes concurrent transactions on the exact key even when the Setting row does not exist yet.
 * 2. Checks if the Setting row exists. If not, safely inserts the initial record.
 * 3. Reads the latest committed ledger state, executes the mutator function (reserve/reconcile),
 *    and updates the Setting row within the same transaction.
 */
class PrismaSettingAdapter {
  constructor(prismaClient) {
    this.prisma = prismaClient;
  }

  getSettingKey(dateYMD) {
    return `BUDGET_LEDGER_${dateYMD}`;
  }

  async executeAtomic(dateYMD, mutatorFn) {
    if (!this.prisma) {
      throw new Error('PRISMA_CLIENT_NOT_INITIALIZED');
    }

    const key = this.getSettingKey(dateYMD);

    return await this.prisma.$transaction(async (tx) => {
      // 1. Acquire transaction advisory lock on PostgreSQL to serialize concurrent requests
      try {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      } catch (lockErr) {
        // If underlying DB engine does not support pg_advisory_xact_lock (e.g. SQLite), proceed with row ensure
        logger.debug({ err: lockErr.message }, '[BudgetLedger] pg_advisory_xact_lock unavailable or skipped');
      }

      // 2. Safely ensure initial row exists
      let record = await tx.setting.findUnique({ where: { key } });
      if (!record) {
        try {
          record = await tx.setting.create({
            data: {
              key,
              value: JSON.stringify({ dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} })
            }
          });
        } catch (createErr) {
          // If concurrent transaction created it between check and insert, re-fetch
          record = await tx.setting.findUnique({ where: { key } });
        }
      }

      // 3. Parse current ledger from row
      let currentLedger = { dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} };
      if (record && record.value) {
        try {
          currentLedger = JSON.parse(record.value);
        } catch (_) {}
      }

      // 4. Execute atomic mutation
      const { updatedLedger, result } = await mutatorFn(currentLedger);

      // 5. Update row if changed
      if (updatedLedger) {
        await tx.setting.update({
          where: { key },
          data: { value: JSON.stringify(updatedLedger) }
        });
      }

      return result;
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5000
    });
  }

  async getDayLedger(dateYMD) {
    const key = this.getSettingKey(dateYMD);
    const record = await this.prisma.setting.findUnique({ where: { key } });
    if (!record || !record.value) {
      return { dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} };
    }
    try {
      return JSON.parse(record.value);
    } catch (_) {
      return { dateYMD, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0, settlements: {} };
    }
  }
}

/**
 * Main Budget Ledger Manager.
 */
class BudgetLedgerManager {
  constructor(adapter = null) {
    this.adapter = adapter;
  }

  /**
   * Sets or overrides the persistent storage adapter.
   */
  setAdapter(adapter) {
    this.adapter = adapter;
  }

  /**
   * Determines if a valid persistent storage adapter is configured.
   */
  isAvailable() {
    return Boolean(this.adapter && typeof this.adapter.executeAtomic === 'function');
  }

  /**
   * Phase 1: Atomically checks daily ceiling and reserves estimated cost.
   * Dynamically calculates required reservation based on configured model rates and token ceilings.
   * Fails closed if adapter is missing or budget is exceeded.
   */
  async reserveBudget({
    estimatedUSD = null,
    maxPromptTokens = null,
    maxCompletionTokens = null,
    purpose = 'call_1',
    maxBudgetUSD = null,
    model = null,
    customRates = null,
    now = new Date()
  } = {}) {
    if (!this.isAvailable()) {
      return {
        allowed: false,
        reason: 'PERSISTENT_LEDGER_UNAVAILABLE',
        error: 'No persistent budget ledger is connected. Refusing paid model call to prevent unmetered spend.'
      };
    }

    const effectiveModel = model || process.env.OPENAI_MODEL || 'gpt-6-luna';
    const isEmbedding = (purpose === 'embedding_batch' || purpose === 'embedding');
    const rateInfo = getModelRate(effectiveModel, {
      type: isEmbedding ? 'embedding' : 'generative',
      customRates
    });

    // Policy: Reject unverified model without approved pricing pre-network (fail-closed)
    if (rateInfo.isFallback) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn({ model: effectiveModel, purpose }, '[BudgetLedger] Model is unverified and has no approved catalog rate. Rejecting pre-network.');
      }
      return {
        allowed: false,
        reason: 'REJECT_UNVERIFIED_MODEL',
        error: `Model "${effectiveModel}" is unverified in catalog and has no approved pricing. Pre-network call rejected.`,
        model: effectiveModel
      };
    }

    const requiredReservationUSD = calculateReservationUSD({
      model: effectiveModel,
      purpose,
      maxPromptTokens,
      maxCompletionTokens,
      estimatedUSD,
      customRates
    });

    const dateYMD = getMakassarDateYMD(now);
    const ceiling = maxBudgetUSD != null ? maxBudgetUSD : getDailyBudgetCeiling();
    const reservationId = `res_${dateYMD}_${purpose}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      return await this.adapter.executeAtomic(dateYMD, async (ledger) => {
        const currentSpent = ledger.spentUSD || 0.0;
        const currentReserved = ledger.reservedUSD || 0.0;
        const currentAmbiguous = ledger.ambiguousUSD || 0.0;

        if (currentSpent + currentReserved + currentAmbiguous + requiredReservationUSD > ceiling) {
          return {
            updatedLedger: null,
            result: {
              allowed: false,
              reason: 'DAILY_BUDGET_EXCEEDED',
              spentUSD: currentSpent,
              reservedUSD: currentReserved,
              ambiguousUSD: currentAmbiguous,
              attemptedReservationUSD: requiredReservationUSD,
              maxBudgetUSD: ceiling,
              dateYMD,
              model: effectiveModel
            }
          };
        }

        // Record reservation atomically with model tracking
        ledger.reservedUSD = currentReserved + requiredReservationUSD;
        if (!ledger.settlements) ledger.settlements = {};
        ledger.settlements[reservationId] = {
          status: 'ACTIVE',
          purpose,
          model: effectiveModel,
          reservedUSD: requiredReservationUSD,
          createdAt: new Date().toISOString()
        };

        return {
          updatedLedger: ledger,
          result: {
            allowed: true,
            reservationId,
            dateYMD,
            reservedUSD: requiredReservationUSD,
            spentUSD: currentSpent,
            ambiguousUSD: currentAmbiguous,
            maxBudgetUSD: ceiling,
            model: effectiveModel
          }
        };
      });
    } catch (err) {
      logger.error({ err: err.message, dateYMD }, '[BudgetLedger] Failed to acquire budget reservation');
      return {
        allowed: false,
        reason: 'PERSISTENT_LEDGER_ERROR',
        error: err.message
      };
    }
  }

  /**
   * Phase 2: Idempotently reconciles reservation with actual token usage and configured model rates.
   * If status is 'SUCCESS', releases reservation and adds actual cost calculated from model rates.
   * If failure is confirmed pre-request, releases reservation with zero cost.
   * If failure is ambiguous/timeout in-flight, retains conservative reservation against ceiling as ambiguousUSD.
   */
  async reconcileBudget({
    reservationId,
    reservedUSD,
    actualPromptTokens = 0,
    actualCompletionTokens = 0,
    status = 'SUCCESS',
    error = null,
    isPreRequest = null,
    model = null,
    dateYMD = null,
    now = new Date()
  } = {}) {
    if (!this.isAvailable()) {
      return {
        reconciled: false,
        reason: 'PERSISTENT_LEDGER_UNAVAILABLE',
        actualCostUSD: 0.0
      };
    }

    if (!reservationId) {
      return { reconciled: false, reason: 'MISSING_RESERVATION_ID', actualCostUSD: 0.0 };
    }

    const effectiveDateYMD = dateYMD || getMakassarDateYMD(now);

    try {
      return await this.adapter.executeAtomic(effectiveDateYMD, async (ledger) => {
        if (!ledger.settlements) ledger.settlements = {};

        const existingSettlement = ledger.settlements[reservationId];

        // Idempotency: If already settled, released, or retained as ambiguous, do not process twice
        if (existingSettlement && (
          existingSettlement.status === 'SETTLED' ||
          existingSettlement.status === 'RELEASED' ||
          existingSettlement.status === 'AMBIGUOUS_RETAINED'
        )) {
          return {
            updatedLedger: null,
            result: {
              reconciled: existingSettlement.status === 'SETTLED',
              idempotentSkip: true,
              reservationId,
              status: existingSettlement.status,
              costStatus: existingSettlement.costStatus,
              actualCostUSD: existingSettlement.actualCostUSD,
              reservedUSD: existingSettlement.reservedUSD || 0.0,
              ambiguousRetainedUSD: existingSettlement.ambiguousRetainedUSD || 0.0,
              differenceUSD: existingSettlement.differenceUSD || 0.0,
              totalSpentToday: ledger.spentUSD,
              totalReservedToday: ledger.reservedUSD,
              totalAmbiguousToday: ledger.ambiguousUSD || 0.0
            }
          };
        }

        const effectiveModel = model || existingSettlement?.model || null;
        const isEmbeddingPurpose = existingSettlement?.purpose === 'embedding_batch' ||
                                   (effectiveModel && (effectiveModel.includes('embedding') || effectiveModel.includes('embed')));

        const releaseAmount = existingSettlement?.reservedUSD || reservedUSD || 0.0;

        const hasKnownUsage = (Number(actualPromptTokens) > 0 || Number(actualCompletionTokens) > 0);

        // SUCCESS or KNOWN USAGE path: verified token usage metadata present
        if (status === 'SUCCESS' || hasKnownUsage) {
          let actualCostUSD = 0.0;
          let rateInfo = null;

          if (isEmbeddingPurpose) {
            const embedModel = effectiveModel || 'text-embedding-3-small';
            actualCostUSD = calculateEmbeddingCostUSD(actualPromptTokens, embedModel);
            rateInfo = getModelRate(embedModel, { type: 'embedding' });
          } else {
            const genModel = effectiveModel || process.env.OPENAI_MODEL || 'gpt-6-luna';
            actualCostUSD = calculateModelCostUSD(actualPromptTokens, actualCompletionTokens, genModel);
            rateInfo = getModelRate(genModel, { type: 'generative' });
          }

          ledger.reservedUSD = Math.max(0, (ledger.reservedUSD || 0.0) - releaseAmount);
          ledger.spentUSD = (ledger.spentUSD || 0.0) + actualCostUSD;
          const differenceUSD = releaseAmount - actualCostUSD;

          ledger.settlements[reservationId] = {
            status: 'SETTLED',
            costStatus: 'RECONCILED',
            purpose: existingSettlement?.purpose || 'unknown',
            model: effectiveModel,
            reservedUSD: releaseAmount,
            actualCostUSD,
            actualPromptTokens,
            actualCompletionTokens,
            differenceUSD,
            unreconciledReason: status !== 'SUCCESS' ? (error?.message || status) : null,
            rateInfo: rateInfo ? {
              model: rateInfo.model,
              inputPerMillion: rateInfo.inputPerMillion,
              outputPerMillion: rateInfo.outputPerMillion,
              policy: rateInfo.policy,
              isFallback: rateInfo.isFallback
            } : null,
            settledAt: new Date().toISOString()
          };

          return {
            updatedLedger: ledger,
            result: {
              reconciled: true,
              reservationId,
              status: 'SETTLED',
              costStatus: 'RECONCILED',
              actualCostUSD,
              reservedUSD: releaseAmount,
              differenceUSD,
              totalSpentToday: ledger.spentUSD,
              totalReservedToday: ledger.reservedUSD,
              totalAmbiguousToday: ledger.ambiguousUSD || 0.0,
              model: effectiveModel,
              ratePolicy: rateInfo ? rateInfo.policy : 'NONE',
              isFallbackRate: Boolean(rateInfo && rateInfo.isFallback)
            }
          };
        }

        // Failure handling: classify whether failure is confirmed pre-request or ambiguous in-flight
        const failureType = (status === 'AMBIGUOUS_FAILURE')
          ? 'AMBIGUOUS_IN_FLIGHT'
          : (isPreRequest === true ? 'PRE_REQUEST' : (isPreRequest === false ? 'AMBIGUOUS_IN_FLIGHT' : classifyApiFailure(error)));

        if (failureType === 'PRE_REQUEST') {
          // Confirmed pre-request failure: request was blocked before reaching API server; 0.0 cost is verified
          ledger.reservedUSD = Math.max(0, (ledger.reservedUSD || 0.0) - releaseAmount);
          const differenceUSD = releaseAmount;

          ledger.settlements[reservationId] = {
            status: 'RELEASED',
            costStatus: 'VERIFIED_ZERO',
            purpose: existingSettlement?.purpose || 'unknown',
            model: effectiveModel,
            reservedUSD: releaseAmount,
            actualCostUSD: 0.0,
            actualPromptTokens: 0,
            actualCompletionTokens: 0,
            differenceUSD,
            settledAt: new Date().toISOString()
          };

          return {
            updatedLedger: ledger,
            result: {
              reconciled: true,
              reservationId,
              status: 'RELEASED',
              costStatus: 'VERIFIED_ZERO',
              actualCostUSD: 0.0,
              reservedUSD: releaseAmount,
              differenceUSD,
              totalSpentToday: ledger.spentUSD,
              totalReservedToday: ledger.reservedUSD,
              totalAmbiguousToday: ledger.ambiguousUSD || 0.0,
              model: effectiveModel
            }
          };
        }

        // AMBIGUOUS_IN_FLIGHT: Timeout or network drop midway.
        // Server may have processed tokens and billed the API key.
        // Retain conservative reservation against daily ceiling as ambiguousUSD; do NOT claim actual cost is 0.0.
        ledger.reservedUSD = Math.max(0, (ledger.reservedUSD || 0.0) - releaseAmount);
        ledger.ambiguousUSD = (ledger.ambiguousUSD || 0.0) + releaseAmount;

        ledger.settlements[reservationId] = {
          status: 'AMBIGUOUS_RETAINED',
          costStatus: 'UNKNOWN',
          purpose: existingSettlement?.purpose || 'unknown',
          model: effectiveModel,
          reservedUSD: releaseAmount,
          actualCostUSD: null, // Strictly null, NOT 0.0!
          ambiguousRetainedUSD: releaseAmount,
          differenceUSD: 0.0,
          unreconciledReason: error?.message || 'AMBIGUOUS_IN_FLIGHT_FAILURE',
          settledAt: new Date().toISOString()
        };

        return {
          updatedLedger: ledger,
          result: {
            reconciled: false,
            reservationId,
            status: 'AMBIGUOUS_RETAINED',
            costStatus: 'UNKNOWN',
            actualCostUSD: null,
            reservedUSD: releaseAmount,
            ambiguousRetainedUSD: releaseAmount,
            differenceUSD: 0.0,
            totalSpentToday: ledger.spentUSD,
            totalReservedToday: ledger.reservedUSD,
            totalAmbiguousToday: ledger.ambiguousUSD,
            model: effectiveModel,
            note: 'Ambiguous in-flight failure: server execution unknown. Budget reservation retained against ceiling to prevent unmetered spend.'
          }
        };
      });
    } catch (err) {
      logger.error({ err: err.message, reservationId }, '[BudgetLedger] Failed to reconcile budget');
      return {
        reconciled: false,
        reason: 'PERSISTENT_LEDGER_ERROR',
        error: err.message,
        actualCostUSD: null
      };
    }
  }

  /**
   * Returns consistent remaining budget taking into account spentUSD, active reservedUSD,
   * and ambiguous in-flight retained reservations (ambiguousUSD).
   */
  async getRemainingBudget({ dateYMD = null, maxBudgetUSD = null, now = new Date() } = {}) {
    if (!this.isAvailable()) {
      return { available: false, remainingUSD: 0.0, ceilingUSD: 0.0, spentUSD: 0.0, reservedUSD: 0.0, ambiguousUSD: 0.0 };
    }
    const effectiveDateYMD = dateYMD || getMakassarDateYMD(now);
    const ceiling = maxBudgetUSD != null ? maxBudgetUSD : getDailyBudgetCeiling();
    const ledger = await this.adapter.getDayLedger(effectiveDateYMD);
    const spentUSD = ledger.spentUSD || 0.0;
    const reservedUSD = ledger.reservedUSD || 0.0;
    const ambiguousUSD = ledger.ambiguousUSD || 0.0;
    const remainingUSD = Math.max(0, ceiling - (spentUSD + reservedUSD + ambiguousUSD));
    return {
      available: true,
      dateYMD: effectiveDateYMD,
      ceilingUSD: ceiling,
      spentUSD,
      reservedUSD,
      ambiguousUSD,
      remainingUSD
    };
  }
}

// Global singleton instance
const globalBudgetLedger = new BudgetLedgerManager();

// Automatically connect PrismaSettingAdapter if database is available in runtime
try {
  if (process.env.DATABASE_URL) {
    const prisma = require('../db');
    if (prisma && prisma.setting) {
      globalBudgetLedger.setAdapter(new PrismaSettingAdapter(prisma));
    }
  }
} catch (_) {
  // Database not configured or unreachable; remains in fail-closed mode
}

module.exports = {
  MODEL_PRICING_CATALOG,
  CONSERVATIVE_FALLBACK_RATES,
  RESERVATION_TOKEN_CEILINGS,
  getModelRate,
  getMakassarDateYMD,
  calculateModelCostUSD,
  calculateEmbeddingCostUSD,
  calculateEmbeddingCacheMetrics,
  calculateReservationUSD,
  classifyApiFailure,
  getDailyBudgetCeiling,
  MemoryPersistentAdapter,
  PrismaSettingAdapter,
  BudgetLedgerManager,
  globalBudgetLedger
};
