const path = require('path');
const { parseFeeStructureFromChunk } = require('./src/engine/ragEngine');
const chunk = {
  chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
  filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload'
};
const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
console.log(parseFeeStructureFromChunk(chunk, queryEntities));
