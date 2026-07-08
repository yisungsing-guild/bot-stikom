const fs = require('fs');
let s = fs.readFileSync('out_clean.json', 'utf16le');
s = s.replace(/^\uFEFF/, '');
const data = JSON.parse(s);
for (const item of data) {
  const res = item.res;
  const fee = res.debug && res.debug.feeStruct ? res.debug.feeStruct : null;
  const names = [];
  if (fee) {
    if (fee.sourceFile) names.push(fee.sourceFile);
    if (fee.sourceChunk && fee.sourceChunk.filename) names.push(fee.sourceChunk.filename);
  }
  if (res.contexts && res.contexts.length) {
    for (const c of res.contexts) {
      if (c.filename && !names.includes(c.filename)) names.push(c.filename);
    }
  }
  process.stdout.write('=== ' + item.key + ' ===\n');
  process.stdout.write('1. success: ' + res.success + '\n');
  process.stdout.write('2. source: ' + res.source + '\n');
  process.stdout.write('3. feeStruct: ' + (fee ? JSON.stringify(fee) : 'null') + '\n');
  process.stdout.write('4. registrationFee: ' + (fee ? fee.registrationFee : null) + '\n');
  process.stdout.write('5. dpp: ' + (fee ? fee.dpp : null) + '\n');
  process.stdout.write('6. registrationDiscount: ' + (fee ? fee.registrationDiscount : null) + '\n');
  process.stdout.write('7. answer: ' + res.answer.replace(/\n/g, '\\n') + '\n');
  process.stdout.write('8. filename sumber yang digunakan: ' + (names.length ? names.join(' | ') : 'none') + '\n\n');
}
