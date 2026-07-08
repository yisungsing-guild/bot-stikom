/**
 * End-to-End Provider Route Test
 * Tests full production flow: provider.js → session → follow-up rewrite → ragEngine → outbound composer
 * 
 * Queries tested:
 * 1. Apa itu Teknologi Informasi?
 * 2. Apa itu Sistem Informasi?
 * 3. Prospek kerja Teknologi Informasi
 * 4. Prospek kerja Sistem Informasi
 * 5. Apa perbedaan TI dan SI?
 * 6. [Follow-up] Bagaimana prospek kerjanya?
 * 7. Berapa lama kuliahnya?
 * 8. Apa mata kuliah yang dipelajari?
 */

const ragEngine = require('./src/engine/ragEngine.js');
const path = require('path');
const fs = require('fs');

// Mock provider adapter
const mockProvider = {
  name: 'TEST_PROVIDER',
  sendMessage: async (chatId, text) => {
    console.log(`[PROVIDER] Sending to ${chatId}: ${text.substring(0, 100)}`);
    return { success: true };
  }
};

// In-memory session storage
const sessions = new Map();

function getOrCreateSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      chatId,
      createdAt: new Date(),
      lastInteractionAt: new Date(),
      conversationHistory: [],
      lastProgramHint: null,
      lastRagResult: null,
      followupPending: false
    });
  }
  return sessions.get(chatId);
}

function updateSession(chatId, updates) {
  const session = getOrCreateSession(chatId);
  Object.assign(session, updates);
  session.lastInteractionAt = new Date();
}

// Simulate follow-up detection and rewrite (from provider.js logic)
function shouldRewriteFollowup(question, session) {
  const q = String(question || '').toLowerCase().trim();
  
  // Follow-up indicators
  if (/^(bagaimana|berapa|apa|dimana|mana|kapan|siapa|mengapa|kemarin|ini|itu|dia|mereka)\b/.test(q)) {
    return true;
  }
  
  return false;
}

function rewriteFollowupWithProgramHint(question, session) {
  if (!session || !session.lastProgramHint) {
    return question;
  }
  
  const hint = session.lastProgramHint;
  const q = String(question || '').toLowerCase();
  
  // If question already has program name, don't rewrite
  if (/teknologi informasi|sistem informasi|bisnis digital|sistem komputer|ti\b|si\b|bd\b|sk\b/i.test(q)) {
    return question;
  }
  
  // Anchor follow-up with program hint
  const rewritten = `Program Studi: ${hint}\n${question}`;
  console.log(`[FOLLOW-UP REWRITE] "${question}" → "${rewritten}"`);
  return rewritten;
}

// Extract program hint from question
function extractProgramHintFromQuestion(question) {
  const q = String(question || '').toLowerCase();
  
  if (/teknologi\s+informasi|ti\b/.test(q)) return 'Teknologi Informasi';
  if (/sistem\s+informasi|si\b/.test(q)) return 'Sistem Informasi';
  if (/bisnis\s+digital|bd\b/.test(q)) return 'Bisnis Digital';
  if (/sistem\s+komputer|sk\b/.test(q)) return 'Sistem Komputer';
  
  return null;
}

// Format output
function formatContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return [];
  }
  
  return contexts.slice(0, 5).map((ctx, idx) => ({
    rank: idx + 1,
    id: ctx.id || 'unknown',
    filename: ctx.filename || 'unknown',
    category: ctx.category || 'unknown',
    score: typeof ctx.score === 'number' ? ctx.score.toFixed(4) : 'N/A',
    preview: ctx.chunk ? ctx.chunk.substring(0, 120).replace(/\n/g, ' ').trim() : 'No chunk'
  }));
}

function extractAttributes(ragResult) {
  const attrs = {};
  
  // Extract from contexts
  if (ragResult.contexts && Array.isArray(ragResult.contexts)) {
    const programs = new Set();
    for (const ctx of ragResult.contexts) {
      if (ctx.chunk) {
        const programMatches = ctx.chunk.match(/teknologi\s+informasi|sistem\s+informasi|bisnis\s+digital|sistem\s+komputer|ti\b|si\b|bd\b|sk\b/gi);
        if (programMatches) {
          programMatches.forEach(p => programs.add(p.toUpperCase()));
        }
      }
    }
    attrs.programs = Array.from(programs);
  }
  
  // Extract keywords
  if (ragResult.answer) {
    const keywords = ragResult.answer.match(/\b(prospek|karir|peluang|lowongan|biaya|kurikulum|semester|mata kuliah|dosen|fasilitas)\b/gi) || [];
    attrs.keywords = [...new Set(keywords.map(k => k.toUpperCase()))];
  }
  
  return attrs;
}

// Main test function
async function runE2EProviderTest() {
  console.log('\n' + '='.repeat(100));
  console.log('END-TO-END PROVIDER TEST - POST-VALIDATOR PATCHES');
  console.log('='.repeat(100) + '\n');

  const TEST_QUERIES = [
    {
      id: 1,
      chatId: 'user-001',
      query: 'Apa itu Teknologi Informasi?',
      description: 'Direct program definition - TI',
      isFollowup: false
    },
    {
      id: 2,
      chatId: 'user-002',
      query: 'Apa itu Sistem Informasi?',
      description: 'Direct program definition - SI',
      isFollowup: false
    },
    {
      id: 3,
      chatId: 'user-003',
      query: 'Prospek kerja Teknologi Informasi',
      description: 'Career prospects - TI (CRITICAL TEST)',
      isFollowup: false
    },
    {
      id: 4,
      chatId: 'user-004',
      query: 'Prospek kerja Sistem Informasi',
      description: 'Career prospects - SI (CRITICAL TEST)',
      isFollowup: false
    },
    {
      id: 5,
      chatId: 'user-005',
      query: 'Apa perbedaan TI dan SI?',
      description: 'Program comparison',
      isFollowup: false
    },
    {
      id: 6,
      chatId: 'user-001', // Same user as query 1
      query: 'Bagaimana prospek kerjanya?',
      description: 'Follow-up with session program hint (TI)',
      isFollowup: true
    },
    {
      id: 7,
      chatId: 'user-001', // Continue same session
      query: 'Berapa lama kuliahnya?',
      description: 'Follow-up - program duration',
      isFollowup: true
    },
    {
      id: 8,
      chatId: 'user-001', // Continue same session
      query: 'Apa mata kuliah yang dipelajari?',
      description: 'Follow-up - curriculum',
      isFollowup: true
    }
  ];

  const results = [];
  let failureCount = 0;

  for (const test of TEST_QUERIES) {
    console.log(`\n${'─'.repeat(100)}`);
    console.log(`TEST ${test.id}/8: ${test.description}`);
    console.log(`ChatID: ${test.chatId} | Query: "${test.query}"`);
    console.log(`${'─'.repeat(100)}\n`);

    try {
      // Get or create session
      const session = getOrCreateSession(test.chatId);
      
      // Detect follow-up and rewrite if needed
      let finalQuery = test.query;
      if (test.isFollowup && shouldRewriteFollowup(test.query, session)) {
        finalQuery = rewriteFollowupWithProgramHint(test.query, session);
        console.log(`[FOLLOW-UP DETECTED] Original: "${test.query}"`);
        console.log(`[REWRITTEN QUERY] "${finalQuery}\n`);
      }

      // Call RAG engine (production query path)
      const ragResult = await ragEngine.query(finalQuery, 8, {
        conversationContext: session.conversationHistory.join('\n'),
        answerQuestion: test.query,
        sessionData: session,
        minScore: 0.4,
        strict: false
      });

      // Check for failures
      const isFailed = !ragResult.success || 
        !ragResult.answer || 
        ragResult.source === 'rag-answer-rejected' || 
        ragResult.source === 'rag-no-relevant-academic-context' ||
        ragResult.source === 'rag-no-match';

      if (isFailed) {
        failureCount++;
      }

      // Extract program hint from successful responses
      if (ragResult.success && ragResult.answer) {
        const progHint = extractProgramHintFromQuestion(test.query);
        if (progHint) {
          updateSession(test.chatId, { lastProgramHint: progHint });
          console.log(`[SESSION] Program hint saved: ${progHint}`);
        }
      }

      // Update session history
      session.conversationHistory.push(`User: ${test.query}`);
      if (ragResult.answer) {
        session.conversationHistory.push(`Bot: ${ragResult.answer.substring(0, 200)}`);
      }
      session.lastRagResult = ragResult;

      // Format output
      const formattedContexts = formatContexts(ragResult.contexts);
      const attributes = extractAttributes(ragResult);

      const result = {
        testId: test.id,
        chatId: test.chatId,
        query: test.query,
        isFollowup: test.isFollowup,
        isFailed: isFailed,
        description: test.description,
        source: ragResult.source,
        confidenceScore: ragResult.confidenceScore ? ragResult.confidenceScore.toFixed(4) : 'N/A',
        confidenceTier: ragResult.confidenceTier || 'UNKNOWN',
        outboundText: ragResult.answer ? ragResult.answer.substring(0, 500) : '[NO ANSWER]',
        contextCount: ragResult.contexts ? ragResult.contexts.length : 0,
        topContexts: formattedContexts,
        matchedAttributes: attributes,
        rejectionReason: ragResult.rejectionReason || null,
        debugInfo: ragResult.debug || null
      };

      results.push(result);

      // Print result
      console.log(`✓ RESULT:`);
      console.log(`  Source: ${result.source}`);
      console.log(`  Confidence: ${result.confidenceScore} (${result.confidenceTier})`);
      console.log(`  Contexts Retrieved: ${result.contextCount}`);
      console.log(`  Answer Length: ${result.outboundText.length} chars`);
      console.log(`  Status: ${result.isFailed ? '❌ FAILED' : '✅ PASS'}`);
      
      if (result.isFailed) {
        console.log(`  Failure Reason: ${result.rejectionReason || result.source}`);
      }

      console.log(`\n📚 TOP 5 CONTEXTS:`);
      if (result.topContexts.length === 0) {
        console.log(`  [No contexts retrieved]`);
      } else {
        result.topContexts.forEach(ctx => {
          console.log(`  [${ctx.rank}] ${ctx.filename || 'unknown'} (${ctx.category})`);
          console.log(`      ID: ${ctx.id.substring(0, 30)}...`);
          console.log(`      Score: ${ctx.score}`);
          console.log(`      Preview: ${ctx.preview.substring(0, 80)}...`);
        });
      }

      console.log(`\n🏷️  MATCHED ATTRIBUTES:`);
      console.log(`  Programs: ${result.matchedAttributes.programs && result.matchedAttributes.programs.length > 0 ? result.matchedAttributes.programs.join(', ') : 'None'}`);
      console.log(`  Keywords: ${result.matchedAttributes.keywords && result.matchedAttributes.keywords.length > 0 ? result.matchedAttributes.keywords.join(', ') : 'None'}`);

      console.log(`\n💬 OUTBOUND TEXT (First 300 chars):`);
      console.log(`  ${result.outboundText.substring(0, 300)}${result.outboundText.length > 300 ? '...' : ''}`);

    } catch (err) {
      failureCount++;
      console.error(`❌ TEST FAILED WITH ERROR:`);
      console.error(`  ${err.message}`);
      console.error(`  ${err.stack}`);

      results.push({
        testId: test.id,
        chatId: test.chatId,
        query: test.query,
        isFailed: true,
        error: err.message,
        source: 'INTERNAL_ERROR'
      });
    }

    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Summary
  console.log(`\n${'='.repeat(100)}`);
  console.log('SUMMARY');
  console.log(`${'='.repeat(100)}\n`);

  const passCount = results.length - failureCount;
  console.log(`✅ PASS: ${passCount}/${results.length}`);
  console.log(`❌ FAIL: ${failureCount}/${results.length}`);

  if (failureCount > 0) {
    console.log(`\n🔴 FAILED TESTS:`);
    results.filter(r => r.isFailed).forEach(r => {
      console.log(`\n  Test ${r.testId}: "${r.query.substring(0, 50)}"`);
      console.log(`    Source: ${r.source}`);
      if (r.error) {
        console.log(`    Error: ${r.error}`);
      } else {
        console.log(`    Reason: ${r.rejectionReason || 'Unknown'}`);
      }
    });
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log('DETAILED RESULTS');
  console.log(`${'='.repeat(100)}\n`);

  results.forEach((r, idx) => {
    console.log(`\n${idx + 1}. ${r.description || 'Test ' + r.testId}`);
    console.log(`   Query: "${r.query}"`);
    console.log(`   Source: ${r.source}`);
    console.log(`   Confidence: ${r.confidenceScore}`);
    console.log(`   Status: ${r.isFailed ? '❌ FAILED' : '✅ PASS'}`);
    console.log(`   Contexts: ${r.contextCount}`);
  });

  // Save to JSON
  const outputFile = path.join(__dirname, 'e2e-provider-results.json');
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\n✓ Results saved to: e2e-provider-results.json`);

  return {
    totalTests: results.length,
    passedTests: passCount,
    failedTests: failureCount,
    results
  };
}

// Run test
runE2EProviderTest()
  .then(summary => {
    console.log(`\n✓ E2E Provider Test Complete`);
    process.exit(summary.failedTests > 0 ? 1 : 0);
  })
  .catch(err => {
    console.error('FATAL ERROR:', err);
    process.exit(1);
  });
