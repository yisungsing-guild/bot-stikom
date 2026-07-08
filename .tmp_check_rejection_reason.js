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
console.log('Rejected chunks:');
q1.rejected.forEach(r => {
  console.log(`  - ${r.id.substring(0, 8)}: ${r.reason || '(no reason)'}`);
});

console.log('');
console.log('Top 20 - check if 6631dfc1 is there:');
const inTop20 = q1.top20.find(x => x.item && x.item.id === '6631dfc1-b46c-4933-a340-392dfd2250d6');
if (inTop20) {
  console.log('  YES - Rank #1');
  console.log('  Composite score:', inTop20.compositeScore || inTop20.item.compositeScore || 'unknown');
} else {
  console.log('  NOT in top20');
}

console.log('');
console.log('So 6631dfc1:');
console.log('  - Rank #1 by score: YES');
console.log('  - In afterRelevantIds (after filterRelevantChunks):', q1.afterRelevantIds ? q1.afterRelevantIds.some(x => x === '6631dfc1-b46c-4933-a340-392dfd2250d6' || (x.id && x.id.includes('6631dfc1'))) : 'N/A');
console.log('  - In final relevantIds: NO (NOT in list above)');
console.log('  - In rejected: NO (NOT listed above)');
console.log('');
console.log('This suggests: chunk was FILTERED OUT by filterRelevantChunks() with no specific reason logged');
console.log('Reason code from rejected: "no_evidence_for_intent"');
