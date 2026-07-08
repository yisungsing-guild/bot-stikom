const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'), 'utf8'));
const tid = '2580a44c-dffa-4ccc-88b3-6dcf4c7b42ae';
const chunks = data.filter(item => item.trainingId === tid).map(item => String(item.chunk || '')).filter(Boolean);
const combined = chunks.join('\n');
const text = combined.replace(/\s+/g,' ');
const regex = /(?:biaya pendidikan per semester|ukt|uang kuliah tunggal|biaya semester)[^\n]{0,80}?([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]{6,})/i;
const m = regex.exec(text);
console.log('match', m && m[0]);
console.log('amount', m && m[1]);
console.log('index', m && m.index);
if (m) {
  console.log('context', text.slice(Math.max(0,m.index-80), Math.min(text.length, m.index+100)));
}
