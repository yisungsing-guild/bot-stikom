const fs = require('fs');
const path = require('path');

// Load audit results
const results = JSON.parse(fs.readFileSync('.tmp_retrieval_results.json', 'utf8'));

console.log('='.repeat(120));
console.log('SI CHUNK CANDIDATE ANALYSIS');
console.log('='.repeat(120));

for (let queryIdx = 0; queryIdx < results.length; queryIdx++) {
  const r = results[queryIdx];
  const question = r.question || 'N/A';
  const intent = r.intent || 'N/A';
  const userIntent = r.userIntent || 'N/A';
  
  console.log(`\n${'='.repeat(120)}`);
  console.log(`QUERY ${queryIdx + 1}: ${question}`);
  console.log(`Intent: ${intent} | UserIntent: ${userIntent}`);
  console.log(`${'='.repeat(120)}`);
  
  const top20 = r.top20 || [];
  const relevantIds = new Set((r.relevantIds || []).map(item => item.id));
  
  // Extract SI candidates from top 20
  const siCandidates = [];
  
  for (let rank = 0; rank < top20.length; rank++) {
    const scoredItem = top20[rank];
    const item = scoredItem.item || {};
    const itemId = item.id || 'unknown';
    const filename = item.filename || item.trainingId || 'unknown';
    const program = item.program || item.programName || 'N/A';
    const docCategory = scoredItem.docCategory || item.docCategory || 'N/A';
    
    // Skip non-SI programs
    if (String(program).toUpperCase() !== 'SI') {
      continue;
    }
    
    // Skip Double Degree
    if (filename.toLowerCase().includes('double') || String(item.chunk || '').toLowerCase().includes('double')) {
      continue;
    }
    
    // This is a valid SI candidate
    const semanticScore = scoredItem.score || 0;
    const compositeScore = scoredItem.compositeScore || 0;
    const finalScore = scoredItem.finalScore || 0;
    
    // Check if passed filterRelevantChunks
    const passedFilter = relevantIds.has(itemId);
    
    siCandidates.push({
      rank: rank + 1,
      id: itemId,
      filename: filename,
      category: docCategory,
      semanticScore: semanticScore,
      compositeScore: compositeScore,
      finalScore: finalScore,
      passedFilter: passedFilter,
      chunkPreview: String(item.chunk || '').substring(0, 150)
    });
  }
  
  if (siCandidates.length === 0) {
    console.log('\n[NONE] NO SI CANDIDATES found in top 20 (excluding Double Degree)');
    console.log('\nTop 5 program distribution:');
    for (let i = 0; i < Math.min(5, top20.length); i++) {
      const scoredItem = top20[i];
      const item = scoredItem.item || {};
      const filename = item.filename || item.trainingId || 'unknown';
      const program = item.program || item.programName || 'N/A';
      const docCategory = scoredItem.docCategory || item.docCategory || 'N/A';
      const compositeScore = scoredItem.compositeScore || 0;
      console.log(`  ${i+1}. ${filename.substring(0, 50).padEnd(50)} | program=${program} | category=${docCategory} | composite=${compositeScore.toFixed(4)}`);
    }
  } else {
    console.log(`\n[YES] Found ${siCandidates.length} SI candidates in top 20:`);
    console.log();
    
    // Show best SI candidate
    const bestSI = siCandidates[0];
    console.log('>>> BEST SI CANDIDATE <<<');
    console.log(`  Rank #${bestSI.rank} | [${bestSI.passedFilter ? 'PASSED' : 'REJECTED'}] filterRelevantChunks`);
    console.log(`    ID: ${bestSI.id}`);
    console.log(`    Filename: ${bestSI.filename}`);
    console.log(`    Category: ${bestSI.category}`);
    console.log(`    Semantic Score: ${bestSI.semanticScore.toFixed(4)}`);
    console.log(`    Composite Score: ${bestSI.compositeScore.toFixed(4)}`);
    console.log(`    Chunk Preview: ${bestSI.chunkPreview}`);
    console.log();
    
    // Show all SI candidates summary
    console.log('All SI candidates:');
    for (const cand of siCandidates) {
      const status = cand.passedFilter ? 'PASSED' : 'REJECTED';
      console.log(`  #${cand.rank.toString().padStart(2)} [${status}] composite=${cand.compositeScore.toFixed(4)} | ${cand.filename.substring(0, 40)}`);
    }
  }
  
  // Summary statistics
  console.log(`\nSUMMARY:`);
  console.log(`  - Top 20 count: ${top20.length}`);
  console.log(`  - SI candidates (excluding DD): ${siCandidates.length}`);
  console.log(`  - SI candidates PASSED filter: ${siCandidates.filter(c => c.passedFilter).length}`);
  console.log(`  - SI candidates REJECTED: ${siCandidates.filter(c => !c.passedFilter).length}`);
  console.log(`  - Relevant IDs after filter: ${relevantIds.size}`);
  
  // Show what passed the filter
  if (relevantIds.size > 0) {
    console.log(`\n  [INFO] Chunks that PASSED filterRelevantChunks:`);
    for (const item of (r.relevantIds || [])) {
      console.log(`    - ${item.filename.substring(0, 50).padEnd(50)} | category=${item.docCategory} | composite=${parseFloat(item.compositeScore).toFixed(4)}`);
    }
  }
}

console.log('\n' + '='.repeat(120));
console.log('END OF ANALYSIS');
console.log('='.repeat(120));
