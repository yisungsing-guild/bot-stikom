(async () => {
  const express = require('express');
  const request = require('supertest');
  const prisma = require('../src/db');
  const chatLog = require('../src/engine/chatLog');

  const sessionStore = new Map();
  const chatStore = new Map();
  const upsertCalls = [];

  prisma.chat = { findUnique: async () => null, upsert: async () => ({ chatId: 'user1', status: 'BOT' }), update: async () => ({}) };
  prisma.keywordReply = { findMany: async () => [] };
  prisma.setting = { findUnique: async () => null };
  prisma.trainingData = { count: async () => 0, findFirst: async () => null };
  prisma.menuItem = { findFirst: async () => null, findMany: async () => [] };

  prisma.session = {
    findUnique: async ({ where }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      return chatId ? (sessionStore.get(chatId) || null) : null;
    },
    upsert: async ({ where, create, update }) => {
      upsertCalls.push({ where, create, update });
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

  chatLog.appendChatMessage = async (chatId, direction, message) => {
    const id = String(chatId || '');
    if (!id) return;
    const arr = chatStore.get(id) || [];
    arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
    chatStore.set(id, arr);
  };
  chatLog.getChatMessages = async (chatId) => {
    const id = String(chatId || '');
    return id ? (chatStore.get(id) || []) : [];
  };

  const providerRouterFactory = require('../src/routes/provider');
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory({ sendMessage: async () => {} }));

  async function post(chatId, text) {
    await request(app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN || '')
      .send({ chatId, text })
      .expect(200);
    const msgs = chatStore.get(chatId) || [];
    return { last: msgs[msgs.length - 1] || null, session: sessionStore.get(chatId) || null };
  }

  const chatId = 'seq-user-1';
  const queries = [
    'Berapa biaya TI gelombang 2C?',
    'Berapa rincian biaya TI gelombang 2C?',
    'Apa saja rincian biaya TI gelombang 2C?',
    // follow-up uses same session
    'Apakah biaya tersebut sudah termasuk jas almamater dan topi?'
  ];

  for (let i=0;i<queries.length;i++) {
    console.log('\n---- Query:', queries[i]);
    const res = await post(chatId, queries[i]);
    console.log('Session:', JSON.stringify(res.session, null, 2));
    console.log('Last message:', res.last);
  }

  process.exit(0);
})();
