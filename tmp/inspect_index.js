const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(path.join('src','data','rag_index.json'),'utf8');
const arr = JSON.parse(raw);
const matches = arr.filter(item => item && item.chunk && /Rp\.?\s*250\.000/i.test(item.chunk));
console.log('matches', matches.length);
for (const item of matches.slice(0, 50)) {
  console.log('---');
  console.log('id', item.id);
  console.log('trainingId', item.trainingId);
  console.log('filename', item.filename);
  console.log('program', item.program, 'wave', item.wave, 'waveGroup', item.waveGroup, 'academicYear', item.academicYear, 'category', item.category, 'source', item.source);
  console.log('chunkExcerpt', String(item.chunk || '').substring(0, 320).replace(/\r?\n/g, ' | '));
}
const siMatches = matches.filter(item => item && ((item.program && String(item.program).toUpperCase() === 'SI') || /\bSISTEM INFORMASI\b/i.test(String(item.chunk || '')) || /\bSI\b/.test(String(item.chunk || ''))));
console.log('siMatches', siMatches.length);
for (const item of siMatches.slice(0, 50)) {
  console.log('***');
  console.log('id', item.id);
  console.log('filename', item.filename);
  console.log('program', item.program, 'wave', item.wave, 'waveGroup', item.waveGroup, 'academicYear', item.academicYear);
  console.log('chunkExcerpt', String(item.chunk || '').substring(0, 420).replace(/\r?\n/g, ' | '));
}
