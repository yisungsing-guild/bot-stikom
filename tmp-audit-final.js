(async()=>{
  const rag = require('./src/engine/ragEngine');
  const queries = [
    {label:'Hobi Coding Recommendation', text:'Hobi saya suka ngoding cocok jurusan apa? (jawab prioritaskan dokumen HOBY.pdf atau hobi-sesuai-program-studi.docx)'} ,
    {label:'Hobi UI/UX', text:'Saya suka desain UI/UX cocok jurusan apa? (cek dokumen hobi)'} ,
    {label:'Hobi Bisnis Analisis', text:'Saya suka analisis bisnis cocok jurusan apa?'} ,
    {label:'Program Studi TI', text:'Program studi Teknologi Informasi belajar apa saja?'},
    {label:'Lulusan TI Karir', text:'Lulusan TI bisa bekerja di bidang apa?'},
    {label:'Double Degree Nasional', text:'Apakah ada program double degree nasional? (jawab hanya program nasional)'} ,
    {label:'Biaya Kuliah TI', text:'Berapa biaya kuliah TI?'}
  ];
  for (const q of queries) {
    try {
      const res = await rag.query(q.text, 8, { returnDebug: true });
      const selectedChunkCount = Array.isArray(res.contexts) ? res.contexts.length : 0;
      const finalContextSources = Array.isArray(res.contexts) ? Array.from(new Set(res.contexts.map(c=>c.filename||c.trainingId||c.id).filter(Boolean))) : [];
      const queryEntities = res.debug && res.debug.queryEntities ? res.debug.queryEntities : (res.debug && res.debug.entities ? res.debug.entities : null);
      const answerPreview = (res.answer || '').slice(0,500).replace(/\n+/g,' ');

      const out = {
        label: q.label,
        text: q.text,
        source: res.source,
        success: res.success,
        confidenceTier: res.confidenceTier || null,
        selectedChunkCount,
        finalContextSources,
        queryEntities,
        answerPreview
      };
      console.log(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error('ERR', q.label, e && e.message ? e.message : e);
    }
  }
})();
