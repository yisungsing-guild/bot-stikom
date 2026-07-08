const fs = require('fs');
const path = require('path');
const root = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
const hits = index.filter(item => {
  const text = String(item.chunk || '').toLowerCase();
  return text.includes('gelombang') && text.includes('potongan') && (text.includes('sistem informasi') || text.includes('si') || text.includes('informasi'));
});
console.log('hits', hits.length);
for (let i=0;i<Math.min(hits.length,20);i++) {
  console.log('---', hits[i].filename, hits[i].chunk.slice(0,300).replace(/\n/g,' '));
}
