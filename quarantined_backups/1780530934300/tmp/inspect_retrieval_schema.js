const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
if (!fs.existsSync(file)) {
  console.error('NO FILE');
  process.exit(1);
}
const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
console.log('lines', lines.length);
for (let i = 0; i < 3 && i < lines.length; i += 1) {
  const obj = JSON.parse(lines[i]);
  console.log('\nENTRY', i);
  console.log(Object.keys(obj));
  console.log('question:', obj.question);
  console.log('beforeFiltering.chunks', obj.beforeFiltering?.chunks?.length);
  console.log('beforeFiltering.topk', obj.beforeFiltering?.topk);
  console.log('afterFiltering.chunks', obj.afterFiltering?.chunks?.length);
  console.log('afterFiltering.rejectedReasons', obj.afterFiltering?.rejectedReasons || obj.afterFiltering?.rejected_reasons);
}
