const fs = require('fs');
const path = require('path');
const qlog = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
const flog = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
const logs = fs.readFileSync(qlog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
for (const log of logs) {
  console.log('=== QUERY ===');
  console.log('question:', log.question);
  console.log('detectedIntent:', log.detectedIntent);
  console.log('beforeFiltering count', log.beforeFiltering.count);
  console.log('afterFiltering count', log.afterFiltering.count);
  console.log('top before:');
  log.beforeFiltering.chunks.slice(0, 5).forEach(c => console.log(`  ${c.rank} ${c.filename || 'n/a'} ${c.docCategory} score=${c.score.toFixed(4)} composite=${c.compositeScore.toFixed(1)} preview=${c.preview.slice(0, 90).replace(/\n/g, ' ')}`));
  console.log('top after:');
  log.afterFiltering.chunks.slice(0, 5).forEach(c => console.log(`  ${c.rank} ${c.filename || 'n/a'} ${c.docCategory} score=${c.score.toFixed(4)} composite=${c.compositeScore.toFixed(1)} preview=${c.preview.slice(0, 90).replace(/\n/g, ' ')}`));
  console.log('');
}
const decisions = fs.existsSync(flog) ? fs.readFileSync(flog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
console.log('decisions count', decisions.length);
for (const log of logs) {
  console.log('--- decision sample for query:', log.question);
  const q = log.question.toLowerCase();
  const decisionsForQuery = decisions.filter(d => String(d.intent).toLowerCase() === String(log.detectedIntent).toLowerCase());
  console.log('  total relevant decisions for intent', decisionsForQuery.length);
  decisionsForQuery.slice(0, 8).forEach(d => console.log(`    ${d.chunkId} ${d.sourceFile} ${d.docCategory} ${d.reason}`));
}
