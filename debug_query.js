process.env.SUPPRESS_TRACE = 'true';
const fs = require('fs');
const path = require('path');
const { query, getChunkEntities, isExactEntityMismatch, computeExactEntityMatchScore, isGlobalWaveDiscountChunk } = require('./src/engine/ragEngine');
const DATA_DIR = path.join(__dirname, 'src', 'data');
const INDEX_PATH = path.join(DATA_DIR, 'rag_index.json');
const normalizeWaveLabel = (value) => {
  let text = String(value || '').toLowerCase();
  const m = /gelombang\s*(khusus|[0-9]+|[ivx]+)(?:\s*([a-c]))?/i.exec(text);
  if (!m) return null;
  const num = m[1].toUpperCase();
  const suffix = m[2] ? m[2].toUpperCase() : '';
  if (/^khusus$/i.test(num)) return 'KHUSUS';
  const romanMap = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10' };
  const normalized = romanMap[num] || num;
  return normalized + suffix;
};
const normalizeWaveGroup = (value) => {
  if (!value) return null;
  if (/^khusus$/i.test(value)) return 'KHUSUS';
  const numMatch = /^([1-9][0-9]?)/.exec(String(value));
  return numMatch ? numMatch[1] : null;
};
(async () => {
  const q = 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?';
  const res = await query(q);
  console.log('\n=== RESULT ===');
  console.log('Source:', res && res.source);
  console.log('Answer:', res && res.answer ? res.answer.substring(0, 400) : 'null');
  console.log('Full result:', JSON.stringify(res, null, 2).substring(0, 500));
})();
