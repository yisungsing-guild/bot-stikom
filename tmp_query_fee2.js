const { query } = require('./src/engine/ragEngine');
(async () => {
  try {
    const res = await query('berapa biaya TI gelombang 2C?');
    const output = {
      answer: res && res.answer ? res.answer : null,
      source: res && res.source ? res.source : null,
      confidenceTier: res && res.confidenceTier ? res.confidenceTier : null,
      trustScore: res && res.trustScore ? res.trustScore : null,
      debug: res && res.debug ? res.debug : null,
      contexts: Array.isArray(res && res.contexts) ? res.contexts.slice(0, 6) : null,
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
