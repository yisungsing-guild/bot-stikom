'use strict';

/**
 * tests/q030TargetedFixRegression.test.js
 *
 * Targeted regression tests for Q030 contact footer arbitration:
 * 1. Footer kontak institusi tidak mewarisi scope program dari dokumen biaya.
 * 2. Footer email/situs web tidak dianggap sebagai bukti nomor telepon.
 * 3. Bukti nomor telepon resmi yang relevan tetap dapat diterima.
 */

const { evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
const { normalizeChunkSafetyMetadata } = require('./helpers/normalizeChunkSafetyMetadata');

describe('Q030 Targeted Fix Regression Tests', () => {
  const q030Plan = {
    query: 'Berapa nomor telepon kampus pascasarjana ITB STIKOM Bali?',
    rawQuery: 'Berapa nomor telepon kampus pascasarjana ITB STIKOM Bali?',
    targetEntities: ['Program Pascasarjana (S2)', 'Program Magister (S2)'],
    academicLevel: 'S2',
    requiredAspects: ['kontak']
  };

  test('1. Footer kontak institusi tidak mewarisi scope program dari dokumen biaya', () => {
    const rawFeeFooterChunk = {
      id: '054c3fc2-2ddc-4370-a960-926778422eef',
      chunk: 'email:\nInfo@stikom-baiacid\n|\nwebslte\n:\nwwwitikom-ba.acid\nLampiran -1 Surat Keputusan ITB STIKOM Bali Nomor : 629/ITBSTIKOM/WDS/X/25',
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      sourceFile: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf',
      program: null,
      scope: 'INSTITUTIONAL_OR_ORG',
      level: 'Umum'
    };

    const norm = normalizeChunkSafetyMetadata(rawFeeFooterChunk);
    expect(norm.scope).toBe('INSTITUTIONAL_OR_ORG');
    expect(norm.level).toBe('Umum');
    expect(norm.rawProgram).toBeFalsy();
    expect(norm.supportedPrograms).toEqual([]);
  });

  test('2. Footer email/situs web tidak dianggap sebagai bukti nomor telepon', () => {
    const emailWebOnlyChunk = {
      id: '054c3fc2-2ddc-4370-a960-926778422eef',
      text: '[Program: S1 Sistem Informasi, S1 Teknologi Informasi, S1 Bisnis Digital, S2 Sistem Informasi] email:\nInfo@stikom-baiacid\n|\nwebslte\n:\nwwwitikom-ba.acid\nLampiran -1 Surat Keputusan ITB STIKOM Bali Nomor : 629/ITBSTIKOM/WDS/X/25',
      contextEntities: ['S1 Sistem Informasi', 'S1 Teknologi Informasi', 'S1 Bisnis Digital', 'S2 Sistem Informasi'],
      filename: 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf'
    };

    const res = evaluateEvidenceCompatibility(emailWebOnlyChunk, q030Plan);
    expect(res.accepted).toBe(false);
    expect(res.disposition).toBe('REJECT_ASPECT_MISMATCH');
    expect(res.reason).toMatch(/email_web_footer_lacks_phone/i);
  });

  test('3. Bukti nomor telepon resmi yang relevan tetap dapat diterima', () => {
    const officialPhoneChunk = {
      id: '1914fe2c-df2c-4837-9963-51a7f8e72e68',
      text: 'nomor hotline? | 082277389999. | hotline\nKontak | Berapa nomor telepon kampus? | (0361)244445. | telepon',
      filename: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      sourceFile: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      program: 'S2',
      academicLevel: 'S2'
    };

    const res = evaluateEvidenceCompatibility(officialPhoneChunk, q030Plan);
    expect(res.accepted).toBe(true);
    expect(res.disposition).toBe('SUPPORTS');
    expect(res.providedAspects).toContain('contact');
  });
});
