#!/usr/bin/env node

/**
 * RAG System Audit Test Script
 * 
 * Usage:
 *   export RAG_AUDIT_LOGGING=true
 *   export RAG_DEBUG_INTENT_FILTERING=true
 *   node rag-audit-test.js
 * 
 * This script:
 * 1. Runs specific test queries
 * 2. Captures debug logs showing top 20 chunks before/after filtering
 * 3. Shows which chunks are selected and why
 * 4. Verifies docCategory metadata is working
 */

require('dotenv').config();

// Enable audit logging
process.env.RAG_AUDIT_LOGGING = 'true';
process.env.RAG_DEBUG_INTENT_FILTERING = 'true';

const path = require('path');
const fs = require('fs');
const { RagEngine } = require('./src/engine/ragEngine');

// Test queries - these are the ones that were failing
const testQueries = [
  {
    query: 'Apa itu TI',
    expectedIntent: 'DEFINISI_PRODI',
    shouldNotInclude: ['BIAYA', 'SK', 'AKREDITASI', 'TEMPLATE', 'MOU', 'ADMINISTRASI'],
    description: 'Definition query - should get PRODI_PROFILE chunks only'
  },
  {
    query: 'TI belajar apa saja',
    expectedIntent: 'KURIKULUM_PEMBELAJARAN',
    shouldNotInclude: ['BIAYA', 'SK', 'MOU'],
    description: 'Curriculum query - should get KURIKULUM/MATA_KULIAH chunks'
  },
  {
    query: 'TI fokus ke apa',
    expectedIntent: 'PROSPEK_KERJA',
    shouldNotInclude: ['BIAYA', 'SK', 'MOU', 'AKREDITASI'],
    description: 'Career prospect query - should get PROSPEK_KERJA chunks'
  },
  {
    query: 'Prospek kerja TI',
    expectedIntent: 'PROSPEK_KERJA',
    shouldNotInclude: ['BIAYA', 'SK', 'MOU'],
    description: 'Career query - should not get cost/contract chunks'
  },
  {
    query: 'Apa itu SI',
    expectedIntent: 'DEFINISI_PRODI',
    shouldNotInclude: ['BIAYA', 'SK', 'AKREDITASI', 'TEMPLATE'],
    description: 'SI definition - should get profile/program info'
  },
  {
    query: 'SI belajar apa saja',
    expectedIntent: 'KURIKULUM_PEMBELAJARAN',
    shouldNotInclude: ['BIAYA', 'SK', 'MOU'],
    description: 'SI curriculum - should get curriculum chunks'
  },
  {
    query: 'Ada kampus selain Renon',
    expectedIntent: 'LOKASI_KAMPUS',
    shouldNotInclude: ['BIAYA', 'SK', 'MOU'],
    description: 'Location query - should get location chunks'
  }
];

async function runAuditTest() {
  console.log('========================================');
  console.log('RAG SYSTEM AUDIT TEST');
  console.log('========================================\n');

  console.log('Test Configuration:');
  console.log('  RAG_AUDIT_LOGGING:', process.env.RAG_AUDIT_LOGGING);
  console.log('  RAG_DEBUG_INTENT_FILTERING:', process.env.RAG_DEBUG_INTENT_FILTERING);
  console.log('  Logger:', process.env.LOGGER_TYPE || 'default');
  console.log('');

  const ragEngine = new RagEngine();

  // Initialize/load index
  console.log('Loading RAG index...\n');

  for (const testCase of testQueries) {
    console.log('-------------------------------------------');
    console.log(`Query: "${testCase.query}"`);
    console.log(`Description: ${testCase.description}`);
    console.log(`Expected Intent: ${testCase.expectedIntent}`);
    console.log('');

    try {
      // Run query - this should trigger audit logging
      const result = await ragEngine.query(testCase.query, { topK: 20 });

      console.log(`Result:`);
      console.log(`  Received: ${result.text ? 'Yes' : 'No'}`);
      if (result.sources && result.sources.length > 0) {
        console.log(`  Source chunks: ${result.sources.length}`);
        console.log('  Categories found:');
        const categories = {};
        for (const source of result.sources) {
          const cat = source.docCategory || source.category || 'UNKNOWN';
          categories[cat] = (categories[cat] || 0) + 1;
        }
        for (const [cat, count] of Object.entries(categories)) {
          const isBad = testCase.shouldNotInclude.includes(cat);
          const marker = isBad ? '❌' : '✓';
          console.log(`    ${marker} ${cat}: ${count} chunks`);
        }
      }
      console.log('');

    } catch (error) {
      console.error(`Error running query: ${error.message}`);
      console.log('');
    }
  }

  // Print audit logs location
  console.log('========================================');
  console.log('Audit logs saved to: ./rag-audit-logs/');
  console.log('');
  console.log('Check these files for detailed filtering information:');
  console.log('  - query-retrieval-*.jsonl (detailed retrieval logs)');
  console.log('  - filtering-decisions-*.log (filtering decisions)');
  console.log('  - ingest-*.log (ingest enrichment stats)');
  console.log('========================================');
}

// Run the test
runAuditTest().catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
