const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, 'src', 'engine', 'ragEngine.js');
const code = fs.readFileSync(filePath, 'utf8');
const wrapper = `(function(exports, require, module, __filename, __dirname){\n${code}\nmodule.exports.__internal = { loadIndex, getChunkScoreBreakdown, filterRelevantChunks, tryStructuredExactCostAnswer, tryStructuredFeeBreakdownAnswer, extractStructuredEntities, computeEmbedding, normalizeQueryForRetrieval, extractCurrentUserQuestionText, classifyIntent, detectIntent, tokenizeForRelevanceGuard, getChunkEntities, scoreSourceTrust };\n});`;
const script = new vm.Script(wrapper, { filename: filePath });
const _module = { exports: {} };
const requireForRag = require('module').createRequire(filePath);
const fn = script.runInThisContext();
fn(_module.exports, requireForRag, _module, filePath, path.dirname(filePath));
const rag = _module.exports.__internal;

const queries = [
  'berapa biaya TI gelombang 1A',
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya SK gelombang 1A',
  'berapa biaya MI',
  'berapa biaya S2 SI',
  'berapa biaya DNUI',
  'berapa biaya HELP',
  'berapa biaya UTB'
];

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] || 0) * (b[i] || 0);
    normA += (a[i] || 0) ** 2;
    normB += (b[i] || 0) ** 2;
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

function pretty(item) {
  return {
    id: item.id,
    filename: item.filename,
    trainingId: item.trainingId,
    docCategory: item.docCategory || item.category,
    chunkType: item.chunkType,
    score: item.score,
    compositeScore: item.compositeScore,
    finalScore: item.finalScore,
    semanticScore: item.semanticScore,
    chunkPreview: (item.chunk || '').substring(0, 100).replace(/\s+/g, ' ').trim()
  };
}

async function main() {
  const results = [];
  for (const query of queries) {
    const normalized = rag.normalizeQueryForRetrieval(query);
    const queryEntities = rag.extractStructuredEntities(query);
    const index = rag.loadIndex();
    const qEmb = await rag.computeEmbedding(normalized);
    const intent = rag.detectIntent(normalized);
    const scored = index.map(item => {
      const semanticScore = Array.isArray(item.embedding) ? cosineSimilarity(qEmb, item.embedding) : 0;
      let breakdown = null;
      try {
        breakdown = rag.getChunkScoreBreakdown(item, query, intent, semanticScore, queryEntities);
      } catch (e) {
        breakdown = { compositeScore: 0, finalScore: 0 };
      }
      return {
        item,
        score: semanticScore,
        compositeScore: breakdown.compositeScore,
        finalScore: breakdown.finalScore,
        semanticScore,
        breakdown
      };
    });
    scored.sort((a,b) => b.compositeScore - a.compositeScore);
    const top10 = scored.slice(0, 10).map(s => pretty(Object.assign({}, s.item, s)));
    let exactCostResult = null;
    try {
      exactCostResult = rag.tryStructuredExactCostAnswer(query, queryEntities, index, 5, qEmb);
    } catch (e) {
      exactCostResult = { error: e.message };
    }
    let feeBreakdownResult = null;
    try {
      feeBreakdownResult = rag.tryStructuredFeeBreakdownAnswer(query, null, {});
    } catch (e) {
      feeBreakdownResult = { error: e.message };
    }
    results.push({
      query,
      normalized,
      queryEntities,
      intent,
      exactCostResult: exactCostResult && exactCostResult.answer ? { source: exactCostResult.source, answer: exactCostResult.answer, contexts: exactCostResult.contexts ? exactCostResult.contexts.map(c => ({ filename: c.filename, id: c.id, trainingId: c.trainingId, chunkType: c.chunkType, chunkPreview: (c.chunk||'').substring(0,80).replace(/\s+/g,' ').trim() })) : null, debug: exactCostResult.debug } : exactCostResult,
      feeBreakdownResult: feeBreakdownResult && feeBreakdownResult.answer ? { source: feeBreakdownResult.source, answer: feeBreakdownResult.answer } : feeBreakdownResult,
      top10
    });
  }
  fs.writeFileSync(path.join(__dirname, 'tmp_retrieval_diagnostics.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('done');
}

main().catch(err => { console.error(err); process.exit(1); });
