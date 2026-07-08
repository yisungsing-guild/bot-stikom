const { tryStructuredExactCostAnswer } = require('./src/engine/ragEngine');
const queryEntities = { intent: 'COST', program: 'TI', wave: '1C', waveGroup: '1', academicYear: '2026' };
const chunks = [{
  chunk: 'PROGRAM STUDI TEKNOLOGI INFORMASI TA 2026/2027 Gelombang 1C\nPendaftaran Rp 500.000\nDana Pendidikan Pokok (DPP) Rp 14.000.000\nJas almamater, Topi, Kaos, Tas, GMTI',
  filename: 'ti_1c_biaya_detail.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload',
  embedding: Array(64).fill(0)
}];
const result = tryStructuredExactCostAnswer('berapa rincian biaya prodi ti gelombang 1C?', queryEntities, chunks, 3, Array(64).fill(0));
console.log('ANSWER_START');
console.log(result.answer);
console.log('ANSWER_END');
console.log('waveCount', String(result.answer).match(/Gelombang\b/gi)?.length || 0);
