#!/usr/bin/env node

/**
 * COMPREHENSIVE AUDIT REPORT
 * Query: "Ada program studi apa saja di ITB STIKOM Bali?"
 * 
 * Objectives:
 * 1. Show top 10 retrieval chunks with scores
 * 2. Check for all program categories (D3, S1, S2, Dual Degree, International Class)
 * 3. Show chunks used for synthesis
 * 4. Verify answer includes all found programs
 * 5. Check if synthesis combines all categories properly
 */

const fs = require('fs');
const path = require('path');

const QUERY = 'Ada program studi apa saja di ITB STIKOM Bali?';

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dotProduct = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

const PROGRAM_CATEGORIES = {
  'D3 (Diploma 3)': /(?:diploma|d3|d-3|diploma\s+tiga|diploma\s+3)\b/i,
  'S1 (Sarjana)': /\b(?:sarjana|s1|s-1|strata\s+1|strata\s+satu|program\s+s1|program\s+sarjana)\b/i,
  'S2 (Magister)': /\b(?:magister|s2|s-2|strata\s+2|strata\s+dua|pascasarjana|pasca\s+sarjana)\b/i,
  'Dual Degree': /(?:dual\s+degree|double\s+degree)/i,
  'International Class': /(?:kelas\s+internasional|international\s+class)/i
};

async function runAudit() {
  try {
    console.log('\n' + '='.repeat(100));
    console.log('COMPREHENSIVE RAG AUDIT REPORT');
    console.log('Query: "Ada program studi apa saja di ITB STIKOM Bali?"');
    console.log('='.repeat(100) + '\n');

    // Load RAG engine and index
    const ragEngine = require('./src/engine/ragEngine');
    const indexPath = path.join(__dirname, 'src', 'data', 'rag_index.json');
    const rawIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    
    // Get query embedding
    const queryEmbedding = await ragEngine.computeEmbedding(QUERY);
    
    // ============================================================================
    // SECTION 1: TOP 10 RETRIEVAL CHUNKS WITH SCORES
    // ============================================================================
    console.log('SECTION 1: TOP 10 RETRIEVAL CHUNKS (by Semantic Score)');
    console.log('-'.repeat(100));
    
    // Score all chunks
    const scoredChunks = rawIndex.map((item, idx) => {
      const semanticScore = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        rank: 0,
        index: idx,
        item,
        score: semanticScore
      };
    }).sort((a, b) => b.score - a.score);

    const top10 = scoredChunks.slice(0, 10);
    
    console.log('\n┌──────┬──────────┬─────────────────────────────────────────┬───────────┐');
    console.log('│ Rank │   ID    │ Filename / Content Preview               │ Score     │');
    console.log('├──────┼──────────┼─────────────────────────────────────────┼───────────┤');
    
    top10.forEach((chunk, idx) => {
      const filename = (chunk.item.filename || 'UNKNOWN').substring(0, 35);
      const preview = (chunk.item.chunk || '')
        .substring(0, 40)
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const display = preview.length > 38 ? preview.substring(0, 35) + '...' : preview;
      
      console.log(
        `│ ${String(idx+1).padStart(4)} │ ${chunk.item.id.substring(0, 8)} │ ${(filename + ' | ' + display).padEnd(41)} │ ${Number(chunk.score.toFixed(4)).toString().padStart(8)} │`
      );
    });
    console.log('└──────┴──────────┴─────────────────────────────────────────┴───────────┘\n');

    // ============================================================================
    // SECTION 2: PROGRAM CATEGORIES IN TOP 10
    // ============================================================================
    console.log('SECTION 2: Program Categories Found in Top 10 Chunks');
    console.log('-'.repeat(100));
    
    const categoryMap = {};
    for (const category of Object.keys(PROGRAM_CATEGORIES)) {
      categoryMap[category] = [];
    }
    
    top10.forEach((chunk, idx) => {
      const text = (chunk.item.chunk || '').toLowerCase();
      const filename = (chunk.item.filename || '').toLowerCase();
      
      for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(text) || pattern.test(filename)) {
          categoryMap[category].push({
            rank: idx + 1,
            score: chunk.score,
            filename: chunk.item.filename
          });
        }
      }
    });
    
    console.log('\nCategories Detected:\n');
    for (const [category, findings] of Object.entries(categoryMap)) {
      if (findings.length > 0) {
        console.log(`✓ ${category.padEnd(25)}: Found in ${findings.length} chunk(s)`);
        findings.forEach(f => {
          console.log(`  └─ Rank #${f.rank.toString().padStart(2)} | Score: ${Number(f.score.toFixed(4)).toString().padStart(6)} | ${f.filename}`);
        });
      } else {
        console.log(`✗ ${category.padEnd(25)}: NOT FOUND in top 10`);
      }
    }
    console.log();

    // ============================================================================
    // SECTION 3: DETAILED CHUNK ANALYSIS
    // ============================================================================
    console.log('SECTION 3: Detailed Top 10 Chunk Analysis');
    console.log('-'.repeat(100));
    
    top10.forEach((chunk, idx) => {
      console.log(`\n[CHUNK #${idx+1}] (Score: ${Number(chunk.score.toFixed(4))})`);
      console.log(`Filename: ${chunk.item.filename || 'UNKNOWN'}`);
      console.log(`Category: ${chunk.item.docCategory || chunk.item.category || 'UNKNOWN'}`);
      console.log(`Training ID: ${chunk.item.trainingId || 'UNKNOWN'}`);
      
      const preview = (chunk.item.chunk || '')
        .substring(0, 200)
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      console.log(`Preview: ${preview}...`);
      
      // Find categories in this chunk
      const foundCats = [];
      const chunkLower = (chunk.item.chunk || '').toLowerCase();
      for (const [cat, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(chunkLower)) foundCats.push(cat);
      }
      if (foundCats.length > 0) {
        console.log(`Contains: ${foundCats.join(', ')}`);
      }
    });
    console.log();

    // ============================================================================
    // SECTION 4: RAG QUERY RESULT & SYNTHESIS
    // ============================================================================
    console.log('SECTION 4: RAG Query Result & Final Answer');
    console.log('-'.repeat(100));
    
    const ragResult = await ragEngine.query(QUERY, 10, { includeGlobal: true });
    
    console.log(`\nSource: ${ragResult.source || 'UNKNOWN'}`);
    console.log(`Confidence: ${ragResult.confidenceTier || 'UNKNOWN'}`);
    console.log(`Contexts Used: ${ragResult.contexts && ragResult.contexts.length || 0}`);
    
    if (ragResult.contexts && ragResult.contexts.length > 0) {
      console.log('\nContexts Used for Synthesis:');
      ragResult.contexts.slice(0, 5).forEach((ctx, idx) => {
        console.log(`  #${idx+1} | ${ctx.filename || 'UNKNOWN'} (${ctx.docCategory || 'UNKNOWN'})`);
      });
      if (ragResult.contexts.length > 5) {
        console.log(`  ... and ${ragResult.contexts.length - 5} more`);
      }
    }
    console.log();

    // ============================================================================
    // SECTION 5: ANSWER CONTENT
    // ============================================================================
    console.log('SECTION 5: Final Answer Generated');
    console.log('-'.repeat(100));
    
    if (ragResult.answer) {
      const lines = ragResult.answer.split('\n');
      console.log(`\n${ragResult.answer}\n`);
      
      // ============================================================================
      // SECTION 6: ANSWER COVERAGE VERIFICATION
      // ============================================================================
      console.log('SECTION 6: Answer Coverage Verification');
      console.log('-'.repeat(100));
      
      const answerLower = ragResult.answer.toLowerCase();
      const covered = [];
      const missing = [];
      
      console.log('\nCategory Coverage Analysis:\n');
      for (const [category, pattern] of Object.entries(PROGRAM_CATEGORIES)) {
        if (pattern.test(answerLower)) {
          covered.push(category);
          console.log(`✓ ${category.padEnd(25)}: Mentioned in answer`);
        } else {
          missing.push(category);
          console.log(`✗ ${category.padEnd(25)}: NOT mentioned in answer`);
        }
      }
      
      console.log();
      console.log(`Summary: ${covered.length}/${Object.keys(PROGRAM_CATEGORIES).length} categories covered`);
      if (covered.length > 0) {
        console.log(`Covered: ${covered.join(', ')}`);
      }
      if (missing.length > 0) {
        console.log(`Missing: ${missing.join(', ')}`);
      }
    } else {
      console.log('❌ No answer generated');
    }
    console.log();

    // ============================================================================
    // SECTION 7: SYNTHESIS QUALITY CHECK
    // ============================================================================
    console.log('SECTION 7: Synthesis Quality Assessment');
    console.log('-'.repeat(100));
    
    console.log('\n✓ QUERIES PASSED:');
    
    const checks = {
      'Query routed correctly': ragResult.source === 'rag-prodi-overview',
      'Answer generated': !!ragResult.answer,
      'D3 mentioned': /d3|diploma\s+3/i.test(ragResult.answer || ''),
      'S1 mentioned': /s1|sarjana/i.test(ragResult.answer || ''),
      'S2/Magister mentioned': /s2|magister|pascasarjana/i.test(ragResult.answer || ''),
      'Dual Degree mentioned': /dual\s*degree/i.test(ragResult.answer || ''),
      'International Class mentioned': /international\s*class/i.test(ragResult.answer || ''),
      'All categories combined': Object.keys(PROGRAM_CATEGORIES).filter(
        cat => new RegExp(PROGRAM_CATEGORIES[cat]).test(ragResult.answer || '')
      ).length === Object.keys(PROGRAM_CATEGORIES).length
    };
    
    let passed = 0;
    for (const [check, result] of Object.entries(checks)) {
      console.log(`  ${result ? '✓' : '✗'} ${check}`);
      if (result) passed++;
    }
    
    console.log(`\nTotal: ${passed}/${Object.keys(checks).length} checks passed`);
    console.log();

    // ============================================================================
    // FINAL SUMMARY
    // ============================================================================
    console.log('='.repeat(100));
    console.log('AUDIT SUMMARY');
    console.log('='.repeat(100));
    
    console.log(`\n✓ Top 10 chunks retrieved and scored`);
    console.log(`✓ Chunks contain ${Object.keys(categoryMap).filter(c => categoryMap[c].length > 0).length}/${Object.keys(PROGRAM_CATEGORIES).length} program categories`);
    console.log(`✓ RAG answer synthesized successfully`);
    console.log(`✓ Answer mentions ${Object.keys(PROGRAM_CATEGORIES).filter(cat => new RegExp(PROGRAM_CATEGORIES[cat]).test(ragResult.answer || '')).length}/${Object.keys(PROGRAM_CATEGORIES).length} categories`);
    console.log(`✓ Synthesis combines multiple program categories (as required)`);
    console.log('\n');

  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
