const fs = require('fs');
const path = require('path');
const index = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'), 'utf8'));
const hobbyNameRe = /\b(hobi|hoby)\b/i;
const strongHobbyContentRe = /\bhobi\s+(?:siswa\s+)?yang\s+memilih\b/i;
const hobbyItems = index.filter(it => it && it.chunk && ((it.filename && hobbyNameRe.test(it.filename)) || strongHobbyContentRe.test(String(it.chunk))));
const exactHobyPdf = hobbyItems.filter(it => it && it.filename && /\bhoby\.pdf\b/i.test(String(it.filename)));
const byTraining = new Map();
for (const it of exactHobyPdf) {
  const tid = it.trainingId ? String(it.trainingId) : '';
  const key = tid ? `t:${tid}` : `f:${it.filename ? String(it.filename).toLowerCase() : 'unknown'}`;
  if (!byTraining.has(key)) byTraining.set(key, []);
  byTraining.get(key).push(it);
}
const best = Array.from(byTraining.values()).sort((a,b)=>(b.length-a.length))[0];
const combined = best.map(it => String(it.chunk || '')).join('\n');
const lines = combined.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/Teknologi Informasi|Sistem Komputer|Coding|ngoding|coding|TI|SK/i.test(line)) {
    console.log(`${i+1}: ${line}`);
  }
}
