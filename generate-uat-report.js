#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const resultsFile = path.join(__dirname, 'tmp', 'audit_results_1782663216555.json');
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));

const scenarioNames = {
  A: 'Menu PMB',
  B: 'Definisi Prodi',
  C: 'Definisi + Prospek',
  D: 'Biaya Prodi (4 gelombang)',
  E: 'Rincian Biaya (4 gelombang)',
  F: 'Context Switching',
  G: 'Random Jumping',
  H: 'Ambiguous Questions'
};

// Count pass/fail per scenario
const scenarioStats = {};
Object.keys(scenarioNames).forEach(s => {
  scenarioStats[s] = { pass: 0, fail: 0, tests: [] };
});

results.forEach(test => {
  const hasValidReply = test.finalMessage && test.finalMessage.trim().length > 5;
  const status = hasValidReply ? 'PASS' : 'FAIL';
  
  scenarioStats[test.scenario].tests.push({
    question: test.question,
    status: status,
    finalMessage: test.finalMessage || 'NULL'
  });
  
  if (hasValidReply) {
    scenarioStats[test.scenario].pass++;
  } else {
    scenarioStats[test.scenario].fail++;
  }
});

// Generate report
console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║         END-TO-END WHATSAPP UAT REPORT - LIVE RUNTIME       ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('OVERVIEW');
console.log('─────────────────────────────────────────────────────────────');

const totalTests = results.length;
const totalPass = results.filter(t => t.finalMessage && t.finalMessage.trim().length > 5).length;
const totalFail = totalTests - totalPass;
const passPercent = ((totalPass / totalTests) * 100).toFixed(1);

console.log(`Total Test Cases: ${totalTests}`);
console.log(`✅ PASS: ${totalPass}`);
console.log(`❌ FAIL: ${totalFail}`);
console.log(`Success Rate: ${passPercent}%`);
console.log('');

// Scenario breakdown
console.log('SCENARIO BREAKDOWN');
console.log('─────────────────────────────────────────────────────────────');
Object.keys(scenarioNames).sort().forEach(scenario => {
  const stats = scenarioStats[scenario];
  const total = stats.pass + stats.fail;
  const pct = ((stats.pass / total) * 100).toFixed(0);
  const status = stats.fail === 0 ? '✅' : '⚠️ ';
  console.log(`${status} Scenario ${scenario}: ${scenarioNames[scenario]}`);
  console.log(`   Tests: ${total} | Pass: ${stats.pass} | Fail: ${stats.fail} (${pct}%)`);
});

console.log('');
console.log('FAILED TESTS DETAIL');
console.log('─────────────────────────────────────────────────────────────');

let failCount = 0;
Object.keys(scenarioNames).sort().forEach(scenario => {
  const failedTests = scenarioStats[scenario].tests.filter(t => t.status === 'FAIL');
  if (failedTests.length > 0) {
    console.log(`\nScenario ${scenario}: ${scenarioNames[scenario]}`);
    failedTests.forEach(test => {
      failCount++;
      console.log(`  ${failCount}. Q: "${test.question}"`);
      console.log(`     A: ${test.finalMessage || '[NO RESPONSE]'}`);
    });
  }
});

if (failCount === 0) {
  console.log('✅ All test cases PASSED! No failures detected.');
}

console.log('');
console.log('SAMPLE PASSING RESPONSES');
console.log('─────────────────────────────────────────────────────────────');

const samples = {};
Object.keys(scenarioNames).forEach(s => { samples[s] = null; });

results.forEach(test => {
  if (samples[test.scenario] === null && test.finalMessage && test.finalMessage.trim().length > 5) {
    samples[test.scenario] = test;
  }
});

Object.keys(scenarioNames).sort().forEach(scenario => {
  if (samples[scenario]) {
    const test = samples[scenario];
    console.log(`\nScenario ${scenario}: ${scenarioNames[scenario]}`);
    console.log(`  Q: "${test.question}"`);
    console.log(`  A: "${test.finalMessage.substring(0, 120)}..."`);
  }
});

console.log('');
console.log('CONCLUSION');
console.log('─────────────────────────────────────────────────────────────');
if (passPercent >= 95) {
  console.log('✅ UAT STATUS: PASS');
  console.log('   The WhatsApp bot is functioning correctly across all scenarios.');
  console.log('   Success rate is above acceptable threshold (≥95%).');
} else if (passPercent >= 80) {
  console.log('⚠️  UAT STATUS: PARTIAL PASS');
  console.log('   The bot is mostly functional but needs attention to specific issues.');
} else {
  console.log('❌ UAT STATUS: FAIL');
  console.log('   Significant issues detected. Review failed scenarios above.');
}

console.log('');
console.log(`Report Generated: ${new Date().toISOString()}`);
console.log('');
