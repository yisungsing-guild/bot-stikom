const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'data', 'rag_index.json');
const raw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(raw);
const hobby = index.filter(item => item && item.filename && /HOBY\.pdf/i.test(item.filename) && item.chunk && item.chunk.toLowerCase().includes('ngoding') === false);
console.log('HOBY entries', hobby.length);
for (const it of hobby) {
  if (!it.chunk) continue;
  if (it.chunk.toLowerCase().includes('coding') || it.chunk.toLowerCase().includes('ngoding')) {
    console.log('--- item', it.id, it.program || it.programName || '', it.chunk.slice(0,200).replace(/\n/g,' | '));
  }
}
