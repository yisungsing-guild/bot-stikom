const fs = require('fs');

// Load the RAG index directly
const indexPath = 'src/data/rag_index.json';
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

// Find SI chunks
const siChunks = index.filter(chunk => {
  if (!chunk || !chunk.text) return false;
  const text = chunk.text.toLowerCase();
  
  // Check multiple patterns
  const hasSystemInformasi = /sistem\s+informasi/i.test(text);
  const hasProgram = /program\s+studi\s+sistem\s+informasi/i.test(text);
  const siCode = chunk.programName && chunk.programName.toUpperCase().includes('SI');
  
  return hasSystemInformasi || hasProgram || siCode;
});

console.log('=== SI CHUNKS ANALYSIS ===\n');
console.log(`Total SI chunks found: ${siChunks.length}\n`);

siChunks.slice(0, 3).forEach((chunk, idx) => {
  console.log(`--- SI Chunk ${idx + 1} ---`);
  console.log(`Program: ${chunk.program || 'N/A'}`);
  console.log(`ProgramName: ${chunk.programName || 'N/A'}`);
  console.log(`Category: ${chunk.category || 'N/A'}`);
  console.log(`Text preview: ${chunk.text.substring(0, 150)}...`);
  console.log('');
});

// Check pattern matching for SI
console.log('=== SI PATTERN MATCHING TEST ===\n');

function chunkHasRequestedProgram(item, requestedProgram) {
  if (!requestedProgram) return false;
  
  const program = String(requestedProgram).toUpperCase();
  const text = (item.text || '').toLowerCase();
  
  const patterns = {
    'SI': /(?:program\s+studi\s+)?sistem\s+informasi(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i,
    'MI': /(?:program\s+studi\s+)?manajemen\s+informatika(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i,
    'TI': /(?:program\s+studi\s+)?teknologi\s+informasi(?:\s+[|,\n]|$|(?=\s+\|)|(?=\s*,)|(?=\s*\n))/i,
  };
  
  const pattern = patterns[program];
  if (!pattern) return false;
  
  return pattern.test(text);
}

siChunks.slice(0, 3).forEach((chunk, idx) => {
  const matches = chunkHasRequestedProgram(chunk, 'SI');
  console.log(`SI Chunk ${idx + 1} matches SI pattern: ${matches}`);
  
  if (!matches) {
    const text = chunk.text.substring(0, 200);
    console.log(`  Text: ${text}`);
  }
  console.log('');
});
