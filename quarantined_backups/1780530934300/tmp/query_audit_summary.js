const fs = require('fs');
const path = require('path');
const Module = require('module');
const { classifyIntent } = require('../src/engine/intentClassifier');
const ragPath = path.resolve('./src/engine/ragEngine.js');
const source = fs.readFileSync(ragPath, 'utf8');
const m = new Module(ragPath, module);
m.filename = ragPath;
m.paths = Module._nodeModulePaths(path.dirname(ragPath));
Module._cache[ragPath] = m;
m._compile(source + '\nmodule.exports = { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent };', ragPath);
const { normalizeIndonesianQuestionText, normalizeQueryForRetrieval, detectIntent, extractAcademicIntent } = m.exports;
const qlog = path.join(__dirname, '..', 'rag-audit-logs', 'query-retrieval-2026-06-02.jsonl');
const flog = path.join(__dirname, '..', 'rag-audit-logs', 'filtering-decisions-2026-06-02.log');
const logs = fs.readFileSync(qlog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const decisions = fs.existsSync(flog) ? fs.readFileSync(flog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const reports = logs.map(log => {
  const question = log.question;
  const qNorm = normalizeIndonesianQuestionText(question);
  const queryForRetrieval = normalizeQueryForRetrieval(qNorm);
  const userIntent = classifyIntent(question);
  const detectIntentValue = detectIntent(question);
  const academicIntentValue = extractAcademicIntent(question);
  const decisionsForIntent = decisions.filter(d => String(d.intent).toUpperCase() === String(userIntent).toUpperCase());
  return {
    question,
    userIntent,
    detectIntent: detectIntentValue,
    academicIntent: academicIntentValue,
    normalizedQuestion: qNorm,
    queryForRetrieval,
    beforeFilteringCount: log.beforeFiltering.count,
    afterFilteringCount: log.afterFiltering.count,
    beforeFiltering: log.beforeFiltering.chunks.slice(0, 20).map(c => ({ rank: c.rank, chunkId: c.chunkId, filename: c.filename, docCategory: c.docCategory, score: c.score, compositeScore: c.compositeScore, preview: c.preview })),
    afterFiltering: log.afterFiltering.chunks.slice(0, 20).map(c => ({ rank: c.rank, chunkId: c.chunkId, filename: c.filename, docCategory: c.docCategory, score: c.score, compositeScore: c.compositeScore, preview: c.preview })),
    filterDecisions: decisionsForIntent.slice(0, 20).map(d => ({ chunkId: d.chunkId, sourceFile: d.sourceFile, docCategory: d.docCategory, decision: d.decision, reason: d.reason }))
  };
});
fs.writeFileSync(path.join(__dirname, 'query_audit_summary.json'), JSON.stringify(reports, null, 2), 'utf8');
console.log('summary written');
