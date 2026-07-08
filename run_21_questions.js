#!/usr/bin/env node
const rag = require('./src/engine/ragEngine.js');

const questions = [
  'apa itu si',
  'apa itu ti',
  'apa itu sk',
  'apa itu bd',
  'apa itu mi',
  'apakah ada beasiswa?',
  'rincian biaya si gelombang 2B?',
  'rincian biaya ti gelombang 1A?',
  'rincian biaya sk gelombang 3B?',
  'rincian biaya bd gelombang 4A?',
  'apakah ada program double degree di stikom?',
  'apakah ada program double degree internasional?',
  'apakah ada program double degree nasional?',
  'prospek kerja si?',
  'prospek kerja sk?',
  'prospek kerja ti?',
  'prospek kerja mi?',
  'prospek kerja bd?',
  'biaya termurah dari semua prodi apa?',
  'biaya s1 termurah apa?',
  's1 bisnis digital apakah lebih murah dari prodi yang lain?'
];

(async () => {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    console.log('\n' + '='.repeat(80));
    console.log(`Q${i+1}. ${q}`);
    try {
      const res = await rag.query(q, 8, null);
      if (!res) {
        console.log('(No structured response returned)');
        continue;
      }
      // Provider-style message: the text body
      console.log('\n--- Reply Text ---\n');
      console.log(res.answer || res);
      console.log('\n--- Metadata ---\n');
      console.log('source:', res.source || 'N/A');
      if (res.contexts) {
        console.log('contexts:');
        res.contexts.forEach((c, idx) => {
          console.log(`  [${idx}] id=${c.id || 'n/a'} file=${c.filename || 'n/a'}`);
        });
      }
    } catch (e) {
      console.log('Error while querying:', e && e.message ? e.message : e);
    }
  }
})();
