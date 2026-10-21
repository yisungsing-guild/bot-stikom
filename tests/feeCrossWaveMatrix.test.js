/**
 * Comprehensive Cross-Wave Regression Test Suite
 *
 * Verifies fee resolution, calculation, formatting, and verification across:
 * 1. All official waves (Khusus, I, II, III, IV, Sisipan)
 * 2. Unverified sub-waves (1A, 2C, 3B) and out-of-bounds waves (SOURCE_GAP)
 * 3. Multiple study programs with distinct fee structures (S1 SI/TI/BD, S1 SK, D3 MI, HELP Double Degree, S2 MSI)
 * 4. Program-wave restriction (e.g., S2 MSI only supports Gelombang I & II; Gelombang III is unverified)
 * 5. Single-aspect queries (pendaftaran saja, semester saja, DPP saja)
 * 6. Side-by-side wave comparison ("Apakah biaya Gelombang I berbeda dengan Gelombang II?")
 * 7. Conversational follow-up ("Kalau gelombang berikutnya?")
 * 8. FinalAnswerVerifier guardrails across all waves and programs
 * 9. Anti-leak & cross-contamination protection
 */

const {
  detectFeeScope,
  resolveFeeProfile,
  calculateFeeBreakdown,
  formatWhatsAppFeeResponse,
  formatWaveComparisonResponse,
  generateFeeAnswer
} = require('../src/core/feeCalculationEngine');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');

describe('Cross-Wave & Multi-Program Fee Engine Regression Matrix', () => {

  // Helper for direct calculation
  function getCalculated(prodiKey, query, sessionContext = {}) {
    const profile = resolveFeeProfile(prodiKey);
    if (!profile) throw new Error(`Unknown profile key: ${prodiKey}`);
    const scopeParams = detectFeeScope(query, sessionContext);
    const breakdown = calculateFeeBreakdown(profile, scopeParams);
    const formatted = formatWhatsAppFeeResponse(breakdown, query);
    return { scopeParams, breakdown, formatted, profile };
  }

  // =========================================================================
  // 1. Matriks Seluruh Gelombang Resmi S1 SI / TI / BD (SK Rektor 629 Lampiran 1)
  // =========================================================================
  describe('1. Matriks Seluruh Gelombang Resmi S1 SI / TI / BD', () => {

    test('Gelombang Khusus: Potongan pendaftaran 300k (net 200k) & Beasiswa DPP 3jt (net 11jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Rincian biaya S1 Sistem Informasi Gelombang Khusus');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang Khusus');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);

      // Biaya Pendaftaran: 500k - 300k = 200k
      expect(breakdown.net.pendaftaran).toBe(200000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(300000);

      // Biaya Perlengkapan: 1.500.000 (tidak dipotong)
      expect(breakdown.base.perlengkapan).toBe(1500000);

      // Biaya DPP: 14jt - 3jt = 11jt
      expect(breakdown.net.dpp).toBe(11000000);
      expect(breakdown.discounts.dppDiscount).toBe(3000000);

      // Biaya Langsung Registrasi: 200k (Pendaftaran) + 1.5jt (Perlengkapan) = 1.7jt
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1700000);

      // Total Kewajiban Biaya Awal: 1.7jt + 11jt = 12.7jt
      expect(breakdown.net.initialTotal).toBe(12700000);

      // Verifikasi teks output
      expect(formatted).toContain('Gelombang Khusus');
      expect(formatted).toContain('Rp 12.700.000');
      expect(formatted).toContain('Rp 1.700.000');
      expect(formatted).toContain('Rp 11.000.000');
    });

    test('Gelombang I: Potongan pendaftaran 250k (net 250k) & Beasiswa DPP 2jt (net 12jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang I');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang I');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);
      expect(breakdown.net.pendaftaran).toBe(250000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(250000);
      expect(breakdown.net.dpp).toBe(12000000);
      expect(breakdown.discounts.dppDiscount).toBe(2000000);
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1750000);
      expect(breakdown.net.initialTotal).toBe(13750000);

      expect(formatted).toContain('Gelombang I');
      expect(formatted).toContain('Rp 13.750.000');
    });

    test('Gelombang II: Potongan pendaftaran 200k (net 300k) & Beasiswa DPP 1.5jt (net 12.5jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang II');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);
      expect(breakdown.net.pendaftaran).toBe(300000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(200000);
      expect(breakdown.net.dpp).toBe(12500000);
      expect(breakdown.discounts.dppDiscount).toBe(1500000);
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1800000); // 300k + 1.5jt
      expect(breakdown.net.initialTotal).toBe(14300000);

      expect(formatted).toContain('Gelombang II');
      expect(formatted).toContain('Rp 14.300.000');
      expect(formatted).toContain('Rp 1.800.000');
    });

    test('Gelombang III: Potongan pendaftaran 150k (net 350k) & Beasiswa DPP 1jt (net 13jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang III');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang III');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);
      expect(breakdown.net.pendaftaran).toBe(350000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(150000);
      expect(breakdown.net.dpp).toBe(13000000);
      expect(breakdown.discounts.dppDiscount).toBe(1000000);
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1850000); // 350k + 1.5jt
      expect(breakdown.net.initialTotal).toBe(14850000);

      expect(formatted).toContain('Gelombang III');
      expect(formatted).toContain('Rp 14.850.000');
    });

    test('Gelombang IV: Potongan pendaftaran 100k (net 400k) & Beasiswa DPP 500k (net 13.5jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Berapa biaya S1 Sistem Informasi Gelombang 4?');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang IV');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);
      expect(breakdown.net.pendaftaran).toBe(400000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(100000);
      expect(breakdown.net.dpp).toBe(13500000);
      expect(breakdown.discounts.dppDiscount).toBe(500000);
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1900000); // 400k + 1.5jt
      expect(breakdown.net.initialTotal).toBe(15400000);

      expect(formatted).toContain('Gelombang IV');
      expect(formatted).toContain('Rp 15.400.000');
    });

    test('Gelombang Sisipan: Tarif penuh tanpa potongan (net pendaftaran 500k, net DPP 14jt)', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Rincian biaya Sistem Informasi Gelombang Sisipan');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang Sisipan');
      expect(breakdown.scopeParams.isWaveVerified).toBe(true);
      expect(breakdown.net.pendaftaran).toBe(500000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(0);
      expect(breakdown.net.dpp).toBe(14000000);
      expect(breakdown.discounts.dppDiscount).toBe(0);
      expect(breakdown.net.biayaLangsungRegistrasi).toBe(2000000); // 500k + 1.5jt
      expect(breakdown.net.initialTotal).toBe(16000000);

      expect(formatted).toContain('Gelombang Sisipan');
      expect(formatted).toContain('Rp 16.000.000');
    });
  });

  // =========================================================================
  // 2. Subgelombang Tidak Resmi & Kasus Negatif (SOURCE_GAP)
  // =========================================================================
  describe('2. Subgelombang & Kasus Negatif (SOURCE_GAP)', () => {

    test('Gelombang 1A: Terdeteksi eksplicit tetapi tidak terverifikasi, tidak disamakan dengan Gelombang I', () => {
      const { breakdown, formatted } = getCalculated('S1 Teknologi Informasi', 'Berapa biaya Teknologi Informasi Gelombang 1A?');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang 1A');
      expect(breakdown.scopeParams.isWaveExplicit).toBe(true);
      expect(breakdown.scopeParams.isWaveVerified).toBe(false);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(0);
      expect(breakdown.discounts.dppDiscount).toBe(0);

      expect(formatted).toContain('Status Verifikasi Gelombang 1A');
      expect(formatted).toContain('tidak tercantum');
      expect(formatted).toContain('SOURCE_GAP');
      expect(formatted).toContain('Biaya Umum Program Studi (Tarif Dasar Terverifikasi)');
      expect(formatted).not.toMatch(/potongan gelombang 1A: Rp [1-9]/i);
    });

    test('Gelombang 2C: Terdeteksi eksplicit tetapi tidak terverifikasi, tidak disamakan dengan Gelombang II', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Saya mau tau rincian biaya sistem informasi gelombang 2C');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang 2C');
      expect(breakdown.scopeParams.isWaveVerified).toBe(false);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(0);
      expect(breakdown.discounts.dppDiscount).toBe(0);
      expect(formatted).toContain('Status Verifikasi Gelombang 2C');
      expect(formatted).toContain('Gelombang Khusus, Gelombang I, Gelombang II, Gelombang III, Gelombang IV, dan Gelombang Sisipan');
    });

    test('Gelombang 3B: Terdeteksi eksplicit tetapi tidak terverifikasi, tidak disamakan dengan Gelombang III', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Komputer', 'Biaya Sistem Komputer Gelombang 3B');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang 3B');
      expect(breakdown.scopeParams.isWaveVerified).toBe(false);
      expect(breakdown.discounts.dppDiscount).toBe(0);
      expect(formatted).toContain('Status Verifikasi Gelombang 3B');
    });

    test('Gelombang V / 5 (di luar rentang resmi): Ditandai belum terverifikasi', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Berapa biaya pendaftaran gelombang 5 S1 Sistem Informasi?');

      expect(breakdown.scopeParams.isWaveVerified).toBe(false);
      expect(formatted).toContain('SOURCE_GAP');
    });
  });

  // =========================================================================
  // 3. Matriks Lintas Program Studi (S1 SI, S1 SK, D3 MI, HELP, S2 MSI)
  // =========================================================================
  describe('3. Matriks Lintas Program Studi dengan Struktur Biaya Berbeda', () => {

    test('S1 Sistem Komputer (Lampiran 2): SPP 6jt, DPP 11jt, isolasi dari tarif SI', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Komputer', 'Berapa biaya kuliah S1 Sistem Komputer Gelombang I?');

      expect(breakdown.base.semester).toBe(6000000);
      expect(breakdown.base.dpp).toBe(11000000);
      expect(breakdown.discounts.dppDiscount).toBe(1000000);
      expect(breakdown.net.dpp).toBe(10000000);
      expect(breakdown.net.initialTotal).toBe(11750000); // 250k (reg) + 1.5jt (perlengkapan) + 10jt (net DPP)

      expect(formatted).toContain('S1 Sistem Komputer');
      expect(formatted).toContain('Rp 6.000.000');
      expect(formatted).toContain('Rp 10.000.000');
      expect(formatted).not.toContain('Rp 6.500.000'); // Bukan SPP Sistem Informasi
      expect(formatted).not.toContain('Rp 14.000.000'); // Bukan DPP Sistem Informasi
    });

    test('D3 Manajemen Informatika (Lampiran 3): SPP 4.5jt, DPP 10jt, skema diskon D3', () => {
      const { breakdown, formatted } = getCalculated('D3 Manajemen Informatika', 'Rincian biaya D3 Manajemen Informatika Gelombang II');

      expect(breakdown.base.semester).toBe(4500000);
      expect(breakdown.base.dpp).toBe(10000000);
      // Diskon Gelombang II D3: Pendaftaran disc 200k (net 300k), DPP disc 750k (net 9.25jt)
      expect(breakdown.discounts.pendaftaranDiscount).toBe(200000);
      expect(breakdown.discounts.dppDiscount).toBe(750000);
      expect(breakdown.net.dpp).toBe(9250000);
      expect(breakdown.net.initialTotal).toBe(9550000); // 300k + 9.25jt (DPP D3 mencakup perlengkapan)

      expect(formatted).toContain('D3 Manajemen Informatika');
      expect(formatted).toContain('Rp 4.500.000');
      expect(formatted).toContain('Rp 9.250.000');
    });

    test('Double Degree HELP University (Lampiran 5): Per subject 3jt, DPP 20jt', () => {
      const { breakdown, formatted } = getCalculated('Double Degree HELP University', 'Berapa biaya Double Degree HELP University Gelombang I?');

      expect(breakdown.profile.canonical).toBe('Double Degree HELP University');
      expect(breakdown.profile.components.biayaPerSubject.amount).toBe(3000000);
      expect(breakdown.base.dpp).toBe(20000000);
      expect(breakdown.discounts.dppDiscount).toBe(8000000);
      expect(breakdown.net.dpp).toBe(12000000);

      expect(formatted).toContain('Double Degree HELP University');
      expect(formatted).toContain('Rp 3.000.000 / subject');
      expect(formatted).toContain('Rp 12.000.000');
    });

    test('S2 Magister Sistem Informasi (Lampiran 8): Pendaftaran 700k, Gelombang I potongan 200k (net 500k)', () => {
      const { breakdown, formatted } = getCalculated('S2 Sistem Informasi', 'Rincian biaya S2 Sistem Informasi Gelombang I');

      expect(breakdown.base.pendaftaran).toBe(700000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(200000);
      expect(breakdown.net.pendaftaran).toBe(500000);

      expect(formatted).toContain('S2 Sistem Informasi');
      expect(formatted).toContain('Rp 500.000');
      expect(formatted).toContain('SOURCE_GAP');
    });

    test('Kasus Negatif S2: Gelombang III pada S2 MSI tidak ada di evidence (SOURCE_GAP)', () => {
      const { breakdown, formatted } = getCalculated('S2 Sistem Informasi', 'Biaya S2 Sistem Informasi Gelombang III');

      // Parser mengenali nama gelombang 'Gelombang III', tapi evidence S2 hanya punya Gelombang I dan II
      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang III');
      expect(breakdown.scopeParams.isWaveVerified).toBe(false);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(0);

      expect(formatted).toContain('Status Verifikasi Gelombang III');
      expect(formatted).toContain('Gelombang I dan Gelombang II'); // Hanya I dan II yang resmi untuk S2
      expect(formatted).toContain('SOURCE_GAP');
    });
  });

  // =========================================================================
  // 4. Single-Aspect Queries (Fokus Pertanyaan Spesifik)
  // =========================================================================
  describe('4. Single-Aspect Queries (Pendaftaran, DPP, Semester)', () => {

    test('Berapa biaya pendaftaran Gelombang III? -> fokus pendaftaran net 350k', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Berapa biaya pendaftaran Gelombang III S1 Sistem Informasi?');

      expect(formatted).toContain('Biaya pendaftaran untuk *S1 Sistem Informasi (Gelombang III)*');
      expect(formatted).toContain('Rp 350.000');
      expect(formatted).toContain('potongan Gelombang III Rp 150.000');
      // Tidak boleh mencantumkan rincian perlengkapan/semester pada query pendaftaran saja
      expect(formatted).not.toContain('Jas Almamater');
      expect(formatted).not.toContain('Biaya Pendidikan Per Semester');
    });

    test('Berapa biaya per semester Gelombang I? -> SPP 6.5jt dan penegasan tidak terpengaruh gelombang', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Berapa biaya per semester Gelombang I S1 Sistem Informasi?');

      expect(formatted).toContain('Rp 6.500.000');
      expect(formatted).toContain('tidak dipengaruhi oleh gelombang pendaftaran');
      expect(formatted).not.toContain('Dana Pendidikan Pokok (DPP): Rp 14.000.000');
    });

    test('Berapa DPP dan potongannya untuk Gelombang II? -> fokus DPP 14jt, potongan 1.5jt, net 12.5jt, cicilan', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Berapa DPP dan potongannya untuk Gelombang II S1 Sistem Informasi?');

      expect(formatted).toContain('Dana Pendidikan Pokok (DPP)');
      expect(formatted).toContain('Rp 14.000.000');
      expect(formatted).toContain('Rp 1.500.000');
      expect(formatted).toContain('Rp 12.500.000');
      expect(formatted).toContain('Dapat dicicil per bulan s.d. UTS-1');
      expect(formatted).toContain('10%');
    });
  });

  // =========================================================================
  // 5. Perbandingan Antargelombang (Wave Comparison Query)
  // =========================================================================
  describe('5. Perbandingan Antargelombang (Side-by-Side Comparison)', () => {

    test('Apakah biaya Gelombang I berbeda dengan Gelombang II? -> Menampilkan perbandingan side-by-side', () => {
      const query = 'Apakah biaya Gelombang I berbeda dengan Gelombang II S1 Sistem Informasi?';
      const answer = generateFeeAnswer('S1 Sistem Informasi', query);

      expect(answer.success).toBe(true);
      expect(answer.answer).toContain('Perbandingan Biaya Kuliah S1 Sistem Informasi (Gelombang I vs Gelombang II)');

      // Biaya Pendaftaran
      expect(answer.answer).toContain('**Gelombang I**: Rp 250.000 (potongan gelombang Rp 250.000');
      expect(answer.answer).toContain('**Gelombang II**: Rp 300.000 (potongan gelombang Rp 200.000');

      // Beasiswa DPP
      expect(answer.answer).toContain('**Gelombang I**: Rp 12.000.000 (beasiswa gelombang Rp 2.000.000');
      expect(answer.answer).toContain('**Gelombang II**: Rp 12.500.000 (beasiswa gelombang Rp 1.500.000');

      // Komponen yang sama
      expect(answer.answer).toContain('Komponen Biaya yang Sama (Tidak Dipengaruhi Gelombang)');
      expect(answer.answer).toContain('Rp 1.500.000');
      expect(answer.answer).toContain('Rp 6.500.000');

      // Selisih kewajiban biaya awal
      expect(answer.answer).toContain('Rp 550.000');
      expect(answer.answer).toContain('lebih hemat pada Gelombang I');
    });
  });

  // =========================================================================
  // 6. Conversational Follow-up ("Kalau gelombang berikutnya?")
  // =========================================================================
  describe('6. Conversational Follow-up (State Management & Next Wave Resolution)', () => {

    test('Turn 1 Gelombang I disusul Turn 2 "Kalau gelombang berikutnya?" berpindah ke Gelombang II', () => {
      // Turn 1
      const turn1Query = 'Biaya Sistem Informasi Gelombang I';
      const ans1 = generateFeeAnswer('S1 Sistem Informasi', turn1Query);
      expect(ans1.activeWave).toBe('Gelombang I');

      // Turn 2: Follow up
      const turn2Query = 'Kalau gelombang berikutnya?';
      const sessionContext = {
        lastActiveEntity: ans1.activeEntity,
        lastActiveWave: ans1.activeWave
      };

      const ans2 = generateFeeAnswer('S1 Sistem Informasi', turn2Query, sessionContext);
      expect(ans2.activeWave).toBe('Gelombang II');
      expect(ans2.answer).toContain('Gelombang II');
      expect(ans2.answer).toContain('Rp 14.300.000');
    });

    test('Turn 1 Gelombang IV disusul "Kalau gelombang selanjutnya?" berpindah ke Gelombang Sisipan', () => {
      const turn2Query = 'Kalau gelombang selanjutnya?';
      const sessionContext = {
        lastActiveEntity: 'S1 Sistem Informasi',
        lastActiveWave: 'Gelombang IV'
      };

      const ans = generateFeeAnswer('S1 Sistem Informasi', turn2Query, sessionContext);
      expect(ans.activeWave).toBe('Gelombang Sisipan');
      expect(ans.answer).toContain('Gelombang Sisipan');
      expect(ans.answer).toContain('Rp 16.000.000');
    });
  });

  // =========================================================================
  // 7. FinalAnswerVerifier Guardrails (Generalisasi Seluruh Gelombang)
  // =========================================================================
  describe('7. FinalAnswerVerifier Guardrails (Generalisasi Seluruh Gelombang)', () => {

    test('Verifier memblokir klaim diskon tanpa bukti untuk subgelombang 1B', () => {
      const frame = resolveSemanticFrame('Berapa biaya sistem informasi gelombang 1B?');
      const ungroundedCandidate = 'Biaya S1 Sistem Informasi Gelombang 1B mendapatkan diskon DPP Rp 3.000.000.';

      const verification = verifyFinalAnswer(ungroundedCandidate, frame, { accepted: [] });
      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/ungrounded_fee_wave_claim/);
    });

    test('Verifier memblokir klaim penyamaan subgelombang 3B dengan Gelombang III tanpa bukti', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Komputer Gelombang 3B');
      const ungroundedCandidate = 'Biaya Sistem Komputer Gelombang 3B sama persis dengan Gelombang III.';

      const verification = verifyFinalAnswer(ungroundedCandidate, frame, { accepted: [] });
      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/ungrounded_fee_wave_claim/);
    });

    test('Verifier meloloskan jawaban resmi untuk Gelombang I terverifikasi dengan evidence', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang I');
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang I');

      const verification = verifyFinalAnswer(formatted, frame, {
        accepted: [
          {
            text: 'SK Rektor No 629 Gelombang I pendaftaran potongan Rp 250.000 DPP Rp 2.000.000',
            source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf'
          }
        ]
      });
      expect(verification.pass).toBe(true);
    });
  });

  // =========================================================================
  // 8. Proteksi Anti-Bocor & Pertukaran Data (Cross-Program & Cross-Wave Swap)
  // =========================================================================
  describe('8. Proteksi Anti-Bocor & Pertukaran Data (Cross-Program & Cross-Wave Swap)', () => {

    test('Tarif S2 Magister tidak bocor ke jawaban S1 Sistem Informasi', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Berapa rincian biaya Sistem Informasi?');

      expect(formatted).not.toContain('Matrikulasi');
      expect(formatted).not.toContain('0822-7738-9999'); // Hotline khusus S2
      expect(formatted).not.toContain('Pascasarjana');
      expect(formatted).not.toContain('Magister');
    });

    test('Tarif S1 Sistem Informasi tidak tertukar dengan tarif S1 Sistem Komputer', () => {
      const siResult = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang I');
      const skResult = getCalculated('S1 Sistem Komputer', 'Biaya Sistem Komputer Gelombang I');

      expect(siResult.breakdown.base.semester).toBe(6500000);
      expect(skResult.breakdown.base.semester).toBe(6000000);

      expect(siResult.breakdown.base.dpp).toBe(14000000);
      expect(skResult.breakdown.base.dpp).toBe(11000000);

      expect(siResult.formatted).not.toContain('Rp 6.000.000');
      expect(skResult.formatted).not.toContain('Rp 6.500.000');
    });
  });

  // =========================================================================
  // 9. Nominal Grounding, Provenance, and Arithmetic Verification Matrix
  // =========================================================================
  describe('9. Nominal Grounding, Provenance, and Arithmetic Verification Matrix', () => {

    test('Bukti yang hanya menyebut nama gelombang/judul tanpa nominal ditolak untuk klaim nominal palsu', () => {
      const frame = resolveSemanticFrame('Biaya pendaftaran Sistem Informasi Gelombang II');
      const fakeAnswer = 'Biaya pendaftaran Sistem Informasi Gelombang II adalah sebesar Rp 9.999.000.';

      // Evidence only mentions titles/wave without the claimed nominal
      const verification = verifyFinalAnswer(fakeAnswer, frame, {
        accepted: [
          { text: 'Informasi Pendaftaran PMB Gelombang II ITB STIKOM Bali dibuka online.' }
        ]
      });

      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence/);
    });

    test('Nominal palsu ditolak meskipun evidence mencantumkan kata Pendaftaran PMB Gelombang II', () => {
      const frame = resolveSemanticFrame('Berapa DPP Sistem Informasi Gelombang II?');
      const fakeDppAnswer = 'Dana Pendidikan Pokok (DPP) Sistem Informasi Gelombang II adalah Rp 88.000.000.';

      const verification = verifyFinalAnswer(fakeDppAnswer, frame, {
        accepted: [
          { text: 'Ketentuan Pendaftaran PMB Gelombang II dan Dana Pendidikan Pokok diatur oleh SK Rektor.' }
        ]
      });

      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence/);
    });

    test('Cross-wave nominal pollution ditolak (klaim DPP Gelombang Khusus Rp 11.000.000 untuk Gelombang II)', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      frame.registrationWave = 'Gelombang II';

      // Candidate claims Gelombang Khusus net DPP (Rp 11.000.000) for Gelombang II
      const pollutedAnswer = 'Rincian Biaya Kuliah S1 Sistem Informasi — Gelombang II\n\n' +
        '- Biaya Pendaftaran: Rp 300.000\n' +
        '- Dana Pendidikan Pokok (DPP): Rp 11.000.000\n' +
        '- Biaya Pendidikan Per Semester: Rp 6.500.000';

      const verification = verifyFinalAnswer(pollutedAnswer, frame, {
        accepted: [
          { text: 'SK Rektor 629 Lampiran 1: S1 SI DPP Rp 14.000.000, Gelombang Khusus potongan Rp 3.000.000, Gelombang II potongan Rp 1.500.000.' }
        ]
      });

      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/cross_wave_fee_nominal_pollution/);
    });

    test('Cross-program nominal pollution ditolak (nominal dari program lain tidak boleh dijadikan bukti nominal program yang diminta)', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      frame.registrationWave = 'Gelombang II';

      // Candidate claims DPP Rp 10.250.000 (milik S1 Sistem Komputer Gelombang II, bukan S1 SI)
      const pollutedProgramAnswer = 'Rincian Biaya Kuliah S1 Sistem Informasi — Gelombang II\n\n' +
        '- Biaya Pendaftaran: Rp 300.000\n' +
        '- Dana Pendidikan Pokok (DPP): Rp 10.250.000\n' +
        '- Biaya Pendidikan Per Semester: Rp 6.500.000';

      const verification = verifyFinalAnswer(pollutedProgramAnswer, frame, {
        accepted: [
          { text: 'SK Rektor 629 Lampiran 2: S1 Sistem Komputer DPP Rp 11.000.000, Gelombang II potongan Rp 750.000 (net Rp 10.250.000).' }
        ]
      });

      expect(verification.pass).toBe(false);
      expect(verification.reason).toMatch(/unsupported_factual_claim_fee_nominal_divergence/);
    });

    test('D3 MI: Memisahkan biaya pendaftaran Rp 300.000 dari paket registrasi/DPP Rp 9.250.000', () => {
      const { breakdown, formatted } = getCalculated('D3 Manajemen Informatika', 'Biaya D3 Manajemen Informatika Gelombang II');

      expect(breakdown.scopeParams.registrationWave).toBe('Gelombang II');
      expect(breakdown.net.pendaftaran).toBe(300000);
      expect(breakdown.net.dpp).toBe(9250000);
      expect(breakdown.net.initialTotal).toBe(9550000);

      // Verifikasi keterpisahan komponen
      expect(formatted).toContain('Biaya Pendaftaran: Rp 300.000');
      expect(formatted).toContain('Biaya Registrasi (Jas, Topi, GMTI): Rp 9.250.000');
      expect(formatted).toContain('Rp 9.550.000');
      expect(formatted).toContain('Biaya pendaftaran (Rp 300.000) dibayar terpisah secara tunai saat daftar');
      expect(formatted).toContain('tidak termasuk dalam total biaya awal');
    });

    test('DNUI: Biaya mandatori Bahasa Mandarin Rp 5.000.000 dipisahkan berdasarkan tahapan jadwal pembayaran', () => {
      const { breakdown, formatted } = getCalculated('Double Degree DNUI', 'Rincian biaya Double Degree DNUI Gelombang II');

      expect(breakdown.net.pendaftaran).toBe(2000000);
      expect(breakdown.net.dpp).toBe(14000000);
      expect(breakdown.base.bahasa).toBe(5000000);

      expect(formatted).toContain('Rp 2.000.000');
      expect(formatted).toContain('Rp 14.000.000');
      expect(formatted).toContain('Rp 5.000.000');
      expect(formatted).toContain('Pada saat daftar');
      expect(formatted).toContain('Saat Registrasi I');
      expect(formatted).toContain('Menjelang Semester II');
      expect(formatted).toContain('tidak ditagihkan sekaligus saat pendaftaran awal');
    });

    test('SI Gelombang II: Membedakan pembayaran tunai awal Rp 1.800.000 dari total kewajiban Rp 14.300.000', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      expect(breakdown.net.biayaLangsungRegistrasi).toBe(1800000); // 300k pendaftaran + 1.5jt perlengkapan
      expect(breakdown.net.initialTotal).toBe(14300000); // 1.8jt + 12.5jt net DPP

      expect(formatted).toContain('Rp 1.800.000');
      expect(formatted).toContain('Rp 14.300.000');
      expect(formatted).toContain('bukan berarti seluruh DPP harus dibayar tunai sekaligus di muka');
      expect(formatted).toContain('dapat dicicil bertahap setiap bulan hingga UTS-1');
      expect(formatted).toContain('Pembayaran tunai langsung yang wajib di awal registrasi hanya sebesar Rp 1.800.000');
    });

    test('Wording konsisten menggunakan potongan biaya Gelombang II bukan beasiswa Gelombang II', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      expect(formatted).toContain('potongan biaya Gelombang II');
      expect(formatted).not.toContain('beasiswa Gelombang II');
    });

    test('Sub-gelombang 1A/2C/3B tidak diklaim bukan gelombang resmi melainkan SOURCE_GAP dalam SK 629', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang 2C');

      expect(formatted).not.toContain('bukan gelombang resmi');
      expect(formatted).toContain('SOURCE_GAP');
      expect(formatted).toContain('belum tercantum dalam dokumen penetapan biaya resmi');
      expect(formatted).toContain('Kalender pendaftaran memuat periode pendaftaran untuk Gelombang 2C');
    });

    test('Ketentuan pembayaran memuat diskon tunai 10% dan SMK TI 20% tanpa asumsi stacking sembarangan', () => {
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      expect(formatted).toContain('Jika DPP dibayar tunai langsung lunas, diberikan tambahan potongan 10% dari DPP');
      expect(formatted).toContain('potongan 20% Biaya Pendidikan Per Semester selama 4 tahun');
      expect(formatted).toContain('Ketentuan akumulasi potongan');
      expect(formatted).toContain('tidak diasumsikan dapat ditumpuk secara otomatis tanpa konfirmasi resmi');
    });

    test('Tes positif grounded answer lolos verifier dengan evidence lengkap pendukung nominal', () => {
      const frame = resolveSemanticFrame('Biaya Sistem Informasi Gelombang II');
      const { formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      const verification = verifyFinalAnswer(formatted, frame, {
        accepted: [
          {
            text: 'SK Rektor 629 Lampiran 1: S1 Sistem Informasi Pendaftaran Rp 500.000 potongan Gelombang II Rp 200.000 (net Rp 300.000). DPP Rp 14.000.000 potongan Gelombang II Rp 1.500.000 (net Rp 12.500.000). Perlengkapan Jas Topi Rp 750.000, Kaos Tas GMTI Rp 750.000. Biaya Semester Rp 6.500.000.',
            source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf'
          }
        ]
      });

      expect(verification.pass).toBe(true);
      expect(verification.outcome).toBe('VERIFIED_FACTUAL');
    });

  });

  // =========================================================================
  // 10. Targeted Arithmetic Validation, Payment Timing, and Traceability Guardrails
  // =========================================================================
  describe('10. Targeted Arithmetic Validation, Payment Timing & Traceability', () => {

    test('S1 SI/TI/BD Gelombang II: Total sebelum dan sesudah potongan wajib persis sama dengan penjumlahan komponen', () => {
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', 'Biaya Sistem Informasi Gelombang II');

      // Validasi komponen dasar
      const pendaftaranBase = breakdown.base.pendaftaran; // 500.000
      const perlengkapanBase = breakdown.base.perlengkapan; // 1.500.000
      const dppBase = breakdown.base.dpp; // 14.000.000

      expect(pendaftaranBase).toBe(500000);
      expect(perlengkapanBase).toBe(1500000);
      expect(dppBase).toBe(14000000);

      // Total sebelum potongan = 500.000 + 1.500.000 + 14.000.000 = 16.000.000
      const expectedTotalBefore = pendaftaranBase + perlengkapanBase + dppBase;
      expect(expectedTotalBefore).toBe(16000000);
      expect(breakdown.initialTotalBeforeDiscounts).toBe(expectedTotalBefore);
      expect(breakdown.initialTotalBeforeDiscounts).not.toBe(15500000); // Guard terhadap typo 15.5jt

      // Validasi komponen bersih Gelombang II
      const pendaftaranNet = breakdown.net.pendaftaran; // 300.000
      const dppNet = breakdown.net.dpp; // 12.500.000
      expect(pendaftaranNet).toBe(300000);
      expect(dppNet).toBe(12500000);

      // Total setelah potongan = 300.000 + 1.500.000 + 12.500.000 = 14.300.000
      const expectedTotalNet = pendaftaranNet + perlengkapanBase + dppNet;
      expect(expectedTotalNet).toBe(14300000);
      expect(breakdown.net.initialTotal).toBe(expectedTotalNet);

      // Validasi teks string output
      expect(formatted).toContain('Rp 16.000.000');
      expect(formatted).toContain('Rp 14.300.000');
      expect(formatted).not.toContain('Rp 15.500.000');
    });

    test('D3 MI Gelombang II: Label asli Lampiran 3 (Biaya Registrasi), pendaftaran terpisah, cicilan terjelaskan', () => {
      const { breakdown, formatted } = getCalculated('D3 Manajemen Informatika', 'Rincian biaya D3 Manajemen Informatika Gelombang II');

      // Komponen dasar Lampiran 3
      expect(breakdown.base.pendaftaran).toBe(500000);
      expect(breakdown.base.dpp).toBe(10000000);
      expect(breakdown.profile.components.dpp.label).toBe('Biaya Registrasi (Jas, Topi, GMTI)');

      // Gelombang II bersih
      expect(breakdown.net.pendaftaran).toBe(300000); // 500k - 200k
      expect(breakdown.net.dpp).toBe(9250000); // 10jt - 750k
      expect(breakdown.net.initialTotal).toBe(9550000); // 300k + 9.25jt
      expect(breakdown.initialTotalBeforeDiscounts).toBe(10500000); // 500k + 10jt

      // Teks output harus memakai terminologi asli dan menjelaskan cicilan
      expect(formatted).toContain('Biaya Registrasi (Jas, Topi, GMTI)');
      expect(formatted).toContain('Rp 9.250.000');
      expect(formatted).toContain('Rp 9.550.000');
      expect(formatted).toContain('Rp 300.000');
      expect(formatted).toContain('dapat dicicil per bulan s.d. UTS-1 dan tidak wajib dibayar lunas sekaligus di muka');
      expect(formatted).not.toContain('Paket Registrasi/DPP');
    });

    test('HELP University: Pemisahan waktu pembayaran dan batasan perhitungan per subject', () => {
      const { breakdown, formatted } = getCalculated('Double Degree HELP University', 'Berapa biaya Double Degree HELP University Gelombang II?');

      expect(breakdown.net.pendaftaran).toBe(2000000); // 3jt - 1jt
      expect(breakdown.net.dpp).toBe(14000000); // 20jt - 6jt
      expect(breakdown.base.bahasa).toBe(5000000);
      expect(breakdown.profile.components.biayaPerSubject.amount).toBe(3000000);

      // Verifikasi waktu pembayaran di teks
      expect(formatted).toContain('Pada saat daftar');
      expect(formatted).toContain('Saat Registrasi I');
      expect(formatted).toContain('Menjelang Semester II');
      expect(formatted).toContain('Rp 3.000.000 per subject');
      expect(formatted).toContain('Batasan perhitungan');
      expect(formatted).toContain('Jumlah subject yang diambil per semester');
      expect(formatted).toContain('tidak digabung menjadi satu angka total awal masuk yang lengkap');
    });

    test('DNUI: Pemisahan waktu pembayaran dan klarifikasi mandatori bahasa', () => {
      const { breakdown, formatted } = getCalculated('Double Degree DNUI', 'Berapa biaya program double degree DNUI Gelombang II?');

      expect(breakdown.net.pendaftaran).toBe(2000000);
      expect(breakdown.net.dpp).toBe(14000000);
      expect(breakdown.base.bahasa).toBe(5000000);
      expect(breakdown.base.semester).toBe(16000000);

      expect(formatted).toContain('Pada saat daftar');
      expect(formatted).toContain('Saat Registrasi I');
      expect(formatted).toContain('Menjelang Semester II: Biaya Penguatan Bahasa Mandarin Rp 5.000.000');
      expect(formatted).toContain('Setiap awal semester: Biaya Pendidikan Per Semester Rp 16.000.000');
      expect(formatted).toContain('Batasan perhitungan');
      expect(formatted).toContain('tidak ditagihkan sekaligus saat pendaftaran awal');
    });

    test('S2 Pascasarjana: Ketentuan potongan alumni pendaftaran (+200k) disimpan sebagai SOURCE_GAP stacking', () => {
      const canonicalRegistry = require('../data/runtime/canonical_fee_registry.json');
      const s2Profile = canonicalRegistry.programs['S2 Sistem Informasi'];

      expect(s2Profile.specialPolicies.alumniItbStikomPendaftaranExtraDiscount).toBe(200000);
      expect(s2Profile.sourceGaps.alumniPendaftaranStacking).toBeDefined();
      expect(s2Profile.sourceGaps.alumniPendaftaranStacking).toContain('SOURCE_GAP');

      const { breakdown } = getCalculated('S2 Sistem Informasi', 'Berapa biaya S2 Sistem Informasi Gelombang II?');
      // Kalkulasi umum non-alumni tetap menggunakan potongan pendaftaran resmi 100k (net 600k)
      expect(breakdown.net.pendaftaran).toBe(600000);
      expect(breakdown.discounts.pendaftaranDiscount).toBe(100000);
    });

    test('Registry Traceability: Seluruh nominal program resmi memiliki metadata sumber lengkap ke SK 629', () => {
      const canonicalRegistry = require('../data/runtime/canonical_fee_registry.json');
      const programsToCheck = [
        'S1 Sistem Informasi',
        'S1 Sistem Komputer',
        'D3 Manajemen Informatika',
        'Double Degree HELP University',
        'Double Degree DNUI',
        'S2 Sistem Informasi'
      ];

      for (const progKey of programsToCheck) {
        const prog = canonicalRegistry.programs[progKey];
        expect(prog.lampiran).toBeDefined();
        expect(prog.sourceDocument).toBeDefined();
        expect(prog.skNumber).toBe('629/ITBSTIKOM/WDS/X/25');

        for (const [compKey, comp] of Object.entries(prog.components)) {
          if (compKey === 'pengalamanIndustri') continue;
          expect(comp.provenance).toBeDefined();
          expect(comp.provenance.document).toBe(prog.sourceDocument);
          expect(comp.provenance.lampiran).toBe(prog.lampiran);
          expect(comp.provenance.page).toBe(1);
          expect(comp.provenance.itemNumber).toBeDefined();
          expect(comp.provenance.exactQuote).toBeDefined();
          expect(comp.provenance.verificationStatus).toBe('VERIFIED_SOURCE');
        }

        if (prog.waveDiscounts) {
          for (const [wKey, wDisc] of Object.entries(prog.waveDiscounts)) {
            if (['Gelombang I', 'Gelombang II'].includes(wKey) && wDisc.provenance) {
              expect(wDisc.provenance.verificationStatus).toBe('VERIFIED_SOURCE');
            }
          }
        }
      }
    });

    test('Strict Nominal Consistency: Registry, runtime, dan output string cocok dengan fakta SK 629 Lampiran 1-8', () => {
      const canonicalRegistry = require('../data/runtime/canonical_fee_registry.json');

      // 1. S1 SI/TI/BD
      const siReg = canonicalRegistry.programs['S1 Sistem Informasi'];
      expect(siReg.components.pendaftaran.amount).toBe(500000);
      expect(siReg.components.jasTopi.amount + siReg.components.kaosTasGmti.amount).toBe(1500000);
      expect(siReg.components.dpp.amount).toBe(14000000);
      expect(siReg.components.biayaSemester.amount).toBe(6500000); // Bukan 7.8M atau 8.8M
      expect(siReg.waveDiscounts['Gelombang I'].pendaftaranDiscount).toBe(250000);
      expect(siReg.waveDiscounts['Gelombang I'].dppDiscount).toBe(2000000);
      expect(siReg.waveDiscounts['Gelombang II'].pendaftaranDiscount).toBe(200000);
      expect(siReg.waveDiscounts['Gelombang II'].dppDiscount).toBe(1500000);

      // 2. S1 Sistem Komputer
      const skReg = canonicalRegistry.programs['S1 Sistem Komputer'];
      expect(skReg.components.pendaftaran.amount).toBe(500000);
      expect(skReg.components.jasTopi.amount + skReg.components.kaosTasGmti.amount).toBe(1500000);
      expect(skReg.components.dpp.amount).toBe(11000000);
      expect(skReg.components.biayaSemester.amount).toBe(6000000); // Bukan 7.8M atau 8.8M
      expect(skReg.waveDiscounts['Gelombang II'].dppDiscount).toBe(750000); // Net DPP 10.25M, bukan 9.5M

      const skCalc = getCalculated('S1 Sistem Komputer', 'Berapa biaya S1 Sistem Komputer Gelombang II?');
      expect(skCalc.breakdown.initialTotalBeforeDiscounts).toBe(13000000); // 500k + 1.5M + 11M
      expect(skCalc.breakdown.net.initialTotal).toBe(12050000); // 300k + 1.5M + 10.25M
      expect(skCalc.formatted).toContain('Rp 13.000.000');
      expect(skCalc.formatted).toContain('Rp 12.050.000');
      expect(skCalc.formatted).toContain('Rp 10.250.000');
      expect(skCalc.formatted).toContain('Rp 6.000.000');

      // 3. D3 Manajemen Informatika
      const d3Reg = canonicalRegistry.programs['D3 Manajemen Informatika'];
      expect(d3Reg.components.pendaftaran.amount).toBe(500000);
      expect(d3Reg.components.dpp.amount).toBe(10000000); // Biaya Registrasi (Jas, Topi, GMTI)
      expect(d3Reg.components.biayaSemester.amount).toBe(4500000); // Bukan 5.25M
      expect(d3Reg.waveDiscounts['Gelombang II'].dppDiscount).toBe(750000); // Net 9.25M, bukan 7.75M

      const d3Calc = getCalculated('D3 Manajemen Informatika', 'Berapa biaya D3 Manajemen Informatika Gelombang II?');
      expect(d3Calc.breakdown.initialTotalBeforeDiscounts).toBe(10500000); // 500k + 10M
      expect(d3Calc.breakdown.net.initialTotal).toBe(9550000); // 300k + 9.25M
      expect(d3Calc.formatted).toContain('Biaya Registrasi (Jas, Topi, GMTI): Rp 9.250.000');
      expect(d3Calc.formatted).toContain('Rp 9.550.000');
      expect(d3Calc.formatted).toContain('Rp 4.500.000');

      // 4. Double Degree HELP
      const helpReg = canonicalRegistry.programs['Double Degree HELP University'];
      expect(helpReg.components.pendaftaran.amount).toBe(3000000);
      expect(helpReg.components.dpp.amount).toBe(20000000);
      expect(helpReg.components.bahasaInggris.amount).toBe(5000000);
      expect(helpReg.components.biayaPerSubject.amount).toBe(3000000); // Per subject!

      const helpCalc = getCalculated('Double Degree HELP University', 'Berapa biaya Double Degree HELP Gelombang II?');
      expect(helpCalc.breakdown.net.pendaftaran).toBe(2000000);
      expect(helpCalc.breakdown.net.dpp).toBe(14000000);
      expect(helpCalc.formatted).toContain('Biaya Pendidikan & Ujian: Rp 3.000.000 / subject');
      expect(helpCalc.formatted).toContain('Rp 3.000.000 per subject');
      expect(helpCalc.formatted).not.toContain('Rp 3.000.000 per semester');

      // 5. Double Degree DNUI
      const dnuiReg = canonicalRegistry.programs['Double Degree DNUI'];
      expect(dnuiReg.components.pendaftaran.amount).toBe(3000000);
      expect(dnuiReg.components.dpp.amount).toBe(20000000);
      expect(dnuiReg.components.bahasaMandarin.amount).toBe(5000000);
      expect(dnuiReg.components.biayaSemester.amount).toBe(16000000); // Bukan 8M!

      const dnuiCalc = getCalculated('Double Degree DNUI', 'Berapa biaya Double Degree DNUI Gelombang II?');
      expect(dnuiCalc.breakdown.net.pendaftaran).toBe(2000000);
      expect(dnuiCalc.breakdown.net.dpp).toBe(14000000);
      expect(dnuiCalc.breakdown.base.semester).toBe(16000000);
      expect(dnuiCalc.formatted).toContain('Biaya Pendidikan Per Semester: Rp 16.000.000');

      // 6. S2 Pascasarjana
      const s2Reg = canonicalRegistry.programs['S2 Sistem Informasi'];
      expect(s2Reg.components.pendaftaran.amount).toBe(700000); // Bukan 1.000.000!
      expect(s2Reg.waveDiscounts['Gelombang I'].pendaftaranDiscount).toBe(200000); // Net 500.000
      expect(s2Reg.waveDiscounts['Gelombang II'].pendaftaranDiscount).toBe(100000); // Net 600.000
      expect(s2Reg.components.biayaSemester.amount).toBe(10000000);
      expect(s2Reg.specialPolicies.includeMatrikulasiUjianBimbingan).toBe(true);

      const s2Calc = getCalculated('S2 Sistem Informasi', 'Berapa biaya S2 Sistem Informasi Gelombang II?');
      expect(s2Calc.breakdown.net.pendaftaran).toBe(600000);
      expect(s2Calc.breakdown.base.semester).toBe(10000000);
    });

    test('Installment Delegation Guard: Pertanyaan syarat/pengajuan cicilan tidak memproduksi klausul palsu', () => {
      const { tryDetailedFeeAnswer } = require('../src/engine/feeComparisonEngine');
      const index = [{ filename: 'Biaya Bisnis Digital.pdf', chunk: 'Biaya Bisnis Digital: DPP 14jt dicicil per bulan s.d UTS-1' }];
      const options = { __canonicalQueryUnderstanding: { constraints: { feeType: 'installment' } } };

      const res = tryDetailedFeeAnswer('apa syarat pengajuan permohonan cicilan?', index, options);
      // Harus mengembalikan null agar jatuh ke fallback dokumen resmi dan tidak memfabrikasi dokumen/surat permohonan tertulis
      expect(res).toBeNull();
    });

    test('HELP & DNUI Payment Evidence: Waktu pembayaran sesuai sumber dan bebas klaim cicilan palsu', () => {
      // HELP
      const helpFull = getCalculated('Double Degree HELP University', 'Berapa biaya Double Degree HELP?');
      expect(helpFull.formatted).toContain('Dana Pendidikan Pokok (DPP): Rp 20.000.000');
      expect(helpFull.formatted).toContain('Waktu pembayaran: Saat Registrasi I');
      expect(helpFull.formatted).not.toContain('Dapat dicicil per bulan s.d. UTS-1');
      expect(helpFull.formatted).not.toContain('tambahan potongan 10% dari DPP');
      expect(helpFull.formatted).toContain('Biaya Penguatan Bahasa Inggris: Rp 5.000.000 (Waktu pembayaran: Menjelang Semester II)');
      expect(helpFull.formatted).toContain('Biaya Pendidikan & Ujian: Rp 3.000.000 / subject (Waktu pembayaran: Awal Semester)');

      // DNUI
      const dnuiFull = getCalculated('Double Degree DNUI', 'Berapa biaya Double Degree DNUI?');
      expect(dnuiFull.formatted).toContain('Dana Pendidikan Pokok (DPP): Rp 20.000.000');
      expect(dnuiFull.formatted).toContain('Waktu pembayaran: Saat Registrasi I');
      expect(dnuiFull.formatted).not.toContain('Dapat dicicil per bulan s.d. UTS-1');
      expect(dnuiFull.formatted).not.toContain('tambahan potongan 10% dari DPP');
      expect(dnuiFull.formatted).toContain('Biaya Penguatan Bahasa Mandarin: Rp 5.000.000 (Waktu pembayaran: Menjelang Semester II)');
      expect(dnuiFull.formatted).toContain('Biaya Pendidikan Per Semester: Rp 16.000.000');
      expect(dnuiFull.formatted).not.toContain('menjelang masa perwalian tiap semester');
    });

    test('S2 Queries: Verifikasi 4 pertanyaan biaya S2 sesuai SK Rektor Lampiran 8', () => {
      // 1. “Berapa biaya S2 per semester?”
      const q1 = generateFeeAnswer('S2 Sistem Informasi', 'Berapa biaya S2 per semester?');
      expect(q1.success).toBe(true);
      expect(q1.answer).toContain('Rp 10.000.000');
      expect(q1.answer).toContain('Per Semester');
      expect(q1.answer).not.toContain('menjelang masa perwalian');
      expect(q1.answer).toContain('matrikulasi');
      expect(q1.answer).toContain('Rp40.000.000');

      // 2. “Berapa total biaya S2 selama dua tahun?”
      const q2 = generateFeeAnswer('S2 Sistem Informasi', 'Berapa total biaya S2 selama dua tahun?');
      expect(q2.success).toBe(true);
      expect(q2.answer).toContain('Total estimasi biaya pendidikan *S2 Sistem Informasi* selama 2 tahun');
      expect(q2.answer).toContain('Rp 10.000.000 per semester');
      expect(q2.answer).toContain('Rp40.000.000');
      expect(q2.answer).toContain('Rp 40.700.000');
      expect(q2.answer).toContain('alternatif dari empat pembayaran semester, bukan biaya tambahan (tidak dijumlahkan lagi dengan 4 x SPP semester)');
      expect(q2.answer).toContain('Biaya registrasi dasar Rp700.000 dibayarkan terpisah');
      expect(q2.answer).toContain('Total dasar Rp40.700.000 terdiri dari biaya pendidikan dua tahun Rp40.000.000 ditambah registrasi Rp700.000, dengan pengecualian biaya wisuda sesuai sumber');
      expect(q2.answer).toContain('Ditambah Rp. 200.000,- Jika Alumni ITB STIKOM Bali');
      expect(q2.answer).toContain('SOURCE_GAP');
      expect(q2.answer).toContain('gelombang resmi SK Rektor 629 hanya memuat Gelombang I dan II');

      // 3. “Kalau bayar lunas S2, berapa?”
      const q3 = generateFeeAnswer('S2 Sistem Informasi', 'Kalau bayar lunas S2, berapa?');
      expect(q3.success).toBe(true);
      expect(q3.answer).toContain('Rp40.000.000');
      expect(q3.answer).toContain('alternatif pembayaran');
      expect(q3.answer).toContain('bukan biaya tambahan');
      expect(q3.answer).toContain('Saat Registrasi');
      expect(q3.answer).toContain('SOURCE_GAP');

      // 4. “Apakah biaya matrikulasi terpisah?”
      const q4 = generateFeeAnswer('S2 Sistem Informasi', 'Apakah biaya matrikulasi terpisah?');
      expect(q4.success).toBe(true);
      expect(q4.answer).toContain('sudah termasuk');
      expect(q4.answer).toContain('Lampiran 8 butir 4');
      expect(q4.answer).toContain('tidak dikenakan biaya terpisah');
    });

    test('Orchestrator Level Fallback: Pertanyaan syarat/prosedur cicilan dipisahkan dari rangkuman tarif dan bebas fabrikasi', async () => {
      const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

      // 1. "Apa syarat pengajuan cicilan uang kuliah?"
      const q1 = 'Apa syarat pengajuan cicilan uang kuliah?';
      const out1 = await runPhase1DeterministicPipeline('test_chat_inst_1', q1, { syncOnly: true });

      expect(out1.intent).toBe('INSTALLMENT_PROCEDURE_INQUIRY');
      expect(out1.finalAnswer).toBeTruthy();
      // Tidak boleh mengembalikan rangkuman tarif semua program
      expect(out1.finalAnswer).not.toMatch(/Biaya Pendaftaran: Rp 300\.000 \(S1 SI\/TI\/BD/i);
      expect(out1.finalAnswer).not.toMatch(/Perlengkapan Awal: Rp 1\.500\.000/i);
      // Bebas fabrikasi formulir / surat / persetujuan palsu
      expect(out1.finalAnswer).not.toMatch(/surat\s+permohonan\s+tertulis/i);
      expect(out1.finalAnswer).not.toMatch(/formulir\s+pengajuan\s+cicilan/i);
      expect(out1.finalAnswer).not.toMatch(/slip\s+gaji\s+orang\s*tua/i);
      // Menyatakan syarat administratif belum tercantum / SOURCE_GAP
      expect(out1.finalAnswer).toMatch(/SOURCE_GAP/i);
      expect(out1.finalAnswer).toMatch(/admin PMB atau bagian keuangan resmi/i);
      expect(out1.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(out1.finalAnswer).toMatch(/\(0361\)\s*244445/i);

      // 2. "Bagaimana prosedur mengajukan cicilan biaya kuliah?"
      const q2 = 'Bagaimana prosedur mengajukan cicilan biaya kuliah?';
      const out2 = await runPhase1DeterministicPipeline('test_chat_inst_2', q2, { syncOnly: true });
      expect(out2.intent).toBe('INSTALLMENT_PROCEDURE_INQUIRY');
      expect(out2.finalAnswer).toBeTruthy();
      expect(out2.finalAnswer).not.toMatch(/Biaya Pendaftaran: Rp 300\.000/i);
      expect(out2.finalAnswer).not.toMatch(/formulir\s+pengajuan\s+cicilan/i);
      expect(out2.finalAnswer).toMatch(/SOURCE_GAP/i);
      expect(out2.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(out2.finalAnswer).toMatch(/\(0361\)\s*244445/i);

      // 3. "Dokumen apa yang diperlukan untuk mengajukan cicilan?"
      const q3 = 'Dokumen apa yang diperlukan untuk mengajukan cicilan?';
      const out3 = await runPhase1DeterministicPipeline('test_chat_inst_3', q3, { syncOnly: true });
      expect(out3.intent).toBe('INSTALLMENT_PROCEDURE_INQUIRY');
      expect(out3.finalAnswer).toBeTruthy();
      expect(out3.finalAnswer).not.toMatch(/Biaya Pendaftaran: Rp 300\.000/i);
      expect(out3.finalAnswer).toMatch(/SOURCE_GAP/i);
      expect(out3.finalAnswer).toMatch(/pmb\.stikom-bali\.ac\.id/i);
      expect(out3.finalAnswer).toMatch(/\(0361\)\s*244445/i);

      // 4. "Berapa biaya DPP dan sampai kapan bisa dicicil?"
      const q4 = 'Berapa biaya DPP dan sampai kapan bisa dicicil?';
      const out4 = await runPhase1DeterministicPipeline('test_chat_inst_4', q4, { syncOnly: true });
      expect(out4.intent).toBe('TUITION_FEE_INQUIRY');
      expect(out4.finalAnswer).toBeTruthy();
      // Verifikasi DPP S1 SI/TI/BD ditampilkan Rp14.000.000
      expect(out4.finalAnswer).toMatch(/S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital.*Rp 14\.000\.000/s);
      // Verifikasi DPP S1 SK ditampilkan Rp11.000.000
      expect(out4.finalAnswer).toMatch(/S1 Sistem Komputer.*Rp 11\.000\.000/s);
      // Verifikasi D3 Manajemen Informatika tidak disebut sebagai DPP
      expect(out4.finalAnswer).toMatch(/D3 Manajemen Informatika.*Tidak memiliki komponen DPP/i);
      expect(out4.finalAnswer).toMatch(/Biaya Registrasi \(Jas, Topi, GMTI\).*Rp 10\.000\.000/i);
      expect(out4.finalAnswer).not.toMatch(/DPP(?:\s+dasar)?\s*:\s*(?:Rp\s*)?10\.000\.000/i);
      // Verifikasi jadwal cicilan Double Degree tidak otomatis berlaku s.d. UTS-1
      expect(out4.finalAnswer).toMatch(/International Double Degree \(HELP \/ DNUI\).*Rp 20\.000\.000.*Registrasi I/i);
      expect(out4.finalAnswer).toMatch(/tidak otomatis berlaku untuk program International Double Degree/i);
      // Tidak boleh mencampurkan komponen tak diminta (pendaftaran, seragam, spp)
      expect(out4.finalAnswer).not.toMatch(/Biaya Pendaftaran/i);
      expect(out4.finalAnswer).not.toMatch(/Perlengkapan Awal/i);
      expect(out4.finalAnswer).not.toMatch(/Biaya Pendidikan Per Semester/i);
      // Menjelaskan waktu cicilan DPP (s.d. UTS-1)
      expect(out4.finalAnswer).toMatch(/UTS-1/i);
    }, 20000);

    test('D3 Fee Classification: Jawaban akhir D3 konsisten menggunakan nama komponen resmi dan bebas label DPP', async () => {
      const { runPhase1DeterministicPipeline } = require('../src/core/orchestrator');

      // 1. Pertanyaan umum biaya D3 Gelombang II
      const outD3 = await runPhase1DeterministicPipeline('test_d3_fee_1', 'Berapa biaya kuliah D3 Manajemen Informatika Gelombang II?', { syncOnly: true });
      expect(outD3.finalAnswer).toBeTruthy();
      expect(outD3.finalAnswer).toMatch(/Biaya Registrasi \(Jas, Topi, GMTI\)/i);
      expect(outD3.finalAnswer).toMatch(/Rp 9\.250\.000/); // Net Gelombang II (10jt - 750rb)
      expect(outD3.finalAnswer).toMatch(/Rp 10\.000\.000/); // Dasar
      expect(outD3.finalAnswer).not.toMatch(/\bDPP\s*:\s*Rp\s*10\.000\.000/i);
      expect(outD3.finalAnswer).not.toMatch(/\bDPP\s+D3\b/i);

      // 2. Pertanyaan spesifik DPP untuk D3
      const outD3Dpp = await runPhase1DeterministicPipeline('test_d3_fee_2', 'Berapa DPP D3 Manajemen Informatika?', { syncOnly: true });
      expect(outD3Dpp.finalAnswer).toBeTruthy();
      expect(outD3Dpp.finalAnswer).toMatch(/tidak memiliki komponen Dana Pendidikan Pokok \(DPP\)/i);
      expect(outD3Dpp.finalAnswer).toMatch(/Biaya Registrasi \(Jas, Topi, GMTI\)/i);
      expect(outD3Dpp.finalAnswer).toMatch(/Rp 10\.000\.000/);
    }, 20000);

    test('Release Gate Final: Kunci nilai nominal rekonsiliasi diskon SK & D3 berdasarkan dokumen sumber primer', () => {
      // 1. S1 Sistem Komputer — diskon DPP Gelombang Khusus: Rp2.000.000 (bukan Rp1.500.000)
      const skKhusus = getCalculated('S1 Sistem Komputer', 'Berapa biaya Sistem Komputer Gelombang Khusus?');
      expect(skKhusus.breakdown.base.dpp).toBe(11000000);
      expect(skKhusus.breakdown.discounts.dppDiscount).toBe(2000000);
      expect(skKhusus.breakdown.discounts.dppDiscount).not.toBe(1500000);
      expect(skKhusus.breakdown.net.dpp).toBe(9000000);
      expect(skKhusus.formatted).toContain('Rp 2.000.000');
      expect(skKhusus.formatted).toContain('Rp 9.000.000');

      // 2. D3 Manajemen Informatika — diskon Biaya Registrasi Gelombang Khusus: Rp2.000.000 (bukan Rp4.000.000)
      const d3Khusus = getCalculated('D3 Manajemen Informatika', 'Berapa biaya D3 Manajemen Informatika Gelombang Khusus?');
      expect(d3Khusus.breakdown.base.dpp).toBe(10000000);
      expect(d3Khusus.breakdown.discounts.dppDiscount).toBe(2000000);
      expect(d3Khusus.breakdown.discounts.dppDiscount).not.toBe(4000000);
      expect(d3Khusus.breakdown.net.dpp).toBe(8000000);
      expect(d3Khusus.formatted).toContain('Rp 2.000.000');
      expect(d3Khusus.formatted).toContain('Rp 8.000.000');

      // 3. D3 Manajemen Informatika — diskon Biaya Registrasi Gelombang I: Rp1.000.000 (bukan Rp3.000.000)
      const d3Gel1 = getCalculated('D3 Manajemen Informatika', 'Berapa biaya D3 Manajemen Informatika Gelombang I?');
      expect(d3Gel1.breakdown.base.dpp).toBe(10000000);
      expect(d3Gel1.breakdown.discounts.dppDiscount).toBe(1000000);
      expect(d3Gel1.breakdown.discounts.dppDiscount).not.toBe(3000000);
      expect(d3Gel1.breakdown.net.dpp).toBe(9000000);
      expect(d3Gel1.formatted).toContain('Rp 1.000.000');
      expect(d3Gel1.formatted).toContain('Rp 9.000.000');
    });

    test('Primary Source Reconciliation Matrix: Verifikasi seluruh gelombang D3, SK, SI, Double Degree, dan S2', () => {
      // A. D3 Manajemen Informatika (Lampiran 3) — Biaya Registrasi Rp10.000.000 (Bukan DPP)
      const d3Waves = [
        { wave: 'Gelombang Khusus', regDisc: 300000, regNet: 200000, mainDisc: 2000000, mainNet: 8000000, initialNet: 8200000 },
        { wave: 'Gelombang I', regDisc: 250000, regNet: 250000, mainDisc: 1000000, mainNet: 9000000, initialNet: 9250000 },
        { wave: 'Gelombang II', regDisc: 200000, regNet: 300000, mainDisc: 750000, mainNet: 9250000, initialNet: 9550000 },
        { wave: 'Gelombang III', regDisc: 150000, regNet: 350000, mainDisc: 500000, mainNet: 9500000, initialNet: 9850000 },
        { wave: 'Gelombang IV', regDisc: 100000, regNet: 400000, mainDisc: 250000, mainNet: 9750000, initialNet: 10150000 },
        { wave: 'Gelombang Sisipan', regDisc: 0, regNet: 500000, mainDisc: 0, mainNet: 10000000, initialNet: 10500000 }
      ];

      for (const w of d3Waves) {
        const { breakdown, formatted } = getCalculated('D3 Manajemen Informatika', `Rincian biaya D3 Manajemen Informatika ${w.wave}`);
        expect(breakdown.base.dpp).toBe(10000000);
        expect(breakdown.discounts.pendaftaranDiscount).toBe(w.regDisc);
        expect(breakdown.net.pendaftaran).toBe(w.regNet);
        expect(breakdown.discounts.dppDiscount).toBe(w.mainDisc);
        expect(breakdown.net.dpp).toBe(w.mainNet);
        expect(breakdown.net.initialTotal).toBe(w.initialNet);

        // Komponen D3 wajib Biaya Registrasi (Jas, Topi, GMTI), bukan DPP
        expect(formatted).toMatch(/Biaya Registrasi \(Jas, Topi, GMTI\)/i);
        expect(formatted).not.toMatch(/\bDPP\s*:\s*Rp\s*10\.000\.000/i);
      }

      // B. S1 Sistem Komputer (Lampiran 2) — DPP Rp11.000.000
      const skWaves = [
        { wave: 'Gelombang Khusus', regDisc: 300000, dppDisc: 2000000, dppNet: 9000000, initialNet: 10700000 },
        { wave: 'Gelombang I', regDisc: 250000, dppDisc: 1000000, dppNet: 10000000, initialNet: 11750000 },
        { wave: 'Gelombang II', regDisc: 200000, dppDisc: 750000, dppNet: 10250000, initialNet: 12050000 },
        { wave: 'Gelombang III', regDisc: 150000, dppDisc: 500000, dppNet: 10500000, initialNet: 12350000 },
        { wave: 'Gelombang IV', regDisc: 100000, dppDisc: 250000, dppNet: 10750000, initialNet: 12650000 },
        { wave: 'Gelombang Sisipan', regDisc: 0, dppDisc: 0, dppNet: 11000000, initialNet: 13000000 }
      ];

      for (const w of skWaves) {
        const { breakdown, formatted } = getCalculated('S1 Sistem Komputer', `Biaya S1 Sistem Komputer ${w.wave}`);
        expect(breakdown.base.dpp).toBe(11000000);
        expect(breakdown.discounts.dppDiscount).toBe(w.dppDisc);
        expect(breakdown.net.dpp).toBe(w.dppNet);
        expect(breakdown.net.initialTotal).toBe(w.initialNet);
        expect(formatted).not.toContain('Rp 14.000.000'); // Tidak tertukar dengan SI
      }

      // C. S1 SI/TI/BD (Lampiran 1) — DPP Gelombang III, IV, Sisipan
      const siWaves = [
        { wave: 'Gelombang III', dppDisc: 1000000, dppNet: 13000000 },
        { wave: 'Gelombang IV', dppDisc: 500000, dppNet: 13500000 },
        { wave: 'Gelombang Sisipan', dppDisc: 0, dppNet: 14000000 }
      ];

      for (const w of siWaves) {
        const { breakdown } = getCalculated('S1 Sistem Informasi', `Biaya S1 Sistem Informasi ${w.wave}`);
        expect(breakdown.base.dpp).toBe(14000000);
        expect(breakdown.discounts.dppDiscount).toBe(w.dppDisc);
        expect(breakdown.net.dpp).toBe(w.dppNet);
      }

      // D. Double Degree HELP (Lampiran 4) & DNUI (Lampiran 5) — Pemisahan Diskon Pendaftaran & DPP
      const ddHelpKhusus = getCalculated('Double Degree HELP University', 'Biaya Double Degree HELP Gelombang Khusus');
      expect(ddHelpKhusus.breakdown.base.pendaftaran).toBe(3000000);
      expect(ddHelpKhusus.breakdown.discounts.pendaftaranDiscount).toBe(1500000);
      expect(ddHelpKhusus.breakdown.net.pendaftaran).toBe(1500000);
      expect(ddHelpKhusus.breakdown.base.dpp).toBe(20000000);
      expect(ddHelpKhusus.breakdown.discounts.dppDiscount).toBe(10000000);
      expect(ddHelpKhusus.breakdown.net.dpp).toBe(10000000);

      const ddDnuiGel2 = getCalculated('Double Degree DNUI', 'Biaya Double Degree DNUI Gelombang II');
      expect(ddDnuiGel2.breakdown.base.pendaftaran).toBe(3000000);
      expect(ddDnuiGel2.breakdown.discounts.pendaftaranDiscount).toBe(1000000);
      expect(ddDnuiGel2.breakdown.net.pendaftaran).toBe(2000000);
      expect(ddDnuiGel2.breakdown.base.dpp).toBe(20000000);
      expect(ddDnuiGel2.breakdown.discounts.dppDiscount).toBe(6000000);
      expect(ddDnuiGel2.breakdown.net.dpp).toBe(14000000);

      // E. S2 Magister Sistem Informasi (Lampiran 8) — Diskon Pendaftaran Gelombang I/II & SPP Tanpa Gelombang
      const s2Gel1 = getCalculated('S2 Sistem Informasi', 'Rincian biaya S2 Gelombang I');
      expect(s2Gel1.breakdown.base.pendaftaran).toBe(700000);
      expect(s2Gel1.breakdown.discounts.pendaftaranDiscount).toBe(200000);
      expect(s2Gel1.breakdown.net.pendaftaran).toBe(500000);
      expect(s2Gel1.breakdown.base.semester).toBe(10000000);
      expect(s2Gel1.breakdown.discounts.dppDiscount).toBe(0); // SPP/Pendidikan tidak ada diskon gelombang

      const s2Gel2 = getCalculated('S2 Sistem Informasi', 'Rincian biaya S2 Gelombang II');
      expect(s2Gel2.breakdown.base.pendaftaran).toBe(700000);
      expect(s2Gel2.breakdown.discounts.pendaftaranDiscount).toBe(100000);
      expect(s2Gel2.breakdown.net.pendaftaran).toBe(600000);
      expect(s2Gel2.breakdown.base.semester).toBe(10000000);
      expect(s2Gel2.breakdown.discounts.dppDiscount).toBe(0);
    });

    test('D3 MI: Membatasi klausul diskon tunai 10% dan tidak menerapkannya otomatis pada Biaya Registrasi D3', () => {
      const { breakdown, formatted } = getCalculated('D3 Manajemen Informatika', 'Rincian biaya D3 Manajemen Informatika Gelombang II');
      expect(formatted).not.toContain('tambahan potongan 10% dari Biaya Registrasi');
      expect(formatted).not.toContain('tambahan potongan sebesar *10%*');
      expect(formatted).toContain('Biaya Registrasi (Jas, Topi, GMTI)');
      expect(breakdown.discounts.cashDiscountAmount).toBe(0);
    });

  });

});
