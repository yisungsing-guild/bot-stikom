const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tmp_audit_ux_results.json'), 'utf8'));
for (const item of data) {
  console.log('===', item.program, '-', item.questionLabel, '===');
  console.log('Query user:', item.question);
  console.log('Source:', item.source);
  console.log('Intent:', item.intent);
  console.log('Greeting:', item.greeting.replace(/\n/g,' '));
  console.log('Assumption:', item.assumption);
  console.log('Jawaban utama:', item.body.replace(/\n/g,' '));
  console.log('Kesimpulan:', item.conclusion);
  console.log('Rekomendasi:', item.followUp);
  console.log('Rating:', Object.entries(item.evaluation).map(([k,v])=>`${k}=${v}`).join(', '));
  console.log('');
}
