const { getRagIngestChunksPath, getRagDomainVectorsPath } = require('../../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');
const { detectKnowledgeDomain } = require('../../src/engine/domainClassifier');

function loadJsonl(fp) {
  if (!fs.existsSync(fp)) throw new Error('File not found: ' + fp);
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.map(l => JSON.parse(l));
}

function scoreChunk(chunk, qTokens) {
  const text = (chunk.text || '').toLowerCase();
  const meta = JSON.stringify(chunk.metadata || {}).toLowerCase();
  let score = 0;
  for (const t of qTokens) {
    if (text.includes(t)) score += 2;
    if (meta.includes(t)) score += 3;
  }
  // small boost for category match if token equals category
  for (const t of qTokens) {
    if ((chunk.metadata || {}).category === t) score += 5;
  }
  return score;
}

function retrieve(chunks, query, topK = 5) {
  const q = String(query || '').toLowerCase();
  const qTokens = q.split(/[^a-z0-9]+/).filter(Boolean);
  // Use domain classifier to prefer category matches when possible
  const predicted = detectKnowledgeDomain(query);
  let pool = chunks;
  if (predicted && predicted !== 'unknown') {
    const byCat = chunks.filter(c => (c.metadata && c.metadata.category) === predicted);
    if (byCat.length) pool = byCat;
  }

  const scored = pool.map(c => ({ c, s: scoreChunk(c, qTokens) }));
  scored.sort((a,b) => b.s - a.s);
  return scored.slice(0, topK).map(x => ({ id: x.c.id, score: x.s, category: x.c.metadata.category, topic: x.c.metadata.topic, snippet: x.c.text.slice(0,240).replace(/\n+/g,' ') }));
}

if (require.main === module) {
  const dataFile = getRagIngestChunksPath('domains_chunks.jsonl');
  const chunks = loadJsonl(dataFile);
  const queries = [
    'ada beasiswa?',
    'jelaskan double degree',
    'kelas internasional ada?',
    'program exchange ada?',
    'takut matematika tapi suka marketing'
  ];

  for (const q of queries) {
    console.log('\n--- Query:', q);
    const res = retrieve(chunks, q, 5);
    for (const r of res) {
      console.log(`- [${r.score}] (${r.category}/${r.topic}) ${r.snippet}`);
    }
  }
}

module.exports = { retrieve };
