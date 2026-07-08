const fs = require('fs');

const indexPath = 'src/data/rag_index.json';
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

// More lenient search
const siChunks = index.filter(chunk => {
  if (!chunk || !chunk.text) return false;
  const text = (chunk.text + ' ' + (chunk.programName || '')).toLowerCase();
  return text.includes('sistem informasi') || text.includes('si') || text.includes('sistem');
});

console.log('=== LENIENT SI SEARCH ===');
console.log(`Chunks with "sistem informasi", "si", or "sistem": ${siChunks.length}\n`);

// Group by programName
const byProgram = {};
index.forEach(c => {
  const prog = c.programName || 'UNKNOWN';
  byProgram[prog] = (byProgram[prog] || 0) + 1;
});

console.log('=== CHUNKS BY PROGRAM NAME ===');
Object.entries(byProgram).forEach(([prog, count]) => {
  console.log(`${prog}: ${count}`);
});

// Sample chunks to see structure
console.log('\n=== SAMPLE CHUNKS ===');
index.slice(0, 2).forEach((c, idx) => {
  console.log(`\nChunk ${idx}`);
  console.log(`  program: ${c.program}`);
  console.log(`  programName: ${c.programName}`);
  console.log(`  category: ${c.category}`);
  console.log(`  text: ${(c.text || '').substring(0, 100)}`);
});
