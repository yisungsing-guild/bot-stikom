(async () => {
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
  process.env.SEMANTIC_RAG_INDEX_CACHE_MS = '0';
  process.env.SEMANTIC_RAG_TRAINING_DB_CACHE_MS = '0';
  delete process.env.OPENAI_API_KEY;

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
    console.log('Q:', q);
    console.log('SRC:', res.source);
    console.log('ANS:', String(res.answer || '[NO ANSWER]').replace(/\s+/g,' ').trim());
    console.log('---');
  }
})();
