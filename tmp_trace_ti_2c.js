const fs = require('fs');
const rag = require('./src/engine/ragEngine');

(async () => {
  const question = 'berapa biaya TI gelombang 2C';
  const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', academicYear: '2025' };
  const index = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8'));
  const qEmb = await rag.computeEmbedding(question);

  const captured = [];
  const originalConsoleLog = console.log;
  console.log = function (...args) {
    if (typeof args[0] === 'string' && args[0].startsWith('[TRACE_')) {
      captured.push(args);
    }
    originalConsoleLog.apply(console, args);
  };

  let result;
  try {
    result = rag.tryStructuredExactCostAnswer(question, queryEntities, index, 5, qEmb);
  } catch (e) {
    console.error('ERROR in tryStructuredExactCostAnswer', e && e.stack ? e.stack : e);
  } finally {
    console.log = originalConsoleLog;
  }

  const traces = captured.map(args => {
    const tag = String(args[0] || '');
    const rest = args.slice(1);
    return { tag, payload: rest };
  });

  // Build structured trace map
  const traceMap = {};
  for (const entry of traces) {
    if (!traceMap[entry.tag]) traceMap[entry.tag] = [];
    traceMap[entry.tag].push(entry.payload);
  }

  // Top20 retrieval from existing scoring breakdown
  function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const ai = a[i] || 0;
      const bi = b[i] || 0;
      dot += ai * bi;
      na += ai * ai;
      nb += bi * bi;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / Math.sqrt(na * nb);
  }

  const scored = index.map(item => {
    const sem = item.embedding && Array.isArray(item.embedding) ? cosine(qEmb, item.embedding) : 0;
    const breakdown = rag.getChunkScoreBreakdown(item, question, 'COST', sem, queryEntities);
    const trust = rag.validateSourceTrust(item);
    return {
      id: item.id || null,
      filename: item.filename || item.sourceFile || null,
      trainingId: item.trainingId || null,
      trusted: !!(trust && trust.trusted),
      trustScore: trust && trust.score,
      score: breakdown.finalScore != null ? breakdown.finalScore : breakdown.compositeScore || 0,
      rejectReason: breakdown && breakdown.exactMatch && breakdown.exactMatch.rejected ? breakdown.exactMatch.reason || 'exact-mismatch' : null
    };
  }).sort((a, b) => b.score - a.score);

  const top20 = scored.slice(0, 20);

  const output = {
    query: question,
    top20,
    traceMap,
    finalResult: result || null
  };

  fs.writeFileSync('tmp_trace_ti_2c_output.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('Wrote tmp_trace_ti_2c_output.json');
})();
