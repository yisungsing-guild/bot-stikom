const fs = require('fs');
const path = require('path');
const backupPath = path.join(__dirname, '..', 'backups', 'backup-20260424-145106', 'trainingData.json');
if (!fs.existsSync(backupPath)) {
  console.log('MISSING BACKUP', backupPath);
  process.exit(0);
}
const raw = fs.readFileSync(backupPath, 'utf8');
let j = null;
try { j = JSON.parse(raw); } catch (e) { console.log('JSON parse error', e.message); process.exit(1); }
const text = Array.isArray(j.rows) ? j.rows.map(r => r.content || '').join('\n') : '';
console.log('textLen', text.length);
const reg = text.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
const dpp = text.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);
console.log('regFound', !!reg, 'dppFound', !!dpp);
if (reg) console.log('regSample:', reg[0].slice(0,400));
if (dpp) console.log('dppSample:', dpp[0].slice(0,400));

// try window scan counts
const lines = text.replace(/\r/g, '').split('\n');
let foundWindows = 0;
for (let i = 0; i < lines.length; i++) {
  const window = [lines[i], lines[i+1]||'', lines[i+2]||''].join(' ').replace(/\s+/g, ' ').trim();
  if (!window) continue;
  if (!/(rp|potongan|gelombang|pendaftaran|dpp|dana pendidikan pokok|beasiswa)/i.test(window)) continue;
  const amountMatches = Array.from(window.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi));
  const waveMatches = Array.from(window.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*([A-C]))?/gi));
  if (amountMatches.length && waveMatches.length) foundWindows++;
}
console.log('foundWindows', foundWindows);
