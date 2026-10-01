'use strict';

/**
 * tests/phase4ShadowIntegration.test.js
 *
 * Phase 4A — Final Security Hardening & Fail-Closed Test Suite.
 */

const {
  SHADOW_DISAGREEMENT_CLASSES,
  isPlanDrivenShadowEnabledFromEnv,
  getPrivacySecret,
  getPrivacySecretFromEnv,
  createPrivacyHash,
  createPrivacyHmac,
  getActiveShadowJobs,
  resetActiveShadowJobs,
  setShadowTelemetrySink,
  getShadowTelemetrySink,
  emitShadowTelemetry,
  serializeTelemetry,
  getShadowSampleRate,
  isShadowSampled,
  recordShadowLatency,
  getShadowLatencyMetrics,
  resetShadowLatencyMetrics,
  extractLegacyResultSummary,
  sanitizeEvidenceForAudit,
  classifyShadowComparison,
  runShadowEvaluation,
  observePlanDrivenShadow,
  invalidateRetrievalStrategyCache
} = require('../src/engine/shadowIntegration');

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { resolveEffectiveSemanticFrame } = require('../src/engine/semanticFrameResolver');
const { buildRetrievalPlanFromSemanticFrame } = require('../src/engine/resolvedRetrievalPlan');

describe('Phase 4A — Final Security Hardening & Fail-Closed Test Suite', () => {

  const originalEnv = process.env.PLAN_DRIVEN_SHADOW_ENABLED;
  const originalSecret = process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;
  const originalRate = process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE;

  const TEST_PEPPER_SECRET = 'test_secret_pepper_random_key_12345';

  beforeEach(() => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    delete process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;
    delete process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE;
    setShadowTelemetrySink(null);
    resetShadowLatencyMetrics();
    resetActiveShadowJobs();
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.PLAN_DRIVEN_SHADOW_ENABLED = originalEnv;
    } else {
      delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    }
    if (originalSecret !== undefined) {
      process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = originalSecret;
    } else {
      delete process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;
    }
    if (originalRate !== undefined) {
      process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE = originalRate;
    } else {
      delete process.env.PLAN_DRIVEN_SHADOW_SAMPLE_RATE;
    }
    setShadowTelemetrySink(null);
  });

  // =========================================================================
  // Section 1: Complete Fail-Closed Matrix (A through K)
  // =========================================================================

  test('Matrix A. ENABLED=false, secret absent -> disabled, no work', async () => {
    expect(isPlanDrivenShadowEnabledFromEnv()).toBe(false);
    expect(getPrivacySecret()).toBeNull();

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Ok' });
    expect(res.enabled).toBe(false);
    expect(res.executed).toBe(false);
    expect(res.reason).toBe('feature_disabled');
  });

  test('Matrix B. ENABLED=false, secret present -> disabled, no work', async () => {
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;
    expect(isPlanDrivenShadowEnabledFromEnv()).toBe(false);

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Ok' });
    expect(res.enabled).toBe(false);
    expect(res.executed).toBe(false);
    expect(res.reason).toBe('feature_disabled');
  });

  test('Matrix C. ENABLED=true, secret absent -> FAIL-CLOSED, no shadow execution', async () => {
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    delete process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;

    expect(isPlanDrivenShadowEnabledFromEnv()).toBe(true);
    expect(getPrivacySecret()).toBeNull();

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Ok' });
    expect(res.enabled).toBe(true);
    expect(res.executed).toBe(false);
    expect(res.reason).toBe('privacy_config_missing');
    expect(res.error.errorType).toBe('PRIVACY_CONFIG_MISSING');

    // Also verify production observer returns null immediately
    const obs = observePlanDrivenShadow('Kapan yudisium?', { answer: 'Ok' });
    expect(obs).toBeNull();
  });

  test('Matrix D. ENABLED=true, secret present -> shadow executes under deterministic sampling', async () => {
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Februari 2025' }, {
      chatId: 'user_mat_d'
    });

    expect(res.enabled).toBe(true);
    expect(res.executed).toBe(true);
    expect(res.semanticFrame).toBeDefined();
    expect(res.correlationId).toBeDefined();
    expect(res.queryHash).toBeDefined();
  });

  test('Matrix E. Production options (enablePlanDrivenShadow=true, __enableShadow=true) CANNOT bypass ENV gate', () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    // Caller attempts to force enablement via options
    const legacyResult = { answer: 'Jawaban legacy' };
    const res = observePlanDrivenShadow('Kapan yudisium?', legacyResult, {
      enablePlanDrivenShadow: true,
      __enableShadow: true
    });

    // Invariant: Production observer must remain strictly disabled
    expect(res).toBeNull();
  });

  test('Matrix F. Sample rate 1.0 does NOT enable feature when ENV=false', async () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Ok' }, {
      shadowSampleRate: 1.0
    });

    expect(res.enabled).toBe(false);
    expect(res.executed).toBe(false);
  });

  test('Matrix G. Sample rate 0.0 with ENV=true and secret=true -> not sampled, zero retrieval', async () => {
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    const res = await runShadowEvaluation('Kapan yudisium?', { answer: 'Ok' }, {
      shadowSampleRate: 0.0,
      chatId: 'user_mat_g'
    });

    expect(res.enabled).toBe(true);
    expect(res.executed).toBe(false);
    expect(res.sampled).toBe(false);
    expect(res.reason).toBe('not_sampled');
    expect(res.semanticFrame).toBeUndefined();
  });

  test('Matrix H. Same conversation identity + same secret -> same correlation pseudonym', () => {
    const p1 = createPrivacyHmac('628123456789', TEST_PEPPER_SECRET, 16);
    const p2 = createPrivacyHmac('628123456789', TEST_PEPPER_SECRET, 16);

    expect(p1).toBe(p2);
    expect(p1).toHaveLength(16);
  });

  test('Matrix I. Different conversation identity -> different pseudonym', () => {
    const pA = createPrivacyHmac('628123456789', TEST_PEPPER_SECRET, 16);
    const pB = createPrivacyHmac('628987654321', TEST_PEPPER_SECRET, 16);

    expect(pA).not.toBe(pB);
  });

  test('Matrix J. Same query + same secret -> same queryHash', () => {
    const q1 = createPrivacyHmac('Berapa biaya kuliah S1 SI?', TEST_PEPPER_SECRET, 16);
    const q2 = createPrivacyHmac('  berapa biaya kuliah s1 si?  ', TEST_PEPPER_SECRET, 16);

    expect(q1).toBe(q2);
  });

  test('Matrix K. Different query -> different queryHash', () => {
    const qA = createPrivacyHmac('Berapa biaya kuliah S1 SI?', TEST_PEPPER_SECRET, 16);
    const qB = createPrivacyHmac('Kapan yudisium?', TEST_PEPPER_SECRET, 16);

    expect(qA).not.toBe(qB);
  });

  // =========================================================================
  // Section 2: Strict Privacy, Allowlist Serializer & Leakage Audits
  // =========================================================================

  test('Privacy Audit 1. Raw query is absent from telemetry', async () => {
    let captured = null;
    setShadowTelemetrySink(record => { captured = record; });

    const rawQuery = 'Nama saya Ahmad dari Denpasar nomor HP 081234567899 mau tanya yudisium';
    await runShadowEvaluation(rawQuery, { answer: 'Yudisium Februari' }, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      chatId: '6281234567899'
    });

    expect(captured).toBeDefined();
    const str = JSON.stringify(captured);
    expect(str).not.toContain('Ahmad');
    expect(str).not.toContain('081234567899');
    expect(str).not.toContain('Nama saya');
    expect(str).not.toContain('Denpasar');
    expect(captured.queryHash).toBeDefined();
  });

  test('Privacy Audit 2. Raw phone / conversation ID is absent from telemetry', async () => {
    let captured = null;
    setShadowTelemetrySink(record => { captured = record; });

    const phoneId = '6287766554433';
    await runShadowEvaluation('Biaya kuliah', { answer: 'Rp 8.000.000' }, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      chatId: phoneId
    });

    expect(captured).toBeDefined();
    expect(captured.correlationId).toBeDefined();
    expect(captured.correlationId).not.toContain(phoneId);
    expect(JSON.stringify(captured)).not.toContain(phoneId);
  });

  test('Privacy Audit 3. Secret is absent from telemetry', async () => {
    let captured = null;
    setShadowTelemetrySink(record => { captured = record; });

    await runShadowEvaluation('Biaya kuliah', { answer: 'Rp 8.000.000' }, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      chatId: 'user_privacy_sec'
    });

    expect(captured).toBeDefined();
    expect(JSON.stringify(captured)).not.toContain(TEST_PEPPER_SECRET);
  });

  test('Privacy Audit 4. Full answer text and document chunks absent from audit record and telemetry', () => {
    const rawChunk = 'TEKS RAHASIA DOKUMEN INTERNAL STIKOM YANG SANGAT PANJANG';
    const mockEvidence = {
      id: 'doc_1',
      sourceFile: 'internal.pdf',
      chunk: rawChunk,
      text: rawChunk,
      content: rawChunk
    };

    const sanitized = sanitizeEvidenceForAudit(mockEvidence);
    expect(sanitized.chunk).toBeUndefined();
    expect(sanitized.text).toBeUndefined();
    expect(sanitized.content).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain(rawChunk);
  });

  test('Privacy Audit 5. Allowlist serializer strips unexpected arbitrary fields', () => {
    const rawTelemetryWithLeak = {
      correlationId: 'abc123',
      queryHash: 'def456',
      shadowStrategy: 'AcademicCalendarStrategy',
      shadowLatencyMs: 15,
      // Attempted leaks
      rawQuery: 'secret query',
      userPhone: '08123456789',
      fullAnswer: 'very secret answer',
      sessionDump: { token: 'xyz' },
      secretKey: 'my_secret_key'
    };

    const serialized = serializeTelemetry(rawTelemetryWithLeak);
    expect(serialized.correlationId).toBe('abc123');
    expect(serialized.rawQuery).toBeUndefined();
    expect(serialized.userPhone).toBeUndefined();
    expect(serialized.fullAnswer).toBeUndefined();
    expect(serialized.sessionDump).toBeUndefined();
    expect(serialized.secretKey).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('secret');
  });

  // =========================================================================
  // Section 3: Concurrency & Backpressure
  // =========================================================================

  test('Concurrency & Backpressure: drops requests immediately when active shadow reaches limit', () => {
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    resetActiveShadowJobs();
    expect(getActiveShadowJobs()).toBe(0);

    const legacy = { answer: 'Kalender akademik' };
    observePlanDrivenShadow('Query 1', legacy);
    expect(getActiveShadowJobs()).toBe(1);

    observePlanDrivenShadow('Query 2', legacy);
    expect(getActiveShadowJobs()).toBe(2);

    // Active limit reached (2) -> subsequent request dropped immediately
    const dropped = observePlanDrivenShadow('Query 3', legacy);
    expect(dropped).toBeNull();
    expect(getActiveShadowJobs()).toBe(2);

    resetActiveShadowJobs();
  });

  // =========================================================================
  // Section 4: Functional Core & Comparison
  // =========================================================================

  test('Functional Core: Shadow executes cleanly and populates structured contract', async () => {
    const rawQuery = 'Kapan pelaksanaan yudisium tahun 2025?';
    const legacyResult = {
      answer: 'Jadwal yudisium tahun 2025 adalah 28 Februari 2025.',
      source: 'semantic-rag-academic-calendar',
      contexts: [{ id: 'doc_cal_2025', sourceFile: 'kalender_2025.pdf' }]
    };

    const contract = await runShadowEvaluation(rawQuery, legacyResult, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      chatId: '628123456789',
      traceId: 'trace_test_01'
    });

    expect(contract).toBeDefined();
    expect(contract.queryId).toBe('trace_test_01');
    expect(contract.correlationId).toBeDefined();
    expect(contract.semanticFrame).toBeDefined();
    expect(contract.retrievalPlan).toBeDefined();
    expect(contract.legacyResult).toBeDefined();
    expect(contract.shadowResult).toBeDefined();
    expect(contract.comparison).toBeDefined();
    expect(contract.latency).toBeDefined();
    expect(contract.error).toBeNull();
  });

  test('Functional Core: Context inheritance across turns in shadow', async () => {
    const f1 = resolveEffectiveSemanticFrame('Berapa biaya S2 SI?');
    const sessionState = {
      activeEntity: f1.entities[0],
      activeDomain: 'fee',
      activeIntent: 'ask_fee',
      program: 'S2 Sistem Informasi'
    };

    const contract = await runShadowEvaluation('biayanya berapa?', { answer: 'Rp 9.500.000' }, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      sessionState,
      chatId: 'user_turn2'
    });

    expect(contract.semanticFrame.domain.primary).toBe('fee');
    expect(contract.semanticFrame.requestedFields).toContain('amount');
    expect(contract.semanticFrame.entities.map(e => e.canonical)).toContain('S2 Sistem Informasi');
  });

  test('Functional Core: Expired document detected as GOVERNANCE_DISAGREEMENT', () => {
    const rawQuery = 'Jadwal yudisium terkini';
    const legacySummary = {
      answerable: true,
      source: 'semantic-rag-academic',
      evidenceIds: ['doc_yud_2023_expired'],
      rawEvidence: [{ id: 'doc_yud_2023_expired', governanceStatus: 'expired' }]
    };
    const shadowResult = {
      strategy: 'AcademicCalendarStrategy',
      answerable: true,
      candidateCount: 1,
      selectedEvidence: [{ id: 'doc_yud_2025_active', governanceStatus: 'active' }],
      evidenceIds: ['doc_yud_2025_active'],
      policy: 'proceed_to_answer'
    };

    const comparison = classifyShadowComparison({
      rawQuery,
      semanticFrame: { domain: { primary: 'academic' } },
      retrievalPlan: { governanceRequirements: { excludeExpired: true }, temporalScope: { allowHistorical: false } },
      legacySummary,
      shadowResult,
      error: null
    });

    expect(comparison.potentialGovernanceDefect).toBe(true);
    expect(comparison.comparisonClass).toBe(SHADOW_DISAGREEMENT_CLASSES.GOVERNANCE_DISAGREEMENT);
  });

  // =========================================================================
  // Section 5: Production Boundary Invariant
  // =========================================================================

  test('Production Boundary: USER ANSWER SOURCE MUST REMAIN LEGACY and shadow result must never overwrite answer', async () => {
    // 1. Without shadow
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    const legacyExpected = await querySemanticRag('Kapan yudisium?', { topK: 5 });

    // 2. With shadow active
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    const resultWithShadow = await querySemanticRag('Kapan yudisium?', {
      topK: 5,
      __syncShadow: true
    });

    // Invariant: User-visible answer MUST match legacy answer exactly
    expect(resultWithShadow.answer).toBe(legacyExpected.answer);
    expect(resultWithShadow.source).toBe(legacyExpected.source);

    // Verify shadow record is strictly inside debug.planDrivenShadow, not replacing answer
    expect(resultWithShadow.debug).toBeDefined();
    expect(resultWithShadow.debug.planDrivenShadow).toBeDefined();
    expect(resultWithShadow.debug.planDrivenShadow.legacyResult.answerable).toBe(true);

    // Invariant check: shadowResult object is NEVER the root answer
    expect(resultWithShadow.answer).not.toEqual(resultWithShadow.debug.planDrivenShadow.shadowResult);
  });

  // =========================================================================
  // Section 6: Section 10 Minimal Explicit Test Checklist & Mandatory Regression
  // =========================================================================

  test('Mandatory Regression: production observer + enablePlanDrivenShadow=true + PLAN_DRIVEN_SHADOW_ENABLED unset/false -> shadow remains DISABLED', async () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    let telemetryEmitted = false;
    setShadowTelemetrySink(() => { telemetryEmitted = true; });

    // 1. Call observePlanDrivenShadow directly with bypass options
    const obs = observePlanDrivenShadow('Kapan yudisium?', { answer: 'Februari' }, {
      enablePlanDrivenShadow: true,
      __enableShadow: true
    });
    expect(obs).toBeNull();
    expect(telemetryEmitted).toBe(false);

    // 2. Call querySemanticRag with bypass options
    const result = await querySemanticRag('Kapan yudisium?', {
      enablePlanDrivenShadow: true,
      __enableShadow: true,
      __syncShadow: true
    });
    expect(result.debug?.planDrivenShadow).toBeUndefined();
    expect(telemetryEmitted).toBe(false);
  });

  test('Checklist 1. Options cannot bypass production gate', () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    const res = observePlanDrivenShadow('test', { answer: 'ok' }, {
      enablePlanDrivenShadow: true,
      __enableShadow: true
    });
    expect(res).toBeNull();
  });

  test('Checklist 2 & 3. Privacy secret required when enabled, zero shadow work when secret missing', async () => {
    process.env.PLAN_DRIVEN_SHADOW_ENABLED = 'true';
    delete process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET;

    let telemetryEmitted = false;
    setShadowTelemetrySink(() => { telemetryEmitted = true; });

    const obs = observePlanDrivenShadow('test', { answer: 'ok' });
    expect(obs).toBeNull();

    const evalResult = await runShadowEvaluation('test', { answer: 'ok' });
    expect(evalResult.enabled).toBe(true);
    expect(evalResult.executed).toBe(false);
    expect(evalResult.reason).toBe('privacy_config_missing');
    expect(evalResult.error.errorType).toBe('PRIVACY_CONFIG_MISSING');
    expect(telemetryEmitted).toBe(false);
  });

  test('Checklist 4 & 5. queryHash and correlationId use keyed HMAC', () => {
    const hashA = createPrivacyHash('query test', TEST_PEPPER_SECRET, 16);
    const hashB = createPrivacyHash('query test', 'different_secret_key_54321', 16);

    // Changing secret produces completely different hash (proving HMAC keying)
    expect(hashA).not.toBe(hashB);
    expect(hashA).toHaveLength(16);

    const correlA = createPrivacyHash('user_phone_123', TEST_PEPPER_SECRET, 16);
    const correlB = createPrivacyHash('user_phone_123', 'different_secret_key_54321', 16);
    expect(correlA).not.toBe(correlB);
    expect(correlA).toHaveLength(16);
  });

  test('Checklist 6, 7, 8, 9, 10. Raw query, conversation ID, secret, full answer, and doc chunks absent from telemetry', async () => {
    let captured = null;
    setShadowTelemetrySink(rec => { captured = rec; });

    const phone = '081987654321';
    const query = 'Pertanyaan rahasia mahasiswa 081987654321';
    const answer = 'Jawaban panjang rahasia internal';

    await runShadowEvaluation(query, { answer, contexts: [{ chunk: 'TEKS_DOKUMEN_SANGAT_RAHASIA' }] }, {
      __testDirectExecution: true,
      __testPrivacySecret: TEST_PEPPER_SECRET,
      chatId: phone
    });

    expect(captured).toBeDefined();
    const str = JSON.stringify(captured);
    expect(str).not.toContain(phone);
    expect(str).not.toContain(query);
    expect(str).not.toContain(TEST_PEPPER_SECRET);
    expect(str).not.toContain(answer);
    expect(str).not.toContain('TEKS_DOKUMEN_SANGAT_RAHASIA');
  });

  test('Checklist 11. Sample rate cannot enable feature', async () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;
    process.env.PLAN_DRIVEN_SHADOW_PRIVACY_SECRET = TEST_PEPPER_SECRET;

    const res = await runShadowEvaluation('test', { answer: 'ok' }, {
      shadowSampleRate: 1.0
    });
    expect(res.enabled).toBe(false);
    expect(res.executed).toBe(false);
  });

  test('Checklist 12. Disabled path performs zero shadow retrieval work', async () => {
    delete process.env.PLAN_DRIVEN_SHADOW_ENABLED;

    const res = await runShadowEvaluation('test query', { answer: 'ok' });
    expect(res.enabled).toBe(false);
    expect(res.executed).toBe(false);
    expect(res.semanticFrame).toBeUndefined();
    expect(res.retrievalPlan).toBeUndefined();
    expect(res.shadowResult).toBeUndefined();
  });

});
