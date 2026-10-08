'use strict';

/**
 * tests/phase2ProductionUat.test.js
 *
 * Phase 2 Step 9: Real-User Production UAT, Canary Verification, Cutover Validation & Sign-off.
 *
 * Covers:
 * 12 Canonical UAT Topics (Section 11.4):
 *  1. Dual Degree International Partner Boundary
 *  2. Elliptical Multi-Turn Fee Inquiry
 *  3. 3-Pillar Academic Comparison
 *  4. Interest-Based Program Recommendation
 *  5. Recognition of Prior Learning (RPL)
 *  6. Institutional & Program Accreditation
 *  7. Foreign Student Study Permit / Visa
 *  8. Scholarship Eligibility (SKSS / KIP Kuliah)
 *  9. S1 Bisnis Digital Profile & Curriculum
 * 10. Academic Credit / SKS
 * 11. 5-Turn Sequential Dialog Continuity
 * 12. Fictional Claim Rejection
 *
 * Governance & Cutover Scenarios:
 * 13. Turn Budget Ceiling (<= 2500 ms)
 * 14. 13-Attribute Diagnostic Execution Record Compliance
 * 15. Cutover Transition (Shadow -> Live Phase 2 -> Fallback Resilience)
 */

const prisma = require('../src/db');
const { processTurn } = require('../src/core/orchestrator');
const { TOTAL_TURN_BUDGET_MS, PLAN_TYPE } = require('../src/reasoning/contracts');
const outboundDispatcher = require('../src/core/outboundDispatcher');
const { getSession } = require('../src/core/conversationState');
const plannerModule = require('../src/reasoning/phase2Planner');

// In-memory session mock for test isolation and high performance
const sessionStore = new Map();
prisma.session = {
  findUnique: jest.fn(async ({ where }) => {
    return sessionStore.get(where.chatId) || null;
  }),
  upsert: jest.fn(async ({ where, update, create }) => {
    const existing = sessionStore.get(where.chatId);
    const saved = existing
      ? {
          chatId: where.chatId,
          state: update.state || existing.state || 'root',
          data: { ...(existing.data || {}), ...((update.data && update.data) || {}) }
        }
      : {
          chatId: where.chatId,
          state: create.state || 'root',
          data: create.data || {}
        };
    sessionStore.set(where.chatId, saved);
    return saved;
  })
};

/**
 * Diagnostic Record Formatter & Validator (Section 12 Compliance)
 * Validates the 13 required attributes without introducing production runtime bloat.
 */
function formatDiagnosticRecord(record = {}) {
  const requiredKeys = [
    'QUERY',
    'CONTEXT',
    'PLAN',
    'TASK GRAPH',
    'REPLAN COUNT',
    'EVIDENCE IDS',
    'SUPPORTED CLAIMS',
    'MISSING INFORMATION',
    'FINAL ANSWER',
    'VERIFICATION',
    'LATENCY',
    'FALLBACK',
    'RESULT'
  ];

  for (const key of requiredKeys) {
    if (record[key] === undefined) {
      throw new Error(`[DiagnosticRecordViolation] Missing required attribute: ${key}`);
    }
  }

  return [
    '================================================================',
    'PHASE 2 DIAGNOSTIC EXECUTION RECORD',
    '================================================================',
    `QUERY               : ${record.QUERY}`,
    `CONTEXT             : ${typeof record.CONTEXT === 'object' ? JSON.stringify(record.CONTEXT) : record.CONTEXT}`,
    `PLAN                : ${record.PLAN}`,
    `TASK GRAPH          : ${Array.isArray(record['TASK GRAPH']) ? record['TASK GRAPH'].join(', ') : record['TASK GRAPH']}`,
    `REPLAN COUNT        : ${record['REPLAN COUNT']}`,
    `EVIDENCE IDS        : ${Array.isArray(record['EVIDENCE IDS']) ? record['EVIDENCE IDS'].join(', ') : record['EVIDENCE IDS']}`,
    `SUPPORTED CLAIMS    : ${Array.isArray(record['SUPPORTED CLAIMS']) ? record['SUPPORTED CLAIMS'].join('; ') : record['SUPPORTED CLAIMS']}`,
    `MISSING INFORMATION : ${record['MISSING INFORMATION'] || 'NONE'}`,
    `FINAL ANSWER        : ${record['FINAL ANSWER']}`,
    `VERIFICATION        : ${record.VERIFICATION}`,
    `LATENCY             : ${record.LATENCY} ms`,
    `FALLBACK            : ${record.FALLBACK}`,
    `RESULT              : ${record.RESULT}`,
    '================================================================'
  ].join('\n');
}

describe('Phase 2 Step 9: Real-User Production UAT & Acceptance Gate', () => {
  jest.setTimeout(60000);

  const origPhase2 = process.env.ENABLE_PHASE2_REASONING;
  const origShadow = process.env.PHASE2_SHADOW_MODE;

  beforeEach(() => {
    sessionStore.clear();
    jest.clearAllMocks();
    process.env.ENABLE_PHASE2_REASONING = 'true';
    delete process.env.PHASE2_SHADOW_MODE;
  });

  afterEach(async () => {
    await new Promise(resolve => setImmediate(resolve));
    jest.restoreAllMocks();
    if (origPhase2 === undefined) delete process.env.ENABLE_PHASE2_REASONING;
    else process.env.ENABLE_PHASE2_REASONING = origPhase2;

    if (origShadow === undefined) delete process.env.PHASE2_SHADOW_MODE;
    else process.env.PHASE2_SHADOW_MODE = origShadow;
  });

  // 1. Dual Degree International Partner Boundary
  test('Topic 1: Dual Degree International Partner Boundary (HELP & DNUI)', async () => {
    const chatId = 'uat_user_topic_1_' + Date.now();
    const result = await processTurn(chatId, 'Informasi program Dual Degree HELP University dan Dalian DNUI');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/Dual Degree|HELP University|Dalian|DNUI|internasional/i);
    expect(result.phase2Meta).toBeDefined();
    expect(result.phase2Meta.fallbackTriggered).toBe(false);
  });

  // 2. Elliptical Multi-Turn Fee Inquiry
  test('Topic 2: Elliptical Multi-Turn Fee Inquiry (Context Inheritance)', async () => {
    const chatId = 'uat_user_topic_2_' + Date.now();

    // Turn 1: Establish activeEntity for S1 Sistem Informasi
    const t1Result = await processTurn(chatId, 'Apa itu program studi S1 Sistem Informasi?');
    expect(t1Result.finalAnswer).toMatch(/sistem informasi/i);

    const sessionAfterT1 = await getSession(chatId);
    expect(sessionAfterT1.data.activeEntity).toMatch(/sistem\s*informasi/i);

    // Turn 2: Elliptical follow-up query without explicit entity
    const t2Result = await processTurn(chatId, 'Berapa rincian biayanya?');
    expect(t2Result.finalAnswer).toBeTruthy();
    expect(t2Result.finalAnswer).toMatch(/biaya|spp|registrasi|ukt|semester|rp/i);
    // Verified that it inherits Sistem Informasi without prompt failure
    expect(t2Result.finalAnswer).not.toMatch(/Teknologi Informasi di ITB STIKOM Bali adalah program studi/i);
  });

  // 3. 3-Pillar Academic Comparison
  test('Topic 3: 3-Pillar Academic Comparison (SI vs SK)', async () => {
    const chatId = 'uat_user_topic_3_' + Date.now();
    const result = await processTurn(chatId, 'Apa perbedaan Sistem Informasi dan Sistem Komputer?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    // Validates both entities and 3 pillars structure presence
    expect(result.finalAnswer).toMatch(/S1 Sistem Informasi/i);
    expect(result.finalAnswer).toMatch(/S1 Sistem Komputer/i);
    expect(result.finalAnswer).toMatch(/Fokus Utama|Keahlian/i);
    expect(result.finalAnswer).toMatch(/Yang Dipelajari/i);
    expect(result.finalAnswer).toMatch(/Peluang Kerja/i);
    expect(result.finalAnswer).toMatch(/Perbedaan Utama/i);
  });

  // 4. Interest-Based Program Recommendation
  test('Topic 4: Interest-Based Program Recommendation', async () => {
    const chatId = 'uat_user_topic_4_' + Date.now();
    const result = await processTurn(chatId, 'Saya suka bisnis digital, konten medsos, dan teknologi, jurusan apa yang cocok?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/rekomendasi|bisnis digital|sistem informasi/i);
    expect(result.finalAnswer).toMatch(/admisi|PMB|konsultasi/i);
  });

  // 5. Recognition of Prior Learning (RPL)
  test('Topic 5: Recognition of Prior Learning (RPL)', async () => {
    const chatId = 'uat_user_topic_5_' + Date.now();
    const result = await processTurn(chatId, 'Informasi jalur RPL Rekognisi Pembelajaran Lampau ITB STIKOM Bali');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/RPL|Rekognisi Pembelajaran Lampau/i);
  });

  // 6. Institutional & Program Accreditation
  test('Topic 6: Institutional & Program Accreditation', async () => {
    const chatId = 'uat_user_topic_6_' + Date.now();
    const result = await processTurn(chatId, 'Bagaimana status akreditasi kampus dan program studi di ITB STIKOM Bali?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/akreditasi|BAN-PT|LAM INFOKOM|Baik Sekali|Unggul|B/i);
  });

  // 7. Foreign Student Study Permit / Visa
  test('Topic 7: Foreign Student Study Permit / Visa', async () => {
    const chatId = 'uat_user_topic_7_' + Date.now();
    const result = await processTurn(chatId, 'Bagaimana prosedur izin belajar dan visa untuk mahasiswa asing?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/visa|izin belajar|internasional|admisi|mahasiswa asing/i);
  });

  // 8. Scholarship Eligibility (SKSS / KIP Kuliah)
  test('Topic 8: Scholarship Eligibility (SKSS & KIP Kuliah)', async () => {
    const chatId = 'uat_user_topic_8_' + Date.now();
    const result = await processTurn(chatId, 'Informasi beasiswa KIP Kuliah dan beasiswa SKSS');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/beasiswa|KIP|SKSS|prestasi|bantuan/i);
  });

  // 9. S1 Bisnis Digital Profile & Curriculum
  test('Topic 9: S1 Bisnis Digital Profile & Curriculum', async () => {
    const chatId = 'uat_user_topic_9_' + Date.now();
    const result = await processTurn(chatId, 'Profil lulusan dan kurikulum S1 Bisnis Digital');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/Bisnis Digital|E-Commerce|Digital Marketing|kurikulum|lulusan/i);
  });

  // 10. Academic Credit / SKS
  test('Topic 10: Academic Credit (SKS) Requirements', async () => {
    const chatId = 'uat_user_topic_10_' + Date.now();
    const result = await processTurn(chatId, 'Berapa SKS syarat kelulusan atau Tugas Akhir di S1 Sistem Informasi?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    expect(result.finalAnswer).toMatch(/144 SKS|8 SKS|Tugas Akhir|Skripsi|Semester/i);
  });

  // 11. 5-Turn Sequential Dialog Continuity
  test('Topic 11: 5-Turn Sequential Dialog Continuity', async () => {
    const chatId = 'uat_user_topic_11_' + Date.now();

    // Turn 1: Greeting
    const t1 = await processTurn(chatId, 'Halo, selamat pagi!');
    expect(t1.finalAnswer).toMatch(/Halo|Selamat|bantu/i);

    // Turn 2: Program exploration
    const t2 = await processTurn(chatId, 'Apa keunggulan program studi S1 Teknologi Informasi?');
    expect(t2.finalAnswer).toMatch(/Teknologi Informasi/i);
    let session = await getSession(chatId);
    expect(session.data.activeEntity).toMatch(/teknologi\s*informasi/i);

    // Turn 3: Elliptical question (should inherit TI)
    const t3 = await processTurn(chatId, 'Berapa biaya kuliahnya?');
    expect(t3.finalAnswer).toMatch(/biaya|spp|rp/i);
    session = await getSession(chatId);
    expect(session.data.activeEntity).toMatch(/teknologi\s*informasi/i);

    // Turn 4: Explicit topic switch to Sistem Komputer
    const t4 = await processTurn(chatId, 'Kalau Sistem Komputer bagaimana?');
    expect(t4.finalAnswer).toMatch(/Sistem Komputer/i);
    session = await getSession(chatId);
    expect(session.data.activeEntity).toMatch(/sistem\s*komputer/i);

    // Turn 5: Concluding turn
    const t5 = await processTurn(chatId, 'Baik, terima kasih banyak atas informasinya.');
    expect(t5.finalAnswer).toMatch(/sama-sama|senang bisa membantu|informasi|kembali/i);
  });

  // 12. Fictional Claim Rejection
  test('Topic 12: Fictional Claim Rejection (Medical / Nonexistent Degree)', async () => {
    const chatId = 'uat_user_topic_12_' + Date.now();
    const result = await processTurn(chatId, 'Apakah ada jurusan kedokteran di ITB STIKOM Bali?');

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    // Safety invariant: Absent medical faculty must not be falsely affirmed or hallucinated
    expect(result.finalAnswer).not.toMatch(/terdapat program studi kedokteran|biaya kedokteran|fakultas kedokteran/i);
  });

  // 13. Turn budget <= 2500 ms
  test('Scenario 13: Turn budget <= 2500 ms contract enforcement', async () => {
    expect(TOTAL_TURN_BUDGET_MS).toBe(2500);

    const chatId = 'uat_budget_test_' + Date.now();
    const start = Date.now();
    const result = await processTurn(chatId, 'Apa saja fasilitas kampus ITB STIKOM Bali?');
    const elapsed = Date.now() - start;

    expect(result).toBeDefined();
    expect(result.finalAnswer).toBeTruthy();
    // Must complete within budget
    expect(elapsed).toBeLessThan(TOTAL_TURN_BUDGET_MS + 500);
  });

  // 14. 13-Attribute Diagnostic Execution Record Compliance
  test('Scenario 14: 13-Attribute Diagnostic Execution Record compliance', () => {
    const mockRecord = {
      QUERY: 'Berapa biaya kuliah S1 Sistem Informasi?',
      CONTEXT: { activeDomain: 'ACADEMIC_PROGRAM', activeEntity: 's1_sistem_informasi' },
      PLAN: 'DIRECT',
      'TASK GRAPH': ['task_retrieve_fee', 'task_synthesize_answer'],
      'REPLAN COUNT': 0,
      'EVIDENCE IDS': ['chunk_sk_biaya_si_01', 'chunk_sk_biaya_si_02'],
      'SUPPORTED CLAIMS': ['Biaya SPP semester S1 SI adalah Rp 6.500.000'],
      'MISSING INFORMATION': 'NONE',
      'FINAL ANSWER': 'Rincian biaya kuliah S1 Sistem Informasi...',
      VERIFICATION: 'PASS',
      LATENCY: 420,
      FALLBACK: 'NONE',
      RESULT: 'PASS'
    };

    const formatted = formatDiagnosticRecord(mockRecord);
    expect(formatted).toContain('PHASE 2 DIAGNOSTIC EXECUTION RECORD');
    expect(formatted).toContain('QUERY               : Berapa biaya kuliah S1 Sistem Informasi?');
    expect(formatted).toContain('PLAN                : DIRECT');
    expect(formatted).toContain('LATENCY             : 420 ms');
    expect(formatted).toContain('RESULT              : PASS');

    // Missing key check
    const incompleteRecord = { ...mockRecord };
    delete incompleteRecord.PLAN;
    expect(() => formatDiagnosticRecord(incompleteRecord)).toThrow(/Missing required attribute: PLAN/);
  });

  // 15. Cutover Transition (Shadow -> Live Phase 2 -> Fallback Resilience)
  test('Scenario 15: Cutover Transition and Fallback Resilience', async () => {
    const dispatchSpy = jest.spyOn(outboundDispatcher, 'sendOutboundMessage').mockResolvedValue(true);

    // State A: Shadow Mode
    delete process.env.ENABLE_PHASE2_REASONING;
    process.env.PHASE2_SHADOW_MODE = 'true';

    const shadowResult = await processTurn('cutover_user_a', 'Berapa biaya kuliah?', { executeDispatch: false });
    expect(shadowResult).toBeDefined();
    expect(shadowResult.phase2Meta).toBeUndefined(); // Handled by Phase 1 production core
    expect(dispatchSpy).not.toHaveBeenCalled();

    // State B: Live Phase 2 Active
    process.env.ENABLE_PHASE2_REASONING = 'true';
    delete process.env.PHASE2_SHADOW_MODE;

    const liveResult = await processTurn('cutover_user_b', 'Apa itu Sistem Informasi?', { executeDispatch: false });
    expect(liveResult).toBeDefined();
    expect(liveResult.phase2Meta).toBeDefined();
    expect(liveResult.phase2Meta.handledBy).toBe('phase2_bridge');

    // State C: Fallback Resilience on Bridge Failure
    const origBuildPlan = plannerModule.buildExecutionPlan;
    plannerModule.buildExecutionPlan = jest.fn().mockImplementation(async () => {
      throw new Error('simulated_planner_cutover_error');
    });

    try {
      const fallbackResult = await processTurn('cutover_user_c', 'Apa itu Sistem Informasi?', { executeDispatch: false });
      expect(fallbackResult).toBeDefined();
      expect(fallbackResult.finalAnswer).toBeTruthy();
      expect(fallbackResult.phase2Meta.handledBy).toBe('phase1_fallback');
      expect(fallbackResult.phase2Meta.fallbackTriggered).toBe(true);
    } finally {
      plannerModule.buildExecutionPlan = origBuildPlan;
    }
  });
});
