const { getRagIndexPath } = require('../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');
const intent = require('../src/engine/intentClassifier');
const ev = require('../src/engine/evidenceValidator');

const idxPath = getRagIndexPath();
const raw = fs.readFileSync(idxPath,'utf8');
const arr = JSON.parse(raw);

const queries = [
  'Apa itu TI',
  'Apa itu Teknologi Informasi',
  'Apa itu SI',
  'Apa itu Sistem Informasi',
  'TI belajar apa saja',
  'SI belajar apa saja',
  'Prospek kerja TI'
];

const expandMap = {
  '\bti\b': 'teknologi informasi',
  '\bsi\b': 'sistem informasi',
  '\bbd\b': 'bisnis digital',
  '\bsk\b': 'sistem komputer'
};

function expandQuery(q){
  let s = q;
  for(const pat in expandMap){
    const re = new RegExp(pat,'ig');
    s = s.replace(re, expandMap[pat]);
  }
  return s;
}

function tokenize(s){ return (s||'').toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean); }
const docs = arr.map(e=>({ id: e.id, filename: e.filename||e.file||null, docCategory: e.docCategory||e.category||'UNKNOWN', text: (e.chunk||'') }));
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
function dot(a,b){ let s=0; for(const k in a){ if(b[k]) s+=a[k]*b[k]; } return s; }
function norm(a){ let s=0; for(const k in a) s+=a[k]*a[k]; return Math.sqrt(s); }
function scoreVec(qVec, docVec){ const d = dot(qVec, docVec); const na = norm(qVec); const nb = norm(docVec); if(na===0||nb===0) return 0; return d/(na*nb); }
function vecFromText(text){ const toks = tokenize(text); const tf = Object.create(null); for(const t of toks) tf[t]=(tf[t]||0)+1; return tfidfVector(tf); }

function specialIncludeCheck(chunk, intentKey){
  // For DEFINISI_PRODI, allow KURIKULUM and PROSPEK_KERJA if evidence exists
  const cat = chunk.docCategory || 'UNKNOWN';
  if (intentKey === 'DEFINISI_PRODI'){
    if (cat === 'KURIKULUM' || cat === 'PROSPEK_KERJA' || cat === 'PRODI_PROFILE'){
      // require evidence check
      const evRes = ev.validateChunkEvidence(chunk, intentKey);
      return { allowed: evRes.hasEvidence, reason: evRes.hasEvidence ? 'evidence_ok' : 'no_evidence_in_allowed_alt_category', evidenceDetail: evRes };
    }
  }
  // default: use shouldIncludeChunkForIntent
  const si = intent.shouldIncludeChunkForIntent(chunk, intentKey);
  return { allowed: si.allowed, reason: si.reason, detail: si };
}

for(const q of queries){
  const expanded = expandQuery(q);
  const qVec = vecFromText(expanded);
  const scored = [];
  for(let i=0;i<N;i++){
    const s = scoreVec(qVec, docVecs[i]);
    scored.push({ id: docs[i].id, filename: docs[i].filename, docCategory: docs[i].docCategory, score: s, chunk: docs[i].text });
  }
  scored.sort((a,b)=>b.score-a.score);
  const topBefore = scored.slice(0,20);
  const userIntent = intent.classifyIntent(expanded);

  console.log('\n=== QUERY (original) :', q, '\nexpanded:', expanded, '\nintent:', userIntent, '===');
  console.log('\n-- Top 20 BEFORE filtering --');
  topBefore.forEach((r,idx)=>{
    console.log(`${String(idx+1).padStart(2)}. id:${r.id} score:${r.score.toFixed(6)} file:${r.filename||'N/A'} docCategory:${r.docCategory}`);
  });

  // Apply filtering + evidence validator per user's requested rules
  const after = [];
  const rejects = [];
  for(const r of topBefore){
    const chunkObj = { id: r.id, filename: r.filename, docCategory: r.docCategory, chunk: r.chunk };
    // first, category-based allow/forbid (with special override)
    const includeCheck = specialIncludeCheck(chunkObj, userIntent);
    if(!includeCheck.allowed){
      // log reject reason
      rejects.push({ id: r.id, filename: r.filename, docCategory: r.docCategory, score: r.score, reason: 'category_reject', detail: includeCheck });
      continue;
    }
    // second, run validateChunkForAnswer (evidence + relevance)
    const val = ev.validateChunkForAnswer(chunkObj, expanded, userIntent);
    if(!val.valid){
      rejects.push({ id: r.id, filename: r.filename, docCategory: r.docCategory, score: r.score, reason: val.reason, detail: val.detail });
      continue;
    }
    // accepted
    after.push({ id: r.id, filename: r.filename, docCategory: r.docCategory, score: r.score, evidenceConfidence: val.evidenceConfidence });
  }

  console.log('\n-- Top 20 AFTER filtering (accepted) --');
  if(after.length===0) console.log('No accepted chunks');
  after.forEach((a,idx)=> console.log(`${String(idx+1).padStart(2)}. id:${a.id} score:${a.score.toFixed(6)} file:${a.filename||'N/A'} docCategory:${a.docCategory} evidence:${a.evidenceConfidence}`));

  console.log('\n-- Rejected chunks with reasons --');
  if(rejects.length===0) console.log('No rejects');
  rejects.forEach((rej,idx)=>{
    console.log(`${String(idx+1).padStart(2)}. id:${rej.id} file:${rej.filename||'N/A'} cat:${rej.docCategory} score:${rej.score.toFixed(6)} reason:${rej.reason}`);
    // print detail succinct
    if(rej.detail){
      try{ console.log('   detail:', JSON.stringify(rej.detail).slice(0,300)); }catch(e){ }
    }
  });
}

console.log('\nAudit complete');
