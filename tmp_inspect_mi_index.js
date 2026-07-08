const fs = require('fs');
const path = require('path');
const idxPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
const data = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
const items = data.items || [];
const mi = items.filter(i => {
  const text = String(i.chunk || '') + ' ' + String(i.filename || '') + ' ' + String(i.category || i.docCategory || '');
  return /\b(mi|manajemen informatika|manajemen informasi)\b/i.test(text);
});
console.log('MI count', mi.length);
const cats = {};
const files = {};
mi.forEach(i => {
  const cat = (i.category || i.docCategory || 'UNKNOWN').toUpperCase();
  cats[cat] = (cats[cat] || 0) + 1;
  const fn = i.filename || i.trainingId || 'unknown';
  files[fn] = (files[fn] || 0) + 1;
});
console.log('cats', cats);
console.log('files', Object.entries(files).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v]));
const sample = mi.slice(0, 50).map(i=>({id:i.id,filename:i.filename,category:(i.category||i.docCategory||'UNKNOWN'),text:(String(i.chunk||'').replace(/\n/g,' ')).substring(0,250)}));
console.log(JSON.stringify(sample, null,2));
