(async () => {
  process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
  process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
  process.env.RAG_AUDIT_LOGGING = 'false';
  const path = require('path');
  const fs = require('fs');
  const rag = require(path.join(__dirname, '..', 'src', 'engine', 'ragEngine.js'));

  const queries = [
    'Apa itu Sistem Komputer?',
    'Mata kuliah Sistem Komputer?',
    'Prospek kerja Sistem Komputer?',
    'Apa itu Manajemen Informasi?',
    'Mata kuliah Manajemen Informasi?',
    'Prospek kerja Manajemen Informasi?'
  ];

  const results = [];

  for (const query of queries) {
    console.log('====================');
    console.log(`QUERY: ${query}`);
    try {
      const res = await rag.query(query, 20, { returnDebug: true, minScore: 0.0, strict: false });
      const debug = res.debug || {};
      console.log(`source: ${res.source}`);
      console.log(`success: ${res.success}`);
      console.log(`confidenceTier: ${res.confidenceTier || 'N/A'}`);
      console.log(`confidenceScore: ${typeof res.confidenceScore === 'number' ? res.confidenceScore.toFixed(4) : res.confidenceScore}`);
      console.log(`contexts returned: ${Array.isArray(res.contexts) ? res.contexts.length : 0}`);
      console.log(`afterRelevantCount: ${debug.afterRelevantCount ?? 'N/A'}`);
      console.log(`afterIntentValidationCount: ${debug.afterIntentValidationCount ?? 'N/A'}`);
      if (Array.isArray(debug.rejected)) {
        console.log(`rejectionReasons: ${JSON.stringify(debug.rejected.slice(0, 5).map(r => r.reason))}`);
      }
      if (Array.isArray(res.contexts) && res.contexts.length > 0) {
        console.log('TOP CONTEXTS:');
        res.contexts.slice(0, 10).forEach((ctx, idx) => {
          console.log(`  [${idx + 1}] id=${ctx.id || 'N/A'} filename=${ctx.filename || 'N/A'} docCategory=${ctx.docCategory || ctx.category || 'N/A'} score=${typeof ctx.score === 'number' ? ctx.score.toFixed(4) : ctx.score} compositeScore=${typeof ctx.compositeScore === 'number' ? ctx.compositeScore.toFixed(4) : ctx.compositeScore}`);
          const chunk = String(ctx.chunk || '').replace(/\s+/g, ' ').trim();
          console.log(`       preview=${chunk.slice(0, 180)}`);
        });
      }
      console.log('ANSWER:');
      const answer = String(res.answer || '').replace(/\s+/g, ' ').trim();
      console.log(answer.slice(0, 1000));
      console.log('');
      results.push({ query, result: res });
    } catch (err) {
      console.error(`ERROR for query ${query}:`, err && err.message ? err.message : err);
      results.push({ query, error: err && err.message ? err.message : String(err) });
    }
  }

  const outPath = path.join(__dirname, 'verify_mi_sk_queries.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Wrote results to ${outPath}`);
})();
