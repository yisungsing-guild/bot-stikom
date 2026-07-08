const fs = require('fs');
const path = require('path');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'rag_index.json'), 'utf8'));
const grouped = {};
for (const item of idx) {
  const programField = ((item.metadata && item.metadata.program) || item.program || '').toString();
  if (/manajemen informasi|manajemen informatika|\bmi\b/i.test(programField)) {
    const fn = item.filename || item.file || item.trainingId || 'unknown';
    grouped[fn] = (grouped[fn] || 0) + 1;
  }
}
Object.entries(grouped).sort((a,b)=>b[1]-a[1]).forEach(([fn,count])=>console.log(`${count}\t${fn}`));
