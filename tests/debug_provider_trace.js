// Temporary debug script to replay failing test scenarios and log prisma upsert payloads
(async () => {
  const express = require('express');
  const request = require('supertest');
  const prisma = require('../src/db');
  const chatLog = require('../src/engine/chatLog');

  // In-memory stores
  const sessionStore = new Map();
  const chatStore = new Map();
  const upsertCalls = [];

  // Mock prisma table methods used by provider
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

  // Mock chatLog methods
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

  // Require provider after prismatic mocks are in place
  const providerRouterFactory = require('../src/routes/provider');
  const { createComposerPipeline } = require('../src/routes/composerPipeline');
  const composer = require('../src/engine/composer');

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory({ sendMessage: async () => {} }));

  // Helper to run a scenario and print traces
  async function runScenario(chatId, text) {
    upsertCalls.length = 0; // reset per scenario
    chatStore.delete(chatId);
    sessionStore.delete(chatId);

    console.log('\n=== Running scenario', chatId, text);
    // Include webhook token header if the environment sets one (mirrors real requests)
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

    // Now create a composer pipeline with a mock composeResponse to capture args
    const mockCalls = [];
    const mockCompose = async (opts) => {
      mockCalls.push(opts || {});
      // Build a reasoningContext similar to composer for inspection
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

    // Invoke composer pipeline similarly to tests
    const persisted = sessionStore.get(chatId) || null;
    await cp.sendComposedReply({ source: 'pending', ragResult: persisted && persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted && persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    console.log('\nmockCompose.calls:', JSON.stringify(mockCalls, null, 2));
  }

  // Run the two failing scenarios from tests
  await runScenario('emergent-intent-1', 'beasiswa ada?');
  await runScenario('emotional-cues-1', 'saya takut gak kuat matematika');

  process.exit(0);
})();
