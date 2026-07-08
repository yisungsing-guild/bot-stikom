const rag = require('./src/engine/ragEngine');
const fs = require('fs');

// Read from source code to find normalizeQueryForRetrieval
// and manually test it
const text = fs.readFileSync('src/engine/ragEngine.js', 'utf8');

// Find and extract the function
const startIdx = text.indexOf('function normalizeQueryForRetrieval(rawQuery)');
const endIdx = text.indexOf('\nfunction ', startIdx + 10);
const functionCode = text.substring(startIdx, endIdx);

// Execute the extracted code to get the function
eval(functionCode.replace('function normalizeQueryForRetrieval', 'var normalizeQueryForRetrieval'));

// Test query expansion
console.log('=== QUERY EXPANSION TEST ===\n');

const queries = ['apa itu si', 'apa itu mi', 'apa itu ti', 'biaya si'];

queries.forEach(q => {
  const expanded = normalizeQueryForRetrieval(q);
  console.log(`Query: "${q}"`);
  console.log(`Expanded: "${expanded}"`);
  console.log('---');
});
