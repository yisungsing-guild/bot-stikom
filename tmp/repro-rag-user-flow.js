const originalLog = console.log;
console.log = () => {};
const rag = require('../src/engine/ragEngine');

(async () => {
  const out = [];
  for (const q of [
    'saya ingin tau tentang pmb',
    'apa itu SK?',
    'apa itu SI?',
    'apa itu TI?',
    'rincian biaya prodi ti gelombang 1C berapa?'
  ]) {
    try {
      const result = await rag.query(q);
      out.push({
        q,
        success: result.success,
        source: result.source,
        tier: result.confidenceTier,
        answer: String(result.answer || '').slice(0, 1800)
      });
    } catch (error) {
      out.push({ q, error: error && error.stack ? error.stack : String(error && error.message || error) });
    }
  }
  console.log = originalLog;
  console.log(JSON.stringify(out, null, 2));
})();
