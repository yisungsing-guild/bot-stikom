const fs = require('fs');
require('dotenv').config({ path: '.env.local', override: true });
// Keep console logs enabled so engine trace output is visible for forensic debugging
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
    fs.writeFileSync('./tmp_query_clean_output.json', JSON.stringify(out, null, 2), 'utf8');
  } catch (e) {
    fs.writeFileSync('./tmp_query_clean_output.json', JSON.stringify({ error: (e.message || String(e)) }, null, 2), 'utf8');
    process.exit(1);
  }
})();
