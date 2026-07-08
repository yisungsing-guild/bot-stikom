const fs = require('fs');
const raw = fs.readFileSync('.tmp_retrieval_results.json', 'utf-8');
const data = JSON.parse(raw);
let nullSourceFile = 0;
let zeroOcr = 0;
let noOcrKey = 0;
for (let i = 0; i < data.length; i++) {
  const item = data[i];
  if (item.sourceFile === null) nullSourceFile++;
  if (item.ocrQualityScore === 0) zeroOcr++;
  if (!Object.prototype.hasOwnProperty.call(item, 'ocrQualityScore')) noOcrKey++;
}
console.log('total items', data.length);
console.log('sourceFile null', nullSourceFile);
console.log('ocrQualityScore exactly 0', zeroOcr);
console.log('missing ocrQualityScore property', noOcrKey);
console.log('sample item with sourceFile null:', data.find(item => item.sourceFile === null && item.chunk && String(item.chunk).includes('Gelombang')) ? data.find(item => item.sourceFile === null && item.chunk && String(item.chunk).includes('Gelombang')) : 'none');
