const express = require('express');
const request = require('supertest');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.RAG_MIN_SCORE = '0.0';
process.env.BOT_REPLY_TIMEOUT_MS = '20000';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_AUDIT_LOGGING = 'false';
process.env.PROVIDER_WEBHOOK_TOKEN = '';

let providerRouterFactory;
let app;

beforeAll(() => {
  providerRouterFactory = require('../src/routes/provider');
  const provider = {
    sendMessage: jest.fn(async (chatId, text) => {
      // write final outputs to tmp for inspection
      try {
        const outDir = 'tmp'; if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        const p = require('path').join(outDir, 'final_wa_outputs_extra.log');
        fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), chatId, text: String(text||'').slice(0,1000) }) + '\n');
      } catch (e) {}
    }),
    sendImage: jest.fn()
  };

  app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
});

test('run real provider flow for target queries', async () => {
  const queries = [
    { chatId: 'r1', text: 'Apa itu PMB di STIKOM Bali?' },
    { chatId: 'r2', text: 'Jurusan apa saja yang ada di STIKOM Bali?' },
    { chatId: 'r3', text: 'Berapa biaya TI gelombang 2C?' },
    { chatId: 'r4', text: 'Apa perbedaan Sistem Informasi dan Teknik Informatika?' },
    { chatId: 'r5', text: 'Lokasi kampus dimana?' }
  ];

  const results = [];
  for (const q of queries) {
    const res = await request(app).post('/provider/webhook').send({ chatId: q.chatId, text: q.text, ts: Date.now() });
    results.push({ chatId: q.chatId, text: q.text, status: res.status, body: res.body });
  }

  fs.writeFileSync('tmp/provider_real_flow_results.json', JSON.stringify(results, null, 2), 'utf8');

  const allOk = results.every(r => r.status === 200);
  expect(allOk).toBe(true);
}, 60000);
