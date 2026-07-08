const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
const agg = {};
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    const intent = obj.intent || 'UNKNOWN';
    const reason = obj.reason || 'UNKNOWN';
    agg[intent] = agg[intent] || {total:0, reasonCounts:{}};
    agg[intent].total += 1;
    agg[intent].reasonCounts[reason] = (agg[intent].reasonCounts[reason]||0)+1;
  } catch (e) {
    console.error('bad line', line.slice(0,100), e.message);
  }
}
console.log(JSON.stringify(agg, null, 2));
