const express = require('express');
const fetch = global.fetch || require('node-fetch');
// Ensure webhook token check is disabled for local test
process.env.PROVIDER_WEBHOOK_TOKEN = '';
const providerFactory = require('../src/routes/provider');

const provider = {
  sendMessage: async (chatId, text) => {
    console.log('[MOCK_SEND_MESSAGE]', { chatId, text: String(text).slice(0,200) });
    return true;
  }
};

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/provider', providerFactory(provider));
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log('[TEST_SERVER_STARTED]', port);
    const queries = [
      'apa itu SI?',
      'di SI belajar apa?',
      'lulusan TI bekerja dimana?',
      'berapa biaya SI?',
      'berapa biaya pendaftaran SI?',
      'akreditasi SI?'
    ];

    for (const q of queries) {
      try {
        console.log('\n----\nSENDING:', q);
        const resp = await fetch(`http://127.0.0.1:${port}/provider/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: 'test-chat', text: q })
        });
        const body = await resp.text();
        console.log('[RESPONSE]', body);
      } catch (e) {
        console.error('[ERROR REQUEST]', e && e.stack ? e.stack : e);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    server.close(() => console.log('[TEST_SERVER_STOPPED]'));
  });
})();

// After server shuts down, dump debug decisions (if any)
setTimeout(() => {
  try {
    console.log('\n[DEBUG_DECISIONS]', JSON.stringify(global.__provider_debug_decisions || [], null, 2));
  } catch (e) {
    console.error('[DEBUG_DECISIONS_ERROR]', e && e.stack ? e.stack : e);
  }
}, 500);
