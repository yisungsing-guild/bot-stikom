const fs = require('fs');
const raw = fs.readFileSync('.tmp_retrieval_results.json','utf-8');
const data = JSON.parse(raw);
let found = 0;
for (let i = 0; i < data.length; i++) {
  const item = data[i];
  const chunk = item && item.chunk ? String(item.chunk) : '';
  if (chunk.includes('250.000') || chunk.includes('Rp.250.000') || chunk.includes('250000')) {
    found++;
    console.log('MATCH INDEX', i, 'id=', item.id, 'filename=', item.filename, 'sourceFile=', item.sourceFile, 'ocrQualityScore=', item.ocrQualityScore, 'source=', item.source);
    console.log('chunk preview=', chunk.substring(0, 200).replace(/\n/g, ' '));
    if (found >= 10) break;
  }
}
console.log('found', found);
