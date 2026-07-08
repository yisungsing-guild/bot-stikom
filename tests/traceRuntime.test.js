const express = require('express');
const request = require('supertest');

// Reuse the same mocking approach as providerWebhook.test.js but in a focused script
jest.mock('../src/db', () => ({
  chat: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }), update: jest.fn().mockResolvedValue({}) },
  keywordReply: { findMany: jest.fn().mockResolvedValue([]) },
  setting: { findUnique: jest.fn().mockResolvedValue(null) },
  trainingData: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
  session: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  menuItem: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }
}));

jest.mock('../src/engine/chatLog', () => ({ appendChatMessage: jest.fn().mockResolvedValue(undefined), getChatMessages: jest.fn().mockResolvedValue([]) }));

// Keep ragEngine mocked to avoid heavy work; this mirrors CI test environment.
jest.mock('../src/engine/ragEngine', () => ({ query: jest.fn().mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] }) }));

jest.mock('../src/engine/webSearchFallback', () => ({ webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock_default' }) }));

describe('Runtime trace for problematic queries', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;
  let providerRouterFactory;
  let prisma;
  let composerMock;

  beforeAll(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.FORCE_BUNDLED_INDEX = 'true';

    sessionStore = new Map();
    chatStore = new Map();

    provider = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    composerMock = {
      composeResponse: jest.fn().mockImplementation(async (payload) => {
        const q = payload && (payload.userQuery || payload.normalized) ? String(payload.userQuery || payload.normalized || '').toLowerCase() : '';
        const rawRule = payload && payload.ruleReply && payload.ruleReply.text ? String(payload.ruleReply.text) : '';
        const rawText = rawRule || (Array.isArray(payload && payload.retrievals) && payload.retrievals.length && String(payload.retrievals[0].excerpt || payload.retrievals[0].text || '')) || '';
        const sanitizeMock = (input) => String(input || '').replace(/^##\s*/gm, '').replace(/^>\s*/gm, '').replace(/^•\s*/gm, '- ').replace(/^-(?!\s)/gm, '- ').replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '$1: $2').replace(/\n{3,}/g, '\n\n').trim();
        let reply = 'MOCK COMPOSED REPLY';
        if (rawText) reply = sanitizeMock(rawText);
        if (/jadwal lengkapnya 2 a|jadwal/i.test(q)) reply = 'Jadwal Gelombang II A\nMasa pendaftaran';
        else if (/biaya pendaftaran|dpp|ukt|semester|gelombang|pembayaran/i.test(q) && !rawText) reply = 'Biaya pendaftaran: Rp 16.000.000. Untuk detail, balas YA/TIDAK.';
        else if (/halo|selamat|pagi|intro/i.test(q)) reply = process.env.BOT_INTRO_MESSAGE || 'Halo, selamat datang!';
        else if (/siap|terima kasih|makasih|sama-?sama/i.test(q)) reply = 'Sama-sama!';
        else if (/senin|jumat|perkuliahan|hari/i.test(q)) reply = 'Perkuliahan: Senin sampai Jumat.';
        return { finalText: reply, segments: {}, meta: { reasoningContext: {} }, strategy: ['answer'], confidence: 0.95 };
      })
    };

    jest.doMock('../src/engine/composer', () => composerMock);

    providerRouterFactory = require('../src/routes/provider');
    prisma = require('../src/db');

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

    app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));
  });

  test('trace five problematic queries', async () => {
    const queries = [
      { chatId: 'trace-1', text: 'apa itu SI?' },
      { chatId: 'trace-2', text: 'di SI belajar apa?' },
      { chatId: 'trace-3', text: 'lulusan TI bekerja dimana?' },
      { chatId: 'trace-4', text: 'apakah ada dual degree internasional?' },
      { chatId: 'trace-5', text: 'gelombang apa yang dibuka sekarang?' }
    ];

    for (const q of queries) {
      console.log('\n=== QUERY START ===');
      console.log('QUERY:', q.text);
      await request(app).post('/provider/webhook').send({ chatId: q.chatId, text: q.text }).expect(200);

      // Find outbound send call for this chat
      const calls = provider.sendMessage.mock.calls.filter(c => String(c[0]) === String(q.chatId));
      // pick last call
      const last = calls.length ? calls[calls.length - 1] : null;
      const opts = last && last[2] ? last[2] : {};
      const composerMeta = opts && opts.composerMeta ? opts.composerMeta : null;

      console.log('DETECTED_INTENT:', composerMeta && composerMeta.intent ? composerMeta.intent.label : null);
      console.log('DOMINANT_INTENT:', composerMeta && composerMeta.dominantIntent ? composerMeta.dominantIntent : null);
      console.log('TOP_RETRIEVAL_TOPIC:', composerMeta && composerMeta.retrievalTopTopic ? composerMeta.retrievalTopTopic : null);
      console.log('TOP_RETRIEVAL_SCORE:', composerMeta && typeof composerMeta.topScore !== 'undefined' ? composerMeta.topScore : null);
      console.log('TOP_5_RETRIEVALS:', composerMeta && composerMeta.topRetrievals ? composerMeta.topRetrievals : null);
      console.log('INJECTED_BLOCKS:', composerMeta && composerMeta.injectedBlocks ? composerMeta.injectedBlocks : []);
      console.log('SUPPRESSED_BLOCKS:', composerMeta && composerMeta.suppressedTopics ? composerMeta.suppressedTopics : []);
      const finalTopic = (typeof require('../src/routes/composerPipeline').detectIntent === 'function') ? null : null;
      console.log('FINAL_RESPONSE_TOPIC:', opts && opts.finalAnswerTopic ? opts.finalAnswerTopic : null);
      console.log('OUTBOUND_PREVIEW:', last && last[1] ? String(last[1]).slice(0, 300) : null);
      console.log('=== QUERY END ===\n');
    }
  }, 20000);
});
