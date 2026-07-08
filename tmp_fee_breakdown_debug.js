const { tryStructuredFeeBreakdownAnswer } = require('./src/engine/ragEngine');
const q = 'biaya lengkap prodi si ada apa saja?';
console.log('question:', q);
const res = tryStructuredFeeBreakdownAnswer(q, null, {});
console.log('res:', JSON.stringify(res, null, 2));
