/*
Compute per-chunk score breakdown for a query and write Top-20 to JSON.
This script runs in the project root.
Usage: node tools/retrieval_audit_top20.js "berapa biaya teknologi informasi gelombang 1A"
*/

const fs = require('fs');
const path = require('path');

const rag = require('../src/engine/ragEngine');
const provider = require('../src/routes/provider');

const OUT = path.join(process.cwd(), 'tools', 'retrieval_audit_top20.json');

async function main() {
  const q = process.argv.slice(2).join(' ');
  if (!q) {
    console.error('Usage: node tools/retrieval_audit_top20.js "<query>"');
    process.exit(2);
  }

  // load index
  const indexPath = (typeof rag.getIndexPath === 'function') ? rag.getIndexPath() : path.join(process.cwd(), 'data', 'rag_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  // mock query entities using existing parser in ragEngine
  const queryEntities = rag.guessQueryEntities ? rag.guessQueryEntities(q) : { intent: 'ACADEMIC_PROGRAM', program: 'TI', wave: '1A', academicIntent: 'BIAYA' };

  // embed query: ragEngine exposes getQueryEmbedding or computeEmbedding
  const qEmb = (typeof rag.getQueryEmbedding === 'function') ? await rag.getQueryEmbedding(q) : null;

  // compute semantic score using cosineSimilarity helper if present
  const cosine = rag.cosineSimilarity || function(a,b){ if(!a||!b) return 0; const dot = a.reduce((s,v,i)=>s+v*(b[i]||0),0); const na = Math.sqrt(a.reduce((s,v)=>s+v*v,0)); const nb = Math.sqrt(b.reduce((s,v)=>s+v*v,0)); return na&&nb?dot/(na*nb):0 };

  const items = index.items || index;
  const results = [];
  for (const item of items) {
    const emb = item.embedding;
    const semanticScore = (qEmb && emb) ? cosine(qEmb, emb) * 10 : 0;
    const breakdown = rag.getChunkScoreBreakdown ? rag.getChunkScoreBreakdown(item, q, 'COST', semanticScore, queryEntities) : null;
    const composite = breakdown ? breakdown.compositeScore : (semanticScore);
    results.push({ id: item.id || item.chunkId || item.chunkHash || '(no-id)', filename: item.filename || item.sourceFile || '(no-file)', compositeScore: composite, semanticScore, breakdown, preview: (item.chunk||item.text||'').slice(0,300) });
  }

  results.sort((a,b)=>b.compositeScore - a.compositeScore);
  const top20 = results.slice(0,20);
  fs.writeFileSync(OUT, JSON.stringify({ query: q, queryEntities, top20 }, null, 2));
  console.log('Wrote', OUT);
}

main().catch(e=>{ console.error(e); process.exit(1); });
