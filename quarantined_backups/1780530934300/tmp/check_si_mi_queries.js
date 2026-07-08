(async () => {
  process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
  const rag = require('../src/engine/ragEngine.js');
  const queries = [
    'Apa itu Sistem Informasi?',
    'Mata kuliah Sistem Informasi?',
    'Prospek kerja Sistem Informasi?',
    'Apa itu Manajemen Informatika?',
    'Mata kuliah Manajemen Informatika?',
    'Prospek kerja Manajemen Informatika?'
  ];
  for (const q of queries) {
    console.log('===============================');
    console.log('QUERY:', q);
    const res = await rag.query(q, 20, { returnDebug: true, minScore: 0.0, strict: false });
    console.log('source:', res.source);
    console.log('success:', res.success);
    console.log('confidenceTier:', res.confidenceTier);
    console.log('confidenceScore:', res.confidenceScore);
    console.log('contexts:', Array.isArray(res.contexts) ? res.contexts.length : 0);
    if (res.contexts && res.contexts.length > 0) {
      res.contexts.slice(0, 10).forEach((ctx, idx) => {
        console.log(`  ${idx + 1}. id=${ctx.id} filename=${ctx.filename} docCat=${ctx.docCategory||ctx.category||'N/A'} score=${ctx.score?.toFixed(4)||'N/A'} compositeScore=${ctx.compositeScore?.toFixed(4)||'N/A'}`);
        console.log('     preview=', String(ctx.chunk||'').replace(/\s+/g,' ').slice(0,160));
      });
    }
    console.log('ANSWER:', String(res.answer||'').replace(/\n/g,' ').slice(0,260));
    console.log();
  }
})();
