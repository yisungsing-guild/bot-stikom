const fs = require('fs');
const path = require('path');
const fp = path.join(__dirname, 'src', 'data', 'rag_index.json');
if (!fs.existsSync(fp)) {
  console.error('Index not found');
  process.exit(1);
}
const items = JSON.parse(fs.readFileSync(fp, 'utf8'));
const terms = ['mata kuliah', 'semester', 'kurikulum', 'sks', 'program studi', 'daftar mata kuliah'];
const hits = items.filter(item => {
  if (!item || typeof item !== 'object') return false;
  const content = String(item.chunk || '').toLowerCase();
  const program = String(item.program || '').toLowerCase();
  return program.includes('mi') && terms.some(term => content.includes(term));
});
console.log('MI curriculum-like chunks:', hits.length);
hits.slice(0, 20).forEach(item => {
  console.log('ID', item.id, 'trainingId', item.trainingId, 'filename', item.filename || item.sourceFile, 'program', item.program, 'docCategory', item.docCategory);
  console.log('  text:', String(item.chunk || '').slice(0, 200).replace(/\n/g, ' '));
});
