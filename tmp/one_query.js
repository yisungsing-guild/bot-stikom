(async () => {
  delete process.env.OPENAI_API_KEY;
  process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-22';
  const { querySemanticRag, clearSemanticCaches } = require('../src/engine/semanticRagEngine');
  clearSemanticCaches();
  const q = 'tagihan berubah kenapa ya?';
  const res = await querySemanticRag(q, { topK: 5 });
  console.log('Q:', q);
  console.log('SRC:', res.source);
  console.log('ANS:', String(res.answer || '[NO ANSWER]').replace(/\s+/g,' ').trim());
})();
