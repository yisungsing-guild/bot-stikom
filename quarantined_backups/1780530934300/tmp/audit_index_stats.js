const fs = require('fs');
const path = require('path');
const idxPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
const programs = {};
const categories = {};
const mi = [];
const sk = [];
for (const item of idx) {
  const prog = (item.metadata && item.metadata.program) || item.program || item.docCategory || item.category || 'UNKNOWN';
  const p = prog || 'UNKNOWN';
  programs[p] = (programs[p] || 0) + 1;
  const cat = String(item.docCategory || item.category || 'UNKNOWN').toUpperCase();
  categories[cat] = (categories[cat] || 0) + 1;
  const programField = ((item.metadata && item.metadata.program) || item.program || '').toString();
  if (/manajemen informasi|\bmi\b/i.test(programField)) mi.push(item);
  if (/sistem komputer|\bsk\b/i.test(programField)) sk.push(item);
}
console.log('total', idx.length);
console.log('programCounts', JSON.stringify(programs, null, 2));
console.log('categoryCounts', JSON.stringify(categories, null, 2));
console.log('MI count', mi.length, 'SK count', sk.length);
const miCats = {};
for (const item of mi) {
  const cat = String(item.docCategory || item.category || 'UNKNOWN').toUpperCase();
  miCats[cat] = (miCats[cat] || 0) + 1;
}
console.log('MI categories', JSON.stringify(miCats, null, 2));
const skCats = {};
for (const item of sk) {
  const cat = String(item.docCategory || item.category || 'UNKNOWN').toUpperCase();
  skCats[cat] = (skCats[cat] || 0) + 1;
}
console.log('SK categories', JSON.stringify(skCats, null, 2));
const miFiles = Array.from(new Set(mi.map(i => i.filename || i.file || i.trainingId || 'unknown')));
console.log('MI files', miFiles.slice(0, 50));
const skFiles = Array.from(new Set(sk.map(i => i.filename || i.file || i.trainingId || 'unknown')));
console.log('SK files', skFiles.slice(0, 50));
