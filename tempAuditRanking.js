const fs = require('fs');
const path = require('path');
const { extractStructuredEntities, getChunkEntities, getChunkScoreBreakdown, computeEmbedding } = require('./src/engine/ragEngine');

const INDEX_PATH = path.join(__dirname, 'src', 'data', 'rag_index.json');
const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * (b[i] || 0);
    na += a[i] * a[i];
    nb += (b[i] || 0) * (b[i] || 0);
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function matchedAttributes(queryEntities, chunkEntities) {
  const matches = [];
  for (const key of Object.keys(queryEntities || {})) {
    if (queryEntities[key] == null || chunkEntities[key] == null) continue;
    if (String(queryEntities[key]).toLowerCase() === String(chunkEntities[key]).toLowerCase()) {
      matches.push(key);
    }
  }
  return matches;
}

function queryCategoryForDisplay(qEntities) {
  return qEntities && qEntities.category ? String(qEntities.category).toUpperCase() : null;
}

const queries = [
  'Apa itu Sistem Informasi',
  'Apa itu Teknologi Informasi',
  'Prospek kerja Sistem Informasi',
  'Prospek kerja Teknologi Informasi',
  'Biaya kuliah Sistem Informasi',
  'Biaya pendaftaran Sistem Informasi',
  'Double Degree Internasional',
  'Double Degree Nasional'
];

(async () => {
  const results = [];
  for (const q of queries) {
    const queryEntities = extractStructuredEntities(q);
    const intent = queryEntities.intent || null;
    const queryEmbedding = await computeEmbedding(q);
    const rows = index
    .map((item) => {
      const semanticScore = Array.isArray(item.embedding) && Array.isArray(queryEmbedding)
        ? cosineSimilarity(item.embedding, queryEmbedding)
        : 0;
      const breakdown = getChunkScoreBreakdown(item, q, intent, semanticScore, queryEntities);
      const chunkEntities = getChunkEntities(item);
      return {
        item,
        rawScore: breakdown.rawScore,
        finalScore: breakdown.finalScore,
        semanticScore: semanticScore,
        attributeScore: breakdown.attributeScore,
        metadataBoost: breakdown.metadataBoost,
        queryEntities,
        chunkEntities,
        matchedAttributes: matchedAttributes(queryEntities, chunkEntities),
        filename: item.filename || item.trainingId || null,
        docCategory: item.docCategory || item.category || null
      };
    })
    .sort((a, b) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      return (b.semanticScore || 0) - (a.semanticScore || 0);
    })
    .slice(0, 20)
    .map((row, index) => ({ rank: index + 1, rawScore: row.rawScore, finalScore: row.finalScore, semanticScore: row.semanticScore, attributeScore: row.attributeScore, metadataBoost: row.metadataBoost, queryEntities: row.queryEntities, chunkEntities: row.chunkEntities, matchedAttributes: row.matchedAttributes, filename: row.filename, docCategory: row.docCategory }));
    results.push({ query: q, queryEntities, rows });
  }
  fs.writeFileSync('tempAuditRanking.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote tempAuditRanking.json');
})();
