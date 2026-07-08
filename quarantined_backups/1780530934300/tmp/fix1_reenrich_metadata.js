/**
 * FIX 1: RE-ENRICH CHUNKS WITH MISSING PROGRAM METADATA
 * 
 * For all 277 chunks with UNKNOWN program, extract program from chunk text
 * using extractStructuredChunkMetadata
 */

const fs = require('fs');
const path = require('path');
const ragEngine = require('../src/engine/ragEngine.js');

async function reEnrichMetadata() {
  const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
  
  console.log('='.repeat(80));
  console.log('FIX 1: RE-ENRICH CHUNKS WITH MISSING PROGRAM METADATA');
  console.log('='.repeat(80));
  console.log();
  
  // Load index
  const raw = fs.readFileSync(indexPath, 'utf8');
  let index = JSON.parse(raw);
  
  if (!Array.isArray(index)) {
    console.error('❌ Index is not an array');
    return;
  }
  
  console.log(`📂 Loaded ${index.length} chunks`);
  console.log();
  
  // Find chunks with UNKNOWN program
  const unknownProgram = index.filter(c => !c.program);
  console.log(`🔍 Found ${unknownProgram.length} chunks with missing program metadata (${(unknownProgram.length/index.length*100).toFixed(1)}%)`);
  console.log();
  
  // Get extractStructuredChunkMetadata function
  const extractFunc = ragEngine.extractStructuredChunkMetadata;
  if (!extractFunc) {
    console.error('❌ extractStructuredChunkMetadata not exported');
    return;
  }
  
  console.log('🔄 ENRICHING CHUNKS...');
  console.log('-'.repeat(80));
  
  let enriched = 0;
  let failed = 0;
  const successfullyExtracted = [];
  
  unknownProgram.forEach((chunk, idx) => {
    try {
      const chunkText = chunk.chunk || '';
      const meta = extractFunc(chunkText);
      
      // Only update if we found a program
      if (meta.program && meta.program !== 'UNKNOWN') {
        chunk.program = meta.program;
        enriched++;
        
        if (meta.program && !successfullyExtracted.includes(meta.program)) {
          successfullyExtracted.push(meta.program);
        }
      } else {
        failed++;
      }
      
      // Also update category if missing
      if (!chunk.category || chunk.category === 'UNKNOWN') {
        if (meta.category && meta.category !== 'UNKNOWN') {
          chunk.category = meta.category;
        }
      }
    } catch (e) {
      failed++;
    }
    
    if ((idx + 1) % 50 === 0) {
      console.log(`  Processed ${idx + 1}/${unknownProgram.length} chunks...`);
    }
  });
  
  console.log();
  console.log('✓ RE-ENRICHMENT COMPLETE');
  console.log('-'.repeat(80));
  console.log(`  Successfully enriched: ${enriched} chunks`);
  console.log(`  Failed/no program found: ${failed} chunks`);
  console.log(`  Programs successfully extracted: ${successfullyExtracted.join(', ')}`);
  console.log();
  
  // Save enriched index
  console.log('💾 Saving enriched index...');
  try {
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 0));
    console.log(`✓ Saved ${index.length} chunks to index`);
  } catch (e) {
    console.error('❌ Failed to save index:', e.message);
    return;
  }
  
  // Show new statistics
  console.log();
  console.log('📊 NEW METADATA STATISTICS');
  console.log('-'.repeat(80));
  
  const newStats = {
    hasProgram: 0,
    hasFilename: 0,
    hasCategory: 0,
    byProgram: {},
  };
  
  index.forEach(chunk => {
    if (chunk.program) newStats.hasProgram++;
    if (chunk.filename) newStats.hasFilename++;
    if (chunk.category) newStats.hasCategory++;
    
    const prog = chunk.program || 'UNKNOWN';
    newStats.byProgram[prog] = (newStats.byProgram[prog] || 0) + 1;
  });
  
  console.log(`Chunks with program field:  ${newStats.hasProgram}/${index.length} (${(newStats.hasProgram/index.length*100).toFixed(1)}%)`);
  console.log(`Chunks with filename field: ${newStats.hasFilename}/${index.length} (${(newStats.hasFilename/index.length*100).toFixed(1)}%)`);
  console.log(`Chunks with category field: ${newStats.hasCategory}/${index.length} (${(newStats.hasCategory/index.length*100).toFixed(1)}%)`);
  console.log();
  
  console.log('Program distribution:');
  Object.entries(newStats.byProgram).sort((a, b) => b[1] - a[1]).forEach(([prog, count]) => {
    const pct = (count/index.length*100).toFixed(1);
    console.log(`  ${prog.padEnd(12)}: ${count.toString().padStart(3)} (${pct}%)`);
  });
  
  console.log();
  console.log('✅ FIX 1 COMPLETE: Re-enrichment finished');
  console.log('   Note: 277 UNKNOWN chunks may not fully resolve - some are generic documents');
  console.log('         that don\'t contain program identifiers in their text.');
  
}

reEnrichMetadata().catch(console.error);
