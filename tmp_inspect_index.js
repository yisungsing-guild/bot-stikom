const fs = require('fs');
const path = require('path');
const idx = JSON.parse(fs.readFileSync(path.join('src','data','rag_index.json'),'utf8'));
const mi = idx.filter(it => {
  const txt = String(it.chunk || '').toLowerCase();
  return txt.includes('manajemen informatika') || txt.includes('manajemen informasi') || txt.includes('manajemeninformatika') || txt.includes('manajemeninformasi');
});
console.log('MI count', mi.length);
const cats = {};
const filenames = {};
mi.forEach(it => {
  const cat = it.docCategory || it.category || 'NONE';
  cats[cat] = (cats[cat] || 0) + 1;
  const f = String(it.filename || it.trainingId || '');
  filenames[f] = (filenames[f] || 0) + 1;
});
console.log('cats', cats);
console.log('files', Object.entries(filenames).sort((a,b) => b[1]-a[1]).slice(0,20));
const progs = ['SK','SI','TI','BD'];
for(const prog of progs){
  const items = idx.filter(it => {
    const txt = String(it.chunk || '').toLowerCase();
    if(prog === 'SK') return txt.includes('sistem komputer') || txt.includes('sistemkomputer');
    if(prog === 'SI') return txt.includes('sistem informasi') || txt.includes('sisteminformasi');
    if(prog === 'TI') return txt.includes('teknologi informasi') || txt.includes('technologiinformasi');
    if(prog === 'BD') return txt.includes('bisnis digital') || txt.includes('bisnisdigital');
    return false;
  });
  console.log(prog, 'count', items.length, 'cats', [...new Set(items.map(it => it.docCategory || it.category || 'NONE'))].sort());
}
