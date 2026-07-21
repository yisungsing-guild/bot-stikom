const {
  filterSemanticContextsForQuestion,
  isLikelyRawAdministrativeDocument
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

    const filtered = filterSemanticContextsForQuestion('Mempunyai', [
      { id: 'legal-raw', score: 0.91, chunk: rawLegalChunk, filename: 'template-pks.docx' },
      { id: 'facility', score: 0.7, chunk: 'Language Learning Center adalah fasilitas belajar bahasa untuk mendukung kemampuan bahasa mahasiswa ITB STIKOM Bali.', filename: 'fasilitas.md' }
    ]);

    expect(filtered.map((item) => item.id)).toEqual(['facility']);
  });
});