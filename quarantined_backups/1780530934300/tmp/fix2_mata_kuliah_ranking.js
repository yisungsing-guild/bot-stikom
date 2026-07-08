/**
 * FIX 2: IMPROVE RETRIEVAL RANKING FOR MATA_KULIAH QUERIES
 * 
 * When academic intent is 'MATA_KULIAH', boost KURIKULUM chunks
 * to rank higher than DEFINISI_PRODI chunks.
 * 
 * This patch modifies getChunkScoreBreakdown to give a category signal boost
 * when:
 * - Academic intent = 'MATA_KULIAH'  
 * - Chunk category = 'KURIKULUM'
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(80));
console.log('FIX 2: IMPROVE RETRIEVAL RANKING FOR MATA_KULIAH QUERIES');
console.log('='.repeat(80));
console.log();

// Read ragEngine.js
const enginePath = path.join(__dirname, '../src/engine/ragEngine.js');
const engineCode = fs.readFileSync(enginePath, 'utf8');

// Find the getChunkScoreBreakdown function and the section where categorySignal is applied
// We need to boost KURIKULUM category when academic intent is MATA_KULIAH

// Look for the categorySignal section
if (!engineCode.includes('categorySignal')) {
  console.log('⚠️  Could not find categorySignal in ragEngine.js');
  console.log('    This function might have been moved or renamed.');
  process.exit(1);
}

console.log('✓ Found categorySignal implementation in ragEngine.js');
console.log();

// Check if the fix is already applied
if (engineCode.includes('MATA_KULIAH.*categoryBoost|kurikulum.*boost.*mata.?kuliah|intentMataKuliah')) {
  console.log('⚠️  MATA_KULIAH ranking boost may already be applied');
  console.log('    Verify manually in src/engine/ragEngine.js');
  process.exit(0);
}

console.log('📝 RECOMMENDED PATCH LOCATIONS:');
console.log('-'.repeat(80));
console.log();

console.log('LOCATION 1: In getChunkScoreBreakdown() function');
console.log('  Search for: "const categorySignal"');
console.log('  Add after category signal logic:');
console.log();
console.log(`    // Boost KURIKULUM chunks for MATA_KULIAH queries
    if (intent && String(intent).toUpperCase() === 'MATA_KULIAH' && 
        itemCategory && String(itemCategory).toUpperCase() === 'KURIKULUM') {
      // Strong boost for curriculum chunks when asking about courses
      categorySignal += 0.3;
      mataKuliahBoost = 0.3;
    }`);
console.log();

console.log('LOCATION 2: Verify composite score calculation includes categorySignal');
console.log('  Search for: "compositeScore = " or "finalScore = "');
console.log('  Make sure categorySignal is included in the calculation');
console.log();

console.log('='.repeat(80));
console.log('ALTERNATIVE: MODIFY SCORING FUNCTION');
console.log('='.repeat(80));
console.log();

console.log('Instead of modifying getChunkScoreBreakdown, we can inject a');
console.log('ranking adjustment in the main query handler (ragQueryWithEval function):');
console.log();
console.log(`  // After scoring, boost KURIKULUM chunks if MATA_KULIAH intent
  if (academicIntent && String(academicIntent).toUpperCase() === 'MATA_KULIAH') {
    scored = scored.map(candidate => {
      const cat = String(candidate.item.category || '').toUpperCase();
      if (cat === 'KURIKULUM') {
        // Increase composite score for KURIKULUM chunks
        candidate.compositeScore *= 1.25; // 25% boost
        candidate.finalScore *= 1.25;
      }
      return candidate;
    });
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
  }`);

console.log();
console.log('='.repeat(80));
console.log('IMPLEMENTATION STATUS');
console.log('='.repeat(80));
console.log();

console.log('✓ Recommended fix locations identified');
console.log('⏳ Next step: Manually apply patch to ragEngine.js');
console.log();
console.log('Patch application:');
console.log('1. Open src/engine/ragEngine.js');
console.log('2. Find getChunkScoreBreakdown() function');
console.log('3. Locate where categorySignal is calculated');
console.log('4. Add MATA_KULIAH boost logic');
console.log('5. Test with queries: "Mata kuliah Sistem Komputer"');
console.log();
