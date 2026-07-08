const fs = require('fs');
const path = require('path');
const qlog = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
const logs = fs.existsSync(qlog) ? fs.readFileSync(qlog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
for (const log of logs) {
  const catcount = {};
  log.beforeFiltering.chunks.slice(0, 20).forEach(c => {
    catcount[c.docCategory] = (catcount[c.docCategory] || 0) + 1;
  });
  console.log('QUERY:', log.question);
  console.log('category counts top20:', JSON.stringify(catcount));
  console.log('top20 docs:');
  log.beforeFiltering.chunks.slice(0, 20).forEach((c, i) => {
    console.log(`  ${i + 1}: ${c.docCategory} | ${c.filename || 'unknown'} | ${c.preview}`);
  });
  console.log('');
}
