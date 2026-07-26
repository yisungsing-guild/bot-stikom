(async () => {
  delete process.env.OPENAI_API_KEY;
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');
  const cases = [
    'jadwal kuliah liat dimana?',
    'telat krs gimana?',
    'nilai ku salah harus lapor siapa?',
    'mau ajukan skripsi caranya?',
    'ukt bayar lewat apa?',
    'dendanya berapa kalau telat bayar?',
    'tagihan berubah kenapa ya?'
  ];
  for (const q of cases) {
    clearSemanticCaches();
    const res = await querySemanticRag(q, { topK: 5 });
    console.log(q, '->', res.source, '->', String(res.answer || '[NO ANSWER]').replace(/\s+/g,' ').slice(0,200));
  }
})();
