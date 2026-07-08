const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'data', 'rag_index.json');
const raw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(raw);
const hobby = index.filter(item => item && item.filename && /HOBY\.pdf/i.test(item.filename));
console.log('HOBY entries', hobby.length);
for (const it of hobby) {
  if (!it.chunk) continue;
  const chunk = it.chunk.replace(/\n/g,' | ');
  if (chunk.toLowerCase().includes('sistem informasi') || chunk.toLowerCase().includes('tekno') || chunk.toLowerCase().includes('sistem komputer') || chunk.toLowerCase().includes('coding') || chunk.toLowerCase().includes('ngoding') || chunk.toLowerCase().includes('program')) {
    console.log('--- item', it.id, it.program || it.programName || '', chunk.slice(0,200));
  }
}
