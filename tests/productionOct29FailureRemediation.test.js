'use strict';

/**
 * tests/productionOct29FailureRemediation.test.js
 *
 * Direct Regression Suite for 29 October 2026 Production Failure Reproductions:
 * 1. Wisuda tertukar dengan PMB: Explicit "Tanggal berapa wisuda?" sets ACADEMIC_EVENT/wisuda,
 *    defeats prior PMB context, never outputs PMB steps/fees, never names "Wisuda" as a prodi.
 * 2. Konteks Dual Degree Nasional hilang: Multi-turn followup "Bagaimana cara mendaftar?" retains
 *    Dual Degree UTB context, uses official portal (pmb.stikom-bali.ac.id), and explains limitations/campus contact.
 * 3. Follow-up biaya kehilangan konteks: "Berapa biaya S1 Sistem Informasi per semester?" followed by
 *    "Kalau gelombang 2 berapa?" preserves S1 Sistem Informasi, computes Gelombang II discounts (DPP net 12.5M, total net 14.3M).
 * 4. Pertanyaan lokasi kampus gagal: "Di mana lokasi kampus ITB STIKOM Bali?" routes to official campus locations
 *    (Renon, Jimbaran, Abiansemal) and never returns corpus gap.
 */

const { processTurn } = require('../src/core/orchestrator');

jest.setTimeout(120000);

describe('Production 29 October 2026 Failure Remediation', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // ---------------------------------------------------------------------------
  // Case 1: Wisuda tertukar dengan PMB
  // ---------------------------------------------------------------------------
  describe('Case 1: Wisuda tertukar dengan PMB', () => {
    test('explicit "Tanggal berapa wisuda?" sets ACADEMIC_EVENT domain and defeats prior PMB context', async () => {
      const chatId = 'test-regress-wisuda-' + Date.now();

      // Turn 1: PMB inquiry (could be general PMB procedure or prodi clarification)
      const t1 = await processTurn(chatId, 'Bagaimana cara mendaftar di ITB STIKOM Bali?', { executeDispatch: false });
      expect(t1.text || t1.finalAnswer).toBeTruthy();

      // Turn 2: Wisuda inquiry
      const t2 = await processTurn(chatId, 'Tanggal berapa wisuda?', { executeDispatch: false });

      // Domain must be ACADEMIC_EVENT, intent GRADUATION_INQUIRY
      const t2Domain = t2.semanticFrame?.domain || t2.subQueryResults?.[0]?.frame?.domain;
      const t2Intent = t2.semanticFrame?.intent || t2.subQueryResults?.[0]?.frame?.intent;
      expect(t2Domain).toBe('ACADEMIC_EVENT');
      expect(t2Intent).toBe('GRADUATION_INQUIRY');

      // Verifier must handle safely and not claim fabricated dates
      expect(t2.verification?.handledSafely).toBe(true);
      expect(t2.text).not.toMatch(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+\d{4}\b/i);

      // Answer content checks:
      // Must explain wisuda date/schedule through SION / BAAK
      expect(t2.text).toMatch(/wisuda/i);
      expect(t2.text).toMatch(/BAAK|SION/i);

      // Must NEVER contain PMB registration steps or fees
      expect(t2.text).not.toMatch(/alur\s+pendaftaran/i);
      expect(t2.text).not.toMatch(/dana\s+pendidikan\s+pokok/i);
      expect(t2.text).not.toMatch(/biaya\s+pendaftaran/i);

      // Must NEVER treat "Wisuda" as a study program name
      expect(t2.text).not.toMatch(/\(Wisuda\)/i);
      expect(t2.text).not.toMatch(/program studi Wisuda/i);
      expect(t2.text).not.toMatch(/prodi Wisuda/i);

      // Turn 3: User follows up with registration procedure without specifying PMB
      // Must inherit Wisuda context (pendaftaran wisuda/yudisium), NOT PMB new student admission
      const t3 = await processTurn(chatId, 'Bagaimana cara mendaftar?', { executeDispatch: false });
      expect(t3.text || t3.finalAnswer).toBeTruthy();
      expect(t3.semanticFrame?.domain).toBe('ACADEMIC_EVENT');
      expect(t3.semanticFrame?.intent).toBe('GRADUATION_INQUIRY');
      expect(t3.verification?.handledSafely).toBe(true);

      // Must explain graduation registration prerequisites (sidang TA / skripsi, bebas administrasi, SION, BAAK)
      expect(t3.text).toMatch(/wisuda/i);
      expect(t3.text).toMatch(/SION|BAAK/i);
      expect(t3.text).toMatch(/sidang|tugas\s+akhir|skripsi|administrasi/i);

      // Must NEVER output PMB new student steps or fees
      expect(t3.text).not.toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(t3.text).not.toMatch(/dana\s+pendidikan\s+pokok/i);
      expect(t3.text).not.toMatch(/biaya\s+pendaftaran/i);
      expect(t3.text).not.toMatch(/ijazah\s+sma/i);

      // Turn 4: Explicit PMB query in the same session must route to PMB
      const t4 = await processTurn(chatId, 'Bagaimana cara mendaftar mahasiswa baru?', { executeDispatch: false });
      expect(t4.semanticFrame?.domain).toBe('PMB');
      expect(t4.semanticFrame?.intent).toBe('ADMISSION_PROCEDURE');
      expect(t4.text).toMatch(/pmb\.stikom-bali\.ac\.id/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 2: Konteks Dual Degree Nasional hilang
  // ---------------------------------------------------------------------------
  describe('Case 2: Konteks Dual Degree Nasional hilang', () => {
    test('followup "Bagaimana cara mendaftar?" retains Dual Degree UTB context and guides to official portal', async () => {
      const chatId = 'test-regress-utb-' + Date.now();

      // Turn 1: Discuss Dual Degree UTB
      const t1 = await processTurn(chatId, 'Kalau Double Degree dengan UTB itu seperti apa ya?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('INTERNATIONAL');
      expect(t1.text).toMatch(/UTB|Universitas Teknologi Bandung/i);
      expect(t1.text).toMatch(/Bisnis Digital/i);
      expect(t1.text).toMatch(/Desain Komunikasi Visual|DKV/i);

      // Turn 2: Followup inquiry on how to register
      const t2 = await processTurn(chatId, 'Bagaimana cara mendaftar?', { executeDispatch: false });

      // Entity must retain Dual Degree UTB
      const activeEntity = t2.semanticFrame?.entities?.[0]?.canonical;
      expect(activeEntity).toMatch(/Dual Degree UTB/i);

      // Verifier must handle safely
      expect(t2.verification?.handledSafely).toBe(true);

      // Answer must contain official PMB portal and reference the Dual Degree partnership
      expect(t2.text).toMatch(/https:\/\/pmb\.stikom-bali\.ac\.id/i);
      expect(t2.text).toMatch(/Dual Degree Nasional|UTB/i);
      expect(t2.text).toMatch(/Bisnis Digital/i);

      // Must NOT return a generic "informasi tidak tersedia" refusal
      expect(t2.text).not.toBe('Informasi resmi mengenai hal tersebut belum tercantum dalam panduan yang tersedia.');
      expect(t2.text).not.toBe('Informasi resmi terkait aspek tersebut belum tercantum secara lengkap dalam panduan yang tersedia.');
    });
  });

  // ---------------------------------------------------------------------------
  // Case 3: Follow-up biaya kehilangan konteks
  // ---------------------------------------------------------------------------
  describe('Case 3: Follow-up biaya kehilangan konteks', () => {
    test('"Kalau gelombang 2 berapa?" preserves S1 Sistem Informasi and computes Gelombang II discount', async () => {
      const chatId = 'test-regress-fee-' + Date.now();

      // Turn 1: Fee inquiry for S1 Sistem Informasi
      const t1 = await processTurn(chatId, 'Berapa biaya S1 Sistem Informasi per semester?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('TUITION_FEE');
      expect(t1.text).toMatch(/S1 Sistem Informasi/i);

      // Turn 2: Followup for wave 2
      const t2 = await processTurn(chatId, 'Kalau gelombang 2 berapa?', { executeDispatch: false });

      // Domain must remain TUITION_FEE with TUITION_FEE_INQUIRY intent
      expect(t2.semanticFrame?.domain).toBe('TUITION_FEE');
      expect(t2.semanticFrame?.intent).toBe('TUITION_FEE_INQUIRY');

      // Verifier must pass without contradiction
      expect(t2.verification?.outcome).toBe('VERIFIED_FACTUAL');

      // Answer must correctly compute S1 SI Gelombang II numbers
      expect(t2.text).toMatch(/S1 Sistem Informasi/i);
      expect(t2.text).toMatch(/Gelombang II/i);

      // Official Gelombang II DPP discount: normal 14M -> net 12.5M (potongan 1.5M)
      expect(t2.text).toMatch(/12\.500\.000/);
      expect(t2.text).toMatch(/1\.500\.000/);

      // Official Initial Total Net: 14.300.000
      expect(t2.text).toMatch(/14\.300\.000/);
    });
  });

  // ---------------------------------------------------------------------------
  // Case 4: Pertanyaan lokasi kampus gagal
  // ---------------------------------------------------------------------------
  describe('Case 4: Pertanyaan lokasi kampus gagal', () => {
    test('"Di mana lokasi kampus ITB STIKOM Bali?" returns official campus locations and addresses', async () => {
      const chatId = 'test-regress-loc-' + Date.now();

      const t1 = await processTurn(chatId, 'Di mana lokasi kampus ITB STIKOM Bali?', { executeDispatch: false });

      // Intent must be CAMPUS_LOCATION
      expect(t1.semanticFrame?.intent).toBe('CAMPUS_LOCATION');

      // Verifier must pass
      expect(t1.verification?.outcome).toBe('VERIFIED_FACTUAL');

      // Answer must include all three official campus branches with addresses
      expect(t1.text).toMatch(/Kampus Renon/i);
      expect(t1.text).toMatch(/Jl\. Raya Puputan No\. 86/i);

      expect(t1.text).toMatch(/Kampus Jimbaran/i);
      expect(t1.text).toMatch(/Jl\. Raya Kampus Udayana/i);

      expect(t1.text).toMatch(/Kampus Abiansemal/i);
      expect(t1.text).toMatch(/Jl\. Janger|Dauh Yeh Cani|Abiansemal/i);

      // Must NOT return generic corpus gap
      expect(t1.status).not.toBe('corpus_gap');
      expect(t1.text).not.toMatch(/informasi resmi terkait hal ini belum tercantum/i);
    });
  });
});
