// Simple in-memory BM25 implementation for sparse retrieval
const DEFAULTS = { k1: 1.5, b: 0.75 };

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildInvertedIndex(docs) {
  const N = docs.length;
  const df = Object.create(null);
  const inv = new Array(N);
  let totalLen = 0;

  for (let i = 0; i < N; i++) {
    const tokens = tokenize(docs[i] && docs[i].text ? docs[i].text : docs[i] || '');
    totalLen += tokens.length;
    const freqs = Object.create(null);
    for (const t of tokens) freqs[t] = (freqs[t] || 0) + 1;
    inv[i] = { freqs, len: tokens.length };
    for (const t of Object.keys(freqs)) df[t] = (df[t] || 0) + 1;
  }

  const avgLen = N ? totalLen / N : 0;
  return { inv, df, avgLen, N };
}

function computeBm25Scores(query, docs, opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const texts = docs.map(d => (d && d.text) ? String(d.text) : String(d || ''));
  const idx = buildInvertedIndex(texts);
  const qTerms = tokenize(query);
  const scores = new Array(docs.length).fill(0);

  for (const term of qTerms) {
    const df = idx.df[term] || 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < idx.N; i++) {
      const f = idx.inv[i].freqs[term] || 0;
      if (f === 0) continue;
      const denom = f + o.k1 * (1 - o.b + o.b * (idx.inv[i].len / idx.avgLen || 0));
      const score = idf * ((f * (o.k1 + 1)) / (denom || 1));
      scores[i] += score;
    }
  }

  // return array of { index, score }
  return scores.map((s, i) => ({ index: i, score: s }));
}

module.exports = { computeBm25Scores };
