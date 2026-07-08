const { findReplyByRules } = require('./src/engine/replyEngine');
(async () => {
  const tests = [
    'biaya prodi ti gelombang 2a',
    'biaya ti gelombang 2B',
    'jadwal gelombang 2C',
    'gelombang 2C',
    '2C',
    'potongan gelombang 2a',
    'biaya gelombang 2a tanpa potongan'
  ];
  for (const t of tests) {
    try {
      console.log('---');
      console.log('text:', t);
      const r = await findReplyByRules(t, { includeFallback: true });
      console.log('reply:', r);
    } catch (e) {
      console.error('error for', t, e && e.message ? e.message : e);
    }
  }
})();
