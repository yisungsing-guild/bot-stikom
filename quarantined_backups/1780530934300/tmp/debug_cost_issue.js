const engine = require('../src/engine/ragEngine');
const queryEntities = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
const chunks = [
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
for (const item of chunks) {
  const itemEntities = engine.getChunkEntities(item);
  const mismatch = engine.isExactEntityMismatch(queryEntities, itemEntities, item.chunk);
  const scoreObj = engine.computeExactEntityMatchScore(queryEntities, itemEntities);
  console.log('CHUNK', item.filename);
  console.log('entities', itemEntities);
  console.log('mismatch', mismatch);
  console.log('score', scoreObj);
  console.log('keywordScore', engine.getChunkKeywordScore(item.chunk, 'berapa biaya prodi sk gelombang 1A?')*20);
  console.log('parse', engine.parseFeeStructureFromChunk(item, queryEntities));
  console.log('---');
}
console.log('final result', JSON.stringify(engine.tryStructuredExactCostAnswer('berapa biaya prodi sk gelombang 1A?', queryEntities, chunks, 3, Array(64).fill(0)), null, 2));
