const fs = require('fs');
const raw = fs.readFileSync('src/data/rag_index.json', 'utf8');
const data = JSON.parse(raw);
const lower = (s) => (s||'').toLowerCase();

const matches = data.filter(item => item && item.chunk && /prodi\s*si|sistem\s*informasi|program\s*studi\s*sistem\s*informasi/i.test(item.chunk));
console.log('matches', matches.length);
for (let i = 0; i < Math.min(20, matches.length); i++) {
  const item = matches[i];
  console.log('---', i, item.id, item.trainingId, item.filename);
  console.log(String(item.chunk).slice(0, 400).replace(/\n/g,' '));
}
