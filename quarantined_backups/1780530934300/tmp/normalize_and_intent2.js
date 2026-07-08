const fs = require('fs');
const path = require('path');
const Module = require('module');
const { classifyIntent } = require('../src/engine/intentClassifier');
const ragPath = path.resolve('./src/engine/ragEngine.js');
const source = fs.readFileSync(ragPath, 'utf8');
const m = new Module(ragPath, module);
m.filename = ragPath;
m.paths = Module._nodeModulePaths(path.dirname(ragPath));
Module._cache[ragPath] = m;
try {
  m._compile(source + '\nmodule.exports = { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent };', ragPath);
} catch (e) {
  console.error('compile error', e);
  process.exit(1);
}
const { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent } = m.exports;
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
