const fs = require('fs');
const s = fs.readFileSync('./src/engine/ragEngine.js', 'utf8');
const idx = s.indexOf('function assessContextConsistency');
console.log('idx', idx);
console.log(JSON.stringify(s.slice(idx, idx + 120)));
for (let i = idx; i < idx + 120; i++) {
  const c = s[i];
  const code = c.charCodeAt(0);
  if (code === 92 || code < 32) console.log(i - idx, code, JSON.stringify(c));
}
