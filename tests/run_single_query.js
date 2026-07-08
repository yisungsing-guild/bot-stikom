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
  const { createComposerPipeline } = require('../src/routes/composerPipeline');
  const composer = require('../src/engine/composer');

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory({ sendMessage: async () => {} }));

  async function runScenario(chatId, text) {
    upsertCalls.length = 0;
    chatStore.delete(chatId);
    sessionStore.delete(chatId);

    console.log('\n=== Running scenario', chatId, text);

    await request(app)
      .post('/provider/webhook')
      .set('x-webhook-token', process.env.PROVIDER_WEBHOOK_TOKEN || '')
      .send({ chatId, text })
      .expect(200);

    console.log('\nUpsert calls:');
    console.log(JSON.stringify(upsertCalls, null, 2));

    console.log('\nSession store entry:');
    console.log(JSON.stringify(sessionStore.get(chatId) || null, null, 2));

    console.log('\nChat log last message:');
    const msgs = chatStore.get(chatId) || [];
    console.log(msgs[msgs.length - 1] || null);

    const mockCalls = [];
    const mockCompose = async (opts) => {
      mockCalls.push(opts || {});
      let rc = {};
      try {
        if (typeof composer.buildReasoningContext === 'function') {
          rc = composer.buildReasoningContext({
            userQuery: opts && opts.userQuery || '',
            normalized: opts && opts.normalized || '',
            intent: opts && opts.intent || {},
            session: opts && opts.session || {},
            retrievals: opts && opts.retrievals || [],
            answer: '',
            answerMeta: opts && opts.answerMeta || {},
            tone: opts && opts.tone || null,
            ragMeta: opts && opts.ragMeta || null
          });
        }
      } catch (e) { rc = {}; }

      try {
        console.log('COMPOSER_CALL', {
          chatId,
          userQuery: opts && opts.userQuery,
          sessionData: opts && opts.session,
          reasoningContext: rc,
          pendingKeys: Object.keys((opts && opts.session) || {}).filter(k => String(k).startsWith('pending'))
        });
      } catch (e) {}

      return { finalText: `MOCK: ${String(opts && opts.userQuery || '')}`, segments: {}, meta: { reasoningContext: rc } };
    };

    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: prisma,
      sendBotMessageOriginal: async () => {},
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    const persisted = sessionStore.get(chatId) || null;
    await cp.sendComposedReply({ source: 'pending', ragResult: persisted && persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted && persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    console.log('\nmockCompose.calls:', JSON.stringify(mockCalls, null, 2));
  }

  const query = process.argv[2] || 'berapa biaya teknologi informasi gelombang 1A';
  await runScenario('single-query-1', query);

  process.exit(0);
})();
