const fs = require('fs');
const path = require('path');
const p = path.join('src','data','rag_index.json');
const data = JSON.parse(fs.readFileSync(p,'utf8'));
const idx = 215;
const item = data[idx];
console.log('INDEX', idx);
console.log('trainingId', item.trainingId);
console.log('filename', item.filename);
console.log('program', item.program, 'programName', item.programName);
console.log('chunk preview:', item.chunk ? item.chunk.slice(0,400).replace(/\n/g,' ') : '<none>');
const tid = item.trainingId;
const same = data.filter((x,i)=>i!==idx && x.trainingId===tid);
console.log('same trainingId count', same.length);
for(let i=0;i<same.length;i++){
  const x=same[i];
  if(typeof x.chunk==='string' && /(biaya pendidikan per semester|ukt|per semester|dpp|pendaftaran)/i.test(x.chunk)){
    console.log('-- RELATED CHUNK', i, 'filename', x.filename, 'id', x.id);
    console.log(x.chunk.slice(0,500).replace(/\n/g,' '));
    console.log('---');
  }
}
console.log('done');
