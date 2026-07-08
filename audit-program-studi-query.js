#!/usr/bin/env node

/**
 * Audit Query: "Ada program studi apa saja di ITB STIKOM Bali?"
 * 
 * Tasks:
 * 1. Top 10 retrieval chunks dengan scores
 * 2. Kategori program yang ditemukan (D3, S1, S2, Dual Degree, dll)
 * 3. Chunk yang dipakai untuk synthesis
 * 4. Verifikasi jawaban mencakup semua program
 * 5. Cek apakah synthesis menggabungkan semua kategori
 */

const fs = require('fs');
const path = require('path');

// Import RAG engine functions
const ragEngine = require('./src/engine/ragEngine');

const QUERY = 'Ada program studi apa saja di ITB STIKOM Bali?';

const PROGRAM_CATEGORIES = {
  'D3': /(?:diploma|d3|d-3|diploma\s+tiga|diploma\s+3)/i,
  'S1': /(?:sarjana|s1|s-1|strata\s+1|strata\s+satu|program\s+sarjana|program\s+studi)/i,
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

    // STEP 1: Query RAG engine
    console.log('STEP 1: Running RAG Query...');
    console.log('-'.repeat(80));
    
    const ragResult = await ragEngine.query(QUERY, 10, { 
      includeGlobal: true 
    });

    if (!ragResult.success && !ragResult.contexts) {
      console.log('❌ Query failed or no contexts returned');
      console.log('Result:', JSON.stringify(ragResult, null, 2));
      return;
    }

    // Get raw index for scoring analysis
    const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
    const rawIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    
    console.log(`✓ RAG Query completed`);
    console.log(`✓ Total chunks returned in contexts: ${ragResult.contexts.length}`);
    console.log();

    // STEP 2: Compute scores for all chunks to show top 10
    console.log('STEP 2: Computing Top 10 Retrieval Chunks with Scores');
    console.log('-'.repeat(80));

    const { computeEmbedding, cosineSimilarity } = require('./src/engine/ragEngine');
    
    const queryEmbedding = await computeEmbedding(QUERY);
    
    // Score all chunks
    const scoredChunks = rawIndex.map(item => {
      const semanticScore = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        item,
        semanticScore: Number(semanticScore.toFixed(4)),
        rank: 0
      };
    }).sort((a, b) => b.semanticScore - a.semanticScore);

    // Show top 10
    console.log('\nTOP 10 RETRIEVAL CHUNKS:\n');
    console.log('┌─────┬──────────────────────────────────────────────────────────────────┬───────────┐');
    console.log('│ Rank │ Filename / Content Preview                                     │ Score     │');
    console.log('├─────┼──────────────────────────────────────────────────────────────────┼───────────┤');
    
    for (let i = 0; i < Math.min(10, scoredChunks.length); i++) {
      const { item, semanticScore } = scoredChunks[i];
      const preview = item.chunk
        .substring(0, 60)
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const filename = item.filename || 'UNKNOWN';
      const display = `${filename} | ${preview}...`;
      const truncated = display.length > 65 ? display.substring(0, 62) + '...' : display;
      
      console.log(
        `│ ${String(i+1).padStart(3)} │ ${truncated.padEnd(65)} │ ${String(semanticScore).padStart(8)} │`
      );
    }
    console.log('└─────┴──────────────────────────────────────────────────────────────────┴───────────┘');
    console.log();

    // STEP 3: Check for program categories in top 10
    console.log('STEP 3: Checking Program Categories in Top 10');
    console.log('-'.repeat(80));

    const top10Chunks = scoredChunks.slice(0, 10);
    const categoryFindings = {};
    
    for (const category of Object.keys(PROGRAM_CATEGORIES)) {
      categoryFindings[category] = [];
    }

    top10Chunks.forEach((scored, index) => {
      const chunk = scored.item.chunk.toLowerCase();
      const filename = (scored.item.filename || '').toLowerCase();
      
      for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(chunk) || pattern.test(filename)) {
          categoryFindings[category].push({
            rank: index + 1,
            filename: scored.item.filename,
            score: scored.semanticScore
          });
        }
      }
    });

    console.log('Categories found in top 10:');
    for (const [category, findings] of Object.entries(categoryFindings)) {
      if (findings.length > 0) {
        console.log(`✓ ${category}: Found in ${findings.length} chunk(s)`);
        findings.forEach(f => {
          console.log(`  - Rank #${f.rank} | ${f.filename} (score: ${f.score})`);
        });
      } else {
        console.log(`✗ ${category}: NOT FOUND`);
      }
    }
    console.log();

    // STEP 4: Detailed analysis of top 10 chunks
    console.log('STEP 4: Detailed Analysis of Top 10 Chunks');
    console.log('-'.repeat(80));

    top10Chunks.forEach((scored, index) => {
      console.log(`\n[RANK #${index + 1}]`);
      console.log(`Filename: ${scored.item.filename || 'UNKNOWN'}`);
      console.log(`Category: ${scored.item.docCategory || scored.item.category || 'UNKNOWN'}`);
      console.log(`Score: ${scored.semanticScore}`);
      console.log(`Training ID: ${scored.item.trainingId || 'UNKNOWN'}`);
      
      const preview = scored.item.chunk.substring(0, 300).replace(/\n/g, '\n  ');
      console.log(`Content Preview:\n  ${preview}...`);
      
      // Check for program mentions
      const chunkLower = scored.item.chunk.toLowerCase();
      const foundCategories = [];
      for (const [cat, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(chunkLower)) foundCategories.push(cat);
      }
      if (foundCategories.length > 0) {
        console.log(`Categories: ${foundCategories.join(', ')}`);
      }
      console.log('-'.repeat(80));
    });
    console.log();

    // STEP 5: Check RAG result contexts
    console.log('STEP 5: Chunks Used in Synthesis');
    console.log('-'.repeat(80));
    
    if (ragResult.contexts && ragResult.contexts.length > 0) {
      console.log(`Total contexts used: ${ragResult.contexts.length}\n`);
      
      ragResult.contexts.slice(0, 5).forEach((ctx, index) => {
        console.log(`[SYNTHESIS CONTEXT #${index + 1}]`);
        console.log(`Filename: ${ctx.filename || 'UNKNOWN'}`);
        console.log(`Category: ${ctx.docCategory || ctx.category || 'UNKNOWN'}`);
        console.log(`Content Preview: ${ctx.chunk.substring(0, 200).replace(/\n/g, ' ')}...`);
        console.log('-'.repeat(80));
      });
      
      if (ragResult.contexts.length > 5) {
        console.log(`... and ${ragResult.contexts.length - 5} more contexts`);
      }
    } else {
      console.log('No contexts in RAG result');
    }
    console.log();

    // STEP 6: Final answer analysis
    console.log('STEP 6: Final Answer');
    console.log('-'.repeat(80));
    
    if (ragResult.answer) {
      console.log('Answer:');
      console.log(ragResult.answer);
      console.log();
      
      // Verify if answer covers all categories
      const answerLower = ragResult.answer.toLowerCase();
      console.log('Coverage Check:');
      const coveredCategories = [];
      for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(answerLower)) {
          console.log(`✓ ${category}: Mentioned`);
          coveredCategories.push(category);
        } else {
          console.log(`✗ ${category}: NOT mentioned`);
        }
      }
      
      console.log();
      console.log(`Coverage Summary: ${coveredCategories.length}/${Object.keys(PROGRAM_CATEGORIES).length} categories`);
    } else {
      console.log('No answer generated');
    }
    console.log();

    // STEP 7: Confidence assessment
    console.log('STEP 7: Confidence Assessment');
    console.log('-'.repeat(80));
    console.log(`Confidence Tier: ${ragResult.confidenceTier || 'UNKNOWN'}`);
    console.log(`Source: ${ragResult.source || 'UNKNOWN'}`);
    
    if (ragResult.debug) {
      console.log('\nDebug Info:');
      console.log(JSON.stringify(ragResult.debug, null, 2));
    }
    console.log();

    // Final summary
    console.log('='.repeat(80));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(80));
    
    const categoriesFoundInTop10 = Object.entries(categoryFindings)
      .filter(([_, findings]) => findings.length > 0)
      .map(([cat]) => cat);
    
    const synthesisGood = ragResult.answer && ragResult.answer.length > 0;
    
    console.log(`✓ Query executed successfully`);
    console.log(`✓ Top 10 chunks retrieved`);
    console.log(`✓ Categories found in top 10: ${categoriesFoundInTop10.join(', ') || 'NONE'}`);
    console.log(`${synthesisGood ? '✓' : '✗'} Answer synthesized: ${synthesisGood ? 'YES' : 'NO'}`);
    console.log(`✓ Confidence: ${ragResult.confidenceTier}`);
    
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
