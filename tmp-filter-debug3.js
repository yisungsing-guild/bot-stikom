const { filterRelevantChunks } = require('./src/engine/ragEngine');
const scored = [
  { item: { chunk: 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.', filename: 'TI_profile.pdf', category: 'PROGRAM_STUDI', chunkType: 'GENERAL', excludeFromSearch: false, retrievalWeight: 1 } , score: 0.92}
];
console.log('no queryEntities', filterRelevantChunks('Apa itu TI?', scored, null).length);
console.log('intent only', filterRelevantChunks('Apa itu TI?', scored, { intent: 'ACADEMIC_PROGRAM' }).length);
console.log('queryEntities without academicIntent', filterRelevantChunks('Apa itu TI?', scored, { intent: 'ACADEMIC_PROGRAM', program: 'TI' }).length);
console.log('queryEntities with academicIntent', filterRelevantChunks('Apa itu TI?', scored, { intent: 'ACADEMIC_PROGRAM', program: 'TI', academicIntent: 'DEFINISI_PRODI' }).length);
