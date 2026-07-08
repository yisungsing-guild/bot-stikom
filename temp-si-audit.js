const fs = require('fs');
const path = require('path');
const engine = require('./src/engine/ragEngine');

const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?',
  'Apa keunggulan Sistem Informasi?'
];

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

(async () => {
  const indexPath = engine.getIndexPath();
  const rawIndex = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(rawIndex || '[]');
  for (const query of queries) {
    console.log('########## QUERY:', query);
    const currentUserQ = engine.extractCurrentUserQuestionText(query);
    const normalizedUserQ = engine.normalizeIndonesianQuestionText ? engine.normalizeIndonesianQuestionText(currentUserQ) : currentUserQ.toLowerCase();
    const queryForRetrieval = engine.normalizeQueryForRetrieval ? engine.normalizeQueryForRetrieval(normalizedUserQ) : normalizedUserQ;
    const queryEntities = engine.extractStructuredEntities(queryForRetrieval || normalizedUserQ || currentUserQ || query);
    const qEmb = await engine.computeEmbedding(queryForRetrieval || normalizedUserQ || currentUserQ || query);

    const scored = index.map(item => {
      const semantic = cosineSimilarity(qEmb, item.embedding || []);
      const breakdown = engine.getChunkScoreBreakdown(item, query, queryEntities.intent || 'GENERAL', semantic, queryEntities);
      return {
        item,
        score: semantic,
        semanticScore: semantic,
        ...breakdown,
      };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    const top = scored.slice(0, 10);
    top.forEach((s, idx) => {
      console.log(`\n#${idx + 1}`);
      console.log(`id: ${s.item.id}`);
      console.log(`filename: ${s.item.filename || s.item.trainingId || 'N/A'}`);
      console.log(`category: ${s.item.docCategory || s.item.category || 'N/A'}`);
      console.log(`semanticScore: ${s.semanticScore.toFixed(4)}`);
      console.log(`compositeScore: ${s.compositeScore.toFixed(4)}`);
      console.log(`finalScore: ${s.finalScore.toFixed(4)}`);
      console.log(`semanticBoost: ${s.semanticBoost.toFixed(4)}`);
      console.log(`evidenceScore: ${s.evidenceScore.toFixed(4)}`);
      console.log(`attributeScore: ${s.attributeScore.toFixed(4)}`);
      console.log(`metadataBoost: ${s.metadataBoost.toFixed(4)}`);
      console.log(`otherBoosts: ${s.otherBoosts.toFixed(4)}`);
      console.log(`exactMatch: ${JSON.stringify(s.exactMatch)}`);
      console.log(`itemEntities: ${JSON.stringify(s.itemEntities)}`);
      console.log(`chunkPreview: ${String(s.item.chunk || '').slice(0, 140).replace(/\s+/g, ' ').trim()}`);
    });
    console.log('\n');
  }
})();