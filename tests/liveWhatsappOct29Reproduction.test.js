'use strict';

/**
 * tests/liveWhatsappOct29Reproduction.test.js
 *
 * Multi-turn regression test suite for real WhatsApp production issues
 * recorded on 29 October 2026 (10:01–10:05 WITA):
 *
 * 1. Context inheritance Dual Degree UTB:
 *    Turn 1: "Kalau double degree dengan UTB itu seperti apa ya?"
 *    Turn 2: "Bagaimana cara mendaftar?"
 *    - Turn 2 must inherit entity "Dual Degree UTB".
 *    - Must provide official PMB portal (https://pmb.stikom-bali.ac.id) and general registration steps.
 *    - Must explain what specific UTB procedures are not yet detailed in the general guide.
 *    - Must provide verified official contacts ((0361) 244445, info@stikom-bali.ac.id, Ruang Layanan PMB).
 *    - Must not respond generically without context.
 *
 * 2. Context inheritance lokasi kampus:
 *    Turn 1: "Di mana lokasi kampus ITB STIKOM Bali?"
 *    Turn 2: "Berapa ada kampus ITB STIKOM Bali?"
 *    Turn 3: "Lokasinya di mana saja?"
 *    - Turn 3 must inherit campus entity and answer the exact locations of every official campus
 *      (Renon, Jimbaran, Abiansemal).
 *    - Must not be classified as OUT_OF_DOMAIN.
 *    - Must not hallucinate branch addresses not found in the official corpus.
 *
 * 3. Grounding kontak dan pendaftaran umum:
 *    - Verify that "0822-7738-9999" is not provided as general PMB/campus contact.
 *    - Verify verified contacts ((0361) 244445, info@stikom-bali.ac.id, https://pmb.stikom-bali.ac.id).
 *    - Verify "cara mendaftar mahasiswa baru" provides grounded steps and links without fabricated requirements.
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
  // 1. Context inheritance Dual Degree UTB
  // ---------------------------------------------------------------------------
  describe('Problem 1: Context inheritance Dual Degree UTB', () => {
    test('Follow-up "Bagaimana cara mendaftar?" inherits Dual Degree UTB entity, provides PMB portal, steps, notes missing UTB aspects, and verified contacts', async () => {
      const chatId = 'test-wa-oct29-utb-' + Date.now();

      // Turn 1: Ask about double degree with UTB
      const t1 = await processTurn(chatId, 'Kalau double degree dengan UTB itu seperti apa ya?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('INTERNATIONAL');
      expect(t1.semanticFrame?.entities?.[0]?.canonical).toMatch(/Dual Degree UTB/i);
      expect(t1.text).toMatch(/Universitas Teknologi Bandung|UTB/i);
      expect(t1.text).toMatch(/Bisnis Digital/i);
      expect(t1.text).toMatch(/Desain Komunikasi Visual|DKV/i);
      expect(t1.text).toMatch(/S\.Bns\./i);
      expect(t1.text).toMatch(/S\.Ds\./i);

      // Turn 2: Follow-up on how to register
      const t2 = await processTurn(chatId, 'Bagaimana cara mendaftar?', { executeDispatch: false });

      // Must inherit Dual Degree UTB
      const t2Entity = t2.semanticFrame?.entities?.[0]?.canonical;
      expect(t2Entity).toMatch(/Dual Degree UTB/i);

      // Must contain official PMB portal link
      expect(t2.text).toMatch(/https:\/\/pmb\.stikom-bali\.ac\.id/i);

      // Must contain grounded registration steps
      expect(t2.text).toMatch(/Dual Degree Nasional/i);
      expect(t2.text).toMatch(/Bisnis Digital/i);
      expect(t2.text).toMatch(/formulir|pendaftaran/i);
      expect(t2.text).toMatch(/ijazah|skl|ktp/i);

      // Must explain what specific UTB procedures are not available in general guide
      expect(t2.text).toMatch(/portofolio|prosedur\s+(?:seleksi\s+)?teknis|ketentuan\s+teknis/i);

      // Must provide verified official contacts
      expect(t2.text).toMatch(/\(0361\)\s*244445/);
      expect(t2.text).toMatch(/info@stikom-bali\.ac\.id/);
      expect(t2.text).toMatch(/Ruang Layanan PMB|Kampus Renon/i);

      // Must strictly NOT output ungrounded number 0822-7738-9999
      expect(t2.text).not.toContain('0822-7738-9999');
      expect(t2.text).not.toContain('082277389999');

      // Must NOT return a generic refusal as if context was lost
      expect(t2.text).not.toMatch(/informasi resmi terkait hal ini belum tercantum/i);
      expect(t2.text).not.toMatch(/pertanyaan Kakak di luar cakupan/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Context inheritance lokasi kampus
  // ---------------------------------------------------------------------------
  describe('Problem 2: Context inheritance lokasi kampus (3 turns)', () => {
    test('3-turn sequence preserves campus context and lists all official campuses without OOD or fabricated branches', async () => {
      const chatId = 'test-wa-oct29-campus-' + Date.now();

      // Turn 1: "Di mana lokasi kampus ITB STIKOM Bali?"
      const t1 = await processTurn(chatId, 'Di mana lokasi kampus ITB STIKOM Bali?', { executeDispatch: false });
      expect(t1.semanticFrame?.domain).toBe('FACILITIES');
      expect(t1.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      expect(t1.text).toMatch(/Kampus Renon/i);
      expect(t1.text).toMatch(/Kampus Jimbaran/i);
      expect(t1.text).toMatch(/Kampus Abiansemal/i);

      // Turn 2: "Berapa ada kampus ITB STIKOM Bali?"
      const t2 = await processTurn(chatId, 'Berapa ada kampus ITB STIKOM Bali?', { executeDispatch: false });
      expect(t2.semanticFrame?.domain).toBe('FACILITIES');
      expect(t2.semanticFrame?.intent).toBe('CAMPUS_LOCATION');
      // Must answer count: 3 / tiga
      expect(t2.text).toMatch(/tiga|3/i);
      expect(t2.text).toMatch(/Kampus Renon/i);
      expect(t2.text).toMatch(/Kampus Jimbaran/i);
      expect(t2.text).toMatch(/Kampus Abiansemal/i);

      // Turn 3: "Lokasinya di mana saja?"
      const t3 = await processTurn(chatId, 'Lokasinya di mana saja?', { executeDispatch: false });
      expect(t3.semanticFrame?.domain).toBe('FACILITIES');
      expect(t3.semanticFrame?.intent).toBe('CAMPUS_LOCATION');

      // Must NOT be out of domain
      expect(t3.semanticFrame?.domain).not.toBe('OUT_OF_DOMAIN');
      expect(t3.text).not.toMatch(/di luar cakupan/i);
      expect(t3.text).not.toMatch(/belum dapat memproses/i);

      // Must list all three official campus locations and their official addresses
      expect(t3.text).toMatch(/Kampus Renon/i);
      expect(t3.text).toMatch(/Jl\. Raya Puputan No\. 86/i);

      expect(t3.text).toMatch(/Kampus Jimbaran/i);
      expect(t3.text).toMatch(/Jl\. Raya Kampus Udayana No\. 8/i);

      expect(t3.text).toMatch(/Kampus Abiansemal/i);
      expect(t3.text).toMatch(/Jl\. Jenderal Sudirman.*Blahkiuh/i);

      // Must NOT fabricate branches not in the official corpus
      expect(t3.text).not.toMatch(/Singaraja/i);
      expect(t3.text).not.toMatch(/Tabanan/i);
      expect(t3.text).not.toMatch(/Ubud/i);
      expect(t3.text).not.toMatch(/Gianyar/i);
      expect(t3.text).not.toMatch(/Buleleng/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Grounding kontak dan pendaftaran umum
  // ---------------------------------------------------------------------------
  describe('Problem 3: Grounding kontak dan pendaftaran umum', () => {
    test('"Bagaimana cara mendaftar mahasiswa baru?" gives grounded PMB portal and valid steps without fabricated requirements', async () => {
      const chatId = 'test-wa-oct29-pmb-' + Date.now();

      const t = await processTurn(chatId, 'Bagaimana cara mendaftar mahasiswa baru?', { executeDispatch: false });
      expect(t.semanticFrame?.domain).toBe('PMB');
      expect(t.semanticFrame?.intent).toBe('ADMISSION_PROCEDURE');

      // Must contain official PMB portal
      expect(t.text).toMatch(/https:\/\/pmb\.stikom-bali\.ac\.id/i);

      // Must list grounded steps
      expect(t.text).toMatch(/pilih program studi/i);
      expect(t.text).toMatch(/formulir/i);
      expect(t.text).toMatch(/pembayaran/i);
      expect(t.text).toMatch(/berkas|dokumen/i);
      expect(t.text).toMatch(/verifikasi/i);

      // Must NOT hallucinate ungrounded requirements or test scores
      expect(t.text).not.toMatch(/skor\s+toefl/i);
      expect(t.text).not.toMatch(/surat\s+rekomendasi\s+kepala\s+desa/i);

      // Must strictly NOT contain 0822-7738-9999
      expect(t.text).not.toContain('0822-7738-9999');
      expect(t.text).not.toContain('082277389999');
    });

    test('Contact inquiry provides verified official contacts and no ungrounded 0822-7738-9999', async () => {
      const chatId = 'test-wa-oct29-contact-' + Date.now();

      const t = await processTurn(chatId, 'Berapa nomor telepon dan kontak resmi ITB STIKOM Bali?', { executeDispatch: false });

      // Must include verified phone and email
      expect(t.text).toMatch(/\(0361\)\s*244445/);
      expect(t.text).toMatch(/info@stikom-bali\.ac\.id|https:\/\/pmb\.stikom-bali\.ac\.id/i);

      // Must strictly NOT contain 0822-7738-9999
      expect(t.text).not.toContain('0822-7738-9999');
      expect(t.text).not.toContain('082277389999');
    });
  });
});
