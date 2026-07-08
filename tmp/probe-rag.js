const path = require('path');
const { query } = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine'));
(async () => {
  const questions = ['apa itu pmb','apa itu TI','halo','rincian biaya MI gelombang 2A','biaya TI','cara daftar'];
  for (const q of questions) {
    const r = await query(q);
    console.log('Q:', q);
    console.log(JSON.stringify({ success: !!(r && r.success), source: r && r.source, answer: r && r.answer ? String(r.answer).slice(0, 240) : null }, null, 2));
  }
})();
