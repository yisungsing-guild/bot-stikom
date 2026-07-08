// Diagnostic test for BUG 1: Fee query program mismatch
// Tests what the provider returns for "Berapa biaya TI?"

const path = require('path');
const fs = require('fs');

// Initialize environment
process.env.NODE_ENV = 'test';
process.env.JEST_WORKER_ID = 'test-worker';
process.env.WA_RUNTIME_ACTIVE = 'true';
process.env.STORAGE_TYPE = 'memory';

// Load the provider webhook handler
const { handler: webhookHandler } = require('./src/routes/provider.js');

async function testBug1() {
  console.log('\n=== BUG 1 Diagnostic: Fee Query for "Berapa biaya TI?" ===\n');

  const testQueries = [
    'Berapa biaya TI?',
    'Berapa biaya teknologi informasi?',
    'Berapa biaya SI?',
    'Berapa biaya sistem informasi?'
  ];

  for (const query of testQueries) {
    console.log(`\n--- Testing: "${query}" ---`);
    
    const incomingMessage = {
      chatId: 'test-user-bug1',
      source: 'test',
      text: query,
      sourceType: null
    };

    try {
      const result = await webhookHandler(incomingMessage);
      console.log('Result status:', result.statusCode || result.ok);
      
      if (result.body && typeof result.body === 'string') {
        let parsedBody;
        try {
          parsedBody = JSON.parse(result.body);
        } catch (e) {
          parsedBody = result.body;
        }
        
        if (parsedBody && parsedBody.preview) {
          console.log('Preview:', parsedBody.preview.substring(0, 200));
          
          // Check if program name is consistent
          const previewLower = parsedBody.preview.toLowerCase();
          if (previewLower.includes('teknologi informasi')) {
            console.log('✓ Header contains "Teknologi Informasi"');
          } else if (previewLower.includes('sistem informasi')) {
            console.log('✓ Header contains "Sistem Informasi"');
          } else {
            console.log('✗ Header missing expected program name');
          }

          // Check for conflicting program names
          if (previewLower.includes('manajemen informatika') && query.toLowerCase().includes('ti')) {
            console.log('✗ BUG: Contains "Manajemen Informatika" but query asks for TI!');
          }
        }

        if (parsedBody && parsedBody.intent) {
          console.log('Intent:', parsedBody.intent);
        }
      }
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
}

// Run the diagnostic
testBug1().catch(console.error).then(() => {
  process.exit(0);
});
