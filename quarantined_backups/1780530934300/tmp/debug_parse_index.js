const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const root = process.cwd();
const code = fs.readFileSync(path.join(root, 'src', 'engine', 'ragEngine.js'), 'utf8');
const wrap = `${code}\nmodule.exports = { extractStructuredEntities, getChunkEntities, normalizeWaveLabel, normalizeWaveGroup, parseFeeStructureFromChunk, parseFeeStructure, isGlobalWaveDiscountChunk, validateParsedFeeStruct };`;
const requireFromFile = createRequire(path.join(root, 'src', 'engine', 'ragEngine.js'));
const sandbox = { module: { exports: {} }, exports: {}, require: requireFromFile, console, process, setTimeout, clearTimeout, Date, __dirname: path.join(root, 'src', 'engine'), __filename: path.join(root, 'src', 'engine', 'ragEngine.js') };
vm.createContext(sandbox);
vm.runInContext(wrap, sandbox);
const engine = sandbox.module.exports;
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
const q = 'biaya prodi si gelombang 1A?';
const queryEntities = engine.extractStructuredEntities(q);
const candidates = index.filter(item => String(item.chunk||'').toLowerCase().includes('pendaftaran') || String(item.chunk||'').toLowerCase().includes('dana pendidikan') || String(item.chunk||'').toLowerCase().includes('gelombang'));
let count=0;
for (const item of candidates) {
  const ent = engine.getChunkEntities(item);
  if (ent.program !== 'SI' && ent.program !== 'TI' && ent.program !== 'BD' && ent.program !== null) continue;
  const parsed = engine.parseFeeStructureFromChunk(item, queryEntities);
  if (parsed) {
    console.log('FOUND', item.filename, 'wave', ent.wave, 'group', ent.waveGroup, 'parsed registrationFee', parsed.registrationFee, 'dpp', parsed.dpp, 'isGlobal', parsed.isGlobalDiscount);
    count++;
    if (count>20) break;
  }
}
console.log('found count', count);
