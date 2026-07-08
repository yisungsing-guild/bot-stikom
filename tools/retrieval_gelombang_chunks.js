/*
Score and breakdown for index chunks mentioning 'gelombang'.
Usage: node tools/retrieval_gelombang_chunks.js "<query>"
Example: node tools/retrieval_gelombang_chunks.js "berapa biaya teknologi informasi gelombang 1A"
*/

const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

const OUT = path.join(process.cwd(), 'tools', 'retrieval_gelombang_chunks.json');

async function main() {
  const args = process.argv.slice(2);
  const query = args[0] || 'berapa biaya teknologi informasi gelombang 1A';
  const queryEntities = { intent: 'ACADEMIC_PROGRAM', program: 'TI', wave: '1A', academicIntent: 'BIAYA' };

  const indexPath = (typeof rag.getIndexPath === 'function') ? rag.getIndexPath() : path.join(process.cwd(), 'src', 'data', 'rag_index.json');
  const indexRaw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const items = indexRaw.items || indexRaw;

  const qEmb = (typeof rag.getQueryEmbedding === 'function') ? await rag.getQueryEmbedding(query) : null;
  const cosine = rag.cosineSimilarity || function(a,b){ if(!a||!b) return 0; const dot = a.reduce((s,v,i)=>s+v*(b[i]||0),0); const na = Math.sqrt(a.reduce((s,v)=>s+v*v,0)); const nb = Math.sqrt(b.reduce((s,v)=>s+v*v,0)); return na&&nb?dot/(na*nb):0 };

  const matches = [];
  for (const it of Array.isArray(items) ? items : []) {
    const text = String(it.chunk || '') + '\n' + String(it.filename || '');
    if (/\bgelombang\b/i.test(text) || /\bgel\.\b/i.test(text) || /\bI A\b|\b1A\b|\bI A\b/i.test(text)) {
      const sem = (qEmb && Array.isArray(it.embedding)) ? cosine(qEmb, it.embedding) * 10 : 0;
      const breakdown = (typeof rag.getChunkScoreBreakdown === 'function') ? rag.getChunkScoreBreakdown(it, query, 'COST', sem, queryEntities) : null;
      matches.push({ id: it.id, filename: it.filename, trainingId: it.trainingId, program: it.program || null, wave: it.wave || null, chunkPreview: String(it.chunk || '').substring(0,400), compositeScore: breakdown ? breakdown.compositeScore : sem, breakdown });
    }
  }

  matches.sort((a,b) => (b.compositeScore||0) - (a.compositeScore||0));
  fs.writeFileSync(OUT, JSON.stringify({ query, count: matches.length, matches }, null, 2));
  console.log('Wrote', OUT);
}

main().catch(e=>{ console.error(e); process.exit(1); });
