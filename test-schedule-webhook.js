// Test schedule fast-path by simulating a webhook message
const http = require('http');

const payload = {
  messages: [
    {
      from: '62812345678',
      id: 'test-' + Date.now(),
      timestamp: Math.floor(Date.now() / 1000),
      type: 'text',
      text: {
        body: 'jadwal gelombang 2C?'
      }
    }
  ]
};

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/wati/webhook',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-token': '09f3a571f34ed50c4f30d45f49d33e868ee70fbdc31fdda792370e416483e426'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', data);
  });
});

req.on('error', err => console.error('Request error:', err.message));
req.write(JSON.stringify(payload));
req.end();

console.log('Sent test message: "jadwal gelombang 2C?" to localhost:4000/wati/webhook');
console.log('Check bot logs for: [Provider] Schedule fast-path check (pre-keyword)');
