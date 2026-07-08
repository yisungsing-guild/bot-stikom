const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.tmp_retrieval_results.json', 'utf8'));
for (const q of data) {
  console.log('='.repeat(120));
  console.log('QUESTION:', q.question);
  console.log('INTENT:', q.intent, '| USER INTENT:', q.userIntent);
  console.log('QUERY ENTITIES:', JSON.stringify(q.queryEntities));
  console.log('TOP 10 CHUNKS:');
  q.top20.slice(0, 10).forEach((entry, idx) => {
    const item = entry.item || {};
    const filename = entry.filename || item.filename || item.trainingId || 'unknown';
    const docCategory = entry.docCategory || item.docCategory || item.category || 'NONE';
    const program = entry.program || item.program || item.programName || 'N/A';
    const scoreComponents = entry.scoreComponents || {};
    console.log(`${idx + 1}. id=${item.id || 'unknown'} | doc=${filename} | category=${docCategory} | program=${program}`);
    console.log(`   semanticScore=${Number(entry.semanticScore || 0).toFixed(4)} | keywordScore=${Number(entry.keywordScore || 0).toFixed(4)} | evidenceScore=${Number(entry.evidenceScore || 0).toFixed(4)} | compositeScore=${Number(entry.compositeScore || 0).toFixed(4)} | finalScore=${Number(entry.finalScore || 0).toFixed(4)}`);
    console.log(`   scoreComponents: ${Object.entries(scoreComponents).map(([k,v]) => `${k}=${Number(v||0).toFixed(4)}`).join(', ')}`);
  });
  console.log('REL evant count after filterRelevantChunks:', q.relevantCount, '| validated count:', q.validatedCount, '| final count:', q.finalCount);
  console.log('REJECTED TRACE SAMPLE:', JSON.stringify(q.rejected.slice(0, 5), null, 2));
}
