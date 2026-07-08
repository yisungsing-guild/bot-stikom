const fs = require('fs');
const path = require('path');
const finalPath = path.join(__dirname, 'final_wa_outputs.log');
const chatIds = ['r1','r2','r3','r4','r5'];
const content = fs.readFileSync(finalPath,'utf8').split(/\r?\n/).filter(Boolean);
const entries = content.map(line => {
  try { return JSON.parse(line); }
  catch (e) { return { raw: line }; }
});
for (const id of chatIds) {
  console.log('===', id, '===');
  const hits = entries.filter(e => e.chatId === id || (e.text && e.text.includes(id)) || JSON.stringify(e).includes(id));
  hits.slice(0, 10).forEach(e => console.log(JSON.stringify(e)));
  console.log('TOTAL', hits.length);
}
