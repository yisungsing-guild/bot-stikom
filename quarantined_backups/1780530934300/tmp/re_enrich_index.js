/**
 * TASK 1 PART 2: RE-ENRICH INDEX WITH MISSING METADATA
 * 
 * The current index is missing:
 * - program field (TI, SI, SK, MI, etc.)
 * - filename field
 * - programAliases field
 * - wave, academicYear, and other structured metadata
 * 
 * This script enriches ALL chunks with missing metadata by:
 * 1. Calling extractStructuredChunkMetadata() for each chunk's text
 * 2. Preserving existing fields
 * 3. Adding missing fields
 * 4. Saving enriched index back
 */

const fs = require('fs');
const path = require('path');

// Import RAG engine functions
const ragEngine = require('../src/engine/ragEngine.js');

function enrichIndexWithMetadata() {
  const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
  
  console.log('='.repeat(80));
  console.log('TASK 1 PART 2: RE-ENRICH INDEX WITH MISSING METADATA');
  console.log('='.repeat(80));
  console.log();
  
  // Load index
  console.log('📂 Loading index from:', indexPath);
  let index;
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    index = JSON.parse(raw);
    if (!Array.isArray(index)) {
      console.error('❌ Index is not an array');
      return;
    }
  } catch (e) {
    console.error('❌ Failed to load index:', e.message);
    return;
  }
  
  console.log(`✓ Loaded ${index.length} chunks`);
  console.log();
  
  // Count chunks by current metadata state
  const stats = {
    total: index.length,
    hasProgram: 0,
    hasFilename: 0,
    hasProgramAliases: 0,
    missingProgram: 0,
    missingFilename: 0,
    missingProgramAliases: 0,
  };
  
  index.forEach(chunk => {
    if (chunk.program) stats.hasProgram++;
    else stats.missingProgram++;
    
    if (chunk.filename) stats.hasFilename++;
    else stats.missingFilename++;
    
    if (chunk.programAliases) stats.hasProgramAliases++;
    else stats.missingProgramAliases++;
  });
  
  console.log('📊 CURRENT METADATA STATE:');
  console.log(`  - Chunks with program field:        ${stats.hasProgram}/${stats.total} (${(stats.hasProgram/stats.total*100).toFixed(1)}%)`);
  console.log(`  - Chunks missing program field:     ${stats.missingProgram}/${stats.total} (${(stats.missingProgram/stats.total*100).toFixed(1)}%)`);
  console.log(`  - Chunks with filename field:       ${stats.hasFilename}/${stats.total} (${(stats.hasFilename/stats.total*100).toFixed(1)}%)`);
  console.log(`  - Chunks missing filename field:    ${stats.missingFilename}/${stats.total} (${(stats.missingFilename/stats.total*100).toFixed(1)}%)`);
  console.log();
  
  // Try to call extractStructuredChunkMetadata from ragEngine
  console.log('🔍 Attempting to extract metadata from chunk text...');
  console.log();
  
  // Check if function is exported
  const extractFunc = ragEngine.extractStructuredChunkMetadata;
  if (!extractFunc) {
    console.error('❌ extractStructuredChunkMetadata is not exported from ragEngine');
    console.log('   Solution: Export the function from ragEngine.js');
    return;
  }
  
  // Try extracting metadata from first few chunks as sample
  console.log('📋 SAMPLE EXTRACTION (first 5 chunks):');
  console.log('-'.repeat(80));
  
  for (let i = 0; i < Math.min(5, index.length); i++) {
    const chunk = index[i];
    const chunkText = chunk.chunk || '';
    
    try {
      const extracted = extractFunc(chunkText);
      console.log(`\n[${i + 1}] ID: ${chunk.id}`);
      console.log(`    Current program: ${chunk.program || 'NONE'}`);
      console.log(`    Extracted program: ${extracted.program || 'NONE'}`);
      console.log(`    Extracted category: ${extracted.category || 'NONE'}`);
      console.log(`    Extracted aliases: ${JSON.stringify(extracted.programAliases || [])}`);
      console.log(`    Text preview: "${chunkText.substring(0, 100).replace(/\n/g, ' ')}..."`);
    } catch (e) {
      console.error(`❌ Error extracting metadata for chunk ${i}: ${e.message}`);
    }
  }
  
  console.log();
  console.log('='.repeat(80));
  console.log('RECOMMENDATION');
  console.log('='.repeat(80));
  console.log();
  console.log('To proceed with re-enrichment, need to:');
  console.log('1. Verify extractStructuredChunkMetadata() is working correctly');
  console.log('2. Export the function from ragEngine.js');
  console.log('3. Run the full enrichment process');
  console.log();
  console.log('Next step: Check if extractStructuredChunkMetadata is exported');
}

enrichIndexWithMetadata();
