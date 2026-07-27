const fs = require('fs');
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

(async () => {
  if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    try {
      const res = await querySemanticRag(q, { topK: 5 });
      const out = {
        question: q,
        response: res
      };
      fs.writeFileSync(`outputs/answer-${i+1}.json`, JSON.stringify(out, null, 2), 'utf8');
      console.log('saved', `outputs/answer-${i+1}.json`);
    } catch (e) {
      fs.writeFileSync(`outputs/answer-${i+1}.json`, JSON.stringify({ question: q, error: String(e) }, null, 2), 'utf8');
      console.log('error saved', `outputs/answer-${i+1}.json`);
    }
  }
  process.exit(0);
})();
