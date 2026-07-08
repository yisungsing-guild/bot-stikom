/**
 * CAPTURE RUNTIME TRACES
 * Make HTTP request and capture all console logs from server
 * Redirect server logs to capture them
 */

const http = require('http');
const fs = require('fs');

const queryText = 'Berapa biaya TI gelombang 2C?';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

// File untuk capture output
const captureFile = `tmp/runtime_traces_capture_${timestamp}.txt`;
const writeStream = fs.createWriteStream(captureFile, { flags: 'a' });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  writeStream.write(line);
}

log('='.repeat(100));
log('CAPTURING RUNTIME TRACES FOR QUERY: "' + queryText + '"');
log('='.repeat(100));

// Payload untuk provider webhook
const payload = JSON.stringify({
  chatId: `test-user-capture-${Date.now()}`,
  text: queryText
});

log('\n[REQUEST] POST /provider/webhook');
log('Payload: ' + payload);
log('\n[WAITING FOR RESPONSE...]');

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
    log('\n[RESPONSE]');
    log('Status Code: ' + res.statusCode);
    log('Body: ' + data);
    log('\n' + '='.repeat(100));
    log('CAPTURE COMPLETE - Check provider_traces.log for detailed traces');
    log('='.repeat(100) + '\n');
    
    writeStream.end();
    
    // Wait a moment for server logs to be written
    setTimeout(() => {
      console.log('\n✓ Traces captured to: ' + captureFile);
      process.exit(0);
    }, 1000);
  });
});

req.on('error', (e) => {
  log('\n✗ ERROR: ' + e.message);
  writeStream.end();
  process.exit(1);
});

req.write(payload);
req.end();
