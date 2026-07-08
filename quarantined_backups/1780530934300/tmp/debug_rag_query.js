const { query } = require('../src/engine/ragEngine');
const qs = [
  'Biaya SI sebelumnya. Pertanyaan user saat ini: apa itu SI?',
  'apa itu SI?',
  'di SI belajar apa?',
  'lulusan TI bekerja dimana?',
  'berapa uang semester SI?',
  'beasiswa KIP',
  'beasiswa 1K1S',
  'kapan gelombang berikutnya?',
  'masih buka pendaftaran?'
];
(async ()=>{
  for (const q of qs) {
    try {
      const result = await query(q, 10, { answerQuestion: q, strict: true });
      console.log('=== QUERY ===');
      console.log(q);
      console.log('source:', result.source);
      console.log('success:', result.success);
      console.log('answer:', result.answer ? result.answer.replace(/\n/g,'\\n') : 'NULL');
      console.log('contexts:', Array.isArray(result.contexts) ? result.contexts.map(c => ({id:c.id, source:c.source, score:c.score})).slice(0,3) : result.contexts);
      console.log('debug:', result.debug || '{}');
    } catch (e) {
      console.error('ERROR for', q, e.message || e);
    }
  }
})();
