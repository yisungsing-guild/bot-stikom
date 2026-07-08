/**
 * AUDIT TASK 1.5: FIND MI CHUNKS IN CURRENT INDEX
 * 
 * Look for chunks that might be about MI even if program field is missing
 */

const fs = require('fs');
const path = require('path');

const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

console.log('='.repeat(80));
console.log('AUDIT: FIND MI CHUNKS');
console.log('='.repeat(80));
console.log();

// Search for MI in different fields
const miChunks = index.filter(c => {
  const text = (c.chunk || '').toLowerCase();
  const fname = (c.filename || '').toLowerCase();
  const cat = (c.category || '').toLowerCase();
  
  return (
    c.program === 'MI' ||
    text.includes('manajemen informatika') ||
    text.includes('manajemen informasi') ||
    text.includes(' mi ') ||
    fname.includes('mi') ||
    fname.includes('informatika') ||
    fname.includes('informasi')
  );
});

console.log(`Found ${miChunks.length} chunks that mention MI\n`);

// Group by program value
const byProgram = {};
miChunks.forEach(c => {
  const prog = c.program || 'MISSING';
  if (!byProgram[prog]) byProgram[prog] = [];
  byProgram[prog].push(c);
});

console.log('By program field:');
Object.entries(byProgram).forEach(([prog, chunks]) => {
  console.log(`  ${prog}: ${chunks.length} chunks`);
});

console.log();
console.log('MI Chunks detail:');
console.log('-'.repeat(80));

miChunks.slice(0, 20).forEach((chunk, idx) => {
  console.log(`\n[${idx + 1}] ID: ${chunk.id}`);
  console.log(`    Program: ${chunk.program || 'MISSING'}`);
  console.log(`    Category: ${chunk.category || 'MISSING'}`);
  console.log(`    Filename: ${chunk.filename || 'MISSING'}`);
  const preview = (chunk.chunk || '').substring(0, 200).replace(/\n/g, ' ');
  console.log(`    Preview: "${preview}..."`);
});

console.log();
console.log('='.repeat(80));
console.log('ANALYSIS');
console.log('='.repeat(80));
console.log();

// Check all unique filenames that mention MI
const miFilenames = new Set();
miChunks.forEach(c => {
  if (c.filename && (c.filename.toLowerCase().includes('mi') || c.filename.toLowerCase().includes('manajemen'))) {
    miFilenames.add(c.filename);
  }
});

if (miFilenames.size > 0) {
  console.log('Source files that mention MI:');
  Array.from(miFilenames).forEach(fname => {
    const count = miChunks.filter(c => c.filename === fname).length;
    console.log(`  - ${fname} (${count} chunks)`);
  });
} else {
  console.log('No source files mention MI in filename');
}

console.log();
console.log('Next step: Check if there are documents in TrainingData table that contain MI');
