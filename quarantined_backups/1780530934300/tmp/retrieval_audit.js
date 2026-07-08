const fs = require('fs');
const path = require('path');
const vm = require('vm');

const enginePath = path.join(__dirname, '..', 'src', 'engine', 'ragEngine.js');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const sandbox = {
  require: (moduleName) => {
    if (typeof moduleName === 'string' && (moduleName.startsWith('./') || moduleName.startsWith('../'))) {
      return require(path.resolve(path.dirname(enginePath), moduleName));
    }
    return require(moduleName);
  },
  module: { exports: {} },
  exports: {},
  __dirname: path.dirname(enginePath),
  __filename: enginePath,
  process,
  console,
  Buffer,
  setTimeout,
  clearTimeout,
  setImmediate,
  clearImmediate,
  TextEncoder,
  TextDecoder,
};
vm.createContext(sandbox);
vm.runInContext(engineSource, sandbox, { filename: enginePath });

const engine = sandbox.module.exports;
const indexPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

function formatItem(item) {
  return {
    id: item.id || null,
    filename: item.filename || item.sourceFile || null,
    program: item.program || null,
    programAliases: Array.isArray(item.programAliases) ? item.programAliases : [],
    chunkType: item.chunkType || null,
    category: item.category || null,
  };
}

async function scoreQuery(question) {
  const currentUserQ = sandbox.extractCurrentUserQuestionText(question);
  const normalizedUserQ = sandbox.normalizeIndonesianQuestionText(currentUserQ);
  const queryForRetrieval = sandbox.normalizeQueryForRetrieval(normalizedUserQ);
  const queryEntities = sandbox.extractStructuredEntities(queryForRetrieval || normalizedUserQ || currentUserQ || question);
  const qText = queryForRetrieval || normalizedUserQ || currentUserQ || question;
  const qEmb = await sandbox.computeEmbedding(qText);
  const intent = sandbox.detectIntent(queryForRetrieval || normalizedUserQ);

  let scored = index.map((item) => {
    const semanticScore = sandbox.cosineSimilarity(qEmb, item.embedding);
    const compositeScore = sandbox.computeChunkCompositeScore(item, question, intent, semanticScore, queryEntities);
    return { item, score: semanticScore, compositeScore };
  });
  scored.sort((a, b) => b.compositeScore - a.compositeScore);
  const beforeRerank = scored.slice(0, 20).map((s, i) => ({ rank: i + 1, score: Number(s.score.toFixed(6)), compositeScore: Number(s.compositeScore.toFixed(6)), ...formatItem(s.item) }));

  sandbox.applyDuplicateChunkPenalty(scored);

  if (queryEntities && queryEntities.program) {
    try {
      const qProg = String(queryEntities.program || '').toLowerCase();
      const exactMatches = [];
      const mentions = [];
      const rest = [];
      for (const s of scored) {
        const itemEntities = sandbox.getChunkEntities(s.item) || {};
        const itemProg = itemEntities.program ? String(itemEntities.program).toLowerCase() : null;
        const fname = String((s.item && (s.item.filename || s.item.trainingId)) || '').toLowerCase();
        const chunkText = String(s.item && s.item.chunk || '').toLowerCase();
        const isOverviewFile = /\b(?:penjelasan\s+semua|semua\s+program|semua\s+prodi|penjelasan\s+prodi|overview\s+prodi)\b/.test(fname);
        const multiProg = (chunkText.match(/\b(?:sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|si|ti|bd|sk)\b/ig) || []).length >= 2;
        const isOverview = isOverviewFile || multiProg;
        const qProgEsc = qProg.replace(/[-\\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const progRegex = new RegExp(`\\b${qProgEsc}\\b`, 'i');
        const mentionsProgram = progRegex.test(chunkText) || progRegex.test(fname);

        if (itemProg && itemProg === qProg) {
          exactMatches.push(s);
          continue;
        }
        if (mentionsProgram && !isOverview) {
          mentions.push(s);
          continue;
        }
        rest.push(s);
      }
      scored = [...exactMatches, ...mentions, ...rest];
    } catch (e) {
      // ignore rerank errors
    }
  }

  const relevantScored = sandbox.filterRelevantChunks(question, scored, queryEntities);
  if (relevantScored.length > 0) {
    const topIds = new Set(relevantScored.slice(0, Math.max(8, 8)).map(s => s.item.id));
    const reRanked = scored.filter(s => topIds.has(s.item.id));
    if (reRanked.length > 0) {
      scored = reRanked;
    }
  }

  const afterRerank = scored.slice(0, 10).map((s, i) => ({ rank: i + 1, score: Number(s.score.toFixed(6)), compositeScore: Number(s.compositeScore.toFixed(6)), ...formatItem(s.item) }));

  return {
    query: question,
    queryForRetrieval,
    queryEntities,
    intent,
    beforeRerank,
    afterRerank,
  };
}

(async () => {
  const queries = ['apa itu SI', 'apa itu TI', 'apa itu BD', 'apa itu SK'];
  const results = [];
  for (const question of queries) {
    const res = await scoreQuery(question);
    results.push(res);
  }
  fs.writeFileSync(path.join(__dirname, 'retrieval_audit_output.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote tmp/retrieval_audit_output.json');
})();
