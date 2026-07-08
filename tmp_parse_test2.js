const rag = require('./src/engine/ragEngine');
const chunk = {
  chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
  filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload',
  embedding: Array(64).fill(0)
};
const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
const res = rag.tryStructuredExactCostAnswer('berapa biaya prodi sk gelombang 1A?', queryEntities, [
  {
    chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
    filename: 'PMB_2025_SK.pdf',
    updatedAt: new Date().toISOString(),
    source: 'upload',
    embedding: Array(64).fill(0)
  },
  chunk
], 3, Array(64).fill(0));
console.log('result', JSON.stringify(res, null, 2));
