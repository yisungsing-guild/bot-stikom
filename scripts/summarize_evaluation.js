const fs = require('fs');
const path = require('path');
const p = path.resolve(__dirname, '..', 'outputs', 'rag_retrieval_evaluation.json');
const raw = fs.readFileSync(p, 'utf8');
const data = JSON.parse(raw);
// Expect data.results: object keyed by query id
const resultsObj = data.results || {};
const results = Object.keys(resultsObj).map(k => ({ id: k, ...resultsObj[k] }));
const summary = {
  totalQueries: results.length,
  hit1: { baseline: 0, bm25: 0 },
  hit3: { baseline: 0, bm25: 0 },
  hit5: { baseline: 0, bm25: 0 },
  mrr: { baseline: 0, bm25: 0 },
  counts: { improved: 0, unchanged: 0, regressed: 0, no_result: 0 },
  perQuery: []
};
function addReciprocal(rank) { if (!rank || rank <= 0) return 0; return 1 / rank; }
for (const entry of results) {
  const qid = entry.id;
  const base = entry.baseline || { results: [] };
  const bm = entry.bm25 || { results: [] };
  const br = (base.results && base.results.length>0) ? (base.results.find(r=>r.finalRank===1) ? base.results.find(r=>r.finalRank===1).finalRank : 1) : null;
  const mr = (bm.results && bm.results.length>0) ? (bm.results.find(r=>r.finalRank===1) ? bm.results.find(r=>r.finalRank===1).finalRank : 1) : null;
  const q = { id: qid, baselineRank: br, bm25Rank: mr };
  if (br && br === 1) summary.hit1.baseline++;
  if (mr && mr === 1) summary.hit1.bm25++;
  if (br && br <= 3) summary.hit3.baseline++;
  if (mr && mr <= 3) summary.hit3.bm25++;
  if (br && br <= 5) summary.hit5.baseline++;
  if (mr && mr <= 5) summary.hit5.bm25++;
  summary.mrr.baseline += addReciprocal(br || 0);
  summary.mrr.bm25 += addReciprocal(mr || 0);
  let status = 'unchanged';
  if ((br===null || br===0) && (mr!==null && mr>0)) status = 'improved';
  else if ((mr===null || mr===0) && (br!==null && br>0)) status = 'regressed';
  else if (br && mr) {
    if (mr < br) status = 'improved';
    else if (mr > br) status = 'regressed';
    else status = 'unchanged';
  } else if (!br && !mr) status = 'no_result';
  summary.counts[status] = (summary.counts[status] || 0) + 1;
  // pick top previews
  const baselineTop = (base.results && base.results.length>0) ? base.results.find(r=>r.finalRank===1) || base.results[0] : null;
  const bm25Top = (bm.results && bm.results.length>0) ? bm.results.find(r=>r.finalRank===1) || bm.results[0] : null;
  // reason heuristics
  let reason = 'no change';
  if (!baselineTop && bm25Top) reason = 'BM25 returned result where baseline had none';
  else if (baselineTop && !bm25Top) reason = 'BM25 returned no result where baseline had one';
  else if (baselineTop && bm25Top && baselineTop.chunkId !== bm25Top.chunkId) {
    const bm25Contrib = (bm25Top.bm25Contribution||0);
    if (bm25Contrib > 0) reason = `BM25 promoted a lexical match (bm25Contribution=${bm25Contrib})`;
    else reason = `Top chunk changed (baseline ${baselineTop.chunkId} → bm25 ${bm25Top.chunkId})`;
  } else if (baselineTop && bm25Top && baselineTop.finalScore !== bm25Top.finalScore) {
    reason = `score changed (baseline ${baselineTop.finalScore} → bm25 ${bm25Top.finalScore})`;
  }
  summary.perQuery.push({ id: qid, baselineTop, bm25Top, status, reason, baseline: base, bm25: bm });
}
// finalize MRR
summary.mrr.baseline = results.length ? (summary.mrr.baseline / results.length) : 0;
summary.mrr.bm25 = results.length ? (summary.mrr.bm25 / results.length) : 0;
// compute top improvements/regressions by delta = baselineRank - bm25Rank (positive = improved)
const withDelta = summary.perQuery.map(q => {
  const br = (q.baselineTop && q.baselineTop.finalRank) ? q.baselineTop.finalRank : (q.baseline && q.baseline.results && q.baseline.results.length? q.baseline.results[0].finalRank : null);
  const mr = (q.bm25Top && q.bm25Top.finalRank) ? q.bm25Top.finalRank : (q.bm25 && q.bm25.results && q.bm25.results.length? q.bm25.results[0].finalRank : null);
  const brn = (br===null||br===undefined) ? 9999 : br;
  const mrn = (mr===null||mr===undefined) ? 9999 : mr;
  return Object.assign({}, q, { delta: brn - mrn, baselineRank: br, bm25Rank: mr });
});
const improvedList = withDelta.slice().filter(x => x.delta>0).sort((a,b)=>b.delta-a.delta).slice(0,5);
const regressedList = withDelta.slice().filter(x => x.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,5);
const out = { summary, improvedList, regressedList };
try {
  const outPath = path.resolve(__dirname, '..', 'outputs', 'summarize_evaluation_simple.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('Wrote', outPath);
} catch (e) {
  console.log(JSON.stringify(out, null, 2));
}
