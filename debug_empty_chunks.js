const fs = require('fs');

const indexPath = 'src/data/rag_index.json';
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

// Count empty text chunks
const emptyText = index.filter(c => !c.text || c.text.trim().length === 0);
const nonEmpty = index.filter(c => c.text && c.text.trim().length > 0);

console.log('=== CHUNK QUALITY ANALYSIS ===\n');
console.log(`Total chunks: ${index.length}`);
console.log(`Chunks with text: ${nonEmpty.length}`);
console.log(`Chunks with empty/undefined text: ${emptyText.length}\n`);

// Group empty chunks by category
const emptyByCategory = {};
emptyText.forEach(c => {
  const cat = c.category || 'UNKNOWN';
  emptyByCategory[cat] = (emptyByCategory[cat] || 0) + 1;
});

console.log('=== EMPTY CHUNKS BY CATEGORY ===');
Object.entries(emptyByCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`${cat}: ${count}`);
});

// List empty PROGRAM_STUDI chunks
console.log('\n=== EMPTY PROGRAM_STUDI CHUNKS ===');
const emptyProgram = emptyText.filter(c => c.category === 'PROGRAM_STUDI');
emptyProgram.forEach(c => {
  console.log(`- ${c.programName || 'UNKNOWN'} (${c.program || 'N/A'})`);
});

// Check one non-empty chunk for comparison
console.log('\n=== SAMPLE NON-EMPTY CHUNK ===');
const sample = nonEmpty.find(c => c.category === 'PENJELASAN');
if (sample) {
  console.log(`Category: ${sample.category}`);
  console.log(`Program: ${sample.program}`);
  console.log(`Text length: ${sample.text.length}`);
  console.log(`First 150 chars: ${sample.text.substring(0, 150)}`);
}
