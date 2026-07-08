const fs = require('fs');
const path = require('path');
const rag = require('./src/engine/ragEngine');

async function run() {
  const query = 'TI belajar apa saja';
  const targetId = '0566394e-a2f7-44d1-a420-52a0f72d0d7b';
  const idxPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
  const idxRaw = fs.readFileSync(idxPath, 'utf8');
  const index = JSON.parse(idxRaw);
  const item = index.find(it => it.id === targetId);
  if (!item) {
    console.error('Item not found in index:', targetId);
    process.exit(2);
  }
  const qEmb = await rag.computeEmbedding(query);
  const cos = (a,b)=>{ if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return 0; let d=0,na=0,nb=0; for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} if(na===0||nb===0)return 0; return d/(Math.sqrt(na)*Math.sqrt(nb)); };
  const vecPath = path.join(__dirname, 'data', 'vec_index', 'domains_vectors.jsonl');
  const vecLines = fs.readFileSync(vecPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const vecMap = new Map();
  for (const l of vecLines) {
    try { const obj = JSON.parse(l); if (obj && obj.id) vecMap.set(obj.id, obj.values || obj.embedding || obj.vector || null); } catch(e){}
  }
  const emb = vecMap.get(item.id) || item.embedding || null;
  const semantic = Array.isArray(emb) && Array.isArray(qEmb) ? cos(qEmb, emb) : 0;
  const qEntities = rag.extractStructuredEntities(query);
  const breakdown = rag.getChunkScoreBreakdown(item, query, qEntities && qEntities.intent ? qEntities.intent : null, semantic || 0, qEntities);
  console.log('HOBY item breakdown for', targetId);
  console.log(JSON.stringify({ id: item.id, filename: item.filename, similarity: semantic, breakdown }, null, 2));
}

run().catch(e=>{ console.error(e && e.stack?e.stack:e); process.exit(2); });