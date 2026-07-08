const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const root = process.cwd();
const code = fs.readFileSync(path.join(root, 'src', 'engine', 'ragEngine.js'), 'utf8');
const wrap = `${code}\nmodule.exports = { parseFeeStructureFromChunk, parseFeeStructure, getChunkEntities, isExactEntityMismatch, normalizeWaveLabel, normalizeWaveGroup, repairOcrNumericNoise, parseMoneyText, validateParsedFeeStruct };`;
const requireFromFile = createRequire(path.join(root, 'src', 'engine', 'ragEngine.js'));
const sandbox = { module: { exports: {} }, exports: {}, require: requireFromFile, console, process, setTimeout, clearTimeout, Date, __dirname: path.join(root, 'src', 'engine'), __filename: path.join(root, 'src', 'engine', 'ragEngine.js') };
vm.createContext(sandbox);
vm.runInContext(wrap, sandbox);
const engine = sandbox.module.exports;
const item = {
  chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
  filename: 'PMB_2025_SK.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload',
  embedding: Array(64).fill(0)
};
const qe = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
console.log('entities:', engine.getChunkEntities(item));
console.log('parsed:', engine.parseFeeStructureFromChunk(item, qe));
console.log('feeStruct:', engine.parseFeeStructure([item], qe));
console.log('exactEntityMismatch:', engine.isExactEntityMismatch(qe, engine.getChunkEntities(item), item.chunk));
