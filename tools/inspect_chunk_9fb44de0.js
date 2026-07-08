const path = require('path');
const fs = require('fs');
const rag = require(path.resolve(__dirname, '../src/engine/ragEngine.js'));

const id = '9fb44de0-a82a-44ba-bd55-086c72243698';
const ragIndexPath = path.resolve(__dirname, '../src/data/rag_index.json');
const retrievalPath = path.resolve(__dirname, 'retrieval_file_chunks.json');

if (!fs.existsSync(ragIndexPath)) {
  console.error('rag_index.json not found:', ragIndexPath);
  process.exit(2);
}
if (!fs.existsSync(retrievalPath)) {
  console.error('retrieval_file_chunks.json not found:', retrievalPath);
  process.exit(2);
}

const ragIndex = JSON.parse(fs.readFileSync(ragIndexPath, 'utf8'));
const retrieval = JSON.parse(fs.readFileSync(retrievalPath, 'utf8'));

const entry = Array.isArray(ragIndex) ? ragIndex.find(e => e && e.id === id) : null;
if (!entry) {
  console.error('Chunk id not found in rag_index.json:', id);
  process.exit(2);
}

const retrievalEntry = retrieval.results && retrieval.results.find(r => r && r.id === id) ? retrieval.results.find(r => r && r.id === id) : null;
const filename = retrievalEntry ? retrievalEntry.filename : (entry.filename || entry.sourceFile || 'unknown');

const item = Object.assign({}, entry, { filename, sourceFile: filename });
const chunkText = entry.chunk;

function existsToken(text, regex) { const m = String(text||'').match(regex); return m ? { found: true, index: m.index, match: m[0] } : { found: false }; }

const structuredMeta = typeof rag.extractStructuredChunkMetadata === 'function' ? rag.extractStructuredChunkMetadata(chunkText) : null;
const fromTextEntities = typeof rag.extractStructuredChunkMetadata === 'function' ? rag.extractStructuredChunkMetadata(chunkText) : null;
const getEntities = typeof rag.getChunkEntities === 'function' ? rag.getChunkEntities(item) : null;
const normFromTextProgram = typeof rag.normalizeProgramLabel === 'function' ? rag.normalizeProgramLabel(chunkText) : null;
const normFilenameProgram = typeof rag.normalizeProgramLabel === 'function' ? rag.normalizeProgramLabel(filename) : null;

const tokens = {
  TI: existsToken(filename + ' ' + chunkText, /\bti\b/i),
  Teknologi_Informasi: existsToken(filename + ' ' + chunkText, /teknologi\s+informasi/i),
  SI: existsToken(filename + ' ' + chunkText, /\bsi\b/i),
  Sistem_Informasi: existsToken(filename + ' ' + chunkText, /sistem\s+informasi/i),
  BD: existsToken(filename + ' ' + chunkText, /\bbd\b/i),
  Bisnis_Digital: existsToken(filename + ' ' + chunkText, /bisnis\s+digital/i)
};

console.log('--- CHUNK ID:', id);
console.log('filename:', filename);
console.log('\n--- CHUNK TEXT ---\n');
console.log(chunkText);
console.log('\n--- extractStructuredChunkMetadata ---\n');
console.log(JSON.stringify(structuredMeta, null, 2));
console.log('\n--- getChunkEntities(item) ---\n');
console.log(JSON.stringify(getEntities, null, 2));
console.log('\n--- normalizeProgramLabel(chunkText) ->', normFromTextProgram);
console.log('--- normalizeProgramLabel(filename) ->', normFilenameProgram);
console.log('\n--- tokens presence (filename+chunk) ---\n');
console.log(JSON.stringify(tokens, null, 2));

if (structuredMeta && structuredMeta.programAliases) {
  console.log('\n--- programAliases from structuredMeta.programAliases ---\n', structuredMeta.programAliases);
}

console.log('\n--- DONE ---');
