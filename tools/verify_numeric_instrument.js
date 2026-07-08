const rag = require('../src/engine/ragEngine');

console.log('\n=== PROD parseCompactRupiahNumber outputs ===');
const inputs = ['Rp 1.500.000','Rp1.500.000','1.500.000','l.500.000','I.500.000'];
for (const s of inputs) {
  try {
    const out = typeof rag.parseCompactRupiahNumber === 'function' ? rag.parseCompactRupiahNumber(s) : undefined;
    console.log(s, '->', out);
  } catch (e) {
    console.log(s, '-> ERROR', e.message);
  }
}

console.log('\n=== PROD validateNumericGrounding instrumented ===');
const val = 'Rp 1.500.000';
const chunks = [{ chunk: 'Biaya pendaftaran: Rp 1.500.000', filename: 'RINCIAN_BIAYA.pdf', ocrQualityScore: 0.95 }];
try {
  const v = rag.validateNumericGrounding(val, chunks, 'unit-test-context');
  console.log('validateNumericGrounding result ->', v);
} catch (e) {
  console.error('validateNumericGrounding threw', e.message);
}
