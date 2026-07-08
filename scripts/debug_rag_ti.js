(async () => {
  try {
    // Keep paths relative to repo root
    const { query: ragQuery } = require('../src/engine/ragEngine');
    const question = 'kalo program studi teknologi informasi itu belajar apa saja, dan nanti bisa bekerja di bidang apa saja?';
    console.log('Running RAG query for:', question);
    const ragResult = await ragQuery(question, 8, { answerQuestion: question, minScore: 0, strict: false });
    console.log('=== RAG Result ===');
    console.log(JSON.stringify(ragResult, null, 2));

    if (ragResult && Array.isArray(ragResult.contexts)) {
      console.log('\n=== Contexts (top) ===');
      ragResult.contexts.slice(0, 12).forEach((c, i) => {
        console.log(`#${i+1}`, { id: c.id || null, trainingId: c.trainingId || null, filename: c.filename || null, docCategory: c.docCategory || c.category || null, score: c.score || c.semanticScore || null });
        console.log('  preview:', (c.chunk || '').slice(0, 240).replace(/\n/g, ' '));
      });
    }
  } catch (e) {
    console.error('Error during RAG query:', e && e.message ? e.message : e);
    console.error(e && e.stack ? e.stack : '');
    process.exit(1);
  }
})();
