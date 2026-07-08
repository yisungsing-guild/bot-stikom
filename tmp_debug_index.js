const rag = require('./src/engine/ragEngine');
const fullIndex = (typeof rag.loadIndex === 'function') ? rag.loadIndex() : [];
console.log('len=' + fullIndex.length);
console.log('path=' + (typeof rag.getIndexPath === 'function' ? rag.getIndexPath() : 'NO_PATH'));
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const candidates = fullIndex.filter(item => item && item.chunk && keyRe.test(item.chunk) && (/RINCIAN\s*BIAYA\s*PENDIDIKAN/i.test(item.chunk) || /RINCIANBIAYAPENDIDIKAN/i.test(item.chunk)));
console.log('candidateCount=' + candidates.length);
console.log(JSON.stringify(candidates.slice(0,20).map(c => ({id:c.id, trainingId:c.trainingId, filename:c.filename, preview:c.chunk.slice(0,200)})), null, 2));
