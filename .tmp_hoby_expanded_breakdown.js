const fs = require('fs');
const rag = require('./src/engine/ragEngine');
(async ()=>{
  const id = '0566394e-a2f7-44d1-a420-52a0f72d0d7b';
  const idx = JSON.parse(fs.readFileSync('src/data/rag_index.json','utf8'));
  const item = idx.find(it=>it.id===id);
  if(!item){ console.error('item not found'); process.exit(2); }
  const q = 'teknologi informasi belajar apa saja';
  const qEnt = rag.extractStructuredEntities(q);
  const vecLines = fs.readFileSync('data/vec_index/domains_vectors.jsonl','utf8').split(/\r?\n/).filter(Boolean);
  const line = vecLines.find(l => l.includes('"'+id+'"'));
  const emb = line ? JSON.parse(line).values : (item.embedding || null);
  const cosine = (a,b)=>{ if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length) return 0; let d=0,na=0,nb=0; for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} if(na===0||nb===0) return 0; return d/(Math.sqrt(na)*Math.sqrt(nb)); };
  const qEmb = await rag.computeEmbedding(q);
  const sem = Array.isArray(emb) && Array.isArray(qEmb) ? cosine(qEmb, emb) : 0;
  const breakdown = rag.getChunkScoreBreakdown(item, q, qEnt && qEnt.intent ? qEnt.intent : null, sem || 0, qEnt);
  console.log(JSON.stringify({ id: item.id, filename: item.filename, similarity: sem, qEntities: qEnt, breakdown }, null, 2));
})();