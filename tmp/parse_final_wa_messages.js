const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'final_wa_outputs.log');
const data = fs.readFileSync(file, 'utf8');
const lines = data.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith('=== FINAL WA MESSAGE ===')) {
    const next = lines[i+1] || '';
    const chatId = line.split(' ').pop();
    if (['r1','r2','r3','r4','r5'].includes(chatId)) {
      console.log('===', chatId, 'header at', i+1, '===');
      console.log(line);
      // print next up to blank line or next header
      let j = i+1;
      while (j < lines.length && !lines[j].startsWith('=== FINAL WA MESSAGE ===')) {
        if (lines[j].trim()) console.log(lines[j]);
        j++;
      }
      console.log('');
    }
  }
}
