const fs = require('fs');
const fullIndex = JSON.parse(fs.readFileSync('src/data/rag_index.json','utf8'));
const qLower = 'biaya lengkap prodi si ada apa saja?';
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
console.log({programKey});
const feeSignalRe = /(?:RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN|No\.\s*Jenis\s*Biaya|Waktu\s*Pembayaran|Biaya\s*Pendaftaran|Dana\s*Pendidikan\s*Pokok|\bDPP\b|UKT|Biaya\s*Pendidikan\s*Per\s*Semester|Biaya\s*Semester)/i;
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER|PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const idCounts = new Map();
for (const item of fullIndex) {
  const chunk = item && item.chunk ? String(item.chunk) : '';
  const trainingId = item && item.trainingId ? String(item.trainingId) : '';
  if (!chunk || !trainingId) continue;
  if (!keyRe.test(chunk)) continue;
  const hasFeeSignal = feeSignalRe.test(chunk);
  if (hasFeeSignal) {
    const prev = idCounts.get(trainingId) || 0;
    const bonus = /\bPendaftaran\b/i.test(chunk) ? 2 : 0;
    idCounts.set(trainingId, prev + 1 + bonus);
  }
}
let bestTid=null,bestScore=-1;
for(const [tid,score] of idCounts.entries()){
  if(score>bestScore){bestScore=score;bestTid=tid;}
}
console.log({bestTid,bestScore,idCountsSize:idCounts.size});
const candidates = bestTid ? fullIndex.filter(item=>item && String(item.trainingId||'')===bestTid).map(item=>String(item.chunk||'')) : [];
console.log('candidates', candidates.length);
for(let i=0;i<Math.min(20,candidates.length);i++) {
  console.log('--- candidate',i,'len', candidates[i].length);
  console.log(candidates[i].slice(0,200).replace(/\n/g,' '));
}
const chunks=candidates.join('\n');
const rawLines=chunks.replace(/\r\n/g,'\n').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
console.log('rawLines',rawLines.length);
const parseInlineRow = (rawLine)=>{
  const line=String(rawLine||'').replace(/\s{2,}/g,' ').trim();
  if(!line) return null;
  const reNumbered=/^(\d+)\.?\s*[\)\.]\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/;
  const reDashed=/^(?:[-ΓÇó]+)\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/;
  const m1=reNumbered.exec(line);
  if(m1){ return {label:String(m1[2]||'').trim(), amount:String(m1[3]).trim(), timing:String(m1[4]||'').trim()}; }
  const m2=reDashed.exec(line);
  if(m2){ return {label:String(m2[1]||'').trim(), amount:String(m2[2]).trim(), timing:String(m2[3]||'').trim()}; }
  return null;
};
const isLikelyFeeLabel=(rawLabel)=>{
  const label=String(rawLabel||'').trim(); if(!label) return false; const lower=label.toLowerCase();
  if(/(\bhotline\b|\bfax\b|\bemail\b|\bwebsite\b|\bweb\b|\bkampus\b|\bjl\b|\bjln\b|\bjalan\b|\bph\b\s*:?|\btelepon\b|\btelp\b)/i.test(lower)) return false;
  if(/(\bdipindai\b|camscanner|always\s+the\s+first)/i.test(lower)) return false;
  if(/(surat\s+keputusan|lampiran\b|tanggal\b|nomor\b|rektor\b|wakil\b)/i.test(lower)) return false;
  if(/(pendaftaran|dana|biaya|dpp|registrasi|pendidikan|semester|almamater|gmti|kaos|tas|topi|pengalaman|industri|bahasa|ujian|subject|sertifikasi|yudisium|wisuda|transfer|laptop|perwalian|iuran|kemahasiswaan)/i.test(lower)) return true;
  return false;
};
const items=[];
for(const [idx,line] of rawLines.entries()){
  const inline=parseInlineRow(line);
  if(inline){ items.push({idx,line,inline}); }
}
console.log('inline items', items.length);
for(const it of items.slice(0,20)) console.log(it);
