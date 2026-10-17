'use strict';

/**
 * tests/crossDomainArchitecturePhaseD.test.js
 *
 * Phase D End-to-End Regression Suite:
 * - Grounded Answer Generation from Accepted Evidence
 * - Strict Final Answer Verification & Negative Controls
 * - Unjustified Refusal Protection & Deterministic Recovery
 * - Single Orchestrator Decision Maker Pipeline
 */

const { processTurn } = require('../src/core/orchestrator');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');

describe('Phase D — Grounded Answering & Final Verification End-to-End Suite', () => {
  jest.setTimeout(25000);
  const TARGET_SOURCE_FILE = 'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf';

  // =========================================================================
  // Case 1: "Apakah ada Double Degree nasional?"
  // =========================================================================
  test('Case 1: "Apakah ada Double Degree nasional?" identifies national class program & partner UTB based on accepted evidence', async () => {
    const q = 'Apakah ada Double Degree nasional?';
    const res = await processTurn('test_user_p4_case1', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    expect(res.finalAnswer).toBeDefined();

    const ans = res.finalAnswer;
    // 1. Identifies existence of national program
    expect(ans).toMatch(/Ada|tersedia/i);
    expect(ans).toMatch(/Dual Degree|Double Degree/i);
    expect(ans).toMatch(/National Class|Nasional/i);

    // 2. Mentions Universitas Teknologi Bandung (UTB), NOT Bali
    expect(ans).toMatch(/Universitas Teknologi Bandung/i);
    expect(ans).toMatch(/UTB/);
    expect(ans).not.toMatch(/Universitas Teknologi Bali/i);

    // 3. Must not use facility list framing
    expect(ans).not.toMatch(/daftar program\/fasilitas kampus/i);
    expect(ans).not.toMatch(/belum tercantum dalam panduan yang tersedia/i);

    // 4. Must pass verification as factual
    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif).toBeDefined();
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 2: "Program Double Degree nasional apa saja?"
  // =========================================================================
  test('Case 2: "Program Double Degree nasional apa saja?" answers national class program and degrees without ungrounded duration claims', async () => {
    const q = 'Program Double Degree nasional apa saja?';
    const res = await processTurn('test_user_p4_case2', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    const ans = res.finalAnswer;

    expect(ans).toMatch(/Universitas Teknologi Bandung/i);
    expect(ans).toMatch(/S\.Bns/i);
    expect(ans).toMatch(/S\.Ds/i);

    // Must not invent fake ungrounded duration or scheme
    expect(ans).not.toMatch(/2\s*\+\s*2/i);
    expect(ans).not.toMatch(/Universitas Teknologi Bali/i);

    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 3: Follow-up "Ada yang nasional?" preserves DD context
  // =========================================================================
  test('Case 3: Conversation context retention — HELP/DNUI context followed by "Ada yang nasional?"', async () => {
    const convChatId = 'test_conv_p4_case3_' + Date.now();

    // Turn 1: Discuss HELP / DNUI
    const turn1 = await processTurn(convChatId, 'Jelaskan program Double Degree HELP University', { syncOnly: true, fastFallback: true });
    expect(turn1.finalAnswer).toMatch(/HELP University/i);
    expect(turn1.subQueryResults?.[0]?.verification?.pass).toBe(true);

    // Turn 2: Follow-up "Ada yang nasional?"
    const turn2 = await processTurn(convChatId, 'Ada yang nasional?', { syncOnly: true, fastFallback: true });
    expect(turn2.finalAnswer).toBeDefined();

    const ans2 = turn2.finalAnswer;
    expect(ans2).toMatch(/Universitas Teknologi Bandung/i);
    expect(ans2).toMatch(/Dual Degree|Double Degree/i);
    expect(ans2).not.toMatch(/Universitas Teknologi Bali/i);
    expect(ans2).not.toMatch(/belum tercantum dalam panduan/i);

    const verif2 = turn2.subQueryResults?.[0]?.verification;
    expect(verif2.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif2.pass).toBe(true);
  });

  // =========================================================================
  // Case 4: International Double Degree Query
  // =========================================================================
  test('Case 4: International Double Degree query answers HELP University and DNUI accurately', async () => {
    const q = 'Program Double Degree internasional apa saja?';
    const res = await processTurn('test_user_p4_case4', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    const ans = res.finalAnswer;

    expect(ans).toMatch(/HELP University/i);
    expect(ans).toMatch(/Malaysia/i);
    expect(ans).toMatch(/Dalian Neusoft|DNUI/i);
    expect(ans).toMatch(/China/i);

    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 5: Biaya Dual Degree nasional
  // =========================================================================
  test('Case 5: Biaya Dual Degree nasional uses appropriate cost evidence and states supported discounts', async () => {
    const q = 'Berapa biaya Double Degree nasional?';
    const res = await processTurn('test_user_p4_case5', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    const ans = res.finalAnswer;

    // Checks that the answer references UTB cost document details
    expect(ans).toMatch(/Universitas Teknologi Bandung/i);
    expect(ans).toMatch(/Gelombang Khusus/i);
    expect(ans).toMatch(/Rp 3\.000\.000/i);
    expect(ans).toMatch(/10%/i);
    expect(ans).toMatch(/SMK TI/i);

    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 6: Negative Control — Akreditasi Nasional
  // =========================================================================
  test('Case 6: Negative control — Akreditasi query must not turn into Double Degree national answer', async () => {
    const q = 'Bagaimana akreditasi nasional kampus?';
    const res = await processTurn('test_user_p4_case6', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    const ans = res.finalAnswer;

    expect(ans).toMatch(/akreditasi/i);
    expect(ans).not.toMatch(/Universitas Teknologi Bandung/i);
    expect(ans).not.toMatch(/National Class/i);

    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 7: Negative Control — Fasilitas Kampus
  // =========================================================================
  test('Case 7: Negative control — Facilities query must answer facilities without hijacking into Double Degree', async () => {
    const q = 'Apa saja fasilitas kampus ITB STIKOM Bali?';
    const res = await processTurn('test_user_p4_case7', q, { syncOnly: true, fastFallback: true });

    expect(res).toBeDefined();
    const ans = res.finalAnswer;

    expect(ans).toMatch(/laboratorium|perpustakaan|ruang kuliah|fasilitas/i);
    expect(ans).not.toMatch(/Universitas Teknologi Bandung/i);
    expect(ans).not.toMatch(/National Class/i);

    const verif = res.subQueryResults?.[0]?.verification;
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.pass).toBe(true);
  });

  // =========================================================================
  // Case 8: Unjustified Refusal Protection
  // =========================================================================
  test('Case 8: Unjustified refusal protection — "belum tercantum" when evidence supports national DD fails verification', () => {
    const frame = resolveSemanticFrame('Apakah ada Double Degree nasional?');
    const mockAcceptedUtb = [
      {
        id: 'mock_utb_chunk_1',
        sourceFile: TARGET_SOURCE_FILE,
        text: '[Program: Dual Degree UTB] RINCIAN BIAYA PENDIDIKAN MAHASISWA BARU DUAL DEGREE (NATIONAL CLASS) dengan UNIVERSITAS TEKNOLOGI BANDUNG (UTB) (S.Bns.,S.Ds.) T.A 2026/2027'
      }
    ];

    const arb = {
      accepted: mockAcceptedUtb,
      answerability: 'ANSWERABLE',
      retrievalPlan: { targetEntities: ['Double Degree'], requiredAspects: ['national_program'] }
    };

    // Unjustified refusal answer (the old flawed response)
    const badCandidateAnswer = 'Ada, Kak. ITB STIKOM Bali mencantumkan Program Double Degree Nasional dalam daftar program/fasilitas kampus. Namun, rincian mengenai mitra dan skema perkuliahannya belum tercantum dalam panduan yang tersedia.';

    const verif = verifyFinalAnswer(badCandidateAnswer, frame, arb);

    expect(verif.pass).toBe(false);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFICATION_FAILED);
    expect(verif.reason).toMatch(/forbidden_facility_framing|unjustified_refusal/);
  });

  // =========================================================================
  // Case 9: Genuine SAFE_UNKNOWN when evidence is insufficient
  // =========================================================================
  test('Case 9: SAFE_UNKNOWN is valid when evidence is genuinely missing or insufficient', () => {
    const frame = resolveSemanticFrame('Apakah ada program spesialis kedokteran nuklir di ITB STIKOM Bali?');
    const arb = {
      accepted: [],
      answerability: 'UNKNOWN',
      retrievalPlan: { targetEntities: [] }
    };

    const honestRefusal = 'Mohon maaf Kak, informasi mengenai program tersebut saat ini belum tercantum dalam dokumen panduan resmi yang tersedia.';
    const verif = verifyFinalAnswer(honestRefusal, frame, arb);

    expect(verif.pass).toBe(false);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.SAFE_UNKNOWN);
    expect(verif.handledSafely).toBe(true);
    expect(['safe_unknown', 'unsupported_program_safe_refusal']).toContain(verif.reason);
  });

  // =========================================================================
  // Case 10: PARTIAL evidence handling with honest limitation disclosure
  // =========================================================================
  test('Case 10: PARTIAL evidence handling — answers supported facts and discloses limitations without failing verification', () => {
    const frame = resolveSemanticFrame('Apakah ada Double Degree nasional dan berapa biayanya?');
    const mockAcceptedUtb = [
      {
        id: 'mock_utb_chunk_1',
        sourceFile: TARGET_SOURCE_FILE,
        text: '[Program: Dual Degree UTB] RINCIAN BIAYA PENDIDIKAN MAHASISWA BARU DUAL DEGREE (NATIONAL CLASS) dengan UNIVERSITAS TEKNOLOGI BANDUNG (UTB) (S.Bns.,S.Ds.) T.A 2026/2027. Potongan pendaftaran Rp 300.000.'
      }
    ];

    const arb = {
      accepted: mockAcceptedUtb,
      answerability: 'PARTIAL',
      missingAspects: ['fee_schedule'],
      retrievalPlan: { targetEntities: ['Double Degree'], requiredAspects: ['national_program'] }
    };

    const partialAnswer = 'Ada, Kak. ITB STIKOM Bali menyelenggarakan program Dual Degree (National Class) bekerja sama dengan Universitas Teknologi Bandung (UTB) dengan gelar S.Bns. dan S.Ds.\n\n_Untuk informasi rincian nominal biaya per semester saat ini belum tercantum secara lengkap dalam panduan resmi. Silakan konfirmasi ke bagian admisi kampus ya._';

    const verif = verifyFinalAnswer(partialAnswer, frame, arb);

    expect(verif.pass).toBe(true);
    expect(verif.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    expect(verif.reason).toBe('verified_grounded_partial_disclosure');
  });
});
