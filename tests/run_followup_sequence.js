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
    return id ? (chatStore.get(chatId) || []) : [];
  };

  const providerRouterFactory = require('../src/routes/provider');
  const { createComposerPipeline } = require('../src/routes/composerPipeline');
  const composer = require('../src/engine/composer');

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory({ sendMessage: async () => {} }));

  async function runSequence(chatId, q1, q2) {
    upsertCalls.length = 0;

    console.log('\n=== Running sequence', chatId);

    await request(app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN || '')
      .send({ chatId, text: q1 })
      .expect(200);

    // Wait a moment (not necessary but keep log ordering)
    await new Promise(r => setTimeout(r, 50));

    await request(app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN || '')
      .send({ chatId, text: q2 })
      .expect(200);

    console.log('\nUpsert calls:');
    console.log(JSON.stringify(upsertCalls, null, 2));

    console.log('\nSession store entry:');
    console.log(JSON.stringify(sessionStore.get(chatId) || null, null, 2));

    console.log('\nChat log last 3 messages:');
    const msgs = chatStore.get(chatId) || [];
    console.log(msgs.slice(-3));
  }

  const q1 = 'Berapa biaya TI gelombang 2C?';
  const q2 = 'Apakah biaya tersebut sudah termasuk jas almamater dan topi?';
  await runSequence('followup-test-1', q1, q2);

  process.exit(0);
})();