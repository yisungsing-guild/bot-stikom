const fs = require('fs');
const path = require('path');
const root = process.cwd();
const srcPath = path.join(root, 'src', 'engine', 'ragEngine.js');
const src = fs.readFileSync(srcPath, 'utf8');
const searchStart = "const topSemantic = (top";
const start = src.indexOf(searchStart);
if (start === -1) {
  console.error('start not found');
  process.exit(1);
}
const catchIndex = src.indexOf('} catch (e) {', start);
if (catchIndex === -1) {
  console.error('catch not found');
  process.exit(1);
}
const endIndex = src.indexOf('}', catchIndex + 1);
if (endIndex === -1) {
  console.error('end not found');
  process.exit(1);
}
const beforeSrc = src.slice(0, start) + "const confidenceScoreTop = (top && top[0] && typeof top[0].score === 'number') ? top[0].score : topScoreAll;\r\n" + src.slice(endIndex + 1);
const beforePath = path.join(root, 'src', 'engine', 'temp_ragEngine_before.js');
fs.writeFileSync(beforePath, beforeSrc, 'utf8');

const afterRag = require('./src/engine/ragEngine.js');
const beforeRag = require('./src/engine/temp_ragEngine_before.js');

const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?',
  'Apa keunggulan Sistem Informasi?'
];

const summarize = (res) => {
  const top = Array.isArray(res.contexts) && res.contexts[0] ? res.contexts[0] : null;
  return {
    source: res.source,
    confidenceScore: res.confidenceScore,
    contexts: (res.contexts || []).length,
    topChunkId: top && top.id ? top.id : null,
    topChunkScore: top && typeof top.score === 'number' ? top.score : null,
    topChunkCompositeScore: top && typeof top.compositeScore === 'number' ? top.compositeScore : null,
    topChunkTrainingId: top && top.trainingId ? top.trainingId : null,
    topChunkFilename: top && top.filename ? top.filename : null
  };
};

(async () => {
  const results = [];
  for (const question of queries) {
    const afterRes = await afterRag.query(question, 8, { returnDebug: true });
    const beforeRes = await beforeRag.query(question, 8, { returnDebug: true });
    results.push({
      question,
      after: summarize(afterRes),
      before: summarize(beforeRes)
    });
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
