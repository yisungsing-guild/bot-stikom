const fs = require('fs');
const data = JSON.parse(fs.readFileSync('run_queries_results.json', 'utf8'));
for (const item of data) {
  const q = item.query;
  const res = item.result || item;
  const feeStruct = (res.debug && res.debug.feeStruct) || res.feeStruct || null;
  if (!feeStruct) continue;
  const reg = feeStruct.registrationDiscount || null;
  const dpp = feeStruct.dppDiscount || null;
  const sources = (feeStruct.sourceChunks || []).map(sc => ({
    id: sc.id,
    filename: sc.filename,
    trainingId: sc.trainingId,
    program: sc.program || null
  }));
  console.log('QUERY:', q);
  console.log(' registrationDiscount=', reg);
  console.log(' dppDiscount=', dpp);
  console.log(' sourceChunks=', JSON.stringify(sources, null, 2));
  console.log('---');
}
