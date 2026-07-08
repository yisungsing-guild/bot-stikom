const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join("src","data","rag_index.json"), "utf8");
const arr = JSON.parse(raw);
const byProgramSI = arr.filter(item => item && item.program && String(item.program).toUpperCase() === 'SI');
console.log('total SI program items:', byProgramSI.length);
const matches = arr.filter(item => item && item.chunk && /Rp\.?\s*250\.000/.test(item.chunk));
console.log('total Rp 250k chunks:', matches.length);
const matchSI = matches.filter(item => item && ((item.program && String(item.program).toUpperCase()==='SI') || /SI|SISTEM\s+INFORMASI/i.test(item.chunk + ' ' + (item.filename||''))));
console.log('Rp 250k SI candidate count:', matchSI.length);
for (const item of matchSI.slice(0,20)) {
  console.log('---');
  console.log('id', item.id);
  console.log('trainingId', item.trainingId);
  console.log('filename', item.filename);
  console.log('program', item.program, 'wave', item.wave, 'waveGroup', item.waveGroup, 'academicYear', item.academicYear, 'category', item.category, 'source', item.source);
  console.log(item.chunk.split(/\r?\n/).slice(0,10).join(' | '));
}
const glob = arr.filter(item => item && item.chunk && /Potongan|Diskon|Gelombang|Registrasi|Pendaftaran/i.test(item.chunk) && /1A/i.test(item.chunk));
console.log('glob 1A candidate count:', glob.length);
for (const item of glob.slice(0,20)) {
  console.log('###'); console.log(item.id, item.program, item.wave, item.waveGroup, item.filename);
  console.log(item.chunk.split(/\r?\n/).slice(0,10).join(' | '));
}
