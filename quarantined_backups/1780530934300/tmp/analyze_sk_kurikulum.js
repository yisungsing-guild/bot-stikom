/**
 * EXAMINE SK KURIKULUM CHUNKS IN DETAIL
 * 
 * Show the full content of SK KURIKULUM chunks to verify if they contain course names
 */

const fs = require('fs');
const path = require('path');

const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

console.log('='.repeat(80));
console.log('SK KURIKULUM CHUNKS - DETAILED CONTENT ANALYSIS');
console.log('='.repeat(80));
console.log();

const skChunks = index.filter(c => c.program === 'SK');
const kurikulumChunks = skChunks.filter(c => c.category === 'KURIKULUM');

console.log(`Found ${kurikulumChunks.length} SK KURIKULUM chunks\n`);

kurikulumChunks.forEach((chunk, idx) => {
  console.log(`┌─ KURIKULUM CHUNK ${idx + 1} ─────────────────────────────────────────────────────`);
  console.log(`│ ID: ${chunk.id}`);
  console.log(`│ File: ${chunk.filename || 'UNKNOWN'}`);
  console.log(`│ Category: ${chunk.category}`);
  console.log(`└${'─'.repeat(76)}`);
  console.log();
  console.log('CONTENT:');
  console.log('-'.repeat(80));
  const content = chunk.chunk || '';
  console.log(content);
  console.log();
  console.log('ANALYSIS:');
  console.log('-'.repeat(80));
  
  // Check if content looks like course names
  const hasCourseName = /mata kuliah|course|matakuliah|praktik|teori|sks|credit|jam|modul/i.test(content);
  const hasListItems = /^[-•·*]\s+/m.test(content) || /^\d+\.\s+/m.test(content);
  const hasTableFormat = /\|/m.test(content);
  
  console.log(`Contains course-related keywords: ${hasCourseName ? 'YES' : 'NO'}`);
  console.log(`Has list format (-, •, 1., etc.): ${hasListItems ? 'YES' : 'NO'}`);
  console.log(`Has table format (with |): ${hasTableFormat ? 'YES' : 'NO'}`);
  console.log();
  
  if (!hasCourseName && !hasListItems && !hasTableFormat) {
    console.log('⚠️  WARNING: This does NOT look like a course/curriculum list');
    console.log('            Appears to be generic program description or metadata');
  } else {
    console.log('✓ This could be curriculum-related content');
  }
  
  console.log();
  console.log('='.repeat(80));
  console.log();
});

// Also show what other SK chunks look like for comparison
console.log('COMPARISON: Sample SK DEFINISI/PROGRAM chunks (for ranking analysis)');
console.log('='.repeat(80));
console.log();

const otherSkChunks = skChunks.filter(c => ['PROGRAM', 'DEFINISI_PRODI'].includes(c.category)).slice(0, 2);
if (otherSkChunks.length === 0) {
  // Just take some non-KURIKULUM chunks
  const nonKurikulum = skChunks.filter(c => c.category !== 'KURIKULUM').slice(0, 2);
  console.log(`Showing ${nonKurikulum.length} non-KURIKULUM SK chunks for comparison:`);
  console.log();
  
  nonKurikulum.forEach((chunk, idx) => {
    console.log(`Sample SK chunk ${idx + 1} (${chunk.category}):`);
    console.log('-'.repeat(80));
    const preview = (chunk.chunk || '').substring(0, 300);
    console.log(preview + '...\n');
  });
} else {
  console.log(`Showing ${otherSkChunks.length} SK DEFINISI/PROGRAM chunks:`);
  console.log();
  
  otherSkChunks.forEach((chunk, idx) => {
    console.log(`SK chunk ${idx + 1} (${chunk.category}):`);
    console.log('-'.repeat(80));
    const preview = (chunk.chunk || '').substring(0, 300);
    console.log(preview + '...\n');
  });
}

console.log('='.repeat(80));
console.log('CONCLUSION & RECOMMENDATIONS');
console.log('='.repeat(80));
console.log();
console.log('If SK KURIKULUM chunks contain:');
console.log('  ✓ Course names/list format → Retrieval ranking needs fixing');
console.log('                                (prefer KURIKULUM over DEFINISI for mata kuliah)');
console.log('  ✗ Generic text → Need to find better curriculum documents');
console.log();
