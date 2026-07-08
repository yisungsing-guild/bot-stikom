const fs = require('fs');
const data = JSON.parse(fs.readFileSync('run_queries_results.json', 'utf8'));
for (const item of data) {
  const q = item.query;
  const res = item.result || item;
  const contexts = res.contexts || [];
  const found = [];
  for (const c of contexts) {
    const chunk = c.chunk || c.rawChunk || '';
    if (chunk.includes('300.000')) {
      found.push({ id: c.id, filename: c.filename, trainingId: c.trainingId, chunk });
    }
  }
  if (found.length) {
    console.log('QUERY:', q);
    for (const c of found) {
      console.log('CHUNK ID:', c.id);
      console.log('FILENAME:', c.filename);
      console.log('TRAININGID:', c.trainingId);
      console.log('TEXT SNIPPET:', c.chunk.split('\n').filter(l => l.includes('300.000')).join(' | '));
      console.log('---');
    }
  }
}
