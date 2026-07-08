const fs = require('fs');
const path = './tmp_audit_flow_outputs.jsonl';
const out = [];
if (!fs.existsSync(path)) {
  console.error('missing', path); process.exit(1);
}
const lines = fs.readFileSync(path,'utf8').split('\n').filter(Boolean);
for (const l of lines) {
  try {
    const obj = JSON.parse(l);
    out.push({
      query: obj.query,
      feeStruct: obj.feeStruct || null,
      initialCostItems: (obj.feeStruct && obj.feeStruct.initialCostItems) ? obj.feeStruct.initialCostItems : (obj.formatterInput && obj.formatterInput.feeStruct && obj.formatterInput.feeStruct.initialCostItems ? obj.formatterInput.feeStruct.initialCostItems : null),
      preDecorate: obj.preDecorate || null,
      final: obj.final || null
    });
  } catch (e) {
    console.error('parse error', e && e.message);
  }
}
fs.writeFileSync('./tmp_audit_summary.json', JSON.stringify(out, null, 2));
console.log('wrote tmp_audit_summary.json');
