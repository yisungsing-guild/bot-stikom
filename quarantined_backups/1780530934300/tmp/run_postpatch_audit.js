(async () => {
  process.env.RAG_AUDIT_LOGGING = 'true';
  process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
  const rag = require('../src/engine/ragEngine');

  const queries = [
    'Apa itu Sistem Informasi',
    'Apa yang dipelajari di Sistem Informasi',
    'Prospek kerja Sistem Informasi',
    'Apa itu Teknologi Informasi',
    'Apa yang dipelajari di Teknologi Informasi',
    'Prospek kerja Teknologi Informasi'
  ];

  for (const q of queries) {
    try {
      const res = await rag.query(q, 40, { returnDebug: true, minScore: 0.0 });
      const dbg = res.debug || {};
      const rejected = Array.isArray(dbg.rejected) ? dbg.rejected : [];
      const reasonCounts = {};
      for (const r of rejected) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
      const report = {
        query: q,
        initialCandidates: dbg.initialCandidatesCount ?? null,
        afterRelevanceFilter: dbg.afterRelevantCount ?? null,
        afterIntentEvidenceValidation: dbg.afterIntentValidationCount ?? null,
        rejectReasonCounts: reasonCounts,
        finalContextsCount: Array.isArray(res.contexts) ? res.contexts.length : 0,
        finalAnswerSource: res.source || null,
        fallbackNoContext: (!res.contexts || res.contexts.length === 0),
        afterFilteringIsZero: (dbg.afterIntentValidationCount === 0)
      };
      const fs = require('fs');
      fs.appendFileSync('tmp/audit_results.jsonl', JSON.stringify(report) + '\n', 'utf8');
    } catch (e) {
      const fs = require('fs');
      fs.appendFileSync('tmp/audit_results.jsonl', JSON.stringify({ query: q, error: e && e.message ? e.message : String(e) }) + '\n', 'utf8');
    }
  }
})();
