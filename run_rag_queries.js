const { querySemanticRag } = require('./src/engine/semanticRagEngine');

const questions = [
  'Apa itu Career Center ITB STIKOM Bali?',
  'Apa keuntungan menjadi mahasiswa ITB STIKOM Bali dari sisi karier?',
  'Apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?',
  'Apakah ada program magang?',
  'Apakah perusahaan sering datang ke kampus untuk rekrutmen?',
  'Apakah ada Job Fair di ITB STIKOM Bali?',
  'Kapan mahasiswa bisa mulai mengikuti program Career Center?',
  'Apakah mahasiswa mendapat pelatihan sebelum melamar kerja?',
  'Bagaimana peluang kerja lulusan ITB STIKOM Bali?',
  'Apakah kampus memiliki kerja sama dengan perusahaan?'
];

const callWithTimeout = (q, ms = 5000) => {
  return Promise.race([
    querySemanticRag(q),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
};

(async () => {
  for (const q of questions) {
    try {
      const res = await callWithTimeout(q, 5000);
      console.log('QUESTION:', q);
      console.log(JSON.stringify(res, null, 2));
      console.log('---');
    } catch (err) {
      console.error('ERROR for question', q, err && err.message || err);
      console.log('---');
    }
  }
  // exit explicitly
  process.exit(0);
})();
