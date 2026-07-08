const { query, validateFinalAnswer, validateEntityConsistency } = require('../src/engine/ragEngine');
const q = 'Apa itu Teknologi Informasi?';
(async () => {
  try {
    const result = await query(q, 12, { answerQuestion: q, minScore: 0, strict: false, returnDebug: true });
    console.log('RESULT');
    console.log(JSON.stringify(result ? {
      source: result.source,
      success: result.success,
      confidenceTier: result.confidenceTier,
      confidenceScore: result.confidenceScore,
      answer: result.answer,
      debug: result.debug ? (result.debug.reason || result.debug) : null,
      contexts: result.contexts ? result.contexts.map(c => ({ id: c.id, filename: c.filename, category: c.category, score: c.score, chunk: c.chunk ? c.chunk.slice(0, 120) : '' })) : null
    } : null, null, 2));
    if (result && result.contexts) {
      console.log('TOP CONTEXTS');
      console.log(JSON.stringify(result.contexts.map(c => ({ id: c.id, filename: c.filename, category: c.category, score: c.score, chunk: c.chunk ? c.chunk.slice(0, 180) : '' })), null, 2));
      const consistency = validateEntityConsistency(result.contexts, q);
      console.log('VALIDATE_ENTITY_CONSISTENCY', consistency);
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
})();