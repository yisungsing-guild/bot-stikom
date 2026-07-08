(async ()=>{
  const engine = require('./src/engine/ragEngine');
  const queries = [
    'berapa biaya TI gelombang 2C',
    'berapa biaya SI gelombang 2C',
    'berapa biaya MM gelombang 2C',
    'berapa biaya SK gelombang 1A'
  ];
  const results = [];
  for (const q of queries) {
    try {
      const res = await engine.query(q, null, {});
      results.push({ query: q, result: res });
    } catch (e) {
      results.push({ query: q, error: String(e && e.stack ? e.stack : e) });
    }
  }
  const fs = require('fs');
  fs.writeFileSync('run_queries_results.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('WROTE run_queries_results.json');
})();
