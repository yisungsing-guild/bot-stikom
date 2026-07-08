const { query, extractStructuredEntities, extractStructuredChunkMetadata } = require('./src/engine/ragEngine');

(async () => {
  const q = 'Apa itu Teknologi Informasi';
  const result = await query(q, 20, { returnDebug: true });
  const queryEntities = extractStructuredEntities(q);
  console.log('queryEntities', JSON.stringify(queryEntities, null, 2));
  const rowsSource = (result && result.debug && result.debug.validatedScored && result.debug.validatedScored.length)
    ? result.debug.validatedScored
    : (result.contexts || []);
  const rows = rowsSource.slice(0, 5).map((item, idx) => {
    const chunkMetadata = extractStructuredChunkMetadata(item.chunk || item.text || '');
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
    const matched = [];
    for (const key of Object.keys(queryEntities || {})) {
      if (!queryEntities[key] || !chunkEntities[key]) continue;
      if (String(queryEntities[key]).toLowerCase() === String(chunkEntities[key]).toLowerCase()) matched.push(key);
    }
    return {
      idx,
      id: item.id,
      file: item.filename,
      score: item.finalScore ?? item.compositeScore ?? item.score,
      semanticScore: item.semanticScore ?? item.score,
      attributeScore: item.attributeScore,
      metadataBoost: item.metadataBoost,
      chunkEntities,
      matched,
      itemChunk: item.chunk ? item.chunk.slice(0,120).replace(/\s+/g,' ').trim() : (item.text || '').slice(0,120).replace(/\s+/g,' ').trim()
    };
  });
  console.log(JSON.stringify(rows, null, 2));
  console.log('source', result.source, 'validatedScored', (result.debug && result.debug.validatedScored && result.debug.validatedScored.length) || 0, 'contexts', (result.contexts || []).length);
})();
