const { query } = require('../src/engine/ragEngine');
const q = 'Prospek kerja Teknologi Informasi';
(async () => {
  try {
    const result = await query(q, 12, { answerQuestion: q, minScore: 0, strict: false, returnDebug: true });
    console.log(JSON.stringify({ source: result.source, success: result.success, debug: result.debug, contexts: result.contexts ? result.contexts.map(c => ({ id: c.id, filename: c.filename, category: c.category, score: c.score, chunk: c.chunk ? c.chunk.slice(0, 200) : '' })) : [] }, null, 2));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
})();