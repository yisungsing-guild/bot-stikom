const fs = require('fs');

const indexPath = 'src/data/rag_index.json';
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

// Find the SI chunk
const siChunk = index.find(c => c && c.programName === 'SISTEM INFORMASI');

if (siChunk) {
  console.log('=== SISTEM INFORMASI CHUNK ===\n');
  console.log('Program:', siChunk.program);
  console.log('ProgramName:', siChunk.programName);
  console.log('Category:', siChunk.category);
  console.log('ChunkId:', siChunk.id);
  console.log('\n--- FULL TEXT ---');
  console.log(siChunk.text);
  console.log('\n--- TEXT LENGTH ---');
  console.log('Length:', (siChunk.text || '').length);
} else {
  console.log('SI chunk not found');
}

// Also check MI chunk for comparison
const miChunk = index.find(c => c && c.programName === 'MANAJEMEN INFORMATIKA');

if (miChunk) {
  console.log('\n\n=== MANAJEMEN INFORMATIKA CHUNK (for comparison) ===\n');
  console.log('Program:', miChunk.program);
  console.log('ProgramName:', miChunk.programName);
  console.log('Category:', miChunk.category);
  console.log('ChunkId:', miChunk.id);
  console.log('\n--- FIRST 300 CHARS ---');
  if (miChunk.text) {
    console.log(miChunk.text.substring(0, 300));
  } else {
    console.log('(empty text)');
  }
  console.log('\n--- TEXT LENGTH ---');
  console.log('Length:', (miChunk.text || '').length);
} else {
  console.log('\nMI chunk not found');
}
