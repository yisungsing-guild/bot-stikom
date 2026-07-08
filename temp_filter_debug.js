const path = require('path');
const rag = require(path.join(__dirname, 'src', 'engine', 'ragEngine.js'));
const index = rag.loadIndex ? rag.loadIndex() : require('fs').readFileSync(rag.getIndexPath(), 'utf8');
(async () => {
  const q = 'Apa itu Sistem Informasi?';
  const program = 'SI';
  const queryEntities = { intent: 'ACADEMIC_PROGRAM', program: program, programLabel: 'SISTEM_INFORMASI', category: 'PROGRAM_STUDI', academicIntent: 'DEFINISI_PRODI' };
  const qEmb = await rag.computeEmbedding(q);
  const scored = index.map(item => {
    const score = cosineSimilarity(qEmb, item.embedding || []);
    const breakdown = rag.getChunkScoreBreakdown(item, q, 'ACADEMIC_PROGRAM', score, queryEntities);
    return { item, score, compositeScore: breakdown.compositeScore, finalScore: breakdown.finalScore };
  });
  scored.sort((a,b)=>b.compositeScore - a.compositeScore);
  const relevant = rag.filterRelevantChunks(q, scored, queryEntities);
  console.log('scored total', scored.length, 'relevant', relevant.length);
  for (const [i,s] of relevant.slice(0,20).entries()) {
    console.log(i+1, s.item.id, s.item.filename, s.item.category, s.item.docCategory, s.score.toFixed(4), s.compositeScore.toFixed(4), s.item.chunk ? s.item.chunk.slice(0,120).replace(/\n/g,' ') : '');
  }
})();
function cosineSimilarity(a,b){
  if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return 0;
  let dot=0,nA=0,nB=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];nA+=a[i]*a[i];nB+=b[i]*b[i];}
  return nA&&nB?dot/(Math.sqrt(nA)*Math.sqrt(nB)):0;
}
