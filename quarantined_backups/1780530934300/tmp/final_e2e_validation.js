const express = require('express');
const fetch = global.fetch || require('node-fetch');

// Disable webhook token check for local test
process.env.PROVIDER_WEBHOOK_TOKEN = '';

const providerFactory = require('../src/routes/provider');

// Track messages sent
const sentMessages = [];

const provider = {
  sendMessage: async (chatId, text) => {
    sentMessages.push({ chatId, text, timestamp: Date.now() });
    return true;
  }
};

const testQueries = [
  'apa itu SI?',
  'di SI belajar apa?',
  'prospek kerja SI?',
  'lulusan TI bekerja dimana?',
  'apa itu TI?',
  'apa itu SK?',
  'apa itu BD?',
  'Biaya SI sebelumnya. Pertanyaan user saat ini: apa itu SI?'
];

const results = [];

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/provider', providerFactory(provider));

  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`\n${'='.repeat(90)}`);
    console.log('E2E PROVIDER WEBHOOK VALIDATION - FINAL TEST');
    console.log(`${'='.repeat(90)}\n`);

    for (const query of testQueries) {
      console.log(`\nTesting: "${query}"`);
      console.log('-'.repeat(90));
      
      // Clear previous messages
      sentMessages.length = 0;
      global.__provider_debug_decisions = [];
      
      try {
        const resp = await fetch(`http://127.0.0.1:${port}/provider/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chatId: '62812345678',
            text: query,
            id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            timestamp: Date.now()
          })
        });

        // Wait a bit for async message sending
        await new Promise(r => setTimeout(r, 500));

        // Get debug decisions
        const debugDecisions = global.__provider_debug_decisions || [];
        const lastDecision = debugDecisions.length > 0 ? debugDecisions[debugDecisions.length - 1] : null;

        // Get sent message
        const lastMessage = sentMessages.length > 0 ? sentMessages[sentMessages.length - 1] : null;
        const messageText = lastMessage ? String(lastMessage.text || '') : '';

        // Extract info
        const intent = lastDecision ? lastDecision.intent : 'N/A';
        const isFeeQuestion = lastDecision ? lastDecision.isFeeQuestion : false;
        const selectedRoute = lastDecision ? lastDecision.selectedRoute : 'N/A';
        const detectedProgram = lastDecision ? lastDecision.detectedProgram : 'N/A';

        // Check for fee keywords in response
        const hasFeeKeywords = /\b(biaya|uang\s+kuliah|ukt|spp|dpp|registrasi|semester|cicil|pembayaran)\b/i.test(messageText);
        const messagePreview = messageText.substring(0, 100).replace(/\n/g, ' ');

        // Determine if content is appropriate
        const isOverviewQuery = /^(apa itu|di .* belajar apa|prospek kerja|lulusan .* bekerja|^Biaya.*apa itu)/.test(query);
        const isAppropriate = isOverviewQuery && !hasFeeKeywords;

        const result = {
          query,
          intent,
          isFeeQuestion,
          selectedRoute,
          detectedProgram,
          hasFeeKeywords,
          messagePreview,
          isAppropriate,
          fullMessage: messageText
        };

        results.push(result);

        // Print result
        const statusIcon = isAppropriate ? '✓' : '✗';
        console.log(`${statusIcon} Intent: ${intent}`);
        console.log(`${statusIcon} Fee Question: ${isFeeQuestion}`);
        console.log(`${statusIcon} Selected Route: ${selectedRoute}`);
        console.log(`${statusIcon} Program: ${detectedProgram}`);
        console.log(`${statusIcon} Fee Keywords: ${hasFeeKeywords ? 'YES ⚠️' : 'NO'}`);
        console.log(`${statusIcon} Message: "${messagePreview}${messageText.length > 100 ? '...' : ''}"`);

      } catch (e) {
        console.error(`✗ Error: ${e.message}`);
        results.push({ query, error: e.message });
      }

      // Small delay between requests
      await new Promise(r => setTimeout(r, 300));
    }

    server.close();

    // Print summary
    console.log(`\n${'='.repeat(90)}`);
    console.log('VALIDATION SUMMARY');
    console.log(`${'='.repeat(90)}\n`);

    const passing = results.filter(r => !r.error && r.isAppropriate);
    const failing = results.filter(r => r.error || !r.isAppropriate);

    console.log(`✓ Passing: ${passing.length}/${results.length}`);
    console.log(`✗ Failing: ${failing.length}/${results.length}\n`);

    if (failing.length > 0) {
      console.log('Failing Tests:');
      for (const test of failing) {
        if (test.error) {
          console.log(`  ✗ "${test.query}": ${test.error}`);
        } else if (test.hasFeeKeywords) {
          console.log(`  ✗ "${test.query}": Fee keywords detected`);
          console.log(`     Route: ${test.selectedRoute}`);
          console.log(`     Message: ${test.messagePreview}`);
        }
      }
      console.log('');
    }

    // Show results table
    console.log('Results Summary:\n');
    console.log('Query'.padEnd(50) + ' | Intent | Fee Q | Fee Keywords | Status');
    console.log('-'.repeat(100));
    for (const r of results) {
      const q = (r.query || '').substring(0, 48).padEnd(50);
      const i = (r.intent || 'N/A').padEnd(7);
      const feeQ = (String(r.isFeeQuestion)).padEnd(6);
      const feeK = r.hasFeeKeywords ? '✗ YES' : '✓ NO ';
      const status = r.isAppropriate ? '✓ PASS' : '✗ FAIL';
      console.log(`${q} | ${i} | ${feeQ} | ${feeK}     | ${status}`);
    }

    // Final confirmation
    console.log(`\n${'='.repeat(90)}`);
    if (failing.length === 0) {
      console.log('✅ ALL TESTS PASSED');
      console.log('');
      console.log('✓ Bug Fix Confirmed:');
      console.log('  "overview query answered with fee information"');
      console.log('  has been FULLY RESOLVED.');
      console.log('');
      console.log('✓ All 8 test queries returned appropriate content:');
      for (const r of results) {
        if (r.query.includes('sebelumnya')) {
          console.log(`  • Anchored follow-up correctly handled: intent=${r.intent}, no fee content`);
        } else {
          console.log(`  • ${r.query.substring(0, 40)}`);
        }
      }
      console.log('='.repeat(90) + '\n');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - Further investigation needed.');
      console.log('='.repeat(90) + '\n');
      process.exit(1);
    }
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });
})();
