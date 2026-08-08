const fs = require('fs');
const path = require('path');
const out = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../outputs/rag_retrieval_evaluation.json'), 'utf8'));
const analysis = out.analysis;
const results = out.results || {};
const changed = analysis.perQuery.filter(q => q.status !== 'unchanged').map(q => ({
  id: q.id,
  query: q.query,
  status: q.status,
  baselineRank: q.baseline.firstRank || 0,
  bm25Rank: q.bm25.firstRank || 0,
  baselineTop: q.baselineTop,
  bm25Top: q.bm25Top
}));
const specialIds = ['fee-ti-wave-1a','fee-si-wave-2','ukm-info','typo-query','abbr-query-si','small-talk','out-of-domain'];
const special = specialIds.map(id => {
  const q = analysis.perQuery.find(p => p.id === id);
  if (!q) return { id, missing: true };
  return {
    id,
    query: q.query,
    status: q.status,
    baselineRank: q.baseline.firstRank || 0,
    bm25Rank: q.bm25.firstRank || 0,
    baselineTop: q.baselineTop,
    bm25Top: q.bm25Top
  };
});
const audit = {
  metrics: {
    totalQueries: analysis.perQuery.length,
    hit1Baseline: analysis.baseline.hitsAt1,
    hit1BM25: analysis.bm25.hitsAt1,
    hit3Baseline: analysis.baseline.hitsAt3,
    hit3BM25: analysis.bm25.hitsAt3,
    hit5Baseline: analysis.baseline.hitsAt5,
    hit5BM25: analysis.bm25.hitsAt5,
    mrrBaseline: Number(analysis.baseline.mrr.toFixed(3)),
    mrrBM25: Number(analysis.bm25.mrr.toFixed(3)),
    improved: analysis.counts.improved,
    unchanged: analysis.counts.unchanged,
    regressed: analysis.counts.regressed,
    noRelevant: analysis.counts.trueNoResult,
    workerError: analysis.counts.workerError,
    invalidJson: analysis.counts.invalidJson,
    timeout: analysis.counts.timeout
  },
  changed,
  special
};
console.log(JSON.stringify(audit, null, 2));
