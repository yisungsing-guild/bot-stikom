const { query } = require('./src/engine/ragEngine');
(async () => {
  const queries = [
    'rincian biaya utb',
    'kalo biaya pendaftaran dnui berapa?\nFollow-up: kalo biaya pendaftaran help?'
  ];
  for (const q of queries) {
    try {
      const res = await query(q);
      console.log('QUERY:', q);
      console.log(JSON.stringify(res, null, 2));
    } catch (e) {
      console.error('QUERY ERR', q, e && e.stack);
    }
  }
})();
