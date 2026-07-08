const fs = require('fs');
const rag = require('./src/engine/ragEngine');
const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && (args[0].startsWith('===') || args[0].startsWith('>>>') || args[0].startsWith('!!')) ) {
    originalLog(...args);
  }
};
const index = JSON.parse(fs.readFileSync('./data/rag_index.json', 'utf8'));
const q = 'berapa biaya prodi ti gelombang 2C?';
const qe = rag.extractStructuredEntities(q);
const candidates = [];
for (const item of index) {
  if (!item || typeof item !== 'object') continue;
  const itemEntities = rag.getChunkEntities(item);
  if (rag.isExactEntityMismatch(qe, itemEntities, item.chunk, item)) continue;
  const matchResult = rag.computeExactEntityMatchScore(qe, itemEntities);
  if (!matchResult || matchResult.rejected) continue;
  const isGlobalDiscount = rag.isGlobalWaveDiscountChunk(item.chunk);
  const keywordScore = rag.getChunkKeywordScore(item.chunk, q) * 20;
  const totalScore = matchResult.score + keywordScore;
  candidates.push({ item, itemEntities, matchResult, totalScore, isGlobalDiscount });
}
console.log('=== QUERY ===', q);
console.log('entities', qe);
console.log('>>> candidates', candidates.length);
for (const cand of candidates.slice(0, 20)) {
  const trust = rag.validateSourceTrust(cand.item);
  originalLog('!!!', cand.item.id, cand.item.filename, 'score', cand.totalScore, 'trust', trust, 'chunkPreview', String(cand.item.chunk||'').substring(0,80).replace(/\n/g,' '));
}
const res = rag.tryStructuredExactCostAnswer(q, qe, index, 5, Array(64).fill(0));
originalLog('=== RESULT ===', res && res.source, res && res.debug && res.debug.reason);
originalLog('answer', res && res.answer);
originalLog('feeStruct', res && res.debug && res.debug.feeStruct ? JSON.stringify(res.debug.feeStruct,null,2) : null);
