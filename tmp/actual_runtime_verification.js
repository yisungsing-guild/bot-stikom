/**
 * ACTUAL RUNTIME VERIFICATION
 * POST request to provider webhook dengan query "Berapa biaya TI gelombang 2C?"
 * Capture trace logs dari server asli
 */

const http = require('http');

const queryText = 'Berapa biaya TI gelombang 2C?';

// Payload untuk provider webhook - CORRECT FORMAT: { chatId, text }
const payload = JSON.stringify({
  chatId: 'test-user-verify-patch',
  text: queryText
});

console.log('\n' + '='.repeat(100));
console.log('ACTUAL RUNTIME VERIFICATION - HTTP POST TO PROVIDER WEBHOOK');
console.log('='.repeat(100));
console.log('\n[REQUEST]');
console.log('Method: POST');
console.log('URL: http://localhost:4001/provider/webhook');
console.log('Payload:');
console.log(JSON.stringify(JSON.parse(payload), null, 2));

const options = {
  hostname: 'localhost',
  port: 4001,
  path: '/provider/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'x-webhook-token': 'w6uMsnxTQ2C8LZlDPpBmb04iz3WeAfvd'
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\n[RESPONSE]');
    console.log('Status Code:', res.statusCode);
    console.log('Response Body:');
    try {
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch (e) {
      console.log(data);
    }

    console.log('\n' + '='.repeat(100));
    console.log('TRACE LOGS FROM SERVER (Check tmp logs)');
    console.log('='.repeat(100));
    console.log('Expected logs to appear in:');
    console.log('- tmp/server_stdout.log');
    console.log('- tmp/provider_traces.log');
    console.log('\nLook for:');
    console.log('1. TRACE_PROVIDER_AFTER_RAG');
    console.log('2. TRACE_INTENT_DETECT');
    console.log('3. TRACE_INTENT_LOCKED or TRACE_INTENT_OVERRIDE');
    console.log('4. TRACE_PROGRAM_FINAL');
    console.log('5. TRACE_TEMPLATE_SELECTION');
    console.log('6. TRACE_HUMANIZER_FINAL_OUTPUT');
    console.log('='.repeat(100) + '\n');
  });
});

req.on('error', (e) => {
  console.error('\n✗ ERROR: Cannot connect to provider webhook');
  console.error('Details:', e.message);
  console.error('\nMake sure provider server is running on localhost:3000');
  console.error('Start it with: npm start (in root directory)');
  console.error('='.repeat(100) + '\n');
  process.exit(1);
});

req.write(payload);
req.end();
