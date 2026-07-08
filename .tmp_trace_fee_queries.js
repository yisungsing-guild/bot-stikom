const { query } = require('./src/engine/ragEngine');
const queries = [
  'biaya',
  'biaya kuliah',
  'biaya sistem informasi',
  'rincian biaya sistem informasi'
];

(async () => {
  for (const q of queries) {
    console.log('=== QUERY ===');
    console.log(q);
    try {
      const res = await query(q, 12, { returnDebug: true });
      console.log('--- RESULT ---');
      console.log('source:', res.source);
      console.log('confidenceScore:', res.confidenceScore);
      console.log('confidenceTier:', res.confidenceTier);
      if (res.answer) {
        console.log('answer:', res.answer.replace(/\n/g, ' '));
      } else {
        console.log('answer: <null>');
      }
      console.log('debug:', JSON.stringify(res.debug || res, null, 2));
    } catch (err) {
      console.error('ERROR:', err && err.message ? err.message : err);
    }
    console.log('\n');
  }
})();
