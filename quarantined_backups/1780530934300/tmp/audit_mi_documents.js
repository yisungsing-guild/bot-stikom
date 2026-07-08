/**
 * AUDIT TASK 1: MI SOURCE DOCUMENTS
 * 
 * Find:
 * 1. All documents that mention MI/Manajemen Informatika/Manajemen Informasi
 * 2. Which documents were ingested and which were not
 * 3. What metadata they have
 */

const fs = require('fs');
const path = require('path');

// Load index
const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const chunks = indexData.chunks || [];

console.log('='.repeat(80));
console.log('AUDIT TASK 1: MI SOURCE DOCUMENTS');
console.log('='.repeat(80));
console.log();

// Get all MI chunks
const miChunks = chunks.filter(c => c.program === 'MI' || (c.programAliases && c.programAliases.includes('MI')));
console.log(`Total MI chunks in index: ${miChunks.length}`);
console.log();

// Group by filename
const miByFile = {};
miChunks.forEach(chunk => {
  const filename = chunk.filename || 'NO_FILENAME';
  if (!miByFile[filename]) {
    miByFile[filename] = [];
  }
  miByFile[filename].push(chunk);
});

console.log('MI Chunks by Source File:');
console.log('-'.repeat(80));
Object.entries(miByFile).forEach(([file, chunkList]) => {
  console.log(`\n📄 ${file}`);
  console.log(`   Count: ${chunkList.length}`);
  console.log(`   Categories:`);
  
  const categories = {};
  chunkList.forEach(chunk => {
    const cat = chunk.category || 'UNKNOWN';
    categories[cat] = (categories[cat] || 0) + 1;
  });
  
  Object.entries(categories).forEach(([cat, count]) => {
    console.log(`     - ${cat}: ${count}`);
  });
  
  // Show first chunk content
  if (chunkList.length > 0) {
    const firstChunk = chunkList[0];
    const content = firstChunk.content || '';
    const preview = content.substring(0, 200).replace(/\n/g, ' ');
    console.log(`   Preview: "${preview}${content.length > 200 ? '...' : ''}"`);
  }
});

console.log();
console.log('='.repeat(80));
console.log('MI CHUNKS DETAIL (ID, CATEGORY, CONTENT PREVIEW)');
console.log('='.repeat(80));

miChunks.forEach((chunk, idx) => {
  console.log(`\n[${idx + 1}] ID: ${chunk.id}`);
  console.log(`    Category: ${chunk.category || 'UNKNOWN'}`);
  console.log(`    File: ${chunk.filename || 'NO_FILENAME'}`);
  console.log(`    Program: ${chunk.program || 'UNKNOWN'}`);
  
  const content = chunk.content || '';
  const preview = content.substring(0, 300).replace(/\n/g, ' ');
  console.log(`    Content (first 300 chars): "${preview}${content.length > 300 ? '...' : ''}"`);
});

console.log();
console.log('='.repeat(80));
console.log('ANALYSIS: MISSING MI CATEGORIES');
console.log('='.repeat(80));

const miCategories = new Set(miChunks.map(c => c.category || 'UNKNOWN'));
const requiredCategories = ['DEFINISI_PRODI', 'KURIKULUM', 'MATA_KULIAH', 'KARIR', 'PROSPEK_KERJA'];

console.log('\nRequired categories for complete MI profile:');
requiredCategories.forEach(cat => {
  const exists = miCategories.has(cat);
  const status = exists ? '✓' : '✗';
  console.log(`  ${status} ${cat}`);
});

console.log();
console.log('='.repeat(80));
console.log('SEARCH FOR MI IN ALL SOURCE FILES');
console.log('='.repeat(80));

// Get all unique filenames in index
const allFiles = new Set(chunks.map(c => c.filename || 'NO_FILENAME'));
console.log(`\nTotal unique source files in index: ${allFiles.size}`);
console.log('\nFiles that might contain MI data:');

const potentialMIFiles = Array.from(allFiles).filter(file => 
  file.toLowerCase().includes('mi') || 
  file.toLowerCase().includes('manajemen') || 
  file.toLowerCase().includes('informatika') ||
  file.toLowerCase().includes('informasi')
);

if (potentialMIFiles.length === 0) {
  console.log('❌ No files with "MI", "manajemen", "informatika", or "informasi" in filename');
  console.log('\n→ This suggests MI source documents may not be ingested at all');
} else {
  console.log('✓ Found potential MI files:');
  potentialMIFiles.forEach(file => {
    const fileChunks = chunks.filter(c => c.filename === file);
    console.log(`  - ${file}: ${fileChunks.length} chunks`);
  });
}

console.log();
console.log('='.repeat(80));
console.log('RECOMMENDATION FOR MI DATA INGESTION');
console.log('='.repeat(80));

if (miChunks.length === 0) {
  console.log('\n❌ NO MI CHUNKS IN INDEX AT ALL');
  console.log('\nAction: Need to find MI source documents and ingest them');
} else if (miCategories.size < 3) {
  console.log('\n⚠️  MI CHUNKS INCOMPLETE');
  console.log('\nMissing categories:');
  requiredCategories.forEach(cat => {
    if (!miCategories.has(cat)) {
      console.log(`  - ${cat}`);
    }
  });
  console.log('\nAction: Need to find documents with missing categories and re-ingest');
} else {
  console.log('\n✓ MI data appears complete in index');
}

console.log();
console.log('Next step: Check if PDF files for MI exist in workspace');
console.log('Look for files containing: "MI", "Manajemen Informatika", "Manajemen Informasi"');
