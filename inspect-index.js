#!/usr/bin/env node

/**
 * Inspect RAG Index Structure
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'src/data/rag_index.json');

if (!fs.existsSync(indexPath)) {
  console.error('Index file not found at:', indexPath);
  process.exit(1);
}

console.log('Reading index file...');
const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

if (!Array.isArray(indexData)) {
  console.error('Index is not an array');
  process.exit(1);
}

console.log(`Total chunks: ${indexData.length}\n`);

// Check first 10 chunks
console.log('First 10 chunks structure:\n');

for (let i = 0; i < Math.min(10, indexData.length); i++) {
  const chunk = indexData[i];
  
  if (!chunk) continue;
  
  console.log(`Chunk ${i + 1}:`);
  console.log(`  ID: ${chunk.id || 'N/A'}`);
  console.log(`  Filename: ${chunk.filename || 'N/A'}`);
  console.log(`  docCategory: ${chunk.docCategory || 'MISSING'}`);
  console.log(`  category: ${chunk.category || 'N/A'}`);
  console.log(`  chunkType: ${chunk.chunkType || 'N/A'}`);
  console.log(`  Text preview: ${(chunk.chunk || '').substring(0, 60).replace(/\n/g, ' ')}...`);
  console.log();
}

// Check if any chunks have docCategory field
const withDocCategory = indexData.filter(c => c && c.docCategory).length;
const withoutDocCategory = indexData.filter(c => !c || !c.docCategory).length;

console.log('\nDocCategory Field Statistics:');
console.log(`  With docCategory: ${withDocCategory}`);
console.log(`  Without docCategory: ${withoutDocCategory}`);
console.log(`  Percentage: ${(withDocCategory / indexData.length * 100).toFixed(2)}%`);

// Count category distribution
if (withDocCategory > 0) {
  console.log('\nCategory Distribution:');
  const categories = {};
  for (const chunk of indexData) {
    if (chunk && chunk.docCategory) {
      categories[chunk.docCategory] = (categories[chunk.docCategory] || 0) + 1;
    }
  }
  for (const [cat, count] of Object.entries(categories)) {
    console.log(`  ${cat}: ${count}`);
  }
}
