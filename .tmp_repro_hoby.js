const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(raw);
const hobbyNameRe = /\b(hobi|hoby)\b/i;
const strongHobbyContentRe = /\bhobi\s+(?:siswa\s+)?yang\s+memilih\b/i;
const hobbyItems = index.filter(it => it && it.chunk && ( (it.filename && hobbyNameRe.test(it.filename)) || strongHobbyContentRe.test(String(it.chunk)) ));
console.log('hobbyItems count', hobbyItems.length);
const exactHobyPdf = hobbyItems.filter(it => it && it.filename && /\bhoby\.pdf\b/i.test(String(it.filename)));
console.log('exactHobyPdf count', exactHobyPdf.length);
const byTraining = new Map();
for (const it of exactHobyPdf) {
  const tid = it.trainingId ? String(it.trainingId) : '';
  const key = tid ? `t:${tid}` : `f:${it.filename ? String(it.filename).toLowerCase() : 'unknown'}`;
  if (!byTraining.has(key)) byTraining.set(key, []);
  byTraining.get(key).push(it);
}
const groups = Array.from(byTraining.entries()).map(([key, items]) => ({ key, items, n: items.length, latest: items.reduce((acc,it)=>{const ts = it.createdAt ? Date.parse(String(it.createdAt)) : 0; return ts > acc ? ts : acc;}, 0) }));
groups.sort((a,b)=>(b.n - a.n)||(b.latest - a.latest));
console.log('groups', groups.map(g=>({key:g.key,n:g.n,latest:g.latest})))
const best = groups[0];
console.log('best key', best.key, 'n', best.n);
const combined = best.items.map(it=>String(it.chunk||'')).join('\n');
const lines = combined.split('\n').map(s=>String(s||'').replace(/\s+/g,' ').trim()).filter(Boolean);
console.log('total lines', lines.length);
for (let i=0;i<lines.length;i++){
  if (lines[i].toLowerCase().includes('coding')||lines[i].toLowerCase().includes('sistem informasi')||lines[i].toLowerCase().includes('teknologi informasi')||lines[i].toLowerCase().includes('sistem komputer')) {
    console.log(i+1, JSON.stringify(lines[i]));
  }
}
console.log('--- entire combined text ---');
console.log(combined.slice(0,2000));
