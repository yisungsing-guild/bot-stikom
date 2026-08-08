process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
let allowStdout = false;
const consoleTimers = new Map();

function stderrWrite(...args) {
  return originalConsoleError(...args);
}

console.log = (...args) => stderrWrite(...args);
console.info = (...args) => stderrWrite(...args);
console.warn = (...args) => originalConsoleWarn(...args);
console.debug = (...args) => stderrWrite(...args);
console.trace = (...args) => stderrWrite(...args);
console.time = (label = 'default') => {
  consoleTimers.set(String(label), Date.now());
};
console.timeLog = (label = 'default', ...args) => {
  const start = consoleTimers.get(String(label));
  const elapsed = start ? Date.now() - start : NaN;
  stderrWrite(`${label}: ${Number.isFinite(elapsed) ? elapsed : 'NaN'}ms`, ...args);
};
console.timeEnd = (label = 'default') => {
  const start = consoleTimers.get(String(label));
  const elapsed = start ? Date.now() - start : NaN;
  stderrWrite(`${label}: ${Number.isFinite(elapsed) ? elapsed : 'NaN'}ms`);
  consoleTimers.delete(String(label));
};

let allowedStdoutChunk = null;
process.stdout.write = (chunk, encoding, cb) => {
  if (typeof encoding === 'function') {
    cb = encoding;
    encoding = undefined;
  }

  const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString(encoding || 'utf8');
  if (allowedStdoutChunk !== null && chunkStr === allowedStdoutChunk) {
    allowedStdoutChunk = null;
    return originalStdoutWrite(chunk, encoding, cb);
  }

  return originalStderrWrite(chunk, encoding, cb);
};

function writeStdoutJson(value) {
  allowedStdoutChunk = value;
  originalStdoutWrite(value, 'utf8');
  allowedStdoutChunk = null;
}

process.on('uncaughtException', (err) => {
  try {
    originalStderrWrite(`${JSON.stringify({ error: String(err && err.message ? err.message : err) })}\n`, 'utf8');
  } catch (_) {}
  process.exit(2);
});

process.on('unhandledRejection', (reason) => {
  try {
    originalStderrWrite(`${JSON.stringify({ error: String(reason && reason.message ? reason.message : reason) })}\n`, 'utf8');
  } catch (_) {}
  process.exit(2);
});

const { queryScoped } = require('../src/engine/ragScoped');
const RAG_RRF_ENABLED = /^(1|true|yes)$/i.test(String(process.env.RAG_RRF_ENABLED || '0'));

// Runs a single query and prints a sanitized JSON trace to stdout
// args: query, category, topK

async function run() {
  const q = process.argv[2] || '';
  const category = process.argv[3] || '';
  const topK = parseInt(process.argv[4] || '5', 10);

  try {
    if (process.env.FORCE_WORKER_ERROR === '1') {
      throw new Error('forced worker error');
    }

    let results = [];
    let debug = {};
    if (process.env.FORCE_EMPTY_RESULT === '1') {
      results = [];
    } else {
      const res = await queryScoped({ query: q, category, topK, options: {} });
      debug = (res && res.debug) || {};
      const trace = debug.retrievalTrace || null;

      if (trace && Array.isArray(trace.traces)) {
        results = trace.traces.map((t) => ({
          finalRank: t.rank,
          chunkId: t.id || null,
          documentId: (t.metadata && (t.metadata.trainingId || t.metadata.documentId)) || null,
          source: (t.metadata && t.metadata.source) || null,
          preview: t.preview || '',
          semanticRank: typeof t.semanticRank === 'number' ? t.semanticRank : null,
          semanticScore: typeof t.semanticScore === 'number' ? t.semanticScore : 0,
          lexicalRank: typeof t.lexicalRank === 'number' ? t.lexicalRank : null,
          lexicalScore: typeof t.lexicalScore === 'number' ? t.lexicalScore : 0,
          bm25Rank: typeof t.bm25Rank === 'number' ? t.bm25Rank : null,
          bm25Score: typeof t.bm25Score === 'number' ? t.bm25Score : (typeof t.bm25 === 'number' ? t.bm25 : 0),
          bm25Contribution: typeof t.bm25Contribution === 'number' ? t.bm25Contribution : 0,
          rrfScore: typeof t.rrfScore === 'number' ? t.rrfScore : null,
          retrievalScore: typeof t.retrievalScore === 'number' ? t.retrievalScore : null,
          adjustedScore: typeof t.adjustedScore === 'number' ? t.adjustedScore : null,
          finalScore: typeof t.finalScore === 'number' ? t.finalScore : 0,
          matchedTerms: Array.isArray(t.matchedTerms) ? t.matchedTerms : [],
          topic: t.topic || null,
          selected: t.rank === 1
        }));
      } else {
        const ctxs = res && (res.localDomainContexts || res.contexts) || [];
        results = ctxs.map((c, i) => ({
          finalRank: i + 1,
          chunkId: c.id || null,
          documentId: (c.metadata && (c.metadata.trainingId || c.metadata.documentId)) || null,
          source: (c.metadata && c.metadata.source) || null,
          preview: String(c.chunk || '').slice(0, 240),
          semanticRank: null,
          semanticScore: typeof c.score === 'number' ? c.score : 0,
          lexicalRank: null,
          lexicalScore: 0,
          bm25Rank: null,
          bm25Score: 0,
          bm25Contribution: 0,
          finalScore: typeof c.score === 'number' ? c.score : 0,
          matchedTerms: [],
          topic: (c.metadata && c.metadata.category) || null,
          selected: i === 0
        }));
      }
    }

    const mode = RAG_RRF_ENABLED
      ? 'rrf-bm25'
      : /^(1|true|yes)$/i.test(String(process.env.RAG_BM25_ENABLED || ''))
        ? 'legacy-bm25'
        : 'baseline';

    const out = {
      query: q,
      category,
      mode,
      results,
      debug
    };

    writeStdoutJson(`${JSON.stringify(out)}\n`);
    process.exit(0);
  } catch (e) {
    originalStderrWrite(`${JSON.stringify({ error: String(e && e.message || e) })}\n`, 'utf8');
    process.exit(2);
  }
}

run();
