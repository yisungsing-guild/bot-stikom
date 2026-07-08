/**
 * Test script to validate patches for academic RAG validator relaxation
 * Tests 6 queries with detailed output showing:
 * - source
 * - confidenceScore  
 * - top 5 contexts (id, filename, category, score, chunk preview)
 * - matchedAttributes
 * - chunkEntities
 * - final answer
 */

const ragEngine = require('./src/engine/ragEngine.js');
const path = require('path');

// Simple logger replacement
const logger = {
  level: 'WARN',
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  info: (...args) => console.log('[INFO]', ...args)
};

const TEST_QUERIES = [
  {
    query: 'Apa itu Teknologi Informasi?',
    chatId: 'test-user-1',
    sessionData: { lastProgramHint: null },
    description: 'Direct program definition query - should NOT be rejected on entity mismatch'
  },
  {
    query: 'Apa itu Sistem Informasi?',
    chatId: 'test-user-2',
    sessionData: { lastProgramHint: null },
    description: 'Direct program definition query for SI - should NOT be rejected on entity mismatch'
  },
  {
    query: 'Prospek kerja Teknologi Informasi',
    chatId: 'test-user-3',
    sessionData: { lastProgramHint: null },
    description: 'Career prospects query for TI - should NOT be rejected for missing category mention'
  },
  {
    query: 'Prospek kerja Sistem Informasi',
    chatId: 'test-user-4',
    sessionData: { lastProgramHint: null },
    description: 'Career prospects query for SI - should NOT be rejected for missing category mention'
  },
  {
    query: 'Apa itu Teknologi Informasi?\nBagaimana prospek kerjanya?',
    chatId: 'test-user-5',
    sessionData: { lastProgramHint: 'Teknologi Informasi' },
    description: 'Follow-up question with session program hint - should retain TI context in follow-up'
  },
  {
    query: 'Double Degree Nasional\nKampus partnernya apa saja?',
    chatId: 'test-user-6',
    sessionData: { lastProgramHint: 'Double Degree Nasional' },
    description: 'Follow-up for DDN partners - should retain program context'
  }
];

async function formatContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return { top5: [], summary: 'No contexts' };
  }

  const top5 = contexts.slice(0, 5).map((ctx, idx) => ({
    rank: idx + 1,
    id: ctx.id || 'unknown',
    filename: ctx.filename || 'unknown',
    category: ctx.category || 'unknown',
    score: typeof ctx.score === 'number' ? ctx.score.toFixed(4) : 'N/A',
    chunkPreview: ctx.chunk ? ctx.chunk.substring(0, 150) + (ctx.chunk.length > 150 ? '...' : '') : 'No chunk'
  }));

  return { top5 };
}

function extractChunkEntities(chunk) {
  const entities = {
    programs: [],
    keywords: []
  };

  if (!chunk) return entities;

  const programPatterns = {
    TI: /teknologi\s+informasi|ti\b/gi,
    SI: /sistem\s+informasi|si\b/gi,
    BD: /bisnis\s+digital|bd\b/gi,
    SK: /sistem\s+komputer|sk\b/gi,
    MI: /manajemen\s+informatika|mi\b/gi,
    DKV: /desain\s+komunikasi\s+visual|dkv\b/gi,
    TRPL: /teknologi\s+rekayasa\s+perangkat\s+lunak|trpl\b/gi,
    DDN: /double\s+degree\s+nasional|ddn\b/gi
  };

  for (const [abbr, pattern] of Object.entries(programPatterns)) {
    if (pattern.test(chunk)) {
      entities.programs.push(abbr);
    }
  }

  // Extract some keywords
  const keywords = chunk.match(/\b(prospek|karir|peluang|lowongan|biaya|kurikulum|matakuliah|dosen|fasilitas|kampus)\b/gi) || [];
  entities.keywords = [...new Set(keywords.map(k => k.toLowerCase()))];

  return entities;
}

async function testSingleQuery(testCase, index) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST ${index + 1}/6: ${testCase.description}`);
  console.log(`Query: "${testCase.query}"`);
  console.log(`Session Hint: ${testCase.sessionData.lastProgramHint || 'None'}`);
  console.log(`${'='.repeat(80)}`);

  try {
    // Call RAG engine - using the correct function name from exports
    const result = await ragEngine.query(testCase.query, 8, {
      conversationContext: '',
      answerQuestion: testCase.query,
      sessionData: testCase.sessionData
    });

    console.log(`\n✓ RESULT SUMMARY:`);
    console.log(`  Source: ${result.source}`);
    console.log(`  Confidence Tier: ${result.confidenceTier}`);
    console.log(`  Confidence Score: ${result.confidenceScore ? result.confidenceScore.toFixed(4) : 'N/A'}`);
    console.log(`  Valid: ${result.valid}`);
    
    if (result.rejectionReason) {
      console.log(`  ❌ Rejection Reason: ${result.rejectionReason}`);
    }

    // Format contexts
    if (result.contexts && result.contexts.length > 0) {
      console.log(`\n📚 TOP 5 CONTEXTS (${result.contexts.length} total retrieved):`);
      const contextInfo = await formatContexts(result.contexts);
      contextInfo.top5.forEach(ctx => {
        console.log(`  [${ctx.rank}] ${ctx.filename} (${ctx.category}) - Score: ${ctx.score}`);
        console.log(`      ID: ${ctx.id}`);
        console.log(`      Preview: ${ctx.chunkPreview}`);

        // Extract entities from this chunk
        const entities = extractChunkEntities(ctx.chunkPreview);
        if (entities.programs.length > 0) {
          console.log(`      Programs: ${entities.programs.join(', ')}`);
        }
        console.log();
      });
    }

    // Extract matched attributes
    const allEntities = result.contexts
      ? result.contexts.flatMap(c => extractChunkEntities(c.chunk || ''))
      : [];
    const uniquePrograms = [...new Set(allEntities.flatMap(e => e.programs))];
    const uniqueKeywords = [...new Set(allEntities.flatMap(e => e.keywords))];

    console.log(`\n🔍 MATCHED ATTRIBUTES:`);
    console.log(`  Programs found: ${uniquePrograms.length > 0 ? uniquePrograms.join(', ') : 'None'}`);
    console.log(`  Keywords found: ${uniqueKeywords.length > 0 ? uniqueKeywords.join(', ') : 'None'}`);

    console.log(`\n💬 FINAL ANSWER:`);
    const answer = result.answer || result.jawaban || 'No answer generated';
    console.log(answer.substring(0, 500) + (answer.length > 500 ? '\n... (truncated)' : ''));

    return {
      testIndex: index,
      query: testCase.query,
      success: !result.rejectionReason,
      source: result.source,
      confidenceScore: result.confidenceScore,
      contexts: result.contexts ? result.contexts.length : 0,
      rejection: result.rejectionReason
    };
  } catch (err) {
    console.error(`\n❌ ERROR: ${err.message}`);
    return {
      testIndex: index,
      query: testCase.query,
      success: false,
      error: err.message
    };
  }
}

async function main() {
  console.log(`\n${'#'.repeat(80)}`);
  console.log('ACADEMIC RAG VALIDATOR PATCH VERIFICATION');
  console.log(`${'#'.repeat(80)}\n`);

  const results = [];

  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const result = await testSingleQuery(TEST_QUERIES[i], i);
    results.push(result);
    
    // Add delay between tests to avoid overwhelming the system
    if (i < TEST_QUERIES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary
  console.log(`\n${'#'.repeat(80)}`);
  console.log('SUMMARY');
  console.log(`${'#'.repeat(80)}\n`);

  const successCount = results.filter(r => r.success).length;
  console.log(`✓ Success Rate: ${successCount}/${results.length}`);

  results.forEach((r, idx) => {
    const status = r.success ? '✓' : '❌';
    console.log(`${status} Query ${idx + 1}: ${r.query.substring(0, 50)}${r.query.length > 50 ? '...' : ''}`);
    if (!r.success) {
      console.log(`   Issue: ${r.rejection || r.error || 'Unknown error'}`);
    } else {
      console.log(`   Source: ${r.source}, Confidence: ${r.confidenceScore ? r.confidenceScore.toFixed(4) : 'N/A'}, Contexts: ${r.contexts}`);
    }
  });

  console.log(`\n${'#'.repeat(80)}`);
}

main().catch(err => {
  console.error('FATAL ERROR:', err);
  process.exit(1);
});
