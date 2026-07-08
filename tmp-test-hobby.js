(async()=>{
  const rag = require('./src/engine/ragEngine');
  try {
    const res = await rag.query('Hobi saya suka ngoding cocok jurusan apa?', 8, { returnDebug: true });
    const out = {
      source: res.source,
      success: res.success,
      confidenceTier: res.confidenceTier || (res.debug && res.debug.confidenceTier) || null,
      contexts: res.contexts || [],
      finalContextSources: Array.isArray(res.contexts) ? Array.from(new Set(res.contexts.map(c => c.filename || c.trainingId || c.id).filter(Boolean))) : [],
      debugKeys: Object.keys(res.debug || {})
    };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('ERR', e && e.message ? e.message : e);
  }
})();
