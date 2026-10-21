'use strict';

/**
 * tests/comprehensiveMultiDomainAcceptance.test.js
 *
 * Comprehensive acceptance and regression test suite for Tiko (ITB STIKOM Bali RAG Chatbot)
 * validating real corpus coverage across 8 major campus domains and 12 conversational patterns (A–L).
 *
 * Patterns:
 * A. Direct question (matching source terminology)
 * B. Paraphrase (different wording, same intent)
 * C. Conversational / short / slang / realistic typos
 * D. Follow-up multi-turn relying on prior context
 * E. Entity switch within context (preserving relevant wave or parameters)
 * F. Domain switch (clean context reset without contamination)
 * G. Multi-intent / comparison
 * H. Multi-evidence synthesis
 * I. Ambiguous question requiring clarification
 * J. True out-of-corpus question (SOURCE_GAP detection without hallucination)
 * K. Temporal / wave distinction (conflicting waves or timeframes)
 * L. Vulnerable retrieval (rare or nuanced topics prone to keyword mismatch)
 *
 * 8 Corpus Domains:
 * 1. Academic Programs & Curriculum (SI, TI, SK, BD, MI)
 * 2. Accreditation (Institutional & Program level)
 * 3. PMB & Tuition Fees
 * 4. Double Degree & International
 * 5. Student Organizations & UKM (SYNTAX, Athena, KSL, BEM, etc.)
 * 6. Career Center & Business Incubator (INBIS Bali)
 * 7. Academic Administration & Graduation (Yudisium, Wisuda, SION)
 * 8. Postgraduate / S2 MSI
 */

process.env.NODE_ENV = 'test';

const { processTurn } = require('../src/core/orchestrator');

describe('Comprehensive Multi-Domain Acceptance & Pattern Matrix (A–L)', () => {
  jest.setTimeout(45000);

  // =========================================================================
  // DOMAIN 1: Academic Programs, Curriculum, and Career Outcomes
  // =========================================================================
  describe('Domain 1: Academic Programs & Curriculum', () => {
    test('Pattern A (Direct): "Kurikulum dan mata kuliah apa saja yang dipelajari di S1 Sistem Informasi?"', async () => {
      const res = await processTurn('d1_direct_' + Date.now(), 'Kurikulum dan mata kuliah apa saja yang dipelajari di S1 Sistem Informasi?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer.length).toBeGreaterThan(60);
    });

    test('Pattern B (Paraphrase): "Karier dan prospek kerja apa yang bisa diambil kalau lulusan Bisnis Digital?"', async () => {
      const res = await processTurn('d1_paraphrase_' + Date.now(), 'Karier dan prospek kerja apa yang bisa diambil kalau lulusan Bisnis Digital?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Bisnis Digital/i);
      expect(res.finalAnswer).toMatch(/(?:e-commerce|startup|digital|analis|pemasaran|bisnis)/i);
    });
  });

  // =========================================================================
  // DOMAIN 2: Accreditation (Institutional & Program)
  // =========================================================================
  describe('Domain 2: Accreditation', () => {
    test('Pattern C (Slang/Short): "akreditasi kampus stikom bali apa ya skrg?"', async () => {
      const res = await processTurn('d2_slang_' + Date.now(), 'akreditasi kampus stikom bali apa ya skrg?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Baik Sekali|B|Unggul/i);
      expect(res.finalAnswer).toMatch(/BAN-PT/i);
    });

    test('Pattern A (Direct): "Akreditasi untuk program studi Sistem Informasi apa?"', async () => {
      const res = await processTurn('d2_direct_' + Date.now(), 'Akreditasi untuk program studi Sistem Informasi apa?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Baik Sekali/i);
    });

    test('Pattern A (Regression - Resolved Source Conflict): "Akreditasi untuk program studi Teknologi Informasi apa?" confirms "Baik" (SK BAN-PT 5908/2022), not "Baik Sekali"', async () => {
      const res = await processTurn('d2_ti_akred_' + Date.now(), 'Akreditasi untuk program studi Teknologi Informasi apa?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/\bBaik\b/);
      expect(res.finalAnswer).not.toMatch(/Baik Sekali/i);
    });
  });

  // =========================================================================
  // DOMAIN 3: PMB & Tuition Fees
  // =========================================================================
  describe('Domain 3: PMB, Waves, and Fee Calculations', () => {
    test('Pattern D (Follow-up): Turn 1 registration fee -> Turn 2 scholarship options', async () => {
      const sessionId = 'd3_followup_' + Date.now();
      const res1 = await processTurn(sessionId, 'Berapa biaya pendaftaran mahasiswa baru?');
      expect(res1.finalAnswer).toBeDefined();
      expect(res1.finalAnswer).toMatch(/Rp\s*500\.000/);

      const res2 = await processTurn(sessionId, 'Kalau jalur beasiswa ada apa saja?');
      expect(res2.finalAnswer).toBeDefined();
      expect(res2.finalAnswer).toMatch(/(?:KIP|SKSS|Prestasi|beasiswa)/i);
    });

    test('Pattern K (Temporal/Wave distinction): Distinct DPP discounts across waves for S1 TI', async () => {
      const sessionId = 'd3_wave_dist_' + Date.now();
      const resKhusus = await processTurn(sessionId, 'Berapa biaya kuliah S1 Teknologi Informasi Gelombang Khusus?');
      expect(resKhusus.finalAnswer).toMatch(/Rp\s*11\.000\.000/); // DPP bersih (14jt - 3jt)

      const resG3 = await processTurn(sessionId + '_g3', 'Berapa biaya kuliah S1 Teknologi Informasi Gelombang III?');
      expect(resG3.finalAnswer).toMatch(/Rp\s*13\.000\.000/); // DPP bersih (14jt - 1jt)
    });
  });

  // =========================================================================
  // DOMAIN 4: Double Degree & International Programs
  // =========================================================================
  describe('Domain 4: Double Degree & International Partnerships', () => {
    test('Pattern G (Multi-intent / Comparison): "Jelaskan program Double Degree dengan HELP University Malaysia dan DNUI China?"', async () => {
      const res = await processTurn('d4_comparison_' + Date.now(), 'Jelaskan program Double Degree dengan HELP University Malaysia dan DNUI China?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/HELP University/i);
      expect(res.finalAnswer).toMatch(/DNUI|Dalian/i);
      expect(res.finalAnswer).toMatch(/(?:gelar|degree|bachelor|sarjana)/i);
    });

    test('Pattern H (Multi-evidence synthesis): "Apa persyaratan dan benefit program Student Exchange ke luar negeri?"', async () => {
      const res = await processTurn('d4_synthesis_' + Date.now(), 'Apa persyaratan dan benefit program Student Exchange ke luar negeri?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/(?:pertukaran|student exchange|internasional|luar negeri)/i);
    });

    test('Pattern G (Regression - Resolved Source Conflict): "Apa perbedaan program Double Degree HELP University Malaysia dengan DNUI China?" confirms distinct locations, degrees, and curricula (SK 629 Lampiran-4 & 5)', async () => {
      const res = await processTurn('d4_dd_conflict_' + Date.now(), 'Apa perbedaan program Double Degree HELP University Malaysia dengan DNUI China?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/HELP University/i);
      expect(res.finalAnswer).toMatch(/DNUI|Dalian/i);
      expect(res.finalAnswer).toMatch(/S\.Kom/i);
      expect(res.finalAnswer).toMatch(/BIT|Bachelor of Information Technology/i);
      expect(res.finalAnswer).toMatch(/S\.Bns/i);
      expect(res.finalAnswer).toMatch(/China/i);
    });
  });

  // =========================================================================
  // DOMAIN 5: Student Organizations & UKM
  // =========================================================================
  describe('Domain 5: Student Organizations & UKM', () => {
    test('Pattern B (Paraphrase): "Apakah ada UKM yang fokus ke public speaking dan MC?"', async () => {
      const res = await processTurn('d5_paraphrase_' + Date.now(), 'Apakah ada UKM yang fokus ke public speaking dan MC?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/SYNTAX/i);
    });

    test('Pattern L (Vulnerable retrieval): "Apa itu UKM SYNTAX?" confirms speaking club, not coding', async () => {
      const res = await processTurn('d5_vulnerable_' + Date.now(), 'Apa itu UKM SYNTAX?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Speaking Youth Entertainment Experience/i);
      expect(res.finalAnswer).toMatch(/public speaking|MC|broadcasting|pembawa acara/i);
    });

    test('Pattern E (Entity switch within UKM context): Arts club -> Robotics/Hardware club', async () => {
      const sessionId = 'd5_switch_' + Date.now();
      const res1 = await processTurn(sessionId, 'Ada ukm apa saja yang di bidang seni di stikom?');
      expect(res1.finalAnswer).toBeDefined();
      expect(res1.finalAnswer).toMatch(/(?:Tabuh|Tari|Pragina|Seni|Vokal|Musik)/i);

      const res2 = await processTurn(sessionId, 'Kalau yang di bidang robotika atau teknologi apa?');
      expect(res2.finalAnswer).toBeDefined();
      expect(res2.finalAnswer).toMatch(/(?:DOS|KSL|Komputer|Hardware|Robotik|Teknologi)/i);
    });
  });

  // =========================================================================
  // DOMAIN 6: Business Incubator (INBIS Bali) & Career Center
  // =========================================================================
  describe('Domain 6: Business Incubator (INBIS) & Career Center', () => {
    test('Pattern A (Direct): "Apa peran dan tahapan inkubasi di INBIS ITB STIKOM Bali?"', async () => {
      const res = await processTurn('d6_direct_' + Date.now(), 'Apa peran dan tahapan inkubasi di INBIS ITB STIKOM Bali?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/INBIS/i);
      expect(res.finalAnswer).toMatch(/Pra-Inkubasi/i);
      expect(res.finalAnswer).toMatch(/Inkubasi/i);
      expect(res.finalAnswer).toMatch(/Pasca-Inkubasi/i);
    });

    test('Pattern B (Paraphrase): "Gimana cara mahasiswa dapat modal usaha atau binaan startup di kampus?"', async () => {
      const res = await processTurn('d6_paraphrase_' + Date.now(), 'Gimana cara mahasiswa dapat modal usaha atau binaan startup di kampus?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/(?:INBIS|wirausaha|startup|P2MW|inkubasi)/i);
    });
  });

  // =========================================================================
  // DOMAIN 7: Academic Administration & Graduation (Yudisium, Wisuda, SION)
  // =========================================================================
  describe('Domain 7: Academic Administration & Graduation', () => {
    test('Pattern L (Vulnerable retrieval): "Apa saja syarat pendaftaran yudisium untuk wisuda?"', async () => {
      const res = await processTurn('d7_direct_' + Date.now(), 'Apa saja syarat pendaftaran yudisium untuk wisuda?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Yudisium/i);
      expect(res.finalAnswer).toMatch(/(?:Bebas Pustaka|Bebas Keuangan|Skripsi|Tugas Akhir|SION)/i);
    });

    test('Pattern F (Domain switch): Yudisium -> Campus Locations (clean context reset)', async () => {
      const sessionId = 'd7_domain_switch_' + Date.now();
      const res1 = await processTurn(sessionId, 'Apa saja syarat pendaftaran yudisium?');
      expect(res1.finalAnswer).toMatch(/Yudisium/i);

      // Clean switch to campus locations
      const res2 = await processTurn(sessionId, 'Kampus STIKOM Bali ada di mana saja lokasinya?');
      expect(res2.finalAnswer).toMatch(/Renon/i);
      expect(res2.finalAnswer).toMatch(/Jimbaran/i);
      // Ensure no leftover yudisium text in res2
      expect(res2.finalAnswer).not.toMatch(/Syarat Pendaftaran Yudisium/i);
    });
  });

  // =========================================================================
  // DOMAIN 8: Postgraduate / Pascasarjana (S2 Magister Sistem Informasi)
  // =========================================================================
  describe('Domain 8: Postgraduate / S2 MSI', () => {
    test('Pattern A (Direct): "Apa saja konsentrasi atau fokus riset di S2 Sistem Informasi?"', async () => {
      const res = await processTurn('d8_direct_' + Date.now(), 'Apa saja konsentrasi atau fokus riset di S2 Sistem Informasi?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Data Science/i);
      expect(res.finalAnswer).toMatch(/Cyber Security/i);
      expect(res.finalAnswer).toMatch(/Enterprise System/i);
      expect(res.finalAnswer).toMatch(/Medical Informatics/i);
    });

    test('Pattern C (Slang/Short): "s2 stikom kuliahnya online atau tatap muka?"', async () => {
      const res = await processTurn('d8_slang_' + Date.now(), 's2 stikom kuliahnya online atau tatap muka?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Reguler|tatap muka|Renon/i);
      expect(res.finalAnswer).toMatch(/0822-7738-9999|244445/);
    });

    test('Pattern A (Regression - Resolved Source Conflict): "Berapa biaya kuliah S2 Sistem Informasi per semester?" confirms Rp 10.000.000 per semester and Rp 40.000.000 lump sum, strictly excluding Rp 11.000.000', async () => {
      const res = await processTurn('d8_s2_fee_conflict_' + Date.now(), 'Berapa biaya kuliah S2 Sistem Informasi per semester?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/10\.000\.000/);
      expect(res.finalAnswer).toMatch(/40\.000\.000/);
      expect(res.finalAnswer).not.toMatch(/11\.000\.000/);
    });
  });

  // =========================================================================
  // PATTERNS I & J: Ambiguity & True Out-of-Corpus (Negative Test)
  // =========================================================================
  describe('Patterns I & J: Clarification & Out-of-Corpus Protection', () => {
    test('Pattern I (Ambiguity): "Berapa biayanya?" triggers clarification', async () => {
      const res = await processTurn('pat_ambig_' + Date.now(), 'Berapa biayanya?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/(?:program studi|jurusan|jenjang|S1|D3)/i);
    });

    test('Pattern J (True Out-of-Corpus / Negative Test): "Apakah ada jurusan Kedokteran Gigi di STIKOM Bali?" triggers honest refusal', async () => {
      const res = await processTurn('pat_ooc_' + Date.now(), 'Apakah ada jurusan Kedokteran Gigi di STIKOM Bali?');
      expect(res.finalAnswer).toBeDefined();
      // Must honestly state it is not available / STIKOM Bali focuses on ICT & Business
      expect(res.finalAnswer).toMatch(/(?:tidak memiliki|tidak menyelenggarakan|tidak terdapat|fokus pada bidang|teknologi informasi|komputer)/i);
      expect(res.finalAnswer).not.toMatch(/Biaya pendaftaran Kedokteran Gigi/i);
    });
  });
});
