process.env.PROVIDER_WEBHOOK_TOKEN = '';
const express = require('express');
const providerFactory = require('../src/routes/provider');

const provider = {
  sendMessage: async (chatId, text) => {
    console.log('SENT:', JSON.stringify(text));
    return true;
  }
};

const app = express();
app.use(express.json());
app.use('/provider', providerFactory(provider));

const server = app.listen(0, async () => {
  const port = server.address().port;
  const fetch = require('node-fetch');
  const query = 'apa itu SI?';
  const resp = await fetch(`http://127.0.0.1:${port}/provider/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: '62812345678', text: query, id: 'debug', timestamp: Date.now() })
  });
  console.log('STATUS', resp.status, await resp.text());
  server.close();
});
