const { query, extractStructuredChunkMetadata } = require('./src/engine/ragEngine');
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
  for (const q of queries) {
    console.log('='.repeat(120));
    console.log('Query:', q);
    const result = await query(q, 20, { returnDebug: true });
    if (!result || !result.debug) {
      console.log('No debug result returned');
      continue;
    }
    const queryEntities = result.debug.queryEntities || {};
    console.log('Extracted queryEntities:', JSON.stringify(queryEntities, null, 2));
    const rows = (result.debug.validatedScored || []).slice(0, 10).map((item, idx) => {
      const chunkEntities = extractStructuredChunkMetadata(item.text || '');
      return {
        rank: idx + 1,
        id: item.id,
        file: item.filename,
        docCategory: item.docCategory,
        finalScore: Number((item.finalScore || 0).toFixed(4)),
        semanticScore: Number((item.semanticScore || 0).toFixed(4)),
        attributeScore: Number((item.attributeScore || 0).toFixed(4)),
        metadataBoost: Number((item.metadataBoost || 0).toFixed(4)),
        matchedAttributes: matchedAttributes(queryEntities, chunkEntities),
        queryEntities,
        chunkEntities,
        text: item.text ? item.text.replace(/\s+/g, ' ').substring(0, 180) : ''
      };
    });
    console.log('Top 10 validatedScored chunks:');
    console.log(JSON.stringify(rows, null, 2));
  }
})();
