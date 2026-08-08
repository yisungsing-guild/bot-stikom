const fs = require('fs');
const path = require('path');
const ragEngine = require('../src/engine/ragEngine');
const { getRagDomainVectorsPath } = require('../src/utils/ragPaths');
const { computeBm25Scores } = require('../src/engine/bm25');

(async () => {
  try {
    const q = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';
    const domainFile = getRagDomainVectorsPath('domains_vectors.jsonl');
    if (!fs.existsSync(domainFile)) {
      console.error('Domain vectors file not found:', domainFile);
      process.exit(2);
    }
    const lines = fs.readFileSync(domainFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(Boolean);
    if (!lines.length) { console.error('No domain vectors loaded'); process.exit(2); }
    // Build pool texts
    const pool = lines.filter(Boolean).slice(0, 200);
    const poolTexts = pool.map(p => ({ text: p.text || p.chunk || p.filename || '' }));

    console.log('Loaded', pool.length, 'domain vectors (using', poolTexts.length, 'for BM25)');

    const qEmb = await ragEngine.computeEmbedding(String(q).slice(0,32000));
    const cosine = (a,b) => { if(!Array.isArray(a)||!Array.isArray(b)) return 0; let dot=0,na=0,nb=0; for(let i=0;i<Math.min(a.length,b.length);i++){dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i];} return na&&nb?dot/(Math.sqrt(na)*Math.sqrt(nb)):0 };

    const bm25 = computeBm25Scores(q, poolTexts, { k1:1.5, b:0.75 });
    const bm25Map = new Map(bm25.map(b => [b.index, b.score]));

    const scored = pool.map((it, idx) => {
      const semantic = cosine(qEmb, it.values || it.embedding || []);
      const rawBm25 = Number(bm25Map.get(idx) || 0);
      const bm25Contribution = rawBm25 ? rawBm25 / (1 + Math.abs(rawBm25)) * 0.35 : 0;
      const combined = semantic + bm25Contribution;
      return { idx, id: it.id || it.chunkHash || null, filename: it.filename || it.sourceFile || null, semantic, rawBm25, bm25Contribution, combined, snippet: String(it.text || it.chunk || '').slice(0,160).replace(/\n/g,' ') };
    });

    scored.sort((a,b) => b.combined - a.combined);
    console.log('Top 10 combined (semantic + bm25Contribution):');
    for (let i=0;i<Math.min(10, scored.length); i++) {
      const s = scored[i];
      console.log(`${i+1}. id=${s.id} combined=${s.combined.toFixed(4)} semantic=${s.semantic.toFixed(4)} bm25=${s.rawBm25.toFixed(4)} contrib=${s.bm25Contribution.toFixed(4)} file=${s.filename}`);
      console.log('   snippet:', s.snippet);
    }
  } catch (e) {
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
