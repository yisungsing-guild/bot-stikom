const { query } = require('../src/engine/ragEngine');
const queries = [
  'berapa biaya sistem informasi gelombang 3A',
  'berapa biaya prodi sistem informasi gelombang 3A',
  'berapa biaya program studi sistem informasi gelombang 3A'
];
(async () => {
  for (const q of queries) {
    try {
      const result = await query(q, { strict: true, returnDebug: true });
      console.log('QUERY:', q);
      console.log('  success:', result.success);
      console.log('  source:', result.source);
      console.log('  score:', result.score || result.confidenceScore || null);
      console.log('  confidenceTier:', result.confidenceTier || null);
      console.log('  answer:', result.answer && result.answer.slice(0, 400));
      if (Array.isArray(result.contexts)) {
        console.log('  contexts count:', result.contexts.length);
        result.contexts.slice(0, 3).forEach((c, idx) => {
          console.log(`    context[${idx}]:`, c.filename || c.trainingId || c.id, c.category, String(c.chunk || c.excerpt || '').slice(0, 120));
        });
      }
      console.log('---');
    } catch (e) {
      console.error('QUERY ERROR', q, e && e.message ? e.message : e);
    }
  }
})();
