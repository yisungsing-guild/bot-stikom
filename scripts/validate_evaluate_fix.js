const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/ragRetrievalEvaluation.json'), 'utf8'));
const WORKER = path.resolve(__dirname, './query_worker.js');

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
  return patterns.some((p) => lower.includes(normalizeText(p)));
}

function countMatches(text, patterns) {
  if (!text || !patterns || !patterns.length) return 0;
  const lower = normalizeText(text);
  return patterns.reduce((count, kw) => (kw && lower.includes(normalizeText(kw)) ? count + 1 : count), 0);
}

function matchProgram(text, expectedProgram) {
  if (!expectedProgram) return true;
  const aliases = PROGRAM_ALIASES[expectedProgram] || [expectedProgram];
  const lower = normalizeText(text);
  return aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias);
    const pattern = alias.startsWith('\\b')
      ? new RegExp(alias, 'i')
      : new RegExp(`\\b${normalizedAlias.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
    return pattern.test(lower);
  });
}

function evaluateResult(result, fix) {
  const preview = normalizeText((result && result.preview) || '');
  const source = normalizeText((result && result.source) || '');
  const topic = normalizeText((result && result.topic) || '');
  const matchedTerms = Array.isArray(result && result.matchedTerms)
    ? normalizeText(result.matchedTerms.join(' '))
    : '';
  const combined = normalizeText([preview, source, matchedTerms].filter(Boolean).join(' '));

  const forbidden = (fix.forbiddenKeywords || []).filter(
    (k) => k && combined.includes(normalizeText(k))
  );
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
      matched: {
        program: programMatch,
        keywords: keywordMatches,
        source: sourceMatches,
        category: categoryMatch,
        forbidden
      },
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

function runWorker(query, category) {
  const env = Object.assign({}, process.env, {
    RAG_BM25_ENABLED: '0',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent'
  });
  const res = spawnSync(process.execPath, [WORKER, query, category, '5'], {
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`worker exit ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

const checkIds = ['fee-ti-wave-1a', 'ukm-info', 'small-talk'];
const summary = [];
for (const id of checkIds) {
  const fix = fixtures.find((f) => f.id === id);
  const output = runWorker(fix.query, fix.category);
  const results = output.results || [];
  const evals = results.slice(0, 3).map((r, idx) => ({
    rank: idx + 1,
    relevant: evaluateResult(r, fix).relevant,
    detail: evaluateResult(r, fix)
  }));
  summary.push({
    id,
    query: fix.query,
    resultsCount: results.length,
    firstResult: results[0]
      ? {
          preview: results[0].preview.slice(0, 200),
          source: results[0].source,
          topic: results[0].topic
        }
      : null,
    evals
  });
}

console.log(JSON.stringify(summary, null, 2));
