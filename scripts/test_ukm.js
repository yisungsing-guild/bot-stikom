#!/usr/bin/env node
const { query } = require('../src/engine/ragEngine');

const tests = [
  'Ada UKM apa di STIKOM?',
  'Daftar UKM',
  'Sebutkan daftar UKM',
  'Nama-nama UKM di STIKOM?',
  'Daftar ormawa'
];

(async () => {
  for (const q of tests) {
    console.log('=== Query:', q);
    try {
      const res = await query(q, 3, {});
      if (!res) {
        console.log('No result');
      } else {
        console.log('Source:', res.source || '(none)');
        if (res.debug) console.log('Debug:', JSON.stringify(res.debug));
        console.log('\nAnswer:\n');
        console.log(res.answer || '(no answer)');
      }
    } catch (e) {
      console.error('ERROR:', e && e.message ? e.message : e);
    }
    console.log('\n');
  }
})();
