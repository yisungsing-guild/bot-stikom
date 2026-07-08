const fs = require('fs');
const data = JSON.parse(fs.readFileSync('out_clean.json', 'utf8'));
for (const item of data) {
  console.log('---');
  console.log('key:', item.key);
  if (item.error) {
    console.log('error:', item.error);
    continue;
  }
  const res = item.res;
  console.log('success:', res.success);
  console.log('source:', res.source);
  console.log('answer:', res.answer.replace(/\n/g, '\\n'));
  const fee = res.debug && res.debug.feeStruct ? res.debug.feeStruct : null;
  console.log('feeStruct:', fee ? JSON.stringify(fee, null, 2) : 'null');
  if (fee) {
    console.log('registrationFee:', fee.registrationFee);
    console.log('dpp:', fee.dpp);
    console.log('registrationDiscount:', fee.registrationDiscount);
    const filenames = [];
    if (fee.sourceFile) filenames.push(fee.sourceFile);
    if (fee.sourceChunk && fee.sourceChunk.filename) filenames.push(fee.sourceChunk.filename);
    if (res.contexts && res.contexts.length) {
      for (const c of res.contexts) {
        if (c.filename && !filenames.includes(c.filename)) filenames.push(c.filename);
      }
    }
    console.log('filenames:', filenames.join(' | ') || 'none');
  } else {
    console.log('registrationFee: null');
    console.log('dpp: null');
    console.log('registrationDiscount: null');
    const filenames = res.contexts && res.contexts.length ? res.contexts.map(c => c.filename).filter(Boolean) : [];
    console.log('filenames:', filenames.join(' | ') || 'none');
  }
}
