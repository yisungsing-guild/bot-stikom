const rag = require('./src/engine/ragEngine');
const index = rag.loadIndex();
const queries = [
  'berapa biaya prodi ti gelombang 2C?',
  'berapa biaya prodi si gelombang 2C?',
  'berapa biaya prodi bd gelombang 2C?',
  'berapa biaya prodi mi gelombang 2C?',
  'berapa biaya prodi sk gelombang 2C?',
  'berapa biaya prodi utb gelombang 2C?',
  'berapa biaya prodi dnui gelombang 2C?',
  'berapa biaya prodi help gelombang 2C?'
];
for (const q of queries) {
  const qe = rag.extractStructuredEntities(q);
  const res = rag.tryStructuredExactCostAnswer(q, qe, index, 5, Array(64).fill(0));
  console.log('=== QUERY ===', q);
  console.log('entities', qe);
  console.log('result source', res && res.source);
  console.log('debug reason', res && res.debug && res.debug.reason);
  console.log('answer', (res && res.answer) || 'null');
  console.log('feeStruct', res && res.debug && res.debug.feeStruct ? res.debug.feeStruct : null);
  console.log('---');
}
