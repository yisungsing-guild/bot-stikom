'use strict';

process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';

const { querySemanticRag } = require('../src/engine/semanticRagEngine');
const { SUPPORTED_CASES } = require('../scripts/run_corpus_evaluation');

const ORIGINAL_14_IDS = [
  'SC-02', 'SC-03', 'CRT-03', 'EXC-01', 'EXC-03',
  'REG-03', 'REG-04', 'CNT-03', 'PAR-04', 'PAR-07',
  'MUL-05', 'EXT-04', 'EXT-07', 'EXT-08'
];

async function run() {
  console.log('Testing 14 ORIGINAL SUPPORTED CASES...\n');
  const cases = SUPPORTED_CASES.filter(c => ORIGINAL_14_IDS.includes(c.id));
  let passCount = 0;
  for (const c of cases) {
    const res = await querySemanticRag(c.query);
    const valid = c.validate(res);
    console.log(`[${valid ? 'PASS' : 'FAIL'}] ${c.id}: "${c.query}"`);
    console.log(`       Route: ${res.source}`);
    console.log(`       Answer: ${String(res.answer || '').slice(0, 100).replace(/\s+/g, ' ')}...\n`);
    if (valid) passCount++;
  }
  console.log(`RESULT: ${passCount}/${cases.length} PASS`);
}

run().catch(console.error);
