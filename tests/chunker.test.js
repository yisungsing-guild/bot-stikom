const { chunkText, cleanDocumentMarkers } = require('../src/engine/chunker');

describe('chunker', () => {
  test('keeps FAQ/QNA pairs as separate cleaned chunks', () => {
    const chunks = chunkText([
      'Q: Apakah Career Center membantu cari magang?',
      'A: Career Center membantu mahasiswa lewat info lowongan, magang, rekrutmen, job fair, dan konsultasi karier.',
      '',
      'Q: Apakah kantin buka malam?',
      'A: Informasi jam operasional kantin mengikuti kebijakan kampus.'
    ].join('\n'), { minSize: 20, maxSize: 220 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/Career Center membantu mahasiswa/i);
    expect(chunks[0]).not.toMatch(/kantin buka malam/i);
    expect(chunks[1]).toMatch(/kantin buka malam/i);
    expect(chunks.join('\n')).not.toMatch(/\bQ\s*:|\bA\s*:|FAQ:/i);
  });

  test('cleanDocumentMarkers still strips FAQ labels for outbound-safe text', () => {
    expect(cleanDocumentMarkers('Pertanyaan: Apa ini? Jawaban: Ini jawaban')).toBe('Apa ini? Ini jawaban');
  });
});