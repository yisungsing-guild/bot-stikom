const { getRagIndexPath } = require('../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');
const idxPath = getRagIndexPath();
const raw = fs.readFileSync(idxPath,'utf8');
const arr = JSON.parse(raw);
const queries = [
  'Apa itu TI',
  'Apa itu Teknologi Informasi',
  'Apa itu SI',
  'Apa itu Sistem Informasi',
  'TI belajar apa saja',
  'Prospek kerja TI'
];
const targetFiles = [
  'Penjelasan Semua Program Studi.pdf',
  'Penjelasan Prodi dan Karier Masa Depan.xlsx'
];
function tokenize(s){
  return (s||'').toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
}
// build df
const docs = arr.map(e=>({ id: e.id, filename: e.filename||e.file||null, docCategory: e.docCategory||e.category||null, text: (e.chunk||'') }));
const N = docs.length;
const df = Object.create(null);
const tfs = [];
for(let i=0;i<N;i++){
  const toks = tokenize(docs[i].text);
  const tf = Object.create(null);
  for(const t of toks){ tf[t] = (tf[t]||0)+1; }
  tfs.push({tf, len: toks.length});
  const seen = new Set();
  for(const t of Object.keys(tf)){
    if(!seen.has(t)){ df[t]=(df[t]||0)+1; seen.add(t); }
  }
}
function tfidfVector(tfObj){
  const vec = Object.create(null);
  for(const [term,count] of Object.entries(tfObj)){
    const idf = Math.log((N+1)/(1+(df[term]||0)))+1;
    vec[term] = count * idf;
  }
  return vec;
}
const docVecs = tfs.map(x=>tfidfVector(x.tf));
function dot(a,b){
  let s=0;
  for(const k in a){ if(b[k]) s+=a[k]*b[k]; }
  return s;
}
function norm(a){ let s=0; for(const k in a) s+=a[k]*a[k]; return Math.sqrt(s); }
function scoreVec(qVec, docVec){
  const d = dot(qVec, docVec);
  const na = norm(qVec); const nb = norm(docVec);
  if(na===0||nb===0) return 0;
  return d/(na*nb);
}
function vecFromText(text){
  const toks = tokenize(text);
  const tf = Object.create(null);
  for(const t of toks) tf[t]=(tf[t]||0)+1;
  return tfidfVector(tf);
}
for(const q of queries){
  const qVec = vecFromText(q);
  const scored = [];
  for(let i=0;i<N;i++){
    const s = scoreVec(qVec, docVecs[i]);
    scored.push({ id: docs[i].id, filename: docs[i].filename, docCategory: docs[i].docCategory, score: s, chunk: docs[i].text.slice(0,500) });
  }
  scored.sort((a,b)=>b.score-a.score);
  console.log('\n=== Query:', q, '===');
  const top = scored.slice(0,20);
  top.forEach((r,idx)=>{
    const flag = targetFiles.includes(r.filename) ? '<<TARGET FILE' : '';
    console.log(`${String(idx+1).padStart(2)}. id:${r.id} score:${r.score.toFixed(6)} file:${r.filename||'N/A'} docCategory:${r.docCategory||'N/A'} ${flag}`);
  });
  // report if any target files present
  const present = top.filter(r=>targetFiles.includes(r.filename));
  if(present.length===0) console.log('-> No chunk from target files in Top 20 for this query');
  else{
    console.log('-> Target file chunks in Top20:');
    present.forEach(p=>console.log(`   id:${p.id} score:${p.score.toFixed(6)} file:${p.filename} docCategory:${p.docCategory}`));
  }
}
console.log('\nDone');
