const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

const INDEX_PATH = path.join(__dirname, '..', 'data', 'rag_index.json');

function loadIndex() {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed to load index:', e.message);
    process.exit(1);
  }
}

function saveIndex(index) {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save index:', e.message);
    process.exit(1);
  }
}

function tryFromMetadataTags(tags) {
  if (!Array.isArray(tags)) return null;
  for (const t of tags) {
    if (!t) continue;
    const cand = String(t).replace(/_/g, ' ');
    const alias = rag.normalizeProgramLabel(cand);
    if (alias) return alias;
  }
  return null;
}

(function main() {
  const index = loadIndex();
  let changed = 0;
  for (const item of index) {
    if (!item) continue;
    if (item.program) continue; // already present
    let prog = null;
    // Try metadata.tags
    if (item.metadata && item.metadata.tags) {
      prog = tryFromMetadataTags(item.metadata.tags);
    }
    // Fallback: normalize from chunk or filename
    if (!prog) {
      const textSource = String(item.chunk || '') + '\n' + String(item.filename || '');
      prog = rag.normalizeProgramLabel(textSource);
    }
    if (prog) {
      item.program = prog;
      changed++;
    }
  }
  if (changed > 0) {
    saveIndex(index);
    console.log(`Backfilled program for ${changed} items in index.`);
  } else {
    console.log('No items required backfill.');
  }
})();
