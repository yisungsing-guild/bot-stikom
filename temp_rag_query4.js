const fs = require('fs');
const rag = require('./src/engine/ragEngine');
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
for (const q of queries) {
  const qe = rag.extractStructuredEntities(q);
  const res = rag.tryStructuredExactCostAnswer(q, qe, index, 5, Array(64).fill(0));
  console.log('=== QUERY ===', q);
  console.log('entities', qe);
  console.log('source', res && res.source);
  console.log('reason', res && res.debug && res.debug.reason);
  if (res && res.debug && Array.isArray(res.debug.topChunks)) {
    console.log('topChunks count', res.debug.topChunks.length);
    for (const c of res.debug.topChunks) {
      console.log('CHUNK', c.id, c.filename, c.updatedAt, JSON.stringify(c));
    }
  }
  if (res && Array.isArray(res.contexts)) {
    console.log('contexts length', res.contexts.length);
    for (const c of res.contexts.slice(0, 10)) {
      const trust = rag.validateSourceTrust(c);
      console.log('CONTEXT', c.id, c.filename, 'trust', trust, 'chunkPreview', String(c.chunk||'').substring(0,80).replace(/\n/g,' '));
    }
  }
  console.log('answer', res && res.answer);
  console.log('---');
}
