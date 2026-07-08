/**
 * Final E2E validation: Provider webhook flow for overview queries
 * Captures: detectIntent, selected route, rag source, outbound text
 */

const express = require('express');
const bodyParser = require('body-parser');
const logger = require('../src/logger');

// Setup minimal express server
const app = express();
app.use(bodyParser.json());

// Import provider route
const providerRoute = require('../src/routes/provider');

// Setup route
app.post('/webhook/provider', providerRoute);

// Test queries
const testQueries = [
  'apa itu SI?',
  'di SI belajar apa?',
  'prospek kerja SI?',
  'lulusan TI bekerja dimana?',
  'apa itu TI?',
  'apa itu SK?',
  'apa itu BD?',
  'Biaya SI sebelumnya. Pertanyaan user saat ini: apa itu SI?' // anchored follow-up
];

const results = [];

async function runTest() {
  for (const query of testQueries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${query}`);
    console.log('='.repeat(80));

    // Simulate webhook request body
    const payload = {
      from: '62812345678',
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      type: 'text',
      text: {
        body: query
      }
    };

    // Create mock request/response
    const mockReq = {
      body: payload,
      headers: {}
    };

    const mockRes = {
      statusCode: 200,
      jsonData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.jsonData = data;
        return this;
      }
    };

    // Clear debug decisions before test
    global.__provider_debug_decisions = [];

    try {
      // Call provider handler
      await providerRoute(mockReq, mockRes);

      // Extract response
      const response = mockRes.jsonData;
      
      // Extract debug info
      const debugDecisions = global.__provider_debug_decisions || [];
      const lastDecision = debugDecisions.length > 0 ? debugDecisions[debugDecisions.length - 1] : null;

      // Build result object
      const result = {
        query,
        status: mockRes.statusCode,
        intent: lastDecision ? lastDecision.intent : 'N/A',
        isFeeQuestion: lastDecision ? lastDecision.isFeeQuestion : 'N/A',
        selectedRoute: lastDecision ? lastDecision.selectedRoute : 'N/A',
        detectedProgram: lastDecision ? lastDecision.detectedProgram : 'N/A',
        ragSource: response && response.source ? response.source : 'N/A',
        messageLength: response && response.message ? response.message.length : 0,
        messagePreview: response && response.message ? response.message.substring(0, 150).replace(/\n/g, ' ') : 'N/A',
        hasFeeKeywords: response && response.message ? (
          /\b(biaya|uang\s+kuliah|ukt|spp|dpp|registrasi|semester|cicil|pembayaran)\b/i.test(response.message)
        ) : false
      };

      results.push(result);

      // Print result
      console.log(`✓ Intent: ${result.intent}`);
      console.log(`✓ Fee Question: ${result.isFeeQuestion}`);
      console.log(`✓ Selected Route: ${result.selectedRoute}`);
      console.log(`✓ Program Detected: ${result.detectedProgram}`);
      console.log(`✓ RAG Source: ${result.ragSource}`);
      console.log(`✓ Message Preview: ${result.messagePreview}`);
      console.log(`✓ Has Fee Keywords: ${result.hasFeeKeywords}`);

      if (result.hasFeeKeywords) {
        console.log(`⚠️  WARNING: Fee-related content detected!`);
      }

    } catch (err) {
      console.error(`✗ Error:`, err.message);
      results.push({
        query,
        error: err.message
      });
    }
  }

  // Print summary
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const passingTests = results.filter(r => !r.error && !r.hasFeeKeywords);
  const failingTests = results.filter(r => r.error || r.hasFeeKeywords);

  console.log(`\n✓ Passing: ${passingTests.length}/${results.length}`);
  console.log(`✗ Failing: ${failingTests.length}/${results.length}`);

  if (failingTests.length > 0) {
    console.log('\nFailing Tests:');
    for (const test of failingTests) {
      console.log(`  - ${test.query}: ${test.error || 'Fee keywords detected'}`);
      if (test.hasFeeKeywords) {
        console.log(`    Message: ${test.messagePreview}`);
      }
    }
  }

  // Expected routes
  console.log('\n\nExpected Routes:');
  const expectations = {
    'apa itu SI?': 'rag-prodi-overview',
    'di SI belajar apa?': 'rag-curriculum',
    'prospek kerja SI?': 'rag-career',
    'lulusan TI bekerja dimana?': 'rag-career',
    'apa itu TI?': 'rag-prodi-overview',
    'apa itu SK?': 'rag-prodi-overview',
    'apa itu BD?': 'rag-prodi-overview',
    'Biaya SI sebelumnya. Pertanyaan user saat ini: apa itu SI?': 'rag-prodi-overview'
  };

  for (const [query, expectedRoute] of Object.entries(expectations)) {
    const actualResult = results.find(r => r.query === query);
    const matches = actualResult && actualResult.ragSource === expectedRoute;
    const status = matches ? '✓' : '✗';
    console.log(`${status} ${query}`);
    console.log(`   Expected: ${expectedRoute}, Got: ${actualResult ? actualResult.ragSource : 'N/A'}`);
  }

  // Final confirmation
  console.log('\n\n' + '='.repeat(80));
  if (failingTests.length === 0) {
    console.log('✓ ALL TESTS PASSED - Bug fix confirmed!');
    console.log('  "overview query answered with fee information" has been fully resolved.');
  } else {
    console.log('✗ SOME TESTS FAILED - Further investigation needed.');
  }
  console.log('='.repeat(80));

  process.exit(failingTests.length > 0 ? 1 : 0);
}

// Run tests
runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
