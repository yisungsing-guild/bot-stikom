const fs = require('fs');
const path = require('path');

// Load index
const indexPath = path.join(__dirname, 'src/data/rag_index.json');
const indexData = fs.readFileSync(indexPath, 'utf-8');
const index = JSON.parse(indexData);

// Find trainingId for SI,TI,BD file
const trainingId = 'd540ae42-ca48-4750-b5dd-5a1fbdbc05a0';

// Filter chunks from this trainingId
const chunks = index.filter(item => item.trainingId === trainingId);

// Show full content of chunks [4] and [22]
console.log('=== CHUNK [4] - CORRECT FEE TABLE ===\n');
console.log(chunks[4].chunk.substring(0, 500));
console.log('\n...truncated\n');

console.log('\n=== CHUNK [22] - WRONG (CURRENTLY SELECTED) ===\n');
console.log(chunks[22].chunk.substring(0, 500));
console.log('\n...truncated\n');

// Check if they're marked as global discount
function isGlobalWaveDiscountChunk(chunk) {
  const text = String(chunk || '').toLowerCase();
  return (
    /potongan/.test(text) &&
    /(dpp|pendaftaran)/.test(text) &&
    /gelombang/.test(text)
  );
}

console.log('\nChunk [4] isGlobalDiscount:', isGlobalWaveDiscountChunk(chunks[4].chunk));
console.log('Chunk [22] isGlobalDiscount:', isGlobalWaveDiscountChunk(chunks[22].chunk));
