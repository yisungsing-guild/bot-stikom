const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const root = process.cwd();
const code = fs.readFileSync(path.join(root, 'src', 'engine', 'ragEngine.js'), 'utf8');
const wrap = `${code}\nmodule.exports = { extractStructuredEntities, getChunkEntities, normalizeWaveGroup, getChunkKeywordScore, cosineSimilarity, computeEmbedding, tryStructuredEnrollmentDiscountAnswer, normalizeWaveLabel, parseFeeStructure, parseFeeStructureFromChunk};`;
const requireFromFile = createRequire(path.join(root, 'src', 'engine', 'ragEngine.js'));
const sandbox = { module: { exports: {} }, exports: {}, require: requireFromFile, console, process, setTimeout, clearTimeout, Date, __dirname: path.join(root, 'src', 'engine'), __filename: path.join(root, 'src', 'engine', 'ragEngine.js') };
vm.createContext(sandbox);
vm.runInContext(wrap, sandbox);
const engine = sandbox.module.exports;
(async ()=>{
  const question = 'biaya prodi si gelombang 1A?';
  const queryEntities = engine.extractStructuredEntities(question);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
  const qEmb = await engine.computeEmbedding(question);
  const fallbackChunks = [];
  for (const item of index) {
    if (!item || typeof item !== 'object') continue;
    const itemEntities = engine.getChunkEntities(item);
    if (queryEntities.program && itemEntities.program && queryEntities.program !== itemEntities.program) continue;
    const chunkText = String(item.chunk || '');
    if (!/\b(biaya|dpp|ukt|spp|pendaftaran|potongan|diskon|uang\s+kuliah|uang\s+pendaftaran)\b/i.test(chunkText)) continue;
    const keywordScore = engine.getChunkKeywordScore(chunkText, question) * 20;
    const semanticScore = qEmb && Array.isArray(item.embedding) ? engine.cosineSimilarity(qEmb, item.embedding) * 10 : 0;
    let totalScore = keywordScore + semanticScore;
    if (totalScore <= 0) totalScore = 1;
    if (queryEntities.wave && itemEntities.wave) {
      const qGroup = engine.normalizeWaveGroup(queryEntities.wave);
      const cGroup = engine.normalizeWaveGroup(itemEntities.wave);
      if (qGroup && cGroup && qGroup !== cGroup) continue;
    }
    fallbackChunks.push({ item, totalScore, keywordScore, semanticScore, itemEntities });
  }
  fallbackChunks.sort((a,b)=>b.totalScore-a.totalScore);
  console.log('fallbackChunks count', fallbackChunks.length);
  for (let i=0;i<Math.min(20,fallbackChunks.length);i++) {
    const c=fallbackChunks[i];
    console.log(i+1,c.totalScore.toFixed(2),c.itemEntities, 'filename', c.item.filename, 'chunkPreview', String(c.item.chunk||'').slice(0,120).replace(/\n/g,' '));
  }
  const topChunks = fallbackChunks.slice(0, Math.min(3,fallbackChunks.length)).map(c=>c.item);
  console.log('topChunks count', topChunks.length);
  const backup1 = engine.tryStructuredEnrollmentDiscountAnswer(question, topChunks);
  console.log('backup1 answer', backup1 && backup1.answer ? backup1.answer.slice(0,200) : null);
  const backup2 = engine.tryStructuredEnrollmentDiscountAnswer(question, null);
  console.log('backup2 answer', backup2 && backup2.answer ? backup2.answer.slice(0,200) : null);
})();
