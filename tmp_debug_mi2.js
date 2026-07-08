const fs = require('fs');
const path = require('path');
const INDEX_PATH = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(INDEX_PATH, 'utf8');
const index = JSON.parse(raw);
const targetTid = 'd540ae42-ca48-4750-b5dd-5a1fbdbc05a0';
const items = index.filter(i => i && i.trainingId === targetTid);
console.log('count', items.length);
for (const it of items) {
  console.log('---');
  console.log('filename', it.filename, 'programName', it.programName, 'program', it.program, 'partner', it.partner, 'campus', it.campus, 'wave', it.wave, 'docCategory', it.docCategory);
  console.log('chunk preview', String(it.chunk || '').slice(0, 200));
}
