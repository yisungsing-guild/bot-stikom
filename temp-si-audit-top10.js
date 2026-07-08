const fs = require('fs');
const path = require('path');
const engine = require('./src/engine/ragEngine');

function normalizeQueryForRetrieval(rawQuery) {
  let q = String(rawQuery || '').toLowerCase().trim();
  const abbrevMap = {
    brp: 'berapa',
    glw: 'gelombang',
    glmb: 'gelombang',
    ti: 'teknologi informasi',
    si: 'sistem informasi',
    bd: 'bisnis digital',
    mi: 'manajemen informatika',
    sk: 'sistem komputer',
    dpp: 'dana pendidikan pokok',
    ukt: 'uang kuliah tunggal',
    spp: 'sumbangan pembinaan pendidikan',
    pmb: 'penerimaan mahasiswa baru',
    tgl: 'tanggal',
    dl: 'deadline'
  };
  for (const [short, long] of Object.entries(abbrevMap)) {
    q = q.replace(new RegExp(`\\b${short}\\b`, 'g'), long);
  }
  const expansions = {
    ti: ['teknologi informasi', 'program studi teknologi informasi', 'profil teknologi informasi'],
    'teknologi informasi': ['program studi teknologi informasi', 'profil teknologi informasi'],
    si: ['sistem informasi', 'program studi sistem informasi', 'profil sistem informasi'],
    'sistem informasi': ['program studi sistem informasi', 'profil sistem informasi'],
    bd: ['bisnis digital', 'program studi bisnis digital', 'profil bisnis digital'],
    'bisnis digital': ['program studi bisnis digital', 'profil bisnis digital'],
    mi: ['manajemen informatika', 'program studi manajemen informatika', 'profil manajemen informatika'],
    sk: ['sistem komputer', 'program studi sistem komputer', 'profil sistem komputer']
  };
  const rawLower = String(rawQuery || '').toLowerCase();
  const added = [];
  for (const [key, list] of Object.entries(expansions)) {
    const re = new RegExp(`\\b${key.replace(/[\\-\\/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
    if (re.test(rawLower) && !re.test(q)) {
      added.push(...list);
    } else if (re.test(q)) {
      added.push(...list);
    }
  }
  if (added.length > 0) {
    const uniq = Array.from(new Set(added.map(s => String(s).trim()))).join(' ');
    q = `${q} ${uniq}`.replace(/\s{2,}/g, ' ').trim();
  }
  return q.replace(/\s{2,}/g, ' ').trim();
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

(async () => {
  const queries = [
    'Apa itu Sistem Informasi?',
    'Apa prospek kerja Sistem Informasi?',
    'Apa yang dipelajari di Sistem Informasi?',
    'Apa keunggulan Sistem Informasi?'
  ];
  const indexPath = engine.getIndexPath();
  const rawIndex = fs.readFileSync(indexPath, 'utf8');
  const index = JSON.parse(rawIndex || '[]');

  for (const query of queries) {
    const normalizedUserQ = query.toLowerCase();
    const queryForRetrieval = normalizeQueryForRetrieval(normalizedUserQ);
    const queryEntities = engine.extractStructuredEntities(queryForRetrieval);
    const qEmb = await engine.computeEmbedding(queryForRetrieval);
    const scored = index.map(item => {
      const semanticScore = cosineSimilarity(qEmb, item.embedding || []);
      const breakdown = engine.getChunkScoreBreakdown(item, query, queryEntities.intent || 'GENERAL', semanticScore, queryEntities);
      return {
        item,
        semanticScore,
        score: semanticScore,
        rawScore: breakdown.rawScore,
        compositeScore: breakdown.compositeScore,
        finalScore: breakdown.finalScore,
        semanticBoost: breakdown.semanticBoost,
        evidenceScore: breakdown.evidenceScore,
        attributeScore: breakdown.attributeScore,
        metadataBoost: breakdown.metadataBoost,
        otherBoosts: breakdown.otherBoosts,
        exactMatch: breakdown.exactMatch,
        itemEntities: breakdown.itemEntities
      };
    });
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    console.log('QUERY:', query);
    console.log('queryForRetrieval:', queryForRetrieval);
    console.log('intent:', queryEntities.intent, 'academicIntent:', queryEntities.academicIntent, 'program:', queryEntities.program);
    const top = scored.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const s = top[i];
      console.log(`\n#${i + 1}`);
      console.log(`id: ${s.item.id}`);
      console.log(`filename: ${s.item.filename || s.item.trainingId || 'N/A'}`);
      console.log(`category: ${s.item.docCategory || s.item.category || 'N/A'}`);
      console.log(`semanticScore: ${s.semanticScore.toFixed(4)}`);
      console.log(`compositeScore: ${s.compositeScore.toFixed(4)}`);
      console.log(`finalScore: ${s.finalScore.toFixed(4)}`);
      console.log(`semanticBoost: ${s.semanticBoost.toFixed(4)}`);
      console.log(`evidenceScore: ${s.evidenceScore.toFixed(4)}`);
      console.log(`attributeScore: ${s.attributeScore.toFixed(4)}`);
      console.log(`metadataBoost: ${s.metadataBoost.toFixed(4)}`);
      console.log(`otherBoosts: ${s.otherBoosts.toFixed(4)}`);
      console.log(`exactMatch: ${JSON.stringify(s.exactMatch)}`);
      console.log(`itemEntities: ${JSON.stringify(s.itemEntities)}`);
      console.log(`chunkPreview: ${String(s.item.chunk || '').slice(0, 140).replace(/\s+/g, ' ').trim()}`);
    }
    console.log('\n---\n');
  }
})();
