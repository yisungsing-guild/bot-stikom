const fs = require('fs');
const data = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));

const siChunks = data.filter(d => 
  (d.chunk && d.chunk.toUpperCase().includes('SISTEM INFORMASI')) ||
  (d.metadata && d.metadata.program && d.metadata.program.toUpperCase().includes('SI'))
);

console.log('Total chunks mentioning Sistem Informasi:', siChunks.length);
console.log('\nFirst 5 SI chunks:');

siChunks.slice(0, 5).forEach((chunk, i) => {
  console.log(`\n=== Chunk ${i+1} ===`);
  console.log('Chunk preview:', chunk.chunk.substring(0, 250));
  console.log('Metadata:', chunk.metadata);
});

console.log('\n\nChecking trainedOn programs:');
const programs = new Set();
data.forEach(d => {
  if (d.metadata && d.metadata.program) {
    programs.add(d.metadata.program);
  }
});
console.log('Programs in index:', Array.from(programs));
