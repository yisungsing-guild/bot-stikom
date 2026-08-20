const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');

describe('semantic RAG P1 canonical query contracts', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    process.env.SEMANTIC_RAG_TODAY_YMD = '2026-08-19';
    process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
    if (typeof clearSemanticCaches === 'function') clearSemanticCaches();
  });

  test('routes registration-how by canonical intent before generic FAQ', async () => {
    const known = await querySemanticRag('Cara daftarnya bagaimana?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-registration-info');
    expect(known.debug && known.debug.routeStage).toBe('pre-guard-registration-how');
    expect(known.answer).toMatch(/siap\.stikom-bali\.ac\.id|online/i);

    const unseen = await querySemanticRag('mau daftar kuliah online lewat mana ya?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-registration-info');
    expect(unseen.answer).toMatch(/online|kampus/i);
  }, 60000);

  test('expands canonical program aliases for curriculum questions', async () => {
    const known = await querySemanticRag('apakah mahasiswa BD belajar AI?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-program-curriculum');
    expect(known.answer).toMatch(/Bisnis Digital/i);

    const unseen = await querySemanticRag('anak BD belajar AI gak?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-program-curriculum');
    expect(unseen.answer).toMatch(/Bisnis Digital|data analytics|digital/i);
  }, 60000);

  test('uses canonical fee subtype for UKT instead of registration-fee framing', async () => {
    const known = await querySemanticRag('UKT sistem informasi', { topK: 5 });
    expect(known.source).toBe('semantic-rag-fee-detail');
    expect(known.answer).toMatch(/UKT|biaya pendidikan per semester/i);
    expect(known.answer).not.toMatch(/khusus biaya pendaftaran/i);

    const unseen = await querySemanticRag('uang kuliah prodi informatika berapa?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-fee-detail');
    expect(unseen.answer).toMatch(/Teknologi Informasi|biaya pendidikan per semester/i);
  }, 60000);

  test('answers generic campus facility list from facility route without program hijack', async () => {
    const known = await querySemanticRag('fasilitas kampus apa saja?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-campus-facility');
    expect(known.answer).toMatch(/Career Center|Inkubator Bisnis|Language Learning Center/i);
    expect(known.answer).not.toMatch(/Double Degree Nasional|Double Degree Internasional/i);

    const unseen = await querySemanticRag('sarana prasarana kampus apa aja?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-campus-facility');
    expect(unseen.answer).toMatch(/fasilitas|layanan pendukung/i);
  }, 90000);

  test('preserves entity for program advice queries', async () => {
    const known = await querySemanticRag('Saya kurang cakap di bidang Teknologi Informasi, apa yang harus saya lakukan?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-program-advice');
    expect(known.answer).toMatch(/Teknologi Informasi/i);

    const unseen = await querySemanticRag('kalau ambil informatika tapi belum jago komputer gimana?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-program-advice');
    expect(unseen.answer).toMatch(/Teknologi Informasi|fondasi|bertahap/i);
  }, 60000);
  test('routes career service questions to campus support instead of generic facility/evidence', async () => {
    const known = await querySemanticRag('layanan karier ada?', { topK: 5 });
    expect(known.source).toBe('semantic-rag-campus-support-entity');
    expect(known.answer).toMatch(/Career Center|karier|magang|lowongan|job fair/i);
    expect(known.answer).not.toMatch(/didedikasikan\s*-\s*Selain/i);

    const unseen = await querySemanticRag('ada bantuan persiapan kerja untuk mahasiswa?', { topK: 5 });
    expect(unseen.source).toBe('semantic-rag-campus-support-entity');
    expect(unseen.answer).toMatch(/karier|persiapan kerja|Career Center/i);
  }, 60000);

});
