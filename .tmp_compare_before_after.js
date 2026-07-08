const fs = require('fs');
const path = require('path');
const beforePath = path.join(__dirname, '.tmp_retrieval_results.before.json');
const afterPath = path.join(__dirname, '.tmp_retrieval_results.json');
if (!fs.existsSync(afterPath)) { console.error('Missing after file:', afterPath); process.exit(1); }
const before = fs.existsSync(beforePath) ? JSON.parse(fs.readFileSync(beforePath,'utf8')) : null;
const after = JSON.parse(fs.readFileSync(afterPath,'utf8'));
const queries = ['Apa itu Sistem Informasi?','Apa prospek kerja Sistem Informasi?','Apa yang dipelajari di Sistem Informasi?'];
const out = { timestamp: new Date().toISOString(), comparisons: [] };
for (let i=0;i<queries.length;i++){
  const q = queries[i];
  const beforeEntry = (before && before[i]) || null;
  const afterEntry = after[i] || null;
  const bFiltered = beforeEntry ? (beforeEntry.filteredIds || beforeEntry.filteredIds || []) : [];
  const aFiltered = afterEntry ? (afterEntry.filteredIds || afterEntry.filteredIds || []) : [];
  const bTop10 = bFiltered.slice(0,10).map(x=>({rank:x.rank,id:x.id,filename:x.filename,docCategory:x.docCategory,composite:x.compositeScore}));
  const aTop10 = aFiltered.slice(0,10).map(x=>({rank:x.rank,id:x.id,filename:x.filename,docCategory:x.docCategory,composite:x.compositeScore}));
  out.comparisons.push({ question: q, before: { exists: !!beforeEntry, count: bFiltered.length, top10: bTop10 }, after: { exists: !!afterEntry, count: aFiltered.length, top10: aTop10 } });
}
fs.writeFileSync(path.join(__dirname,'.tmp_compare_results.json'), JSON.stringify(out,null,2),'utf8');
console.log('WROTE .tmp_compare_results.json');
