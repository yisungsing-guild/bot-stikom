const fs = require('fs');
const rag = require('./src/engine/ragEngine');
const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('===')) {
    originalLog(...args);
  }
};
const index = JSON.parse(fs.readFileSync('./data/rag_index.json', 'utf8'));
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
const log = originalLog;
for (const q of queries) {
  const qe = rag.extractStructuredEntities(q);
  const res = rag.tryStructuredExactCostAnswer(q, qe, index, 5, Array(64).fill(0));
  log('=== QUERY ===', q);
  log('entities', qe);
  log('result source', res && res.source);
  log('debug reason', res && res.debug && res.debug.reason);
  log('answer', (res && res.answer) || 'null');
  log('feeStruct', res && res.debug && res.debug.feeStruct ? JSON.stringify(res.debug.feeStruct, null, 2) : null);
  log('---');
}
