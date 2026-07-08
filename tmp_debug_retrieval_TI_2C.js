const fs = require('fs');
const path = require('path');
const rag = require('./src/engine/ragEngine');

(async function(){
  const question = 'berapa biaya TI gelombang 2C';
  const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', academicYear: '2025' };
  const indexPath = rag.getIndexPath();
  const raw = fs.readFileSync(indexPath,'utf8');
  const index = JSON.parse(raw || '[]');

  const qEmb = await rag.computeEmbedding(question);

  function cosine(a,b){
    if(!Array.isArray(a)||!Array.isArray(b)) return 0;
    let na=0, nb=0, dot=0; for(let i=0;i<Math.min(a.length,b.length);i++){ dot+= (a[i]||0)*(b[i]||0); na+= (a[i]||0)*(a[i]||0); nb+= (b[i]||0)*(b[i]||0);} 
    if(na===0||nb===0) return 0; return dot/Math.sqrt(na*nb);
  }

  const scored = [];
  for(const item of index){
    const sem = item.embedding && Array.isArray(item.embedding) ? cosine(qEmb, item.embedding) : 0;
    const breakdown = rag.getChunkScoreBreakdown(item, question, 'COST', sem, queryEntities);
    const trust = rag.validateSourceTrust(item);
    scored.push({ item, sem, breakdown, trust });
  }

  scored.sort((a,b)=> (b.breakdown.finalScore||0) - (a.breakdown.finalScore||0));

  const top20 = scored.slice(0,20).map(s=>{
    const item = s.item;
    const br = s.breakdown;
    const trust = s.trust;
    const rejectReason = (br && br.exactMatch && br.exactMatch.rejected) ? (br.exactMatch.reason||'exact-mismatch') : (br && br.compositeScore<=-900? 'excluded-from-search' : null);
    return {
      id: item.id || null,
      score: br.finalScore || br.compositeScore || 0,
      filename: item.filename || item.sourceFile || null,
      source: item.metadata && item.metadata.source ? item.metadata.source : (item.source||null),
      trusted: trust && trust.trusted === true,
      trustScore: trust && trust.score,
      docCategory: item.docCategory || item.category || (item.metadata && item.metadata.category) || null,
      chunkType: item.chunkType || null,
      ocrQualityScore: item.ocrQualityScore || null,
      trainingId: item.trainingId || null,
      rejectReason
    };
  });

  console.log(JSON.stringify({ query: question, top20 }, null, 2));
})();
