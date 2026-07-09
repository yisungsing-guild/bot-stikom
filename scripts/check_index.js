const { getRagIndexPath } = require('../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');
const idxPath = getRagIndexPath();
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
console.log('items', idx.length);
idx.slice(0, 3).forEach((i, idx) => {
  console.log({
    index: idx + 1,
    id: i.id,
    filename: i.filename || i.file || null,
    hasEmbedding: Array.isArray(i.embedding),
    embLen: Array.isArray(i.embedding) ? i.embedding.length : 0,
    category: i.docCategory || i.category || 'UNKNOWN'
  });
});
