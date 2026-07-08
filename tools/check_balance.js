const fs = require('fs');
const s = fs.readFileSync('src/engine/ragEngine.js','utf8');
function count(re) { return (s.match(re)||[]).length }
const counts = {
  curlyOpen: count(/\{/g),
  curlyClose: count(/\}/g),
  parenOpen: count(/\(/g),
  parenClose: count(/\)/g),
  squareOpen: count(/\[/g),
  squareClose: count(/\]/g),
  backticks: count(/`/g),
  singleQuotes: count(/'/g),
  doubleQuotes: count(/"/g)
};
console.log(JSON.stringify(counts, null, 2));
// Print last 50 lines for manual inspection
const lines = s.split(/\r?\n/);
console.log('\n--- LAST 200 LINES ---\n');
console.log(lines.slice(-200).join('\n'));
