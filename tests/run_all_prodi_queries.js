const rag = require('../src/engine/ragEngine');
const fs = require('fs');

const aliases = ['si','ti','bd','sk','mi','dg','dkv','mm','an','trpl','tk','help','utb','dnui'];
(async () => {
  const results = [];
  for (const a of aliases) {
    const q = `apa itu ${a}`;
    try {
      console.log('Querying:', q);
      const res = await rag.query(q);
      const contexts = (res.contexts || []).slice(0,5).map(c => ({ id: c.id, score: c.score, compositeScore: c.compositeScore, trainingId: c.trainingId, filename: c.filename, chunk: c.chunk }));
      results.push({ alias: a.toUpperCase(), query: q, answer: res.answer, source: res.source, confidence: res.confidenceScore || null, contexts });
    } catch (e) {
      results.push({ alias: a.toUpperCase(), query: q, error: String(e) });
    }
  }
  const outPath = 'reports/prodi_rag_report.json';
  try { fs.mkdirSync('reports', { recursive: true }); } catch (e) {}
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('Saved report to', outPath);
})();
