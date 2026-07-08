const fs = require('fs');
const rag = require('./src/engine/ragEngine');
const index = JSON.parse(fs.readFileSync(rag.getIndexPath(),'utf8'));

const targets = ['rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf','rincian Biaya D3 Tahun Ajaran 2026-2027.pdf','rincian Biaya SK Tahun Ajaran 2026-2027.pdf','rincian Biaya UTB Tahun Ajaran 2026-2027.pdf','rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf','rincian Biaya HELP Tahun Ajaran 2026-2027.pdf'];
for(const t of targets){
  const found = index.filter(it => (it.filename && it.filename.indexOf(t.replace(/\s+/g,' ').trim())!==-1) || (it.filename && it.filename.toLowerCase().indexOf(t.toLowerCase())!==-1) || (it.metadata && it.metadata.source && it.metadata.source.indexOf(t)!==-1));
  console.log('===',t,'found',found.length);
  for(const f of found){
    console.log({id:f.id, filename: f.filename, trainingId: f.trainingId, metadata: f.metadata});
    console.log('chunk preview:', String(f.chunk||'').substring(0,200));
    console.log('entities:', rag.getChunkEntities(f));
  }
}
