#!/usr/bin/env node
const { query } = require('./src/engine/ragEngine.js');

const queries = [
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

async function testQueries() {
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log('\n' + '='.repeat(100));
    console.log(`QUERY #${i + 1}: "${q}"`);
    console.log('='.repeat(100));

    try {
      const result = await query(q, [], 'test-user', new Date());

      if (result && result.answer) {
        console.log('BOT ANSWER:');
        console.log(result.answer);
        console.log('');
        console.log('SOURCE:', result.source || 'unknown');
        if (result.confidence) console.log('CONFIDENCE:', result.confidence);
      } else {
        console.log('(No structured answer - fallback to web or OpenAI)');
      }
    } catch (err) {
      console.log('ERROR:', err.message);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('ALL QUERIES TESTED - END OF REPORT');
  console.log('='.repeat(100));
}

testQueries().catch(err => console.error('Test failed:', err));
