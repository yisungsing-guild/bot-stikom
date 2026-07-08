const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

function normalizeProgramLabel(s){ if(!s) return null; return String(s).trim(); }
function firstN(s,n){ return String(s||'').replace(/\s+/g,' ').trim().slice(0,n); }

async function run(){
  const indexPath = rag.getIndexPath();
  const index = JSON.parse(fs.readFileSync(indexPath,'utf8'));

  const programs = ['SI','TI','BD','SK'];
  const programCounts = {SI:0,TI:0,BD:0,SK:0};
  let withProgram = 0;

  const containsMap = {SI:[],TI:[],BD:[],SK:[]};
  const filenameGroups = {};

  for(let i=0;i<index.length;i++){
    const it = index[i];
    const programMeta = it.program ? normalizeProgramLabel(it.program) : null;
    if(programMeta) withProgram++;
    const filename = it.filename || it.sourceFile || null;
    // map filename groups
    const fnameKey = filename ? filename : '__no_filename__';
    if(!filenameGroups[fnameKey]) filenameGroups[fnameKey]=[];
    filenameGroups[fnameKey].push({index:i, id: it.id, trainingId: it.trainingId||null, program: programMeta, chunk: it.chunk||'', chunkHash: it.chunkHash||null});

    if(programMeta){
      const up = String(programMeta||'').toUpperCase();
      if(/SI/.test(up)) programCounts.SI++;
      if(/TI/.test(up)) programCounts.TI++;
      if(/BD/.test(up)) programCounts.BD++;
      if(/SK/.test(up)) programCounts.SK++;
    }

    const text = String(it.chunk||'');
    const tLower = text.toLowerCase();
    if(/sistem\s+informasi|\bsi\b/.test(tLower)) containsMap.SI.push({index:i, id: it.id, trainingId: it.trainingId||null, filename, program: programMeta, first200: firstN(text,200), chunk: text});
    if(/teknologi\s+informasi|\bti\b/.test(tLower)) containsMap.TI.push({index:i, id: it.id, trainingId: it.trainingId||null, filename, program: programMeta, first200: firstN(text,200), chunk: text});
    if(/bisnis\s+digital|\bbd\b/.test(tLower)) containsMap.BD.push({index:i, id: it.id, trainingId: it.trainingId||null, filename, program: programMeta, first200: firstN(text,200), chunk: text});
    if(/sistem\s+komputer|\bsk\b/.test(tLower)) containsMap.SK.push({index:i, id: it.id, trainingId: it.trainingId||null, filename, program: programMeta, first200: firstN(text,200), chunk: text});
  }

  // Penjelasan Semua Program Studi.pdf analysis
  const targetName = 'Penjelasan Semua Program Studi.pdf'.toLowerCase();
  const targetChunks = [];
  for(const [fname, arr] of Object.entries(filenameGroups)){
    if(fname !== '__no_filename__' && fname.toLowerCase() === targetName){
      for(const it of arr) targetChunks.push(it);
    }
  }

  // Documents containing program info (by filename)
  const docsContainingPrograms = {};
  for(const [fname, arr] of Object.entries(filenameGroups)){
    let any=false; const list=[];
    for(const it of arr){ const text=String(it.chunk||'').toLowerCase(); if(/sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|\bsi\b|\bti\b|\bbd\b|\bsk\b/.test(text)){ any=true; list.push({index: it.index, id: it.id, first200: firstN(it.chunk,200), program: it.program}); }}
    if(any) docsContainingPrograms[fname]=list;
  }

  // Check if chunks mix multiple programs
  function countProgramMentions(text){ const t=text.toLowerCase(); let c=0; if(/sistem\s+informasi|\bsi\b/.test(t)) c++; if(/teknologi\s+informasi|\bti\b/.test(t)) c++; if(/bisnis\s+digital|\bbd\b/.test(t)) c++; if(/sistem\s+komputer|\bsk\b/.test(t)) c++; return c; }
  const mixedChunks = [];
  for(let i=0;i<index.length;i++){ const it=index[i]; const text=String(it.chunk||''); const cnt=countProgramMentions(text); if(cnt>=2) mixedChunks.push({index:i,id:it.id,filename: it.filename||null,program: it.program||null, mentions:cnt, first200: firstN(text,200)}); }

  // Verify program metadata presence for chunks that mention programs
  const mentionChunks = [...containsMap.SI,...containsMap.TI,...containsMap.BD,...containsMap.SK];
  const mentionMetaMissing = mentionChunks.filter(c=> !c.program).map(c=>({index:c.index, id:c.id, filename:c.filename, first200:c.first200}));

  // Investigate TI/BD zero: look for filenames or chunks mentioning those words
  const ti_found_in_text = containsMap.TI.length;
  const bd_found_in_text = containsMap.BD.length;

  // Which chunks used for the three queries
  const queries = ['apa itu SI?','di SI belajar apa?','lulusan TI bekerja dimana?'];
  const queryResults = {};
  for(const q of queries){
    try{
      const res = await rag.query(q, 10, { answerQuestion: q, minScore: 0 });
      const contexts = Array.isArray(res && res.contexts) ? res.contexts.map(c=>({id:c.id, trainingId:c.trainingId, filename:c.filename, score:c.score, chunk: firstN(c.chunk,200)})) : [];
      queryResults[q] = { selectedRoute: res && res.source ? res.source : null, contexts };
    }catch(e){ queryResults[q] = { error: String(e) }; }
  }

  const out = {
    total_chunks: index.length,
    with_program_meta: withProgram,
    program_meta_counts: programCounts,
    contains_by_text_counts: { SI: containsMap.SI.length, TI: containsMap.TI.length, BD: containsMap.BD.length, SK: containsMap.SK.length },
    contains_by_text_samples: { SI: containsMap.SI.slice(0,20), TI: containsMap.TI.slice(0,20), BD: containsMap.BD.slice(0,20), SK: containsMap.SK.slice(0,20) },
    penjelasan_all_program_chunks_count: targetChunks.length,
    penjelasan_all_program_chunks: targetChunks,
    mixedChunksCount: mixedChunks.length,
    mixedChunksSample: mixedChunks.slice(0,20),
    docsContainingPrograms: docsContainingPrograms,
    mentionMetaMissingCount: mentionMetaMissing.length,
    mentionMetaMissingSample: mentionMetaMissing.slice(0,20),
    ti_found_in_text,
    bd_found_in_text,
    queryResults
  };

  fs.writeFileSync('tmp/rag_data_audit.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote tmp/rag_data_audit.json');
}

run().catch(e=>{ console.error(e); process.exit(1); });
