const fs = require('fs');

const summary = JSON.parse(fs.readFileSync('debug_summary.json', 'utf8'));

console.log('\n=== DETAILED PARSE AUDIT REPORT ===\n');

for (let i = 0; i < summary.length; i++) {
  const q = summary[i];
  console.log(`\n--- QUERY ${i + 1}: ${q.question.substring(0, 60)} ---`);
  
  // Extract query entities
  console.log(`Entity: ${q.queryEntities.split('\n')[0]}`);
  
  // Parse parse results
  const parseResults = q.parseResults || '';
  const hasDiscountOnly = parseResults.includes('[TRACE_PARSE_6b_DISCOUNT_ONLY_BASE]');
  const hasYearFallback = parseResults.includes('[TRACE_PARSE_6b_YEAR_FALLBACK]');
  const hasOnlyCost = parseResults.includes('[TRACE_PARSE_CHUNK_4_EXIT]') && parseResults.includes('only_discount_present');
  const noMoney = parseResults.includes('no_money_fields_found');
  
  console.log('Parse Issues Detected:');
  if (hasDiscountOnly) console.log('  ✗ Fallback to DISCOUNT_ONLY_BASE (no explicit cost candidates)');
  if (hasYearFallback) console.log('  ✗ Using YEAR_FALLBACK (academic year mismatch)');
  if (hasOnlyCost) console.log('  ✗ Only discount present, no fee or DPP');
  if (noMoney) console.log('  ✗ No money fields found in chunks');
  
  // Check source trust
  const trustStr = q.sourceTrust || '';
  const trustResults = trustStr.match(/chunkId: '([^']+)'/g) || [];
  console.log(`Trust: ${trustResults.length} trusted sources found`);
  
  // Check topChunks structure
  const topStr = q.topChunks || '';
  const chunkIds = topStr.match(/id: '([^']+)',/g) || [];
  console.log(`Top Chunks: ${chunkIds.length} chunks selected`);
  const hasBackup = topStr.includes('added-from-backup');
  console.log(`  Backup PDFs used: ${hasBackup ? 'YES' : 'NO'}`);
  
  // Try to extract parseChunkResults
  const parseInput = q.parseAllChunks || '';
  const inputCount = (parseInput.match(/inputChunksCount: (\d+)/g) || [])[0];
  console.log(`Input chunks to parser: ${inputCount}`);
  
  // Score indicators
  if (hasDiscountOnly || hasYearFallback) {
    console.log('⚠️  LIKELY CAUSE: Fallback parsing activated');
  } else if (noMoney) {
    console.log('⚠️  LIKELY CAUSE: No money fields extracted from chunks');
  }
}

console.log('\n=== SUMMARY ===');
const withFallback = summary.filter(q => (q.parseResults || '').includes('[TRACE_PARSE_6b_DISCOUNT_ONLY_BASE]')).length;
const withYearFallback = summary.filter(q => (q.parseResults || '').includes('[TRACE_PARSE_6b_YEAR_FALLBACK]')).length;

console.log(`Queries with DISCOUNT_ONLY_BASE fallback: ${withFallback}/${summary.length}`);
console.log(`Queries with YEAR_FALLBACK: ${withYearFallback}/${summary.length}`);
