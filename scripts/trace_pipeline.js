const ragEngine = require('../src/engine/ragEngine');
const evidenceSelector = require('../src/engine/evidenceSelector');
const bm25 = require('../src/engine/bm25');

function cosine(a,b){ if(!Array.isArray(a)||!Array.isArray(b)) return 0; let dot=0, na=0, nb=0; for(let i=0;i<Math.min(a.length,b.length);i++){dot+=(a[i]||0)*(b[i]||0); na+=(a[i]||0)**2; nb+=(b[i]||0)**2;} return Math.max(0, dot/((Math.sqrt(na)*Math.sqrt(nb))||1e-10)); }
function normalizeBm25(rawScores){ const max = Math.max(...rawScores, 1e-6); return rawScores.map(s=>Math.min(1, s/max)); }

async function trace(question){
  const index = ragEngine.loadIndex();
  const qEmb = await ragEngine.computeEmbedding(question);
  const texts = index.map(item => `${String(item.chunk||'')} ${String(item.filename||item.trainingId||'')}`);
  const bm25Raw = bm25.computeBm25Scores(question, texts).map(x=>x.score);
  const bm25Norm = normalizeBm25(bm25Raw);
  const items = index.map((item, idx)=>{
    const semantic = (qEmb && Array.isArray(item.embedding)) ? cosine(qEmb, item.embedding) : 0;
    const breakdown = ragEngine.getChunkScoreBreakdown(item, question, null, semantic, null) || {};
    const keyword = breakdown.keywordScore || 0;
    const keywordAfter = Math.max(keyword, bm25Norm[idx]||0);
    const metadataBoost = breakdown.metadataBoost||0;
    const final = Math.max(-1, Math.min(1, semantic*0.55 + (bm25Norm[idx]||0)*0.25 + keywordAfter*0.12 + Math.tanh(metadataBoost)*0.06 + Math.min(0.2, (breakdown.exactBoost||0)*0.1)));
    return { idx, item, chunkId: item.id, semantic, bm25Raw: bm25Raw[idx]||0, bm25Norm: bm25Norm[idx]||0, keyword, keywordAfter, metadataBoost, final };
  });
  items.sort((a,b)=>b.final - a.final);
  const top = items.slice(0,10);
  console.log('RETRIEVAL CANDIDATES (top 10)');
  for(const c of top) console.log(`${c.chunkId} ${c.final.toFixed(6)}`);

  const contexts = top.map(c=>({ id: c.chunkId, chunk: c.item.chunk, filename: c.item.filename, trainingId: c.item.trainingId, metadata: c.item.metadata }));
  console.log('\nCONTEXTS (ids + semantic)');
  for(const c of top) console.log(`${c.chunkId} ${c.semantic.toFixed(6)}`);

  const selected = evidenceSelector.selectEvidenceFromContexts({ question, contexts, intent: null, maxEvidence: 5 });
  console.log('\nSELECTED EVIDENCE (id + totalScore)');
  for(const ev of selected) {
    const id = ev.chunkId || ev.sourceId || ev.documentId || ev.id || ev.source;
    console.log(`${id || '<no-id>'} ${Number(ev.totalScore || ev._total || 0).toFixed(6)}`);
  }

  // Show dedup meta counts if present
  console.log('\nDEDUP META:');
  if (selected.dedupMeta) console.log(JSON.stringify(selected.dedupMeta));
}

trace('biaya teknologi informasi gelombang 1A').catch(err=>{ console.error(err && err.stack?err.stack:err); process.exit(1); });
