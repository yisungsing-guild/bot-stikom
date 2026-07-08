const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'), 'utf8');
const idx = raw.indexOf('213225');
console.log('idx', idx);
if (idx >= 0) {
  const start = Math.max(0, idx - 500);
  const end = Math.min(raw.length, idx + 500);
  console.log(raw.slice(start, end));
}
const data = JSON.parse(raw);
const entries = data.filter((item) => String(item.chunk || '').includes('213225'));
console.log('entries', entries.length);
entries.forEach((item, i) => {
  console.log('---', i, item.id, item.filename, item.chunkType, item.sectionTitle, item.trainingId);
  console.log(item.chunk.slice(0, 1200));
});
