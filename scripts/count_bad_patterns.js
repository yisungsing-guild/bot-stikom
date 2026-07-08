const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const s = fs.readFileSync(filePath, 'utf8');
const patterns = [
  'SMK TI Bali Global',
  'SMK Pandawa Bali Global',
  'SMK TI',
  'SMK Pandawa',
  'sekolah tertentu',
  'ΓÇó', 'ΓÇ—', 'ΓÇª', 'ΓÇ£', 'ΓÇ¥', 'ΓÇÿ', 'ΓÇÖ']
;
for (const p of patterns) {
  const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const m = s.match(re);
  console.log(p, '=>', m ? m.length : 0);
}
