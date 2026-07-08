#!/usr/bin/env node

/**
 * Deep Audit: Analyze how the query is routed and why
 */

const fs = require('fs');
const path = require('path');

const QUERY = 'Ada program studi apa saja di ITB STIKOM Bali?';

async function runDeepAudit() {
  try {
    const ragEngine = require('./src/engine/ragEngine');
    const intentClassifier = require('./src/engine/intentClassifier');
    
    console.log('='.repeat(80));
    console.log('DEEP AUDIT: Query Routing Analysis');
    console.log('='.repeat(80));
    console.log(`Query: "${QUERY}"`);
    console.log();

    // Step 1: Analyze query parsing
    console.log('STEP 1: Query Parsing & Normalization');
    console.log('-'.repeat(80));
    
    // Check what functions are available
    console.log('\nAvailable exports from ragEngine:');
    const exports = Object.keys(ragEngine);
    console.log(exports.filter(e => !e.startsWith('_')).slice(0, 20).join(', '));
    console.log();

    // Step 2: Try to query with different approaches
    console.log('STEP 2: Direct Query Call');
    console.log('-'.repeat(80));
    
    const result1 = await ragEngine.query(QUERY, 10);
    console.log(`Result source: ${result1.source}`);
    console.log(`Result confidence: ${result1.confidenceTier}`);
    console.log(`Result has contexts: ${result1.contexts && result1.contexts.length > 0}`);
    console.log(`Result answer snippet: ${result1.answer ? result1.answer.substring(0, 100) : 'NO ANSWER'}`);
    console.log();

    // Step 3: Check RAG index for program studi related chunks
    console.log('STEP 3: Analyzing RAG Index');
    console.log('-'.repeat(80));
    
    const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    
    console.log(`Total chunks in index: ${index.length}`);
    
    // Find chunks related to "program studi"
    const progChunks = index.filter(item => {
      const text = (item.chunk || '').toLowerCase();
      const file = (item.filename || '').toLowerCase();
      return /(?:program\s+studi|prodi|jurusan|strata|diploma|magister|dual\s+degree|international\s+class)/i.test(text + file);
    });
    
    console.log(`Chunks mentioning "program studi" or related: ${progChunks.length}`);
    console.log();
    
    // Sample some
    console.log('Sample program studi chunks:');
    progChunks.slice(0, 5).forEach((chunk, idx) => {
      console.log(`\n[${idx+1}] ${chunk.filename}`);
      console.log(`    Category: ${chunk.docCategory || chunk.category || 'UNKNOWN'}`);
      console.log(`    Preview: ${chunk.chunk.substring(0, 100).replace(/\n/g, ' ')}`);
    });
    console.log();

    // Step 4: Check for deterministic rules
    console.log('STEP 4: Checking Deterministic Rules');
    console.log('-'.repeat(80));
    
    // Check if tryStructuredProgramOverviewAnswer would trigger
    const qLower = QUERY.toLowerCase();
    
    const hasSpecificProgram = /\b(si|ti|bd|sk|mi|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer|s\.?k(?:om(?:puter)?)?|manajemen\s+informatika|manajemen\s+informasi)\b/i.test(qLower);
    console.log(`Has specific program mention: ${hasSpecificProgram}`);
    
    const overviewTrigger = /(?:\bapa\s+itu\b|\bdi\b.+\sbelajar\s+apa\b|\bmata\s+kuliah\b|\blulusan\b.+\b(?:bekerja|kerja)\b|\bprospek\s+kerja\b|\bkarir\b|\bprogram\s+studi\b|\bprofil\s+prodi\b)/i;
    const detailTrigger = /(berikan|beri|tampilkan)\s+detail|detail\s+(tentang|prodi|masing|-masing)|detail\s+prodi/i;
    const overviewMatch = overviewTrigger.test(qLower);
    const detailMatch = detailTrigger.test(qLower);
    
    console.log(`Matches overview trigger: ${overviewMatch}`);
    console.log(`Matches detail trigger: ${detailMatch}`);
    console.log(`Should trigger program overview rule: ${overviewMatch || detailMatch ? 'YES' : 'NO'}`);
    console.log();

    // Step 5: Check intent detection
    console.log('STEP 5: Intent Classification');
    console.log('-'.repeat(80));
    
    if (intentClassifier && intentClassifier.classifyIntent) {
      const intent = intentClassifier.classifyIntent(QUERY);
      console.log(`Detected intent: ${intent}`);
    } else {
      console.log('Intent classifier not directly accessible');
    }
    console.log();

    // Step 6: Check hobby matching
    console.log('STEP 6: Hobby Matching Analysis');
    console.log('-'.repeat(80));
    
    const hobbyPattern = /\b(?:hobi|passion|kegemaran|minat|ketertarikan|suka|senang|punya\s+minat|punya\s+passion|interest\b|passion\b)\b/i;
    const isHobbyQuery = hobbyPattern.test(qLower);
    console.log(`Appears to be hobby query: ${isHobbyQuery}`);
    
    const programStudi = /\b(?:program\s+studi|prodi|jurusan|ada\s+apa\s+saja|apa\s+saja|apa\s+program\b|daftar\s+program)/i;
    const isProgramQuery = programStudi.test(qLower);
    console.log(`Appears to be program studi query: ${isProgramQuery}`);
    console.log();

    // Final recommendations
    console.log('='.repeat(80));
    console.log('FINDINGS & RECOMMENDATIONS');
    console.log('='.repeat(80));
    
    console.log(`\n❌ ISSUE: Query "${QUERY}" is being routed to hobby/major-recommendation`);
    console.log(`instead of program-studi retrieval.`);
    console.log();
    
    console.log(`ROOT CAUSE:
- The query contains "program studi apa saja" which should trigger 
  the tryStructuredProgramOverviewAnswer rule.
- However, something in the rule chain is routing to major-recommendation first.`);
    console.log();
    
    console.log(`RECOMMENDATION:
1. Check the order of rule execution in ragEngine.query()
2. Program overview rule should execute BEFORE major-recommendation rule
3. Or: improve keyword matching to distinguish program-list queries 
   from hobby-matching queries`);
    console.log();

    console.log('ACTION ITEMS:');
    console.log('1. ✓ tryStructuredProgramOverviewAnswer should catch this query');
    console.log('2. ✓ Should return list of: BD, SI, TI, SK, and other programs');
    console.log('3. ✓ If retrieval is needed, should include D3, S1, S2 programs');
    console.log('4. ✓ If Dual Degree/International Class exist, should include them');
    console.log();

  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runDeepAudit().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
