const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(raw);
const hobby = index.filter(item => item && item.filename && /HOBY\.pdf/i.test(item.filename));
console.log('HOBY entries', hobby.length);
for (const it of hobby) {
  if (!it.chunk) continue;
  const chunk = it.chunk.replace(/\n/g,' | ');
  console.log('--- item', it.id, (it.program||''), (it.filename||''), chunk.slice(0,240));
}
