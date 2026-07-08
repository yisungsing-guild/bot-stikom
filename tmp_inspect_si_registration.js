const fs = require('fs');
const raw = fs.readFileSync('src/data/rag_index.json','utf8');
const data = JSON.parse(raw);
const reProgram = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const reFeeHeader = /(RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN|No\.\s*Jenis\s*Biaya|Waktu\s*Pembayaran|Biaya\s*Pendaftaran|DPP|Dana\s*Pendidikan\s*Pokok|UKT|biaya\s*semester|uang\s*semester|registrasi)/i;
let count = 0;
for (const item of data) {
  const chunk = String(item.chunk || '');
  if (!reProgram.test(chunk)) continue;
  if (reFeeHeader.test(chunk)) {
    count++;
    if (count <= 20) {
      console.log('---', item.id, item.trainingId, item.filename);
      console.log(chunk.slice(0, 360).replace(/\n/g, ' '));
      console.log('');
    }
  }
}
console.log('count', count);
const all = data.filter(item => item && reProgram.test(String(item.chunk || '')));
console.log('allSI', all.length);
