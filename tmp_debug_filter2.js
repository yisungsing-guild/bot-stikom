const r = require('./src/engine/ragEngine');
const queryEntities = { intent: 'ACADEMIC_PROGRAM', academicIntent: 'DEFINISI_PRODI', program: 'TI' };
const question = 'Apa itu TI?';
const scored = [
  {
    item: {
      chunk: 'Program Studi Teknologi Informasi adalah program yang mempelajari sistem informasi dan teknologi jaringan.',
      filename: 'TI_profile.pdf',
      category: 'PROGRAM_STUDI',
      chunkType: 'GENERAL',
      excludeFromSearch: false,
      retrievalWeight: 1
    },
    score: 0.92
  }
];
console.log('intent', queryEntities.intent);
console.log('question', question);
console.log('tokens', r.tokenizeForRelevanceGuard(question));
console.log('detectIntent', r.detectIntent ? r.detectIntent(question) : 'not exported');
for (const s of scored) {
  const chunk = String((s.item && s.item.chunk) || '').trim();
  const lower = chunk.toLowerCase();
  console.log('---');
  console.log('chunk:', chunk);
  console.log('isHeaderFooter?', r.isHeaderFooterChunk(chunk));
  console.log('isAdminInternal?', r.isAdminInternalChunk(chunk, s.item.filename));
  console.log('isAcademicProgramBlacklist?', r.isAcademicProgramBlacklistChunk(chunk, s.item.filename, s.item.docCategory));
  console.log('lower costPattern', /\b(biaya|dpp|ukt|pendaftaran|potongan|diskon|spp|uang\s+kuliah|uang\s+pendaftaran)\b/i.test(lower));
  console.log('chunkType', s.item.chunkType);
  console.log('requestedProgramMatch', queryEntities.program ? ((r.getChunkEntities(s.item).program || '').toUpperCase() === queryEntities.program) : null);
}
const filtered = r.filterRelevantChunks(question, scored, queryEntities);
console.log('filtered len', filtered.length);
console.log(filtered.map(f => ({ category: f.item.category, chunk: f.item.chunk })));

