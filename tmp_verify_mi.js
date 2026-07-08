const { query } = require('./src/engine/ragEngine');

(async () => {
  const questions = [
    'Apa itu Manajemen Informatika?',
    'Mata kuliah Manajemen Informatika?',
    'Prospek kerja Manajemen Informatika?'
  ];

  for (const q of questions) {
    const res = await query(q, 5);
    console.log('---');
    console.log('Q:', q);
    console.log(JSON.stringify({
      source: res.source,
      contexts: res.contexts?.length ?? 0,
      topContexts: res.contexts?.map((c, i) => ({ i, id: c.id, source: c.source, metadata: c.metadata })) ?? null,
      answer: res.answer
    }, null, 2));
  }
})();
