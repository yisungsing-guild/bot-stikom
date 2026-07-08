const fs = require('fs');
console.log = () => {};
console.warn = () => {};
console.error = () => {};
console.info = () => {};
console.debug = () => {};

const { query } = require('./src/engine/ragEngine');
(async () => {
  const questions = ['berapa biaya MI', 'berapa biaya DNUI', 'berapa biaya HELP', 'berapa biaya UTB'];
  const results = [];
  for (const q of questions) {
    try {
      const r = await query(q, 5, null);
      results.push({ question: q, result: r });
    } catch (e) {
      results.push({ question: q, error: e && e.stack ? e.stack : String(e) });
    }
  }
  fs.writeFileSync('tmp_fee_debug_results.json', JSON.stringify(results, null, 2), 'utf8');
  process.stdout.write('DONE');
})();
