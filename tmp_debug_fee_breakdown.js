const fs = require('fs');
const raw = fs.readFileSync('src/data/rag_index.json','utf8');
const fullIndex = JSON.parse(raw);
const qLower = 'biaya lengkap prodi si ada apa saja?';
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER|PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const feeSignalRe = /(?:RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN|No\.\s*Jenis\s*Biaya|Waktu\s*Pembayaran|Biaya\s*Pendaftaran|Dana\s*Pendidikan\s*Pokok|\bDPP\b|UKT|Biaya\s*Pendidikan\s*Per\s*Semester|Biaya\s*Semester)/i;
const detectProgramKey = (textLower) => {
  if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
  if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
  if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
  if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
  if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';
  if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
    const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
};
const programKey = detectProgramKey(qLower);
console.log('programKey', programKey);
const idCounts = new Map();
const idHasFeeSignal = new Map();
let matchedChunks=0;
for (const item of fullIndex) {
  const chunk = item && item.chunk ? String(item.chunk) : '';
  const trainingId = item && item.trainingId ? String(item.trainingId) : '';
  if (!chunk || !trainingId) continue;
  if (!keyRe.test(chunk)) continue;
  const hasFeeSignal = feeSignalRe.test(chunk);
  if (hasFeeSignal) {
    idHasFeeSignal.set(trainingId, true);
  }
  if (!keyRe.test(chunk)) continue;
  if (hasFeeSignal) {
    matchedChunks++;
    const prev = idCounts.get(trainingId) || 0;
    const bonus = /\bPendaftaran\b/i.test(chunk) ? 2 : 0;
    idCounts.set(trainingId, prev + 1 + bonus);
  }
}
console.log('matchedChunks', matchedChunks);
console.log('idCounts size', idCounts.size);
let bestTid=null,bestScore=-1;
for(const [tid,score] of idCounts){ if(score>bestScore){bestScore = score; bestTid=tid;}}
console.log('bestTid',bestTid,'bestScore',bestScore);
const candidates = bestTid ? fullIndex.filter(item=>item && String(item.trainingId||'')===bestTid).map(item=>String(item.chunk||'')) : [];
console.log('candidates', candidates.length);
for (let i=0;i<Math.min(10,candidates.length);i++) {
  console.log('--- chunk', i, 'len', candidates[i].length);
  console.log(candidates[i].slice(0,300));
}
// parse out lines and extract items similar logic, to see any items
const chunks = candidates.join('\n');
const rawLines = chunks.replace(/\r\n/g,'\n').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
console.log('rawLines', rawLines.length);
const lines = rawLines.slice(0,50);
for (let i=0;i<Math.min(80, lines.length); i++) console.log(i, lines[i]);
