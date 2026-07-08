const fs = require('fs');
const path = require('path');
const rag = require('./src/engine/ragEngine');

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return null;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function run() {
  const query = 'TI belajar apa saja';
  const idxPath = path.join(__dirname, 'data', 'rag_index.json');
  const vecPath = path.join(__dirname, 'data', 'vec_index', 'domains_vectors.jsonl');

  const idxRaw = fs.readFileSync(idxPath, 'utf8');
  const index = JSON.parse(idxRaw);
  const ids = new Set(['program_studi-28','program_studi-29','program_studi-30','program_studi-31','program_studi-32','program_studi-33','program_studi-34','program_studi-35']);
  const items = index.filter(it => ids.has(it.id));

  const vecLines = fs.readFileSync(vecPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const vecMap = new Map();
  for (const l of vecLines) {
    try {
      const obj = JSON.parse(l);
      if (obj && obj.id) vecMap.set(obj.id, obj.values || obj.embedding || obj.vector || null);
    } catch (e) { /* ignore */ }
  }

  const qEmb = await rag.computeEmbedding(query);
  const qEntities = rag.extractStructuredEntities(query);

  const out = [];
  for (const it of items) {
    const emb = vecMap.get(it.id) || it.embedding || null;
    const sem = Array.isArray(emb) && Array.isArray(qEmb) ? cosine(qEmb, emb) : null;
    const breakdown = rag.getChunkScoreBreakdown(it, query, qEntities && qEntities.intent ? qEntities.intent : null, sem || 0, qEntities);
    out.push({ id: it.id, filename: it.filename, topic: it.metadata && it.metadata.topic, similarity: sem, breakdown });
  }

  console.log('Program Studi 28..35 breakdown:');
  console.log(JSON.stringify(out, null, 2));
}

run().catch(e => { console.error(e && e.stack ? e.stack : e); process.exit(2); });
