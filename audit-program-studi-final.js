#!/usr/bin/env node

/**
 * Audit Query: "Ada program studi apa saja di ITB STIKOM Bali?"
 */

const fs = require('fs');
const path = require('path');

const QUERY = 'Ada program studi apa saja di ITB STIKOM Bali?';

const PROGRAM_CATEGORIES = {
  'D3': /(?:diploma|d3|d-3|diploma\s+tiga|diploma\s+3)/i,
  'S1': /(?:sarjana|s1|s-1|strata\s+1|strata\s+satu|program\s+studi)/i,
  'S2': /(?:magister|s2|s-2|strata\s+2|strata\s+dua|pascasarjana|pasca\s+sarjana)/i,
  'Magister': /magister/i,
  'Pascasarjana': /pascasarjana|pasca\s+sarjana/i,
  'Dual Degree': /(?:dual\s+degree|double\s+degree)/i,
  'International Class': /(?:kelas\s+internasional|international\s+class)/i
};

async function runAudit() {
  try {
    console.log('='.repeat(80));
    console.log('AUDIT: Program Studi Query');
    console.log('='.repeat(80));
    console.log(`Query: "${QUERY}"`);
    console.log();

    // Load RAG engine to call query
    const ragEngine = require('./src/engine/ragEngine');
    
    // STEP 1: Query RAG engine
    console.log('STEP 1: Running RAG Query...');
    console.log('-'.repeat(80));
    
    const ragResult = await ragEngine.query(QUERY, 10, { 
      includeGlobal: true 
    });

    console.log(`✓ RAG Query completed`);
    console.log(`✓ Confidence Tier: ${ragResult.confidenceTier || 'UNKNOWN'}`);
    console.log(`✓ Source: ${ragResult.source || 'UNKNOWN'}`);
    console.log(`✓ Total contexts in result: ${ragResult.contexts && ragResult.contexts.length || 0}`);
    console.log();

    // STEP 2: Show top 10 from contexts
    console.log('STEP 2: Top Retrieval Chunks Used in Synthesis');
    console.log('-'.repeat(80));
    
    if (ragResult.contexts && ragResult.contexts.length > 0) {
      console.log(`\nTotal: ${ragResult.contexts.length} chunks in synthesis context\n`);
      
      // Show top 10 from contexts
      const topContexts = ragResult.contexts.slice(0, Math.min(10, ragResult.contexts.length));
      
      console.log('┌─────┬────────────────────────────────────────────────────────────┬──────────────┐');
      console.log('│ # │ Filename / Content Preview │ Category │');
      console.log('├─────┼────────────────────────────────────────────────────────────┼──────────────┤');
      
      topContexts.forEach((ctx, idx) => {
        const filename = ctx.filename || 'UNKNOWN';
        const category = ctx.docCategory || ctx.category || 'UNKNOWN';
        const preview = (ctx.chunk || '')
          .substring(0, 45)
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const fileDisplay = `${filename}`;
        const contentDisplay = preview.length > 45 ? preview.substring(0, 42) + '...' : preview;
        
        console.log(`│ ${String(idx+1).padStart(3)} │ ${fileDisplay.substring(0, 60).padEnd(60)} │ ${category.padEnd(12)} │`);
        console.log(`│     │ ${contentDisplay.padEnd(60)} │              │`);
      });
      console.log('└─────┴────────────────────────────────────────────────────────────┴──────────────┘');
      
      if (ragResult.contexts.length > 10) {
        console.log(`\n... and ${ragResult.contexts.length - 10} more contexts`);
      }
    } else {
      console.log('No contexts in result');
    }
    console.log();

    // STEP 3: Check for program categories
    console.log('STEP 3: Program Categories in Synthesis Contexts');
    console.log('-'.repeat(80));

    if (ragResult.contexts && ragResult.contexts.length > 0) {
      const categoryFindings = {};
      
      for (const category of Object.keys(PROGRAM_CATEGORIES)) {
        categoryFindings[category] = [];
      }

      ragResult.contexts.forEach((ctx, index) => {
        const chunk = (ctx.chunk || '').toLowerCase();
        const filename = (ctx.filename || '').toLowerCase();
        
        for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
          if (pattern.test(chunk) || pattern.test(filename)) {
            if (!categoryFindings[category].find(f => f.id === ctx.id)) {
              categoryFindings[category].push({
                position: index + 1,
                filename: ctx.filename,
                id: ctx.id
              });
            }
          }
        }
      });

      console.log('\nCategories found in contexts:\n');
      for (const [category, findings] of Object.entries(categoryFindings)) {
        if (findings.length > 0) {
          console.log(`✓ ${category.padEnd(20)}: Found in ${findings.length} chunk(s)`);
          findings.slice(0, 3).forEach(f => {
            console.log(`  └─ Position #${f.position} | ${f.filename}`);
          });
          if (findings.length > 3) {
            console.log(`  └─ ... and ${findings.length - 3} more`);
          }
        } else {
          console.log(`✗ ${category.padEnd(20)}: NOT FOUND in contexts`);
        }
      }
    }
    console.log();

    // STEP 4: Final answer
    console.log('STEP 4: Final Answer Generated');
    console.log('-'.repeat(80));
    
    if (ragResult.answer) {
      const lines = ragResult.answer.split('\n');
      const maxLines = 30;
      
      if (lines.length > maxLines) {
        console.log(lines.slice(0, maxLines).join('\n'));
        console.log(`\n... [${lines.length - maxLines} more lines] ...\n`);
      } else {
        console.log(ragResult.answer);
      }
      console.log();
      
      // Coverage analysis
      console.log('STEP 5: Answer Coverage Analysis');
      console.log('-'.repeat(80));
      console.log();
      
      const answerLower = ragResult.answer.toLowerCase();
      const covered = [];
      const notCovered = [];
      
      for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(answerLower)) {
          covered.push(category);
          console.log(`✓ ${category.padEnd(20)}: Mentioned in answer`);
        } else {
          notCovered.push(category);
          console.log(`✗ ${category.padEnd(20)}: NOT mentioned in answer`);
        }
      }
      
      console.log();
      console.log(`Coverage: ${covered.length}/${Object.keys(PROGRAM_CATEGORIES).length} categories`);
      if (covered.length > 0) console.log(`Covered: ${covered.join(', ')}`);
      if (notCovered.length > 0) console.log(`Missing: ${notCovered.join(', ')}`);
    } else {
      console.log('No answer generated');
    }
    console.log();

    // STEP 6: Summary
    console.log('='.repeat(80));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(80));
    console.log(`✓ Query: "${QUERY}"`);
    console.log(`✓ Confidence: ${ragResult.confidenceTier || 'UNKNOWN'}`);
    console.log(`✓ Answer generated: ${ragResult.answer ? 'YES' : 'NO'}`);
    console.log(`✓ Contexts provided: ${ragResult.contexts ? ragResult.contexts.length : 0}`);
    console.log();
    
  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run audit
runAudit().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
