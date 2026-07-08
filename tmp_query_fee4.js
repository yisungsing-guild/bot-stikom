const origLog = console.log;
console.log = () => {};
const { query } = require('./src/engine/ragEngine');
(async () => {
  try {
    const res = await query('berapa biaya TI gelombang 2C?');
    console.log = origLog;
    const output = {
      answer: res && res.answer ? res.answer : null,
      source: res && res.source ? res.source : null,
      confidenceTier: res && res.confidenceTier ? res.confidenceTier : null,
      trustScore: res && res.trustScore ? res.trustScore : null,
      debug: res && res.debug ? res.debug : null,
    };
    console.log(JSON.stringify(output, null, 2));
  } catch (e) {
    console.log = origLog;
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
