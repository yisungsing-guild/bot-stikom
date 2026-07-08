const express = require('express');
const request = require('supertest');

// Reuse same mocks as providerWebhook.test.js to run route in test env
jest.mock('../src/db', () => ({
  chat: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }),
    update: jest.fn().mockResolvedValue({})
  },
  keywordReply: {
    findMany: jest.fn().mockResolvedValue([])
  },
  setting: {
    findUnique: jest.fn().mockResolvedValue(null)
  },
  trainingData: {
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn().mockResolvedValue(null)
  },
  session: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({})
  },
  menuItem: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([])
  }
}));

jest.mock('../src/engine/chatLog', () => ({
  appendChatMessage: jest.fn().mockResolvedValue(undefined),
  getChatMessages: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/engine/ragEngine', () => ({
  query: jest.fn().mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] })
}));

jest.mock('../src/engine/webSearchFallback', () => ({
  webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock_default' })
}));

let providerRouterFactory;
let prisma;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

test('debug: show full fee breakdown message for Sistem Informasi Gelombang I', async () => {
  process.env.FORCE_BUNDLED_INDEX = 'true';
  process.env.ENABLE_RAG = 'true';

  // Re-require within test after resetModules so mocks are applied
  providerRouterFactory = require('../src/routes/provider');
  prisma = require('../src/db');

  // Simple stateful stores
  const sessionStore = new Map();
  const chatStore = new Map();

  // Make mocked Prisma session behave statefully across requests.
  prisma.session.findUnique.mockImplementation(async ({ where }) => {
    const chatId = where && where.chatId ? String(where.chatId) : '';
    return chatId ? (sessionStore.get(chatId) || null) : null;
  });
  prisma.session.upsert.mockImplementation(async ({ where, create, update }) => {
    const chatId = where && where.chatId ? String(where.chatId) : '';
    if (!chatId) return {};

    const existing = sessionStore.get(chatId);
    const base = existing || (create ? { ...create } : { chatId, state: 'root', data: {} });
    const next = { ...base };
    if (update && Object.prototype.hasOwnProperty.call(update, 'state')) next.state = update.state;
    if (update && Object.prototype.hasOwnProperty.call(update, 'data')) next.data = update.data;
    if (!next.chatId) next.chatId = chatId;

    sessionStore.set(chatId, next);
    return next;
  });

  // Mocked chatLog store
  const chatLog = require('../src/engine/chatLog');
  chatLog.appendChatMessage.mockImplementation(async (chatId, direction, message) => {
    const id = String(chatId || '');
    if (!id) return;
    const arr = chatStore.get(id) || [];
    arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
    chatStore.set(id, arr);
  });
  chatLog.getChatMessages.mockImplementation(async (chatId) => {
    const id = String(chatId || '');
    return id ? (chatStore.get(id) || []) : [];
  });

  const provider = { sendMessage: jest.fn().mockResolvedValue(undefined) };

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));

  // Prepare a bot message that contains the fee bullets + per-gelombang discounts
  const botMsg =
    'Komponen biayanya adalah:\n\n' +
    '- Pendaftaran: Rp 500.000\n' +
    '- Dana Pendidikan Pokok (DPP): Rp 14.000.000\n' +
    '- Jas almamater & topi: Rp 750.000\n' +
    '- Kaos + tas + GMTI: Rp 750.000\n\n' +
    'Penjelasan Tambahan :\n' +
    'Potongan Biaya Pendaftaran :\n' +
    'Rp 300.000 Jika Mendaftar pada Gelombang Khusus\n' +
    'Rp 250.000 Jika mendaftar pada Gelombang I\n' +
    'Rp 200.000 Jika mendaftar pada Gelombang II\n' +
    'Rp 150.000 Jika mendaftar pada Gelombang III\n' +
    'Rp 100.000 Jika mendaftar pada Gelombang IV\n' +
    'Ditambah Rp 50.000 Jika Alumni SMK TI Bali Global dan SMK Pandawa Bali Global\n\n' +
    'Mau saya bantu hitungkan total biaya awal masuk (butir 1–4)?';

  // Seed session: include last bot message (so findLastInitialEntryCostBreakdownFromSessionData can parse it)
  sessionStore.set('user1', {
    chatId: 'user1',
    state: 'root',
    data: {
      messages: [ { direction: 'bot', message: botMsg } ],
      pendingTotalCost: { type: 'breakdown_total', program: 'Prodi Sistem Informasi', ts: new Date().toISOString() }
    }
  });

  // Also seed chatStore for getChatMessages fallback
  chatStore.set('user1', [ { direction: 'bot', message: botMsg, at: new Date().toISOString() } ]);

  // Now send the follow-up 'Gelombang I' which should trigger computation
  const res = await request(app).post('/provider/webhook').send({ chatId: 'user1', text: 'Gelombang I' });

  expect(res.status).toBe(200);

  // Print the full sent bot message(s)
  const sent = provider.sendMessage.mock.calls.map(c => ({ chatId: c[0], message: String(c[1] || '') }));
  console.log('\n=== Sent messages ===\n');
  for (const s of sent) {
    console.log('--- to:', s.chatId, '---\n');
    console.log(s.message);
    console.log('\n--------------------\n');
  }

  // Basic sanity: at least one message sent
  expect(sent.length).toBeGreaterThan(0);
}, 20000);
