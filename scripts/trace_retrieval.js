const ragEngine = require('../src/engine/ragEngine');
const ragScoped = require('../src/engine/ragScoped');
const bm25 = require('../src/engine/bm25');
const fs = require('fs');

function cosine(a,b){ if(!Array.isArray(a)||!Array.isArray(b)) return 0; let dot=0, na=0, nb=0; for(let i=0;i<Math.min(a.length,b.length);i++){dot+=(a[i]||0)*(b[i]||0); na+=(a[i]||0)**2; nb+=(b[i]||0)**2;} return Math.max(0, dot/((Math.sqrt(na)*Math.sqrt(nb))||1e-10)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function normalizeBm25(rawScores){ const max = Math.max(...rawScores, 1e-6); return rawScores.map(s=>Math.min(1, s/max)); }
function freshnessBoostFromTs(ts){ if(!ts || !Number.isFinite(Number(ts))) return 0; const ageDays = Math.max(0, (Date.now() - Number(ts)) / 86400000); if(ageDays<=30) return 0.18; if(ageDays<=90) return 0.1; if(ageDays>720) return -0.08; return 0; }

async function runQueries(queries){
  const index = ragEngine.loadIndex();
  const results = [];
  for(const q of queries){
    const normalizedQ = String(q).trim();
    const queryEntities = ragEngine.extractStructuredEntities ? ragEngine.extractStructuredEntities(normalizedQ) : null;
    const qEmb = await ragEngine.computeEmbedding(normalizedQ);
    const texts = index.map(item => `${String(item.chunk||'')} ${String(item.filename||item.trainingId||'')}`);
    const bm25Raw = bm25.computeBm25Scores(normalizedQ, texts).map(x=>x.score);
    const bm25Norm = normalizeBm25(bm25Raw);
    const items = index.map((item, idx) => {
      const semanticScore = (qEmb && Array.isArray(item.embedding)) ? cosine(qEmb, item.embedding) : 0;
      const breakdown = ragEngine.getChunkScoreBreakdown(item, normalizedQ, null, semanticScore, queryEntities || null) || {};
      const keywordBefore = Number.isFinite(breakdown.keywordScore) ? breakdown.keywordScore : 0;
      const keywordAfter = Math.max(keywordBefore, bm25Norm[idx] || 0);
      const entityScore = Number.isFinite(breakdown.exactBoost) ? breakdown.exactBoost : 0;
      const metadataBoost = Number.isFinite(breakdown.metadataBoost) ? breakdown.metadataBoost : 0;
      const ts = (item && item.metadata && (item.metadata.updatedAt || item.metadata.createdAt)) || item.updatedAt || item.createdAt || null;
      const fresh = freshnessBoostFromTs(ts ? Date.parse(String(ts)) : null);
      const bm25RawScore = bm25Raw[idx] || 0;
      const bm25ScoreForHybrid = bm25Norm[idx] || 0;
      // hybrid final score per computeHybridRetrievalScore
      const semanticFactor = Number.isFinite(semanticScore) ? semanticScore : 0;
      const bm25Factor = Number.isFinite(bm25ScoreForHybrid) ? bm25ScoreForHybrid : 0;
      const keywordFactor = Number.isFinite(keywordAfter) ? keywordAfter : 0;
      const metadataFactor = Number.isFinite(metadataBoost) ? Math.tanh(metadataBoost) : 0;
      const exactFactor = Number.isFinite(entityScore) ? Math.min(0.2, entityScore * 0.1) : 0;
      const mixed = semanticFactor * 0.55 + bm25Factor * 0.25 + keywordFactor * 0.12 + metadataFactor * 0.06 + exactFactor;
      const finalScore = clamp(mixed, -1, 1);

      return {
        idx,
        chunkId: item.id || (item.metadata && (item.metadata.chunkHash || item.metadata.id)) || null,
        documentId: item.metadata && (item.metadata.documentId || item.metadata.trainingId) || null,
        semanticScore: Number(semanticScore.toFixed(6)),
        rawBm25Score: Number(bm25RawScore.toFixed(6)),
        bm25Norm: Number(bm25ScoreForHybrid.toFixed(6)),
        keywordScoreBefore: Number(keywordBefore.toFixed(6)),
        keywordScoreAfter: Number(keywordAfter.toFixed(6)),
        entityScore: Number(entityScore.toFixed(6)),
        metadataBoost: Number(metadataBoost.toFixed(6)),
        freshnessBoost: Number(fresh.toFixed(6)),
        finalScore: Number(finalScore.toFixed(6)),
        item
      };
    });

    // penalize duplicate chunks approximation
    const byChunk = new Map();
    for(const it of items){
      const text = String(it.item && it.item.chunk || '').trim();
      const key = text || `doc:${String(it.documentId||'')}`;
      const arr = byChunk.get(key) || [];
      arr.push(it);
      byChunk.set(key, arr);
    }
    for(const arr of byChunk.values()){
      if(arr.length>1){
        for(let i=0;i<arr.length;i++){
          const occ = arr.length;
          const dupPenalty = 0.08 * Math.min(3, occ-1);
          arr[i].duplicatePenalty = Number(dupPenalty.toFixed(6));
          arr[i].finalScore = Number((arr[i].finalScore - dupPenalty).toFixed(6));
        }
      }
    }

    items.sort((a,b)=>b.finalScore - a.finalScore);
    const top5 = items.slice(0,5).map(it=>({
      chunkId: it.chunkId,
      semanticScore: it.semanticScore,
      rawBm25Score: it.rawBm25Score,
      keywordScoreBeforeBm25: it.keywordScoreBefore,
      keywordScoreAfterBm25: it.keywordScoreAfter,
      entityScore: it.entityScore,
      metadataBoost: it.metadataBoost,
      duplicatePenalty: Number((it.duplicatePenalty||0).toFixed(6)),
      freshnessBoost: it.freshnessBoost,
      finalScore: it.finalScore
    }));

    results.push({ query: q, top5 });
  }
  return results;
}

const queries = [
  'biaya teknologi informasi gelombang 1A',
  'biaya sistem informasi gelombang 2',
  'apa itu sistem informasi',
  'apa syarat KIP',
  'informasi double degree'
];

runQueries(queries).then(res=>{
  console.log(JSON.stringify(res, null, 2));
}).catch(err=>{ console.error(err && err.stack?err.stack:err); process.exit(1); });
