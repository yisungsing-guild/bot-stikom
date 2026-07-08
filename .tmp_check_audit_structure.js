const data = require('./.tmp_retrieval_results.json');
const q1 = data[0];

console.log('Query 1: Apa itu Sistem Informasi?');
console.log('Top 20 structure check:');
console.log('  top20 is array:', Array.isArray(q1.top20));
console.log('  top20 length:', q1.top20.length);
console.log('');

if (typeof q1.top20[0] === 'object') {
  console.log('Structure: Array of objects with item property');
  console.log('');
  console.log('First 5 top20 items (IDs and scores):');
  q1.top20.slice(0, 5).forEach((x, i) => {
    const item = x.item || {};
    console.log(`  ${i+1}. ID: ${item.id}`);
    console.log(`     Category: ${item.docCategory}, Program: ${item.program}`);
    console.log(`     Semantic: ${x.semantic}, Composite: ${x.composite}`);
    console.log('');
  });
}

console.log('Relevant IDs (passed filter):');
q1.relevantIds.forEach(id => {
  console.log(`  - ${id}`);
});

console.log('');
console.log('Check if 6631dfc1 is in top20:');
const found = q1.top20.find(x => x.item && x.item.id === '6631dfc1-b46c-4933-a340-392dfd2250d6');
if (found) {
  console.log(`  YES - Rank #${q1.top20.indexOf(found) + 1}`);
  console.log(`  Composite score: ${found.composite}`);
  console.log(`  In relevant IDs: ${q1.relevantIds.includes(found.item.id)}`);
} else {
  console.log('  NOT FOUND IN TOP 20');
}
