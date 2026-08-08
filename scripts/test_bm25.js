const { computeBm25Scores } = require('../src/engine/bm25');

const docs = [
  { id: 'd1', text: 'Informasi biaya pendaftaran gelombang 1 untuk Teknologi Informasi (TI).' },
  { id: 'd2', text: 'Jadwal pendaftaran dan syarat PMB untuk Sistem Informasi (SI).' },
  { id: 'd3', text: 'Beasiswa dan potongan biaya untuk mahasiswa baru.' },
  { id: 'd4', text: 'Detail program Bisnis Digital dan kurikulum.' }
];

const query = process.argv[2] || 'berapa biaya pendaftaran gelombang 1 TI';

const scores = computeBm25Scores(query, docs.map(d => ({ text: d.text })), { k1: 1.5, b: 0.75 });

const ranked = scores
  .map(s => ({ id: docs[s.index].id, text: docs[s.index].text, score: s.score }))
  .sort((a,b) => b.score - a.score);

console.log('Query:', query);
console.log('BM25 ranking:');
for (const r of ranked) {
  console.log('-', r.id, r.score.toFixed(4), '-', r.text.slice(0,80));
}
