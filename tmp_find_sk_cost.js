const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'), 'utf8'));
const costPatterns = [
  /biaya\s+pendidikan\s+per\s+semester/i,
  /ukt\b/i,
  /uang\s+kuliah\s+tunggal/i,
  /biaya\s+semester/i,
  /biaya\s+pendidikan/i
];
const textPatterns = [
  /sistem\s+komputer/i,
  /sistem komputer/i
];
let results = [];
for (const item of data) {
  if (!item || typeof item.chunk !== 'string') continue;
  const chunk = item.chunk;
  const lower = chunk.toLowerCase();
  if (textPatterns.some(re => re.test(lower)) && costPatterns.some(re => re.test(lower))) {
    results.push({
      id: item.id || null,
      filename: item.filename || item.sourceFile || null,
      chunk: chunk
    });
    if (results.length >= 10) break;
  }
}
console.log('found', results.length);
for (const r of results) {
  console.log('---', r.filename, r.id);
  const chunk = r.chunk.replace(/\n/g, ' ');
  let idx = chunk.toLowerCase().indexOf('sistem komputer');
  if (idx < 0) idx = 0;
  const excerpt = chunk.slice(Math.max(0, idx - 200), Math.min(chunk.length, idx + 1200));
  console.log(excerpt);
  console.log('');
}
