#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { enrichChunkWithCategory } = require('./src/engine/docCategoryClassifier');

const INDEX_PATH = path.join(__dirname, 'src/data/rag_index.json');
if (!fs.existsSync(INDEX_PATH)) { console.error('Index not found'); process.exit(1); }

console.log('Loading index...');
const index = JSON.parse(fs.readFileSync(INDEX_PATH,'utf8'));

let changed = 0;
for (let i=0;i<index.length;i++){
  try {
    const old = index[i];
    const enriched = enrichChunkWithCategory(old) || old;
    if ((old.docCategory||'') !== (enriched.docCategory||'')) {
      index[i] = enriched;
      changed++;
    }
  } catch(e) {
    // continue
  }
}

console.log(`Reclassified ${changed} chunks out of ${index.length}`);
// Save index backup
fs.writeFileSync(INDEX_PATH + '.bak', JSON.stringify(index, null, 2));
// Overwrite
fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
console.log('Index saved (backup created).');
