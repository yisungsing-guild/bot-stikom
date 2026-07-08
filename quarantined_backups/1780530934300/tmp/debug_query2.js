const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const root = process.cwd();
const code = fs.readFileSync(path.join(root, 'src', 'engine', 'ragEngine.js'), 'utf8');
const wrap = `${code}\nmodule.exports = { tryStructuredExactCostAnswer, extractStructuredEntities, normalizeWaveLabel, normalizeWaveGroup, isGlobalWaveDiscountChunk, computeExactEntityMatchScore, getChunkKeywordScore, cosineSimilarity, computeEmbedding, getChunkEntities, parseFeeStructureFromChunk };`;
const requireFromFile = createRequire(path.join(root, 'src', 'engine', 'ragEngine.js'));
const sandbox = { module: { exports: {} }, exports: {}, require: requireFromFile, console, process, setTimeout, clearTimeout, Date, __dirname: path.join(root, 'src', 'engine'), __filename: path.join(root, 'src', 'engine', 'ragEngine.js') };
vm.createContext(sandbox);
vm.runInContext(wrap, sandbox);
const engine = sandbox.module.exports;
(async () => {
  const question = 'biaya prodi si gelombang 1A?';
  const queryEntities = engine.extractStructuredEntities(question);
  const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'rag_index.json'), 'utf8'));
  const qEmb = await engine.computeEmbedding(question);
  const scored = index.map(item => {
    const itemEntities = engine.getChunkEntities(item);
    const matchResult = engine.computeExactEntityMatchScore(queryEntities, itemEntities);
    const keywordScore = engine.getChunkKeywordScore(String(item.chunk||''), question) * 20;
    const semanticScore = engine.cosineSimilarity(qEmb, Array.isArray(item.embedding) ? item.embedding : [] ) * 10;
    const total = matchResult.score + keywordScore + semanticScore;
    return { item, total, matchResult, keywordScore, semanticScore, wave: itemEntities.wave, waveGroup: itemEntities.waveGroup };
  });
  scored.sort((a,b)=>b.total-a.total);
  console.log('top 20 items:');
  for (let i=0; i<20; i++) {
    const s = scored[i];
    if(!s) break;
    console.log(i+1, s.total.toFixed(2), s.matchResult, 'wave', s.wave, 'group', s.waveGroup, 'filename', s.item.filename);
  }
  const result = engine.tryStructuredExactCostAnswer(question, queryEntities, index, 3, qEmb);
  console.log('result:', result);
})();
