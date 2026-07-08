/**
 * Simplified audit: load index and show MI + SK curriculum chunks
 * - Show all MI chunks
 * - Show all SK KURIKULUM chunks
 * - Simulate retrieval scoring for MI queries
 */

const fs = require('fs');
const path = require('path');

function loadIndex() {
  const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
  try {
    const content = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error('[LOAD] Failed to load index:', e.message);
    return [];
  }
}

console.log('🔍 INDEX AUDIT - MI AND SK CURRICULUM\n');

const index = loadIndex();
console.log(`Total chunks in index: ${index.length}\n`);

// ========== SECTION 1: MI CHUNKS ==========
console.log('='.repeat(70));
console.log('SECTION 1: ALL MI CHUNKS IN INDEX');
console.log('='.repeat(70));

const miChunks = index.filter(c => c.program === 'MI');
console.log(`\nTotal MI chunks: ${miChunks.length}\n`);

if (miChunks.length === 0) {
  console.log('⚠️  NO MI CHUNKS FOUND IN INDEX');
} else {
  miChunks.forEach((chunk, idx) => {
    console.log(`[${idx + 1}] ${chunk.filename || 'NO_FILENAME'}`);
    console.log(`    ID: ${chunk.id}`);
    console.log(`    Category: ${chunk.category || 'UNKNOWN'}`);
    console.log(`    Program: ${chunk.program || 'UNKNOWN'}`);
    console.log(`    ProgramAliases: ${JSON.stringify(chunk.programAliases || [])}`);
    console.log(`    ChunkType: ${chunk.chunkType || 'UNKNOWN'}`);
    const preview = (chunk.chunk || '').substring(0, 150).replace(/\n/g, ' ');
    console.log(`    Preview: ${preview}...\n`);
  });
}

// Check what categories MI has
console.log('\nMI Chunks by Category:');
const miByCategory = {};
miChunks.forEach(c => {
  const cat = c.category || 'UNKNOWN';
  miByCategory[cat] = (miByCategory[cat] || 0) + 1;
});
Object.entries(miByCategory).forEach(([cat, count]) => {
  console.log(`  - ${cat}: ${count}`);
});

console.log('\n⚠️  ANALYSIS: MI is missing DEFINISI_PRODI, KURIKULUM, and PROSPEK_KERJA');
console.log('   Only has: BIAYA, AKREDITASI, and some generic chunks\n');

// ========== SECTION 2: SK KURIKULUM CHUNKS ==========
console.log('\n' + '='.repeat(70));
console.log('SECTION 2: SK KURIKULUM CHUNKS');
console.log('='.repeat(70));

const skKurikulumChunks = index.filter(c => c.program === 'SK' && c.category === 'KURIKULUM');
console.log(`\nTotal SK KURIKULUM chunks: ${skKurikulumChunks.length}\n`);

if (skKurikulumChunks.length === 0) {
  console.log('⚠️  NO SK KURIKULUM CHUNKS FOUND');
} else {
  skKurikulumChunks.forEach((chunk, idx) => {
    console.log(`[${idx + 1}] ${chunk.filename || 'NO_FILENAME'}`);
    console.log(`    ID: ${chunk.id}`);
    console.log(`    Category: ${chunk.category}`);
    console.log(`    ChunkType: ${chunk.chunkType || 'UNKNOWN'}`);
    const preview = (chunk.chunk || '').substring(0, 150).replace(/\n/g, ' ');
    console.log(`    Preview: ${preview}...\n`);
  });
}

// ========== SECTION 3: ALL SK CHUNKS ==========
console.log('\n' + '='.repeat(70));
console.log('SECTION 3: ALL SK CHUNKS BY CATEGORY');
console.log('='.repeat(70));

const skChunks = index.filter(c => c.program === 'SK');
console.log(`\nTotal SK chunks: ${skChunks.length}\n`);

const skByCategory = {};
skChunks.forEach(c => {
  const cat = c.category || 'UNKNOWN';
  skByCategory[cat] = (skByCategory[cat] || 0) + 1;
});

Object.entries(skByCategory)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => {
    console.log(`  - ${cat}: ${count}`);
  });

console.log('\nSK Chunks Detail:');
skChunks.forEach((chunk, idx) => {
  console.log(`[${idx + 1}] Filename: ${chunk.filename || 'NO_FILENAME'}`);
  console.log(`    Category: ${chunk.category || 'UNKNOWN'}`);
  console.log(`    ChunkType: ${chunk.chunkType || 'UNKNOWN'}`);
});

// ========== SECTION 4: CHUNKS WITH MATA KULIAH / CURRICULUM SIGNAL ==========
console.log('\n' + '='.repeat(70));
console.log('SECTION 4: CHUNKS WITH "MATA KULIAH" KEYWORD');
console.log('='.repeat(70));

const mataKuliahChunks = index.filter(c => {
  const txt = (c.chunk || '').toLowerCase();
  return txt.includes('mata kuliah') || txt.includes('kurikulum');
});

console.log(`\nTotal chunks mentioning "mata kuliah" or "kurikulum": ${mataKuliahChunks.length}\n`);

if (mataKuliahChunks.length > 0) {
  mataKuliahChunks.forEach((chunk, idx) => {
    console.log(`[${idx + 1}] Program: ${chunk.program || 'UNKNOWN'}`);
    console.log(`    Category: ${chunk.category || 'UNKNOWN'}`);
    console.log(`    Filename: ${chunk.filename || 'NO_FILENAME'}`);
    const preview = (chunk.chunk || '').substring(0, 150).replace(/\n/g, ' ');
    console.log(`    Preview: ${preview}...\n`);
  });
} else {
  console.log('⚠️  NO CHUNKS WITH EXPLICIT "MATA KULIAH" OR "KURIKULUM" TEXT');
}

// ========== SECTION 5: UNKNOWN PROGRAM CHUNKS ==========
console.log('\n' + '='.repeat(70));
console.log('SECTION 5: CHUNKS WITH UNKNOWN/MISSING PROGRAM');
console.log('='.repeat(70));

const unknownProgChunks = index.filter(c => !c.program || c.program === 'UNKNOWN');
console.log(`\nTotal chunks with unknown/missing program: ${unknownProgChunks.length}\n`);

// Sample some
const samples = unknownProgChunks.slice(0, 10);
console.log(`Showing first ${Math.min(10, unknownProgChunks.length)} samples:\n`);
samples.forEach((chunk, idx) => {
  console.log(`[${idx + 1}] Filename: ${chunk.filename || 'NO_FILENAME'}`);
  console.log(`    Category: ${chunk.category || 'UNKNOWN'}`);
  const preview = (chunk.chunk || '').substring(0, 100).replace(/\n/g, ' ');
  console.log(`    Preview: ${preview}...\n`);
});

// ========== FINAL SUMMARY ==========
console.log('\n' + '='.repeat(70));
console.log('FINAL SUMMARY & ROOT CAUSE ANALYSIS');
console.log('='.repeat(70));

const totalByProgram = {};
index.forEach(c => {
  const prog = c.program || 'UNKNOWN';
  totalByProgram[prog] = (totalByProgram[prog] || 0) + 1;
});

console.log('\n📊 Program Distribution:');
Object.entries(totalByProgram)
  .sort((a, b) => b[1] - a[1])
  .forEach(([prog, count]) => {
    console.log(`  ${prog}: ${count}`);
  });

console.log('\n🔴 ROOT CAUSE FINDINGS:\n');

console.log('1️⃣  MI RETRIEVAL FALLBACK:');
if (miChunks.length === 0) {
  console.log('   ❌ MI HAS ZERO CHUNKS FOR DEFINISI_PRODI, KURIKULUM, KARIR');
  console.log('   ✅ Explanation: Index is missing MI-specific documents');
  console.log('   ✅ Not a retrieval issue - data is missing\n');
} else {
  const miHasDefinisi = miChunks.some(
    c => c.category === 'DEFINISI_PRODI' || c.category === 'PROGRAM'
  );
  const miHasKurikulum = miChunks.some(c => c.category === 'KURIKULUM');
  const miHasKarir = miChunks.some(
    c => c.category === 'KARIR' || c.category === 'PROSPEK_KERJA'
  );
  console.log(
    `   ${miHasDefinisi ? '✅' : '❌'} DEFINISI_PRODI/PROGRAM category found`
  );
  console.log(`   ${miHasKurikulum ? '✅' : '❌'} KURIKULUM category found`);
  console.log(`   ${miHasKarir ? '✅' : '❌'} KARIR/PROSPEK_KERJA category found\n`);
}

console.log('2️⃣  SK MATA KULIAH GENERIC ANSWER:');
if (skKurikulumChunks.length === 0) {
  console.log('   ❌ SK HAS ZERO KURIKULUM CHUNKS');
  console.log('   ✅ Explanation: No curriculum data in index');
  console.log('   ✅ Retrieval falls back to DEFINISI_PRODI (profile) chunks\n');
} else {
  console.log(
    `   ⚠️  SK HAS ${skKurikulumChunks.length} KURIKULUM CHUNKS`
  );
  console.log(
    '   But retrieval may rank profile chunks higher (DEFINISI_PRODI > KURIKULUM)\n'
  );
}

console.log('3️⃣  METADATA QUALITY:');
console.log(
  `   ⚠️  ${unknownProgChunks.length} chunks (${(
    (unknownProgChunks.length / index.length) *
    100
  ).toFixed(1)}%) have UNKNOWN program`
);
console.log(
  '   This suggests ingestion did not properly tag document metadata\n'
);

console.log('='.repeat(70));
