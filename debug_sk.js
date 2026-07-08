const { tryStructuredFeeBreakdownAnswer, extractStructuredEntities } = require('./src/engine/ragEngine');
const question = 'Berapa biaya Sistem Komputer per semester?';
const top = [{
  chunk: 'Program Studi Sistem Komputer SK213225\nBiaya Pendidikan Per Semester 6.000.000\nDana Pendidikan Pokok 12.000.000',
  filename: 'sk_fee.pdf',
  trainingId: 'sk_test'
}];
console.log('entities', extractStructuredEntities(question));
const result = tryStructuredFeeBreakdownAnswer(question, top, {});
console.log('result', result);
