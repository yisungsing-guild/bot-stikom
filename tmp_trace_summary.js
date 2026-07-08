const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./tmp_trace_queries_results.json','utf8'));
for (const item of data) {
  const ctxFiles = Array.isArray(item.contexts) ? Array.from(new Set(item.contexts.map(c => c.filename).filter(Boolean))) : [];
  const fee = item.feeStruct;
  console.log(`QUERY: ${item.query}`);
  console.log(`  source: ${item.source}`);
  console.log(`  contexts file(s): ${ctxFiles.length ? ctxFiles.join(' | ') : '(none)'}`);
  console.log(`  feeStruct: ${fee ? 'yes' : 'no'}`);
  if (fee) {
    console.log(`   - sourceFile: ${fee.sourceFile}`);
    console.log(`   - registrationFee: ${fee.registrationFee || '(none)'}`);
    console.log(`   - registrationDiscount: ${fee.registrationDiscount || '(none)'}`);
    console.log(`   - dpp: ${fee.dpp || '(none)'}`);
    console.log(`   - dppDiscount: ${fee.dppDiscount || '(none)'}`);
    console.log(`   - initialCostItems: ${fee.initialCostItems ? fee.initialCostItems.length : 0}`);
    console.log(`   - classifiedInitialCostItems: ${fee.classifiedInitialCostItems ? 'yes' : 'no'}`);
  }
  console.log('');
}
