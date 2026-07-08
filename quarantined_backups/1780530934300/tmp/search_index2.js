const fs = require('fs');
const path = require('path');
const root = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
const find = (text) => String(text||'').toLowerCase().includes('gelombang 1') || String(text||'').toLowerCase().includes('gelombang i') || String(text||'').toLowerCase().includes('1a');
const matches = index.filter(item => find(item.chunk) && String(item.chunk||'').toLowerCase().includes('sistem informasi'));
console.log('matches', matches.length);
for (let i=0; i<Math.min(matches.length,20); i++) {
  console.log('---');
  console.log(matches[i].filename);
  console.log(matches[i].chunk.slice(0,500).replace(/\n/g,' '));
}
