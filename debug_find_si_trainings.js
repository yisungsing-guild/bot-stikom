const fs = require('fs');
const index = JSON.parse(fs.readFileSync('src/data/rag_index.json','utf8'));

const matches = [];
for (const it of index) {
  const program = (it.program || '').toString().toLowerCase();
  const pname = (it.programName || '').toString().toLowerCase();
  const chunk = (it.chunk || '').toString().toLowerCase();
  const filename = (it.filename || '').toString().toLowerCase();
  const conditions = [];
  if (program && (program === 'si' || program.includes('sistem informasi') || program.includes('sistem'))) conditions.push('program');
  if (pname && (pname.includes('sistem informasi') || pname.includes('sistem'))) conditions.push('programName');
  if (chunk && chunk.includes('sistem informasi')) conditions.push('chunk');
  if (filename && filename.includes('sistem informasi')) conditions.push('filename');
  if (conditions.length>0) matches.push({id: it.id, trainingId: it.trainingId, program: it.program, programName: it.programName, filename: it.filename, reasons: conditions});
}

console.log('Matches:', matches.length);
console.log(matches.slice(0,20));
// unique training ids
const tids = new Set(matches.map(m=>m.trainingId));
console.log('TrainingIds:', Array.from(tids));
