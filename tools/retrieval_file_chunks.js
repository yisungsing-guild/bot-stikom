/*
Score and breakdown for all chunks from a specified filename substring.
Usage: node tools/retrieval_file_chunks.js "<query>" "<filename-substring>"
Example: node tools/retrieval_file_chunks.js "berapa biaya teknologi informasi gelombang 1A" "rincian Biaya SI,TI dan BD"
*/

const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

const OUT = path.join(process.cwd(), 'tools', 'retrieval_file_chunks.json');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node tools/retrieval_file_chunks.js "<query>" "<filename-substring>"');
    process.exit(2);
  }
  const query = args[0];
  const filenameSub = args[1] || 'rincian Biaya SI,TI dan BD';

  const indexPath = (typeof rag.getIndexPath === 'function') ? rag.getIndexPath() : path.join(process.cwd(), 'data', 'rag_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const items = index.items || index;

  const queryEntities = rag.guessQueryEntities ? rag.guessQueryEntities(query) : { intent: 'ACADEMIC_PROGRAM', program: 'TI', wave: '1A', academicIntent: 'BIAYA' };
  const qEmb = (typeof rag.getQueryEmbedding === 'function') ? await rag.getQueryEmbedding(query) : null;
  const cosine = rag.cosineSimilarity || function(a,b){ if(!a||!b) return 0; const dot = a.reduce((s,v,i)=>s+v*(b[i]||0),0); const na = Math.sqrt(a.reduce((s,v)=>s+v*v,0)); const nb = Math.sqrt(b.reduce((s,v)=>s+v*v,0)); return na&&nb?dot/(na*nb):0 };

  const matches = items.filter(it => (it.filename || it.sourceFile || '').toLowerCase().includes(filenameSub.toLowerCase()));
  const results = [];
  for (const item of matches) {
    const emb = item.embedding;
    const semanticScore = (qEmb && emb) ? cosine(qEmb, emb) * 10 : 0;
    const breakdown = rag.getChunkScoreBreakdown ? rag.getChunkScoreBreakdown(item, query, 'COST', semanticScore, queryEntities) : null;
    results.push({ id: item.id || item.chunkId || item.chunkHash || '(no-id)', filename: item.filename || item.sourceFile || '(no-file)', compositeScore: (breakdown ? breakdown.compositeScore : semanticScore), semanticScore, preview: (item.chunk || item.text || '').slice(0,800), breakdown });
  }

  results.sort((a,b) => (b.compositeScore||0) - (a.compositeScore||0));
  fs.writeFileSync(OUT, JSON.stringify({ query, filenameSub, results }, null, 2));
  console.log('Wrote', OUT);
}

main().catch(e=>{ console.error(e); process.exit(1); });
