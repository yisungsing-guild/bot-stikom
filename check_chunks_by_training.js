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

console.log(`\n=== CHUNKS FROM TRAININGID: ${trainingId} ===`);
console.log(`Total chunks: ${chunks.length}\n`);

// Show summary of each chunk
chunks.forEach((chunk, idx) => {
  const preview = String(chunk.chunk || '').substring(0, 150).replace(/\n/g, ' ');
  const isDiscount = preview.toLowerCase().includes('gelombang') || preview.toLowerCase().includes('potongan') || preview.toLowerCase().includes('diskon');
  const isFeeTable = preview.toLowerCase().includes('jenis biaya') || preview.toLowerCase().includes('pendaftaran') || preview.toLowerCase().includes('dpp') || preview.toLowerCase().includes('biaya');
  
  console.log(`[${idx}] ID: ${chunk.id.substring(0, 8)}`);
  console.log(`    Program: ${chunk.programName || getProgram(chunk.chunk) || 'null'}`);
  console.log(`    Wave: ${chunk.wave || 'null'}`);
  console.log(`    Type: discount=${isDiscount}, feeTable=${isFeeTable}`);
  console.log(`    Preview: ${preview}...`);
  console.log();
});

function getProgram(text) {
  if (!text) return null;
  if (/program\s+studi\s+teknologi\s+informasi|teknologi\s+informasi/i.test(text)) return 'TI';
  if (/program\s+studi\s+sistem\s+informasi|sistem\s+informasi/i.test(text)) return 'SI';
  if (/program\s+studi\s+bisnis\s+digital|bisnis\s+digital/i.test(text)) return 'BD';
  return null;
}
