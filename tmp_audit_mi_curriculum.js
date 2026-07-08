const fs = require('fs');
const path = require('path');
const { computeEmbedding, getChunkScoreBreakdown, normalizeProgramLabel } = require('./src/engine/ragEngine');
const { classifyIntent } = require('./src/engine/intentClassifier');

const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
if (!fs.existsSync(indexPath)) {
  console.error('Index file missing:', indexPath);
  process.exit(1);
}
const raw = fs.readFileSync(indexPath, 'utf-8');
const index = JSON.parse(raw || '[]');
const miCurriculum = index.filter(item => {
  const prog = String(item.program || (item.metadata && item.metadata.program) || '').toUpperCase();
  const cat = String(item.docCategory || item.category || '').toUpperCase();
  return prog === 'MI' && cat === 'KURIKULUM';
});

console.log('MI KURIKULUM chunks count:', miCurriculum.length);
for (const item of miCurriculum) {
  const chunk = String(item.chunk || '').replace(/\s+/g, ' ').trim();
  const foundMatkul = /\b(mata kuliah|kurikulum|semester|struktur pembelajaran|silabus|kompetensi dasar|kompetensi keluar|unit mata kuliah|mata_kuliah|mata-kuliah)\b/i.test(chunk);
  const foundSemester = /\bsemester\b/i.test(chunk);
  const foundKurikulum = /\bkurikulum\b/i.test(chunk);
  const foundStructure = /\bstruktur pembelajaran\b|\bstruktur kurikulum\b|\bkurikulum.*?struktur\b|\bstruktur.*?kurikulum\b/i.test(chunk);
  const foundCourseNames = /\b(mata kuliah|mk\b|komponen pembelajaran|unit pembelajaran|daftar mata kuliah|program mata kuliah)\b/i.test(chunk);
  console.log('\n---');
  console.log('id:', item.id);
  console.log('filename:', item.filename || item.trainingId || 'N/A');
  console.log('docCategory:', item.docCategory || item.category || 'UNKNOWN');
  console.log('program:', item.program || (item.metadata && item.metadata.program) || 'N/A');
  console.log('chunk length:', chunk.length);
  console.log('contains mata kuliah/kurikulum terms:', foundMatkul ? 'YES' : 'NO');
  console.log('contains semester:', foundSemester ? 'YES' : 'NO');
  console.log('contains kurikulum:', foundKurikulum ? 'YES' : 'NO');
  console.log('contains struktur pembelajaran:', foundStructure ? 'YES' : 'NO');
  console.log('contains explicit course-list tokens:', foundCourseNames ? 'YES' : 'NO');
  console.log('chunk preview:', chunk.slice(0, 500));
}

const queryText = 'Mata kuliah Manajemen Informatika?';
const normQuery = queryText.toLowerCase().trim();
const queryEntities = { intent: 'GENERAL', program: 'MI', category: 'KURIKULUM' };
const queryForRetrieval = normQuery;

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

(async () => {
  if (typeof computeEmbedding !== 'function') {
    console.error('computeEmbedding not available. Skipping score breakdown.');
    return;
  }
  const qEmb = await computeEmbedding(queryForRetrieval);
  const intent = classifyIntent(queryText);
  const scored = index
    .map(item => {
      const semanticScore = cosine(qEmb, item.embedding || []);
      const breakdown = getChunkScoreBreakdown(item, queryText, intent, semanticScore, queryEntities);
      return { item, semanticScore, breakdown };
    })
    .filter(entry => Number.isFinite(entry.semanticScore));
  scored.sort((a,b) => (b.breakdown.compositeScore || 0) - (a.breakdown.compositeScore || 0));
  const top10 = scored.slice(0, 10);
  console.log('\nTOP 10 scored chunks for query:');
  for (const [idx, entry] of top10.entries()) {
    const item = entry.item;
    const chunk = String(item.chunk || '').replace(/\s+/g, ' ').trim();
    const cat = item.docCategory || item.category || 'UNKNOWN';
    const prog = item.program || (item.metadata && item.metadata.program) || 'N/A';
    console.log('\n--- top', idx + 1, '---');
    console.log('id:', item.id);
    console.log('filename:', item.filename || item.trainingId || 'N/A');
    console.log('program:', prog);
    console.log('docCategory:', cat);
    console.log('semanticScore:', entry.semanticScore.toFixed(6));
    console.log('compositeScore:', (entry.breakdown && entry.breakdown.compositeScore) ? entry.breakdown.compositeScore.toFixed(6) : 'N/A');
    console.log('metadataBoost:', (entry.breakdown && entry.breakdown.metadataBoost) ? entry.breakdown.metadataBoost.toFixed(6) : 'N/A');
    console.log('categorySignal:', (entry.breakdown && entry.breakdown.categorySignal) ? entry.breakdown.categorySignal.toFixed(6) : 'N/A');
    console.log('exactMatch:', (entry.breakdown && entry.breakdown.exactMatch) ? entry.breakdown.exactMatch : 'N/A');
    console.log('chunk preview:', chunk.slice(0, 500));
  }
})();
