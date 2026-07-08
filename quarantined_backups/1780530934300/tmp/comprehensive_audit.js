/**
 * COMPREHENSIVE INDEX AUDIT
 * 
 * Analyze all chunks in index:
 * - Which have program metadata
 * - Which are MI, SK
 * - What categories exist
 * - What needs fixing
 */

const fs = require('fs');
const path = require('path');

const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

console.log('='.repeat(80));
console.log('COMPREHENSIVE INDEX AUDIT');
console.log('='.repeat(80));
console.log();

// SECTION 1: Overall metadata quality
console.log('📊 METADATA QUALITY:');
console.log('-'.repeat(80));

const stats = {
  total: index.length,
  hasProgram: 0,
  hasFilename: 0,
  hasCategory: 0,
  byProgram: {},
  byCategory: {},
  unknownProgram: [],
  unknownCategory: [],
};

index.forEach(chunk => {
  const prog = chunk.program || 'UNKNOWN';
  const cat = chunk.category || 'UNKNOWN';
  
  if (chunk.program) stats.hasProgram++;
  if (chunk.filename) stats.hasFilename++;
  if (chunk.category) stats.hasCategory++;
  
  stats.byProgram[prog] = (stats.byProgram[prog] || 0) + 1;
  stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
  
  if (!chunk.program) stats.unknownProgram.push(chunk);
  if (!chunk.category) stats.unknownCategory.push(chunk);
});

console.log(`Chunks with program field:      ${stats.hasProgram}/${stats.total} (${(stats.hasProgram/stats.total*100).toFixed(1)}%)`);
console.log(`Chunks with filename field:     ${stats.hasFilename}/${stats.total} (${(stats.hasFilename/stats.total*100).toFixed(1)}%)`);
console.log(`Chunks with category field:     ${stats.hasCategory}/${stats.total} (${(stats.hasCategory/stats.total*100).toFixed(1)}%)`);
console.log();

// SECTION 2: MI chunks audit
console.log('📚 MI CHUNKS AUDIT:');
console.log('-'.repeat(80));

const miChunks = index.filter(c => c.program === 'MI');
console.log(`Total MI chunks: ${miChunks.length}`);

if (miChunks.length > 0) {
  const miByCategory = {};
  miChunks.forEach(c => {
    const cat = c.category || 'UNKNOWN';
    miByCategory[cat] = (miByCategory[cat] || 0) + 1;
  });
  
  console.log('MI categories:');
  Object.entries(miByCategory).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });
  
  console.log('\nMissing MI categories:');
  ['DEFINISI_PRODI', 'KURIKULUM', 'MATA_KULIAH', 'KARIR', 'PROSPEK_KERJA'].forEach(cat => {
    if (!miByCategory[cat]) {
      console.log(`  ✗ ${cat}`);
    }
  });
}
console.log();

// SECTION 3: SK chunks audit
console.log('📚 SK CHUNKS AUDIT:');
console.log('-'.repeat(80));

const skChunks = index.filter(c => c.program === 'SK');
console.log(`Total SK chunks: ${skChunks.length}`);

const skByCategory = {};
if (skChunks.length > 0) {
  skChunks.forEach(c => {
    const cat = c.category || 'UNKNOWN';
    skByCategory[cat] = (skByCategory[cat] || 0) + 1;
  });
  
  console.log('SK categories:');
  Object.entries(skByCategory).sort().forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });
  
  console.log('\nSK KURIKULUM chunks (should have course list):');
  const kurikulumChunks = skChunks.filter(c => c.category === 'KURIKULUM');
  if (kurikulumChunks.length === 0) {
    console.log('  ❌ NO KURIKULUM CHUNKS FOUND');
  } else {
    kurikulumChunks.forEach((chunk, idx) => {
      console.log(`  [${idx + 1}] ID: ${chunk.id}`);
      console.log(`      File: ${chunk.filename || 'UNKNOWN'}`);
      console.log(`      Preview: "${chunk.chunk.substring(0, 150).replace(/\n/g, ' ')}..."`);
    });
  }
}
console.log();

// SECTION 4: Distribution by program
console.log('📊 CHUNKS BY PROGRAM:');
console.log('-'.repeat(80));

Object.entries(stats.byProgram).sort((a, b) => b[1] - a[1]).forEach(([prog, count]) => {
  const pct = (count / stats.total * 100).toFixed(1);
  console.log(`${prog.padEnd(12)}: ${count.toString().padStart(3)} (${pct}%)`);
});
console.log();

// SECTION 5: Distribution by category
console.log('📊 CHUNKS BY CATEGORY:');
console.log('-'.repeat(80));

Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  const pct = (count / stats.total * 100).toFixed(1);
  console.log(`${cat.padEnd(18)}: ${count.toString().padStart(3)} (${pct}%)`);
});
console.log();

// SECTION 6: Problematic chunks
console.log('⚠️  PROBLEMATIC CHUNKS:');
console.log('-'.repeat(80));

console.log(`Chunks with UNKNOWN program:  ${stats.unknownProgram.length}`);
console.log(`Chunks with UNKNOWN category: ${stats.unknownCategory.length}`);
console.log();

// Show sample of unknown program chunks
console.log('Sample chunks with UNKNOWN program:');
stats.unknownProgram.slice(0, 5).forEach((chunk, idx) => {
  console.log(`  [${idx + 1}] File: ${chunk.filename || 'UNKNOWN'}`);
  console.log(`      Text: "${chunk.chunk.substring(0, 100).replace(/\n/g, ' ')}..."`);
});
console.log();

// SECTION 7: KEY FINDINGS
console.log('='.repeat(80));
console.log('KEY FINDINGS & RECOMMENDATIONS');
console.log('='.repeat(80));
console.log();

console.log('🎯 PRIORITY 1: MI DATA INCOMPLETENESS');
console.log('  Current state: 9 chunks (BIAYA + AKREDITASI only)');
console.log('  Missing: DEFINISI_PRODI, KURIKULUM, MATA_KULIAH, KARIR, PROSPEK_KERJA');
console.log('  Action: Need to find or create MI definition/curriculum documents');
console.log();

console.log('🎯 PRIORITY 2: SK CURRICULUM DATA');
console.log(`  Current state: ${skByCategory['KURIKULUM'] || 0} KURIKULUM chunks`);
console.log('  Issue: May be too few; also need to verify ranking for MATA_KULIAH queries');
console.log('  Action: Check if KURIKULUM chunks have course names; adjust retrieval ranking');
console.log();

console.log('🎯 PRIORITY 3: METADATA QUALITY');
console.log(`  Chunks with UNKNOWN program: ${stats.unknownProgram.length} (${(stats.unknownProgram.length/stats.total*100).toFixed(1)}%)`);
console.log('  Action: Re-enrich these chunks using text extraction');
console.log();

console.log('Export completed. Next steps:');
console.log('1. Examine SK KURIKULUM chunk content in detail');
console.log('2. If content is good, adjust retrieval ranking');
console.log('3. Re-enrich chunks with UNKNOWN program');
console.log('4. Find/create MI DEFINISI_PRODI documents');
