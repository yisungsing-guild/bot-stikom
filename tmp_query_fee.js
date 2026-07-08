const { query } = require('./src/engine/ragEngine');
(async () => {
  try {
    const res = await query('berapa biaya TI gelombang 2C?');
    const output = {
      answer: res.answer,
      source: res.source,
      confidenceTier: res.confidenceTier || null,
      trustScore: res.trustScore || null,
      contexts: Array.isArray(res.contexts) ? res.contexts.slice(0, 6) : null,
      raw: res
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
