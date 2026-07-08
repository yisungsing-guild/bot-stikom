const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'rag_index.json'), 'utf8'));
const tid = '2580a44c-dffa-4ccc-88b3-6dcf4c7b42ae';
const entries = data.filter(item => item.trainingId === tid);
console.log('count', entries.length);
for (const item of entries) {
  const c = String(item.chunk || '');
  if (/ukt|biaya pendidikan per semester|uang kuliah tunggal|biaya semester|biaya.*per semester|dpp|pendaftaran|registrasi|gelombang/i.test(c)) {
    const idx = c.search(/213225/);
    if (idx !== -1) {
      console.log('FOUND 213225 in chunk', item.id, item.filename, item.chunkType, item.sectionTitle);
      const start = Math.max(0, idx - 100);
      const end = Math.min(c.length, idx + 100);
      console.log(c.slice(start,end).replace(/\n/g,' '));
    }
  }
}
for (const item of entries) {
  if (/213225/.test(String(item.chunk || ''))) {
    const c = String(item.chunk || '');
    console.log('course chunk', item.id, item.filename, item.chunkType, item.sectionTitle);
    const idx = c.indexOf('213225');
    console.log(c.slice(Math.max(0, idx-100), Math.min(c.length, idx+100)).replace(/\n/g,' '));
  }
}
