process.env.PROVIDER_WEBHOOK_TOKEN = 'testtoken123';
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MockWhatsAppProvider } = require('./src/providers/whatsappProvider');
const providerRouterFactory = require('./src/routes/provider');
(async () => {
  const port = 4002;
  const provider = new MockWhatsAppProvider();
  const app = express();
  app.use(bodyParser.json());
  app.use('/provider', providerRouterFactory(provider));
  const sentMessages = [];
  provider.on('sent', ({ chatId, message, ts }) => {
    sentMessages.push({ chatId, message, ts });
  });
  const server = app.listen(port, async () => {
    const programs = [
      'Teknologi Informasi',
      'Sistem Informasi',
      'Sistem Komputer',
      'Bisnis Digital',
      'Manajemen Informatika',
      'Desain Komunikasi Visual',
      'Teknologi Rekayasa Perangkat Lunak',
      'Teknologi Komputer',
      'Multimedia',
      'Animasi',
      'Desain Grafis',
      'Rekognisi Pembelajaran Lampau'
    ];
    const queries = [];
    queries.push('Bro, bandingin semua prodi yang ada, kasih tau yang paling murah per semester ya.');
    for (const p of programs) {
      queries.push(`Bro, biaya ${p} per semester berapa ya?`);
    }
    for (const q of queries) {
      try {
        await axios.post(`http://127.0.0.1:${port}/provider/webhook`, { chatId: 'test-user-2', text: q }, { headers: { 'x-webhook-token': 'testtoken123' } });
        await new Promise((r) => setTimeout(r, 900));
      } catch (err) {
        console.error('POST error', err && err.message);
      }
    }
    console.error('Done sending', queries.length, 'messages');
    console.log(JSON.stringify(sentMessages, null, 2));
    server.close();
  });
})();
