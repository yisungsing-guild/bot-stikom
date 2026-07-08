const rag = require('./src/engine/ragEngine');
const fs = require('fs');

// Load index dan cari chunk MI
const data = JSON.parse(fs.readFileSync('src/data/rag_index.json', 'utf8'));
const miChunk = data.find(d => d.chunk && d.chunk.includes('Manajemen Informatika'));

if (miChunk) {
  console.log('=== CHUNK DITEMUKAN ===');
  console.log('ID:', miChunk.id);
  console.log('Program:', miChunk.program);
  console.log('Chunk preview:', miChunk.chunk.substring(0, 400));
  
  // Test chunkHasRequestedProgram
  console.log('\n=== TEST PATTERN MATCHING ===');
  
  // Simulate calling chunkHasRequestedProgram
  const text = miChunk.chunk.toLowerCase();
  
  console.log('Testing SI pattern:');
  console.log('  Text contains "sistem informasi"?', text.includes('sistem informasi'));
  console.log('  Text contains "Manajemen Informatika"?', text.includes('manajemen informatika'));
  
  // Updated patterns from new code
  const siFullName = /(?:program\s+studi\s+)?sistem\s+informasi(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i;
  const miFullName = /(?:program\s+studi\s+)?manajemen\s+informatika(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i;
  
  console.log('\n  SI fullName pattern match?', siFullName.test(text));
  console.log('  MI fullName pattern match?', miFullName.test(text));
  
  // Debug: test simpler pattern
  const simpleMI = /manajemen\s+informatika/i;
  console.log('\n  Simple MI pattern (no groups)?', simpleMI.test(text));
  
  // Show exact match context
  const match = text.match(/program\s+studi\s+manajemen\s+informatika[^,]*/i);
  if (match) {
    console.log('\n  Found context:', match[0]);
  }
  
  console.log('\nFull chunk text:');
  console.log(miChunk.chunk);
}
