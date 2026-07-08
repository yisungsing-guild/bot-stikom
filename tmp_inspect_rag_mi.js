const fs = require('fs');
const path = require('path');
const fp = path.join(__dirname, 'src', 'data', 'rag_index.json');
if (!fs.existsSync(fp)) {
  console.error('Index not found:', fp);
  process.exit(1);
}
const items = JSON.parse(fs.readFileSync(fp, 'utf8'));
const found = items.filter(item => {
  if (!item || typeof item !== 'object') return false;
  const program = String(item.program || '').toLowerCase();
  const content = String(item.chunk || '').toLowerCase();
  const filename = String(item.filename || '').toLowerCase();
  const sourceFile = String(item.sourceFile || '').toLowerCase();
  return program.includes('manajemen informatika') || content.includes('manajemen informatika') || filename.includes('manajemen') || sourceFile.includes('manajemen') || filename.includes('mi') || sourceFile.includes('mi');
});
console.log('MI-like chunks:', found.length);
const meta = new Map();
for (const item of found) {
  const key = `${item.trainingId || '?'} | ${item.filename || item.sourceFile || 'unknown'}`;
  if (!meta.has(key)) meta.set(key, []);
  meta.get(key).push(item);
}
for (const [k, v] of meta.entries()) {
  console.log('SOURCE:', k, 'count:', v.length, 'programs:', [...new Set(v.map(i => i.program).filter(Boolean))].slice(0, 5).join(' | '));
  for (const item of v.slice(0, 2)) {
    console.log('  - filename:', item.filename || item.sourceFile || 'none', 'source:', item.source, 'divisionKey:', item.divisionKey, 'docCategory:', item.docCategory, 'chunkType:', item.chunkType);
    console.log('    chunk preview:', String(item.chunk || '').slice(0, 120).replace(/\n/g, ' '));
  }
}
