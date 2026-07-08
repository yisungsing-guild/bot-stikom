const fs = require('fs');
const path = require('path');
const qfile = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
const dfile = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
if (!fs.existsSync(qfile) || !fs.existsSync(dfile)) {
  console.error('missing file');
  process.exit(1);
}
const qlines = fs.readFileSync(qfile, 'utf8').trim().split('\n').filter(Boolean);
const queries = qlines.map(l => JSON.parse(l)).map(o => ({
  question: o.question,
  timestamp: new Date(o.timestamp).getTime(),
  detectedIntent: o.detectedIntent,
  before: o.beforeFiltering?.chunks?.length || 0,
  after: o.afterFiltering?.count || 0,
  stats: o.filteringStats || {}
}));
queries.sort((a, b) => a.timestamp - b.timestamp);
const dlines = fs.readFileSync(dfile, 'utf8').trim().split('\n').filter(Boolean);
const decisions = dlines.map(l => JSON.parse(l)).map(o => ({
  ts: new Date(o.timestamp).getTime(),
  intent: o.intent,
  reason: o.reason,
  category: o.docCategory,
  file: o.sourceFile,
  chunkId: o.chunkId
}));
for (let i = 0; i < queries.length; i += 1) {
  const q = queries[i];
  const nextStart = i + 1 < queries.length ? queries[i + 1].timestamp : Infinity;
  const slice = decisions.filter(d => d.ts >= q.timestamp && d.ts < nextStart);
  const counts = {};
  for (const d of slice) {
    counts[d.reason] = (counts[d.reason] || 0) + 1;
  }
  console.log('QUERY:', q.question);
  console.log(' intent:', q.detectedIntent);
  console.log(' beforeFiltering:', q.before);
  console.log(' afterFiltering:', q.after);
  console.log(' reasonCounts:', JSON.stringify(counts, null, 2));
  console.log(' total decisions:', slice.length);
  console.log('');
}
