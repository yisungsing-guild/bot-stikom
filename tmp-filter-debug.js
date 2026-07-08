const { filterRelevantChunks, getChunkEntities } = require('./src/engine/ragEngine');
const queryEntities = { intent: 'ACADEMIC_PROGRAM', academicIntent: 'DEFINISI_PRODI', program: 'TI' };
const scored = [
  { item: { chunk: 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.', filename: 'TI_profile.pdf', category: 'PROGRAM_STUDI', chunkType: 'GENERAL', excludeFromSearch: false, retrievalWeight: 1 } , score: 0.92},
  { item: { chunk: 'Biaya pendaftaran TI Rp 600.000 untuk calon mahasiswa baru.', filename: 'TI_biaya.pdf', category: 'BIAYA', chunkType: 'GENERAL', excludeFromSearch: false, retrievalWeight: 1 }, score: 0.89},
  { item: { chunk: 'MOU kerja sama TI dengan mitra industri dan lembaga.', filename: 'TI_mou.pdf', category: 'SK', chunkType: 'GENERAL', excludeFromSearch: false, retrievalWeight: 1 }, score: 0.85}
];
const filtered = filterRelevantChunks('Apa itu TI?', scored, queryEntities);
console.log('filtered.length', filtered.length);
console.log(filtered.map(f => ({chunk:f.item.chunk, category:f.item.category, program:getChunkEntities(f.item).program})));
