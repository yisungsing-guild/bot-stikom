'use strict';

/**
 * tests/liveWhatsappOct29Reproduction.test.js
 *
 * Multi-turn regression test suite for real WhatsApp production issues
 * recorded on 29 October 2026 (10:01–10:50 WITA):
 *
 * Requirements:
 * 1. Single-session 7-turn conversation (same chatId across all turns):
 *    Turn 1: "Di mana lokasi kampus ITB STIKOM Bali?"
 *    Turn 2: "Berapa ada kampus ITB STIKOM Bali?"
 *    Turn 3: "Lokasinya di mana saja?"
 *    Turn 4: "Kalau double degree dengan UTB itu seperti apa ya?"
 *    Turn 5: "Bagaimana cara mendaftar?"
 *    Turn 6: "Berapa biaya S1 Sistem Informasi per semester?"
 *    Turn 7: "Kalau gelombang 2C berapa?"
 * 2. Explicit new topics must defeat prior session context.
 * 3. Elliptical questions must correctly inherit preceding context.
 * 4. Contact answers must never be duplicated in a single message.
 * 5. All 3 campuses (Renon, Jimbaran, Abiansemal) must be consistently listed.
 */

const { processTurn } = require('../src/core/orchestrator');

jest.setTimeout(60000);

describe('Live WhatsApp 29 October 2026 Production Multi-Turn Regression', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  // ---------------------------------------------------------------------------
  // 1. Single-session 7-turn conversation
  // ---------------------------------------------------------------------------
  describe('Full 7-Turn Single-Session Continuity & Domain Switching', () => {
    test('Executes all 7 turns on the EXACT SAME chatId with verified final answer text', async () => {
      const chatId = 'test-wa-oct29-single-session-' + Date.now();

      // Turn 1: "Di mana lokasi kampus ITB STIKOM Bali?"
      const t1 = await processTurn(chatId, 'Di mana lokasi kampus ITB STIKOM Bali?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('FACILITIES');
      expect(t1.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(t1.text).toMatch(/Kampus Renon/i);
      expect(t1.text).toMatch(/Jl\. Raya Puputan No\. 86/i);
      expect(t1.text).toMatch(/Kampus Jimbaran/i);
      expect(t1.text).toMatch(/Jl\. Raya Kampus Udayana No\. 8/i);
      expect(t1.text).toMatch(/Kampus Abiansemal/i);
      expect(t1.text).toMatch(/Jl\. Jenderal Sudirman.*Blahkiuh/i);

      // Turn 2: "Berapa ada kampus ITB STIKOM Bali?"
      const t2 = await processTurn(chatId, 'Berapa ada kampus ITB STIKOM Bali?', { executeDispatch: false });
      expect(t2.semanticFrame?.domain).toBe('FACILITIES');
      expect(t2.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(t2.text).toMatch(/3|tiga/i);
      expect(t2.text).toMatch(/Kampus Renon/i);
      expect(t2.text).toMatch(/Kampus Jimbaran/i);
      expect(t2.text).toMatch(/Kampus Abiansemal/i);

      // Turn 3: "Lokasinya di mana saja?"
      const t3 = await processTurn(chatId, 'Lokasinya di mana saja?', { executeDispatch: false });
      expect(t3.semanticFrame?.domain).toBe('FACILITIES');
      expect(t3.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(t3.text).toMatch(/Kampus Renon/i);
      expect(t3.text).toMatch(/Kampus Jimbaran/i);
      expect(t3.text).toMatch(/Kampus Abiansemal/i);
      expect(t3.text).not.toMatch(/di luar cakupan/i);

      // Turn 4: "Kalau double degree dengan UTB itu seperti apa ya?"
      // Explicit topic must defeat FACILITIES context and NOT be answered with campus locations!
      const t4 = await processTurn(chatId, 'Kalau double degree dengan UTB itu seperti apa ya?', { executeDispatch: false });
      expect(t4.semanticFrame?.domain).toBe('INTERNATIONAL');
      expect(t4.semanticFrame?.intent).toBe('INTERNATIONAL_PROGRAM_INFO');
      expect(t4.semanticFrame?.entities?.[0]?.canonical).toMatch(/Dual Degree UTB/i);
      expect(t4.text).toMatch(/Universitas Teknologi Bandung|UTB/i);
      expect(t4.text).toMatch(/Bisnis Digital/i);
      expect(t4.text).toMatch(/Desain Komunikasi Visual|DKV/i);
      expect(t4.text).toMatch(/S\.Bns\./i);
      expect(t4.text).toMatch(/S\.Ds\./i);
      // Strictly must NOT be answered with campus locations
      expect(t4.text).not.toMatch(/memiliki tiga lokasi kampus yang strategis/i);

      // Turn 5: "Bagaimana cara mendaftar?"
      // Must inherit Dual Degree UTB context from Turn 4
      const t5 = await processTurn(chatId, 'Bagaimana cara mendaftar?', { executeDispatch: false });
      expect(t5.semanticFrame?.domain).toMatch(/INTERNATIONAL|PMB/);
      expect(t5.semanticFrame?.entities?.[0]?.canonical).toMatch(/Dual Degree UTB/i);
      expect(t5.text).toMatch(/Dual Degree Nasional/i);
      expect(t5.text).toMatch(/https:\/\/pmb\.stikom-bali\.ac\.id/i);
      expect(t5.text).toMatch(/Bisnis Digital/i);
      expect(t5.text).toMatch(/formulir|pendaftaran/i);
      expect(t5.text).toMatch(/ijazah|skl|ktp/i);
      expect(t5.text).toMatch(/portofolio|prosedur\s+(?:seleksi\s+)?teknis|ketentuan\s+teknis/i);
      expect(t5.text).toMatch(/\(0361\)\s*244445/);
      expect(t5.text).toMatch(/info@stikom-bali\.ac\.id/);
      expect(t5.text).not.toContain('0822-7738-9999');

      // Turn 6: "Berapa biaya S1 Sistem Informasi per semester?"
      // New explicit academic inquiry must override Dual Degree context
      const t6 = await processTurn(chatId, 'Berapa biaya S1 Sistem Informasi per semester?', { executeDispatch: false });
      expect(t6.semanticFrame?.domain).toBe('TUITION_FEE');
      expect(t6.semanticFrame?.entities?.[0]?.canonical).toMatch(/S1 Sistem Informasi/i);
      expect(t6.text).toMatch(/6\.500\.000/);
      expect(t6.text).toMatch(/S1 Sistem Informasi/i);

      // Turn 7: "Kalau gelombang 2C berapa?"
      // Wave fee followup must inherit S1 Sistem Informasi
      const t7 = await processTurn(chatId, 'Kalau gelombang 2C berapa?', { executeDispatch: false });
      expect(t7.semanticFrame?.domain).toBe('TUITION_FEE');
      expect(t7.semanticFrame?.entities?.[0]?.canonical).toMatch(/S1 Sistem Informasi/i);
      expect(t7.text).toMatch(/S1 Sistem Informasi/i);
      expect(t7.text).toMatch(/Gelombang 2C/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Duplicate Contact Answer Prevention
  // ---------------------------------------------------------------------------
  describe('Problem: Duplicate Contact Block Prevention', () => {
    test('Coordinated contact inquiry ("Berapa nomor telepon dan kontak resmi ITB STIKOM Bali?") prints official contact exactly once', async () => {
      const chatId = 'test-wa-contact-dup-' + Date.now();
      const res = await processTurn(chatId, 'Berapa nomor telepon dan kontak resmi ITB STIKOM Bali?', { executeDispatch: false });

      expect(res.text).toMatch(/\(0361\)\s*244445/);
      expect(res.text).toMatch(/info@stikom-bali\.ac\.id/);

      // Count occurrences of official phone number
      const phoneMatches = res.text.match(/\(0361\)\s*244445/g) || [];
      expect(phoneMatches.length).toBe(1);

      // Count occurrences of official website link
      const webMatches = res.text.match(/https:\/\/pmb\.stikom-bali\.ac\.id/g) || [];
      expect(webMatches.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Elliptical Campus Location & Count Continuity
  // ---------------------------------------------------------------------------
  describe('Campus Location & Count Consistency', () => {
    test('Bare count inquiry "Berapa ada kampus?" without explicit brand inherits and answers all 3 campuses', async () => {
      const chatId = 'test-wa-campus-bare-' + Date.now();
      await processTurn(chatId, 'Di mana kampus ITB STIKOM Bali?', { executeDispatch: false });

      const t2 = await processTurn(chatId, 'Berapa ada kampus?', { executeDispatch: false });
      expect(t2.semanticFrame?.domain).toBe('FACILITIES');
      expect(t2.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(t2.text).toMatch(/3|tiga/i);
      expect(t2.text).toMatch(/Kampus Renon/i);
      expect(t2.text).toMatch(/Kampus Jimbaran/i);
      expect(t2.text).toMatch(/Kampus Abiansemal/i);
    });
  });
});
