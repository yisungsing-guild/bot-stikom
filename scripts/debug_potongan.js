const fs = require('fs');
const txt = fs.readFileSync('backups/backup-20260424-145106/trainingData.json', 'utf8');
function normalizeWaveLabel(s){
  s = String(s||'').trim(); if(!s) return null;
  const text = s.toLowerCase().replace(/gelombang\s*/g,'').trim();
  if(/khusus|special/i.test(text)) return 'KHUSUS';
  const romanMatch = text.match(/\b(i{1,3}|iv|v|vi|vii|viii|ix|x)\b/i);
  if(romanMatch){
    const romanMap = {i:'1',ii:'2',iii:'3',iv:'4',v:'5',vi:'6',vii:'7',viii:'8',ix:'9',x:'10'};
    const base = romanMap[romanMatch[1].toLowerCase()];
    const suffixMatch = text.match(/\b([a-zA-Z])\b/);
    return base ? (base + (suffixMatch ? suffixMatch[1].toUpperCase() : '')) : null;
  }
  const numericMatch = text.match(/\b([1-9][0-9]?)(?:\s*[-\/]?\s*([a-zA-Z]))?\b/);
  if(numericMatch){
    const base = numericMatch[1];
    const suffix = numericMatch[2] ? numericMatch[2].toUpperCase() : '';
    return base + suffix;
  }
  if(/\b(khusus|special)\b/.test(text)) return 'KHUSUS';
  return null;
}

const regMap = {};
const dppMap = {};
const lines = txt.replace(/\r/g, '').split('\n');
for (let i = 0; i < lines.length; i++) {
  const window = [lines[i], lines[i+1] || '', lines[i+2] || ''].join(' ');
  const w = window.replace(/\s+/g, ' ').trim();
  if (!/rp|potongan|gelombang|dpp|pendaftaran|beasiswa/i.test(w)) continue;
  const amounts = Array.from(w.matchAll(/rp\.?\s*([0-9\.,\-]{3,})/ig)).map(m => m[1].replace(/[,\-]/g,'').trim());
  const waveMatches = Array.from(w.matchAll(/gelombang\s*(khusus|sisipan\s*\d+|[ivx]+|[0-9]{1,2})\s*([a-z])?/ig));
  if (waveMatches.length === 0) continue;
  console.log('\n--- WINDOW at line', i+1, '---');
  console.log(w);
  console.log('amounts=', amounts);
  console.log('waveMatches=', waveMatches.map(m=>m[0]));

  for (const wm of waveMatches) {
    try {
      const rawWave = (wm[1] || '').toString().trim();
      const norm = normalizeWaveLabel('Gelombang ' + rawWave) || rawWave.toUpperCase();
      if (/dpp|dana pendidikan pokok|beasiswa untuk dana pendidikan pokok/i.test(w)) {
        if (amounts.length > 0) dppMap[norm] = 'Rp ' + amounts[0].replace(/\./g, '.');
      } else if (/pendaftaran|potongan biaya pendaftaran|potongan pendaftaran|mendaftar pada gelombang/i.test(w)) {
        if (amounts.length > 0) regMap[norm] = 'Rp ' + amounts[0].replace(/\./g, '.');
      } else {
        if (amounts.length === 1) {
          if (/pendaftaran|daftar|mendaftar/i.test(w)) regMap[norm] = 'Rp ' + amounts[0];
          else if (/dpp|dana pendidikan pokok/i.test(w)) dppMap[norm] = 'Rp ' + amounts[0];
          else regMap[norm] = 'Rp ' + amounts[0];
        } else if (amounts.length >= 2) {
          regMap[norm] = 'Rp ' + amounts[0];
          dppMap[norm] = 'Rp ' + amounts[1];
        }
      }
    } catch (e) {}
  }
}

console.log('\nFINAL regMap=', regMap);
console.log('FINAL dppMap=', dppMap);
