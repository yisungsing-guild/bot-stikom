const rag = require('./src/engine/ragEngine');

console.log('\n========== TEST RAG QUERIES ==========\n');

// Test SI
console.log('▶ Test 1: "apa itu si"');
const result1 = rag.query('apa itu si', 8);
if (result1 && result1.answer) {
  console.log('✓ Answer:', result1.answer.substring(0, 250));
  console.log('  Source:', result1.source);
} else {
  console.log('✗ No answer returned');
}

console.log('\n▶ Test 2: "apa itu mi"');
const result2 = rag.query('apa itu mi', 8);
if (result2 && result2.answer) {
  console.log('✓ Answer:', result2.answer.substring(0, 250));
  console.log('  Source:', result2.source);
} else {
  console.log('✗ No answer returned');
}

console.log('\n▶ Test 3: "apa itu ti"');
const result3 = rag.query('apa itu ti', 8);
if (result3 && result3.answer) {
  console.log('✓ Answer:', result3.answer.substring(0, 250));
  console.log('  Source:', result3.source);
} else {
  console.log('✗ No answer returned');
}


