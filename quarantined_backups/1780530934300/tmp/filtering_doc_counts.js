const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : [];
const agg = {};
for (const line of lines) {
  const obj = JSON.parse(line);
  const intent = obj.intent || 'UNKNOWN';
  const reason = obj.reason || 'UNKNOWN';
  const filename = obj.sourceFile || 'unknown';
  const category = obj.docCategory || 'UNKNOWN';
  agg[intent] = agg[intent] || {};
  const key = `${reason}||${filename}||${category}`;
  agg[intent][key] = (agg[intent][key] || 0) + 1;
}
for (const intent of Object.keys(agg)) {
  console.log('INTENT:', intent);
  const rows = Object.entries(agg[intent])
    .map(([k,v]) => ({k,v}))
    .sort((a,b)=>b.v-a.v)
    .slice(0,40);
  for (const {k,v} of rows) {
    const [reason, filename, category] = k.split('||');
    console.log(`  ${v} x ${reason} | ${category} | ${filename}`);
  }
  console.log('');
}
