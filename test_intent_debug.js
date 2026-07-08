const rag = require('./src/engine/ragEngine');

console.log('\n=== DEBUG INTENT DETECTION ===\n');

const question = 'apa itu si';
console.log('Question:', question);
console.log('Expected to extract:');
console.log('- intent: ACADEMIC_PROGRAM');
console.log('- program: SI');
console.log('- academicIntent: DEFINISI_PRODI');

const result = rag.query(question, 8);

console.log('\nResult (if any):', {
  success: result && result.answer ? true : false,
  answer: result && result.answer ? result.answer.substring(0, 150) : 'NONE'
});
