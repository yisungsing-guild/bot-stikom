const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');
// helper to call private functions via module.exports
if (!rag.loadIndex) {
  // load index helper is in the module; access by requiring file path directly
  // but tryStructuredExactCostAnswer expects loadIndex to be available via closure
}

async function run() {
  const index = (typeof rag.loadIndex === 'function') ? rag.loadIndex() : (() => {
    // fallback: read index path directly
    const ip = rag.getIndexPath ? rag.getIndexPath() : null;
    if (!ip) return [];
    try { return JSON.parse(fs.readFileSync(ip,'utf8')||'[]'); } catch(e) { return []; }
  })();
  const question = 'berapa biaya teknologi informasi gelombang 1A';
  const qEnt = rag.extractStructuredEntities(question);
  const qEmb = await rag.computeEmbedding(`Program Studi: Teknologi Informasi\n${question}`);
  const candidates = [];

  // emulate tryStructuredExactCostAnswer preselection path
  const topK = 50;
  const res = rag.tryStructuredExactCostAnswer(question, qEnt, index, topK, qEmb);

  // write raw debug from function outputs
  const out = { question, queryEntities: qEnt, result: res };
  const outPath = path.join(__dirname, 'audit_retrieval_output.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote', outPath);
}

run().catch(e=>{ console.error(e); process.exit(1); });
