// Increase program exact-match boost for this test run
process.env.RAG_EXACT_PROGRAM_MATCH_BOOST = process.env.RAG_EXACT_PROGRAM_MATCH_BOOST || '1.0';
const rag = require('../src/engine/ragEngine');
const fs = require('fs');

const aliases = ['si','ti','bd','sk','mi','dg','dkv','mm','an','trpl','tk'];
const aspects = [
  { key: 'yang_dipelajari', q: (a)=> `apa yang dipelajari di ${a}` },
  { key: 'cocok_untuk', q: (a)=> `prodi ${a} cocok untuk siapa` },
  { key: 'peluang_kerja', q: (a)=> `peluang kerja prodi ${a}` }
];

function tokenize(s){
  return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w && w.length>3);
}

(async ()=>{
  const report = [];
  for (const a of aliases){
    const aliasReport = { alias: a.toUpperCase(), aspects: [] };
    // fetch a baseline contexts for alias via 'apa itu' to reuse
    let base = null;
    try { base = await rag.query(`apa itu ${a}`); } catch(e) { base = null; }
    const baseCtxText = (base && base.contexts) ? base.contexts.map(c=>c.chunk||'').join('\n') : '';
    const baseTokens = new Set(tokenize(baseCtxText));

    for (const asp of aspects){
      const q = asp.q(a);
      try {
        const res = await rag.query(q);
        const answer = res.answer || '';
        const answerTokens = tokenize(answer);
        const uniqAns = Array.from(new Set(answerTokens));
        let overlap = 0;
        for (const t of uniqAns) if (baseTokens.has(t)) overlap++;
        const overlapRatio = uniqAns.length? overlap/uniqAns.length:0;
        const pass = overlapRatio >= 0.12; // threshold
        const contexts = (res.contexts||[]).slice(0,5).map(c=>({ id:c.id, trainingId:c.trainingId, filename:c.filename, chunk: c.chunk }));
        aliasReport.aspects.push({ aspect: asp.key, query: q, answer, overlapRatio, pass, contexts });
      } catch (e) {
        aliasReport.aspects.push({ aspect: asp.key, query: q, error: String(e) });
      }
    }
    report.push(aliasReport);
  }
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/prodi_aspect_report.json', JSON.stringify(report, null, 2), 'utf8');
  console.log('Saved reports/prodi_aspect_report.json');
})();
