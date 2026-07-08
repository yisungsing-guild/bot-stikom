const rag = require('./src/engine/ragEngine');

async function run() {
  const q = 'Hobi saya suka ngoding cocok jurusan apa?';
  try {
    const res = await rag.tryStructuredProgramRecommendationAnswer(q);
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('ERR', e && e.message, e && e.stack);
  }
}

run();
