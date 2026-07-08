const path = require('path');
const fs = require('fs');
const rag = require(path.join(__dirname, 'src', 'engine', 'ragEngine.js'));
const indexPath = rag.getIndexPath();
const raw = fs.readFileSync(indexPath, 'utf8');
const index = JSON.parse(raw || '[]');

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

(async () => {
  const queries = [
    'Apa itu Sistem Informasi?',
    'Apa prospek kerja Sistem Informasi?'
  ];
  for (const q of queries) {
    console.log('\n=== QUERY:', q);
    const qEmb = await rag.computeEmbedding(q);
    const scored = index.map(item => {
      const score = cosineSimilarity(qEmb, item.embedding || []);
      const breakdown = rag.getChunkScoreBreakdown(item, q, 'ACADEMIC_PROGRAM', score, { intent: 'ACADEMIC_PROGRAM', program: 'SI', academicIntent: q.toLowerCase().includes('prospek') ? 'PROSPEK_KERJA' : 'DEFINISI_PRODI', category: q.toLowerCase().includes('prospek') ? 'KARIR' : 'PROGRAM_STUDI' });
      return { item, score, compositeScore: breakdown.compositeScore, finalScore: breakdown.finalScore, category: item.docCategory || item.category, filename: item.filename, chunk: item.chunk ? item.chunk.slice(0,160).replace(/\s+/g,' ') : '' };
    });
    scored.sort((a,b)=>b.compositeScore - a.compositeScore);
    for (let i=0; i<30 && i<scored.length; i++) {
      const s = scored[i];
      console.log(`${i+1}. ${s.filename || 'NOFILE'} | ${s.category} | score=${s.score.toFixed(4)} composite=${s.compositeScore.toFixed(4)} final=${s.finalScore} | ${s.chunk}`);
    }
  }
})();
