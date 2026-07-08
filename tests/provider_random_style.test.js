const request = require('supertest');

// Reuse the same mocks as providerWebhook.test.js to keep environment consistent
jest.mock('../src/db', () => ({
  chat: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }), update: jest.fn().mockResolvedValue({}) },
  keywordReply: { findMany: jest.fn().mockResolvedValue([]) },
  setting: { findUnique: jest.fn().mockResolvedValue(null) },
  trainingData: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null) },
  session: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  menuItem: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }
}));

jest.mock('../src/engine/chatLog', () => ({ appendChatMessage: jest.fn().mockResolvedValue(undefined), getChatMessages: jest.fn().mockResolvedValue([]) }));

jest.mock('../src/engine/ragEngine', () => ({ query: jest.fn().mockResolvedValue({ success: true, answer: 'RAG: mock answer', source: 'rag', contexts: [] }) }));

jest.mock('../src/engine/webSearchFallback', () => ({ webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock_default' }) }));

const providerRouterFactory = require('../src/routes/provider');
const rag = require('../src/engine/ragEngine');

describe('Provider random-style utterance integration', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.FORCE_BUNDLED_INDEX = 'true';

    sessionStore = new Map();
    chatStore = new Map();

    // Mock chatLog to store messages for context functions
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

    provider = { sendMessage: jest.fn().mockResolvedValue(undefined), sendImage: jest.fn().mockResolvedValue(undefined) };

    app = require('express')();
    app.use(require('express').json());
    app.use('/provider', providerRouterFactory(provider));
  });

  const cases = [
    { text: 'berapa biaya pendaftaran SI?', intent: 'fee', expectRag: false },
    { text: 'brp dpp utk si gel 2?', intent: 'fee', expectRag: false },
    { text: 'kira2 biaya total yg harus dibayar buat SI bro', intent: 'fee', expectRag: true },
    { text: 'mau tau persyaratan daftar SI', intent: 'pendaftaran', expectRag: false },
    { text: 'gimana caranya daftar? ada yg ribet?', intent: 'pendaftaran', expectRag: true },
    { text: 'apa aja program studi di stikom?', intent: 'program', expectRag: false },
    { text: 'kirim brosur stikom pls', intent: 'program', expectRag: true }
  ];

  test('responds to random-style utterances and records RAG usage', async () => {
    const results = [];
    for (const c of cases) {
      // Reset rag mock call history and set a predictable response
      rag.query.mockClear();
      rag.query.mockResolvedValueOnce({ success: true, answer: 'RAG fallback answer', source: 'rag', contexts: [] });

      const res = await request(app)
        .post('/provider/webhook')
        .send({ chatId: 'user1', text: c.text });

      const usedRag = rag.query.mock.calls.length > 0;
      const replied = provider.sendMessage.mock.calls.length > 0 || provider.sendImage.mock.calls.length > 0;
      results.push({ text: c.text, intent: c.intent, usedRag, replied });

      // clear provider mocks between iterations
      provider.sendMessage.mockClear();
      provider.sendImage.mockClear();

      expect(res.status).toBe(200);
      expect(replied).toBe(true);
    }

    // Print a summary to test logs for later inspection
    try { console.log('[RANDOM_STYLE_TEST_SUMMARY]', JSON.stringify(results, null, 2)); } catch (e) {}
  }, 20000);
});
