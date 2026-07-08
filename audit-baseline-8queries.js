#!/usr/bin/env node

/**
 * BASELINE AUDIT: Test 8 Program Studi Queries
 * Memverifikasi konsistensi output untuk berbagai variasi query
 */

const fs = require('fs');
const path = require('path');

const TEST_QUERIES = [
  'ada program studi apa saja di itb stikom bali',
  'program studi di stikom bali',
  'jurusan di itb stikom bali',
  'kampus ini punya program apa saja',
  'daftar prodi',
  'pilihan jurusan',
  'prodi yang tersedia',
  'program pendidikan di itb stikom bali'
];

const REQUIRED_CATEGORIES = ['S2', 'S1', 'D3', 'Dual Degree', 'International Class'];

async function auditQueries() {
  try {
    const ragEngine = require('./src/engine/ragEngine');
    
    console.log('\n' + '='.repeat(100));
    console.log('BASELINE AUDIT: 8 Program Studi Queries');
    console.log('='.repeat(100));
    console.log();

    const results = [];

    for (let idx = 0; idx < TEST_QUERIES.length; idx++) {
      const query = TEST_QUERIES[idx];
      
      console.log(`Query #${idx + 1}: "${query}"`);
      console.log('-'.repeat(100));

      try {
        const result = await ragEngine.query(query, 10, { includeGlobal: true });
        
        const answer = result.answer || '';
        const source = result.source || 'UNKNOWN';
        
        // Check for categories
        const categories = {};
        for (const cat of REQUIRED_CATEGORIES) {
          const patterns = {
            'S2': /\b(?:s2|magister|pascasarjana|pasca\s+sarjana|strata\s+2)\b/i,
            'S1': /\b(?:s1|sarjana|strata\s+1|program\s+s1)\b/i,
            'D3': /\b(?:d3|diploma\s+3|diploma\s+tiga)\b/i,
            'Dual Degree': /(?:dual\s+degree|double\s+degree)/i,
            'International Class': /(?:international\s+class|kelas\s+internasional)/i
          };
          categories[cat] = patterns[cat] ? patterns[cat].test(answer) : false;
        }
        
        const coverage = Object.values(categories).filter(Boolean).length;
        const complete = coverage === REQUIRED_CATEGORIES.length ? '✅' : '⚠️';
        
        console.log(`Source: ${source}`);
        console.log(`Coverage: ${coverage}/${REQUIRED_CATEGORIES.length} ${complete}`);
        console.log('Categories:');
        for (const cat of REQUIRED_CATEGORIES) {
          console.log(`  ${categories[cat] ? '✓' : '✗'} ${cat}`);
        }
        
        // Show answer length and preview
        console.log(`Answer length: ${answer.length} chars`);
        const preview = answer.substring(0, 100).replace(/\n/g, ' ').replace(/\s+/g, ' ');
        console.log(`Preview: ${preview}...`);
        
        results.push({
          query,
          source,
          coverage,
          categories,
          answerLength: answer.length,
          answer
        });
        
      } catch (err) {
        console.log(`❌ Error: ${err.message}`);
        results.push({
          query,
          error: err.message
        });
      }
      
      console.log();
    }

    // Summary
    console.log('='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log();
    
    const successCount = results.filter(r => !r.error).length;
    const fullCoverageCount = results.filter(r => !r.error && r.coverage === REQUIRED_CATEGORIES.length).length;
    
    console.log(`Queries tested: ${TEST_QUERIES.length}`);
    console.log(`Successful: ${successCount}/${TEST_QUERIES.length}`);
    console.log(`Full coverage (5/5): ${fullCoverageCount}/${successCount}`);
    console.log();
    
    // Check consistency
    console.log('Consistency Check:');
    const sourceCounts = {};
    const coverageCounts = {};
    
    for (const r of results) {
      if (!r.error) {
        sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
        coverageCounts[r.coverage] = (coverageCounts[r.coverage] || 0) + 1;
      }
    }
    
    console.log('Source distribution:');
    for (const [source, count] of Object.entries(sourceCounts)) {
      console.log(`  ${source}: ${count}/${successCount}`);
    }
    
    console.log('Coverage distribution:');
    for (let i = 0; i <= 5; i++) {
      const count = coverageCounts[i] || 0;
      if (count > 0) {
        console.log(`  ${i}/5: ${count}/${successCount}`);
      }
    }
    console.log();
    
    // Show inconsistencies
    if (fullCoverageCount < successCount) {
      console.log('⚠️  INCONSISTENCIES DETECTED:');
      for (const r of results) {
        if (!r.error && r.coverage < REQUIRED_CATEGORIES.length) {
          console.log(`\n  "${r.query}" → ${r.coverage}/5 coverage (${r.source})`);
          console.log(`  Missing: ${REQUIRED_CATEGORIES.filter(cat => !r.categories[cat]).join(', ')}`);
        }
      }
    }
    
    console.log('\n' + '='.repeat(100));

  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

auditQueries().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
