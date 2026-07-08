const fs = require('fs');
const path = require('path');
const q = process.argv[2] || 'berapa potongan gelombang I?';
const backupPath = path.join(__dirname, '..', 'backups', 'backup-20260424-145106', 'trainingData.json');
if (!fs.existsSync(backupPath)) { console.log('MISSING BACKUP'); process.exit(0); }
const raw = fs.readFileSync(backupPath,'utf8');
const j = JSON.parse(raw);
const scanText = Array.isArray(j.rows) ? j.rows.map(r => r.content || '').join('\n') : '';
function normalizeWave(value){ const upper=String(value||'').toUpperCase().trim(); if(!upper) return null; if(upper.includes('KHUSUS')) return 'Khusus'; const base=/^((?:IV|III|II|I)|[1-9][0-9]?)(?:\s*[A-C])?$/.exec(upper); if(!base) return null; const token=base[1]; const arabicToRoman={'1':'I','2':'II','3':'III','4':'IV','5':'V','6':'VI','7':'VII','8':'VIII','9':'IX','10':'X'}; return arabicToRoman[token] || token; }

const registrationSection = scanText.match(/Potongan\s*Biaya\s*Pendaftaran[\s\S]{0,900}?((?=Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok)|(?=Khusus\s+Alumni|4\.)|$)/i);
const dppSection = scanText.match(/Beasiswa\s*untuk\s*Dana\s*Pendidikan\s*Pokok[\s\S]{0,900}?((?=Khusus\s+Alumni|4\.)|$)/i);
const regText = registrationSection ? registrationSection[0] : '';
const dppText = dppSection ? dppSection[0] : '';
const regMap = new Map();
const dppMap = new Map();
if (regText){ for (const match of regText.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)[\s\S]{0,80}?Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?/gi)){ const waveLabel = normalizeWave(match[2]); if (waveLabel) regMap.set(waveLabel, `Rp ${match[1]}`); } }
if (dppText){ for (const match of dppText.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*[A-C])?[\s\S]{0,80}?Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)){ const waveLabel = normalizeWave(match[1]); if (waveLabel) dppMap.set(waveLabel, `Rp ${match[2]}`); } }
// window scan
if (regMap.size === 0 || dppMap.size === 0){ const linesSrc = scanText.replace(/\r/g,'').split('\n'); for (let i=0;i<linesSrc.length;i++){ const window=[linesSrc[i], linesSrc[i+1]||'', linesSrc[i+2]||''].join(' ').replace(/\s+/g,' ').trim(); if(!window) continue; if(!/(rp|potongan|gelombang|pendaftaran|dpp|dana pendidikan pokok|beasiswa)/i.test(window)) continue; const amountMatches = Array.from(window.matchAll(/Rp\.?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/gi)); const waveMatches = Array.from(window.matchAll(/Gelombang\s*(Khusus|IV|III|II|I)(?:\s*([A-C]))?/gi)); if (amountMatches.length === 0 || waveMatches.length === 0) continue; const isReg = /pendaftaran|potongan biaya pendaftaran|mendaftar/i.test(window); const isDpp = /dpp|dana pendidikan pokok|beasiswa/i.test(window); for (const waveMatch of waveMatches){ const waveLabel = normalizeWave(waveMatch[1]); const amount = `Rp ${amountMatches[0][1]}`; if (isReg && waveLabel && !regMap.has(waveLabel)) regMap.set(waveLabel, amount); if (isDpp && waveLabel && !dppMap.has(waveLabel)) dppMap.set(waveLabel, amount); } } }

if (regMap.size ===0 && dppMap.size===0){ console.log('no entries extracted'); process.exit(0);} 

const lines=[];
const pushTarget=(label)=>{ if (regMap.has(label)) lines.push(`- ${regMap.get(label)} jika mendaftar pada ${label==='Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`); if (dppMap.has(label)) lines.push(`- ${dppMap.get(label)} untuk DPP pada ${label==='Khusus' ? 'Gelombang Khusus' : `Gelombang ${label}`}`); };
let requestedWave=null; if (/gelombang\s*([a-z0-9ivx]+)(?:\s*([a-c]))?/i.exec(q)){ requestedWave = (RegExp.$1||'')+ (RegExp.$2||''); }
if (requestedWave){ pushTarget(requestedWave); if (lines.length===0){ for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label); } } else { for (const label of Array.from(new Set([...regMap.keys(), ...dppMap.keys()]))) pushTarget(label); }
if (lines.length===0){ console.log('no lines to report'); process.exit(0); }
const answer = `Potongan biaya pendaftaran yang tersedia adalah:\n\n${lines.join('\n')}\n\nUntuk informasi lain di luar daftar di atas, silakan konfirmasi ke admin kampus untuk kepastian.`;
console.log('ANSWER:\n',answer);
console.log('contexts count', (regText?1:0)+(dppText?1:0));
