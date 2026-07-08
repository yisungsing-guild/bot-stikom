const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const sourcePath = path.join(root, 'src', 'engine', 'ragEngine.js');
const beforePath = path.join(root, 'temp_ragEngine_before.js');
const data = fs.readFileSync(sourcePath, 'utf8');

const oldBlock = `const topSemantic = (top && top[0] && typeof top[0].score === 'number') ? top[0].score : topScoreAll;`;
const newBlock = `const confidenceScoreTop = (top && top[0] && typeof top[0].score === 'number') ? top[0].score : topScoreAll;`;

const regex = new RegExp(`const topSemantic = \(top && top\[0\] && typeof top\[0\]\.score === 'number'\) \? top\[0\]\.score : topScoreAll;[\r\n]+const topCompositeRaw = \(top && top\[0\] && typeof top\[0\]\.compositeScore === 'number'\) \? top\[0\]\.compositeScore : null;[\s\S]*?catch \(e\) \{[\r\n]+\s*confidenceScoreTop = topSemantic;[\r\n]+\s*\}`);
if (!regex.test(data)) {
  console.error('Patch block not found; cannot create before-patch copy.');
  process.exit(1);
}

const beforeData = data.replace(regex, `${newBlock}\n`);
fs.writeFileSync(beforePath, beforeData, 'utf8');
console.log('Created before-patch copy at', beforePath);

const makeModule = (modulePath) => {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
};

const after = makeModule(sourcePath);
const before = makeModule(beforePath);

const queries = [
  'Apa itu Sistem Informasi?',
  'Apa prospek kerja Sistem Informasi?',
  'Apa yang dipelajari di Sistem Informasi?',
  'Apa keunggulan Sistem Informasi?'
];

const run = async () => {
  const results = [];
  for (const q of queries) {
    const afterRes = await after.query(q, 8, { returnDebug: true });
    const beforeRes = await before.query(q, 8, { returnDebug: true });
    results.push({ question: q, after: afterRes, before: beforeRes });
  }
  console.log(JSON.stringify(results, null, 2));
};

run().catch(err => {
  console.error(err);
  process.exit(1);
});
