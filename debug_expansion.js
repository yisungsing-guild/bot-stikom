const fs = require('fs');

// Load index
const indexPath = './src/data/rag_index.json';
const indexRaw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(indexRaw);

// Target trainingId
const targetTrainingId = 'd540ae42-ca48-4750-b5dd-5a1fbdbc05a0';

console.log(`\n=== ALL CHUNKS FOR trainingId: ${targetTrainingId} ===\n`);

const allChunks = index.filter(item => item && String(item.trainingId) === targetTrainingId);
console.log(`Total chunks for this trainingId: ${allChunks.length}\n`);

// Check each chunk
allChunks.forEach((chunk, idx) => {
  const chunkText = String(chunk.chunk || '').toLowerCase();
  const hasFeeSignal = /\b(biaya|rincian|no\s*jenis|pendaftaran|dpp|ukt|spp|rupiah|rp|potongan|diskon|gelombang|beasiswa|semester|almamater|kaos|tas|jas|pengalaman\s+industri)\b/.test(chunkText);
  
  const hasNumerics = /\d{1,3}\.?\d{0,3}\.?\d{0,3}|\d+/.test(chunkText);
  
  const preview = chunkText.substring(0, 100).replace(/\n/g, ' ');
  
  console.log(`[${idx}] ID: ${chunk.id}`);
  console.log(`    hasFeeSignal: ${hasFeeSignal}, hasNumerics: ${hasNumerics}`);
  console.log(`    Preview: ${preview}...`);
  
  // Show why fee signal matched (if yes)
  if (hasFeeSignal) {
    const keywords = chunkText.match(/\b(biaya|rincian|no\s*jenis|pendaftaran|dpp|ukt|spp|rupiah|rp|potongan|diskon|gelombang|beasiswa|semester|almamater|kaos|tas|jas|pengalaman\s+industri)\b/gi) || [];
    console.log(`    Keywords found: ${[...new Set(keywords)].join(', ')}`);
  }
  console.log('');
});

// Specifically check for "No. Jenis Biaya" chunk
console.log(`\n=== LOOKING FOR CHUNK WITH "No. Jenis Biaya" ===`);
const feeTableChunk = allChunks.find(c => String(c.chunk || '').includes('No. Jenis Biaya'));
if (feeTableChunk) {
  console.log(`Found: ID: ${feeTableChunk.id}`);
  console.log(`Content preview: ${String(feeTableChunk.chunk || '').substring(0, 200)}`);
  const hasFeeSignal = /\b(biaya|rincian|no\s*jenis|pendaftaran|dpp|ukt|spp|rupiah|rp|potongan|diskon|gelombang|beasiswa|semester|almamater|kaos|tas|jas|pengalaman\s+industri)\b/.test(String(feeTableChunk.chunk || '').toLowerCase());
  console.log(`Would match hasFeeSignal: ${hasFeeSignal}`);
} else {
  console.log('NOT FOUND');
}
