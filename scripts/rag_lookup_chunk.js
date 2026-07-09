(async () => {
  try {
    const path = require('path');
    const rag = require('../src/engine/ragEngine');
    const idx = JSON.parse(fs.readFileSync(getRagIndexPath(), 'utf8') || '[]');
    const q = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';
    const target = process.argv[3] || 'eb5a5d25-3bcb-4c6d-8a42-65aafec455c0';

    const qEmb = await rag.computeEmbedding(q);
    function cosine(a,b){ if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length) return 0; let d=0,na=0,nb=0; for(let i=0;i<a.length;i++){const ai=Number(a[i]||0); const bi=Number(b[i]||0); d+=ai*bi; na+=ai*ai; nb+=bi*bi;} if(na===0||nb===0) return 0; return d/Math.sqrt(na*nb); }

    const item = idx.find(it => it.id === target);
    if(!item) { console.error('CHUNK NOT FOUND', target); process.exit(2); }
    const sem = item.embedding ? cosine(qEmb, item.embedding) : 0;
    const queryEntities = rag.extractStructuredEntities ? rag.extractStructuredEntities(q) : null;
    const intent = queryEntities && queryEntities.intent ? queryEntities.intent : 'COST';
    const breakdown = rag.getChunkScoreBreakdown ? rag.getChunkScoreBreakdown(item, q, intent, sem, queryEntities) : null;
    const out = { id: item.id, filename: item.filename, program: item.program || null, docCategory: item.docCategory || item.category || null, semanticScore: sem, scoreComponents: breakdown, chunkPreview: (item.chunk||'').slice(0,400) };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); }
})();
