const { queryScoped } = require('../src/engine/ragScoped');

(async () => {
  try {
    const q = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';
    const category = process.argv[3] || 'tuition_fee';
    console.log('[TEST_RAGSCOPED] query:', q, 'category:', category);
    const res = await queryScoped({ query: q, category, topK: 5, options: {} });
    console.log('[TEST_RAGSCOPED] success:', !!res && !!res.answer, 'source:', res && res.source);
    const ctxs = Array.isArray(res && res.contexts) ? res.contexts : (res && res.localDomainContexts) || [];
    console.log('[TEST_RAGSCOPED] contexts count:', ctxs.length);
    for (let i = 0; i < Math.min(5, ctxs.length); i++) {
      const c = ctxs[i];
      console.log(`  [${i+1}] score=${typeof c.score==='number'?c.score.toFixed(4):'n/a'} id=${c.id || ''} preview=${String(c.chunk||'').slice(0,120).replace(/\n/g,' ')} `);
    }
  } catch (e) {
    console.error('[TEST_RAGSCOPED] ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
