const fs = require('fs');
const raw = fs.readFileSync('src/data/rag_index.json', 'utf8');
const data = JSON.parse(raw);
console.log('len=' + data.length);
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const pat2 = /(RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN)/i;
const found = data.filter(item => item && item.chunk && keyRe.test(item.chunk) && pat2.test(item.chunk));
console.log('candidateCount=' + found.length);
console.log(JSON.stringify(found.slice(0,10).map(x => ({ id: x.id, trainingId: x.trainingId, filename: x.filename, chunkPreview: x.chunk.slice(0,200).replace(/\n/g,' ') })), null, 2));
