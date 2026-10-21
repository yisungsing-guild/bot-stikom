/**
 * tests/feeIntentAndScheduleRouting.test.js
 * Regression tests for:
 * 1. Tuition fee intent classification across waves without being hijacked by PMB schedule
 * 2. True admission schedule inquiries correctly retaining PMB schedule intent
 */

const { decomposeQueryAsync, decomposeQuery } = require('../src/core/multiIntentResolver');
const { processTurn } = require('../src/core/orchestrator');

describe('Tuition Fee Intent & PMB Schedule Routing Guardrails', () => {
  describe('Group 1: Fee per wave inquiries classified as TUITION_FEE', () => {
    const feeWaveQueries = [
      'Biaya Sistem Informasi Gelombang II',
      'Rincian biaya Sistem Informasi Gelombang III',
      'Biaya pendaftaran Gelombang I',
      'Berapa biaya per semester?',
      'Berapa DPP untuk Sistem Komputer Gelombang I?',
      'Biaya Sistem Informasi Gelombang 2C',
      'Biaya kuliah Sistem Informasi Gelombang Khusus'
    ];

    for (const q of feeWaveQueries) {
      test(`[Sync Resolver] "${q}" classifies as TUITION_FEE / TUITION_FEE_INQUIRY`, () => {
        const frames = decomposeQuery(q, {});
        expect(frames[0].domain).toBe('TUITION_FEE');
        expect(frames[0].intent).toBe('TUITION_FEE_INQUIRY');
        expect(frames[0].aspects).toEqual(expect.arrayContaining(['fee']));
      });

      test(`[Async Model Resolver] "${q}" classifies as TUITION_FEE / TUITION_FEE_INQUIRY`, async () => {
        const frames = await decomposeQueryAsync(q, {}, { skipModelParser: true });
        expect(frames[0].domain).toBe('TUITION_FEE');
        expect(frames[0].intent).toBe('TUITION_FEE_INQUIRY');
      }, 5000);
    }
  });

  describe('Group 2: True admission schedule inquiries classified as PMB / ADMISSION_SCHEDULE', () => {
    const scheduleQueries = [
      'Jadwal PMB Gelombang II',
      'Kapan pendaftaran gelombang 2 buka?',
      'Jadwal penerimaan mahasiswa baru gelombang 1',
      'Gelombang 2 pmb dibuka sampai kapan?',
      'Kapan pendaftaran gelombang khusus ditutup?'
    ];

    for (const q of scheduleQueries) {
      test(`[Sync Resolver] "${q}" classifies as PMB / ADMISSION_SCHEDULE`, () => {
        const frames = decomposeQuery(q, {});
        expect(frames[0].domain).toBe('PMB');
        expect(frames[0].intent).toBe('ADMISSION_SCHEDULE');
      });

      test(`[Async Model Resolver] "${q}" classifies as PMB / ADMISSION_SCHEDULE`, async () => {
        const frames = await decomposeQueryAsync(q, {}, { skipModelParser: true });
        expect(frames[0].domain).toBe('PMB');
        expect(frames[0].intent).toBe('ADMISSION_SCHEDULE');
      }, 5000);
    }
  });

  describe('Group 3: Runtime processTurn routing and isolation', () => {
    test('Fee query routes to fee breakdown without schedule contamination', async () => {
      const res = await processTurn('test_route_fee_' + Date.now(), 'Biaya Sistem Informasi Gelombang II', { executeDispatch: false, skipModelParser: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('TUITION_FEE');
      expect(sub.frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(res.finalAnswer).toMatch(/Dana Pendidikan Pokok \(DPP\)/i);
      expect(res.finalAnswer).toMatch(/Rp 12\.500\.000/);
    }, 15000);

    test('Schedule query routes to admission schedule without fee engine hand-off', async () => {
      const res = await processTurn('test_route_sched_' + Date.now(), 'Jadwal PMB Gelombang II', { executeDispatch: false, skipModelParser: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('PMB');
      expect(sub.frame.intent).toBe('ADMISSION_SCHEDULE');
      expect(res.finalAnswer).not.toMatch(/Total kewajiban biaya awal/i);
    }, 15000);

    test('Payment schedule inquiry routes to TUITION_FEE and explains DPP payment timing', async () => {
      const res = await processTurn('test_route_pay_' + Date.now(), 'Kapan pembayaran DPP Sistem Informasi?', { executeDispatch: false, skipModelParser: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('TUITION_FEE');
      expect(['PAYMENT_SCHEDULE_INQUIRY', 'TUITION_FEE_INQUIRY']).toContain(sub.frame.intent);
      expect(res.finalAnswer).toMatch(/UTS-1/i);
      expect(res.finalAnswer).toMatch(/Cicilan/i);
    }, 15000);

    test('Specific registration fee inquiry routes to registration fee scope', async () => {
      const res = await processTurn('test_route_reg_' + Date.now(), 'Berapa biaya pendaftaran Sistem Informasi Gelombang II?', { executeDispatch: false, skipModelParser: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('TUITION_FEE');
      expect(sub.frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(res.finalAnswer).toMatch(/Rp 300\.000/);
    }, 15000);
  });

  describe('Group 4: Multi-intent inquiries with explicit program study', () => {
    test('"Kapan Gelombang II dibuka dan berapa biaya pendaftaran Sistem Informasi?" preserves both intents', async () => {
      const res = await processTurn('test_multi_1_' + Date.now(), 'Kapan Gelombang II dibuka dan berapa biaya pendaftaran Sistem Informasi?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].frame.domain).toBe('PMB');
      expect(res.subQueryResults[0].frame.intent).toBe('ADMISSION_SCHEDULE');
      expect(res.subQueryResults[1].frame.domain).toBe('TUITION_FEE');
      expect(res.subQueryResults[1].frame.intent).toBe('TUITION_FEE_INQUIRY');
      expect(res.finalAnswer).toMatch(/pembukaan|Gelombang II/i);
      expect(res.finalAnswer).toMatch(/Rp 300\.000/);
    }, 20000);
  });

  describe('Group 5: Sesi baru tanpa program studi (Ambiguous Study Program Handling)', () => {
    test('Sesi baru: "Berapa biaya pendaftaran Gelombang II?" tidak mengasumsikan S1 SI dan mendiferensiasi jenjang', async () => {
      const res = await processTurn('test_fresh_reg_' + Date.now(), 'Berapa biaya pendaftaran Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('TUITION_FEE');
      expect(sub.frame.entities.length).toBe(0);
      expect(res.finalAnswer).not.toMatch(/Biaya pendaftaran untuk \*S1 Sistem Informasi/i);
      expect(res.finalAnswer).toMatch(/Program Sarjana \(S1\) & Vokasi \(D3\) Reguler.*Rp 300\.000/s);
      expect(res.finalAnswer).toMatch(/Program Pascasarjana \(S2 Magister Sistem Informasi\).*Rp 600\.000/s);
      expect(res.finalAnswer).toMatch(/Program International Double Degree.*Rp 2\.000\.000/s);
      expect(res.finalAnswer).toMatch(/tentukan program studi|sebutkan program studi/i);
    }, 20000);

    test('Sesi baru: "Jelaskan jadwal PMB Gelombang II dan rincian biayanya." menjawab jadwal dan mengklarifikasi biaya tanpa mengasumsikan S1 SI', async () => {
      const res = await processTurn('test_fresh_sched_fee_' + Date.now(), 'Jelaskan jadwal PMB Gelombang II dan rincian biayanya.', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].frame.domain).toBe('PMB');
      expect(res.subQueryResults[1].frame.domain).toBe('TUITION_FEE');
      // Bagian jadwal tetap dijawab dari evidence
      expect(res.subQueryResults[0].answer).toMatch(/Penerimaan Mahasiswa Baru|PMB/i);
      // Bagian biaya tidak mengasumsikan S1 SI secara sepihak
      expect(res.subQueryResults[1].answer).not.toMatch(/Rincian Biaya Kuliah S1 Sistem Informasi/i);
      expect(res.subQueryResults[1].answer).toMatch(/S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital/i);
      expect(res.subQueryResults[1].answer).toMatch(/S1 Sistem Komputer/i);
      expect(res.subQueryResults[1].answer).toMatch(/D3 Manajemen Informatika/i);
      expect(res.subQueryResults[1].answer).toMatch(/informasikan program studi yang Kakak minati/i);
    }, 20000);

    test('Sesi baru: "Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?" mempertahankan kedua bagian', async () => {
      const res = await processTurn('test_fresh_fee_sched_' + Date.now(), 'Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(2);
      expect(res.subQueryResults[0].frame.domain).toBe('TUITION_FEE');
      expect(res.subQueryResults[1].frame.domain).toBe('PMB');
      // Bagian biaya tidak mengasumsikan S1 SI
      expect(res.subQueryResults[0].answer).not.toMatch(/Biaya pendaftaran untuk \*S1 Sistem Informasi/i);
      expect(res.subQueryResults[0].answer).toMatch(/Program Sarjana \(S1\) & Vokasi \(D3\) Reguler.*Rp 300\.000/s);
      expect(res.subQueryResults[0].answer).toMatch(/Program Pascasarjana \(S2/i);
      // Bagian jadwal registrasi ulang menyatakan status belum tercantum tanpa menghilangkan respons
      expect(res.subQueryResults[1].answer).toMatch(/Penerimaan Mahasiswa Baru|PMB|registrasi/i);
      expect(res.subQueryResults[1].verification.outcome).toBe('SAFE_UNKNOWN');
      expect(res.subQueryResults[1].status).toBe('corpus_gap');
    }, 20000);
  });

  describe('Group 6: Sesi dengan konteks program studi yang sah (Context Inheritance & Isolation)', () => {
    test('Turn 1 SI -> Turn 2: Mewarisi S1 SI, biaya cocok evidence SI, tanggal registrasi tidak dikarang', async () => {
      const chatId = 'test_ctx_si_seq_' + Date.now();
      // Turn 1: Buat konteks sah
      const t1 = await processTurn(chatId, 'Biaya Sistem Informasi Gelombang II', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(t1.finalAnswer).toMatch(/S1 Sistem Informasi/i);
      expect(t1.finalAnswer).toMatch(/Rp 12\.500\.000/); // DPP net SI

      // Turn 2: Pertanyaan biaya pendaftaran & registrasi ulang
      const t2 = await processTurn(chatId, 'Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(t2.subQueryResults.length).toBe(2);
      // Biaya pendaftaran mewarisi konteks S1 Sistem Informasi
      expect(t2.finalAnswer).toMatch(/Biaya pendaftaran untuk \*S1 Sistem Informasi \(Gelombang II\)\*/i);
      expect(t2.finalAnswer).toMatch(/Rp 300\.000/);
      // Tanggal registrasi ulang tidak dikarang dan berstatus SAFE_UNKNOWN
      expect(t2.subQueryResults[1].verification.outcome).toBe('SAFE_UNKNOWN');
      expect(t2.subQueryResults[1].status).toBe('corpus_gap');
    }, 25000);

    test('Turn 1 SK -> Turn 2: Mewarisi S1 Sistem Komputer tanpa tercampur tarif SI', async () => {
      const chatId = 'test_ctx_sk_seq_' + Date.now();
      // Turn 1: Buat konteks sah Sistem Komputer
      const t1 = await processTurn(chatId, 'Biaya Sistem Komputer Gelombang II', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(t1.finalAnswer).toMatch(/S1 Sistem Komputer/i);
      expect(t1.finalAnswer).toMatch(/Rp 10\.250\.000/); // DPP net SK Gel II, bukan SI (Rp 12.500.000)

      // Turn 2: Pertanyaan biaya pendaftaran & registrasi ulang
      const t2 = await processTurn(chatId, 'Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(t2.subQueryResults.length).toBe(2);
      expect(t2.finalAnswer).toMatch(/Biaya pendaftaran untuk \*S1 Sistem Komputer \(Gelombang II\)\*/i);
      expect(t2.finalAnswer).not.toMatch(/S1 Sistem Informasi/i);
    }, 25000);
  });

  describe('Group 7: Validasi label answerability pada tanggal unconfirmed', () => {
    test('Pertanyaan tanggal spesifik yang tidak ada di evidence diberi status internal SAFE_UNKNOWN / corpus_gap', async () => {
      const res = await processTurn('test_ans_label_' + Date.now(), 'kapan registrasi ulang Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      const sub = res.subQueryResults[0];
      expect(sub.frame.domain).toBe('PMB');
      expect(sub.verification.pass).toBe(false);
      expect(sub.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(sub.verification.status).toBe('SAFE_UNKNOWN');
      expect(sub.verification.reason).toBe('requested_date_unconfirmed');
      expect(sub.status).toBe('corpus_gap');
      expect(res.status).toBe('corpus_gap');
      expect(res.verification.outcome).toBe('SAFE_UNKNOWN');
    }, 15000);
  });

  describe('Group 8: Status verifikasi jadwal & sintesis multi-intent bebas bloat katalog', () => {
    test('"Jadwal PMB Gelombang II" mempertahankan tahapan didukung, tanggal spesifik SAFE_UNKNOWN, tanpa bloat katalog', async () => {
      const res = await processTurn('test_sched_stages_' + Date.now(), 'Jadwal PMB Gelombang II', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(1);
      const sub = res.subQueryResults[0];
      expect(sub.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(sub.verification.reason).toBe('requested_date_unconfirmed');
      expect(sub.status).toBe('corpus_gap');
      expect(res.status).toBe('corpus_gap');
      expect(res.verification.outcome).toBe('SAFE_UNKNOWN');

      // Tahapan yang didukung evidence tidak hilang
      expect(res.finalAnswer).toMatch(/Pendaftaran dan pengisian formulir online/i);
      expect(res.finalAnswer).toMatch(/Pembayaran biaya pendaftaran/i);
      expect(res.finalAnswer).toMatch(/Pengunggahan dan seleksi\/verifikasi berkas/i);
      expect(res.finalAnswer).toMatch(/Registrasi ulang mahasiswa baru/i);
      expect(res.finalAnswer).toMatch(/Batasan Jadwal.*belum dapat dipastikan/i);

      // Bebas dari fallback generic katalog program & pathways yang tidak relevan
      expect(res.finalAnswer).not.toMatch(/Program Sarjana \(S1\): Sistem Informasi, Sistem Komputer/i);
      expect(res.finalAnswer).not.toMatch(/Jalur Pendaftaran yang Tersedia/i);
      expect(res.finalAnswer).not.toMatch(/Ada yang ingin Kakak tanyakan lebih lanjut/i);
      expect(res.finalAnswer).not.toMatch(/mengenai status, saat ini belum tercantum/i);
    }, 15000);

    test('"Jelaskan jadwal PMB Gelombang II dan rincian biayanya." sintesis bersih multi-intent & status akurat', async () => {
      const res = await processTurn('test_sched_fee_clean_' + Date.now(), 'Jelaskan jadwal PMB Gelombang II dan rincian biayanya.', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(2);

      // Subquery 0: Jadwal
      const s0 = res.subQueryResults[0];
      expect(s0.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(s0.status).toBe('corpus_gap');
      expect(s0.answer).toMatch(/Tahapan pendaftaran PMB yang didukung meliputi/i);
      expect(s0.answer).toMatch(/Batasan Jadwal.*belum dapat dipastikan/i);
      expect(s0.answer).not.toMatch(/Jalur Pendaftaran yang Tersedia/i);

      // Subquery 1: Biaya (ambiguous program study: perbandingan kelompok program)
      const s1 = res.subQueryResults[1];
      expect(s1.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(s1.answer).toMatch(/S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital/i);
      expect(s1.answer).toMatch(/S1 Sistem Komputer/i);
      expect(s1.answer).toMatch(/D3 Manajemen Informatika/i);
      expect(s1.answer).toMatch(/informasikan program studi yang Kakak minati/i);

      // Status keseluruhan: SAFE_UNKNOWN karena aspek jadwal belum dapat dipastikan tanggalnya
      expect(res.status).toBe('corpus_gap');
      expect(res.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(res.verification.pass).toBe(false);
      expect(res.verifiedFacts.length).toBe(1);
      expect(res.verifiedFacts[0].domain).toBe('TUITION_FEE');
      expect(res.unconfirmedAspects.length).toBe(1);
      expect(res.unconfirmedAspects[0].domain).toBe('PMB');
    }, 20000);

    test('"Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?" sintesis terarah admisi & status akurat', async () => {
      const res = await processTurn('test_reg_re_reg_' + Date.now(), 'Berapa biaya pendaftaran dan kapan registrasi ulang Gelombang II?', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.subQueryResults.length).toBe(2);

      // Subquery 0: Biaya pendaftaran per kelompok program
      const s0 = res.subQueryResults[0];
      expect(s0.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(s0.answer).toMatch(/Program Sarjana \(S1\) & Vokasi \(D3\) Reguler.*Rp 300\.000/s);
      expect(s0.answer).toMatch(/Program Pascasarjana \(S2.*Rp 600\.000/s);
      expect(s0.answer).toMatch(/Program International Double Degree.*Rp 2\.000\.000/s);

      // Subquery 1: Tanggal registrasi ulang belum dipastikan & diarahkan ke admisi
      const s1 = res.subQueryResults[1];
      expect(s1.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(s1.status).toBe('corpus_gap');
      expect(s1.answer).toMatch(/Tanggal (?:pasti )?registrasi ulang PMB ITB STIKOM Bali Gelombang II belum dapat dipastikan/i);
      expect(s1.answer).toMatch(/hubungi bagian Admisi PMB/i);

      // Status keseluruhan
      expect(res.status).toBe('corpus_gap');
      expect(res.verification.outcome).toBe('SAFE_UNKNOWN');
      expect(res.verification.pass).toBe(false);
      expect(res.verifiedFacts.length).toBe(1);
      expect(res.unconfirmedAspects.length).toBe(1);

      // Bebas dari bloat umum
      expect(res.finalAnswer).not.toMatch(/Program Sarjana \(S1\): Sistem Informasi, Sistem Komputer/i);
      expect(res.finalAnswer).not.toMatch(/Jalur Pendaftaran yang Tersedia/i);
    }, 20000);

    test('Pertanyaan biaya tunggal tetap VERIFIED_FACTUAL tanpa regresi', async () => {
      const res = await processTurn('test_single_fee_reg_' + Date.now(), 'Biaya Sistem Informasi Gelombang II', { executeDispatch: false, skipModelParser: true, fastFallback: true });
      expect(res.status).toBeUndefined();
      expect(res.verification.outcome).toBe('VERIFIED_FACTUAL');
      expect(res.verification.pass).toBe(true);
      expect(res.verifiedFacts.length).toBe(1);
      expect(res.unconfirmedAspects.length).toBe(0);
      expect(res.finalAnswer).toMatch(/Rp 12\.500\.000/);
      expect(res.finalAnswer).toMatch(/Rp 14\.300\.000/);
    }, 15000);
  });

  describe('Group 9: Fee Provenance Negative Controls & Invariant Verification (Unit & Fixture vs Runtime)', () => {
    const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
    const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');

    test('Negative Test 1: Verifier menolak nominal pendaftaran yang menyimpang dari dokumen/canonical', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      const divergentAnswer = `Rincian Biaya S1 Sistem Informasi Gelombang II:\n- Biaya Pendaftaran: Rp 9.000.000\n- Perlengkapan: Rp 1.500.000\n- Dana Pendidikan Pokok (DPP): Rp 14.000.000\n- Biaya Pendidikan Per Semester: Rp 6.500.000`;

      const res = verifyFinalAnswer(divergentAnswer, frame, {
        accepted: [
          { text: 'Pendaftaran PMB ITB STIKOM Bali Gelombang II', source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' }
        ]
      });
      expect(res.pass).toBe(false);
      expect(res.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence.*registration fee/);
    });

    test('Negative Test 2: Verifier menolak nominal DPP yang menyimpang dari dokumen/canonical', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      const divergentAnswer = `Rincian Biaya S1 Sistem Informasi Gelombang II:\n- Biaya Pendaftaran: Rp 300.000\n- Dana Pendidikan Pokok (DPP): Rp 45.000.000\n- Biaya Pendidikan Per Semester: Rp 6.500.000`;

      const res = verifyFinalAnswer(divergentAnswer, frame, {
        accepted: [
          { text: 'Pendaftaran PMB ITB STIKOM Bali Gelombang II', source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' }
        ]
      });
      expect(res.pass).toBe(false);
      expect(res.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence.*DPP fee/);
    });

    test('Negative Test 3: Verifier menolak nominal SPP/semester yang menyimpang dari dokumen/canonical', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      const divergentAnswer = `Rincian Biaya S1 Sistem Informasi Gelombang II:\n- Biaya Pendaftaran: Rp 300.000\n- Dana Pendidikan Pokok (DPP): Rp 14.000.000\n- Biaya Pendidikan Per Semester: Rp 18.000.000`;

      const res = verifyFinalAnswer(divergentAnswer, frame, {
        accepted: [
          { text: 'Pendaftaran PMB ITB STIKOM Bali Gelombang II', source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' }
        ]
      });
      expect(res.pass).toBe(false);
      expect(res.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence.*semester fee/);
    });

    test('Negative Test 4: Verifier menolak pencampuran biaya semester ke dalam total kewajiban awal (anti-conflation)', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      // Conflating 16.000.000 + 6.500.000 = 22.500.000 as initial total
      const conflatedAnswer = `Rincian Biaya S1 Sistem Informasi Gelombang II:\n- Biaya Pendaftaran: Rp 500.000\n- Perlengkapan: Rp 1.500.000\n- Dana Pendidikan Pokok (DPP): Rp 14.000.000\n- Biaya Pendidikan Per Semester: Rp 6.500.000\n- Total Biaya Awal: Rp 22.500.000`;

      const res = verifyFinalAnswer(conflatedAnswer, frame, {
        accepted: [
          { text: 'Pendaftaran PMB ITB STIKOM Bali Gelombang II SK 629', source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' }
        ]
      });
      expect(res.pass).toBe(false);
      expect(res.reason).toMatch(/fee_arithmetic_conflated_semester_fee_into_initial_total/);
    });

    test('Positive Test 5: Jawaban dengan seluruh nominal valid dan terverifikasi lolos VERIFIED_FACTUAL', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      const factualAnswer = `*Rincian Biaya Kuliah S1 Sistem Informasi (Gelombang II)*\n\n` +
        `• Biaya Pendaftaran: Rp 500.000 (Potongan Beasiswa: Rp 200.000 -> Bersih: Rp 300.000)\n` +
        `• Biaya Perlengkapan: Rp 1.500.000\n` +
        `• Dana Pendidikan Pokok (DPP): Rp 14.000.000 (Potongan Beasiswa: Rp 1.500.000 -> Bersih: Rp 12.500.000)\n` +
        `• Biaya Pendidikan Per Semester: Rp 6.500.000\n` +
        `• Total kewajiban awal sebelum potongan: Rp 16.000.000\n` +
        `• Total kewajiban awal setelah potongan: Rp 14.300.000`;

      const res = verifyFinalAnswer(factualAnswer, frame, {
        accepted: [
          { text: 'SK 629 Rincian Biaya SI, TI, BD TA 2026/2027 Gelombang II Pendaftaran Rp 500.000 potongan Rp 200.000 DPP Rp 14.000.000 potongan Rp 1.500.000 SPP Rp 6.500.000 Perlengkapan Rp 1.500.000', source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf' }
        ]
      });
      expect(res.pass).toBe(true);
      expect(res.outcome).toBe('VERIFIED_FACTUAL');
    });
  });
});
