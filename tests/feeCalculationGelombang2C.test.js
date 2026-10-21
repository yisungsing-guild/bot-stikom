'use strict';

/**
 * tests/feeCalculationGelombang2C.test.js
 *
 * REGRESSION SUITE: VERIFIKASI BIAYA BERDASARKAN GELOMBANG 2C & ATURAN PEMBAYARAN
 *
 * Invariants Verified:
 * 1. S1 Sistem Informasi Gelombang 2C:
 *    - Recognizes Gelombang 2C as explicit but unverified (SOURCE_GAP against SK Rektor 629).
 *    - Formatter clearly separates:
 *      (a) Status Verifikasi Gelombang 2C
 *      (b) Biaya Umum Program Studi (Tarif Dasar Terverifikasi)
 *      (c) Ketentuan yang Belum Terverifikasi (SOURCE_GAP)
 *      (d) Ringkasan Biaya Dasar & Pemisahan Jadwal Pembayaran
 * 2. S1 Sistem Informasi tanpa menyebut gelombang:
 *    - Does NOT invent or force a wave.
 *    - Displays generic program tuition with clear component breakdown.
 * 3. Gelombang 2C tidak tertukar dengan Gelombang I, 1A, atau II:
 *    - Distinct wave detection: Gelombang 2C is unverified, Gelombang I/II are verified.
 *    - Does not apply Gelombang II or Gelombang I discounts to Gelombang 2C.
 * 4. Diskon gelombang tidak muncul tanpa evidence yang cocok:
 *    - No registration discount or DPP discount claimed for Gelombang 2C.
 * 5. Total biaya dan jadwal pembayaran tidak tercampur:
 *    - Upfront cash at registration (Rp 2.000.000: Pendaftaran + Perlengkapan) is strictly
 *      separated from total initial obligation (Rp 16.000.000 including DPP).
 * 6. DPP yang dapat dicicil tidak otomatis dianggap harus dibayar lunas di awal:
 *    - Explicit statement that DPP can be paid in installments up to UTS-1.
 * 7. Total semester pertama dan estimasi tahun pertama:
 *    - Only provided with verified assumptions; when unverified wave is asked,
 *      clearly notes SOURCE_GAP for wave-specific packages.
 * 8. Pertanyaan biaya semester saja hanya menampilkan komponen relevan:
 *    - Single-aspect queries (e.g., SPP semester) only return semester fee + schedule,
 *      without dumping DPP, registration, or equipment.
 * 9. Tidak ada klaim beasiswa atau diskon tanpa evidence:
 *    - FinalAnswerVerifier blocks ungrounded discount claims for 2C.
 * 10. Tidak ada kebocoran tabel/OCR dan tidak ada pertukaran evidence antarprogram studi:
 *     - S1 Sistem Informasi fees are strictly isolated from other degrees/programs.
 */

const {
  detectFeeScope,
  resolveFeeProfile,
  calculateFeeBreakdown,
  formatWhatsAppFeeResponse
} = require('../src/core/feeCalculationEngine');
const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');
const { resolveSemanticFrame } = require('../src/core/semanticFrameResolver');

function getCalculated(prodi, rawQuery) {
  const profile = resolveFeeProfile(prodi);
  const scope = detectFeeScope(rawQuery);
  const breakdown = calculateFeeBreakdown(profile, scope);
  const formatted = formatWhatsAppFeeResponse(breakdown, rawQuery);
  return { profile, scope, breakdown, formatted };
}

describe('Regression Suite: Verifikasi Biaya Gelombang 2C & Aturan Pembayaran', () => {

  describe('1. Deteksi Scope & Gelombang', () => {
    test('Mendeteksi Gelombang 2C sebagai explicit tapi tidak terverifikasi (unverified)', () => {
      const scope = detectFeeScope('Saya mau tau rincian biaya sistem informasi gelombang 2C');
      expect(scope.isWaveExplicit).toBe(true);
      expect(scope.isWaveVerified).toBe(false);
      expect(scope.registrationWave).toBe('Gelombang 2C');
      expect(scope.calculationScope).toBe('full_breakdown');
    });

    test('Mendeteksi S1 Sistem Informasi tanpa gelombang', () => {
      const scope = detectFeeScope('Berapa rincian biaya S1 Sistem Informasi?');
      expect(scope.isWaveExplicit).toBe(false);
      expect(scope.isWaveVerified).toBe(false);
      expect(scope.registrationWave).toBeNull();
      expect(scope.calculationScope).toBe('full_breakdown');
    });

    test('Gelombang 2C tidak tertukar dengan Gelombang I, 1A, atau II', () => {
      const scope2C = detectFeeScope('biaya sistem informasi gelombang 2C');
      const scope1 = detectFeeScope('biaya sistem informasi gelombang 1');
      const scopeI = detectFeeScope('biaya sistem informasi gelombang I');
      const scope2 = detectFeeScope('biaya sistem informasi gelombang 2');
      const scopeII = detectFeeScope('biaya sistem informasi gelombang II');
      const scope1A = detectFeeScope('biaya sistem informasi gelombang 1A');

      expect(scope2C.registrationWave).toBe('Gelombang 2C');
      expect(scope2C.isWaveVerified).toBe(false);

      expect(scope1.registrationWave).toBe('Gelombang I');
      expect(scope1.isWaveVerified).toBe(true);

      expect(scopeI.registrationWave).toBe('Gelombang I');
      expect(scopeI.isWaveVerified).toBe(true);

      expect(scope2.registrationWave).toBe('Gelombang II');
      expect(scope2.isWaveVerified).toBe(true);

      expect(scopeII.registrationWave).toBe('Gelombang II');
      expect(scopeII.isWaveVerified).toBe(true);

      expect(scope1A.registrationWave).toBe('Gelombang 1A');
      expect(scope1A.isWaveVerified).toBe(false);
    });

    test('Deteksi single-aspect: biaya semester saja', () => {
      const scope = detectFeeScope('Berapa biaya semester sistem informasi gelombang 2C?');
      expect(scope.calculationScope).toBe('semester_only');
      expect(scope.registrationWave).toBe('Gelombang 2C');
      expect(scope.isWaveVerified).toBe(false);
    });
  });

  describe('2. Perhitungan & Formatting Gelombang 2C (Pemisahan 3 Hal & SOURCE_GAP)', () => {
    test('Format WhatsApp Gelombang 2C memisahkan status gelombang, tarif dasar, dan SOURCE_GAP', () => {
      const rawQuery = 'Saya mau tau rincian biaya sistem informasi gelombang 2C';
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      // Section 1: Status verifikasi
      expect(formatted).toContain('Status Verifikasi Gelombang 2C');
      expect(formatted).toContain('SK Rektor Nomor : 629/ITBSTIKOM/WDS/X/25');
      expect(formatted).toContain('tidak tercantum');
      expect(formatted).toContain('Gelombang Khusus, Gelombang I, Gelombang II, Gelombang III, Gelombang IV, dan Gelombang Sisipan');

      // Section 2: Biaya umum program studi (tarif dasar terverifikasi)
      expect(formatted).toContain('Biaya Umum Program Studi (Tarif Dasar Terverifikasi)');
      expect(formatted).toContain('Rp 500.000'); // Biaya pendaftaran dasar
      expect(formatted).toContain('Rp 1.500.000'); // Perlengkapan awal
      expect(formatted).toContain('Rp 14.000.000'); // DPP dasar
      expect(formatted).toContain('Rp 6.500.000'); // SPP semester
      expect(formatted).toContain('SMK TI'); // Potongan 20% alumni SMK TI

      // Section 3: SOURCE_GAP
      expect(formatted).toContain('Ketentuan yang Belum Terverifikasi (SOURCE_GAP)');
      expect(formatted).toContain('Potongan biaya pendaftaran khusus Gelombang 2C: Belum tersedia');
      expect(formatted).toContain('Beasiswa atau potongan DPP khusus Gelombang 2C: Belum tersedia');

      // Section 4: Ringkasan & pemisahan jadwal pembayaran
      expect(formatted).toContain('Ringkasan Biaya Dasar & Pemisahan Jadwal Pembayaran');
      expect(formatted).toContain('Pembayaran langsung saat registrasi awal: *Rp 2.000.000*');
      expect(formatted).toContain('Total kewajiban biaya awal masuk: *Rp 16.000.000*');
      expect(formatted).toContain('dapat diangsur setiap bulan hingga UTS-1 (bukan wajib lunas tunai di muka)');
    });

    test('Tidak ada klaim diskon atau beasiswa palsu untuk Gelombang 2C', () => {
      const rawQuery = 'Saya mau tau rincian biaya sistem informasi gelombang 2C';
      const { breakdown, formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      // Pastikan tidak ada diskon gelombang yang disematkan ke 2C
      expect(breakdown.discounts.pendaftaranDiscount).toBe(0);
      expect(breakdown.discounts.dppDiscount).toBe(0);

      // Verifikasi teks tidak mengklaim potongan gelombang 2C aktif
      expect(formatted).not.toMatch(/potongan gelombang 2C: Rp [1-9]/i);
      expect(formatted).not.toMatch(/diskon 2C: [1-9]/i);
    });

    test('Pemisahan tegas: Biaya awal tunai vs DPP cicilan', () => {
      const rawQuery = 'Saya mau tau rincian biaya sistem informasi gelombang 2C';
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      // Biaya wajib tunai saat registrasi awal adalah Rp 2.000.000 (Pendaftaran 500k + Perlengkapan 1.5M)
      expect(formatted).toContain('Pembayaran langsung saat registrasi awal: *Rp 2.000.000*');
      // DPP 14.000.000 tidak boleh dikatakan wajib tunai di awal
      expect(formatted).toMatch(/Dapat dicicil\/diangsur per bulan hingga UTS-1 \(tidak wajib dibayar tunai sekaligus/i);
    });
  });

  describe('3. Single-Aspect Queries (Biaya Semester Saja)', () => {
    test('Pertanyaan biaya semester saja hanya menampilkan komponen SPP dan jadwal perwalian', () => {
      const rawQuery = 'Berapa biaya semester sistem informasi gelombang 2C?';
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      expect(formatted).toContain('Rp 6.500.000');
      expect(formatted).toContain('perwalian/KRS');
      // Tidak boleh mencantumkan rincian perlengkapan/DPP dalam jawaban fokus semester
      expect(formatted).not.toContain('Jas Almamater');
      expect(formatted).not.toContain('Kaos, Tas, GMTI');
      expect(formatted).not.toContain('Dana Pendidikan Pokok (DPP): Rp 14.000.000');
      // Menegaskan bahwa biaya semester tidak terpengaruh gelombang
      expect(formatted).toContain('tidak dipengaruhi oleh gelombang pendaftaran');
    });
  });

  describe('4. S1 Sistem Informasi Tanpa Menyebut Gelombang', () => {
    test('Menampilkan rincian standar tanpa mengasumsikan gelombang tertentu', () => {
      const rawQuery = 'Berapa rincian biaya S1 Sistem Informasi?';
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      expect(formatted).toContain('*Rincian Biaya Kuliah S1 Sistem Informasi*');
      expect(formatted).not.toContain('Gelombang I');
      expect(formatted).not.toContain('Gelombang 2C');
      expect(formatted).toContain('Biaya Pendaftaran: Rp 500.000');
      expect(formatted).toContain('Biaya Pendidikan Per Semester: Rp 6.500.000');
      expect(formatted).toContain('Dana Pendidikan Pokok (DPP): Rp 14.000.000');
    });
  });

  describe('5. FinalAnswerVerifier Guardrails', () => {
    test('Verifier menolak klaim diskon tidak berdasar untuk Gelombang 2C', () => {
      const semanticFrame = resolveSemanticFrame('Saya mau tau rincian biaya sistem informasi gelombang 2C');
      const ungroundedCandidate = `Biaya kuliah S1 Sistem Informasi Gelombang 2C mendapatkan potongan pendaftaran 50% dan diskon DPP Rp 2.000.000.`;

      const verification = verifyFinalAnswer(ungroundedCandidate, semanticFrame, { accepted: [] });
      expect(verification.pass).toBe(false);
      expect(verification.reason).toContain('ungrounded_fee_wave_claim_gelombang_2c_without_proof');
    });

    test('Verifier menolak penyamaan langsung Gelombang 2C dengan Gelombang II tanpa bukti', () => {
      const semanticFrame = resolveSemanticFrame('Saya mau tau rincian biaya sistem informasi gelombang 2C');
      const ungroundedCandidate = `Rincian biaya Sistem Informasi Gelombang 2C sama dengan Gelombang II resmi.`;

      const verification = verifyFinalAnswer(ungroundedCandidate, semanticFrame, { accepted: [] });
      expect(verification.pass).toBe(false);
      expect(verification.reason).toContain('ungrounded_fee_wave_claim_gelombang_2c_equated_without_proof');
    });

    test('Verifier meloloskan jawaban resmi yang memisahkan status dan menyatakan SOURCE_GAP', () => {
      const rawQuery = 'Saya mau tau rincian biaya sistem informasi gelombang 2C';
      const semanticFrame = resolveSemanticFrame(rawQuery);
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      const verification = verifyFinalAnswer(formatted, semanticFrame, {
        accepted: [
          {
            text: 'Rincian Biaya S1 Sistem Informasi SK 629 Gelombang Khusus, I, II, III, IV, Sisipan',
            source: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf'
          }
        ]
      });
      expect(verification.pass).toBe(true);
    });
  });

  describe('6. Isolasi Antarprogram Studi & Proteksi Kebocoran OCR/Tabel', () => {
    test('Tidak ada kebocoran tabel mentah, baris pipa, atau metadata internal', () => {
      const rawQuery = 'Saya mau tau rincian biaya sistem informasi gelombang 2C';
      const { formatted } = getCalculated('S1 Sistem Informasi', rawQuery);

      expect(formatted).not.toMatch(/\|.*\|.*\|/); // No markdown raw tables
      expect(formatted).not.toContain('chunk_');
      expect(formatted).not.toContain('PAGE_');
      expect(formatted).not.toContain('{"');
      expect(formatted).not.toContain('Bisnis Digital'); // Isolasi prodi
      expect(formatted).not.toContain('Teknologi Informasi'); // Isolasi prodi
      expect(formatted).not.toContain('Sistem Komputer'); // Isolasi prodi
    });
  });

});
