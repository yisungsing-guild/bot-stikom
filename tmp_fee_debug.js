const { query } = require('./src/engine/ragEngine');

(async () => {
  const questions = ['berapa biaya MI', 'berapa biaya DNUI', 'berapa biaya HELP', 'berapa biaya UTB'];
  for (const q of questions) {
    try {
      const r = await query(q, 5, null);
      console.log('---', q, '---');
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error('ERROR', q, e && e.stack ? e.stack : e);
    }
  }
})();
