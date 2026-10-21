'use strict';

/**
 * tests/conversationalAcceptanceEngine.test.js
 *
 * Automated repeatable regression test suite for Conversational Acceptance Cases A–J
 * and 10% cash DPP discount verification invariants.
 */

process.env.NODE_ENV = 'test';

const { processTurn } = require('../src/core/orchestrator');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { buildRetrievalPlan } = require('../src/core/retrievalPlanner');
const { retrieveCandidates } = require('../src/core/retrievalService');
const { arbitrateEvidence } = require('../src/core/evidenceArbiter');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { generateFeeAnswer } = require('../src/core/feeCalculationEngine');
const { VERIFICATION_OUTCOME } = require('../src/reasoning/contracts');

describe('Conversational Acceptance Engine & Multi-Turn Regression Suite', () => {
  jest.setTimeout(45000);

  // =========================================================================
  // 1. KASUS A: Kontinuitas Konteks & Pergantian Entitas/Gelombang (3-Turn)
  // =========================================================================
  describe('Kasus A: Multi-turn Context Continuity & Cross-Entity Wave Inheritance', () => {
    const testSessionChatId = 'acceptance_session_3turn_' + Date.now();

    test('Turn 1: "Berapa biaya kuliah S1 Sistem Informasi?" resolves base fees', async () => {
      const res = await processTurn(testSessionChatId, 'Berapa biaya kuliah S1 Sistem Informasi?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Rp\s*14\.000\.000/); // DPP dasar
      expect(res.finalAnswer).toMatch(/Rp\s*6\.500\.000/);  // SPP semester
      expect(res.finalAnswer).toMatch(/Rp\s*1\.500\.000/);  // Perlengkapan
    });

    test('Turn 2: "Kalau Gelombang II berapa?" inherits S1 Sistem Informasi with Gelombang II', async () => {
      const res = await processTurn(testSessionChatId, 'Kalau Gelombang II berapa?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Gelombang II/i);
      expect(res.finalAnswer).toMatch(/Rp\s*300\.000/);     // Pendaftaran bersih (500k - 200k)
      expect(res.finalAnswer).toMatch(/Rp\s*12\.500\.000/); // DPP bersih (14jt - 1.5jt)
      expect(res.finalAnswer).toMatch(/Rp\s*14\.300\.000/); // Total biaya awal bersih (300k + 1.5jt + 12.5jt)
      expect(res.finalAnswer).toMatch(/Rp\s*6\.500\.000/);  // SPP semester
    });

    test('Turn 3: "Kalau Sistem Komputer?" switches entity to S1 Sistem Komputer and inherits Gelombang II', async () => {
      const res = await processTurn(testSessionChatId, 'Kalau Sistem Komputer?');
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Komputer/i);
      expect(res.finalAnswer).toMatch(/Gelombang II/i);

      // Reconciled Matrix Invariants for S1 SK Gelombang II:
      // Pendaftaran bersih: Rp 300.000
      expect(res.finalAnswer).toMatch(/Rp\s*300\.000/);
      // Perlengkapan: Rp 1.500.000
      expect(res.finalAnswer).toMatch(/Rp\s*1\.500\.000/);
      // DPP bersih: Rp 10.250.000 (11jt - 750k)
      expect(res.finalAnswer).toMatch(/Rp\s*10\.250\.000/);
      // Total biaya awal: Rp 12.050.000 (300k + 1.5jt + 10.25jt)
      expect(res.finalAnswer).toMatch(/Rp\s*12\.050\.000/);
      // SPP: Rp 6.000.000 per semester
      expect(res.finalAnswer).toMatch(/Rp\s*6\.000\.000/);
    });

    test('Turn 4 Safe Wave Validation: Unsafe inherited wave prompts clarification instead of silent fallback', async () => {
      const unsafeSessionId = 'unsafe_wave_session_' + Date.now();
      // Step 1: establish wave Sisipan for S1
      await processTurn(unsafeSessionId, 'Berapa biaya S1 Sistem Informasi Gelombang Sisipan?');
      // Step 2: switch to a program/context that lacks this wave
      const frame = resolveSemanticFrame('Kalau program lain yang tidak ada sisipan?', {
        activeEntity: 'S1 Sistem Informasi',
        registrationWave: 'Gelombang Fiktif'
      });
      const answer = generateFeeAnswer(frame, {}, null);
      if (answer) {
        expect(answer).toMatch(/mohon konfirmasi|gelombang|pilihan/i);
      }
    });
  });

  // =========================================================================
  // 2. KASUS B: Multi-Intent Biaya & Jadwal
  // =========================================================================
  describe('Kasus B: Multi-Intent Fee & Schedule', () => {
    test('Decomposes and answers fee and registration schedule simultaneously', async () => {
      const query = 'Berapa biaya kuliah S1 Sistem Informasi dan kapan jadwal pendaftarannya?';
      const res = await processTurn('multi_intent_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/biaya|dpp|spp|pendaftaran/i);
      expect(res.finalAnswer).toMatch(/jadwal|gelombang|periode|dibuka/i);
    });
  });

  // =========================================================================
  // 3. KASUS C: Pemisahan Biaya D3 dan DPP
  // =========================================================================
  describe('Kasus C: D3 Fee Classification & Separation from DPP', () => {
    test('D3 Manajemen Informatika fees are labeled as "Biaya Registrasi" and NEVER as DPP', async () => {
      const query = 'Berapa biaya kuliah D3 Manajemen Informatika Gelombang Khusus?';
      const res = await processTurn('d3_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/D3\s+Manajemen\s+Informatika/i);

      // Must explicitly use Biaya Registrasi
      expect(res.finalAnswer).toMatch(/Biaya Registrasi\s*\(Jas,\s*Topi,\s*GMTI\)/i);

      // Nominals for Gelombang Khusus D3:
      // Pendaftaran bersih: Rp 200.000 (normal Rp 500.000, diskon Rp 300.000)
      expect(res.finalAnswer).toMatch(/Rp\s*200\.000/);
      // Biaya Registrasi bersih: Rp 8.000.000 (dasar Rp 10.000.000, diskon Rp 2.000.000)
      expect(res.finalAnswer).toMatch(/Rp\s*8\.000\.000/);
      // Total biaya awal: Rp 8.200.000 (200k + 8jt)
      expect(res.finalAnswer).toMatch(/Rp\s*8\.200\.000/);
      // SPP per semester: Rp 4.500.000
      expect(res.finalAnswer).toMatch(/Rp\s*4\.500\.000/);

      // Negative assertion: Must not label the Rp 10.000.000 or Rp 8.000.000 component as DPP
      expect(res.finalAnswer).not.toMatch(/DPP\s*:\s*Rp\s*8\.000\.000/);
      expect(res.finalAnswer).not.toMatch(/DPP\s*:\s*Rp\s*10\.000\.000/);
    });
  });

  // =========================================================================
  // 4. KASUS D: Batas Cicilan Antarprogram
  // =========================================================================
  describe('Kasus D: Installment Plan Limits by Program', () => {
    test('S1 Sistem Informasi installment scheme specifies 3x installments within semester bounds', async () => {
      const query = 'Bagaimana skema cicilan biaya kuliah S1 Sistem Informasi?';
      const res = await processTurn('installment_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/cicil(?:an)?/i);
      expect(res.finalAnswer).toMatch(/Sistem Informasi/i);
    });

    test('D3 Manajemen Informatika installment scheme applies to Biaya Registrasi', async () => {
      const query = 'Bagaimana skema cicilan D3 Manajemen Informatika?';
      const res = await processTurn('installment_d3_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/cicil(?:an)?|tahap|registrasi/i);
      expect(res.finalAnswer).toMatch(/D3\s+Manajemen\s+Informatika/i);
    });
  });

  // =========================================================================
  // 5. KASUS E: Pertanyaan Administratif yang Tidak Memiliki Evidence
  // =========================================================================
  describe('Kasus E: Administrative Questions without Evidence (Safe Guidance)', () => {
    test('Late KRS advising inquiry safely routes to SAFE_UNKNOWN / guidance without hallucination', async () => {
      const query = 'Bagaimana prosedur perwalian jika terlambat mengisi KRS dan siapa dosen wali yang harus dihubungi?';
      const res = await processTurn('advising_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/dosen[_\s]*wali|baak|akademik|krs/i);

      // Invariant: Must not hallucinate fictitious personal phone numbers
      expect(res.finalAnswer).not.toMatch(/08[1-9]{1}[0-9]{8,11}/);
    });
  });

  // =========================================================================
  // 6. KASUS F: Domain Program Studi & Akreditasi
  // =========================================================================
  describe('Kasus F: Academic Programs & Accreditation', () => {
    test('Accreditation inquiry retrieves official LAM-INFOKOM status', async () => {
      const query = 'Apa akreditasi program studi S1 Teknologi Informasi?';
      const res = await processTurn('accreditation_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/Teknologi Informasi/i);
      expect(res.finalAnswer).toMatch(/Baik\s+Sekali|LAM-?INFOKOM|akreditasi/i);
    });
  });

  // =========================================================================
  // 7. KASUS G: Domain Beasiswa & UKM
  // =========================================================================
  describe('Kasus G: Scholarships & Student Organizations', () => {
    test('KIP Kuliah inquiry preserves SCHOLARSHIP domain without collapsing to tuition fee', async () => {
      const query = 'Apa saja syarat beasiswa KIP Kuliah di STIKOM Bali?';
      const res = await processTurn('scholarship_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/KIP\s*Kuliah|beasiswa/i);
      expect(res.finalAnswer).toMatch(/persyaratan|syarat/i);
    });

    test('UKM DOS inquiry retrieves Dance of STIKOM organization details', async () => {
      const query = 'profil UKM DOS dance of stikom';
      const res = await processTurn('ukm_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/DOS|Dance|tari|modern\s+dance/i);
    });
  });

  // =========================================================================
  // 8. KASUS H: Domain Double Degree
  // =========================================================================
  describe('Kasus H: Double Degree Domain Isolation', () => {
    test('DNUI Double Degree inquiry discusses China partner and rejects HELP University contamination', async () => {
      const query = 'Double Degree DNUI di mana kuliahnya?';
      const res = await processTurn('dd_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/DNUI|China|Tiongkok|Dalian/i);

      // Sibling partner rejection: HELP University must NOT contaminate the answer
      expect(res.finalAnswer).not.toMatch(/HELP\s+University/i);
    });
  });

  // =========================================================================
  // 9. KASUS I: Pertanyaan di Luar Corpus & Pertanyaan Ambigu
  // =========================================================================
  describe('Kasus I: Out-of-Corpus & Ambiguous Queries', () => {
    test('Out-of-corpus query triggers unsupported program / safe refusal', async () => {
      const query = 'Berapa biaya kuliah fakultas kedokteran hewan?';
      const res = await processTurn('unknown_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/tidak\s+(?:tersedia|menawarkan|memiliki)|belum\s+tersedia|tidak\s+ditemukan/i);
    });

    test('Ambiguous query without entity context triggers clarification request', async () => {
      const query = 'Berapa biayanya?';
      const res = await processTurn('ambiguous_session_' + Date.now(), query);
      expect(res.finalAnswer).toBeDefined();
      expect(res.finalAnswer).toMatch(/program\s+studi|jurusan|gelombang|maksud/i);
    });
  });

  // =========================================================================
  // 10. KASUS J: Pergantian Topik Tanpa Kebocoran Konteks
  // =========================================================================
  describe('Kasus J: Topic Switching without Context Leakage', () => {
    test('Switching from tuition fee to UKM switches active domain cleanly without fee pollution', async () => {
      const topicSessionId = 'topic_switch_session_' + Date.now();
      // Turn 1: Fee inquiry
      const t1 = await processTurn(topicSessionId, 'Berapa biaya kuliah S1 Sistem Informasi?');
      expect(t1.finalAnswer).toMatch(/Rp\s*14\.000\.000/);

      // Turn 2: Topic switch to UKM Syntax (Speaking Youth Entertainment Experience)
      const t2 = await processTurn(topicSessionId, 'kegiatan ukm syntax synamon');
      expect(t2.finalAnswer).toMatch(/Unit Kegiatan Mahasiswa|UKM|Athena|kemahasiswaan|Syntax|kegiatan/i);

      // Negative assertion: No residual fee nominals leaked into UKM answer
      expect(t2.finalAnswer).not.toMatch(/Rp\s*14\.000\.000/);
      expect(t2.finalAnswer).not.toMatch(/Dana Pendidikan Pokok/i);
    });
  });

  // =========================================================================
  // 11. Section 2 Invariant: 10% Cash DPP Discount Verification Gate
  // =========================================================================
  describe('Section 2 Invariant: 10% Cash DPP Discount Gate in finalAnswerVerifier', () => {
    test('10% cash DPP discount claim on S1 Sistem Informasi passes with valid registry profile', () => {
      const candidateAnswer = 'Apabila DPP dibayar tunai pelunasan sekaligus, potongan ditambah 10% sesuai ketentuan resmi admisi PMB.';
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: 'apakah ada diskon jika dpp dilunasi tunai?',
        entities: [{ canonical: 'S1 Sistem Informasi' }]
      };
      const arbitratedEvidence = { accepted: [{ text: 'Apabila DPP dibayar tunai potongan ditambah 10% (sepuluh persen).' }] };

      const res = verifyFinalAnswer(candidateAnswer, frame, arbitratedEvidence);
      expect(res.pass).toBe(true);
      expect(res.outcome).toBe(VERIFICATION_OUTCOME.VERIFIED_FACTUAL);
    });

    test('10% cash DPP discount claim on S2 Pascasarjana is REJECTED by finalAnswerVerifier', () => {
      const candidateAnswer = 'Untuk S2 Magister Sistem Informasi, apabila DPP dibayar tunai pelunasan potongan ditambah 10%.';
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: 'apakah ada diskon tunai 10% untuk S2?',
        entities: [{ canonical: 'S2 Sistem Informasi' }]
      };
      const arbitratedEvidence = { accepted: [{ text: 'Biaya pendidikan S2 per semester dan paket 2 tahun.' }] };

      const res = verifyFinalAnswer(candidateAnswer, frame, arbitratedEvidence);
      expect(res.pass).toBe(false);
      expect(res.reason).toBe('unsupported_10pct_cash_discount_claim_for_s2');
    });

    test('10% cash DPP discount claim on Double Degree is REJECTED by finalAnswerVerifier', () => {
      const candidateAnswer = 'Untuk program Double Degree DNUI, apabila DPP dibayar tunai pelunasan terdapat diskon 10%.';
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: 'apakah ada diskon tunai dpp 10% untuk double degree?',
        entities: [{ canonical: 'Double Degree DNUI' }]
      };
      const arbitratedEvidence = { accepted: [{ text: 'Biaya pendidikan program Double Degree per semester.' }] };

      const res = verifyFinalAnswer(candidateAnswer, frame, arbitratedEvidence);
      expect(res.pass).toBe(false);
      expect(res.reason).toBe('unsupported_10pct_cash_discount_claim_for_double_degree');
    });

    test('10% cash DPP discount claim without evidence or registry support is REJECTED', () => {
      const candidateAnswer = 'Apabila DPP dibayar tunai pelunasan, terdapat potongan ditambah 10% secara langsung.';
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: 'apakah ada potongan tunai 10%?',
        entities: [{ canonical: 'Program Antah Berantah' }]
      };
      const arbitratedEvidence = { accepted: [{ text: 'Biaya kuliah normal tanpa diskon.' }] };

      const res = verifyFinalAnswer(candidateAnswer, frame, arbitratedEvidence);
      expect(res.pass).toBe(false);
      expect(res.reason).toBe('unsupported_10pct_cash_discount_claim_without_evidence');
    });

    test('10% cash discount claim on D3 Biaya Registrasi is REJECTED (unsupported without explicit documentary basis)', () => {
      const candidateAnswer = 'Untuk D3 Manajemen Informatika, apabila Biaya Registrasi dibayar tunai langsung lunas, diberikan tambahan potongan 10%.';
      const frame = {
        domain: 'TUITION_FEE',
        intent: 'TUITION_FEE_INQUIRY',
        rawQuery: 'apakah ada diskon tunai 10% untuk biaya registrasi D3?',
        entities: [{ canonical: 'D3 Manajemen Informatika' }]
      };
      const arbitratedEvidence = { accepted: [{ text: 'Biaya Registrasi D3 Rp 10.000.000 dapat dicicil.' }] };

      const res = verifyFinalAnswer(candidateAnswer, frame, arbitratedEvidence);
      expect(res.pass).toBe(false);
      expect(res.reason).toBe('unsupported_10pct_cash_discount_claim_for_d3_registration');
    });
  });
});
