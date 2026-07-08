const r = require('./src/engine/ragEngine');
const q = 'biaya lengkap prodi si ada apa saja?';
const currentQ = q;
const qLower = currentQ.toLowerCase();
const detectProgramKey = (textLower, opts = null) => {
  if (!textLower) return null;
  const o = (opts && typeof opts === 'object') ? opts : {};
  const allowDualDegree = o.allowDualDegree !== false;
  const allowLooseProgramCode = o.allowLooseProgramCode !== false;
  if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
  if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
  if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
  if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
  if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';
  if (allowLooseProgramCode) {
    if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
      const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
      if (m && m[1]) return m[1].toLowerCase();
    }
  }
  if (allowDualDegree) {
    if (/\bhelp\b|help\s+university|malaysia/i.test(textLower)) return 'help';
    if (/\bdnui\b|dalian\s+neusoft|university\s+of\s+information/i.test(textLower)) return 'dnui';
    if (/\butb\b|universitas\s+teknologi\s+bandung/i.test(textLower)) return 'utb';
  }
  return null;
};
const programKey = detectProgramKey(qLower, { allowDualDegree: true, allowLooseProgramCode: true });
console.log('programKey', programKey);
const fullIndex = r.loadIndex();
console.log('index length', fullIndex.length);
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const allMatches = fullIndex.filter(item => item && item.chunk && keyRe.test(item.chunk));
console.log('all matching trainingIds', [...new Set(allMatches.map(i=>i.trainingId).filter(Boolean))].slice(0,20));
console.log('matching count', allMatches.length);
if (allMatches.length) {
  for (let i=0;i<10 && i<allMatches.length;i++) {
    const it = allMatches[i];
    console.log(i, it.trainingId, it.filename, it.chunk.substring(0,200).replace(/\n/g,' '));
  }
}
const idCounts = new Map();
const idHasFeeSignal = new Map();
for (const item of fullIndex) {
  const chunk = item && item.chunk ? String(item.chunk) : '';
  const trainingId = item && item.trainingId ? String(item.trainingId) : '';
  if (!chunk || !trainingId) continue;
  if (!keyRe.test(chunk)) continue;
  const hasFeeSignal = /RINCIAN\s*BIAYA\s*PENDIDIKAN/i.test(chunk) || /RINCIANBIAYAPENDIDIKAN/i.test(chunk) || /No\.?\s*Jenis\s*Biaya/i.test(chunk) || /Waktu\s*Pembayaran/i.test(chunk);
  idHasFeeSignal.set(trainingId, idHasFeeSignal.get(trainingId) || Boolean(hasFeeSignal));
  const prev = idCounts.get(trainingId) || 0;
  const bonus = /RINCIAN\s+BIAYA\s+PENDIDIKAN/i.test(chunk) || /No\.?\s*Jenis\s*Biaya/i.test(chunk) ? 2 : 0;
  idCounts.set(trainingId, prev + 1 + bonus);
}
console.log('idCounts entries', idCounts.size);
for (const [tid, score] of idCounts.entries()) {
  if (idHasFeeSignal.get(tid)) console.log('  fee-signal tid', tid, score);
}
const best = [...idCounts.entries()].filter(([tid]) => idHasFeeSignal.get(tid)).sort((a,b)=>b[1]-a[1])[0];
console.log('best trainingId with fee signal', best);
const bestOverall = [...idCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
console.log('best overall', bestOverall);
const candidates = best[0] ? fullIndex.filter(item=>item && String(item.trainingId||'')===best[0]).map(item=>(item&&item.chunk?String(item.chunk):'')) : [];
console.log('candidates length', candidates.length);
