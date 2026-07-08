#!/usr/bin/env node

/**
 * Analyze Index Content for Profile/Curriculum Chunks
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'src/data/rag_index.json');

if (!fs.existsSync(indexPath)) {
  console.error('Index not found');
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

console.log('=== Index Content Analysis ===\n');
console.log(`Total chunks: ${index.length}\n`);

// Group by category
const byCategory = {};
for (const chunk of index) {
  const cat = chunk.docCategory || chunk.category || 'UNKNOWN';
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push(chunk);
}

console.log('Chunks by Category:');
for (const [cat, chunks] of Object.entries(byCategory)) {
  console.log(`\n${cat}: ${chunks.length} chunks`);
  
  // Show first 3 chunks with preview
  for (let i = 0; i < Math.min(3, chunks.length); i++) {
    const chunk = chunks[i];
    const preview = (chunk.chunk || '').substring(0, 70).replace(/\n/g, ' ');
    console.log(`  [${i+1}] ${chunk.filename || 'no filename'}`);
    console.log(`      "${preview}..."`);
  }
}

// Check for TI-related chunks
console.log('\n\n=== TI-Related Content ===');
const tiChunks = index.filter(c => {
  const text = (c.chunk || '').toLowerCase();
  const fname = (c.filename || '').toLowerCase();
  return text.includes('ti ') || text.includes(' ti') || fname.includes('ti') || text.includes('teknologi informasi');
});

console.log(`Found ${tiChunks.length} chunks mentioning "TI"\n`);

// Group by category
const tiByCategory = {};
for (const chunk of tiChunks) {
  const cat = chunk.docCategory || chunk.category || 'UNKNOWN';
  if (!tiByCategory[cat]) tiByCategory[cat] = [];
  tiByCategory[cat].push(chunk);
}

for (const [cat, chunks] of Object.entries(tiByCategory)) {
  console.log(`${cat}: ${chunks.length} chunks`);
}

// Check for profile-like content
console.log('\n\n=== Potential Profile/Curriculum Chunks ===');
const profileKeywords = [
  'profil', 'profile', 'tentang', 'pengertian', 'definisi', 'deskripsi',
  'visi', 'misi', 'tujuan', 'capaian pembelajaran', 'learning outcome',
  'kurikulum', 'mata kuliah', 'course', 'program studi', 'prodi'
];

const profileChunks = index.filter(c => {
  const text = (c.chunk || '').toLowerCase();
  return profileKeywords.some(kw => text.includes(kw));
});

console.log(`Found ${profileChunks.length} chunks with profile/curriculum keywords\n`);

// By category
const profByCategory = {};
for (const chunk of profileChunks) {
  const cat = chunk.docCategory || chunk.category || 'UNKNOWN';
  if (!profByCategory[cat]) profByCategory[cat] = [];
  profByCategory[cat].push(chunk);
}

for (const [cat, chunks] of Object.entries(profByCategory)) {
  console.log(`${cat}: ${chunks.length} chunks`);
  if (chunks.length > 0) {
    console.log(`  - "${(chunks[0].chunk || '').substring(0, 60)}..."`);
  }
}
