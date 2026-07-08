const path = require('path');
const engine = require(path.join(process.cwd(), 'src', 'engine', 'ragEngine'));
console.log('loaded');
if (typeof engine.loadIndex !== 'function') {
  console.log('no loadIndex');
  process.exit(0);
}
let idx;
try {
  idx = engine.loadIndex();
} catch (e) {
  console.error('loadIndex err', e && e.message ? e.message : e);
  process.exit(1);
}
console.log('index len', Array.isArray(idx) ? idx.length : typeof idx);
const q = 'berapa biaya prodi ti gelombang 2C?';
const qe = { intent:'COST', academicIntent:'BIAYA', program:'TI', wave:'2C', waveGroup:'2' };
const result = engine.tryStructuredExactCostAnswer(q, qe, idx.slice(0, 200), 10, Array(64).fill(0));
console.log('result', JSON.stringify(result, null, 2));
