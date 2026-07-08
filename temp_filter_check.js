const path = require('path');
const fs = require('fs');
const rag = require(path.join(__dirname, 'src', 'engine', 'ragEngine.js'));
const idx = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8') || '[]');
const query = 'Apa itu Sistem Informasi?';
const queryEntities = { intent: 'ACADEMIC_PROGRAM', program: 'SI', programLabel: 'SISTEM_INFORMASI', category: 'PROGRAM_STUDI', academicIntent: 'DEFINISI_PRODI' };
const targetIds = new Set(['6631dfc1-b46c-4933-a340-392dfd2250d6', '618a0474-969a-463f-91cd-c010a27beb48', '8491b972-ee0b-4806-bd7e-8508c61ed46b']);
const top = idx.filter(item => targetIds.has(item.id));
console.log('found', top.length);
for (const item of top) {
  const keep = rag.filterRelevantChunks(query, [{ item, score: 0.1, compositeScore: 1, finalScore: 1 }], queryEntities).length > 0;
  console.log(item.id, item.filename, item.category, item.docCategory, 'keep?', keep, 'program', item.program);
}
