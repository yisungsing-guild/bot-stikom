#!/usr/bin/env node

/**
 * Minimal RAG Test - Debug Version
 */

process.env.RAG_AUDIT_LOGGING = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';

async function main() {
  try {
    console.log('1. Loading ragEngine module...');
    const ragEngine = require('./src/engine/ragEngine');
    console.log('   Exported functions:', Object.keys(ragEngine));

    if (!ragEngine.query) {
      throw new Error('query function not found in exports');
    }

    console.log('\n2. Testing single query...');
    const testQuery = 'Apa itu TI';
    console.log(`   Query: "${testQuery}"`);

    try {
      console.log('   Calling query function...');
      const result = await ragEngine.query(testQuery, 10);
      
      console.log('   Result received:');
      console.log('   - Type:', typeof result);
      console.log('   - Has text:', !!result?.text);
      console.log('   - Text length:', result?.text?.length || 0);
      console.log('   - Has sources:', !!result?.sources);
      console.log('   - Sources length:', result?.sources?.length || 0);
      console.log('   - Full result:', JSON.stringify(result, null, 2).substring(0, 500));

    } catch (queryErr) {
      console.error('   ERROR during query:', queryErr.message);
      console.error('   Stack:', queryErr.stack.substring(0, 200));
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
  }
}

main();
