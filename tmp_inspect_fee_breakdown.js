const { tryStructuredFeeBreakdownAnswer, query } = require('./src/engine/ragEngine');
(async () => {
  const q = 'biaya lengkap prodi si ada apa saja?';
  const direct = tryStructuredFeeBreakdownAnswer(q, null, {});
  console.log('DIRECT', JSON.stringify(direct, null, 2));
  const res = await query(q, 5, { includeGlobal: true });
  console.log('QUERY', JSON.stringify({ source: res && res.source, answer: String(res && res.answer || '').slice(0, 1800) }, null, 2));
})();
