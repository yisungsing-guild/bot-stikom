const fs = require('fs');
const path = require('path');
const qfile = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
const dfile = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
const qs = fs.readFileSync(qfile, 'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(o=>({question:o.question,timestamp:new Date(o.timestamp).getTime(),detectedIntent:o.detectedIntent,before:o.beforeFiltering?.chunks?.length||0,after:o.afterFiltering?.count||0}));
const ds = fs.readFileSync(dfile, 'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)).map(o=>({ts:new Date(o.timestamp).getTime(),intent:o.intent,reason:o.reason,category:o.docCategory,file:o.sourceFile}));
qs.sort((a,b)=>a.timestamp-b.timestamp);
for(let i=0;i<qs.length;i++){
  const q=qs[i];
  const next = i+1<qs.length?qs[i+1].timestamp:Infinity;
  console.log('----');
  console.log('query',q.question,q.detectedIntent,q.timestamp,'next',next);
  const slice=ds.filter(d=>d.ts>=q.timestamp && d.ts<next);
  console.log('slice count',slice.length);
  const reasons={};
  slice.forEach(d=>{ reasons[d.reason]=(reasons[d.reason]||0)+1; });
  console.log('reasons',reasons);
  if(slice.length<=30){ slice.forEach(d=>console.log(' ',new Date(d.ts).toISOString(),d.intent,d.reason,d.category,d.file)); }
}
