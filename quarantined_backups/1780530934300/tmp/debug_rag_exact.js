const path = require('path');
const { tryStructuredExactCostAnswer } = require(path.join(__dirname, '..', 'src', 'engine', 'ragEngine'));
const chunks1 = [
  {
    chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
    filename: 'PMB_2025_SK.pdf',
    updatedAt: new Date().toISOString(),
    source: 'upload',
    embedding: Array(64).fill(0)
  },
  {
    chunk: 'Potongan Biaya Pendaftaran: Rp 200.000, Jika Mendaftar pada Gelombang 1\nPotongan DPP: Rp 1.000.000, Gelombang 1',
    filename: 'PMB_2025_GLOBAL_DISCOUNT.pdf',
    updatedAt: new Date().toISOString(),
    source: 'upload',
    embedding: Array(64).fill(0)
  }
];
const q1 = 'berapa biaya prodi sk gelombang 1A?';
const qe1 = { intent:'COST', program:'SK', wave:'1A', waveGroup:'1', academicYear:'2025', campus:'BALI' };
const res1 = tryStructuredExactCostAnswer(q1, qe1, chunks1, 3, Array(64).fill(0));
console.log(JSON.stringify(res1, null, 2));
