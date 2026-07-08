const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { MockWhatsAppProvider } = require('../src/providers/whatsappProvider');
const providerRouterFactory = require('../src/routes/provider');

(async () => {
  const port = process.env.PROVIDER_TEST_PORT || 4001;
  const provider = new MockWhatsAppProvider();

  const app = express();
  app.use(bodyParser.json());
  app.use('/provider', providerRouterFactory(provider));

  const sentMessages = [];
  provider.on('sent', ({ chatId, message, ts }) => {
    sentMessages.push({ chatId, message, ts });
  });

  const server = app.listen(port, async () => {
    console.error('Provider test server listening on', port);

    const qs = [
      'Kalau dibandingkan biaya per semester, prodi mana yang lebih murah: Sistem Komputer atau Bisnis Digital?',
      'Saya pilih BD, lalu apakah SI lebih murah per semester?',
      'Apa beda Sistem Komputer dan Bisnis Digital?',
      'Biaya Bisnis Digital per semester?',
      'Biaya Sistem Komputer per semester?'
    ];

    const token = process.env.PROVIDER_WEBHOOK_TOKEN || '';
    const headers = token ? { 'x-webhook-token': token } : undefined;
    for (const q of qs) {
      try {
        const res = await axios.post(
          `http://127.0.0.1:${port}/provider/webhook`,
          { chatId: 'test-user-1', text: q },
          { headers }
        );
        // wait a bit for provider.sendMessage to be called
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        console.error('POST error', e && e.message);
      }
    }

    // Write results
    try {
      const outDir = path.join(__dirname, '..', 'reports');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'provider_flow_results.json'), JSON.stringify(sentMessages, null, 2));
      console.error('Wrote provider_flow_results.json with', sentMessages.length, 'messages');
    } catch (e) {
      console.error('Write error', e && e.message);
    }

    server.close();
  });
})();
