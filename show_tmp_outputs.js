const fs = require('fs');
const path = './tmp_audit_flow_outputs.jsonl';
const lines = fs.readFileSync(path,'utf8').trim().split('\n');
for (const line of lines) {
  try {
    const obj = JSON.parse(line);
    console.log('---', obj.query, '---');
    console.log('A. parsedRows labels:', obj.parsedRows.map(r=>r.label));
    console.log('B. feeStruct keys present:', obj.feeStruct ? Object.keys(obj.feeStruct).filter(k=>obj.feeStruct[k]) : []);
    console.log('C. formatterInput includes feeStruct? ', !!obj.formatterInput.feeStruct);
    console.log('D. preDecorate contains "Jas"? ', obj.preDecorate && obj.preDecorate.includes('Jas'));
    console.log('D. preDecorate contains "Kaos"? ', obj.preDecorate && obj.preDecorate.includes('Kaos'));
    console.log('E. final contains "Jas"? ', obj.final && obj.final.includes('Jas'));
    console.log('E. final contains "Kaos"? ', obj.final && obj.final.includes('Kaos'));
    console.log('preDecorate:\n', obj.preDecorate.split('\n').slice(0,20).join('\n'));
    console.log('final:\n', obj.final.split('\n').slice(0,20).join('\n'));
  } catch (e) {
    console.error('parse error', e);
  }
}
