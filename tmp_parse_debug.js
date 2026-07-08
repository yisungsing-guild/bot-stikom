const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('./src/engine/ragEngine.js', 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, require, console, process, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(code + '\nmodule.exports = { parseFeeStructureFromChunk, normalizeWaveLabel, normalizeWaveGroup, isGlobalWaveDiscountChunk };', sandbox);
const { parseFeeStructureFromChunk } = sandbox.module.exports;
const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
const item = {
  chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
  filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload',
  embedding: Array(64).fill(0)
};
const result = parseFeeStructureFromChunk(item, queryEntities);
console.log(JSON.stringify(result, null, 2));
