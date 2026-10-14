'use strict';

/**
 * tests/finalClosureRegression.test.js
 *
 * Final Closure Regression Tests:
 * 1. Q005 menjawab nama himpunan mahasiswa SI berdasarkan sumber resmi (HIMAPRODI SI).
 * 2. Q015 menjawab profil himpunan mahasiswa TI berdasarkan sumber resmi prodi TI (HIMAPRODI TI / Cakra Pragnya).
 * 3. Bukti HIMA SI tidak salah diklaim sebagai HIMA TI, atau sebaliknya.
 * 4. Kasus Q030 tetap menolak footer email/situs web sebagai bukti nomor telepon.
 * 5. Guard wrong-entity dan academic-level tetap berfungsi.
 */

const { evaluateEvidenceCompatibility } = require('../src/core/evidenceArbiter');
const { normalizeChunkSafetyMetadata } = require('./helpers/normalizeChunkSafetyMetadata');

describe('Final Project Closure Regression Tests', () => {
  const himaSiChunk = {
    id: 'c018472a-85f7-47b7-b942-f6b0d5e277af',
    text: 'HIMAPRODI SISTEM INFORMASI\nSecara perlahan Organisasi Kemahasiswaan (ORMAWA)... yaitu HIMAPRODI SI (Himpunan Mahasiswa Program Studi Sistem Informasi).',
    filename: 'PROFILE HIMA SI.docx',
    sourceFile: 'PROFILE HIMA SI.docx',
    program: 'SI',
    scope: 'PROGRAM_SINGLE',
    level: 'S1',
    academicLevel: 'S1'
  };

  const himaTiChunk = {
    id: 'fd894307-f231-4ed6-8f07-4007ca2535df',
    text: 'PROFILE HIMPUNAN MAHASISWA PROGRAM STUDI TEKNOLOGI INFORMASI\nHIMAPRODI TI bertujuan sebagai wadah... kepengurusan HIMAPRODI TI Tahun 2026 mengusung nama Kabinet CAKRA PRAGNYA.',
    filename: 'BUKU ORMAWA HIMAPRODI TI.docx',
    sourceFile: 'BUKU ORMAWA HIMAPRODI TI.docx',
    program: 'TI',
    scope: 'PROGRAM_SINGLE',
    level: 'S1',
    academicLevel: 'S1'
  };

  test('1. Q005: Bukti HIMA SI diterima dan mendukung entitas S1 Sistem Informasi', () => {
    const q005Plan = {
      query: 'Apa nama himpunan mahasiswa untuk program studi Sistem Informasi?',
      rawQuery: 'Apa nama himpunan mahasiswa untuk program studi Sistem Informasi?',
      targetEntities: ['S1 Sistem Informasi'],
      academicLevel: 'S1',
      requiredAspects: ['organization', 'general']
    };

    const res = evaluateEvidenceCompatibility(himaSiChunk, q005Plan);
    expect(res.accepted).toBe(true);
    expect(res.disposition).toBe('SUPPORTS');
    expect(res.providedAspects).toContain('organization');

    const norm = normalizeChunkSafetyMetadata(himaSiChunk);
    expect(norm.entity).toBe('S1 Sistem Informasi');
    expect(norm.level).toBe('S1');
    expect(norm.scope).toBe('PROGRAM_SINGLE');
  });

  test('2. Q015: Bukti HIMA TI diterima dan mendukung entitas S1 Teknologi Informasi', () => {
    const q015Plan = {
      query: 'Apa profil himpunan mahasiswa program studi Teknologi Informasi?',
      rawQuery: 'Apa profil himpunan mahasiswa program studi Teknologi Informasi?',
      targetEntities: ['S1 Teknologi Informasi'],
      academicLevel: 'S1',
      requiredAspects: ['organization', 'general']
    };

    const res = evaluateEvidenceCompatibility(himaTiChunk, q015Plan);
    expect(res.accepted).toBe(true);
    expect(res.disposition).toBe('SUPPORTS');
    expect(res.providedAspects).toContain('organization');

    const norm = normalizeChunkSafetyMetadata(himaTiChunk);
    expect(norm.entity).toBe('S1 Teknologi Informasi');
    expect(norm.level).toBe('S1');
    expect(norm.scope).toBe('PROGRAM_SINGLE');
  });

  test('3. Cross-entity isolation: Bukti HIMA SI ditolak untuk query HIMA TI dan sebaliknya', () => {
    const qTiPlan = {
      query: 'Apa profil himpunan mahasiswa program studi Teknologi Informasi?',
      targetEntities: ['S1 Teknologi Informasi'],
      academicLevel: 'S1'
    };
    const crossRes1 = evaluateEvidenceCompatibility(himaSiChunk, qTiPlan);
    expect(crossRes1.accepted).toBe(false);
    expect(crossRes1.disposition).toMatch(/REJECT/);

    const qSiPlan = {
      query: 'Apa nama himpunan mahasiswa untuk program studi Sistem Informasi?',
      targetEntities: ['S1 Sistem Informasi'],
      academicLevel: 'S1'
    };
    const crossRes2 = evaluateEvidenceCompatibility(himaTiChunk, qSiPlan);
    expect(crossRes2.accepted).toBe(false);
    expect(crossRes2.disposition).toMatch(/REJECT/);
  });

  test('4. Q030: Menolak footer email/situs web sebagai bukti nomor telepon pascasarjana', () => {
    const q030Plan = {
      query: 'Berapa nomor telepon kampus pascasarjana ITB STIKOM Bali?',
      rawQuery: 'Berapa nomor telepon kampus pascasarjana ITB STIKOM Bali?',
      targetEntities: ['Program Pascasarjana (S2)', 'Program Magister (S2)'],
      academicLevel: 'S2',
      requiredAspects: ['kontak']
    };

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

    const officialPhoneChunk = {
      id: '1914fe2c-df2c-4837-9963-51a7f8e72e68',
      text: 'nomor hotline? | 082277389999. | hotline\nKontak | Berapa nomor telepon kampus? | (0361)244445. | telepon',
      filename: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      sourceFile: 'Training_Dataset_Pascasarjana_ITB_STIKOM_Bali.xlsx',
      program: 'S2',
      academicLevel: 'S2'
    };

    const passRes = evaluateEvidenceCompatibility(officialPhoneChunk, q030Plan);
    expect(passRes.accepted).toBe(true);
    expect(passRes.disposition).toBe('SUPPORTS');
  });

  test('5. Academic-level guard tetap berfungsi ketat menolak konflik jenjang', () => {
    const s1Plan = {
      query: 'Berapa biaya kuliah S1?',
      targetEntities: ['S1 Sistem Informasi'],
      academicLevel: 'S1'
    };
    const s2Chunk = {
      text: 'Biaya S2 Pascasarjana Magister Sistem Informasi',
      program: 'S2',
      academicLevel: 'S2'
    };
    const res = evaluateEvidenceCompatibility(s2Chunk, s1Plan);
    expect(res.accepted).toBe(false);
    expect(res.disposition).toBe('REJECT_ACADEMIC_LEVEL_MISMATCH');
  });

  test('6. Q010: Menolak chunk HIMA SI (c018472a) dan menerima chunk HIMA SK untuk pertanyaan HIMA SK', () => {
    const q010Plan = {
      query: 'Apa kegiatan organisasi Himpunan Mahasiswa Sistem Komputer (HIMA SK)?',
      rawQuery: 'Apa kegiatan organisasi Himpunan Mahasiswa Sistem Komputer (HIMA SK)?',
      targetEntities: ['HIMAPRODI Sistem Komputer'],
      academicLevel: 'S1',
      primaryAspect: 'student_organization',
      requiredAspects: ['student_organization', 'activities', 'ukm']
    };

    // 1. Chunk HIMA SI c018472a must be REJECTED for Q010
    const rejectSi = evaluateEvidenceCompatibility(himaSiChunk, q010Plan);
    expect(rejectSi.accepted).toBe(false);
    expect(rejectSi.disposition).toBe('REJECT_SCOPE_COLLISION');
    expect(rejectSi.reason).toMatch(/candidate_scoped_to_program_SI_not_SK/i);

    // 2. Official HIMA SK gold chunk must be ACCEPTED for Q010
    const himaSkGoldChunk = {
      id: '53042bf8-7f7e-46bf-acb3-5f8c2077ab55',
      chunk: 'Definisi:\nHIMAPRODI SISTEM KOMPUTER ITB STIKOM Bali adalah organisasi yang menghimpun seluruh Mahasiswa Program Studi Sistem Komputer berstatus independen...',
      filename: 'PROFILE HIMA SK.docx',
      sourceFile: 'PROFILE HIMA SK.docx',
      program: 'SK',
      level: 'S1'
    };
    const acceptSk = evaluateEvidenceCompatibility(himaSkGoldChunk, q010Plan);
    expect(acceptSk.accepted).toBe(true);
    expect(acceptSk.disposition).toBe('SUPPORTS');

    // 3. Official HIMA SK chunk must be REJECTED for Q005 (HIMA SI)
    const q005Plan = {
      query: 'Apa nama himpunan mahasiswa untuk program studi Sistem Informasi?',
      targetEntities: ['HIMAPRODI Sistem Informasi'],
      academicLevel: 'S1',
      requiredAspects: ['organization']
    };
    const rejectSkForSi = evaluateEvidenceCompatibility(himaSkGoldChunk, q005Plan);
    expect(rejectSkForSi.accepted).toBe(false);
    expect(rejectSkForSi.disposition).toBe('REJECT_SCOPE_COLLISION');
  });
});
