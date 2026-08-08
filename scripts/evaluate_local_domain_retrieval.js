const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const FIXTURES = path.resolve(__dirname, '../tests/fixtures/localDomainRetrievalEvaluation.json');
const OUTPUT_JSON = path.resolve(__dirname, '../outputs/local_domain_rag_retrieval_evaluation.json');
const OUTPUT_MD = path.resolve(__dirname, '../outputs/local_domain_rag_retrieval_evaluation.md');
const WORKER = path.resolve(__dirname, './query_worker.js');

function loadFixtures() {
  return JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
}

function runWorker(query, category, topK, bm25Enabled, rrfEnabled = false) {
  const env = Object.assign({}, process.env, {
    RAG_BM25_ENABLED: bm25Enabled ? '1' : '0',
    RAG_RRF_ENABLED: rrfEnabled ? '1' : '0',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent'
  });
  const args = [WORKER, query, category, String(topK)];
  const res = spawnSync(process.execPath, args, {
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');

  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') {
      return { status: 'timeout', error: String(res.error.message || res.error), stdout, stderr };
    }
    return { status: 'worker_error', error: String(res.error.message || res.error), stdout, stderr };
  }

  if (res.status !== 0) {
    let parsedError;
    try { parsedError = JSON.parse(stderr.trim()); } catch (ignored) {}
    const errorDetail = parsedError && parsedError.error ? parsedError.error : stderr.trim() || `exit code ${res.status}`;
    return { status: 'worker_error', error: errorDetail, stdout, stderr };
  }

  const trimmedStdout = stdout.trim();
  if (!trimmedStdout) {
    return { status: 'invalid_json', error: 'empty stdout', stdout, stderr };
  }

  try {
    const parsed = JSON.parse(trimmedStdout);
    return { status: 'success', output: parsed, stdout, stderr };
  } catch (e) {
    return { status: 'invalid_json', error: String(e.message), stdout, stderr };
  }
}

function isLocalDomainOutput(output) {
  return output && output.debug && output.debug.retrievalPath === 'local-domain' && output.debug.localDomainRetrievalUsed === true;
}

const PROGRAM_ALIASES = {
  TI: ['teknologi informasi', '\\bti\\b'],
  SI: ['sistem informasi', '\\bsi\\b'],
  DKV: ['dkv', 'desain komunikasi visual'],
  BD: ['bisnis digital', '\\bbd\\b'],
  RPL: ['rekayasa perangkat lunak', '\\brpl\\b'],
  MM: ['multimedia', '\\bmm\\b'],
  TK: ['teknik komputer', '\\btk\\b', '\\bkomputer\\b']
};

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function stringContainsAny(text, patterns) {
  if (!text || !patterns || !patterns.length) return false;
  const lower = normalizeText(text);
  return patterns.some(p => lower.includes(normalizeText(p)));
}

function countMatches(text, patterns) {
  if (!text || !patterns || !patterns.length) return 0;
  const lower = normalizeText(text);
  return patterns.reduce((count, kw) => {
    if (!kw) return count;
    return count + (lower.includes(normalizeText(kw)) ? 1 : 0);
  }, 0);
}

function matchProgram(text, expectedProgram) {
  if (!expectedProgram) return true;
  const aliases = PROGRAM_ALIASES[expectedProgram] || [expectedProgram];
  const lower = normalizeText(text);
  return aliases.some(alias => {
    const normalizedAlias = normalizeText(alias);
    const pattern = alias.startsWith('\\b')
      ? new RegExp(alias, 'i')
      : new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(lower);
  });
}

function evaluateResult(result, fix) {
  const preview = normalizeText(result && result.preview || '');
  const source = normalizeText(result && result.source || '');
  const topic = normalizeText(result && result.topic || '');
  const matchedTerms = Array.isArray(result && result.matchedTerms) ? normalizeText(result.matchedTerms.join(' ')) : '';
  const combined = normalizeText([preview, source, matchedTerms].filter(Boolean).join(' '));

  const forbidden = (fix.forbiddenKeywords || []).filter(k => k && combined.includes(normalizeText(k)));
  const categoryMatch = fix.category === 'unknown' || fix.category === 'small_talk'
    ? true
    : (topic && topic === normalizeText(fix.category)) || stringContainsAny(combined, fix.expectedSourcePatterns || []);
  const programMatch = matchProgram(combined, fix.expectedProgram);
  const keywordMatches = countMatches(combined, fix.expectedKeywords || []);
  const sourceMatches = countMatches(combined, fix.expectedSourcePatterns || []);

  if (fix.expectedNoRetrieval) {
    return {
      relevant: false,
      score: 0,
      matched: { program: programMatch, keywords: keywordMatches, source: sourceMatches, category: categoryMatch, forbidden },
      violations: forbidden,
      reason: 'expectedNoRetrieval'
    };
  }

  const strongKeyword = keywordMatches >= 2;
  const strongSource = sourceMatches >= 1;
  const categoryViolation = fix.category && fix.category !== 'unknown' && fix.category !== 'small_talk' && topic && topic !== normalizeText(fix.category);
  const programViolation = fix.expectedProgram && !programMatch && !strongKeyword && !strongSource;
  const relevant = forbidden.length === 0 && !categoryViolation && !programViolation && (strongKeyword || strongSource || (fix.expectedProgram && programMatch));
  const score = (programMatch ? 2 : 0) + (categoryMatch ? 1 : 0) + (strongKeyword ? 1 : 0) + (strongSource ? 0.5 : 0) - (forbidden.length > 0 ? 10 : 0);

  const matched = {
    program: programMatch,
    keywords: keywordMatches,
    source: sourceMatches,
    category: !categoryViolation,
    forbidden
  };

  const violations = [];
  if (forbidden.length) violations.push('forbiddenKeywords');
  if (categoryViolation) violations.push('categoryMismatch');
  if (programViolation) violations.push('programMismatch');

  const reasonParts = [];
  if (forbidden.length) reasonParts.push(`forbidden: ${forbidden.join(', ')}`);
  if (categoryViolation) reasonParts.push('category mismatch');
  if (programViolation) reasonParts.push('program mismatch');
  if (!relevant && !reasonParts.length) reasonParts.push('insufficient keyword/source match');

  return {
    relevant,
    score,
    matched,
    violations,
    reason: reasonParts.join('; ')
  };
}

function analyze(fixtures, allResults) {
  const summary = {
    baseline: { hitsAt1: 0, hitsAt3: 0, hitsAt5: 0, mrr: 0, noResult: 0, forbiddenInTop3: 0, includedCount: 0 },
    bm25: { hitsAt1: 0, hitsAt3: 0, hitsAt5: 0, mrr: 0, noResult: 0, forbiddenInTop3: 0, includedCount: 0 },
    rrf: { hitsAt1: 0, hitsAt3: 0, hitsAt5: 0, mrr: 0, noResult: 0, forbiddenInTop3: 0, includedCount: 0 },
    counts: {
      totalQueries: fixtures.length,
      baselineIncluded: 0,
      bm25Included: 0,
      rrfIncluded: 0,
      allModesIncluded: 0,
      baselineExcluded: 0,
      bm25Excluded: 0,
      rrfExcluded: 0,
      workerError: 0,
      invalidJson: 0,
      timeout: 0
    },
    perQuery: []
  };

  for (const fix of fixtures) {
    const base = allResults[fix.id] && allResults[fix.id].baseline;
    const bm = allResults[fix.id] && allResults[fix.id].bm25;
    const rrf = allResults[fix.id] && allResults[fix.id].rrf;

    function scoreMode(modeResult) {
      const out = { hit1: false, hit3: false, hit5: false, firstRank: 0, mrr: 0, forbiddenTop3: 0, isNoResult: false, included: false };
      if (!modeResult || modeResult.status !== 'success') return out;
      if (!isLocalDomainOutput(modeResult.output)) return out;
      out.included = true;
      const rs = (modeResult.output && modeResult.output.results) || [];
      let firstRelevantRank = 0;
      for (let i = 0; i < rs.length; i += 1) {
        const result = rs[i];
        const evaluation = evaluateResult(result, fix);
        const forbiddenFound = evaluation.matched.forbidden.length > 0;
        if (i < 3 && forbiddenFound) out.forbiddenTop3 += 1;
        if (evaluation.relevant && firstRelevantRank === 0) {
          firstRelevantRank = i + 1;
        }
        if (i === 0 && evaluation.relevant) out.hit1 = true;
        if (i < 3 && evaluation.relevant) out.hit3 = true;
        if (i < 5 && evaluation.relevant) out.hit5 = true;
      }
      out.firstRank = firstRelevantRank;
      out.mrr = firstRelevantRank > 0 ? 1 / firstRelevantRank : 0;
      out.isNoResult = rs.length === 0 || firstRelevantRank === 0;
      return out;
    }

    const baseScore = scoreMode(base);
    const bmScore = scoreMode(bm);
    const rrfScore = scoreMode(rrf);

    if (base && base.status === 'worker_error') summary.counts.workerError += 1;
    if (base && base.status === 'invalid_json') summary.counts.invalidJson += 1;
    if (base && base.status === 'timeout') summary.counts.timeout += 1;
    if (bm && bm.status === 'worker_error') summary.counts.workerError += 1;
    if (bm && bm.status === 'invalid_json') summary.counts.invalidJson += 1;
    if (bm && bm.status === 'timeout') summary.counts.timeout += 1;
    if (rrf && rrf.status === 'worker_error') summary.counts.workerError += 1;
    if (rrf && rrf.status === 'invalid_json') summary.counts.invalidJson += 1;
    if (rrf && rrf.status === 'timeout') summary.counts.timeout += 1;

    if (baseScore.included) {
      summary.baseline.includedCount += 1;
      summary.baseline.hitsAt1 += baseScore.hit1 ? 1 : 0;
      summary.baseline.hitsAt3 += baseScore.hit3 ? 1 : 0;
      summary.baseline.hitsAt5 += baseScore.hit5 ? 1 : 0;
      summary.baseline.mrr += baseScore.mrr;
      summary.baseline.noResult += baseScore.isNoResult ? 1 : 0;
      summary.baseline.forbiddenInTop3 += baseScore.forbiddenTop3 || 0;
      summary.counts.baselineIncluded += 1;
    } else {
      summary.counts.baselineExcluded += 1;
    }

    if (bmScore.included) {
      summary.bm25.includedCount += 1;
      summary.bm25.hitsAt1 += bmScore.hit1 ? 1 : 0;
      summary.bm25.hitsAt3 += bmScore.hit3 ? 1 : 0;
      summary.bm25.hitsAt5 += bmScore.hit5 ? 1 : 0;
      summary.bm25.mrr += bmScore.mrr;
      summary.bm25.noResult += bmScore.isNoResult ? 1 : 0;
      summary.bm25.forbiddenInTop3 += bmScore.forbiddenTop3 || 0;
      summary.counts.bm25Included += 1;
    } else {
      summary.counts.bm25Excluded += 1;
    }

    if (rrfScore.included) {
      summary.rrf.includedCount += 1;
      summary.rrf.hitsAt1 += rrfScore.hit1 ? 1 : 0;
      summary.rrf.hitsAt3 += rrfScore.hit3 ? 1 : 0;
      summary.rrf.hitsAt5 += rrfScore.hit5 ? 1 : 0;
      summary.rrf.mrr += rrfScore.mrr;
      summary.rrf.noResult += rrfScore.isNoResult ? 1 : 0;
      summary.rrf.forbiddenInTop3 += rrfScore.forbiddenTop3 || 0;
      summary.counts.rrfIncluded += 1;
    } else {
      summary.counts.rrfExcluded += 1;
    }

    if (baseScore.included && bmScore.included && rrfScore.included) {
      summary.counts.allModesIncluded += 1;
    }

    summary.perQuery.push({
      id: fix.id,
      query: fix.query,
      baseline: baseScore,
      bm25: bmScore,
      rrf: rrfScore,
      baselineLocalDomain: baseScore.included,
      bm25LocalDomain: bmScore.included,
      rrfLocalDomain: rrfScore.included,
      baselineStatus: base && base.status || 'unknown',
      bm25Status: bm && bm.status || 'unknown',
      rrfStatusMeta: rrf && rrf.status || 'unknown'
    });
  }

  summary.baseline.mrr = summary.baseline.includedCount ? summary.baseline.mrr / summary.baseline.includedCount : 0;
  summary.bm25.mrr = summary.bm25.includedCount ? summary.bm25.mrr / summary.bm25.includedCount : 0;
  summary.rrf.mrr = summary.rrf.includedCount ? summary.rrf.mrr / summary.rrf.includedCount : 0;
  return summary;
}

async function main() {
  const fixtures = loadFixtures();
  const allResults = {};
  for (const fix of fixtures) {
    allResults[fix.id] = { baseline: null, bm25: null, rrf: null };
    const b = runWorker(fix.query, fix.category, 5, false, false);
    allResults[fix.id].baseline = b;
    const e = runWorker(fix.query, fix.category, 5, true, false);
    allResults[fix.id].bm25 = e;
    const r = runWorker(fix.query, fix.category, 5, true, true);
    allResults[fix.id].rrf = r;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const analysis = analyze(fixtures, allResults);
  const out = { fixturesCount: fixtures.length, results: allResults, analysis };
  try { fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true }); } catch (e) {}
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2));

  const lines = [];
  lines.push('# Local-domain RAG Retrieval Evaluation');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary Metrics (local-domain only)');
  lines.push('');
  lines.push('| Metric | Baseline | BM25 | RRF |');
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Hit@1 | ${analysis.baseline.hitsAt1} | ${analysis.bm25.hitsAt1} | ${analysis.rrf.hitsAt1} |`);
  lines.push(`| Hit@3 | ${analysis.baseline.hitsAt3} | ${analysis.bm25.hitsAt3} | ${analysis.rrf.hitsAt3} |`);
  lines.push(`| Hit@5 | ${analysis.baseline.hitsAt5} | ${analysis.bm25.hitsAt5} | ${analysis.rrf.hitsAt5} |`);
  lines.push(`| MRR | ${analysis.baseline.mrr.toFixed(3)} | ${analysis.bm25.mrr.toFixed(3)} | ${analysis.rrf.mrr.toFixed(3)} |`);
  lines.push('');
  lines.push('## Included Local-domain Counts');
  lines.push('');
  lines.push('| Mode | Included Queries | Excluded Queries |');
  lines.push('|---|---:|---:|');
  lines.push(`| Baseline | ${analysis.counts.baselineIncluded} | ${analysis.counts.baselineExcluded} |`);
  lines.push(`| BM25 | ${analysis.counts.bm25Included} | ${analysis.counts.bm25Excluded} |`);
  lines.push(`| RRF | ${analysis.counts.rrfIncluded} | ${analysis.counts.rrfExcluded} |`);
  lines.push('');
  lines.push(`Total fixture queries: ${analysis.counts.totalQueries}`);
  lines.push(`Queries with local-domain retrieval in all modes: ${analysis.counts.allModesIncluded}`);
  lines.push('');
  lines.push('## Status Counts');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|---|---:|');
  lines.push(`| worker_error | ${analysis.counts.workerError} |`);
  lines.push(`| invalid_json | ${analysis.counts.invalidJson} |`);
  lines.push(`| timeout | ${analysis.counts.timeout} |`);
  lines.push('');
  lines.push('## Per-query local-domain inclusion');
  lines.push('');
  lines.push('| Query | Baseline | BM25 | RRF | Baseline Rank | BM25 Rank | RRF Rank |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const p of analysis.perQuery) {
    lines.push(`| ${p.id} | ${p.baselineLocalDomain ? 'yes' : 'no'} | ${p.bm25LocalDomain ? 'yes' : 'no'} | ${p.rrfLocalDomain ? 'yes' : 'no'} | ${p.baseline.firstRank || '-'} | ${p.bm25.firstRank || '-'} | ${p.rrf.firstRank || '-'} |`);
  }
  fs.writeFileSync(OUTPUT_MD, lines.join('\n'));
  console.log('Wrote:', OUTPUT_JSON, OUTPUT_MD);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
