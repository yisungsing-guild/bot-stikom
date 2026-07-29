describe('semantic RAG inline FAQ/QNA handling', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
  });

  test('answers only the matching inline FAQ/QNA pair and does not leak neighboring pairs', async () => {
    jest.doMock('../src/engine/ragEngine', () => ({
      loadIndex: jest.fn(() => [
        {
          id: 'faq-inline-program-orientasi',
          chunk: 'Pertanyaan: Apa itu Program Orientasi Digital? Jawaban: Program Orientasi Digital adalah kegiatan pengenalan ekosistem digital kampus untuk membantu mahasiswa baru memahami layanan akademik dan teknologi kampus. Pertanyaan: Bagaimana cara daftar kuliah? Jawaban: Daftar kuliah dilakukan melalui kanal PMB resmi.',
          filename: 'FAQ Program Orientasi Digital.docx',
          source: 'upload',
          trainingId: 'training-inline-faq',
          embedding: [1, 0, 0]
        }
      ]),
      computeEmbedding: jest.fn(async () => [1, 0, 0]),
      cleanAnswerLanguage: jest.fn((text) => String(text || '').trim())
    }));

    const { querySemanticRag } = require('../src/engine/semanticRagEngine');
    const result = await querySemanticRag('Apa itu Program Orientasi Digital?', { topK: 5 });

    expect(result.success).toBe(true);
    expect(result.source).toBe('semantic-rag-generic-faq-qna');
    expect(result.answer).toMatch(/Program Orientasi Digital adalah kegiatan pengenalan ekosistem digital kampus/i);
    expect(result.answer).not.toMatch(/Bagaimana cara daftar kuliah|Daftar kuliah dilakukan|PMB resmi|Pertanyaan:|Jawaban:/i);
  });
});