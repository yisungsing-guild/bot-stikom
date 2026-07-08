const path = require('path');
const rag = require(path.join(__dirname, 'src', 'engine', 'ragEngine.js'));
const fs = require('fs');
const index = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8') || '[]');
const q = 'Apa itu Sistem Informasi?';
const queryEntities = { intent: 'ACADEMIC_PROGRAM', program: 'SI', programLabel: 'SISTEM_INFORMASI', category: 'PROGRAM_STUDI', academicIntent: 'DEFINISI_PRODI' };
const qEmb = await rag.computeEmbedding(q);
const scored = index.map(item => {
  const score = cosineSimilarity(qEmb, item.embedding || []);
  const breakdown = rag.getChunkScoreBreakdown(item, q, 'ACADEMIC_PROGRAM', score, queryEntities);
  return { item, score, compositeScore: breakdown.compositeScore, finalScore: breakdown.finalScore };
}).sort((a,b)=>b.compositeScore-b.compositeScore);
const top = scored.slice(0,30);
console.log('top before count', top.length);
for(const s of top) console.log(s.item.id, s.item.filename, s.item.category, s.item.docCategory, s.score.toFixed(4), s.compositeScore.toFixed(4));
const relevant = rag.filterRelevantChunks(q, top, queryEntities);
console.log('relevant count', relevant.length);
for(const s of relevant) console.log('KEEP', s.item.id, s.item.filename, s.item.category, s.item.docCategory, s.score.toFixed(4), s.compositeScore.toFixed(4));
function cosineSimilarity(a,b){ if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return 0; let dot=0,nA=0,nB=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];nA+=a[i]*a[i];nB+=b[i]*b[i];} return nA&&nB?dot/(Math.sqrt(nA)*Math.sqrt(nB)):0; }
