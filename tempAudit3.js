const fs = require('fs');
const { query, extractStructuredEntities, extractStructuredChunkMetadata, getChunkEntities } = require('./src/engine/ragEngine');
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

function matchedAttributes(queryEntities, chunkEntities) {
  const matches = [];
  for (const key of Object.keys(queryEntities || {})) {
    if (!queryEntities[key] || !chunkEntities[key]) continue;
    if (String(queryEntities[key]).toLowerCase() === String(chunkEntities[key]).toLowerCase()) {
      matches.push(key);
    }
  }
  return matches;
}

(async () => {
  const results = [];
  for (const q of queries) {
    const result = await query(q, 20, { returnDebug: true });
    const debug = (result && result.debug) ? result.debug : {};
    const queryEntities = extractStructuredEntities(q);
    const rowsSource = debug.validatedScored && debug.validatedScored.length ? debug.validatedScored : (result.contexts || []);
    const rows = rowsSource.slice(0, 10).map((item, idx) => {
      const chunkEntitiesFromScore = item.scoreComponents && item.scoreComponents.itemEntities ? item.scoreComponents.itemEntities : {};
      const chunkEntitiesFromItem = getChunkEntities(item);
      const chunkMetadata = extractStructuredChunkMetadata(item.chunk || item.text || '');
      const chunkEntities = {
        program: chunkEntitiesFromScore.program || chunkEntitiesFromItem.program || chunkMetadata.program || null,
        programMode: chunkEntitiesFromScore.programMode || chunkEntitiesFromItem.programMode || chunkMetadata.programMode || null,
        wave: chunkEntitiesFromScore.wave || chunkEntitiesFromItem.wave || chunkMetadata.wave || null,
        waveGroup: chunkEntitiesFromScore.waveGroup || chunkEntitiesFromItem.waveGroup || chunkMetadata.waveGroup || null,
        academicYear: chunkEntitiesFromScore.academicYear || chunkEntitiesFromItem.academicYear || chunkMetadata.academicYear || null,
        partner: chunkEntitiesFromScore.partner || chunkEntitiesFromItem.partner || chunkMetadata.partner || null,
        campus: chunkEntitiesFromScore.campus || chunkEntitiesFromItem.campus || chunkMetadata.campus || null,
        jalur: chunkEntitiesFromScore.jalur || chunkEntitiesFromItem.jalur || chunkMetadata.jalur || null,
        feeType: chunkEntitiesFromScore.feeType || chunkEntitiesFromItem.feeType || chunkMetadata.feeType || null,
        category: chunkEntitiesFromScore.category || chunkEntitiesFromItem.category || chunkMetadata.category || null,
        pageNumber: chunkEntitiesFromScore.pageNumber || chunkEntitiesFromItem.pageNumber || chunkMetadata.pageNumber || null
      };
      return {
        rank: idx + 1,
        id: item.id,
        file: item.filename,
        docCategory: item.docCategory,
        finalScore: Number((item.finalScore ?? item.compositeScore ?? item.score ?? 0).toFixed(4)),
        semanticScore: Number((item.semanticScore ?? item.score ?? 0).toFixed(4)),
        attributeScore: Number((item.attributeScore ?? 0).toFixed(4)),
        metadataBoost: Number((item.metadataBoost ?? 0).toFixed(4)),
        matchedAttributes: matchedAttributes(queryEntities, chunkEntities),
        queryEntities,
        chunkEntities,
        text: String(item.chunk || item.text || '').replace(/\s+/g, ' ').substring(0, 180)
      };
    });
    results.push({ query: q, source: result.source, answerPresent: !!result.answer, queryEntities, rows, contextsLen: (result.contexts||[]).length, validatedRowsLen: debug.validatedScored ? debug.validatedScored.length : null });
  }
  fs.writeFileSync('tempAuditResult3.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote tempAuditResult3.json');
})();
