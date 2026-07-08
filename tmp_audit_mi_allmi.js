const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(indexPath, 'utf-8');
const index = JSON.parse(raw || '[]');
const miItems = index.filter(item => String(item.program || (item.metadata && item.metadata.program) || '').toUpperCase() === 'MI');
console.log('Total MI items:', miItems.length);
const groups = {};
for (const item of miItems) {
  const filename = item.filename || item.trainingId || 'N/A';
  const cat = item.docCategory || item.category || 'UNKNOWN';
  groups[filename] = groups[filename] || [];
  groups[filename].push({ id: item.id, category: cat, chunkPreview: String(item.chunk || '').slice(0, 200).replace(/\s+/g, ' '), containsMatkul: /mata kuliah|kurikulum|semester/i.test(String(item.chunk || '')) });
}
for (const [filename, items] of Object.entries(groups)) {
  console.log('\n===', filename, '===');
  for (const item of items) {
    console.log('id:', item.id, 'category:', item.category, 'matkul?', item.containsMatkul, 'preview:', item.chunkPreview);
  }
}
