const fs = require('fs');
const path = require('path');

// Load the RAG index to find backup PDFs
const index = JSON.parse(fs.readFileSync('data/rag_index.json', 'utf8'));

console.log('\n=== BACKUP PDF CHUNKS AUDIT ===\n');

// Find all added-from-backup chunks
const backupChunks = index.filter(c => c.id && c.id.startsWith('added-from-backup'));

console.log(`Found ${backupChunks.length} backup chunks in RAG index.\n`);

for (const chunk of backupChunks.slice(0, 3)) {
  console.log(`\n--- ${chunk.id} (${chunk.filename}) ---`);
  console.log(`\nChunk preview (first 500 chars):`);
  console.log(String(chunk.chunk || '').substring(0, 500));
  console.log('\n...\n');
  
  // Check for fee signals
  const text = String(chunk.chunk || '').toUpperCase();
  const hasBiaya = text.includes('BIAYA') || text.includes('PENDAFTARAN') || text.includes('DPP');
  const hasRp = text.includes('RP') || text.match(/[\d,\.]+/);
  console.log(`Has fee signals: ${hasBiaya ? 'YES' : 'NO'}`);
  console.log(`Has money values: ${hasRp ? 'YES' : 'NO'}`);
  
  // Check for entities
  console.log(`Academic year: ${chunk.academicYear || 'NONE'}`);
  console.log(`Program: ${chunk.program || 'NONE'}`);
  console.log(`Wave: ${chunk.wave || 'NONE'}`);
}

console.log('\n=== ACADEMIC YEAR ANALYSIS ===');
const years = new Set(backupChunks.map(c => c.academicYear).filter(Boolean));
console.log(`Academic years in backups: ${Array.from(years).join(', ')}`);
console.log(`Query year requested: 2025`);
console.log(`Mismatch: ${!years.has('2025') ? 'YES - queries ask for 2025 but PDFs have 2026' : 'NO'}`);
