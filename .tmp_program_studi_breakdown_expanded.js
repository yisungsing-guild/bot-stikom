const fs = require('fs');
const path = require('path');
const rag = require('./src/engine/ragEngine');

async function run() {
  const rawQuery = 'TI belajar apa saja';
  const query = rawQuery.toLowerCase().replace(/\bti\b/g, 'teknologi informasi');
  const vecLines = fs.readFileSync('data/vec_index/domains_vectors.jsonl','utf8').split(/\r?\n/).filter(Boolean);
  const vecItems = vecLines.map(l => { try { return JSON.parse(l); } catch(e){ return null; } }).filter(Boolean);
  const ids = new Set(['program_studi-28','program_studi-29','program_studi-30','program_studi-31','program_studi-32','program_studi-33','program_studi-34','program_studi-35']);
  const items = vecItems.filter(it => ids.has(it.id));

  const vecMap = new Map();
  for (const it of vecItems) { vecMap.set(it.id, it.values || it.embedding || it.vector || null); }

  const qEmb = await rag.computeEmbedding(query);
  const qEntities = rag.extractStructuredEntities(query);

  const out = [];
  for (const it of items) {
    const emb = vecMap.get(it.id) || it.embedding || null;
    const sem = Array.isArray(emb) && Array.isArray(qEmb) ? (function(a,b){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}if(na===0||nb===0)return 0;return d/(Math.sqrt(na)*Math.sqrt(nb));})(qEmb, emb) : 0;
    const breakdown = rag.getChunkScoreBreakdown(it, query, qEntities && qEntities.intent ? qEntities.intent : null, sem || 0, qEntities);
    out.push({ id: it.id, filename: it.filename, similarity: sem, breakdown });
  }

  console.log(JSON.stringify({ query, qEntities, out }, null, 2));
}
run().catch(e=>{ console.error(e && e.stack?e.stack:e); process.exit(2); });