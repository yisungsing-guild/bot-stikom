#!/usr/bin/env node

/**
 * Direct RAG Query Test - untuk testing retrieval dengan audit logging
 */

// Set environment before requiring modules
process.env.RAG_AUDIT_LOGGING = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';
process.env.NODE_ENV = 'test';

const path = require('path');

async function main() {
  try {
    const { query } = require('./src/engine/ragEngine');

    // Test queries
    const queries = [
      { q: 'Apa itu TI', expectedIntent: 'DEFINISI_PRODI' },
      { q: 'TI belajar apa saja', expectedIntent: 'KURIKULUM_PEMBELAJARAN' },
      { q: 'Prospek kerja TI', expectedIntent: 'PROSPEK_KERJA' },
      { q: 'Apa itu SI', expectedIntent: 'DEFINISI_PRODI' },
      { q: 'Ada kampus selain Renon', expectedIntent: 'LOKASI_KAMPUS' }
    ];

    console.log('Running test queries with audit logging...\n');

    for (const testCase of queries) {
      console.log('-------------------------------------------');
      console.log(`Query: "${testCase.q}"`);
      console.log(`Expected Intent: ${testCase.expectedIntent}\n`);

      try {
        // Query with topK to get more chunks for analysis
        const result = await query(testCase.q, 20);

        if (result) {
          console.log(`Response: ${result.text?.substring(0, 80) || 'No text'}...`);
          console.log(`Sources: ${result.sources?.length || 0} chunks\n`);

          // Show categories from sources
          if (result.sources && result.sources.length > 0) {
            const categories = {};
            for (const source of result.sources) {
              const cat = source.docCategory || source.category || 'UNKNOWN';
              if (!categories[cat]) categories[cat] = [];
              categories[cat].push(source.filename);
            }

            console.log('Categories found:');
            for (const [cat, files] of Object.entries(categories)) {
              console.log(`  ${cat}: ${files.length} chunks`);
              console.log(`    - ${files.slice(0, 2).join(', ')}`);
            }
          }
        } else {
          console.log('No result returned');
        }
        console.log('');

      } catch (error) {
        console.error(`Error: ${error.message}`);
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        console.log('');
      }
    }

    console.log('-------------------------------------------');
    console.log('\nAudit logs location: ./rag-audit-logs/\n');

    const { auditLogger } = require('./src/engine/ragAuditLogger');
    const summary = auditLogger.generateSummary();
    console.log(summary);

  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
