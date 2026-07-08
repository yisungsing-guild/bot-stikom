const path = require('path');
const { query } = require('../src/engine/ragEngine');

const queries = [
  'program studi teknologi informasi belajar apa saja?',
  'lulusan TI bisa kerja sebagai apa?',
  'apa itu TI?',
  'kalau suka ngoding cocok TI atau SI?',
  'kalo program studi teknologi informasi itu belajar apa saja, dan nanti bisa bekerja di bidang apa saja?'
];

(async () => {
  for (const q of queries) {
    console.log('\n=== QUERY ===');
    console.log(q);
    try {
      const result = await query(q, 6, {
        answerQuestion: q,
        strict: true,
        returnDebug: true
      });
      console.log('source:', result.source);
      console.log('success:', result.success);
      console.log('confidenceTier:', result.confidenceTier);
      console.log('final answer:');
      console.log(result.answer);
      console.log('\nfinal context sources:');
      if (Array.isArray(result.contexts)) {
        result.contexts.forEach((c, idx) => {
          const name = c.filename || c.trainingId || c.id || '<unknown>';
          console.log(`${idx + 1}. ${name} (score=${c.score})`);
        });
      }
    } catch (e) {
      console.error('ERROR:', e && e.message ? e.message : e);
    }
  }
})();
