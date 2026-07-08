const { query } = require('./src/engine/ragEngine');
(async () => {
  const questions = [
    'Apa saja yang dipelajari di Manajemen Informatika? Jelaskan kurikulumnya.',
    'Jelaskan apa itu program studi Manajemen Informatika di ITB STIKOM Bali',
    'Prospek kerja lulusan Manajemen Informatika di ITB STIKOM Bali seperti apa?',
    'Berapa biaya kuliah untuk program Manajemen Informatika?',
    'Apa akreditasi program Manajemen Informatika di ITB STIKOM Bali?'
  ];

  for (const q of questions) {
    console.log('QUESTION:', q);
    const res = await query(q, 8, { returnDebug: true, minScore: 0.1, strict: false, includeGlobal: true });
    console.log(JSON.stringify(res, null, 2));
    console.log('---');
  }
})();
