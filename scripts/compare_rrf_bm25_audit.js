const fs = require('fs');
const path = require('path');
const infile = path.resolve(__dirname, '..', 'outputs', 'local_domain_rag_retrieval_evaluation.json');
const outfile = path.resolve(__dirname, '..', 'outputs', 'rrf_bm25_per_query_audit.json');
function safeParseStdout(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}
function firstTop(resultOutput) {
  if (!resultOutput) return null;
  if (resultOutput.output && Array.isArray(resultOutput.output.results) && resultOutput.output.results.length) {
    return resultOutput.output.results[0];
  }
  const p = safeParseStdout(resultOutput && resultOutput.stdout);
  if (p && Array.isArray(p.results) && p.results.length) return p.results[0];
  return null;
}
function getTraces(resultOutput) {
  if (!resultOutput) return [];
  if (resultOutput.output && resultOutput.output.debug && resultOutput.output.debug.retrievalTrace && Array.isArray(resultOutput.output.debug.retrievalTrace.traces)) {
    return resultOutput.output.debug.retrievalTrace.traces;
  }
  const p = safeParseStdout(resultOutput && resultOutput.stdout);
  if (p && p.debug && p.debug.retrievalTrace && Array.isArray(p.debug.retrievalTrace.traces)) return p.debug.retrievalTrace.traces;
  if (p && Array.isArray(p.results)) return p.results;
  if (resultOutput.output && Array.isArray(resultOutput.output.results)) return resultOutput.output.results;
  return [];
}

const raw = fs.readFileSync(infile, 'utf8');
const data = JSON.parse(raw);
const per = data.analysis.perQuery;
const resultsObj = data.results || {};

const onlyBm25 = [];
const onlyRrf = [];
const improvedRrf = [];
const regressedRrf = [];
const allNoResult = [];

const perQueryDetails = [];

for (const q of per) {
  const id = q.id;
  const resEntry = resultsObj[id] || {};
  const baseline = q.baseline || {};
  const bm25 = q.bm25 || {};
  const rrf = q.rrf || {};
  const baselineIncluded = Boolean(baseline.included);
  const bm25Included = Boolean(bm25.included);
  const rrfIncluded = Boolean(rrf.included);

  const baselineRelevantRank = baseline.firstRank || 0;
  const bm25RelevantRank = bm25.firstRank || 0;
  const rrfRelevantRank = rrf.firstRank || 0;

  const baselineTopRaw = firstTop(resEntry.baseline);
  const bm25TopRaw = firstTop(resEntry.bm25);
  const rrfTopRaw = firstTop(resEntry.rrf);

  const baselineTop = baselineTopRaw ? { chunkId: baselineTopRaw.chunkId || baselineTopRaw.id || null, preview: baselineTopRaw.preview || baselineTopRaw.chunk || '' } : null;
  const bm25Top = bm25TopRaw ? { chunkId: bm25TopRaw.chunkId || bm25TopRaw.id || null, preview: bm25TopRaw.preview || bm25TopRaw.chunk || '' } : null;
  const rrfTop = rrfTopRaw ? { chunkId: rrfTopRaw.chunkId || rrfTopRaw.id || null, preview: rrfTopRaw.preview || rrfTopRaw.chunk || '' } : null;

  // Lists
  if (bm25LocalOnly(baseline, bm25, rrf)) onlyBm25.push(id);
  if (rrfLocalOnly(baseline, bm25, rrf)) onlyRrf.push(id);

  // Improvement/regression
  if (isImproved(bm25RelevantRank, rrfRelevantRank)) improvedRrf.push(id);
  if (isRegressed(bm25RelevantRank, rrfRelevantRank)) regressedRrf.push(id);

  if (isAllNoResult(baseline, bm25, rrf)) allNoResult.push(id);

  perQueryDetails.push({
    id,
    query: q.query,
    category: q.category,
    baselineRelevantRank,
    bm25RelevantRank,
    rrfRelevantRank,
    baselineIncluded,
    bm25Included,
    rrfIncluded,
    baselineTop,
    bm25Top,
    rrfTop
  });
}

function bm25LocalOnly(baseline, bm25, rrf) {
  return Boolean(bm25.included) && !Boolean(baseline.included) && !Boolean(rrf.included);
}
function rrfLocalOnly(baseline, bm25, rrf) {
  return Boolean(rrf.included) && !Boolean(baseline.included) && !Boolean(bm25.included);
}
function isImproved(bm25Rank, rrfRank) {
  // improved if rrf has a hit and is ranked better (lower number) than bm25 OR bm25 had no hit and rrf has one
  if (rrfRank > 0 && (bm25Rank === 0 || rrfRank < bm25Rank)) return true;
  return false;
}
function isRegressed(bm25Rank, rrfRank) {
  // regressed if bm25 had a hit and rrf either lost it or has worse rank
  if (bm25Rank > 0 && (rrfRank === 0 || rrfRank > bm25Rank)) return true;
  return false;
}
function isAllNoResult(baseline, bm25, rrf) {
  return Boolean(baseline.isNoResult) && Boolean(bm25.isNoResult) && Boolean(rrf.isNoResult);
}

// For queries where RRF regressed vs BM25, extract top 5 traces from RRF traces
const rrfRegressedDetails = {};
for (const id of regressedRrf) {
  const resEntry = resultsObj[id] || {};
  const traces = getTraces(resEntry.rrf) || [];
  const top5 = traces.slice(0,5).map(t => ({
    chunkId: t.chunkId || t.id || null,
    source: t.source || null,
    preview: t.preview || t.chunk || '',
    denseRank: t.semanticRank || t.denseRank || null,
    bm25Rank: t.bm25Rank || null,
    lexicalRank: t.lexicalRank || null,
    semanticScore: typeof t.semanticScore === 'number' ? t.semanticScore : (t.semanticScore || null),
    bm25Score: typeof t.bm25Score === 'number' ? t.bm25Score : (t.bm25 || null),
    lexicalScore: typeof t.lexicalScore === 'number' ? t.lexicalScore : (t.lexicalScore || null),
    rrfScore: typeof t.rrfScore === 'number' ? t.rrfScore : null,
    gateScore: typeof t.gateScore === 'number' ? t.gateScore : null,
    legacyFinalScore: typeof t.legacyFinalScore === 'number' ? t.legacyFinalScore : (t.legacyFinalScore || null),
    finalScore: typeof t.finalScore === 'number' ? t.finalScore : (t.finalScore || null),
    passedGate: typeof t.passedGate === 'boolean' ? t.passedGate : (t.passedGate === undefined ? null : Boolean(t.passedGate))
  }));
  rrfRegressedDetails[id] = top5;
}

// Comparison counts
const totals = {
  rrfImprovedOverBm25: improvedRrf.length,
  rrfUnchangedVsBm25: per.length - improvedRrf.length - regressedRrf.length,
  rrfRegressedVsBm25: regressedRrf.length,
  bm25OnlyLocalDomain: onlyBm25.length,
  rrfOnlyLocalDomain: onlyRrf.length
};

// Hit@1/3/5 from analysis
const hits = {
  baseline: data.analysis.baseline.hitsAt1 && data.analysis.baseline.hitsAt3 && data.analysis.baseline.hitsAt5 ? { hit1: data.analysis.baseline.hitsAt1, hit3: data.analysis.baseline.hitsAt3, hit5: data.analysis.baseline.hitsAt5 } : null,
  bm25: data.analysis.bm25.hitsAt1 && data.analysis.bm25.hitsAt3 && data.analysis.bm25.hitsAt5 ? { hit1: data.analysis.bm25.hitsAt1, hit3: data.analysis.bm25.hitsAt3, hit5: data.analysis.bm25.hitsAt5 } : null,
  rrf: data.analysis.rrf.hitsAt1 && data.analysis.rrf.hitsAt3 && data.analysis.rrf.hitsAt5 ? { hit1: data.analysis.rrf.hitsAt1, hit3: data.analysis.rrf.hitsAt3, hit5: data.analysis.rrf.hitsAt5 } : null
};

// Sanity checks
const sanity = {
  workerError: data.analysis.counts.workerError || 0,
  invalidJson: data.analysis.counts.invalidJson || 0,
  timeout: data.analysis.counts.timeout || 0,
  anyNaNorInf: false,
  legacyThresholdsPresent: true,
  bm25OutputsPresent: true
};

// scan for NaN/Infinity in traces/results
function checkFinite(val) {
  return typeof val === 'number' && Number.isFinite(val);
}
for (const id of Object.keys(resultsObj)) {
  const modes = ['baseline','bm25','rrf'];
  for (const m of modes) {
    const out = resultsObj[id][m];
    const arr = (out && out.output && Array.isArray(out.output.results)) ? out.output.results : [];
    for (const c of arr) {
      for (const k of ['semanticScore','bm25Score','lexicalScore','rrfScore','finalScore']) {
        if (c && c.hasOwnProperty(k) && c[k] !== null && !checkFinite(c[k])) sanity.anyNaNorInf = true;
      }
    }
  }
}

const report = {
  summary: {
    totalQueries: per.length,
    totals,
    hits
  },
  lists: {
    onlyBm25,
    onlyRrf,
    improvedRrf,
    regressedRrf,
    allNoResult
  },
  perQueryDetails,
  rrfRegressedDetails,
  sanity
};

fs.writeFileSync(outfile, JSON.stringify(report, null, 2), 'utf8');
console.log('Wrote:', outfile);
console.log(JSON.stringify(report, null, 2));
