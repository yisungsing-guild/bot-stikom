const fs = require('fs');
const data = JSON.parse(fs.readFileSync('jest_results.json', 'utf8'));
for (const tr of data.testResults) {
  for (const a of tr.assertionResults.filter(x => x.status === 'failed')) {
    console.log('FAILED:', a.fullName);
    a.failureMessages.forEach((m, idx) => {
      console.log('MSG', idx, m.substring(0, 1200).replace(/\n/g, '\\n'));
      console.log('---');
    });
  }
}
