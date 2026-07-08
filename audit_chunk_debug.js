const fs = require('fs');
const path = 'data/rag_index.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const backups = data.filter(item => item.id && item.id.includes('added-from-backup'));
console.log('backup count=', backups.length);
backups.forEach(b => {
  console.log('---');
  console.log('id=', b.id);
  console.log('filename=', b.filename);
  console.log('academicYear=', b.academicYear);
  console.log('program=', b.program);
  console.log('wave=', b.wave);
  console.log('partner=', b.partner);
  console.log('chunk=', b.chunk ? b.chunk.slice(0, 400).replace(/\n/g, ' ') : '');
});
