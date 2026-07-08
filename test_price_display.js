#!/usr/bin/env node
const { tryStructuredProgramComparisonAnswer } = require('./src/engine/ragEngine.js');

console.log('='.repeat(80));
console.log('TEST QUERY: "prodi s1 mana yang paling murah"');
console.log('='.repeat(80));
const result1 = tryStructuredProgramComparisonAnswer('prodi s1 mana yang paling murah');
console.log(result1.answer);

console.log('\n' + '='.repeat(80));
console.log('TEST QUERY: "bandingkan biaya semua prodi"');
console.log('='.repeat(80));
const result2 = tryStructuredProgramComparisonAnswer('bandingkan biaya semua prodi');
console.log(result2.answer);

console.log('\n' + '='.repeat(80));
console.log('TEST QUERY: "Mana yang paling mahal, SI atau TI?"');
console.log('='.repeat(80));
const result3 = tryStructuredProgramComparisonAnswer('Mana yang paling mahal, SI atau TI?');
console.log(result3.answer);

console.log('\n' + '='.repeat(80));
console.log('TEST QUERY: "berapa biaya SI?"');
console.log('='.repeat(80));
const result4 = tryStructuredProgramComparisonAnswer('berapa biaya SI?');
if (result4) {
  console.log(result4.answer);
} else {
  console.log('(No structured answer - will fallback to other handlers)');
}
