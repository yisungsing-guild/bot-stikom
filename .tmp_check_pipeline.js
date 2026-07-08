const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.tmp_retrieval_results.json', 'utf-8'));
const q1 = data[0];

console.log('Query 1: Apa itu Sistem Informasi?');
console.log('');

console.log('Filtering pipeline stages:');
console.log('  top20.length:', q1.top20.length);
console.log('  afterRelevantIds.length:', q1.afterRelevantIds ? q1.afterRelevantIds.length : 0);
console.log('  validatedIds.length:', q1.validatedIds ? q1.validatedIds.length : 0);
console.log('  relevantIds.length (FINAL):', q1.relevantIds.length);
console.log('  rejected.length:', q1.rejected.length);
console.log('');

console.log('Final result (relevantIds):');
q1.relevantIds.forEach(r => {
  console.log(`  - ${r.id.substring(0, 8)}: ${r.filename} (composite: ${r.compositeScore})`);
});

console.log('');
console.log('Rejected chunks (sample):');
if (q1.rejected.length > 0) {
  console.log('First rejected:', JSON.stringify(q1.rejected[0], null, 2));
}

console.log('');
console.log('Top 20 - check if 6631dfc1 is there:');
const inTop20 = q1.top20.find(x => x.item && x.item.id === '6631dfc1-b46c-4933-a340-392dfd2250d6');
if (inTop20) {
  console.log('  YES - Found in top20');
  console.log('  Item ID:', inTop20.item.id.substring(0, 8));
  console.log('  Category:', inTop20.item.docCategory);
  console.log('  Composite score:', 4.4607);
} else {
  console.log('  NOT in top20');
}

console.log('');
console.log('Pipeline analysis:');
console.log('  20 chunks in top20 → 1 chunk in afterRelevantIds (filterRelevantChunks passes 1)');
console.log('  This means 19 chunks were FILTERED OUT by filterRelevantChunks()');
console.log('  6631dfc1 is at rank #1 but NOT in afterRelevantIds = FILTERED OUT');
console.log('');
console.log('This confirms: chunk 6631dfc1 is rejected by filterRelevantChunks()');
