(async () => {
  process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  delete process.env.OPENAI_API_KEY;
  const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');
  const cases = [
    'mau ajukan skripsi caranya?',
    'gabung bem gimana?',
    'ada sertifikasi buat mahasiswa?',
    'negara partner double degree mana aja?',
    'kelas internasional ada ga?',
    'hubungi dosen lewat mana?',
    'minta transkrip nilai gimana?',
    'ada loker ga dari kampus?',
    'nomor admin kampus berapa?'
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