const express = require('express');
const request = require('supertest');
const path = require('path');

(async () => {
  process.env.ENABLE_RAG = 'true';
  process.env.FORCE_BUNDLED_INDEX = 'true';
  process.env.WHATSAPP_STRIP_MARKDOWN = 'true';
  process.env.PROVIDER_WEBHOOK_TOKEN = '';

  const sessionStore = new Map();
  const chatStore = new Map();

  const prisma = require('../src/db');
  prisma.chat = {
    findUnique: async () => null,
    upsert: async ({ where, create, update }) => ({ chatId: where.chatId, status: 'BOT' })
  };
  prisma.keywordReply = {
    findMany: async () => []
  };
  prisma.setting = {
    findUnique: async () => null
  };
  prisma.trainingData = {
    count: async () => 0,
    findFirst: async () => null
  };
  prisma.menuItem = {
    findFirst: async () => null,
    findMany: async () => []
  };
  prisma.session = {
    findUnique: async ({ where }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      return chatId ? (sessionStore.get(chatId) || null) : null;
    },
    upsert: async ({ where, create, update }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      const existing = sessionStore.get(chatId) || (create ? { ...create } : { chatId, state: 'root', data: {} });
      const next = { ...existing };
      if (update && Object.prototype.hasOwnProperty.call(update, 'state')) next.state = update.state;
      if (update && Object.prototype.hasOwnProperty.call(update, 'data')) next.data = update.data;
      if (!next.chatId) next.chatId = chatId;
      sessionStore.set(chatId, next);
      return next;
    }
  };
  prisma.menuItem = { findFirst: async () => null, findMany: async () => [] };

  const chatLog = require('../src/engine/chatLog');
  chatLog.appendChatMessage = async (chatId, direction, message) => {
    if (!chatId) return;
    const arr = chatStore.get(chatId) || [];
    arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
    chatStore.set(chatId, arr);
  };
  chatLog.getChatMessages = async (chatId) => {
    return chatStore.get(chatId) || [];
  };

  const provider = {
    sendMessage: jestMockSendMessage(),
    sendImage: async () => {}
  };

  const providerRouterFactory = require('../src/routes/provider');
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));

  const programs = ['SI', 'TI', 'SK', 'MI', 'BD'];
  const waves = [1, 2, 3, 4];

  const results = [];

  for (const program of programs) {
    for (const wave of waves) {
      const chatId = `simulate-${program}-g${wave}`;
      const text = `berapa biaya pendaftaran prodi ${program} gelombang ${wave}?`;
      provider.sendMessage.mockClear?.();
      if (typeof provider.sendMessage.clear === 'function') provider.sendMessage.clear();
      const res = await request(app)
        .post('/provider/webhook')
        .send({ chatId, text })
        .expect(200);

      const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n---\n');
      results.push({ program, wave, text, responseBody: res.body, sentText: sentTexts });
    }
  }

  console.log('=== SIMULATION RESULTS ===');
  for (const item of results) {
    console.log(`\n---\nProgram: ${item.program} | Gelombang: ${item.wave}`);
    console.log(`Query: ${item.text}`);
    console.log(`Response body: ${JSON.stringify(item.responseBody)}`);
    console.log('Sent WA message:');
    console.log(item.sentText || '<no message sent>');
  }

  function jestMockSendMessage() {
    const calls = [];
    const fn = async (chatId, message, options) => {
      calls.push([chatId, message, options]);
      return undefined;
    };
    fn.mock = {
      calls
    };
    fn.mockClear = () => { calls.length = 0; };
    return fn;
  }
})();
