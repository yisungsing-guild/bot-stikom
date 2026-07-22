const {
  filterSemanticContextsForQuestion,
  isLikelyRawAdministrativeDocument,
  hasSemanticEvidenceAlignment,
  sanitizeSemanticIndex
} = require('../src/engine/semanticRagEngine');

describe('semantic evidence selection', () => {
  test('rejects raw legal/administrative agreement chunks before answer generation', () => {
    const rawLegalChunk = [
      'Program internasional / kerja sama internasional: left 8255 Logo Mitra 0 0 Logo Mitra right -83820',
      'PERJANJIAN KERJA SAMA ANTARA INSTITUT TEKNOLOGI DAN BISNIS STIKOM BALI DAN (NAMA MITRA)',
      'Nomor: ...............................................',
      'PIHAK KESATU dan PIHAK KEDUA selanjutnya secara bersama-sama disebut PARA PIHAK.',
      'Pasal 13 ADDENDUM Perubahan terhadap Perjanjian Kerja Sama ini akan ditetapkan dalam addendum.',
      'dibuat dalam rangkap 2 (dua) yang bermeterai cukup dan mempunyai kekuatan hukum yang sama.'
    ].join(' ');

    expect(isLikelyRawAdministrativeDocument(rawLegalChunk)).toBe(true);

    const filtered = filterSemanticContextsForQuestion('apakah ada fasilitas belajar bahasa?', [
      { id: 'legal-raw', score: 0.91, chunk: rawLegalChunk, filename: 'template-pks.docx' },
      { id: 'facility', score: 0.7, chunk: 'Language Learning Center adalah fasilitas belajar bahasa untuk mendukung kemampuan bahasa mahasiswa ITB STIKOM Bali.', filename: 'fasilitas.md' }
    ]);

    expect(filtered.map((item) => item.id)).toEqual(['facility']);
  });

  test('sanitizes low-quality corpus chunks before semantic retrieval can score them', () => {
    const rawLegalChunk = 'Nomor: ............................................... Logo Mitra PERJANJIAN KERJA SAMA TENTANG ............................................... PIHAK KEDUA dan PARA PIHAK.';
    const cleanChunk = 'Biaya pendaftaran mahasiswa baru Program Studi Sistem Informasi adalah Rp. 500.000 sesuai data PMB.';

    const sanitized = sanitizeSemanticIndex([
      { id: 'legal', chunk: rawLegalChunk, filename: 'template-pks.docx', embedding: [0.1] },
      { id: 'clean-fee', chunk: cleanChunk, filename: 'biaya-si.pdf', embedding: [0.2] }
    ]);

    expect(sanitized.map((item) => item.id)).toEqual(['clean-fee']);
  });

  test('sanitizes raw SK/accreditation decree chunks with Pasal before retrieval', () => {
    const rawSkChunk = [
      'KEPUTUSAN LEMBAGA AKREDITASI MANDIRI INFORMATIKA DAN KOMPUTER',
      'Nomor:149/SK/LAM-INFOKOM/Ak/S/XII/2023',
      'TENTANG PERINGKAT AKREDITASI PROGRAM STUDI SISTEM INFORMASI',
      'Menimbang: bahwa untuk melaksanakan ketentuan Pasal 4 Peraturan Menteri Pendidikan dan Kebudayaan Nomor 5 Tahun 2020.',
      'Mengingat: Undang-undang Nomor 12 Tahun 2012 tentang Pendidikan Tinggi.'
    ].join(' ');

    expect(isLikelyRawAdministrativeDocument(rawSkChunk)).toBe(true);

    const sanitized = sanitizeSemanticIndex([
      { id: 'raw-sk', chunk: rawSkChunk, filename: 'SK Akreditasi SI.pdf', embedding: [0.1] },
      { id: 'clean-accreditation', chunk: 'Program Studi Sistem Informasi ITB STIKOM Bali memiliki status akreditasi yang tercatat pada data kampus.', filename: 'akreditasi-ringkas.md', embedding: [0.2] }
    ]);

    expect(sanitized.map((item) => item.id)).toEqual(['clean-accreditation']);
  });
  test('requires semantic evidence to mention requested entity or topic', () => {
    expect(hasSemanticEvidenceAlignment(
      'Bagaimana cara mendaftar program LinkedIn Career Center?',
      'Career Center membantu mahasiswa melalui informasi lowongan kerja dan konsultasi karier.'
    )).toBe(false);

    expect(hasSemanticEvidenceAlignment(
      'Bagaimana cara mendaftar program LinkedIn Career Center?',
      'Program LinkedIn di Career Center belum memiliki detail pendaftaran pada data yang tersedia.'
    )).toBe(true);

    expect(hasSemanticEvidenceAlignment('Mempunyai', 'Language Learning Center adalah fasilitas belajar bahasa.')).toBe(false);
  });
});