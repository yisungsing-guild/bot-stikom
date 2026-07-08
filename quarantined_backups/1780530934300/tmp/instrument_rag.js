const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

function cosine(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)) return 0;
  let dot=0, na=0, nb=0;
  for(let i=0;i<Math.max(a.length,b.length);i++){ const va=a[i]||0; const vb=b[i]||0; dot+=va*vb; na+=va*va; nb+=vb*vb; }
  if(na===0||nb===0) return 0; return dot/(Math.sqrt(na)*Math.sqrt(nb));
}

async function inspect(query){
  const indexPath = rag.getIndexPath();
  const index = JSON.parse(fs.readFileSync(indexPath,'utf8'));
  const indexForQuery = Array.isArray(index) ? index : [];
  const qEmb = await rag.computeEmbedding(query);
  const scored = indexForQuery.map(item=>{
    const semanticScore = cosine(qEmb, item.embedding || []);
    return { item, score: semanticScore };
  });
  // minScore as used in run_rag_audit (they passed minScore:0)
  const minScore = 0;
  const beforeRerank = scored.length;
  // group by program mention via item.program normalized
  const normalize = rag.normalizeProgramLabel;
  const exactMatches = [];
  const mentions = [];
  const rest = [];
  // detect program from query simple heuristic
  const qLower = String(query||'').toLowerCase();
  const qProg = /\b(si|sistem\s+informasi)\b/i.test(qLower) ? 'SI' : ( /\b(ti|teknologi\s+informasi)\b/i.test(qLower) ? 'TI' : ( /\b(bd|bisnis\s+digital)\b/i.test(qLower) ? 'BD' : ( /\b(sk|sistem\s+komputer)\b/i.test(qLower) ? 'SK' : null)));

  for(const s of scored){
    const it = s.item || {};
    let itemProg = null;
    if (it.program) itemProg = normalize(it.program) || null;
    else {
      // try filename or chunk text
      itemProg = normalize(it.filename) || normalize(it.chunk) || null;
    }
    const chunkText = String(it.chunk||'').toLowerCase();
    const fname = String(it.filename||it.trainingId||'').toLowerCase();
    const mentionsProgram = qProg && (chunkText.includes(qProg.toLowerCase()) || fname.includes(qProg.toLowerCase()));
    const multiProg = (chunkText.match(/\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|si|ti|bd|sk)\b/ig) || []).length >= 2;
    const isOverviewFile = /penjelasan\s+semua|semua\s+program|semua\s+prodi|penjelasan\s+prodi|overview\s+prodi/i.test(fname);
    const isOverview = isOverviewFile || multiProg;

    if (itemProg && qProg && itemProg.toUpperCase() === qProg.toUpperCase()) exactMatches.push(s);
    else if (mentionsProgram && !isOverview) mentions.push(s);
    else rest.push(s);
  }

  const afterGrouping_total = exactMatches.length + mentions.length + rest.length;
  const filtered = scored.filter(s=> typeof s.score==='number' ? s.score>=minScore : false);
  const afterFilter = filtered.length;

  // SI candidates present?
  const siInScored = scored.filter(s=>{
    const it=s.item||{};
    const p = it.program ? normalize(it.program) : (normalize(it.filename) || normalize(it.chunk));
    return String(p||'').toUpperCase()==='SI';
  }).map(s=>({id: s.item.id, score: s.score, filename: s.item.filename}));
  const siInFiltered = filtered.filter(s=>{
    const it=s.item||{};
    const p = it.program ? normalize(it.program) : (normalize(it.filename) || normalize(it.chunk));
    return String(p||'').toUpperCase()==='SI';
  }).map(s=>({id: s.item.id, score: s.score, filename: s.item.filename}));

  return {
    query,
    detectedProgram: qProg,
    beforeRerank,
    groupSizes: { exactMatches: exactMatches.length, mentions: mentions.length, rest: rest.length },
    afterFilter,
    siInScoredCount: siInScored.length,
    siInFilteredCount: siInFiltered.length,
    siInScored: siInScored.slice(0,10),
    siInFiltered: siInFiltered.slice(0,10)
  };
}

async function main(){
  const q = 'apa itu SI?';
  const out = await inspect(q);
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e=>{ console.error(e); process.exit(1); });
