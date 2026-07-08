(async () => {
  try {
    const { query } = require('../src/engine/ragEngine');
    const q = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';
    const res = await query(q, 20, { returnDebug: true, strict: false });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
