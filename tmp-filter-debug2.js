const { filterRelevantChunks, getChunkEntities, isAcademicProgramBlacklistChunk, chunkMatchesAcademicIntent, tokenizeForRelevanceGuard } = require('./src/engine/ragEngine');
const queryEntities = { intent: 'ACADEMIC_PROGRAM', academicIntent: 'DEFINISI_PRODI', program: 'TI' };
const scored = [
  { item: { chunk: 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.', filename: 'TI_profile.pdf', category: 'PROGRAM_STUDI', chunkType: 'GENERAL', excludeFromSearch: false, retrievalWeight: 1 } , score: 0.92}
];
const s = scored[0];
const chunk = String(s.item.chunk).trim();
const lower = chunk.toLowerCase();
console.log('chunk', chunk);
console.log('isAcademicProgramBlacklistChunk', isAcademicProgramBlacklistChunk(chunk, s.item.filename, s.item.category));
console.log('chunkMatchesAcademicIntent', chunkMatchesAcademicIntent(chunk, s.item, 'DEFINISI_PRODI', queryEntities));
console.log('tokenizeForRelevanceGuard', tokenizeForRelevanceGuard('Apa itu TI?'));
console.log('lower includes ti', /\b(?:ti|teknologi informasi)\b/i.test(lower));
console.log('programPattern test', /\b(program\s+studi|program|prodi|internasional|double\s+degree|dual\s+degree|dnui|help\s+university|utb|china|bali|study\s+abroad)\b/i.test(lower));
console.log('costPattern', /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran)\b/i.test(lower));
console.log('schedulePattern', /\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar\s+ulang|penutupan)\b/i.test(lower));
console.log('normalized program mentions', lower.match(/\b(?:si|sistem informasi)\b|\b(?:ti|teknologi informasi)\b|\b(?:bd|bisnis digital)\b|\b(?:sk|sistem komputer)\b|\b(?:mi|manajemen informatika|manajemen informasi)\b/gi));
console.log('chunk type', s.item.chunkType);
console.log('category', s.item.category);
console.log('queryEntities', queryEntities);
console.log('filterRelevantChunks result', filterRelevantChunks('Apa itu TI?', scored, queryEntities).map(f => f.item));
