// Debug runner: reproduction for retrieval ranking
process.env.RAG_DEBUG_CHUNK_SCORING = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
process.env.TRACE_RAG_DECISION = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
process.env.RAG_MIN_SCORE = '0';

const { query } = require('../src/engine/ragEngine');

(async () => {
  const q = 'berapa biaya teknologi informasi gelombang 1A';
  console.log('[RUN_RETRIEVAL_DEBUG] query:', q);
  try {
    const res = await query(q, 12, { minScore: 0, strict: false });
    console.log('[RUN_RETRIEVAL_DEBUG] result summary:');
    console.log(JSON.stringify({ success: !!res && res.answer !== null, source: res && res.source, contextsCount: Array.isArray(res && res.contexts) ? res.contexts.length : 0, debug: res && res.debug ? 'present' : null }, null, 2));
    if (res && res.debug) console.log('[RUN_RETRIEVAL_DEBUG] debug:', JSON.stringify(res.debug, null, 2));
    if (res && Array.isArray(res.contexts)) console.log('[RUN_RETRIEVAL_DEBUG] contexts:', res.contexts.map(c => ({ id: c.id, score: c.score, filename: c.filename })).slice(0, 20));
  } catch (e) {
    console.error('[RUN_RETRIEVAL_DEBUG] error', e && e.message);
    console.error(e && e.stack);
    process.exit(1);
  }
})();
