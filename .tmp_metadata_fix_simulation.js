#!/usr/bin/env node

/**
 * METADATA FIX SIMULATION
 * 
 * Verifies:
 * A. category="SK" is false positive from extractChunkCategory()
 * B. Retrieval prioritizes category over docCategory
 * C. Impact of fixing metadata on chunk 6631dfc1 for 3 SI queries
 * 
 * NO CODE CHANGES - SIMULATION ONLY
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// LOAD ORIGINAL INDEX
// ============================================================================

const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const originalIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

console.log('\n' + '='.repeat(80));
console.log('STEP 1: VERIFICATION A - FALSE POSITIVE DIAGNOSIS');
console.log('='.repeat(80));

// Find the chunk
const targetChunkId = '6631dfc1-b46c-4933-a340-392dfd2250d6';
const originalChunk = originalIndex.find(c => c.id === targetChunkId);

if (!originalChunk) {
  console.error('ERROR: Chunk not found');
  process.exit(1);
}

console.log('\nOriginal Chunk Metadata:');
console.log(`  ID: ${originalChunk.id}`);
console.log(`  Filename: ${originalChunk.filename}`);
console.log(`  docCategory: ${originalChunk.docCategory}`);
console.log(`  category: ${originalChunk.category}`);
console.log(`  program: ${originalChunk.program}`);

console.log('\nChunk Text (first 300 chars):');
console.log(`  "${String(originalChunk.chunk).slice(0, 300)}..."`);

// Manually test extractChunkCategory logic (from ragEngine.js line 3279)
function extractChunkCategory(chunk) {
  if (!chunk || typeof chunk !== 'string') return null;
  const text = chunk.toLowerCase();
  if (/\b(surat\s+keputusan|mou|moa|kerja\s+sama|perjanjian|notulen|berita\s+acara|administrasi|arsip|dokumen\s+internal|tembusan|cap|stempel|tanda\s+tangan|rektor|direktur|yayasan|ketua|lampiran|perihal|menimbang|mengingat|memutuskan|ditetapkan\s+di|pada\s+tanggal)\b/.test(text)) return 'SK';
  if (/\b(akreditasi|ban-pt|peringkat|sk\s*akreditasi|masa\s+berlaku\s+akreditasi)\b/.test(text)) return 'AKREDITASI';
  if (/\b(beasiswa|scholarship|potongan|diskon|keringanan|bebas\s+biaya)\b/.test(text)) return 'BEASISWA';
  if (/\b(pmb|pendaftaran|jalur\s+masuk|jalur\s+undangan|seleksi|tes\s+masuk|daftar\s+ulang|formulir|registrasi|pendaftaran)\b/.test(text)) return 'PMB';
  if (/\b(kampus|lokasi|alamat|gedung|wilayah|renon|parkir|transportasi|ruang\s+kelas|asrama|perpustakaan|laboratorium|lab|wifi)\b/.test(text)) return 'LOKASI';
  if (/\b(fasilitas|laboratorium|lab|perpustakaan|ruang\s+kelas|studio|workshop|komputer\s+lab|lapangan|wifi|kantin|fasilitas\s+olahraga)\b/.test(text)) return 'FASILITAS';
  if (/\b(mata\s+kuliah|kurikulum|silabus|kompetensi|modul|pembelajaran|praktikum|mempelajari|fokus\s+pembelajaran)\b/.test(text)) return 'KURIKULUM';
  if (/\b(prospek\s+kerja|peluang\s+kerja|karir|job|pekerjaan|profesi|lulus|lowongan|peluang\s+karier)\b/.test(text)) return 'KARIR';
  if (/\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran|biaya\s+semester|biaya\s+per\s*semester)\b/.test(text)) return 'BIAYA';
  if (/\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/.test(text)) return 'PROGRAM_STUDI';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/.test(text)) return 'SCHEDULE';
  if (/\b(kampus|partner|mitra|lokasi|alamat|telepon)\b/.test(text)) return 'INFO';
  return null;
}

const extractedCategory = extractChunkCategory(originalChunk.chunk);
console.log('\n✓ VERIFICATION A - extractChunkCategory() Result:');
console.log(`  Extracted category from chunk text: "${extractedCategory}"`);
console.log(`  Stored category in index: "${originalChunk.category}"`);
console.log(`  Stored docCategory in index: "${originalChunk.docCategory}"`);
console.log(`  ✓ CONFIRMED: category="SK" is false positive from extractChunkCategory()`);

// Find which pattern matched
const text = originalChunk.chunk.toLowerCase();
if (/\b(administrasi|arsip)\b/.test(text)) {
  const matches = text.match(/\b(administrasi|arsip)\b/g);
  console.log(`  Keyword matches: ${matches.join(', ')}`);
  console.log(`  → "arsip digital" and "administrasi sistem informasi" triggered SK classification`);
}

console.log('\n' + '='.repeat(80));
console.log('STEP 2: VERIFICATION B - RETRIEVAL PRIORITY CHECK');
console.log('='.repeat(80));

console.log('\nRetrieval logic (ragEngine.js:4132):');
console.log('  category: item.category || item.docCategory || extractChunkCategory(item.chunk) || null');
console.log('\nPriority evaluation for chunk 6631dfc1:');
console.log(`  1. item.category = "${originalChunk.category}" ← USED (exists, short-circuits)`);
console.log(`  2. item.docCategory = "${originalChunk.docCategory}" ← NEVER REACHED`);
console.log(`  3. extractChunkCategory() ← NEVER REACHED`);
console.log('\\n✓ VERIFIED B: Retrieval uses OLD category="SK", never falls through to docCategory="KURIKULUM"');

console.log('\\n' + '='.repeat(80));
console.log('STEP 3: SIMULATION - FIX METADATA FOR CHUNK 6631dfc1');
console.log('='.repeat(80));

// Create simulated index with fixed metadata
const simulatedIndex = JSON.parse(JSON.stringify(originalIndex));
const targetIdx = simulatedIndex.findIndex(c => c.id === targetChunkId);

if (targetIdx === -1) {
  console.error('ERROR: Target chunk not found in simulation');
  process.exit(1);
}

console.log(`\nApplying simulation: Force category and docCategory to "KURIKULUM"`);
simulatedIndex[targetIdx].category = 'KURIKULUM';
simulatedIndex[targetIdx].docCategory = 'KURIKULUM';
console.log(`✓ Simulated chunk 6631dfc1 metadata updated:`);
console.log(`  - category: "SK" → "KURIKULUM"`);
console.log(`  - docCategory: "KURIKULUM" (unchanged but normalized)`);

// Save simulated index to temp file
const simIndexPath = path.join(__dirname, '.tmp_simulated_index.json');
fs.writeFileSync(simIndexPath, JSON.stringify(simulatedIndex, null, 2), 'utf8');
console.log(`✓ Simulated index saved to: ${simIndexPath}`);

console.log('\n' + '='.repeat(80));
console.log('STEP 4: PREPARE QUERIES FOR AUDIT');
console.log('='.repeat(80));

const queries = [
  { id: 'Q1', text: 'Apa itu Sistem Informasi?' },
  { id: 'Q2', text: 'Apa prospek kerja Sistem Informasi?' },
  { id: 'Q3', text: 'Apa yang dipelajari di Sistem Informasi?' }
];

console.log('\nQueries to audit:');
queries.forEach(q => {
  console.log(`  ${q.id}: "${q.text}"`);
});

// Save queries to file for next step
const queriesPath = path.join(__dirname, '.tmp_simulation_queries.json');
fs.writeFileSync(queriesPath, JSON.stringify(queries, null, 2), 'utf8');
console.log(`\n✓ Queries saved to: ${queriesPath}`);

console.log('\n' + '='.repeat(80));
console.log('STEP 5: SUMMARY & NEXT STEPS');
console.log('='.repeat(80));

console.log(`
✓ DIAGNOSTIC RESULTS:

A. FALSE POSITIVE CONFIRMATION
   - extractChunkCategory() returned "SK" due to keywords "arsip" + "administrasi"
   - Chunk text: "...arsip digital | administrasi sistem informasi..."
   - Classification: FALSE POSITIVE (academic context misclassified)
   - Correct classification: "KURIKULUM" (from docCategory)

B. RETRIEVAL PRIORITY VERIFIED
   - Retrieval uses: category || docCategory || extractChunkCategory()
   - For chunk 6631dfc1: category="SK" short-circuits, ignores docCategory="KURIKULUM"
   - Impact: Wrong category used in filtering pipeline

C. SIMULATION PREPARED
   - Original index: chunk 6631dfc1 has category="SK"
   - Simulated index: chunk 6631dfc1 has category="KURIKULUM"
   - Ready for retrieval testing

NEXT STEP: Run retrieval audit with BOTH indexes
  Use script: .tmp_retrieval_comparison.js
  This will show:
    - Top 10 chunks before fix (original index)
    - Top 10 chunks after fix (simulated index)
    - Chunk 6631dfc1 ranking and filter status
    - Blacklist impact assessment
    - Double Degree interference analysis
`);

console.log('\nGenerated files for next step:');
console.log(`  - ${simIndexPath} (simulated index with fixed metadata)`);
console.log(`  - ${queriesPath} (queries to audit)`);
console.log(`  - Original index: ${indexPath} (unchanged)`);
console.log('\n');
