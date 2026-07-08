const fs = require('fs');
const path = require('path');
const ragEngine = require('./src/engine/ragEngine');
const data = JSON.parse(fs.readFileSync('data/rag_index.json', 'utf8'));
const chunk = data.find(item => item.id === 'added-from-backup-1');
if (!chunk) {
  console.error('chunk not found');
  process.exit(1);
}
const queryEntities = {
  intent: 'COST',
  academicIntent: 'BIAYA',
  program: 'SI',
  wave: '1A',
  academicYear: '2025'
};
const question = 'berapa biaya SI gelombang 1A 2025?';
console.log('=== CHUNK METADATA BEFORE ===');
console.log(JSON.stringify({ id: chunk.id, filename: chunk.filename, academicYear: chunk.academicYear, program: chunk.program, wave: chunk.wave, partner: chunk.partner, trainingId: chunk.trainingId, source: chunk.source }, null, 2));
console.log('=== CHUNK ENTITY EXTRACT ===');
console.log(JSON.stringify(ragEngine.getChunkEntities(chunk), null, 2));
console.log('=== QUERY ENTITIES ===');
console.log(JSON.stringify(queryEntities, null, 2));
console.log('=== RUN tryStructuredExactCostAnswer ===');
const result = ragEngine.tryStructuredExactCostAnswer(question, queryEntities, [chunk], 3, null);
console.log('=== RESULT ===');
console.log(JSON.stringify(result, null, 2));
