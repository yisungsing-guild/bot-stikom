const fs = require('fs');
const path = require('path');
const idxPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(idxPath,'utf8');
const arr = JSON.parse(raw);

function tokenize(s){ return (s||'').toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean); }
const docs = arr.map(e=>({ id: e.id, filename: e.filename||e.file||null, docCategory: e.docCategory||e.category||'UNKNOWN', chunk: e.chunk||'' }));
const N = docs.length;
const df = Object.create(null);
const tfs = [];
for(let i=0;i<N;i++){
  const toks = tokenize(docs[i].chunk);
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
function dotDetailed(a,b){ let s=0; const contributions=[]; for(const k in a){ if(b[k]){ const c=a[k]*b[k]; contributions.push({term:k,a:a[k],b:b[k],contrib:c}); s+=c; }} return {sum:s,contributions}; }
function norm(a){ let s=0; for(const k in a) s+=a[k]*a[k]; return Math.sqrt(s); }
function scoreDetail(qVec, docVec){ const d = dotDetailed(qVec, docVec); const na = norm(qVec); const nb = norm(docVec); const score = (na===0||nb===0)?0:d.sum/(na*nb); return {score, dot:d.sum, na, nb, contributions: d.contributions.sort((x,b)=>Math.abs(b.contrib)-Math.abs(x.contrib)).slice(0,30)}; }
function vecFromText(text){ const toks = tokenize(text); const tf = Object.create(null); for(const t of toks) tf[t]=(tf[t]||0)+1; return tfidfVector(tf); }

const queries = [
  'Apa itu TI',
  'Apa itu Teknologi Informasi',
  'TI belajar apa saja',
  'Prospek kerja TI'
];

const targetIds = new Set(['1ea21dbf-def4-4600-87ab-9f0d22a0c2e5','81881ff1-d3cc-48dd-a812-e530565be8c5','ae536d74-4ca6-4904-a732-d3ddb7cd3ce7']);

for(const q of queries){
  const expanded = q.replace(/\bti\b/ig,'teknologi informasi');
  const qVec = vecFromText(expanded);
  const scored = [];
  for(let i=0;i<N;i++){
    const detail = scoreDetail(qVec, docVecs[i]);
    scored.push({ id: docs[i].id, filename: docs[i].filename, docCategory: docs[i].docCategory, score: detail.score, dot: detail.dot, na: detail.na, nb: detail.nb, contributions: detail.contributions.slice(0,10), len: tfs[i].len });
  }
  scored.sort((a,b)=>b.score-a.score);
  console.log('\n=== QUERY:', q, 'expanded:', expanded, '===');
  console.log('\nTop 10 BEFORE (id, score, file, docCategory, len):');
  scored.slice(0,10).forEach((r,i)=> console.log(`${i+1}. ${r.id} ${r.score.toFixed(6)} ${r.filename||'N/A'} ${r.docCategory} len:${r.len}`));

  console.log('\nTarget docs details:');
  for(const r of scored.filter(s=>targetIds.has(s.id))){
    console.log(`- ${r.id} file:${r.filename||'N/A'} cat:${r.docCategory} score:${r.score.toFixed(6)} dot:${r.dot.toFixed(6)} na:${r.na.toFixed(6)} nb:${r.nb.toFixed(6)} len:${r.len}`);
    console.log('  top contributions:', r.contributions.map(c=>`${c.term}:${c.contrib.toFixed(6)}`).join(', '));
  }

  console.log('\nTop BIAYA above any target (if present):');
  // find first BIAYA docs that rank above lowest target score
  const targetScores = scored.filter(s=>targetIds.has(s.id)).map(s=>s.score);
  const threshold = Math.min(...targetScores.concat([0]));
  const topBiaya = scored.filter(s=>s.docCategory==='BIAYA' && s.score>threshold).slice(0,10);
  topBiaya.forEach((b,i)=>{
    console.log(`${i+1}. ${b.id} ${b.score.toFixed(6)} ${b.filename||'N/A'} len:${b.len}`);
    const full = scored.find(s=>s.id===b.id);
    if(full){
      console.log('   dot:', full.dot.toFixed(6), 'na:', full.na.toFixed(6), 'nb:', full.nb.toFixed(6));
      if(full.contributions){
        console.log('   top contributions:', full.contributions.map(c=>`${c.term}:${c.contrib.toFixed(6)}`).join(', '));
      }
    }
  });
}

console.log('\nDone');
