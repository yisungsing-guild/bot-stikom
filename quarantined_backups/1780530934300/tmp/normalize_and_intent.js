const fs = require('fs');
const vm = require('vm');
const { classifyIntent } = require('../src/engine/intentClassifier');
const ragSource = fs.readFileSync('./src/engine/ragEngine.js', 'utf8');
const sandbox = { module: { exports: {} }, exports: {}, require, console };
vm.createContext(sandbox);
vm.runInContext(ragSource + '\nmodule.exports = { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent };', sandbox);
const { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent } = sandbox.module.exports;
const qs = [
  'Apa itu Sistem Informasi',
  'Sistem Informasi belajar apa saja',
  'Mata kuliah Sistem Informasi',
  'Prospek kerja Sistem Informasi',
  'Lulusan Sistem Informasi bisa kerja dimana',
  'Apa itu Teknologi Informasi',
  'Teknologi Informasi belajar apa saja',
  'Prospek kerja Teknologi Informasi'
];
for (const q of qs) {
  console.log('Q:', q);
  console.log('  classifyIntent:', classifyIntent(q));
  console.log('  detectIntent:', detectIntent(q));
  console.log('  academicIntent:', extractAcademicIntent(q));
  console.log('  normalized:', normalizeIndonesianQuestionText(q));
  console.log('  retrieval:', normalizeQueryForRetrieval(normalizeIndonesianQuestionText(q)));
  console.log('');
}
