require('dotenv').config({ path: '.env.local', override: true });
const { query } = require('./src/engine/ragEngine');

(async () => {
  try {
    const question = 'berapa biaya pendaftaran gelombang 2?';
    const result = await query(question, 8, {});
    const out = {
      answer: result.answer || null,
      source: result.source || null,
      confidenceTier: result.confidenceTier || null,
      trustScore: result.trustScore !== undefined ? result.trustScore : null,
      filename: result.filename || null,
      sourceFile: result.sourceFile || null,
      trainingId: result.trainingId || null,
      retrievedChunks: Array.isArray(result.contexts) ? result.contexts : null,
      debug: result.debug || null
    };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(1);
  }
})();
