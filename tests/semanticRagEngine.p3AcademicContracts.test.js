const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');

describe('semantic RAG Phase 3 academic policy contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    if (typeof clearSemanticCaches === 'function') clearSemanticCaches();
  });

  const expectThesisPageFallbackWithFacts = (result) => {
    expect(result.source).toMatch(/semantic-rag-academic-policy/i);
    expect(result.answer).toMatch(/minimal halaman total|jumlah halaman total|Tugas Akhir|Skripsi/i);
    expect(result.answer).toMatch(/150 kata/i);
    expect(result.answer).toMatch(/200 kata/i);
    expect(result.answer).toMatch(/4 SKS/i);
    expect(result.answer).toMatch(/tidak menemukan|tidak tercantum|belum tercantum/i);
  };

  test('keeps supporting facts for golden academic thesis page-count fallback', async () => {
    const result = await querySemanticRag('berapa halaman minimal dibuat untuk tugas akhir di prodi SI atau fakultas infokom', { topK: 8 });
    expectThesisPageFallbackWithFacts(result);
  }, 60000);

  test('generalizes to formal and informal thesis page-count variants', async () => {
    const formal = await querySemanticRag('Mohon info ketentuan jumlah halaman minimum skripsi S1 Sistem Informasi', { topK: 8 });
    expectThesisPageFallbackWithFacts(formal);

    const informal = await querySemanticRag('skripsi SI minimal brp halaman ya?', { topK: 8 });
    expectThesisPageFallbackWithFacts(informal);
  }, 60000);

  test('generalizes to different word order and entity-implicit forms', async () => {
    const reordered = await querySemanticRag('untuk TA, minimal total halamannya ada aturan berapa lembar?', { topK: 8 });
    expectThesisPageFallbackWithFacts(reordered);

    const synonym = await querySemanticRag('aturan panjang naskah tugas akhir minimal berapa halaman?', { topK: 8 });
    expectThesisPageFallbackWithFacts(synonym);
  }, 60000);

  test('keeps unsupported academic details safe without fabricating', async () => {
    const unknown = await querySemanticRag('berapa warna sampul skripsi untuk prodi SI?', { topK: 8 });
    expect(unknown.answer).not.toMatch(/150 kata|200 kata|4 SKS/i);
    expect(unknown.answer).toMatch(/belum|tidak|konfirmasi|admin|akademik|prodi/i);
  }, 60000);
});
