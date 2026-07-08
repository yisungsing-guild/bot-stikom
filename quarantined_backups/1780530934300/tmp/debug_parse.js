const fs = require('fs');
const path = require('path');
const idx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'rag_index.json'), 'utf8'));
const items = idx.filter(item => String(item.filename || '').includes('rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf') && String(item.chunk || '').includes('Potongan Biaya Pendaftaran'));
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
const chooseWavePair = (pairs) => {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const byLabel = queryWaveLabel ? pairs.filter(pair => pair.waveLabel === queryWaveLabel) : [];
  const byGroup = requestedWaveGroup ? pairs.filter(pair => normalizeWaveGroup(pair.waveLabel) === requestedWaveGroup) : [];
  const pickBest = (items) => {
    if (!items || items.length === 0) return null;
    return items.slice().sort((a, b) => {
      const aValue = parseInt(String(a.amount || '').replace(/\D/g, ''), 10) || 0;
      const bValue = parseInt(String(b.amount || '').replace(/\D/g, ''), 10) || 0;
      return bValue - aValue;
    })[0];
  };
  const bestLabel = pickBest(byLabel);
  if (bestLabel) return bestLabel.amount;
  const bestGroup = pickBest(byGroup);
  if (bestGroup) return bestGroup.amount;
  return pickBest(pairs)?.amount || pairs[0].amount;
};
for (const [i, item] of items.entries()) {
  const chunk = String(item.chunk || '');
  const normalized = chunk;
  const regPairs = [];
  for (const match of normalized.matchAll(/(?:potongan\s+(?:biaya\s+)?pendaftaran|diskon\s+(?:pendaftaran|biaya\s+pendaftaran))[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})/gi)) {
    const waveLabel = normalizeWaveLabel(`${match[1] || ''}${match[2] || ''}`);
    if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[3]}` });
  }
  for (const match of normalized.matchAll(/(?:potongan\s+(?:biaya\s+)?pendaftaran|diskon\s+(?:pendaftaran|biaya\s+pendaftaran))[^\n]{0,120}?Rp\.?\s*([0-9][0-9\s\.,]{1,40})[^\n]{0,120}?Gelombang\s*(Khusus|IV|III|II|I|[0-9]{1,2})(?:\s*([A-C]))?/gi)) {
    const waveLabel = normalizeWaveLabel(`${match[2] || ''}${match[3] || ''}`);
    if (waveLabel) regPairs.push({ waveLabel, amount: `Rp ${match[1]}` });
  }
  console.log('--- chunk', i, 'pairs', regPairs);
  console.log('chosen', chooseWavePair(regPairs));
}
const path = require('path');
const engine = require(path.join(__dirname, '..', 'src', 'engine', 'ragEngine'));
const item = {
  chunk: 'PROGRAM STUDI SISTEM KOMPUTER TA 2025/2026 Gelombang 1A\nPendaftaran 500.000\nDana Pendidikan Pokok (DPP) 11.000.000',
  filename: 'PMB_2025_SK.pdf',
  updatedAt: new Date().toISOString(),
  source: 'upload',
  embedding: Array(64).fill(0)
};
const q = 'berapa biaya prodi sk gelombang 1A?';
const qe = { intent: 'COST', program: 'SK', wave: '1A', waveGroup: '1', academicYear: '2025', campus: 'BALI' };
console.log('entities:', engine.getChunkEntities(item));
console.log('parsed:', engine.parseFeeStructureFromChunk(item, qe));
console.log('feeStruct:', engine.parseFeeStructure([item], qe));
console.log('exactEntityMismatch:', engine.isExactEntityMismatch(qe, engine.getChunkEntities(item), item.chunk));
