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

const after = require('./src/engine/ragEngine.js');
const before = require('./src/engine/temp_ragEngine_before.js');
const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?',
  'Apa keunggulan Sistem Informasi?'
];

(async () => {
  const results = [];
  for (const question of queries) {
    const afterRes = await after.query(question, 8, { returnDebug: true });
    const beforeRes = await before.query(question, 8, { returnDebug: true });
    results.push({
      question,
      after: {
        source: afterRes.source,
        confidenceScore: afterRes.confidenceScore,
        contexts: (afterRes.contexts || []).length,
        top: afterRes.debug && afterRes.debug.top ? afterRes.debug.top : null,
        debugSource: afterRes.source,
        finalScore: afterRes.finalScore || null
      },
      before: {
        source: beforeRes.source,
        confidenceScore: beforeRes.confidenceScore,
        contexts: (beforeRes.contexts || []).length,
        top: beforeRes.debug && beforeRes.debug.top ? beforeRes.debug.top : null,
        debugSource: beforeRes.source,
        finalScore: beforeRes.finalScore || null
      }
    });
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
