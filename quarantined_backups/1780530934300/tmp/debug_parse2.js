const fs = require('fs');
const path = require('path');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'rag_index.json'), 'utf8'));
const item = idx.find(row => String(row.filename || '').includes('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf') && String(row.chunk || '').includes('250.000'));
if (!item) {
  console.log('NO ITEM');
  process.exit(0);
}
const normalizeWaveLabel = (value) => {
  const text = String(value || '').toUpperCase().trim();
  if (!text) return null;
  if (text.includes('KHUSUS')) return 'KHUSUS';
  const romanMatch = /^([IVX]+|[0-9]{1,2})([A-C])?$/.exec(text);
  if (!romanMatch) return null;
  const token = romanMatch[1];
  const arabicToRoman = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV', '5': 'V', '6': 'VI', '7': 'VII', '8': 'VIII', '9': 'IX', '10': 'X' };
  return arabicToRoman[token] || token;
};
const normalizeWaveGroup = (value) => {
  if (!value) return null;
  const text = String(value).toUpperCase().trim();
  if (text === 'KHUSUS') return 'KHUSUS';
  const m = /^([0-9]+)/.exec(text);
  if (m) return m[1];
  const romanToArabic = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10' };
  return romanToArabic[text] || null;
};
const requestedWaveGroup = '1';
const queryWaveLabel = '1A';
const pickBest = (items) => items.slice().sort((a, b) => parseInt(b.amount.replace(/\D/g, ''), 10) - parseInt(a.amount.replace(/\D/g, ''), 10))[0];
const regPairs = [];
for (const match of item.chunk.matchAll(/Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
  const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
  if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[3]}` });
}
for (const match of item.chunk.matchAll(/Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
  const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
  if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[1]}` });
}
console.log('regPairs', regPairs);
const byGroup = regPairs.filter(pair => normalizeWaveGroup(pair.waveLabel) === requestedWaveGroup);
console.log('byGroup', byGroup);
console.log('best', pickBest(byGroup));
