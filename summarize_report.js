const fs = require('fs');
const report = JSON.parse(fs.readFileSync('run_queries_report.json','utf8'));
const numericFields = ['registrationFee','registrationDiscount','dpp','dppDiscount','ukt','scholarship'];
for (const r of report) {
  if (r.error) {
    console.log('Query:', r.query);
    console.log('  ERROR:', r.error);
    continue;
  }
  console.log('---');
  console.log('Query:', r.query);
  console.log('source:', r.source);
  console.log('confidenceTier:', r.confidenceTier);
  console.log('trustScore:', r.trustScore);
  console.log('chunkId:', r.chunkId);
  console.log('filename:', r.filename);
  console.log('feeStruct:');
  if (!r.feeStruct) {
    console.log('  <no feeStruct>');
  } else {
    for (const k of Object.keys(r.feeStruct)) {
      if (['rawChunk','sourceChunk','embedding'].includes(k)) continue;
      console.log(' ', k+':', JSON.stringify(r.feeStruct[k]));
    }
    console.log('  NUMERIC COMPARISONS:');
    for (const f of numericFields) {
      const c = r.comparisons && r.comparisons[f] ? r.comparisons[f] : null;
      if (c) console.log(`    ${f}: ${c.value} => ${c.match}`);
      else console.log(`    ${f}: null => NO_VALUE`);
    }
  }
}
console.log('---');
