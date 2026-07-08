const path = require('path');
const fs = require('fs');
const engine = require('../src/engine/ragEngine');
const indexPath = path.resolve(__dirname, '..', 'src', 'data', 'rag_index.json');
const fullIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const q = 'biaya prodi sk gelombang 1';
const qs = {
  intent: 'COST',
  program: engine.normalizeProgramLabel(q),
  wave: engine.normalizeWaveLabel(q)
};
console.log('queryEntities', qs);
const res = engine.tryStructuredExactCostAnswer ? engine.tryStructuredExactCostAnswer(q, qs, fullIndex, 5, Array(64).fill(0)) : null;
console.log('exact', res && { source: res.source, confidenceTier: res.confidenceTier, answer: res.answer, debug: res.debug });
const matchItems = fullIndex.filter(item => item && item.chunk && /sistem\s*komputer|prodi\s*sk|\bsk\b/i.test(item.chunk));
console.log('SK-related count', matchItems.length);
const feeMatches = matchItems.filter(item => /dpp|pendaftaran|potongan|diskon|biaya\s+pendaftaran|dana\s+pendidikan/i.test(item.chunk));
console.log('SK fee chunk count', feeMatches.length);
const exactMatches = feeMatches.filter(item => {
  const prog = engine.normalizeProgramLabel(item.chunk);
  const wave = engine.normalizeWaveLabel(item.chunk);
  return prog === 'SK' && wave === '1';
});
console.log('SK wave1 exact count', exactMatches.length);
for (let i = 0; i < Math.min(10, exactMatches.length); i++) {
  const item = exactMatches[i];
  console.log('exact', i, {id:item.id, filename:item.filename}, item.chunk.slice(0,300).replace(/\n/g,' '));
}

