const fs = require('fs');
const lines = fs.readFileSync('./src/engine/ragEngine.js', 'utf8').split('\n');
const startIdx = lines.findIndex(l => l.includes('function assessContextConsistency'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('function chunkText(text'));
if(startIdx >= 0 && endIdx > startIdx) {
  console.log(`Removing lines ${startIdx + 1} to ${endIdx}`);
  lines.splice(startIdx, endIdx - startIdx);
  fs.writeFileSync('./src/engine/ragEngine.js', lines.join('\n'));
  console.log('Fixed - removed broken functions');
} else {
  console.log(`Start: ${startIdx}, End: ${endIdx}`);
  process.exit(1);
}
