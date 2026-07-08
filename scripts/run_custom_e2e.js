const ragEngine = require('../src/engine/ragEngine.js');
const fs = require('fs');
const path = require('path');

const QUERIES = [
  'beasiswa',
  'beasiswa alumni',
  'SMK TI Bali Global',
  'SMK Pandawa Bali Global',
  'biaya SI',
  'kelas malam',
  'kurikulum TI'
];

async function run() {
  const results = [];
  for (const q of QUERIES) {
    try {
      console.log('\n[TEST QUERY] ', q);
      const res = await ragEngine.query(q, 6, { minScore: 0.35 });
      const outbound = res && res.answer ? res.answer : '[NO ANSWER]';
      console.log('[SOURCE]', res.source, '| CONF', res.confidenceTier || res.confidenceScore || 'N/A');
      console.log('[OUTBOUND]', outbound.substring(0, 800));
      results.push({ query: q, success: !!res.answer, source: res.source, confidenceTier: res.confidenceTier, answer: outbound });
    } catch (err) {
      console.error('[ERROR]', err && err.message);
      results.push({ query: q, error: String(err) });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const out = path.join(__dirname, '..', 'e2e-custom-results.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('\nSaved results to', out);
}

run().catch(err => { console.error(err); process.exit(1); });
