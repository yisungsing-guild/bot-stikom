const fs = require('fs');
const { query, extractStructuredEntities, extractStructuredChunkMetadata } = require('./src/engine/ragEngine');

(async () => {
  const q = 'Apa itu Teknologi Informasi';
  const result = await query(q, 20, { returnDebug: true });
  const queryEntities = extractStructuredEntities(q);
  const rowsSource = (result && result.debug && result.debug.validatedScored && result.debug.validatedScored.length)
    ? result.debug.validatedScored
    : (result.contexts || []);
  const item = rowsSource[0];
  const chunkMetadata = extractStructuredChunkMetadata(item.chunk || item.text || '');
  fs.writeFileSync('tempDebugMatchedAttributes2.json', JSON.stringify({ queryEntities, item, chunkMetadata, resultSource: result.source, validatedScoredLen: result.debug && result.debug.validatedScored ? result.debug.validatedScored.length : 0, contextsLen: (result.contexts || []).length }, null, 2), 'utf8');
})();
