const fs = require('fs');
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
  const results = [];
  for (const q of queries) {
    const result = await query(q, 20, { returnDebug: true });
    const debug = (result && result.debug) ? result.debug : {};
    const queryEntities = debug.queryEntities || {};
    const rows = (debug.validatedScored || []).slice(0, 10).map((item, idx) => {
      const chunkMetadata = extractStructuredChunkMetadata(item.text || '');
      const chunkEntities = {
        program: chunkMetadata.program,
        programMode: chunkMetadata.programMode,
        wave: chunkMetadata.wave,
        waveGroup: chunkMetadata.waveGroup,
        academicYear: chunkMetadata.academicYear,
        partner: chunkMetadata.partner,
        campus: chunkMetadata.campus,
        jalur: chunkMetadata.jalur,
        feeType: chunkMetadata.feeType,
        category: chunkMetadata.category
      };
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
    results.push({ query: q, queryEntities, rows, debugPresent: !!result.debug });
  }
  fs.writeFileSync('tempAuditResult.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote tempAuditResult.json');
})();
