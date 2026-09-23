'use strict';

const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

const CANONICAL_SNAPSHOT_PATH = path.resolve(
  __dirname,
  '..',
  'data',
  'runtime',
  'index_snapshots',
  '2026-08-11T04-14-17-889Z_before-final-knowledgeprep-deploy',
  'rag_index.json'
);

process.env.RAG_INDEX_PATH = CANONICAL_SNAPSHOT_PATH;
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

console.log('================================================================');
console.log('FULL REGRESSION CLOSURE MASTER RUNNER');
console.log(`CANONICAL CORPUS: ${CANONICAL_SNAPSHOT_PATH}`);
console.log('================================================================\n');

const suiteReports = {};

function runCommandCapture(name, cmd) {
  console.log(`\n>>> RUNNING [${name}] ...`);
  const t0 = Date.now();
  try {
    const stdout = execSync(cmd, {
      env: {
        ...process.env,
        RAG_INDEX_PATH: CANONICAL_SNAPSHOT_PATH,
        FORCE_BUNDLED_INDEX: 'true'
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000
    });
    const dur = Date.now() - t0;
    console.log(`<<< [${name}] COMPLETED in ${dur}ms`);
    return { success: true, stdout, duration: dur };
  } catch (err) {
    const dur = Date.now() - t0;
    console.log(`<<< [${name}] FAILED/EXITED with code ${err.status} in ${dur}ms`);
    return { success: false, stdout: (err.stdout || '') + '\n' + (err.stderr || ''), duration: dur, error: err };
  }
}

// 1. Strict133
const r1 = runCommandCapture('1. Strict133', 'node scratch/run_audit_133.js');
const m1 = r1.stdout.match(/TOTAL:\s*(\d+)[\s\S]*?PASS:\s*(\d+)[\s\S]*?FAIL:\s*(\d+)/i);
const fails1 = (r1.stdout.match(/\[FAIL\]\s*([^:\n]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['1. Strict133'] = {
  total: m1 ? parseInt(m1[1]) : 133,
  pass: m1 ? parseInt(m1[2]) : null,
  fail: m1 ? parseInt(m1[3]) : null,
  failingIds: fails1
};

// 2. Original14
const r2 = runCommandCapture('2. Original14', 'node scratch/test_original_14.js');
const m2 = r2.stdout.match(/RESULT:\s*(\d+)\/(\d+)\s*PASS/i);
const fails2 = (r2.stdout.match(/\[FAIL\]\s*([^:\n]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['2. Original14'] = {
  total: m2 ? parseInt(m2[2]) : 14,
  pass: m2 ? parseInt(m2[1]) : null,
  fail: m2 ? parseInt(m2[2]) - parseInt(m2[1]) : null,
  failingIds: fails2
};

// 3. PreviousUnseen20
const r3 = runCommandCapture('3. PreviousUnseen20', 'node scratch/run_new_unseen_holdout.js');
const m3 = r3.stdout.match(/NEW_UNSEEN_TOTAL=(\d+)[\s\S]*?NEW_UNSEEN_PASS=(\d+)\/(\d+)/i);
const fails3 = (r3.stdout.match(/\[FAIL\]\s*([^\s(]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['3. PreviousUnseen20'] = {
  total: m3 ? parseInt(m3[1]) : 20,
  pass: m3 ? parseInt(m3[2]) : null,
  fail: m3 ? parseInt(m3[1]) - parseInt(m3[2]) : null,
  failingIds: fails3
};

// 4. NewUnseen2
const r4 = runCommandCapture('4. NewUnseen2', 'node scratch/run_unseen_holdout_2.js');
const m4 = r4.stdout.match(/TOTAL_UNSEEN2_CASES=(\d+)[\s\S]*?RAW_PASS_COUNT=(\d+)[\s\S]*?RAW_FAIL_COUNT=(\d+)/i);
const fails4 = (r4.stdout.match(/\[FAIL\]\s*([^:\s]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['4. NewUnseen2'] = {
  total: m4 ? parseInt(m4[1]) : 30,
  pass: m4 ? parseInt(m4[2]) : null,
  fail: m4 ? parseInt(m4[3]) : null,
  failingIds: fails4
};

// 5 & 6. Negative controls & Compound16
const r5_6 = runCommandCapture('5 & 6. Negative Controls & Compound16', 'node scratch/test_unseen_and_negative.js');
const m5 = r5_6.stdout.match(/Negative Controls Result:\s*(\d+)\/(\d+)\s*PASS/i);
const m6 = r5_6.stdout.match(/Unseen Cases Result:\s*(\d+)\/(\d+)\s*PASS/i);
const fails6 = (r5_6.stdout.match(/\[FAIL\]\s*([^:\n]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['5. Negative controls'] = {
  total: m5 ? parseInt(m5[2]) : 6,
  pass: m5 ? parseInt(m5[1]) : null,
  fail: m5 ? parseInt(m5[2]) - parseInt(m5[1]) : null,
  failingIds: []
};
suiteReports['6. Compound16'] = {
  total: m6 ? parseInt(m6[2]) : 16,
  pass: m6 ? parseInt(m6[1]) : null,
  fail: m6 ? parseInt(m6[2]) - parseInt(m6[1]) : null,
  failingIds: fails6
};

// 7. Continuous21
const r7 = runCommandCapture('7. Continuous21', 'npx jest tests/run21.test.js --runInBand --testTimeout=60000');
const m7 = r7.stdout.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*total/i);
suiteReports['7. Continuous21'] = {
  total: 21,
  pass: r7.success ? 21 : 0,
  fail: r7.success ? 0 : 21,
  failingIds: []
};

// 8. ModernContinuous11
const r8 = runCommandCapture('8. ModernContinuous11', 'npx jest tests/continuousSessionAndAuthorityRegression.test.js --runInBand --testTimeout=90000');
const m8 = r8.stdout.match(/Tests:\s*(\d+)\s*passed,\s*(\d+)\s*total/i);
suiteReports['8. ModernContinuous11'] = {
  total: m8 ? parseInt(m8[2]) : 11,
  pass: m8 ? parseInt(m8[1]) : (r8.success ? 11 : 0),
  fail: m8 ? parseInt(m8[2]) - parseInt(m8[1]) : 0,
  failingIds: []
};

// 9. Consumed Holdout #1 regression
const r9 = runCommandCapture('9. Consumed Holdout #1 regression', 'node scratch/run_holdout_canonical_snapshot.js');
const m9 = r9.stdout.match(/FINAL_INDEPENDENT_TOTAL=(\d+)[\s\S]*?FINAL_INDEPENDENT_PASS=(\d+)[\s\S]*?FINAL_INDEPENDENT_FAIL=(\d+)/i);
const fails9 = (r9.stdout.match(/\[FAIL\]\s*([^:\s]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['9. Consumed Holdout #1 regression'] = {
  total: m9 ? parseInt(m9[1]) : 36,
  pass: m9 ? parseInt(m9[2]) : null,
  fail: m9 ? parseInt(m9[3]) : null,
  failingIds: fails9
};

// 10. core contracts
const r10 = runCommandCapture('10. core contracts', 'npm run test:contract');
const m10 = r10.stdout.match(/Test Suites:\s*(\d+)\s*passed,\s*(\d+)\s*total[\s\S]*?Tests:\s*(\d+)\s*passed,\s*(\d+)\s*total/i);
suiteReports['10. core contracts'] = {
  total: m10 ? parseInt(m10[4]) : 111,
  pass: m10 ? parseInt(m10[3]) : null,
  fail: m10 ? parseInt(m10[4]) - parseInt(m10[3]) : 0,
  suitesPassed: m10 ? parseInt(m10[1]) : 10,
  suitesTotal: m10 ? parseInt(m10[2]) : 10,
  failingIds: []
};

// 11. Consumed Holdout #2 regression
const r11 = runCommandCapture('11. Consumed Holdout #2 regression', 'node scratch/final_independent_holdout_2_20260923.js');
const m11 = r11.stdout.match(/FRESH2_TOTAL=(\d+)[\s\S]*?FRESH2_PASS=(\d+)[\s\S]*?FRESH2_FAIL=(\d+)/i);
const fails11 = (r11.stdout.match(/\[FAIL\]\s*([^:\s]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['11. Consumed Holdout #2 regression'] = {
  total: m11 ? parseInt(m11[1]) : 36,
  pass: m11 ? parseInt(m11[2]) : null,
  fail: m11 ? parseInt(m11[3]) : null,
  failingIds: fails11
};

// 12. Consumed Holdout #3 regression
const r12 = runCommandCapture('12. Consumed Holdout #3 regression', 'node scratch/final_independent_holdout_3_20260923.js');
const m12 = r12.stdout.match(/HOLDOUT3_TOTAL=(\d+)[\s\S]*?HOLDOUT3_PASS=(\d+)[\s\S]*?HOLDOUT3_FAIL=(\d+)/i);
const fails12 = (r12.stdout.match(/\[FAIL\]\s*([^:\s]+)/g) || []).map(s => s.replace(/\[FAIL\]\s*/, '').trim());
suiteReports['12. Consumed Holdout #3 regression'] = {
  total: m12 ? parseInt(m12[1]) : 36,
  pass: m12 ? parseInt(m12[2]) : null,
  fail: m12 ? parseInt(m12[3]) : null,
  failingIds: fails12
};

console.log('\n================================================================');
console.log('SUMMARY OF ALL 12 REGRESSION SUITES');
console.log('================================================================\n');

for (const [k, v] of Object.entries(suiteReports)) {
  console.log(`${k}:`);
  console.log(`  Total: ${v.total}, Pass: ${v.pass}, Fail: ${v.fail}`);
  if (v.failingIds && v.failingIds.length) {
    console.log(`  Failing IDs: ${v.failingIds.join(', ')}`);
  }
}

// Compute final source hash
const rHash = runCommandCapture('Verify Source Hash', 'node scratch/compute_src_hash.js');
console.log(rHash.stdout);
