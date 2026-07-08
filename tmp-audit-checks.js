(async()=>{
  const rag = require('./src/engine/ragEngine');
  const queries = [
    {label:'Hobi Coding Recommendation', text:'Hobi saya suka ngoding cocok jurusan apa?'},
    {label:'Program Studi TI', text:'Apa fokus dan mata kuliah utama program studi TI di kampus?'},
    {label:'Dual Degree Internasional', text:'Apakah ada program dual degree internasional?'},
    {label:'Beasiswa', text:'Info beasiswa ada?'},
    {label:'Biaya Kuliah TI', text:'Berapa biaya kuliah TI?'}
  ];
  for (const q of queries) {
    try {
      const res = await rag.query(q.text, 8, { returnDebug: true });
      const out = {
        label: q.label,
        text: q.text,
        source: res.source,
        success: res.success,
        confidenceTier: res.confidenceTier || (res.debug && res.debug.confidenceTier) || null,
        selectedChunkCount: Array.isArray(res.contexts) ? res.contexts.length : 0,
        finalContextSources: Array.isArray(res.contexts) ? Array.from(new Set(res.contexts.map(c=>c.filename||c.trainingId||c.id).filter(Boolean))) : [],
        debugKeys: Object.keys(res.debug||{})
      };
      console.log(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error('ERR', e && e.message ? e.message : e);
    }
  }
})();
