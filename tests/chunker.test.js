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
  test('keeps inline FAQ/QNA pairs as separate chunks', () => {
    const chunks = chunkText(
      'Pertanyaan: Apa itu Inkubator Bisnis? Jawaban: Inkubator Bisnis membantu mahasiswa mengembangkan ide usaha. Pertanyaan: Bagaimana cara daftar kuliah? Jawaban: Daftar kuliah melalui PMB.',
      { minSize: 10, maxSize: 300 }
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/Apa itu Inkubator Bisnis/i);
    expect(chunks[0]).toMatch(/mengembangkan ide usaha/i);
    expect(chunks[0]).not.toMatch(/daftar kuliah/i);
    expect(chunks[1]).toMatch(/Bagaimana cara daftar kuliah/i);
    expect(chunks.join('\n')).not.toMatch(/Pertanyaan:|Jawaban:/i);
  });

  test('cleanDocumentMarkers still strips FAQ labels for outbound-safe text', () => {
    expect(cleanDocumentMarkers('Pertanyaan: Apa ini? Jawaban: Ini jawaban')).toBe('Apa ini? Ini jawaban');
  });
});