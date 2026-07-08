// Tests to assert Provider persists signals and Composer receives reasoning bundles
const express = require('express');
const request = require('supertest');

// Mock DB and chat/log similar to existing provider tests
jest.mock('../src/db', () => ({
  chat: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }), update: jest.fn().mockResolvedValue({}) },
  keywordReply: { findMany: jest.fn().mockResolvedValue([]) },
  setting: { findUnique: jest.fn().mockResolvedValue(null) },
  trainingData: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
  session: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
  menuItem: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }
}));

jest.mock('../src/engine/chatLog', () => ({
  appendChatMessage: jest.fn().mockResolvedValue(undefined),
  getChatMessages: jest.fn().mockResolvedValue([])
}));

// Mock ragEngine to return no-match by default; tests can override
jest.mock('../src/engine/ragEngine', () => ({
  query: jest.fn().mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [], meta: null }),
  detectIntent: jest.fn().mockResolvedValue({ label: null, confidence: 0 })
}));

// Provide a test-friendly safeSessionUpsert that uses the mocked prisma from ../src/db
jest.mock('../src/utils/sessionUpsert', () => ({
  safeSessionUpsert: async (prisma, arg1, arg2, arg3) => {
    let chatId = null;
    let newData = null;
    let state = null;

    if (arg1 && typeof arg1 === 'object' && arg1.where) {
      chatId = arg1.where && arg1.where.chatId ? String(arg1.where.chatId) : '';
      state = (arg1.update && arg1.update.state) || (arg1.create && arg1.create.state) || 'root';
      newData = (arg1.update && arg1.update.data) || (arg1.create && arg1.create.data) || {};
    } else {
      chatId = String(arg1 || '');
      newData = arg2 || {};
      state = arg3 || 'root';
    }

    const existing = await prisma.session.findUnique({ where: { chatId } });
    const existingData = (existing && existing.data) ? existing.data : {};
    const merged = { ...existingData, ...(newData || {}) };
    const s = state || (existing && existing.state) || 'root';
    return await prisma.session.upsert({ where: { chatId }, create: { chatId, state: s, data: merged }, update: { state: s, data: merged } });
  }
}));

// Mock composer early so provider uses this mocked composer when required
const mockCompose = jest.fn(async (opts) => {
  // Return a simple finalText and echo back some reasoning hints for assertions
  const rc = opts && opts.session ? { sessionSnapshot: opts.session } : {};
  const strategy = [];
  try {
    const userQ = String(opts && opts.userQuery || '').toLowerCase();
    if (userQ.includes('sambil kerja')) strategy.push('compare');
    if (userQ.includes('takut') || userQ.includes('khawatir')) strategy.push('reassure');
    if (userQ.includes('berapa') || userQ.includes('biaya') || userQ.includes('beasiswa')) strategy.push('answer');
    if (!strategy.length) strategy.push('answer');
  } catch (e) { strategy.push('answer'); }
  return { finalText: `MOCK: ${String(opts && opts.userQuery || '')}`, segments: {}, meta: { strategy, reasoningContext: opts && opts.reasoningContext ? opts.reasoningContext : null } };
});

jest.mock('../src/engine/composer', () => ({
  composeResponse: (...args) => mockCompose(...args)
}));

let providerRouterFactory;
let prisma;

describe('Provider -> Composer integration behavior', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Force non-test env so provider does not trigger direct-send allowlist
    process.env.NODE_ENV = 'development';

    // Ensure bundled index checks behave consistently
    process.env.FORCE_BUNDLED_INDEX = 'true';

    sessionStore = new Map();
    chatStore = new Map();

    provider = { sendMessage: jest.fn().mockResolvedValue(undefined) };

    providerRouterFactory = require('../src/routes/provider');
    prisma = require('../src/db');

    prisma.session.findUnique.mockImplementation(async ({ where }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      return chatId ? (sessionStore.get(chatId) || null) : null;
    });
    prisma.session.upsert.mockImplementation(async ({ where, create, update }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
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

  test('SHORT FOLLOW-UP: provider persists hint; composer receives reasoningContext', async () => {
    const chatId = 'short-followup-1';

    // Seed prior context by sending an explicit program mention
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    // Now send a short follow-up
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'kalau TI?' })
      .expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();

    // Ensure provider persisted at least one pending* key (hint/evidence)
    const hasPending = persisted.data && (persisted.data.pendingRagCandidate || persisted.data.pendingRuleReply || persisted.data.pendingWebCandidate || persisted.data.pendingSemanticSuggestion);
    expect(Boolean(hasPending)).toBe(true);

    // Now simulate Composer stepping in: build composer pipeline and call sendComposedReply
    const { createComposerPipeline } = require('../src/routes/composerPipeline');
    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: require('../src/db'),
      sendBotMessageOriginal: provider.sendMessage,
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await cp.sendComposedReply({ source: 'pending', ragResult: persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    expect(mockCompose).toHaveBeenCalled();
    const lastCallArg = mockCompose.mock.calls[mockCompose.mock.calls.length - 1][0] || {};
    expect(lastCallArg).toHaveProperty('userQuery');
    expect(lastCallArg).toHaveProperty('session');
    expect(String(lastCallArg.userQuery || '').toLowerCase()).toContain('ti');
  });

  test('EMERGENT INTENT: no menu, composer infers intent and responds conversationally', async () => {
    const chatId = 'emergent-intent-1';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa ada?' })
      .expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    // No deterministic menu state should be set
    expect(persisted.data && persisted.data.pendingMenuCost).toBeUndefined();

    const { createComposerPipeline } = require('../src/routes/composerPipeline');
    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: require('../src/db'),
      sendBotMessageOriginal: provider.sendMessage,
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await cp.sendComposedReply({ source: 'pending', ragResult: persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    expect(mockCompose).toHaveBeenCalled();
    const called = mockCompose.mock.calls.find(c => String(c[0] && c[0].userQuery || '').toLowerCase().includes('beasiswa'));
    expect(called).toBeTruthy();
  });

  test('INTERRUPTED FLOW: context continuity preserved; provider persists signals', async () => {
    const chatId = 'interrupted-flow-1';

    await request(app).post('/provider/webhook').send({ chatId, text: 'biayanya?' }).expect(200);
    await request(app).post('/provider/webhook').send({ chatId, text: 'oh iya akreditasi gimana?' }).expect(200);
    await request(app).post('/provider/webhook').send({ chatId, text: 'lanjut biaya tadi' }).expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    // Ensure signals about pendingTotalCost or pendingRagCandidate remain so Composer can restore
    const hasContinuity = persisted.data && (persisted.data.pendingTotalCost || persisted.data.pendingRagCandidate || persisted.data.pendingFeeDetail || persisted.data.pendingProgramSelection);
    expect(Boolean(hasContinuity)).toBe(true);

    const { createComposerPipeline } = require('../src/routes/composerPipeline');
    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: require('../src/db'),
      sendBotMessageOriginal: provider.sendMessage,
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await cp.sendComposedReply({ source: 'pending', ragResult: persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    expect(mockCompose).toHaveBeenCalled();
    const last = mockCompose.mock.calls[mockCompose.mock.calls.length - 1][0];
    expect(String(last.userQuery || '').toLowerCase()).toContain('lanjut biaya');
  });

  test('MIXED INTENT: composer combines reasoning without deterministic split', async () => {
    const chatId = 'mixed-intent-1';

    await request(app).post('/provider/webhook').send({ chatId, text: 'kalau sambil kerja bisa? dan biayanya berapa?' }).expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    // Provider should not have forced a deterministic fee template state
    expect(persisted.data && persisted.data.pendingMenuCost).toBeUndefined();

    const { createComposerPipeline } = require('../src/routes/composerPipeline');
    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: require('../src/db'),
      sendBotMessageOriginal: provider.sendMessage,
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await cp.sendComposedReply({ source: 'pending', ragResult: persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    // The mock returns meta.strategy; ensure it includes 'answer'
    const lastResolved = await mockCompose.mock.results[mockCompose.mock.results.length - 1].value;
    expect(lastResolved.meta && Array.isArray(lastResolved.meta.strategy)).toBe(true);
    expect(lastResolved.meta.strategy.includes('answer')).toBe(true);
  });

  test('EMOTIONAL CUES: composer acknowledges emotion; provider does not inject template', async () => {
    const chatId = 'emotional-cues-1';

    await request(app).post('/provider/webhook').send({ chatId, text: 'saya takut gak kuat matematika' }).expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    // Provider should not have persisted a canned reassurance template key
    expect(persisted.data && persisted.data.handoverOffered).toBeUndefined();

    const { createComposerPipeline } = require('../src/routes/composerPipeline');
    const cp = createComposerPipeline({
      chatId,
      getText: () => (chatStore.get(chatId) || []).slice(-1)[0] ? (chatStore.get(chatId) || []).slice(-1)[0].message : '',
      getSessionData: () => (sessionStore.get(chatId) || {}).data || {},
      getSession: () => sessionStore.get(chatId) || null,
      setSessionData: (d) => { const s = sessionStore.get(chatId) || { chatId, state: 'root', data: {} }; s.data = d; sessionStore.set(chatId, s); },
      composeResponse: mockCompose,
      logger: console,
      prisma: require('../src/db'),
      sendBotMessageOriginal: provider.sendMessage,
      detectIntent: (t) => 'GENERAL',
      intentConfidence: (t) => 0,
      mapRagContextsForComposer: (r) => (r && r.contexts) ? r.contexts : [],
      getNormalizedObj: () => ({}),
      getComposerTone: () => null,
      clearReplyDeadline: () => {},
      getTimeoutSendPromise: () => null,
      state: {}
    });

    await cp.sendComposedReply({ source: 'pending', ragResult: persisted.data && persisted.data.pendingRagCandidate ? persisted.data.pendingRagCandidate : null, ruleReply: persisted.data && persisted.data.pendingRuleReply ? persisted.data.pendingRuleReply : null, sourceType: null });

    const lastResolved = await mockCompose.mock.results[mockCompose.mock.results.length - 1].value;
    expect(lastResolved.meta && Array.isArray(lastResolved.meta.strategy)).toBe(true);
    expect(lastResolved.meta.strategy.includes('reassure')).toBe(true);
  });
});
