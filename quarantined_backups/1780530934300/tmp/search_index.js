const fs = require('fs');
const path = require('path');
const root = process.cwd();
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
const q = '1A';
const matches = index.filter(item => String(item.chunk||'').toLowerCase().includes('gelombang 1a') || String(item.chunk||'').toLowerCase().includes('gelombang 1 a') || String(item.chunk||'').toLowerCase().includes('gelombang 1') && /si|sistem informasi/.test(String(item.chunk||'').toLowerCase()));
console.log('matches', matches.length);
for (let i=0; i<Math.min(matches.length,10); i++) {
  console.log('---');
  console.log(matches[i].filename, matches[i].chunk.slice(0,200).replace(/\n/g,' '));
}
