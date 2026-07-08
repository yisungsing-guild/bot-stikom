const fs = require('fs');
const path = require('path');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'rag_index.json'), 'utf8'));
const mi = idx.filter(item => {
  const programField = ((item.metadata && item.metadata.program) || item.program || '').toString();
  return /manajemen informasi|manajemen informatika|\bmi\b/i.test(programField);
});
console.log('MI rows', mi.length);
mi.forEach((item, index) => {
  console.log('---');
  console.log('index', index + 1);
  console.log('id', item.id || item.chunkId || item.trainingId || item.filename || 'unknown');
  console.log('filename', item.filename || item.file || item.trainingId || 'unknown');
  console.log('docCategory', item.docCategory || item.category || 'UNKNOWN');
  console.log('program', ((item.metadata && item.metadata.program) || item.program || '').toString());
  console.log('sectionTitle', item.sectionTitle || '');
  console.log('chunkPreview', (item.chunk || '').slice(0, 400).replace(/\n/g, ' '));
});
