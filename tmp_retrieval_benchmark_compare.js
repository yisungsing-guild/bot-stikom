const fs = require('fs');
const path = require('path');
const beforeEngine = require('./src/engine/temp_ragEngine_before');
const afterEngine = require('./src/engine/ragEngine');
const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?',
  'Apa keunggulan Sistem Informasi?'
];
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
    na += Number(a[i] || 0) * Number(a[i] || 0);
    nb += Number(b[i] || 0) * Number(b[i] || 0);
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function detectIntent(text) {
  const q = String(text || '').toLowerCase();
  const programSignal = /\b(program studi|program|prodi|internasional|double degree|dual degree|dnui|help university|utb|china|bali|study abroad|si|ti|bd|sk|mi|rpl|teknologi informasi|sistem informasi|bisnis digital|sistem komputer|s\. ?k(?:om(?:puter)?)?)\b/.test(q);
  const academicSignal = /\b(apa itu|apa yang dipelajari|dipelajari|materi|perkuliahan|belajar apa|mata kuliah|kurikulum|fokus|prospek kerja|karir|coding|ngoding|akreditasi|biaya|beasiswa|lokasi|kampus)\b/.test(q);
  if (programSignal && academicSignal) return 'ACADEMIC_PROGRAM';
  if (/\b(berapa biaya|berapa harga|harga|biaya|dpp|ukt|spp|uang kuliah|uang semester|uang pendaftaran|biaya semester|biaya per semester|bayar|potongan|diskon)\b/.test(q)) return 'COST';
  if (programSignal) return 'PROGRAM';
  if (/\b(jadwal|gelombang|tanggal|deadline|registrasi|test|pengumuman|daftar ulang|penutupan)\b/.test(q)) return 'SCHEDULE';
  return 'GENERAL';
}
function loadIndex() {
  const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}
function formatLine(text, maxLength=140) {
  return String(text||'').replace(/\s+/g,' ').trim().slice(0,maxLength);
}
async function run(engine, label) {
  const index = loadIndex();
  const out = [];
  for (const query of queries) {
    const intent = detectIntent(query);
    const qEmb = await engine.computeEmbedding(query);
    const scored = index.map(item => {
      const semantic = cosineSimilarity(qEmb, item.embedding || []);
      const breakdown = engine.getChunkScoreBreakdown(item, query, intent, semantic, {});
      return {
        item,
        semantic,
        semanticBoost: breakdown.semanticBoost,
        evidenceScore: breakdown.evidenceScore,
        attributeScore: breakdown.attributeScore,
        metadataBoost: breakdown.metadataBoost,
        otherBoosts: breakdown.otherBoosts,
        rawScore: breakdown.rawScore || breakdown.compositeScore,
        compositeScore: breakdown.compositeScore,
        finalScore: breakdown.finalScore,
        chunkPreview: formatLine(item.chunk, 120)
      };
    });
    scored.sort((a,b)=>b.compositeScore - a.compositeScore);
    out.push({ query, results: scored.slice(0,10).map((s, idx) => ({ rank: idx+1, id: s.item.id, filename: s.item.filename||s.item.trainingId||'N/A', program: s.item.program || s.item.programName || 'N/A', category: s.item.docCategory || s.item.category || 'N/A', chunkPreview: s.chunkPreview, semanticScore: s.semantic.toFixed(6), semanticBoost: Number((s.semanticBoost||0).toFixed(6)), evidenceScore: Number((s.evidenceScore||0).toFixed(6)), compositeScore: Number((s.compositeScore||0).toFixed(6)), finalScore: Number((s.finalScore||0).toFixed(6)) })) });
  }
  return out;
}
(async () => {
  const before = await run(beforeEngine, 'before');
  const after = await run(afterEngine, 'after');
  console.log(JSON.stringify({ before, after }, null, 2));
})();
