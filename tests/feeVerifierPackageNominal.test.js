'use strict';

const { verifyFinalAnswer } = require('../src/core/finalAnswerVerifier');

describe('Fee Verifier Package & Multi-Nominal Classification (Regression)', () => {
  const s2Frame = {
    entities: [{ canonical: 'S2 Sistem Informasi', name: 'S2 Sistem Informasi' }],
    intent: 'TUITION_FEE_INQUIRY',
    domain: 'TUITION_FEE'
  };

  const s1SiFrame = {
    entities: [{ canonical: 'S1 Sistem Informasi', name: 'S1 Sistem Informasi' }],
    intent: 'TUITION_FEE_INQUIRY',
    domain: 'TUITION_FEE'
  };

  const dummyArbitratedEvidence = {
    accepted: [
      {
        id: 'chunk_dummy',
        text: 'Program Studi S2 Sistem Informasi: Pendaftaran Rp 700.000, SPP Rp 10.000.000 per semester, opsi lunas 2 tahun Rp 40.000.000.'
      }
    ]
  };

  test('verifies single paragraph containing semester fee Rp 10.000.000 AND package lump sum Rp 40.000.000', () => {
    const text = 'Biaya kuliah S2 Sistem Informasi adalah sebesar Rp 10.000.000 per semester, atau dapat memilih opsi lunas 2 tahun sebesar Rp 40.000.000 saat registrasi.';
    const res = verifyFinalAnswer(text, s2Frame, dummyArbitratedEvidence, null, null, 'Berapa biaya kuliah S2 Sistem Informasi per semester?');
    expect(res.pass).toBe(true);
    expect(res.outcome).toBe('VERIFIED_FACTUAL');
  });

  test('rejects incorrect semester fee claim even if lump sum exists in profile', () => {
    // Claiming Rp 40.000.000 AS SEMESTER fee should be rejected
    const text = 'Biaya pendidikan per semester untuk S2 Sistem Informasi adalah sebesar Rp 40.000.000 per semester.';
    const res = verifyFinalAnswer(text, s2Frame, dummyArbitratedEvidence, null, null, 'Berapa biaya semester S2?');
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('unsupported_factual_claim_fee_nominal_divergence');
  });

  test('verifies total paket calculation across multiple semesters', () => {
    const text = 'Total paket biaya studi S2 Magister Sistem Informasi selama 4 semester adalah sebesar Rp 40.000.000 sampai lulus.';
    const res = verifyFinalAnswer(text, s2Frame, dummyArbitratedEvidence, null, null, 'Berapa total paket S2?');
    expect(res.pass).toBe(true);
  });

  test('verifies S1 SI with multiple components in one paragraph: pendaftaran, perlengkapan, DPP, semester, and total awal', () => {
    // Canonical S1 SI Gelombang II: pendaftaran net 300.000, perlengkapan 1.500.000, DPP net 12.500.000 (14jt - 1.5jt disc), semester 6.500.000, total awal 14.300.000
    const text = 'Rincian biaya S1 Sistem Informasi Gelombang II meliputi biaya pendaftaran sebesar Rp 300.000, perlengkapan jas dan kaos Rp 1.500.000, kewajiban DPP Rp 12.500.000, serta biaya per semester sebesar Rp 6.500.000. Total kewajiban biaya awal adalah Rp 14.300.000.';
    const frameWave2 = {
      ...s1SiFrame,
      registrationWave: 'Gelombang II'
    };
    const res = verifyFinalAnswer(text, frameWave2, dummyArbitratedEvidence, null, null, 'Rincian biaya S1 SI gelombang 2');
    expect(res.pass).toBe(true);
    expect(res.outcome).toBe('VERIFIED_FACTUAL');
  });

  test('rejects fabricated DPP fee not supported by canonical profile or evidence', () => {
    const text = 'Biaya kewajiban DPP untuk S1 Sistem Informasi adalah sebesar Rp 35.000.000.';
    const res = verifyFinalAnswer(text, s1SiFrame, dummyArbitratedEvidence, null, null, 'Berapa DPP S1 SI?');
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('unsupported_factual_claim_fee_nominal_divergence');
  });

  test('rejects fabricated total initial fee', () => {
    const text = 'Total kewajiban biaya awal untuk S1 Sistem Informasi adalah sebesar Rp 88.000.000.';
    const res = verifyFinalAnswer(text, s1SiFrame, dummyArbitratedEvidence, null, null, 'Berapa total biaya awal?');
    expect(res.pass).toBe(false);
    expect(res.reason).toContain('unsupported_factual_claim_fee_nominal_divergence');
  });
});
