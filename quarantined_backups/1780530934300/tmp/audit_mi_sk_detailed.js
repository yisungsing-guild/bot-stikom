/**
 * Detailed audit for MI retrieval and SK curriculum
 * - Count chunks per program and category
 * - Debug MI retrieval (3 queries)
 * - Debug SK mata kuliah with top 20 contexts
 */

const fs = require('fs');
const path = require('path');

// Load index directly
function loadIndex() {
  const indexPath = process.env.RAG_INDEX_PATH || path.join(__dirname, '../src/data/rag_index.json');
  try {
    const content = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    console.error('[AUDIT] Failed to load index:', e.message);
    return [];
  }
}

// Count chunks by program and category
function auditChunksByProgramAndCategory() {
  const index = loadIndex();
  console.log('\n========== AUDIT: INDEX STATISTICS ==========\n');
  console.log(`Total chunks in index: ${index.length}\n`);

  // Group by program
  const byProgram = {};
  const byCategory = {};
  const byProgramAndCategory = {};

  for (const chunk of index) {
    const prog = chunk.program || 'UNKNOWN';
    const cat = chunk.category || 'UNKNOWN';
    const key = `${prog}|${cat}`;

    byProgram[prog] = (byProgram[prog] || 0) + 1;
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    byProgramAndCategory[key] = (byProgramAndCategory[key] || 0) + 1;
  }

  console.log('=== Chunks by Program ===');
  Object.keys(byProgram)
    .sort((a, b) => byProgram[b] - byProgram[a])
    .forEach(prog => {
      console.log(`${prog}: ${byProgram[prog]}`);
    });

  console.log('\n=== Chunks by Category ===');
  Object.keys(byCategory)
    .sort((a, b) => byCategory[b] - byCategory[a])
    .forEach(cat => {
      console.log(`${cat}: ${byCategory[cat]}`);
    });

  console.log('\n=== Chunks by Program & Category ===');
  const programs = ['TI', 'SI', 'SK', 'BD', 'MI'];
  const categories = [
    'DEFINISI_PRODI',
    'KURIKULUM',
    'MATA_KULIAH',
    'KARIR',
    'PROSPEK_KERJA',
    'BIAYA'
  ];

  for (const prog of programs) {
    console.log(`\n${prog}:`);
    for (const cat of categories) {
      const key = `${prog}|${cat}`;
      const count = byProgramAndCategory[key] || 0;
      if (count > 0) {
        console.log(`  - ${cat}: ${count}`);
      }
    }
  }

  // Show MI chunks in detail
  console.log('\n=== MI Chunks Detail ===');
  const miChunks = index.filter(c => c.program === 'MI');
  console.log(`Total MI chunks: ${miChunks.length}`);
  if (miChunks.length > 0) {
    console.log('MI chunk list:');
    miChunks.forEach((c, idx) => {
      console.log(
        `  [${idx}] ID: ${c.id}, Category: ${c.category}, Filename: ${c.filename}, Score: ${c.totalScore}`
      );
    });
  }

  return {
    byProgram,
    byCategory,
    byProgramAndCategory,
    miChunks
  };
}

// Simulate retrieval for a query
async function debugRetrievalForQuery(query, program, category) {
  console.log(`\n========== DEBUG RETRIEVAL ==========`);
  console.log(`Query: "${query}"`);
  console.log(`Expected Program: ${program}`);
  console.log(`Expected Category: ${category}`);
  console.log(`==========================================\n`);

  // Load RAG engine to get normalizeProgramLabel, etc
  try {
    const ragEngine = require('../src/engine/ragEngine');
    const result = await ragEngine.ragQueryWithEval(query, {
      returnDebug: true,
      topK: 20
    });

    if (!result) {
      console.log('[AUDIT] ragQueryWithEval returned null/undefined');
      return;
    }

    console.log(`[AUDIT] Returned source: ${result.source}`);
    console.log(`[AUDIT] Returned success: ${result.success}`);
    console.log(`[AUDIT] Answer length: ${result.answer ? result.answer.length : 0}`);
    console.log(`[AUDIT] Confidence tier: ${result.confidenceTier}`);
    console.log(`[AUDIT] Confidence score: ${result.confidenceScore}`);

    if (result.debug) {
      console.log(`[AUDIT] Query Entities:`);
      if (result.debug.entity) {
        console.log(`  - program: ${result.debug.entity.program}`);
        console.log(`  - category: ${result.debug.entity.category}`);
        console.log(`  - intent: ${result.debug.entity.intent}`);
        console.log(`  - academicIntent: ${result.debug.entity.academicIntent}`);
      }
    }

    console.log(`\n[AUDIT] Returned contexts count: ${result.contexts ? result.contexts.length : 0}`);

    if (result.contexts && result.contexts.length > 0) {
      console.log('\n[AUDIT] Top Contexts (up to 20):');
      result.contexts.slice(0, 20).forEach((ctx, idx) => {
        const preview = ctx.chunk
          ? ctx.chunk.substring(0, 100).replace(/\n/g, ' ').trim() + '...'
          : '(no chunk text)';
        console.log(
          `  [${idx + 1}] ID: ${ctx.id}`
        );
        console.log(
          `       Filename: ${ctx.filename || 'N/A'}`
        );
        console.log(
          `       Score: ${ctx.totalScore !== undefined ? ctx.totalScore : ctx.score || 'N/A'}`
        );
        console.log(
          `       Program: ${ctx.program || 'N/A'}`
        );
        console.log(
          `       Category: ${ctx.category || 'N/A'}`
        );
        console.log(
          `       Preview: ${preview}`
        );
      });
    } else {
      console.log('[AUDIT] NO CONTEXTS RETURNED');
    }

    // Show validation details if available
    if (result.debug && result.debug.validation) {
      console.log(`\n[AUDIT] Validation Results:`);
      console.log(JSON.stringify(result.debug.validation, null, 2));
    }

    // Show rejection reason if rejected
    if (result.debug && result.debug.rejectionReason) {
      console.log(`\n[AUDIT] Rejection Reason: ${result.debug.rejectionReason}`);
    }

    return result;
  } catch (e) {
    console.error('[AUDIT] Error during retrieval debug:', e.message);
    console.error(e.stack);
  }
}

// Main audit flow
async function runAudit() {
  console.log('🔍 DETAILED AUDIT: MI RETRIEVAL AND SK CURRICULUM\n');

  // Step 1: Audit index statistics
  console.log('STEP 1: Index Statistics');
  const stats = auditChunksByProgramAndCategory();

  // Step 2: Debug MI queries
  console.log('\n\n' + '='.repeat(60));
  console.log('STEP 2: Debug MI Queries Retrieval');
  console.log('='.repeat(60));

  const miQueries = [
    { q: 'Apa itu Manajemen Informasi?', prog: 'MI', cat: 'DEFINISI_PRODI' },
    { q: 'Prospek kerja Manajemen Informasi?', prog: 'MI', cat: 'KARIR' },
    { q: 'Mata kuliah Manajemen Informasi?', prog: 'MI', cat: 'KURIKULUM' }
  ];

  const miResults = [];
  for (const { q, prog, cat } of miQueries) {
    const result = await debugRetrievalForQuery(q, prog, cat);
    miResults.push({ query: q, result });
    console.log('\n');
  }

  // Step 3: Debug SK mata kuliah with top 20
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: Debug SK Mata Kuliah Retrieval (Top 20)');
  console.log('='.repeat(60));

  const skResult = await debugRetrievalForQuery(
    'Mata kuliah Sistem Komputer',
    'SK',
    'KURIKULUM'
  );

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));

  console.log('\n📊 MI Chunks in Index:');
  console.log(`  Total: ${stats.miChunks.length}`);
  if (stats.miChunks.length === 0) {
    console.log('  ⚠️  NO MI CHUNKS FOUND - This is the root cause!');
  } else {
    console.log('  Chunks found:');
    stats.miChunks.forEach(c => {
      console.log(`    - ${c.filename || 'N/A'} (${c.category})`);
    });
  }

  console.log('\n📊 MI Query Results:');
  miResults.forEach(({ query, result }) => {
    const status =
      result && result.contexts && result.contexts.length > 0 ? '✅ Found' : '❌ None';
    const source = result ? result.source : 'ERROR';
    console.log(
      `  "${query}" → ${status} (source: ${source}, contexts: ${
        result && result.contexts ? result.contexts.length : 0
      })`
    );
  });

  console.log('\n📊 SK Mata Kuliah Result:');
  if (skResult) {
    console.log(
      `  Source: ${skResult.source}`
    );
    console.log(
      `  Contexts: ${skResult.contexts ? skResult.contexts.length : 0}`
    );
    console.log(
      `  Confidence: ${skResult.confidenceTier} (score: ${skResult.confidenceScore})`
    );

    // Check if contexts look like curriculum or just profile
    if (skResult.contexts && skResult.contexts.length > 0) {
      const hasKurikulum = skResult.contexts.some(c =>
        (c.category || '').includes('KURIKULUM') || (c.category || '').includes('MATA_KULIAH')
      );
      const hasProfile = skResult.contexts.some(c =>
        (c.category || '').includes('DEFINISI') || (c.filename || '').includes('Penjelasan')
      );
      console.log(
        `  Has KURIKULUM category: ${hasKurikulum ? '✅ Yes' : '❌ No'}`
      );
      console.log(
        `  Has DEFINISI/profile: ${hasProfile ? '✅ Yes' : '❌ No'}`
      );
    }
  }

  // Export detailed JSON
  const auditOutput = {
    timestamp: new Date().toISOString(),
    statistics: stats,
    miQueries: miResults.map(r => ({
      query: r.query,
      source: r.result ? r.result.source : null,
      contextCount: r.result && r.result.contexts ? r.result.contexts.length : 0,
      confidenceScore: r.result ? r.result.confidenceScore : null,
      confidenceTier: r.result ? r.result.confidenceTier : null
    })),
    skMataKuliahQuery: {
      query: 'Mata kuliah Sistem Komputer',
      source: skResult ? skResult.source : null,
      contextCount: skResult && skResult.contexts ? skResult.contexts.length : 0,
      confidenceScore: skResult ? skResult.confidenceScore : null,
      confidenceTier: skResult ? skResult.confidenceTier : null
    }
  };

  const outputPath = path.join(__dirname, 'audit_mi_sk_detailed_output.json');
  fs.writeFileSync(outputPath, JSON.stringify(auditOutput, null, 2), 'utf8');
  console.log(`\n✅ Audit output saved to: ${outputPath}`);
}

// Run
runAudit().catch(e => {
  console.error('Audit failed:', e);
  process.exit(1);
});
