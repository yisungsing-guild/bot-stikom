const fs = require('fs');
const path = require('path');
const tracePath = path.join(__dirname, 'provider_traces.log');
const text = fs.readFileSync(tracePath, 'utf8');
const lines = text.split(/\r?\n/).filter(Boolean);
const chatIds = ['r1','r2','r3','r4','r5'];
for (const id of chatIds) {
  console.log('===', id, '===');
  let count=0;
  for (const [idx,line] of lines.entries()) {
    if (line.includes(`"chatId":"${id}"`) || line.includes(id) && /"chatId"/.test(line)===false && line.includes(id)) {
      console.log(`${idx+1}: ${line}`);
      count++;
      if (count>=100) break;
    }
  }
  console.log('TOTAL', count);
  console.log('');
}
