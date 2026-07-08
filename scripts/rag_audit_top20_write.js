(async () => {
  try {
    const fs = require('fs');
    const path = require('path');
    const rag = require('../src/engine/ragEngine');
    const idxPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
    const index = require(idxPath);
    const q = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';

    const qEmb = await rag.computeEmbedding(q);
    const queryEntities = rag.extractStructuredEntities ? rag.extractStructuredEntities(q) : null;
    const intent = (queryEntities && queryEntities.intent) ? queryEntities.intent : 'COST';

    function cosine(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < a.length; i++) { const ai = Number(a[i] || 0); const bi = Number(b[i] || 0); dot += ai * bi; na += ai * ai; nb += bi * bi; }
      if (na === 0 || nb === 0) return 0;
      return dot / Math.sqrt(na * nb);
    }

    const scored = [];
    for (const item of index) {
      const emb = item.embedding || null;
      const sem = emb ? cosine(qEmb, emb) : 0;
      const breakdown = rag.getChunkScoreBreakdown ? rag.getChunkScoreBreakdown(item, q, intent, sem, queryEntities) : { compositeScore: 0, finalScore: 0, semantic: sem };
      scored.push({ id: item.id, filename: item.filename || item.sourceFile || null, program: item.program || (item.metadata && item.metadata.program) || null, docCategory: item.docCategory || item.category || null, semanticScore: sem, compositeScore: breakdown.compositeScore, finalScore: breakdown.finalScore, scoreComponents: breakdown, chunkPreview: (item.chunk || '').trim().slice(0, 240), fullChunk: item.chunk || '' });
    }

    scored.sort((a,b) => (b.compositeScore || b.semanticScore) - (a.compositeScore || a.semanticScore));
    const top20 = scored.slice(0, 20);

    const evidenceChecks = top20.map((s, idx) => {
      const lower = (s.fullChunk || '').toLowerCase();
      const hasProgramText = /teknologi\s+informasi|\bti\b/i.test(s.fullChunk || '');
      const hasProgramMeta = !!s.program;
      const hasWave = /gelombang\s*1a|gelombang\s*1\s*a|gelombang\s*i\s*a/i.test(s.fullChunk || '');
      const hasPendaftaran = /pendaftaran|pendaftar/i.test(lower);
      const hasDpp = /\bdpp\b|uang\s+pangkal|uang\s+pangkal/i.test(lower);
      const lines = (s.fullChunk || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const prov = {};
      for (let i=0;i<lines.length;i++){
        const L = lines[i];
        if (!prov.programLine && /teknologi\s+informasi|\bti\b/i.test(L)) prov.programLine = { line: i+1, text: L };
        if (!prov.waveLine && /gelombang\s*1a|gelombang\s*1\s*a|gelombang\s*i\s*a/i.test(L)) prov.waveLine = { line: i+1, text: L };
        if (!prov.pendaftaranLine && /pendaftaran|pendaftar/i.test(L)) prov.pendaftaranLine = { line: i+1, text: L };
        if (!prov.dppLine && /\bdpp\b|uang\s+pangkal|uang\s+pangkal/i.test(L)) prov.dppLine = { line: i+1, text: L };
      }
      return Object.assign({}, s, { rank: idx+1, hasProgramText, hasProgramMeta, hasWave, hasPendaftaran, hasDpp, provenance: prov });
    });

    const out = { query: q, intent, queryEntities, top: evidenceChecks };
    const outPath = path.join(__dirname, 'top20_pretty.json');
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    console.log('WROTE', outPath);
  } catch (e) {
    console.error('ERR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
