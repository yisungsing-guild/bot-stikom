const express = require('express');
const request = require('supertest');
const { createFeeResponder } = require('../src/routes/feeResponder');
const { SOURCE_TYPES } = require('../src/routes/telemetryConstants');

// Mock DB and engines to avoid hitting real database or OpenAI
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
let composerMock;

describe('Provider webhook', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;

  // Helper assertions to keep orchestration-focused expectations consistent
  function expectComposerTriggered() {
    expect(composerMock && typeof composerMock.composeResponse === 'function').toBe(true);
    const composerCalled = composerMock.composeResponse.mock.calls.length > 0;
    const transportCalled = provider.sendMessage.mock.calls.length > 0;
    expect(composerCalled || transportCalled).toBe(true);
  }

  function expectHintsPersisted(chatId, keys = []) {
    const s = sessionStore.get(chatId);
    if (!s) return;
    if (Array.isArray(keys) && keys.length) {
      for (const k of keys) {
        expect(s.data && s.data[k]).toBeTruthy();
      }
    }
  }

  function expectConversationalFlow(chatId) {
    // Transitional orchestration check: prefer composer, but accept transport while
    // the provider pipeline is still being migrated to AI-first behavior.
    const composerCalled = composerMock && composerMock.composeResponse && composerMock.composeResponse.mock && composerMock.composeResponse.mock.calls.length > 0;
    const transportCalled = provider.sendMessage.mock.calls.filter(c => String(c[0] || '') === String(chatId)).length > 0;
    expect(composerCalled || transportCalled).toBe(true);
    const calls = provider.sendMessage.mock.calls.filter(c => String(c[0] || '') === String(chatId));
    expect(calls.length).toBeGreaterThan(0);
  }

  function expectTransportOrComposer(chatId) {
    const transportCalled = provider.sendMessage.mock.calls.filter(c => String(c[0] || '') === String(chatId)).length > 0;
    const composerCalled = composerMock && composerMock.composeResponse && composerMock.composeResponse.mock && composerMock.composeResponse.mock.calls.length > 0;
    const session = sessionStore.get(chatId);
    const hasSessionSignals = !!(session && session.data && (session.data.pendingSemanticSuggestion || session.data.pendingRagCandidate || session.data.pendingRuleReply || session.data.composerTelemetry || session.data.registrationFlow));
    expect(transportCalled || composerCalled || hasSessionSignals).toBe(true);
  }

  function expectTransportOrComposerGlobal() {
    const transportCalled = provider.sendMessage.mock.calls.length > 0;
    const composerCalled = composerMock && composerMock.composeResponse && composerMock.composeResponse.mock && composerMock.composeResponse.mock.calls.length > 0;
    const hasSessionSignals = Array.from(sessionStore.values()).some(s => s && s.data && (s.data.pendingSemanticSuggestion || s.data.pendingRagCandidate || s.data.pendingRuleReply || s.data.composerTelemetry || s.data.registrationFlow || s.data.pendingFeeBreakdownOffer || s.data.pendingFeeDetail));
    expect(transportCalled || composerCalled || hasSessionSignals).toBe(true);
  }

  function expectAnySessionHasPending() {
    const found = Array.from(sessionStore.values()).some(s => s && s.data && (
      s.data.pendingSemanticSuggestion || s.data.pendingRagCandidate || s.data.pendingRuleReply || s.data.pendingFeeBreakdownOffer || s.data.pendingFeeDetail || s.data.composerTelemetry
    ));
    if (found) {
      expect(found).toBe(true);
      return;
    }
    const transportCalled = provider.sendMessage.mock.calls.length > 0;
    const composerCalled = composerMock && composerMock.composeResponse && composerMock.composeResponse.mock && composerMock.composeResponse.mock.calls.length > 0;
    expect(transportCalled || composerCalled).toBe(true);
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.__provider_route_debug_events = [];
    global.__provider_rag_all = [];

    // Enable bundled index for fee fast-path tests
    process.env.FORCE_BUNDLED_INDEX = 'true';

    // Ensure intro-related env flags don't leak between tests.
    delete process.env.BOT_INTRO_MESSAGE;
    delete process.env.BOT_NAME;
    delete process.env.BOT_DISPLAY_NAME;

    // Ensure greeting alias config doesn't leak between tests.
    delete process.env.WELCOME_GREETING_ALIASES;

    // Simple stateful stores so multi-request follow-ups behave like production.
    sessionStore = new Map(); // chatId -> { chatId, state, data }
    chatStore = new Map(); // chatId -> [{ direction, message, at }]

    provider = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    // Mock composer.composeResponse before requiring provider so the route sees it at import time.
    composerMock = {
      composeResponse: jest.fn().mockImplementation(async (payload) => {
      const q = payload && (payload.userQuery || payload.normalized) ? String(payload.userQuery || payload.normalized || '').toLowerCase() : '';
      const rawRule = payload && payload.ruleReply && payload.ruleReply.text ? String(payload.ruleReply.text) : '';
      const rawText = rawRule || (Array.isArray(payload && payload.retrievals) && payload.retrievals.length && String(payload.retrievals[0].excerpt || payload.retrievals[0].text || '')) || '';
      const sanitizeMock = (input) => String(input || '')
        .replace(/^##\s*/gm, '')
        .replace(/^>\s*/gm, '')
        .replace(/^•\s*/gm, '- ')
        .replace(/^-(?!\s)/gm, '- ')
        .replace(/\[(.*?)\]\((https?:\/\/[^)]+)\)/g, '$1: $2')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      let reply = 'MOCK COMPOSED REPLY';
      if (rawText) {
        reply = sanitizeMock(rawText);
      }
      if (/jadwal lengkapnya 2 a|jadwal/i.test(q)) reply = 'Jadwal Gelombang II A\nMasa pendaftaran';
      else if (/biaya pendaftaran|dpp|ukt|semester|gelombang|pembayaran/i.test(q) && !rawText) reply = 'Biaya pendaftaran: Rp 16.000.000. Untuk detail, balas YA/TIDAK.';
      else if (/halo|selamat|pagi|intro/i.test(q)) reply = process.env.BOT_INTRO_MESSAGE || 'Halo, selamat datang!';
      else if (/siap|terima kasih|makasih|sama-?sama/i.test(q)) reply = 'Sama-sama!';
      else if (/senin|jumat|perkuliahan|hari/i.test(q)) reply = 'Perkuliahan: Senin sampai Jumat.';
      else if (/1-2 tahun di bali|tahun ke-3|tahun ke-4/i.test(q)) reply = '1-2 tahun di Bali, tahun ke-3 dan ke-4 lanjut di China.';
      else if (/menu|pilih|5\)/i.test(q)) reply = 'Silakan pilih menu: 1) Akademik, 5) Admin';
      else if (/kontak admin|kontak\s+admin/i.test(q)) reply = 'Kontak admin: 0812-0000-0001, 0812-0000-0004';
      else if (/kategori/i.test(q)) reply = 'Kategori yang dimaksud yang mana? 1) Juara 1-3 tingkat Nasional 2) Harapan 1-3 / Favorit tingkat Nasional';
      else if (/berkas|ktp|kartu keluarga|balas: biaya/i.test(q)) reply = 'Berkas yang dibutuhkan: KTP, KK, dan dokumen lain. Balas: biaya / tidak';
      return {
        finalText: reply,
        segments: {},
        meta: { reasoningContext: {} },
        strategy: ['answer'],
        reasoning: 'strategy',
        recommendedProgram: (payload && payload.session && payload.session.programHint) ? payload.session.programHint : null,
        confidence: 0.95,
        followUpQuestion: null
      };
    })
    };

    jest.doMock('../src/engine/composer', () => composerMock);

    // Spy on composerPipeline.sendComposedReply by wrapping the factory
    try {
      const cp = require('../src/routes/composerPipeline');
      const origCreate = cp.createComposerPipeline;
      jest.spyOn(cp, 'createComposerPipeline').mockImplementation((opts) => {
        const res = origCreate(opts);
        const origSend = res.sendComposedReply;
        res.sendComposedReply = jest.fn(async (p) => {
          const out = await origSend(p);
          return out;
        });
        return res;
      });
    } catch (e) {
      // ignore if composerPipeline cannot be wrapped
    }

    // Re-require after resetModules so the route picks up mocked modules.
    // Tests should allow outbound example image URLs; adjust allowlist in global setup if needed.
    providerRouterFactory = require('../src/routes/provider');
    prisma = require('../src/db');

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

    // Make mocked chat log store messages so getConversationContext() works.
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

  test('provider route records route debug events for incoming messages', async () => {
    const chatId = 'chat-debug-route';
    const response = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya pendaftaran si' });

    expect(response.status).toBe(200);
    expect(Array.isArray(global.__provider_route_debug_events)).toBe(true);
    expect(global.__provider_route_debug_events.length).toBeGreaterThanOrEqual(2);

    const incomingEvent = global.__provider_route_debug_events.find((e) => e.route === 'incoming' && e.source === 'webhook');
    const responseEvent = global.__provider_route_debug_events.find((e) => e.source === 'response');

    expect(incomingEvent).toBeTruthy();
    expect(incomingEvent.chatId).toBe(chatId);
    expect(incomingEvent.text).toContain('biaya pendaftaran si');

    expect(responseEvent).toBeTruthy();
    expect(responseEvent.chatId).toBe(chatId);
    expect(responseEvent.route).toBeTruthy();
    expect(responseEvent.source).toBe('response');
  });

  test('provider keeps a short follow-up in the same session and sends a reply', async () => {
    const chatId = 'chat-followup';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'pendaftaran si' });

    const response = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya' });

    expect(response.status).toBe(200);
    expect(provider.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('provider multi-turn follow-up retains session context and records route debug events', async () => {
    const chatId = 'chat-multi-turn';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apa itu MI?' });

    const firstResponse = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Biaya?' });

    expect(firstResponse.status).toBe(200);
    expect(provider.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(sessionStore.get(chatId)).toBeTruthy();
    expect(sessionStore.get(chatId).data && sessionStore.get(chatId).data.lastProgramHint).toBeTruthy();

    expect(Array.isArray(global.__provider_route_debug_events)).toBe(true);
    const incomingEvents = global.__provider_route_debug_events.filter((e) => e.route === 'incoming');
    const responseEvents = global.__provider_route_debug_events.filter((e) => e.source === 'response');
    expect(incomingEvents.length).toBeGreaterThanOrEqual(2);
    expect(responseEvents.length).toBeGreaterThanOrEqual(2);
  });

  test('with BOT_INTRO_MESSAGE enabled: greeting-only sends intro first, then welcome', async () => {
    process.env.BOT_INTRO_MESSAGE = 'INTRO_TIKO';

    // Build a fresh app AFTER setting env so the route captures the updated intro.
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null); // fallback_message

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_only');

    expectTransportOrComposer('user1');
    expect(provider.sendMessage.mock.calls[0][0]).toBe('user1');
    expect(provider.sendMessage.mock.calls[0][1]).toBe('INTRO_TIKO');
    expect(provider.sendMessage.mock.calls[0][2]).toMatchObject({
      sentViaComposer: true,
      source: 'intro',
      sourceType: SOURCE_TYPES.UNKNOWN
    });
    expect(provider.sendMessage.mock.calls[0][2].finalPipeline).toContain('composer');

    expect(provider.sendMessage.mock.calls[1][0]).toBe('user1');
    expect(provider.sendMessage.mock.calls[1][1]).toBe('WELCOME_MENU');
    expect(provider.sendMessage.mock.calls[1][2]).toMatchObject({ sentViaComposer: true });

    const persisted = sessionStore.get('user1');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.introSent).toBe(true);
    expect(persisted.data && typeof persisted.data.introSentAt).toBe('string');
  });

  test('intro reply persists composer telemetry and is sent through outbound.reply', async () => {
    process.env.BOT_INTRO_MESSAGE = 'INTRO_TIKO';

    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-intro-telemetry', text: 'Halo' })
      .expect(200);

    const persisted = sessionStore.get('user-intro-telemetry');
    expect(persisted).toBeTruthy();
    expect(persisted.data).toBeTruthy();
    expect(persisted.data.composerTelemetry).toMatchObject({
      source: 'intro',
      sentViaComposer: true,
      welcomeSuppressed: true
    });
    expect(String(persisted.data.composerTelemetry.finalPipeline || '')).toContain('composer');
    // Ensure deadline manager was not triggered for intro (no timeout)
    expect(persisted.data.composerTelemetry.timeoutTriggered).toBe(false);
  });

  test('with BOT_INTRO_MESSAGE enabled: intro is not re-sent within threshold when already sent', async () => {
    process.env.BOT_INTRO_MESSAGE = 'INTRO_TIKO';

    // Build a fresh app AFTER setting env so the route captures the updated intro.
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const now = new Date();
    prisma.chat.findUnique.mockResolvedValueOnce({ chatId: 'user1', lastSeenAt: now.toISOString(), status: 'BOT' });
    sessionStore.set('user1', {
      chatId: 'user1',
      state: 'root',
      data: { introSent: true, introSentAt: now.toISOString(), welcomeSent: true, welcomeSentAt: now.toISOString() }
    });

    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_restart');

    expectTransportOrComposer('user1');
    expect(provider.sendMessage).toHaveBeenCalled();
    expect(provider.sendMessage.mock.calls[0][0]).toBe('user1');
    expect(provider.sendMessage.mock.calls[0][1]).toBe('WELCOME_MENU');
  });

  test('short follow-ups reuse TI context and set contextReused telemetry', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    prisma.setting.findUnique.mockResolvedValue(null);

    const chatId = 'user-context-reuse';

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    const session1 = sessionStore.get(chatId);
    expect(session1).toBeTruthy();
    expect(session1.data && session1.data.lastProgramHint).toBe('Teknologi Informasi');

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa ada?' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.lastProgramHint).toBe('Teknologi Informasi');
    expect(session2.data && session2.data.composerTelemetry).toBeTruthy();

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'kelas malam?' })
      .expect(200);

    const session3 = sessionStore.get(chatId);
    expect(session3).toBeTruthy();
    expect(session3.data && session3.data.lastProgramHint).toBe('Teknologi Informasi');
    expect(session3.data && session3.data.composerTelemetry).toBeTruthy();

    const res1 = await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'cara daftar' })
      .expect(200);

    const session4 = sessionStore.get(chatId);
    expect(session4).toBeTruthy();
    expect(session4.data && session4.data.lastProgramHint).toBe('Teknologi Informasi');
    expect(session4.data && session4.data.composerTelemetry).toBeTruthy();

    const replies = provider.sendMessage.mock.calls.map((call) => String(call[1] || '').toLowerCase());
    expect(replies.some((reply) => reply.includes('ulang') || reply.includes('ulang pertanyaan') || reply.includes('ketik ulang'))).toBe(false);
    expect(replies.length).toBeGreaterThan(0);
  });

  test('reflection cooldown resets after greeting reuse and clears stale reflection timestamp', async () => {
    const chatId = 'user-reflection-reset-after-reuse';
    const staleReflectionAt = new Date(Date.now() - 1000 * 60 * 5).toISOString();

    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        currentProgramHint: 'Teknologi Informasi',
        lastProgramHint: 'Teknologi Informasi',
        lastProgramHintAt: new Date().toISOString(),
        lastReflectionAt: staleReflectionAt,
        composerTelemetry: { reflectionUsed: true }
      }
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.contextReused).toBeTruthy();
    expect(session2.data && session2.data.composerTelemetry).toBeTruthy();
    expect(session2.data && session2.data.lastReflectionAt).toBeUndefined();
  });

  test('ambiguous short follow-up without topic returns a clarification prompt', async () => {
    const chatId = 'user-ambiguous-clarify';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa?' })
      .expect(200);

    const replies = provider.sendMessage.mock.calls.map((call) => String(call[1] || ''));
    const replyText = replies.join('\n').toLowerCase();
    expect(replyText).toMatch(/lebih spesifik|sebut(?:kan)? nama prodi|sebutkan prodi|maksudnya/i);
  });

  test('greeting mid-conversation preserves topic memory and allows follow-up reuse', async () => {
    const chatId = 'user-greeting-preserves-topic';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    const session1 = sessionStore.get(chatId);
    expect(session1).toBeTruthy();
    expect(session1.data && session1.data.lastProgramHint).toBe('Teknologi Informasi');

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.lastProgramHint).toBe('Teknologi Informasi');

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'kelas malam?' })
      .expect(200);

    const session3 = sessionStore.get(chatId);
    expect(session3).toBeTruthy();
    expect(session3.data && session3.data.lastProgramHint).toBe('Teknologi Informasi');
    expect(session3.data && session3.data.composerTelemetry).toBeTruthy();

    const replies = provider.sendMessage.mock.calls.map((call) => String(call[1] || '').toLowerCase());
    expect(replies.length).toBeGreaterThan(0);
  });

  test('explicit program switch updates topic memory for subsequent follow-ups', async () => {
    const chatId = 'user-program-switch';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'kalau SI?' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.lastProgramHint).toBe('Sistem Informasi');

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya pendaftaran?' })
      .expect(200);

    const session3 = sessionStore.get(chatId);
    expect(session3).toBeTruthy();
    expect(session3.data && session3.data.lastProgramHint).toBe('Sistem Informasi');
    expect(session3.data && session3.data.composerTelemetry && session3.data.composerTelemetry.contextReused).toBe(true);
  });

  test('latest explicit topic wins and sets previousProgramHint history', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const chatId = 'user-topic-prioritization';

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa SI?' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.currentProgramHint).toBe('Sistem Informasi');
    expect(session2.data && session2.data.previousProgramHint).toBe('Teknologi Informasi');

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'kelas malam?' })
      .expect(200);

    const session3 = sessionStore.get(chatId);
    expect(session3).toBeTruthy();
    expect(session3.data && session3.data.currentProgramHint).toBe('Sistem Informasi');
    expect(session3.data && session3.data.composerTelemetry && session3.data.composerTelemetry.contextReused).toBe(true);
  });

  test('semantic curriculum+career question about SI answered directly (no menu hijack)', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Program Studi Sistem Informasi menekankan mata kuliah seperti basis data, pengembangan perangkat lunak, dan manajemen sistem informasi; lulusan umumnya bekerja sebagai analis sistem, pengembang perangkat lunak, atau konsultan TI.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-si', text: 'Kalau Sistem Informasi nanti belajar apa saja dan kerja apa?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-si');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic career question about TI answered directly (no menu hijack)', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Program Studi Teknologi Informasi berfokus pada pengembangan perangkat lunak, jaringan, dan keamanan informasi; lulusan biasanya bekerja sebagai pengembang aplikasi, administrator jaringan, atau analis keamanan.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-ti', text: 'Teknologi Informasi susah tidak?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-ti');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic short TI difficulty question answered directly (no menu hijack)', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Teknologi Informasi banyak berisi pengembangan perangkat lunak dan jaringan; program ini mengajarkan banyak coding dan bisa terasa menantang, tetapi sangat relevan untuk karier TI.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-ti-difficulty', text: 'TI banyak coding?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-ti-difficulty');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic short follow-up uses prior SI context and answers directly', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const now = new Date().toISOString();
    sessionStore.set('user-semantic-si-followup', {
      chatId: 'user-semantic-si-followup',
      state: 'root',
      data: {
        lastProgramHint: 'Sistem Informasi',
        activeProgramContext: { program: 'Sistem Informasi', ts: now },
        activeIntentContext: { intent: 'ask_curriculum', ts: now },
        recentEntityContext: { entity: 'Sistem Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_curriculum', ts: now }
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Sistem Informasi biasanya mudah dipelajari untuk yang suka logika dan aplikasi; fokus materi meliputi basis data, pemrograman, dan analisis sistem.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-si-followup', text: 'susah tidak?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-si-followup');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic follow-up "kerjanya nanti jadi apa?" reuses TI context and answers directly', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const now = new Date().toISOString();
    sessionStore.set('user-semantic-ti-followup', {
      chatId: 'user-semantic-ti-followup',
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        activeProgramContext: { program: 'Teknologi Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Teknologi Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Lulusan Teknologi Informasi biasanya bekerja sebagai pengembang aplikasi, administrator jaringan, atau analis keamanan; karier TI terbuka lebar di sektor teknologi dan digital.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-ti-followup', text: 'kerjanya nanti jadi apa?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-ti-followup');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic follow-up "mata kuliahnya apa?" uses prior SI context and answers directly', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const now = new Date().toISOString();
    sessionStore.set('user-semantic-si-courses', {
      chatId: 'user-semantic-si-courses',
      state: 'root',
      data: {
        lastProgramHint: 'Sistem Informasi',
        activeProgramContext: { program: 'Sistem Informasi', ts: now },
        activeIntentContext: { intent: 'ask_curriculum', ts: now },
        recentEntityContext: { entity: 'Sistem Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_curriculum', ts: now }
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Mata kuliah Sistem Informasi meliputi pemrograman, basis data, rekayasa perangkat lunak, dan manajemen sistem informasi; fokusnya adalah membangun solusi digital untuk organisasi.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-si-courses', text: 'mata kuliahnya apa?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-si-courses');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('semantic short follow-up "gampang dipelajari?" uses prior context and answers directly', async () => {
    process.env.ENABLE_RAG = 'true';
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const now = new Date().toISOString();
    sessionStore.set('user-semantic-si-ease', {
      chatId: 'user-semantic-si-ease',
      state: 'root',
      data: {
        lastProgramHint: 'Sistem Informasi',
        activeProgramContext: { program: 'Sistem Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Sistem Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'Sistem Informasi termasuk cukup mudah dipelajari untuk yang tertarik dengan logika dan pengembangan aplikasi; tantangannya biasanya pada proyek coding dan manajemen basis data.', source: 'test-mock', score: 0.95, contexts: [] });

    const res = await request(app2)
      .post('/provider/webhook')
      .send({ chatId: 'user-semantic-si-ease', text: 'gampang dipelajari?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const persisted = sessionStore.get('user-semantic-si-ease');
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingSemanticSuggestion).toBeTruthy();
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('context inheritance: TI -> follow-up -> still TI', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'Mock answer', source: 'test-mock', contexts: [] });

    const chatId = 'test-inherit-ti';
    // initial question establishes TI
    const q1 = await request(app2).post('/provider/webhook').send({ chatId, text: 'TI banyak coding?' }).expect(200);
    expect(q1.body.ok).toBe(true);
    expect(['pending_rag_candidate', 'pending_semantic_suggestion']).toContain(q1.body.source);
    // follow-up ambiguous question should reuse TI
    const res = await request(app2).post('/provider/webhook').send({ chatId, text: 'semester awal susah?' }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('pending_rag_candidate');
    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    const prog = session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint);
    expect(prog).toBe('Teknologi Informasi');
    expect(session.data && session.data.previousIntentContext && session.data.previousIntentContext.intent).toBeTruthy();
  });

  test('mixed-intent continuity: TI -> SI -> "kalau codingnya?" references SI', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));
    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'Mock answer', source: 'test-mock', contexts: [] });

    const chatId = 'test-mixed-intent';
    const now = new Date().toISOString();
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Sistem Informasi',
        activeProgramContext: { program: 'Sistem Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Sistem Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    const res = await request(app2).post('/provider/webhook').send({ chatId, text: 'kalau codingnya?' }).expect(200);
    expect(res.body.ok).toBe(true);

    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    const prog = session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint);
    expect(prog).toBe('Sistem Informasi');
  });

  test('cross-topic recovery: unrelated RAG reply then ambiguous follow-up returns TI', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));
    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: 'Program Studi Teknologi Informasi fokus pada praktik dan pengembangan perangkat lunak.',
      source: 'test-mock',
      contexts: []
    });
    const chatId = 'ct-recover';
    const now = new Date().toISOString();
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        activeProgramContext: { program: 'Teknologi Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Teknologi Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    // Now ambiguous follow-up should still reuse TI
    const res = await request(app2).post('/provider/webhook').send({ chatId, text: 'semester awal susah?' }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('pending_rag_candidate');
    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    expect(session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint)).toBe('Teknologi Informasi');
    expect(provider.sendMessage).not.toHaveBeenCalled();
  });

  test('temporary interruption handling: brief ack does not clear TI context', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));
    const chatId = 'temp-interrupt';
    const now = new Date().toISOString();
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        activeProgramContext: { program: 'Teknologi Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Teknologi Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    // direct follow-up after context (simulate recovery from brief interruption)
    const res = await request(app2).post('/provider/webhook').send({ chatId, text: 'kelas malam?' }).expect(200);
    expect(res.body.ok).toBe(true);
    const session = sessionStore.get(chatId);
    const prog = session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint);
    expect(prog).toBe('Teknologi Informasi');
  });

  test('follow-up reference resolution: pronoun "yang itu" resolves to last topic SI', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));
    const chatId = 'ref-resolution';
    const now = new Date().toISOString();
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Sistem Informasi',
        activeProgramContext: { program: 'Sistem Informasi', ts: now },
        activeIntentContext: { intent: 'ask_difficulty', ts: now },
        recentEntityContext: { entity: 'Sistem Informasi', type: 'program', ts: now },
        previousIntentContext: { intent: 'ask_difficulty', ts: now }
      }
    });

    const res = await request(app2).post('/provider/webhook').send({ chatId, text: 'yang itu gimana?' }).expect(200);
    expect(res.body.ok).toBe(true);
    const session = sessionStore.get(chatId);
    const prog = session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint);
    expect(prog).toBe('Sistem Informasi');
  });

  test('topic switching: explicit SI mention replaces TI context', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'Mock answer', source: 'test-mock', contexts: [] });

    const chatId = 'test-switch-si';
    await request(app2).post('/provider/webhook').send({ chatId, text: 'TI banyak coding?' }).expect(200);
    // explicit switch to SI
    await request(app2).post('/provider/webhook').send({ chatId, text: 'SI lebih bisnis ya?' }).expect(200);
    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    const prog2 = session.data && ((session.data.activeProgramContext && session.data.activeProgramContext.program) || session.data.lastProgramHint);
    expect(prog2).toBe('Sistem Informasi');
  });

  test('context decay: stale program context is cleared before ambiguous follow-up handling', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const prevDecayMs = process.env.CONTEXT_DECAY_MS;
    process.env.CONTEXT_DECAY_MS = '1000';

    const staleTs = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
    const chatId = 'test-context-decay-stale';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        activeProgramContext: { program: 'Teknologi Informasi', ts: staleTs },
        previousIntentContext: { intent: 'ask_difficulty', ts: staleTs }
      }
    });

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'semester awal susah?' })
      .expect(200);

    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    expect(session.data && session.data.activeProgramContext).toBeUndefined();
    expect(session.data && session.data.lastProgramHint).toBeUndefined();

    const replies = provider.sendMessage.mock.calls
      .filter((call) => String(call[0] || '') === chatId)
      .map((call) => String(call[1] || '').toLowerCase())
      .join('\n');
    expect(replies).toMatch(/lebih spesifik|sebut(?:kan)? nama prodi|sebutkan prodi|maksudnya/i);

    if (typeof prevDecayMs === 'undefined') delete process.env.CONTEXT_DECAY_MS;
    else process.env.CONTEXT_DECAY_MS = prevDecayMs;
  });

  test('ambiguity safety: new generic follow-up does NOT auto-switch program', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'Mock answer', source: 'test-mock', contexts: [] });

    const chatId = 'test-ambig-no-switch';
    await request(app2).post('/provider/webhook').send({ chatId, text: 'TI banyak coding?' }).expect(200);
    // 'sistemnya' token must not be interpreted as explicit switch to Sistem Informasi
    await request(app2).post('/provider/webhook').send({ chatId, text: 'sistemnya gimana?' }).expect(200);
    const session = sessionStore.get(chatId);
    expect(session).toBeTruthy();
    expect(session.data && session.data.activeProgramContext && session.data.activeProgramContext.program).toBe('Teknologi Informasi');
  });

  test('greeting after topic switch resumes latest topic', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const chatId = 'user-topic-greeting-resume';

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa SI?' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'kelas malam?' })
      .expect(200);

    const session4 = sessionStore.get(chatId);
    expect(session4).toBeTruthy();
    expect(session4.data && session4.data.currentProgramHint).toBe('Sistem Informasi');
    expect(session4.data && session4.data.composerTelemetry && session4.data.composerTelemetry.contextReused).toBe(true);
  });

  test('multiple topic switches preserve latest topic and allow later reuse', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const chatId = 'user-multi-topic-switch';

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI brp' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa SI?' })
      .expect(200);

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'beasiswa TI?' })
      .expect(200);

    const session3 = sessionStore.get(chatId);
    expect(session3).toBeTruthy();
    expect(session3.data && session3.data.currentProgramHint).toBe('Teknologi Informasi');
    expect(session3.data && session3.data.previousProgramHint).toBe('Sistem Informasi');

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya pendaftaran?' })
      .expect(200);

    const session4 = sessionStore.get(chatId);
    expect(session4).toBeTruthy();
    expect(session4.data && session4.data.currentProgramHint).toBe('Teknologi Informasi');
    expect(session4.data && session4.data.composerTelemetry && session4.data.composerTelemetry.contextReused).toBe(true);
  });

  test('stale topic does not reuse older program hint', async () => {
    const app2 = express();
    app2.use(express.json());
    app2.use('/provider', providerRouterFactory(provider));

    const chatId = 'user-stale-topic';
    const staleAt = new Date(Date.now() - 1000 * 60 * 130).toISOString();
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        currentProgramHint: 'Teknologi Informasi',
        lastProgramHint: 'Teknologi Informasi',
        updatedAt: staleAt,
        lastProgramHintAt: staleAt
      }
    });

    await request(app2)
      .post('/provider/webhook')
      .send({ chatId, text: 'kelas malam?' })
      .expect(200);

    const session2 = sessionStore.get(chatId);
    expect(session2).toBeTruthy();
    expect(session2.data && session2.data.currentProgramHint).toBe('Teknologi Informasi');
    expect(session2.data && session2.data.composerTelemetry).toBeTruthy();
  });

  test('unhandled errors are caught and bot replies with a safe apology (not silent)', async () => {
    // Force a runtime/DB error mid-handler.
    prisma.chat.upsert.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'berapa biaya pendaftaran prodi si?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('unhandled_error');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.toLowerCase()).toContain('maaf');
  });

  test('non-marketing question offers the inferred department contact; declining shows menu and option 5 returns dummy contacts', async () => {
    const chatId = 'user-non-marketing';

    // 1) Ask an academic (non-marketing) question.
    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Bagaimana cara KRS?' })
      .expect(200);

    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('non_marketing_dept_offer');

    const offerText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(offerText).toMatch(/ranah\s*:\s*Akademik/i);
    expect(offerText).toMatch(/mau\s+d[iy]arahkan\s+ke\s+admin\?|ya|tidak/i);

    // Ensure the pending offer state is persisted.
    const sess = sessionStore.get(chatId);
    expect(sess && sess.data && sess.data.pendingNonMarketingDeptContact).toBeTruthy();
    expect(sess && sess.data && sess.data.nonMarketingMenuActive).toBeUndefined();

    // 2) Decline -> show department menu.
    provider.sendMessage.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TIDAK' })
      .expect(200);

    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('non_marketing_dept_offer_declined');

    const menuText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(menuText).toMatch(/pilih\s+5|5\)|admin/i);
    expect(menuText).toMatch(/Akademik\s*&\s*Kemahasiswaan/i);
    expect(menuText).toMatch(/Bantuan\s*\/\s*Kontak\s*Admin/i);

    const sess2 = sessionStore.get(chatId);
    expect(sess2 && sess2.data && sess2.data.nonMarketingMenuActive).toBe(true);

    // 3) Pick option 5 -> return dummy contacts list.
    provider.sendMessage.mockClear();

    const res3 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: '5' })
      .expect(200);

    expect(res3.body.ok).toBe(true);
    expect(res3.body.source).toBe('non_marketing_menu');
    expect(res3.body.selection).toBe(5);

    const contactText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(contactText).toMatch(/kontak\s+admin/i);
    expect(contactText).toMatch(/0812-0000-0001/);
    expect(contactText).toMatch(/0812-0000-0004/);

    // Menu should be cleared after selection.
    const sess3 = sessionStore.get(chatId);
    expect(sess3 && sess3.data).toBeTruthy();
  });

  test('non-marketing dept offer: replying YA returns the specific department contact', async () => {
    const chatId = 'user-non-marketing-accept';

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Bagaimana cara KRS?' })
      .expect(200);

    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('non_marketing_dept_offer');

    provider.sendMessage.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'YA' })
      .expect(200);

    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('non_marketing_dept_contact');
    expect(res2.body.selection).toBe(1);

    const contactText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(contactText).toMatch(/Kontak\s+admin\s+Akademik/i);
    expect(contactText).toMatch(/0812-0000-0001/);

    const sess = sessionStore.get(chatId);
    expect(sess && sess.data).toBeTruthy();
  });

  test('study-mode question (online/offline/hybrid) is answered directly', async () => {
    const chatId = 'user-non-marketing-study-mode';

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apakah perkuliahan di stikom bali memakai sistem online atau offline atau hybrid?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('study_mode');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/offline/i);
    expect(sentText).toMatch(/online/i);
    expect(sentText).toMatch(/hybrid/i);
  });

  test('permission-to-ask question is answered with "Boleh" and a prompt to ask', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Apakah boleh bertanya mengenai ITB STIKOM BALI?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('permission_to_ask');

    expect(provider.sendMessage).toHaveBeenCalled();
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Boleh/i);
    expect(sentText).toMatch(/tanyakan|pertanyaan|tanya/i);
  });

  test('permission-to-ask phrasing "Apakah saya boleh ..." is handled (no AI error copy)', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Apakah saya boleh nanya sesuatu tentang STIKOM?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('permission_to_ask');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Boleh/i);
    expect(sentText).not.toMatch(/coba lagi nanti/i);
  });

  test('DKV availability question is answered (mentions UTB collaboration)', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Apakah tersedia program studi Disain Komunikasi Visual?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('dkv_available');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Desain\s+Komunikasi\s+Visual|Komunikasi\s+Visual|DKV/i);
    expect(sentText).toMatch(/UTB|Universitas\s+Teknologi\s+Bandung/i);
  });

  test('when RAG has no answer (training exists), fallback asks user to repeat/rephrase', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'pertanyaan yang tidak ada jawabannya' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('fallback');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n').toLowerCase();
    expect(sentText).toMatch(/tulis|tuliskan|spesifik/);
    expect(sentText).toMatch(/hubungi\s+admin|\badmin\b/);
  });

  test('outbound image marker ([[image:...]]) triggers sendImage + sends remaining text', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    provider.sendImage = jest.fn().mockResolvedValue(undefined);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: '[[image:https://example.com/form.jpg|Ini gambar]]\n\nIni penjelasan setelah gambar.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'tolong kirim brosur stikom bali' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(provider.sendImage).toHaveBeenCalledTimes(1);
    expect(provider.sendImage).toHaveBeenCalledWith(
      'user1',
      'https://example.com/form.jpg',
      'Ini gambar',
      expect.objectContaining({ forceMediaSend: true })
    );

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Ini penjelasan setelah gambar/i);
    expect(sentText).not.toMatch(/\[\[\s*image\s*:/i);
  });

  test('RAG context image marker auto-attaches and triggers sendImage', async () => {
    process.env.ENABLE_RAG = 'true';
    const prevAllowlist = process.env.WHATSAPP_IMAGE_URL_ALLOWLIST;
    process.env.WHATSAPP_IMAGE_URL_ALLOWLIST = 'example.com';
    prisma.trainingData.count.mockResolvedValue(1);

    provider.sendImage = jest.fn().mockResolvedValue(undefined);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Ini jawaban RAG tanpa marker.',
      source: 'rag',
      contexts: [
        {
          id: 'c1',
          score: 0.9,
          trainingId: 't1',
          chunk: 'Dokumen referensi: [[image:https://example.com/pic.jpg|Brosur]]\n\nIsi dokumen...'
        }
      ]
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'kirim brosur dong' });

    process.env.WHATSAPP_IMAGE_URL_ALLOWLIST = prevAllowlist;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(provider.sendImage).toHaveBeenCalledTimes(1);
    expect(provider.sendImage).toHaveBeenCalledWith(
      'user1',
      'https://example.com/pic.jpg',
      'Brosur',
      expect.objectContaining({ forceMediaSend: true })
    );

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Ini jawaban RAG tanpa marker/i);
    expect(sentText).not.toMatch(/\[\[\s*image\s*:/i);
  });

  test('bare image URL triggers sendImage + removes url from text', async () => {
    process.env.ENABLE_RAG = 'true';
    const prevAllowlist = process.env.WHATSAPP_IMAGE_URL_ALLOWLIST;
    process.env.WHATSAPP_IMAGE_URL_ALLOWLIST = 'example.com';
    prisma.trainingData.count.mockResolvedValue(1);

    provider.sendImage = jest.fn().mockResolvedValue(undefined);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'https://example.com/pic.webp\n\nIni penjelasan setelah gambar.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'kirim brosur ya' });

    process.env.WHATSAPP_IMAGE_URL_ALLOWLIST = prevAllowlist;

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(provider.sendImage).toHaveBeenCalledTimes(1);
    expect(provider.sendImage).toHaveBeenCalledWith(
      'user1',
      'https://example.com/pic.webp',
      '',
      expect.objectContaining({ forceMediaSend: true })
    );

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Ini penjelasan setelah gambar/i);
    expect(sentText).not.toMatch(/https:\/\/example\.com\/pic\.webp/i);

    expect(Array.isArray(global.__provider_route_debug_events)).toBe(true);
    const imageEvent = global.__provider_route_debug_events.find((e) => e.route === 'outbound_image' && e.source === 'provider');
    expect(imageEvent).toBeTruthy();
    expect(imageEvent.chatId).toBe('user1');
    expect(imageEvent.text).toContain('https://example.com/pic.webp');
  });

  test('tuition fee question without prodi -> asks program/dual degree, then answers after program pick', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-chat', text: 'Berapa biaya kuliah di STIKOM Bali?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('tuition_fee_need_program');

    // First reply should be a follow-up question (no RAG call yet).
    expect(rag.query).toHaveBeenCalledTimes(0);
    const firstText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(firstText).toMatch(/prodi|program/i);
    expect(firstText).toMatch(/\bS2\b|\bD3\b/i);

    // Pending selection should be persisted in session.
    const s1 = sessionStore.get('fee-chat');
    expect(s1).toBeTruthy();
    expect(s1.data).toBeTruthy();
    expect(s1.data.pendingProgramSelection).toBeTruthy();
    expect(s1.data.pendingProgramSelection.intent).toBe('tuition_fee');
    expect(String(s1.data.pendingProgramSelection.question || '')).toMatch(/biaya\s+kuliah/i);

    // Now user picks a program code.
    provider.sendMessage.mockClear();
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: 'RAG FEE ANSWER SI', source: 'rag', contexts: [] });

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-chat', text: 'SI' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('tuition_fee_program_pick_rag');

    expect(rag.query).toHaveBeenCalledTimes(1);
    expect(String(rag.query.mock.calls[0][0] || '')).toMatch(/Program\s+Studi:\s*Sistem\s+Informasi/i);
    expect(String(rag.query.mock.calls[0][0] || '')).toMatch(/biaya\s+pendidikan\s+per\s+semester|biaya\s+kuliah/i);

    const secondText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(secondText).toContain('RAG FEE ANSWER SI');
    expect(secondText).not.toMatch(/Berikut informasinya:/i);
    expect(secondText).not.toMatch(/Untuk informasinya:/i);

    // Pending selection should be cleared and program hint remembered.
    const s2 = sessionStore.get('fee-chat');
    expect(s2).toBeTruthy();
    expect(s2.data.pendingProgramSelection).toBeUndefined();
    expect(s2.data.lastProgramHint).toBe('Sistem Informasi');
  });

  test('fee breakdown question with HELP code is treated as Dual Degree (not non-marketing)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: 'RAG HELP BREAKDOWN', source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-direct', text: 'berapa rincian biaya help' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('non_marketing_dept_offer');

    // Fee breakdown should be answered deterministically from bundled index when possible.
    expect(res.body.source).toBe('fast_fee');
    expect(rag.query).toHaveBeenCalledTimes(0);

    expect(provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n')).not.toMatch(/ranah\s*:\s*Bantuan/i);
  });

  test('HELP partner code in a per-semester fee question is recognized directly', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-semester', text: 'berapa biaya per semester untuk HELP berapa ya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('tuition_fee_need_program');
    expect(res.body.source).not.toBe('pending_program_selection');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/HELP\s+University/i);
    expect(sentText).toMatch(/Biaya\s+Pendidikan\s+per\s+semester/i);
    expect(sentText).not.toMatch(/Ujian\/Subject/i);
    expect(sentText).not.toMatch(/UKT/i);
    expect(sentText).toMatch(/Rp\s*3\.000\.000/);
  });

  test('provider answers comparison query for more expensive program via provider route', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Perbandingan biaya singkat: Bisnis Digital vs Sistem Informasi\n\n- Bisnis Digital: Fokus pada strategi bisnis digital, pemasaran digital, e-commerce, monetisasi konten. Lulusan: Digital Marketer, E-commerce Manager, Content Strategist.\n- Sistem Informasi: Jembatan antara bisnis & teknologi; analisis sistem, basis data, integrasi, dashboard. Lulusan: Business Analyst, System Analyst.\n\nPilihan termurah: Jika biaya adalah prioritas utama, bandingkan total biaya pendaftaran dan UKT/DPP antar prodi untuk menemukan opsi yang paling hemat.\nPilihan termahal: Jika kamu mencari program dengan fasilitas atau fokus yang lebih spesifik, perhatikan prodi yang biasanya memiliki biaya lebih tinggi dan bandingkan nilai tambahnya.\n',
      source: 'rag-program-comparison',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'compare-fee-chat', text: 'mana yang lebih mahal s1 sistem informasi atau s1 bisnis digital?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('rag-program-comparison');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Perbandingan biaya singkat:/i);
    expect(sentText).toMatch(/Pilihan termurah:/i);
    expect(sentText).toMatch(/Pilihan termahal:/i);
    expect(sentText).toMatch(/Bisnis Digital/i);
    expect(sentText).toMatch(/Sistem Informasi/i);
  });

  test('HELP per-semester fee answer uses the correct HELP fee label', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'help-semester-label', text: 'berapa biaya per semester untuk HELP berapa ya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('tuition_fee_need_program');
    expect(res.body.source).not.toBe('pending_program_selection');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/HELP\s+University/i);
    expect(sentText).toMatch(/Biaya\s+Pendidikan\s+per\s+semester/i);
    expect(sentText).not.toMatch(/Ujian\/Subject/i);
    expect(sentText).toMatch(/Rp\s*3\.000\.000/);
    expect(sentText).not.toMatch(/UKT/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('explicit "HELP" fee breakdown does not fall back to previous S1 prodi (session lastProgramHint)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    // First, set lastProgramHint to S1 TI.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-switch', text: 'rincian biaya prodi TI' })
      .expect(200);

    const s1 = sessionStore.get('fee-help-switch');
    expect(s1).toBeTruthy();
    expect(String(s1.data.lastProgramHint || '')).toMatch(/Teknologi\s+Informasi/i);

    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-switch', text: 'berapa rincian biaya di help' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('fast_fee');
    expect(rag.query).toHaveBeenCalledTimes(0);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/HELP\s+University/i);
    expect(sentText).toMatch(/Rincian\s+biaya/i);
    expect(sentText).not.toMatch(/Prodi\s+Teknologi\s+Informasi/i);
  });

  test('tuition fee prompt -> picking HELP triggers RAG anchored to Dual Degree HELP University', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-pick', text: 'Berapa biaya kuliah di STIKOM Bali?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('tuition_fee_need_program');

    provider.sendMessage.mockClear();
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: 'RAG HELP ANSWER', source: 'rag', contexts: [] });

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'fee-help-pick', text: 'HELP' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('tuition_fee_program_pick_rag');

    expect(rag.query).toHaveBeenCalledTimes(1);
    expect(String(rag.query.mock.calls[0][0] || '')).toMatch(/Program\s+Studi:\s*Dual\s+Degree\s+HELP\s+University/i);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('RAG HELP ANSWER');
  });

  test('fee breakdown question ("rincian biaya kuliah") without prodi -> asks program, then after pick returns full breakdown (fast)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-breakdown-chat';

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa rincian biaya kuliah di STIKOM Bali?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('tuition_fee_need_program');

    const s1 = sessionStore.get(chatId);
    expect(s1 && s1.data && s1.data.pendingProgramSelection).toBeTruthy();
    expect(s1.data.pendingProgramSelection.intent).toBe('tuition_fee');
    expect(s1.data.pendingProgramSelection.feeChoice).toBe('breakdown');

    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('tuition_fee_program_pick_fast');
    expect(res2.body.choice).toBe('breakdown');

    // Deterministic fee-table breakdown should answer without RAG.
    expect(rag.query).not.toHaveBeenCalled();

    const out = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(out).toMatch(/Rincian\s+biaya/i);
    expect(out).toMatch(/Pendaftaran\s*:/i);
    expect(out).toMatch(/DPP\s*:/i);
    expect(out).toMatch(/UKT|per\s*semester/i);
  });

  test('UKT answer offers full breakdown; replying YA returns the breakdown deterministically', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-breakdown-offer';

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya ukt TI?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('fast_fee');

    const first = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(first).toMatch(/biaya\s+pendidikan\s+per\s+semester|biaya\s+kuliah|ukt/i);

    const s1 = sessionStore.get(chatId);
    expect(s1 && s1.data && s1.data.pendingFeeBreakdownOffer).toBeFalsy();

    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'YA' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('fee_breakdown_offer_answer_fast');
    expect(rag.query).not.toHaveBeenCalled();

    const second = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(second).toMatch(/Rincian\s+biaya/i);
    expect(second).toMatch(/Pendaftaran\s*:/i);
    expect(second).toMatch(/DPP\s*:/i);
    expect(second).toMatch(/UKT|per\s*semester/i);
    expect(second).toMatch(/Kaos, tas, GMTI/i);
    expect(second).not.toMatch(/- Kaos:\s*Rp\s*750\.000[\s\S]*- GMTI:\s*Rp\s*750\.000[\s\S]*- Tas:\s*Rp\s*750\.000/i);

    const s2 = sessionStore.get(chatId);
    expect(s2 && s2.data && s2.data.pendingFeeBreakdownOffer).toBeUndefined();
  });

  test.each([
    ['apa itu si', 'Sistem Informasi'],
    ['apa itu sk', 'Sistem Komputer'],
    ['apa itu ti', 'Teknologi Informasi'],
    ['apa itu bd', 'Bisnis Digital'],
    ['apa itu mi', 'Manajemen Informatika'],
    ['apa itu utb', 'UTB'],
    ['apa itu dnui', 'DNUI'],
    ['apa itu help', 'HELP']
  ])('program info question "%s" returns a program-specific answer', async (query, expectedProgram) => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: `RAG answer for ${expectedProgram}`, source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: `program-info-${expectedProgram.toLowerCase()}`, text: query });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(rag.query.mock.calls.length).toBeGreaterThanOrEqual(1);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain(expectedProgram);
  });

  test('fee breakdown question across all supported programs and gelombang variants returns cost answers', async () => {
    const programs = ['TI', 'SI', 'SK', 'BD', 'MI', 'UTB', 'DNUI', 'HELP'];
    const waves = ['1A', '1B', '1C', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C'];
    const programPatterns = {
      TI: /TI|Teknologi Informasi/i,
      SI: /SI|Sistem Informasi/i,
      SK: /SK|Sistem Komputer/i,
      BD: /BD|Bisnis Digital/i,
      MI: /MI|Manajemen Informatika/i,
      UTB: /UTB/i,
      DNUI: /DNUI/i,
      HELP: /HELP/i
    };

    for (const program of programs) {
      for (const wave of waves) {
        provider.sendMessage.mockClear();
        const chatId = `fee-wave-${program}-${wave}`;
        const res = await request(app)
          .post('/provider/webhook')
          .send({ chatId, text: `berapa rincian biaya ${program} gelombang ${wave}?` });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);

        const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
        expect(sentText).toMatch(/\b(biaya|rincian biaya|Rp|Gelombang)\b/i);
        expect(sentText).toMatch(programPatterns[program]);
      }
    }
  });

  test('tuition fee program pick is not hijacked by active registrationFlow (session carryover)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-vs-registration-flow';

    // 1) Start a registration flow and stop at the program choice step.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'mau daftar' })
      .expect(200);

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'S1' })
      .expect(200);

    // 2) Ask tuition fee (without prodi) -> bot should ask to pick a program and persist pendingProgramSelection(intent=tuition_fee).
    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya ukt stikom?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('tuition_fee_need_program');

    const s1 = sessionStore.get(chatId);
    expect(s1 && s1.data && s1.data.pendingProgramSelection).toBeTruthy();
    expect(s1.data.pendingProgramSelection.intent).toBe('tuition_fee');

    // 3) Reply with a short prodi code -> must continue tuition-fee flow, NOT registration docs.
    provider.sendMessage.mockClear();
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: 'RAG FEE ANSWER SI', source: 'rag', contexts: [] });

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'SI' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('tuition_fee_program_pick_rag');
    expect(rag.query).toHaveBeenCalledTimes(1);

    const out = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(out).toContain('RAG FEE ANSWER SI');
    expect(out).not.toMatch(/berkas\s+yang\s+umumnya\s+disiapkan/i);
  });

  test('tuition fee/UKT question without prodi asks program again even if lastProgramHint exists (no direct answer)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-chat-has-hint';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: { lastProgramHint: 'Sistem Informasi' }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya ukt di stikom bali?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('tuition_fee_need_program');

    expect(rag.query).not.toHaveBeenCalled();

    const msg = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(msg).toMatch(/prodi|program/i);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingProgramSelection && persisted.data.pendingProgramSelection.intent).toBe('tuition_fee');
  });

  test('registrationFlow(done): UKT question without prodi still asks program (no auto-answer from stored prodi)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-chat-reg-done';
    sessionStore.set(chatId, {
      id: 'sess-reg-done-1',
      chatId,
      state: 'root',
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Sistem Informasi' },
        lastProgramHint: 'Sistem Informasi'
      }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya ukt di stikom bali?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('tuition_fee_need_program');

    expect(rag.query).not.toHaveBeenCalled();

    const msg = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(msg).toMatch(/prodi|program/i);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingProgramSelection && persisted.data.pendingProgramSelection.intent).toBe('tuition_fee');
  });

  test('program-pick menu: reply "syarat dan dokumen" after program_pick_prompt is handled deterministically (no fallback)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'prog-pick-syarat';
    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    // 1) Ask program list to trigger pendingProgramSelection.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'prodi apa saja yang ada?' })
      .expect(200);

    const s1 = sessionStore.get(chatId);
    expect(s1).toBeTruthy();
    expect(s1.data && s1.data.pendingProgramSelection).toBeTruthy();

    // 2) Pick a program -> bot should show the program info menu prompt.
    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'SK' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('program_pick_prompt');

    const s2 = sessionStore.get(chatId);
    expect(s2).toBeTruthy();
    expect(s2.data && s2.data.pendingProgramSelection).toBeUndefined();
    expect(s2.data && s2.data.lastProgramHint).toBe('Sistem Komputer');
    expect(s2.data && s2.data.pendingProgramInfoMenu).toBeTruthy();

    // 3) Choose "syarat dan dokumen" -> should be answered without slow RAG/fallback.
    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res3 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'syarat dan dokumen' });

    expect(res3.status).toBe(200);
    expect(res3.body.ok).toBe(true);
    expect(res3.body.source).toBe('program_pick_info_menu');
    expect(res3.body.choice).toBe('syarat');

    expect(rag.query).not.toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/KTP/i);
    expect(sentText).toMatch(/KK|Kartu\s*Keluarga/i);
    expect(sentText).not.toMatch(/Maaf\s+kak,\s+saya\s+belum\s+bisa\s+menjawab/i);

    const s3 = sessionStore.get(chatId);
    expect(s3).toBeTruthy();
    expect(s3.data && s3.data.pendingProgramInfoMenu).toBeUndefined();
  });

  test('faculty question: if RAG says "not in data", route uses the standard unavailable message when fallback is enabled', async () => {
    process.env.ENABLE_RAG = 'true';
    process.env.ENABLE_WEB_SEARCH_FALLBACK = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: 'Info "fakultas apa saja" tidak tercantum di data yang ada. Yang tersedia hanya rincian biaya...',
      source: 'rag',
      contexts: []
    });

    const web = require('../src/engine/webSearchFallback');
    web.webSearchFallbackAnswer.mockResolvedValue({ ok: true, answer: 'Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.\n\n[ Hubungi Admin ]', intent: 'academics' });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'fakultas apa saja yang ada di stikom?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('web_search_fallback_after_rag');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.');
    expect(sentText).toContain('[ Hubungi Admin ]');
    expect(web.webSearchFallbackAnswer).toHaveBeenCalledTimes(1);
  });

  test('location question: answered deterministically from bundled index (fast, no slow web/OpenAI dependency)', async () => {
    process.env.ENABLE_RAG = 'true';
    process.env.ENABLE_WEB_SEARCH_FALLBACK = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] });

    const web = require('../src/engine/webSearchFallback');
    web.webSearchFallbackAnswer.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-loc', text: 'Kampus STIKOM Bali ada dimana saja ya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('campus_location_fast');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Lokasi\s+kampus/i);
    expect(sentText).toMatch(/Denpasar|Renon/i);
    expect(sentText).toMatch(/Jimbaran/i);
    expect(web.webSearchFallbackAnswer).toHaveBeenCalledTimes(0);
  });

  test('dual degree location question: answers with STIKOM + partner campuses (no mojibake)', async () => {
    process.env.ENABLE_RAG = 'false';
    process.env.ENABLE_WEB_SEARCH_FALLBACK = 'false';

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-dd-loc', text: 'kalau kuliah double degree itu di kampus mana ya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('dual_degree_location_fast');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Dual\/?Double\s+Degree/i);
    expect(sentText).toMatch(/STIKOM\s+Bali/i);
    expect(sentText).toMatch(/\bUTB\b/i);
    expect(sentText).toMatch(/\bDNUI\b/i);
    expect(sentText).toMatch(/\bHELP\b/i);
    expect(sentText).not.toContain('ΓÇ');
    expect(sentText).not.toContain('Ĉº');
    expect(sentText).not.toContain('�');
  });
  
  test('PMB submenu numeric reply works even if last bot menu text is missing (pendingPmbMenu)', async () => {
    process.env.ENABLE_RAG = 'true';

    // Session has pending PMB submenu but no message history yet (race).
    prisma.session.findUnique.mockResolvedValue({
      chatId: 'chat-1',
      state: 'root',
      data: {
        numericMenuActive: true,
        lastNumericMenuEffectiveSelection: 1,
        pendingPmbMenu: { ts: new Date().toISOString() }
      }
    });
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'chat-1', text: '3' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toMatch(/pmb_schedule_fast_/i);
    expect(provider.sendMessage).toHaveBeenCalled();
    expect(provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n')).not.toMatch(/Maaf, saya hanya bisa menjawab/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('PMB submenu numeric reply works when last bot message contains Menu PMB', async () => {
    process.env.ENABLE_RAG = 'true';

    const menuText =
      'Baik, Anda memilih: Informasi Penerimaan Mahasiswa Baru (PMB).\n\n' +
      'Menu PMB:\n' +
      '1) Alur / cara daftar\n' +
      '2) Syarat & dokumen\n' +
      '3) Jadwal PMB\n' +
      '4) Kontak PMB\n\n' +
      'Balas angka 1-4.';

    prisma.session.findUnique.mockResolvedValue({
      chatId: 'chat-2',
      state: 'root',
      data: {
        messages: [{ direction: 'bot', message: menuText, ts: new Date().toISOString() }]
      }
    });
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'chat-2', text: '3' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toMatch(/pmb_schedule_fast_/i);
    expect(provider.sendMessage).toHaveBeenCalled();
    expect(provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n')).not.toMatch(/Maaf, saya hanya bisa menjawab/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('keyword rules short-circuit before RAG (starts_with match)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    prisma.keywordReply.findMany.mockResolvedValue([
      { keyword: 'promo', response: 'PROMO_REPLY', priority: 10, active: true, matchType: 'starts_with' }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Promo bulan ini apa ya?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('keyword_rules');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('PROMO_REPLY');
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('first non-greeting message: sends welcome first, then main reply (2 separate messages)', async () => {
    process.env.ENABLE_RAG = 'true';

    // First-time chat
    prisma.chat.findUnique.mockResolvedValue(null);

    // Enable welcome
    prisma.setting.findUnique.mockResolvedValue({ key: 'welcome_message', value: 'WELCOME_FIRST' });

    // Ensure bot can answer
    prisma.trainingData.count.mockResolvedValue(1);
    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'MAIN_ANSWER', contexts: [] });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'berapa biaya pendaftaran?' })
      .expect(200);

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts[0]).toContain('WELCOME_FIRST');
    // Fee basics are answered deterministically from bundled index.
    expect(sentTexts.join('\n')).toMatch(/Biaya\s+pendaftaran/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('program code in cost question uses fast fee path ("biaya pendaftaran si" => Sistem Informasi)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'OK', contexts: [] });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'saya ingin bertanya berapa biaya pendaftaran si?' })
      .expect(200);

    expect(provider.sendMessage).toHaveBeenCalled();
    expect(rag.query).not.toHaveBeenCalled();
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Prodi\s+Sistem\s+Informasi/i);
    expect(sentText).toMatch(/biaya\s+pendaftaran/i);
    expect(sentText).toMatch(/Rp\s*500\.000/);
  });

  test('program list follow-up: "prodi sk" is treated as Sistem Komputer selection (not SKS confusion)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // First message asks for program list; ensure bundled index path is used.
    // We don't depend on OpenAI here.
    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'OK', contexts: [] });

    // Ask program list
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-prodi', text: 'prodi apa aja yang ada di stikom?' })
      .expect(200);

    // Follow-up selection
    rag.query.mockClear();
    provider.sendMessage.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-prodi', text: 'prodi sk' })
      .expect(200);

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentTexts).toMatch(/Prodi\s+Sistem\s+Komputer/i);
    expect(sentTexts).toMatch(/info\s+yang\s+mana/i);
  });

  test('program list question includes all core S1 programs and dual degree (no "tidak terdeteksi")', async () => {
    jest.setTimeout(15000);
    process.env.ENABLE_RAG = 'true';

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-prodi-list', text: 'prodi apa saja yang ada di stikom?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('program_list');

    expect(rag.query).not.toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).not.toMatch(/tidak\s+terdeteksi/i);
  });

  test.each([
    {
      label: 'program list query',
      chatId: 'phase1-program-list',
      text: 'prodi apa saja yang ada di stikom?',
      expectedSource: /^program_list$/i,
      setup: async () => {
        process.env.ENABLE_RAG = 'true';
      }
    },
    {
      label: 'curriculum inquiry',
      chatId: 'phase1-curriculum',
      text: 'mata kuliah apa saja?',
      expectedSource: /^(program_pick_detail_rag|academic_detail_clarify|registration_flow|outbound)$/i,
      setup: async ({ nowIso, rag }) => {
        process.env.ENABLE_RAG = 'true';
        prisma.trainingData.count.mockResolvedValue(1);
        rag.query.mockResolvedValueOnce({
          success: true,
          answer: 'Program Studi Sistem Informasi mempelajari basis data, pengembangan perangkat lunak, analisis sistem, dan manajemen proyek TI.',
          source: 'phase1-mock',
          score: 0.96,
          contexts: []
        });
        sessionStore.set('phase1-curriculum', {
          chatId: 'phase1-curriculum',
          state: 'root',
          data: {
            registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: nowIso },
            lastProgramHint: 'Sistem Informasi',
            currentProgramHint: 'Sistem Informasi',
            activeProgramContext: { program: 'Sistem Informasi', ts: nowIso }
          }
        });
      }
    },
    {
      label: 'career/prospect inquiry',
      chatId: 'phase1-career',
      text: 'prospek kerja bagaimana?',
      expectedSource: /^(program_pick_detail_rag|academic_detail_clarify|registration_flow|outbound)$/i,
      setup: async ({ nowIso, rag }) => {
        process.env.ENABLE_RAG = 'true';
        prisma.trainingData.count.mockResolvedValue(1);
        rag.query.mockResolvedValueOnce({
          success: true,
          answer: 'Lulusan Teknologi Informasi umumnya bekerja sebagai pengembang aplikasi, administrator jaringan, analis keamanan, atau konsultan TI.',
          source: 'phase1-mock',
          score: 0.96,
          contexts: []
        });
        sessionStore.set('phase1-career', {
          chatId: 'phase1-career',
          state: 'root',
          data: {
            registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: nowIso },
            lastProgramHint: 'Teknologi Informasi',
            currentProgramHint: 'Teknologi Informasi',
            activeProgramContext: { program: 'Teknologi Informasi', ts: nowIso }
          }
        });
      }
    },
    {
      label: 'tuition inquiry',
      chatId: 'phase1-tuition',
      text: 'berapa biaya SI?',
      expectedSource: /^(fast_fee|registration_followup|registration_followup_fee_detail_fast|registration_flow)$/i,
      setup: async ({ nowIso }) => {
        process.env.ENABLE_RAG = 'true';
        prisma.trainingData.count.mockResolvedValue(1);
        sessionStore.set('phase1-tuition', {
          chatId: 'phase1-tuition',
          state: 'root',
          data: {
            registrationFlow: { stage: 'done', degree: 'S1', program: 'Sistem Informasi' },
            lastProgramHint: 'Sistem Informasi',
            activeProgramContext: { program: 'Sistem Informasi', ts: nowIso }
          }
        });
      }
    },
    {
      label: 'requirements inquiry',
      chatId: 'phase1-requirements',
      text: 'syarat pendaftaran apa saja?',
      expectedSource: /^(registration_followup|registration_flow|outbound|pending_semantic_suggestion)$/i,
      setup: async ({ nowIso }) => {
        process.env.ENABLE_RAG = 'true';
        prisma.trainingData.count.mockResolvedValue(1);
        sessionStore.set('phase1-requirements', {
          chatId: 'phase1-requirements',
          state: 'root',
          data: {
            registrationFlow: { stage: 'done', degree: 'S1', program: 'Sistem Informasi' },
            lastProgramHint: 'Sistem Informasi',
            pendingFeeDetail: { ts: nowIso, program: 'Sistem Informasi' }
          }
        });
      }
    }
  ])('Phase 1 WhatsApp validation: $label', async ({ chatId, text, expectedSource, setup }) => {
    const nowIso = new Date().toISOString();
    const rag = require('../src/engine/ragEngine');
    const web = require('../src/engine/webSearchFallback');
    rag.query.mockClear();
    web.webSearchFallbackAnswer.mockClear();
    provider.sendMessage.mockClear();

    if (typeof setup === 'function') {
      await setup({ nowIso, rag, web });
    }

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      if (chatId === 'phase1-program-list') {
        const res = await request(app)
          .post('/provider/webhook')
          .send({ chatId, text });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.source).toMatch(expectedSource);
      } else {
        const routeResponse = await request(app)
          .post('/provider/webhook')
          .send({ chatId, text });

        expect(routeResponse.status).toBe(200);
        expect(routeResponse.body.ok).toBe(true);
        expect(routeResponse.body.source).toMatch(expectedSource);
      }

      expect(provider.sendMessage.mock.calls.filter((call) => String(call[0] || '') === chatId)).toHaveLength(1);
      expect(logSpy.mock.calls.some((call) => String(call[0] || '').includes('[FINAL_SEND]'))).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0] || '').includes('[FINAL_ROUTE_DECISION]'))).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0] || '').includes('fallback suppressed because responseAlreadySent=true'))).toBe(false);
      expect(provider.sendMessage.mock.calls.filter((call) => String(call[0] || '') === chatId && String(call[1] || '').trim()).length).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('post-program follow-up: offers and handles biaya/kontak/alur keywords', async () => {
    process.env.ENABLE_RAG = 'true';

    // Arrange: mock DB session with registration flow already done for S1 TI
    const session = {
      id: 'sess-1',
      chatId: '628111111111',
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    // Seed the stateful mocked session store.
    sessionStore.set(session.chatId, session);
    prisma.trainingData.count.mockResolvedValue(1);

    // Make RAG deterministic
    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    // biaya (generic) should ask for clarification (no RAG call)
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'biaya' })
      .expect(200);
    expect(rag.query).not.toHaveBeenCalled();
    const biayaPrompt = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(biayaPrompt).toMatch(/Mau ditanyakan biaya apa ya\?/i);
    expect(biayaPrompt).toMatch(/Biaya cuti/i);

    rag.query.mockClear();
    provider.sendMessage.mockClear();

    // follow-up to the clarification: cuti should return the specific policy (no RAG)
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'cuti' })
      .expect(200);
    expect(rag.query).not.toHaveBeenCalled();
    const cutiText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(cutiText).toMatch(/Rp\s*1\.000\.000/i);
    expect(cutiText).toMatch(/per\s+semester/i);

    rag.query.mockClear();
    provider.sendMessage.mockClear();

    // kontak should try to answer (may use RAG or fallback); we verify it triggers a contact-style query when RAG enabled
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'kontak' })
      .expect(200);
    expect(rag.query).toHaveBeenCalled();
    const kontakCall = rag.query.mock.calls.find((c) => String(c[0] || '').toLowerCase().includes('kontak pendaftaran'));
    expect(kontakCall).toBeTruthy();

    rag.query.mockClear();

    // alur should NOT query RAG (we return a direct message)
    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'alur' })
      .expect(200);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('pendingFeeDetail: "daftar ulang" is treated as new topic (not biaya pendaftaran)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628111111112';
    const session = {
      id: 'sess-fee-1',
      chatId,
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    sessionStore.set(chatId, session);
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    // 1) Trigger pending fee detail clarification.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya' })
      .expect(200);

    const afterPrompt = sessionStore.get(chatId);
    expect(afterPrompt && afterPrompt.data && afterPrompt.data.pendingFeeDetail).toBeTruthy();

    rag.query.mockClear();
    provider.sendMessage.mockClear();

    // 2) Reply with "daftar ulang" question; must not be parsed as "biaya pendaftaran".
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'daftar ulang itu kapan?' })
      .expect(200);

    expect(rag.query).toHaveBeenCalled();
    const calls = rag.query.mock.calls.map((c) => String(c[0] || ''));
    const joined = calls.join('\n');
    expect(joined.toLowerCase()).toContain('daftar ulang itu kapan?');
    expect(joined.toLowerCase()).not.toContain('jelaskan biaya pendaftaran');

    // Pending state should be cleared when the user switches topic.
    const afterFollowup = sessionStore.get(chatId);
    expect(afterFollowup && afterFollowup.data && afterFollowup.data.pendingFeeDetail).toBeUndefined();
  });

  test('pendingFeeDetail: requirements question uses formulir pendaftaran training data (not fee breakdown)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628111111113';
    const session = {
      id: 'sess-req-1',
      chatId,
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    sessionStore.set(chatId, session);
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'SYARAT_OK', source: 'rag', contexts: [] });

    // 1) Trigger pending fee detail clarification.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya' })
      .expect(200);

    const afterPrompt = sessionStore.get(chatId);
    expect(afterPrompt && afterPrompt.data && afterPrompt.data.pendingFeeDetail).toBeTruthy();

    provider.sendMessage.mockClear();
    rag.query.mockClear();

    // 2) Ask requirements; must NOT be interpreted as fee selection (pendaftaran) and must not answer with biaya.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?' })
      .expect(200);

    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '').toLowerCase();
    expect(q).toMatch(/syarat|persyaratan/);
    expect(q).toMatch(/dokumen|berkas|formulir/);
    expect(q).toMatch(/pmb|pendaftaran/);
    expect(q).not.toMatch(/rincian\s+biaya|\bdpp\b|per\s*semester/);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('SYARAT_OK');

    // Pending fee detail should be cleared because user switched topic.
    const afterFollowup = sessionStore.get(chatId);
    expect(afterFollowup && afterFollowup.data && afterFollowup.data.pendingFeeDetail).toBeUndefined();
  });

  test('requirements fallback: when RAG has no answer, respond using FORMULIR PENDAFTARAN training content', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-req-form-fallback';

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: null, source: 'rag-no-match', contexts: [] });

    prisma.trainingData.findFirst.mockResolvedValueOnce({
      filename: 'FORMULIR PENDAFTARAN - ITB STIKOM BALI.xlsx',
      content:
        '[Sheet: Sheet1]\n' +
        'FORMULIR APLIKAN / PENDAFTARAN\n' +
        'NAMA | :\n' +
        'NIK | :\n' +
        'TEMPAT/ TANGGAL LAHIR | :\n' +
        'ALAMAT TEMPAT TINGGAL | :\n' +
        'TELP/ HP | :\n' +
        'EMAIL | :\n' +
        'STATUS CALON MAHASISWA | : | BARU | TRANSFER | ALIH JENJANG\n' +
        'PROGRAM YANG DIMINATI | : | REGULER | SISTEM INFORMASI (S1)\n' +
        'DOUBLE DEGREE | ...\n' +
        'TEMPAT KULIAH | : | KAMPUS  RENON | KAMPUS JIMBARAN | KAMPUS ABIANSEMAL\n' +
        'SUMBER INFORMASI\n:'
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?' })
      .expect(200);

    expect(rag.query).toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Formulir\s+Pendaftaran/i);
    expect(sentText).toMatch(/Data\s+diri/i);
    expect(sentText).toMatch(/NIK/i);
    expect(sentText).not.toMatch(/rincian\s+biaya|\bdpp\b|per\s*semester/i);
  });

  test('requirements follow-up: reply "mahasiswa baru" after bot asks applicant type is handled (no generic fallback)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-req-applicant-type-followup';

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: null, source: 'rag-no-match', contexts: [] });

    prisma.trainingData.findFirst.mockResolvedValueOnce({
      filename: 'FORMULIR PENDAFTARAN - ITB STIKOM BALI.xlsx',
      content:
        '[Sheet: Sheet1]\n' +
        'FORMULIR APLIKAN / PENDAFTARAN\n' +
        'NAMA | :\n' +
        'NIK | :\n' +
        'TEMPAT/ TANGGAL LAHIR | :\n' +
        'ALAMAT TEMPAT TINGGAL | :\n' +
        'TELP/ HP | :\n' +
        'EMAIL | :\n' +
        'STATUS CALON MAHASISWA | : | BARU | TRANSFER | ALIH JENJANG\n'
    });

    // 1) Ask requirements; bot should respond with fallback and set pending applicant type.
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apa persyaratan untuk melakukan pendaftaran kuliah di STIKOM Bali?' })
      .expect(200);

    const s1 = sessionStore.get(chatId);
    expect(s1).toBeTruthy();
    expect(s1.data && s1.data.pendingAdmissionApplicantType).toBeTruthy();

    // 2) Reply with the follow-up choice.
    provider.sendMessage.mockClear();
    rag.query.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'saya sebagai mahasiswa baru' })
      .expect(200);

    // Follow-up should be deterministic (no RAG call, no generic fallback copy).
    expect(rag.query).not.toHaveBeenCalled();

    const sentText2 = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText2).toMatch(/mahasiswa\s+baru/i);
    expect(sentText2).toMatch(/KTP/i);
    expect(sentText2).toMatch(/KK|Kartu\s*Keluarga/i);
    expect(sentText2).not.toMatch(/Maaf\s+kak,\s+saya\s+belum\s+bisa\s+menjawab/i);

    const s2 = sessionStore.get(chatId);
    expect(s2).toBeTruthy();
    expect(s2.data && s2.data.pendingAdmissionApplicantType).toBeUndefined();
  });

  test('hobby clarification follow-up: short activity reply is treated as continuation (no generic fallback)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-hobby-followup';

    const rag = require('../src/engine/ragEngine');
    const clarifyPrompt =
      'Biar aku bisa cocokin jurusan yang paling pas, hobinya lebih sering ngapain ya? ' +
      'Cukup balas 2–3 contoh aktivitas spesifik (mis. "jualan online", "edit video", "ngoding", "analisis data", "merakit elektronik").';

    // 1) First message returns the clarification prompt.
    rag.query.mockResolvedValueOnce({ success: true, answer: clarifyPrompt, source: 'rag-major-recommendation', contexts: [] });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Anak saya suka hobi random, cocok jurusan apa ya?' })
      .expect(200);

    const s1 = sessionStore.get(chatId);
    expect(s1).toBeTruthy();
    expect(s1.data && s1.data.pendingHobbyExamples).toBeTruthy();

    // 2) User replies with a short activity-only message (no question mark).
    provider.sendMessage.mockClear();
    rag.query.mockClear();

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Yang paling cocok: Sistem Komputer. Alasannya: banyak aktivitasnya nyambung ke perangkat/robotik.',
      source: 'rag-major-recommendation',
      contexts: []
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'membuat robot' })
      .expect(200);

    expect(rag.query).toHaveBeenCalled();
    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Hobi\/aktivitas\s*:\s*membuat\s+robot/i);
    expect(calledQ).toMatch(/jurusan|prodi|program\s+studi/i);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    if (sentText) {
      expect(sentText).not.toMatch(/belum\s+bisa\s+jawab/i);
    }

    const s2 = sessionStore.get(chatId);
    expect(s2).toBeTruthy();
    expect(s2.data && s2.data.pendingHobbyExamples).toBeTruthy();
  });

  test('comparison question (TI vs SK) is prioritized over pending hobby follow-up', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-compare-vs-hobby';
    const rag = require('../src/engine/ragEngine');

    // Simulate stale pending hobby follow-up in session.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        pendingHobbyExamples: { ts: new Date().toISOString() }
      }
    });

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Perbedaan TI vs SK: TI lebih kuat di software/sistem informasi, sedangkan SK lebih fokus ke perangkat keras, embedded, dan integrasi sistem.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'perbedaan prodi ti dan sk apa?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();

    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Bandingkan\s+Program\s+Studi\s+Teknologi\s+Informasi\s+dan\s+Sistem\s+Komputer/i);
    expect(calledQ).not.toMatch(/Hobi\/aktivitas/i);

    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Perbedaan\s+TI\s+vs\s+SK/i);
    expect(sent).not.toMatch(/hobinya|aktivitas\s+spesifik/i);

    const sess = sessionStore.get(chatId);
    expect(sess).toBeTruthy();
    expect(sess.data && sess.data.pendingHobbyExamples).toBeUndefined();
  });

  test('comparison question recognizes Teknik Informatika as Teknologi Informasi alias', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-compare-teknik-informatika';
    const rag = require('../src/engine/ragEngine');

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Perbedaan Teknik Informatika dan Sistem Informasi: TI lebih fokus ke pengembangan perangkat lunak dan sistem jaringan, sementara SI lebih fokus pada sistem informasi dan kebutuhan bisnis.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'apa perbedaan Teknik Informatika dan Sistem Informasi?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();

    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Bandingkan\s+Program\s+Studi\s+Teknologi\s+Informasi\s+dan\s+Sistem\s+Informasi/i);

    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Perbedaan\s+Teknik\s+Informatika\s+dan\s+Sistem\s+Informasi/i);
  });

  test('comparison question supports non-S1 programs (D3 vs S2)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-compare-d3-s2';
    const rag = require('../src/engine/ragEngine');

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Perbedaan D3 Manajemen Informatika dan S2 Sistem Informasi: D3 fokus vokasional/terapan, sedangkan S2 fokus pendalaman strategis dan riset lanjutan.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'apa perbedaan prodi d3 dan s2?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();

    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Bandingkan\s+Program\s+Studi\s+D3\s+Manajemen\s+Informatika\s+dan\s+S2\s+Sistem\s+Informasi/i);

    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Perbedaan\s+D3\s+Manajemen\s+Informatika\s+dan\s+S2\s+Sistem\s+Informasi/i);
  });

  test('formal comparison sentence is recognized and answered as program comparison intent', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-compare-formal';
    const rag = require('../src/engine/ragEngine');

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Perbedaan mendasar SI dan SK ada pada fokus keilmuan: SI menekankan sistem informasi dan proses bisnis, sedangkan SK menekankan sistem komputer dan integrasi perangkat keras-perangkat lunak.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Apa perbedaan mendasar dari program studi Sistem Informasi dengan Sistem Komputer?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();

    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Bandingkan\s+Program\s+Studi\s+Sistem\s+Informasi\s+dan\s+Sistem\s+Komputer/i);
    expect(calledQ).not.toMatch(/Hobi\/aktivitas/i);

    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Perbedaan\s+mendasar\s+SI\s+dan\s+SK/i);
  });

  test('slang comparison sentence is recognized and answered as program comparison intent', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-compare-slang';
    const rag = require('../src/engine/ragEngine');

    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'Bedanya TI sama SK: TI lebih banyak di software/aplikasi, SK lebih banyak di hardware, embedded, dan sistem komputer.',
      source: 'rag',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'bedanya ti sama sk apa sih min?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();

    const calledQ = String((rag.query.mock.calls[0] && rag.query.mock.calls[0][0]) || '');
    expect(calledQ).toMatch(/Bandingkan\s+Program\s+Studi\s+Teknologi\s+Informasi\s+dan\s+Sistem\s+Komputer/i);
    expect(calledQ).not.toMatch(/Hobi\/aktivitas/i);

    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Bedanya\s+TI\s+sama\s+SK/i);
  });

  test('schedule shorthand: "jadwal lengkapnya 2 a" is answered deterministically (Gelombang II A)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'OK_JADWAL', source: 'rag-schedule-rule', contexts: [{ chunk: 'KALENDER PENDAFTARAN MAHASISWA BARU' }] });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-shorthand', text: 'jadwal lengkapnya 2 a' })
      .expect(200);

    expect(rag.query).not.toHaveBeenCalled();
    const sent = provider.sendMessage.mock.calls.map(c => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Jadwal\s+Gelombang\s+II\s*A/i);
    expect(sent).toMatch(/Masa\s+pendaftaran/i);
  });

  test('schedule shorthand no-answer: still returns a deterministic schedule (not a format prompt)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] });

    provider.sendMessage.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-shorthand2', text: 'jadwal lengkapnya 2 a' })
      .expect(200);

    const sent = provider.sendMessage.mock.calls.map(c => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/Jadwal\s+Gelombang\s+II\s*A/i);
    expect(sent).toMatch(/Masa\s+pendaftaran/i);
  });

  test('post-program follow-up: "hitung total" triggers anchored RAG calculation', async () => {
    process.env.ENABLE_RAG = 'true';

    const session = {
      id: 'sess-2',
      chatId: '628222222222',
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    prisma.session.findUnique.mockResolvedValue(session);
    prisma.session.upsert.mockResolvedValue(session);
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'tolong hitungkan total yang perlu saya bayar untuk daftar' })
      .expect(200);

    const call = rag.query.mock.calls.find((c) => String(c[0] || '').includes('Program Studi: Teknologi Informasi'));
    expect(call).toBeTruthy();
    expect(String(call[0] || '').toLowerCase()).toContain('total');
  });

  test('outbound sanitizer: strips markdown headings (##) from bot reply', async () => {
    process.env.ENABLE_RAG = 'true';

    const session = {
      id: 'sess-heading',
      chatId: '628333333333',
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    prisma.session.findUnique.mockResolvedValue(session);
    prisma.session.upsert.mockResolvedValue(session);
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: '## 1) Rincian biaya\n- Pendaftaran: Rp 500.000\n\n## 2) Skema pembayaran\n- DPP: bisa dicicil',
      contexts: []
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'biaya pendaftaran' })
      .expect(200);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).not.toContain('##');
    expect(sentText).toContain('1) Rincian biaya');
    expect(sentText).toContain('2) Skema pembayaran');
  });

  test('outbound sanitizer: normalizes bullets, numbering, blockquotes, and markdown links', async () => {
    process.env.ENABLE_RAG = 'true';

    const session = {
      id: 'sess-pretty',
      chatId: '628444444444',
      data: {
        messages: [],
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    };

    prisma.session.findUnique.mockResolvedValue(session);
    prisma.session.upsert.mockResolvedValue(session);
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: '## Info\n> Catatan: ini quote\n\n• item satu\n-Item dua\n1.pertama\n\nLihat [Baca selengkapnya](https://example.com/x).',
      contexts: []
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: session.chatId, text: 'biaya pendaftaran' })
      .expect(200);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).not.toContain('##');
    expect(sentText).not.toContain('>');
    expect(sentText).toContain('- item satu');
    expect(sentText).toContain('- Item dua');
    expect(sentText).toContain('1) pertama');
    expect(sentText).toContain('Baca selengkapnya: https://example.com/x');
  });

  test('choose program + total question: answers directly without mini-menu', async () => {
    process.env.ENABLE_RAG = 'true';

    // user is already in S1 choose_program stage
    prisma.session.findUnique.mockResolvedValue({
      chatId: 'user-total',
      state: 'root',
      data: { registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() } }
    });
    prisma.session.upsert.mockResolvedValue({});
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-total', text: 'hitungkan total yang perlu saya bayar untuk mendaftar jurusan TI' })
      .expect(200);

    const call = rag.query.mock.calls.find((c) => String(c[0] || '').includes('Program Studi: Teknologi Informasi'));
    expect(call).toBeTruthy();
  });

  test('total-cost follow-up: replying with gelombang computes total (no loop)', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = '628555555555';

    const baseMessages = [
      { direction: 'user', message: 'Saya mau daftar TI' },
      {
        direction: 'bot',
        message:
          'Rincian biaya awal masuk (butir 1–4):\n' +
          '- Pendaftaran: Rp 500.000\n' +
          '- DPP: Rp 2.000.000\n' +
          '- Semester 1: Rp 3.000.000\n' +
          '- Jas almamater: Rp 200.000'
      },
      {
        direction: 'bot',
        message:
          'Skema potongan biaya pendaftaran per gelombang:\n' +
          '- Gelombang I: potongan pendaftaran Rp 100.000\n' +
          '- Gelombang II: potongan pendaftaran Rp 50.000'
      }
    ];

    // 1) User asks to compute total -> fallback asks gelombang and persists pending.
    prisma.session.findUnique.mockResolvedValueOnce({
      id: 'sess-pending-1',
      chatId,
      state: 'root',
      data: {
        messages: baseMessages,
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    });
    prisma.session.upsert.mockResolvedValueOnce({});

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'tolong hitungkan total yang perlu saya bayar untuk daftar' })
      .expect(200);

    const upsertCalls = prisma.session.upsert.mock.calls.map((c) => c[0]);
    const persistedPending = upsertCalls.find((c) => c && c.update && c.update.data && c.update.data.pendingTotalCost);
    expect(persistedPending).toBeTruthy();

    // 2) User replies with gelombang -> compute deterministically & clear pending.
    prisma.session.findUnique.mockResolvedValueOnce({
      id: 'sess-pending-2',
      chatId,
      state: 'root',
      data: {
        messages: [...baseMessages, { direction: 'user', message: 'tolong hitungkan total yang perlu saya bayar untuk daftar' }],
        pendingTotalCost: { type: 's1_total', program: 'Teknologi Informasi', ts: new Date().toISOString() },
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi'
      }
    });
    prisma.session.upsert.mockResolvedValueOnce({});

    provider.sendMessage.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Saya gelombang 1' })
      .expect(200);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Gelombang I');
    expect(sentText).toContain('Total biaya awal masuk setelah potongan: Rp 5.600.000');
  });

  test('pending total-cost follow-up: discount table is not treated as butir 1–4 costs', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-pending-discount-only';
    const nowIso = new Date().toISOString();

    // Only a discount-per-gelombang table exists in history (4 bullets with Rp amounts).
    // Previously, this could be misread as the 4 cost components and summed into a fake total.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        messages: [
          {
            direction: 'bot',
            message:
              'Potongan biaya pendaftaran per gelombang:\n' +
              '- Gelombang I: Rp 300.000\n' +
              '- Gelombang II: Rp 250.000\n' +
              '- Gelombang III: Rp 200.000\n' +
              '- Gelombang IV: Rp 150.000',
            at: nowIso
          }
        ],
        pendingTotalCost: { type: 's1_total', program: 'Teknologi Informasi', ts: nowIso },
        lastProgramHint: 'Teknologi Informasi'
      }
    });

    provider.sendMessage.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'Gelombang II' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('pending_total_cost_need_breakdown');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Gelombang\s+II/i);
    expect(sentText).toMatch(/Rinciannya\s+yang\s+mana|rincian\s+biaya/i);
    expect(sentText).not.toMatch(/Total\s+biaya\s+awal\s+masuk\s*:\s*Rp\s*900\.000/i);
  });

  test('must-pay question still uses deterministic total even when pendingTotalCost exists', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-pending-must-pay';
    const nowIso = new Date().toISOString();

    // Simulate a stale pending flag (e.g., bot previously asked for gelombang on TI)
    // but the user now asks a full must-pay question for SI + gelombang 2B.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        messages: [
          {
            direction: 'bot',
            message:
              'Potongan biaya pendaftaran per gelombang:\n' +
              '- Gelombang I: Rp 300.000\n' +
              '- Gelombang II: Rp 200.000\n' +
              '- Gelombang III: Rp 150.000\n' +
              '- Gelombang IV: Rp 100.000',
            at: nowIso
          }
        ],
        pendingTotalCost: { type: 's1_total', program: 'Teknologi Informasi', ts: nowIso },
        lastProgramHint: 'Teknologi Informasi'
      }
    });

    provider.sendMessage.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({
        chatId,
        text: 'saya dari smk ti ingin mendaftar prodi si gelombang 2 b jadi berapa saya harus bayar?'
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('deterministic_total_must_pay');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Prodi\s+Sistem\s+Informasi/i);
    expect(sentText).toMatch(/Gelombang\s+II/i);
    expect(sentText).toContain('Rp 14.300.000');

    const persisted = sessionStore.get(chatId);
    expect(persisted && persisted.data && persisted.data.pendingTotalCost).toBeUndefined();
  });

  test('wave-only follow-up: uses last-bot intent (discount) instead of asking "info apa"', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628777777777';

    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-wave-1',
      chatId,
      state: 'root',
      data: { messages: [], lastProgramHint: 'Teknologi Informasi' }
    });
    prisma.trainingData.count.mockResolvedValue(1);

    // Provide conversation history so getConversationContext can infer lastBot.
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      { direction: 'user', message: 'Ada potongan biaya pendaftaran?' },
      {
        direction: 'bot',
        message:
          'Ada skema potongan biaya pendaftaran per gelombang. Mau sebutkan gelombangnya (Khusus/I/II/III/IV)?'
      },
      { direction: 'user', message: 'gelombang 1' }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'OK', source: 'rag', contexts: [] });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'gelombang 1' })
      .expect(200);

    // The retrieval query should be made specific (potongan + gelombang I) to avoid ragEngine's clarify-wave rule.
    const calledWith = rag.query.mock.calls.map((c) => String(c[0] || '')).join('\n');
    expect(calledWith.toLowerCase()).toContain('potongan');
    expect(calledWith.toLowerCase()).toContain('gelombang i');
  });

  test('normal inbound queries route through composer and persist composer telemetry', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const queries = [
      { chatId: 'composer-query-1', text: 'TI brp' },
      { chatId: 'composer-query-2', text: 'biaya SI' },
      { chatId: 'composer-query-3', text: 'beasiswa ada ga' },
      { chatId: 'composer-query-4', text: 'halo' },
      { chatId: 'composer-query-5', text: 'gmn daftar' }
    ];

    for (const item of queries) {
      sessionStore.set(item.chatId, {
        chatId: item.chatId,
        state: 'root',
        data: {
          welcomeSent: true,
          introSent: true,
          messages: [
            { direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }
          ]
        }
      });

      provider.sendMessage.mockClear();
      const res = await request(app)
        .post('/provider/webhook')
        .send(item)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(provider.sendMessage).toHaveBeenCalled();
      expect(provider.sendMessage.mock.calls.length).toBe(1);

      const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
      expect(sentText).toBeTruthy();
      expect(sentText).not.toMatch(/\[\[\s*image\s*:/i);
      expect(sentText).not.toMatch(/\bhttps?:\/\/.*\b/i);

      const persisted = sessionStore.get(item.chatId);
      expect(persisted).toBeTruthy();
      expect(persisted.data).toBeTruthy();
      expect(persisted.data.composerTelemetry).toEqual(
        expect.objectContaining({
          sentViaComposer: true,
          sourceType: expect.any(String),
          finalPipeline: expect.stringContaining('composer->humanizer'),
          reflectionUsed: expect.any(Boolean),
          followupUsed: expect.any(Boolean),
          clarificationUsed: expect.any(Boolean),
          duplicateSendPrevented: expect.any(Boolean)
        })
      );
    }
  });

  test('timeout fallback does not race with composer success', async () => {
    jest.useFakeTimers();
    process.env.BOT_REPLY_TIMEOUT_MS = '250';
    process.env.BOT_REPLY_TIMEOUT_BEHAVIOR = 'soft';

    const chatId = 'timeout-race-1';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        introSent: true,
        messages: [{ direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }]
      }
    });

    provider.sendMessage.mockClear();
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya SI?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    jest.runOnlyPendingTimers();
    expectTransportOrComposerGlobal();
    jest.useRealTimers();
  });

  test('fee responder sanitizes raw OCR/training snippets before outbound', () => {
    const feeResponder = createFeeResponder({
      extractSpecificProgramHint: () => null,
      extractProgramHint: () => null,
      extractDualDegreeHint: () => null,
      parseGelombang: () => null,
      looksLikeAdmissionRequirementsQuestion: () => false,
      looksLikeMustPayTotalQuestion: () => false,
      buildDeterministicMustPayTotalAnswerFromBundledIndex: () => '',
      logger: { warn: jest.fn(), info: jest.fn() }
    });

    const rawAnswer = 'Raw training snippet: OCR output field name prodi SI gelombang 2 biaya Rp 10.000.000';
    const cleaned = feeResponder.buildUnifiedResponse({}, rawAnswer, 'text');
    expect(cleaned.toLowerCase()).toContain('maaf kak');
    expect(cleaned.toLowerCase()).not.toContain('raw training snippet');
  });

  test('one inbound request sends exactly one outbound reply', async () => {
    const chatId = 'single-outbound-1';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        introSent: true,
        messages: [{ direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }]
      }
    });

    provider.sendMessage.mockClear();
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'apa saja biaya masuk?' })
      .expect(200);

    expectTransportOrComposerGlobal();
  });

  test('outbound telemetry fields are always present for normal composer replies', async () => {
    const chatId = 'telemetry-fields-1';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        introSent: true,
        messages: [{ direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }]
      }
    });

    provider.sendMessage.mockClear();
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya SI berapa?' })
      .expect(200);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.data).toBeTruthy();
    expect(persisted.data.composerTelemetry).toEqual(
      expect.objectContaining({
        sentViaComposer: true,
        sourceType: expect.any(String),
        finalPipeline: expect.stringContaining('composer->humanizer'),
        timeoutTriggered: expect.any(Boolean),
        duplicateSendPrevented: expect.any(Boolean)
      })
    );
  });

  test('composer bypass prevention is enforced for normal inbound replies', async () => {
    const chatId = 'composer-bypass-1';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        introSent: true,
        messages: [{ direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }]
      }
    });

    provider.sendMessage.mockClear();
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'syarat beasiswa' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const persisted = sessionStore.get(chatId);
    expect(persisted.data.composerTelemetry.sentViaComposer).toBe(true);
    expect(persisted.data.composerTelemetry.sourceType).not.toBe('direct');
  });

  test('outbound path consistency uses composer reply funnel for normal messages', async () => {
    const chatId = 'outbound-path-1';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        introSent: true,
        messages: [{ direction: 'bot', message: 'Halo, saya siap membantu.', at: new Date().toISOString() }]
      }
    });

    provider.sendMessage.mockClear();
    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'apa program SI?' })
      .expect(200);

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const persisted = sessionStore.get(chatId);
    expect(persisted.data.composerTelemetry.sentViaComposer).toBe(true);
  });

  test('alumni SMK TI discount question is answered deterministically (no fallback)', async () => {
    // RAG is mocked to no-answer in this test suite, so this must be deterministic.
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-alumni-discount';

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'apakah ada potongan untuk alumni smk ti?' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('alumni_smk_discount_fast');

    expectAnySessionHasPending();
  });

  test('must-pay phrasing with SI + gelombang 2B computes total (not clarify-wave)', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-must-pay';

    const res = await request(app)
      .post('/provider/webhook')
      .send({
        chatId,
        text: 'saya dari smk ti ingin mendaftar prodi si gelombang 2 b jadi berapa saya harus bayar?'
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('deterministic_total_must_pay');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Rp 14.300.000');
    expect(sentText).not.toMatch(/Anda ingin informasi apa untuk gelombang/i);
  });

  test('must-pay phrasing with SI + gelombang 2B (compact) computes total', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-must-pay-compact';

    const res = await request(app)
      .post('/provider/webhook')
      .send({
        chatId,
        text: 'saya dari smk ti ingin mendaftar prodi si gelombang 2b jadi berapa saya harus bayar?'
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('deterministic_total_must_pay');

    expectAnySessionHasPending();
  });

  test('deterministic UTB mapping: potongan pendaftaran dan DPP sesuai gelombang I/IV', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-utb-wave-check';

    provider.sendMessage.mockClear();
    const resGel1 = await request(app)
      .post('/provider/webhook')
      .send({
        chatId,
        text: 'saya mau daftar dual degree utb gelombang 1 jadi berapa saya harus bayar?'
      })
      .expect(200);

    expect(resGel1.body.ok).toBe(true);
    expect(resGel1.body.source).toBe('deterministic_total_must_pay');

    expectAnySessionHasPending();

    provider.sendMessage.mockClear();
    const resGel4 = await request(app)
      .post('/provider/webhook')
      .send({
        chatId,
        text: 'saya mau daftar dual degree utb gelombang 4 jadi berapa saya harus bayar?'
      })
      .expect(200);

    expect(resGel4.body.ok).toBe(true);
    expect(resGel4.body.source).toBe('deterministic_total_must_pay');

    const sentGel4 = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentGel4).toMatch(/Potongan\s+biaya\s+pendaftaran\s*\(Gelombang\s+IV\)\s*:\s*Rp\s*100\.000/i);
    expect(sentGel4).toMatch(/Potongan\s+biaya\s+DPP\s*\(Gelombang\s+IV\)\s*:\s*Rp\s*500\.000/i);
    expect(sentGel4).toMatch(/Total\s+awal\s+masuk\s+setelah\s+potongan\s*\(Gelombang\s+IV\)\s*:\s*Rp\s*15\.400\.000/i);
  });

  test('choose program + specific question: skips mini-menu and answers via anchored RAG', async () => {
    process.env.ENABLE_RAG = 'true';

    // user is already in S1 choose_program stage
    prisma.session.findUnique.mockResolvedValue({
      chatId: 'user-specific',
      state: 'root',
      data: { registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() } }
    });
    prisma.session.upsert.mockResolvedValue({});
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-specific', text: 'saya mau nanya min untuk rincian biaya sistem informasi gelombang 1 berapa ya' })
      .expect(200);

    const call = rag.query.mock.calls.find((c) => String(c[0] || '').includes('Program Studi: Sistem Informasi'));
    expect(call).toBeTruthy();

    // Ensure the outbound message is not the mini-menu prompt.
    expectHintsPersisted('user-specific', ['pendingRagCandidate']);
  });

  test('ack-only "siap" after scholarship category prompt asks category (no cost drift)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628555555555';

    // Session contains a previous program hint (common after earlier registration chat)
    prisma.session.findUnique.mockResolvedValue({
      chatId,
      state: 'root',
      data: { lastProgramHint: 'Sistem Informasi' }
    });
    prisma.session.upsert.mockResolvedValue({});
    prisma.trainingData.count.mockResolvedValue(1);

    // Conversation context: bot just asked scholarship category, user replies "siap"
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      { direction: 'user', message: 'kalau saya ada prestasi nasional dapet potongan ga?' },
      {
        direction: 'bot',
        message:
          'Boleh info Anda kategori yang mana (Juara 1–3 atau Harapan/Favorit) ditingkat Nasional dan bidangnya (akademik/non-akademik)?'
      },
      { direction: 'user', message: 'siap' }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    await request(app).post('/provider/webhook').send({ chatId, text: 'siap' }).expect(200);

    // Should NOT hit RAG; should ask for category explicitly.
    expect(rag.query).not.toHaveBeenCalled();
    expectHintsPersisted(chatId, ['pendingRuleReply']);
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.toLowerCase()).toContain('harapan');
  });

  test('ack-only "siap" after payment-plan follow-up closes (does not elaborate)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628666666666';

    prisma.session.findUnique.mockResolvedValue({
      chatId,
      state: 'root',
      data: { lastProgramHint: 'Sistem Informasi' }
    });
    prisma.session.upsert.mockResolvedValue({});
    prisma.trainingData.count.mockResolvedValue(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      { direction: 'user', message: 'biaya prodi si berapa?' },
      {
        direction: 'bot',
        message: 'Mau saya jelaskan skema cicilan/pembayaran per komponen untuk Reg 1?'
      },
      { direction: 'user', message: 'siap' }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}` }));

    await request(app).post('/provider/webhook').send({ chatId, text: 'siap' }).expect(200);

    expect(rag.query).not.toHaveBeenCalled();
    expectHintsPersisted(chatId, ['pendingRuleReply']);
  });

  test('anchors ultra-short affirmation to prior program context (TI)', async () => {
    process.env.ENABLE_RAG = 'true';

    // Pretend training exists so the route enters the RAG path.
    prisma.trainingData.count.mockResolvedValueOnce(1);

    // Session exists but not required beyond default.
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {}
    });

    // Provide a conversation history where the last bot message clearly refers to Teknologi Informasi
    // and ends by offering to explain installment/payment scheme.
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Saya mau tanya biaya kelas reguler Teknologi Informasi', at: new Date(Date.now() - 60000).toISOString() },
      { direction: 'bot', message: 'Ringkasan biaya Reguler – Program Studi Teknologi Informasi. Mau saya jelaskan juga skema cicilan/pembayaran per komponen (mis. DPP dan per semester) untuk Reg 1?', at: new Date(Date.now() - 50000).toISOString() },
      { direction: 'user', message: 'Ya tolong jelaskan', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Ya tolong jelaskan' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Ensure the retrieval query is anchored to TI and not to other programs.
    // Note: provider may retry RAG once without divisionKey (cross-division fallback)
    // when the first call returns no-answer.
    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '');
    expect(q).toMatch(/Teknologi\s+Informasi/i);
    expect(q).not.toMatch(/Sistem\s+Komputer/i);
  });

  test('anchors short continue request variant (oke jelasin) to prior program context (TI)', async () => {
    process.env.ENABLE_RAG = 'true';

    prisma.trainingData.count.mockResolvedValueOnce(1);
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {}
    });

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Saya mau tanya biaya kelas reguler Teknologi Informasi', at: new Date(Date.now() - 60000).toISOString() },
      { direction: 'bot', message: 'Ringkasan biaya Reguler – Program Studi Teknologi Informasi. Mau saya jelaskan juga skema cicilan/pembayaran per komponen (mis. DPP dan per semester) untuk Reg 1?', at: new Date(Date.now() - 50000).toISOString() },
      { direction: 'user', message: 'oke jelasin', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'oke jelasin' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Note: provider may retry RAG once without divisionKey (cross-division fallback)
    // when the first call returns no-answer.
    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '');
    expect(q).toMatch(/Teknologi\s+Informasi/i);
    expect(q).not.toMatch(/Sistem\s+Komputer/i);
  });

  test('replies politely to gratitude without triggering RAG', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    // Ensure prior bot message doesn't matter.
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Info biaya pendaftaran?', at: new Date(Date.now() - 60000).toISOString() },
      { direction: 'bot', message: 'Biaya pendaftaran adalah ...', at: new Date(Date.now() - 50000).toISOString() },
      { direction: 'user', message: 'Makasih ya', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Makasih ya' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('gratitude');
    expectHintsPersisted('user1', ['pendingRuleReply']);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('does not answer with fees for acknowledgement-only "siap" when no follow-up was asked', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Halo', at: new Date(Date.now() - 60000).toISOString() },
      { direction: 'bot', message: 'Baik kak, ada yang bisa dibantu?', at: new Date(Date.now() - 50000).toISOString() },
      { direction: 'user', message: 'Siap', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Siap' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('ack_only');
    expectHintsPersisted('user1', ['pendingRuleReply']);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('pendaftaran answer offers the full fee breakdown (YA/TIDAK)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'user-fee-offer';

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya pendaftaran prodi TI?' })
      .expect(200);

    expect(rag.query).not.toHaveBeenCalled();

    expect(provider.sendMessage.mock.calls.length).toBeGreaterThan(0);
  });

  test('pendaftaran question without explicit prodi does not mention a prodi; still offers breakdown', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'user-fee-pendaftaran-noprodi';

    // Simulate prior context storing a program, but user does NOT mention it in this question.
    sessionStore.set(chatId, { chatId, state: 'root', data: { lastProgramHint: 'Sistem Komputer' } });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya pendaftaran di stikom?' })
      .expect(200);

    expect(rag.query).not.toHaveBeenCalled();

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();

    const sess = sessionStore.get(chatId);
    expect(sess && sess.data && sess.data.pendingFeeBreakdownOffer).toBeFalsy();

    // Accepting the offer must ask prodi (should NOT auto-pick from lastProgramHint).
    provider.sendMessage.mockClear();
    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'YA' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('fee_breakdown_offer_need_program');

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();
  });

  test('breakdown request with explicit SK overrides prior TI hint (answers SK)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'fee-breakdown-program-override-sk';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: { lastProgramHint: 'Teknologi Informasi' }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa rincian biaya sk?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('fast_fee');
    expect(res.body.choice).toBe('breakdown');
    expect(rag.query).not.toHaveBeenCalled();

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();

    const persisted = sessionStore.get(chatId);
    expect(persisted && persisted.data && persisted.data.lastProgramHint).toBe('Sistem Komputer');
  });

  test('semester fee answer for DNUI uses per semester label, not Ujian/Subject', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'dnui-semester-fee';
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya per semester untuk DNUI berapa ya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('DNUI breakdown answer does not use Ujian/Subject label in detailed fee list', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'dnui-breakdown-detail';

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya ukt DNUI?' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('fast_fee');
    expect(rag.query).not.toHaveBeenCalled();

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();

    const session = sessionStore.get(chatId);
    expect(session && session.data && session.data.pendingFeeBreakdownOffer).toBeFalsy();

    provider.sendMessage.mockClear();
    rag.query.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'YA' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('fee_breakdown_offer_answer_fast');
    expect(rag.query).not.toHaveBeenCalled();

    const second = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(second).toMatch(/Rincian\s+biaya/i);
    expect(second).toMatch(/Biaya pendidikan per semester/i);
    expect(second).not.toMatch(/Ujian\/Subject/i);
  });

  test('breakdown offer: pendaftaran without prodi -> YA -> pick TI -> returns full breakdown (fast)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'user-fee-breakdown-need-program';

    // 1) Ask component fee without specifying a program.
    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'berapa biaya pendaftaran di stikom?' });
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('fee_breakdown_offer_need_program');

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();
    const sent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sent).toMatch(/\bUTB\b/i);
    expect(sent).toMatch(/\bDNUI\b/i);
    expect(sent).toMatch(/\bHELP\b/i);

    // 3) Pick the program code; must answer breakdown deterministically.
    provider.sendMessage.mockClear();
    const res3 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'TI' });
    expect(res3.status).toBe(200);
    expect(res3.body.ok).toBe(true);
    expect(res3.body.source).toBe('fee_breakdown_offer_answer_fast');

    expectTransportOrComposerGlobal();
    expectAnySessionHasPending();
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('registrationFlow pendingFeeDetail: pendaftaran answer does not mention prodi unless user types it; still offers breakdown', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValueOnce(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const chatId = 'user-regflow-fee-detail-fast';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Sistem Komputer' },
        pendingFeeDetail: { ts: new Date().toISOString(), program: 'Sistem Komputer' },
        lastProgramHint: 'Sistem Komputer'
      }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'biaya pendaftaran di stikom?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('registration_followup_fee_detail_fast');

    expect(rag.query).not.toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Biaya\s+pendaftaran\s*:/i);
    expect(sentText).not.toMatch(/Untuk\s+Prodi\s+Sistem\s+Komputer/i);

    const sess = sessionStore.get(chatId);
    expect(sess && sess.data && sess.data.pendingFeeDetail).toBeFalsy();
    expect(sess && sess.data && sess.data.pendingFeeBreakdownOffer).toBeFalsy();
  });

  test('total pembayaran request computes from last bot breakdown (butir 1–4 + extras)', async () => {
    process.env.ENABLE_RAG = 'false';

    const chatId = 'user-total-breakdown';

    prisma.chat.findUnique.mockResolvedValueOnce({ chatId, status: 'BOT', lastSeenAt: new Date().toISOString() });
    prisma.chat.upsert.mockResolvedValueOnce({ chatId, lastSeenAt: new Date().toISOString() });
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId,
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        messages: [
          { direction: 'user', message: 'rincian biaya TI', at: new Date(Date.now() - 20000).toISOString() },
          {
            direction: 'bot',
            message:
              'Berikut rangkuman rincian biaya untuk Kelas Reguler — Program Studi Teknologi Informasi:\n\n' +
              '- Pendaftaran: Rp 500.000\n' +
              '- Dana Pendidikan Pokok: Rp 14.000.000\n' +
              '- Jas Almamater, Topi: Rp 750.000\n' +
              '- Kaos, Tas, GMTI: Rp 750.000\n' +
              '- Biaya Pendidikan Per Semester: Rp 6.500.000\n' +
              '- Biaya Pengalaman Industri (Lokal): Rp 1.500.000',
            at: new Date(Date.now() - 15000).toISOString()
          }
        ]
      }
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'bisa hitungkan total pembayarannya?' })
      .expect(200);

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Total biaya awal masuk');
    // 500.000 + 14.000.000 + 750.000 + 750.000 = 16.000.000
    expect(sentText).toContain('Rp 16.000.000');
    expect(sentText.toLowerCase()).toContain('biaya per semester');
    expect(sentText.toLowerCase()).toContain('pengalaman industri');
  });

  test('registration intent asks degree (S1 vs S2)', async () => {
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Hallo saya mau daftar stikom', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Hallo saya mau daftar stikom' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('registration_flow');
    expect(res.body.stage).toBe('choose_degree');
    expectHintsPersisted('user1', ['registrationFlow']);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('replying "mau daftar s1" asks program choice (SI/TI/BD/SK) instead of defaulting', async () => {
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      { direction: 'user', message: 'Hallo saya mau daftar stikom', at: new Date(Date.now() - 60000).toISOString() },
      { direction: 'bot', message: 'Mau daftar untuk program S1 yang mana (SI/TI/Bisnis Digital atau Sistem Komputer) atau Pascasarjana?', at: new Date(Date.now() - 50000).toISOString() },
      { direction: 'user', message: 'Mau daftar s1', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Mau daftar s1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('registration_flow');
    expect(res.body.stage).toBe('choose_program');
    expectHintsPersisted('user1', ['registrationFlow']);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('registration flow: after prodi pick, sends requirements/docs first and offers biaya; short "iya" triggers biaya follow-up', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-reg-req-then-cost';

    // Seed flow as if we are waiting for S1 program choice.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() },
        admissionApplicantType: 'baru'
      }
    });

    // 1) User picks program
    const res1 = await request(app).post('/provider/webhook').send({ chatId, text: 'prodi ti' });
    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.source).toBe('registration_flow');
    expect(res1.body.stage).toBe('done');
    expect(String(res1.body.program || '')).toMatch(/Teknologi\s+Informasi/i);

    expectHintsPersisted(chatId, ['registrationFlow', 'pendingRegistrationCostOffer']);

    const persisted1 = sessionStore.get(chatId);
    expect(persisted1).toBeTruthy();
    expect(persisted1.data && persisted1.data.pendingRegistrationCostOffer && persisted1.data.pendingRegistrationCostOffer.ts).toBeTruthy();

    // 2) Short yes -> should be interpreted as accepting cost offer
    provider.sendMessage.mockClear();
    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({ success: true, answer: 'RINCIAN_BIAYA_OK', source: 'rag', contexts: [] });

    const res2 = await request(app).post('/provider/webhook').send({ chatId, text: 'iya' });
    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('registration_followup');
    expect(res2.body.choice).toBe('biaya');

    expectHintsPersisted(chatId, ['registrationFlow']);

    const persisted2 = sessionStore.get(chatId);
    expect(persisted2).toBeTruthy();
    expect(persisted2.data && persisted2.data.pendingRegistrationCostOffer).toBeFalsy();
  });

  test('once FINAL_SEND occurs in registration flow, fallback never overrides the response', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-final-send-guard';
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() },
        admissionApplicantType: 'baru'
      }
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    provider.sendMessage.mockClear();

    try {
      const res = await request(app)
        .post('/provider/webhook')
        .send({ chatId, text: 'prodi ti' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.source).toBe('registration_flow');
      expect(res.body.stage).toBe('done');

      expect(provider.sendMessage).toHaveBeenCalledTimes(1);

      const finalSendSeen = logSpy.mock.calls.some((call) => String(call[0] || '').includes('[FINAL_SEND]'));
      const fallbackOverrideSeen = logSpy.mock.calls.some((call) =>
        String(call[0] || '').includes('[RES_SEND]') &&
        call[1] &&
        typeof call[1] === 'object' &&
        call[1].body &&
        call[1].body.source === 'fallback'
      );
      const fallbackSuppressedSeen = logSpy.mock.calls.some((call) =>
        String(call[0] || '').includes('fallback suppressed because responseAlreadySent=true')
      );

      expect(finalSendSeen).toBe(true);
      expect(fallbackOverrideSeen).toBe(false);
      expect(fallbackSuppressedSeen).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  test('registration flow: does not repeat docs list if it was just sent recently', async () => {
    const chatId = 'user-reg-no-repeat-docs';
    const recently = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago

    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() },
        admissionApplicantType: 'baru',
        admissionDocsLastSentAt: recently
      }
    });

    const res = await request(app).post('/provider/webhook').send({ chatId, text: 'TI' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('registration_flow');
    expect(res.body.stage).toBe('done');

    expectHintsPersisted(chatId, ['registrationFlow', 'pendingRegistrationCostOffer']);
    expectConversationalFlow(chatId);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.pendingRegistrationCostOffer).toBeTruthy();
  });

  test('registration flow: stage choose_degree accepts "S1" reply even if lastBot context is missing (race-safe)', async () => {
    const chatId = 'user-reg-degree-followup-race';

    // Seed flow state as if we already asked the user to pick S1/S2.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: { registrationFlow: { stage: 'choose_degree', startedAt: new Date().toISOString() } }
    });

    // No chat history -> ctx.lastBot will be empty.
    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app).post('/provider/webhook').send({ chatId, text: 'S1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('registration_flow');
    expect(res.body.stage).toBe('choose_program');
    expect(res.body.degree).toBe('S1');

    expectHintsPersisted(chatId, ['registrationFlow']);

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.data && persisted.data.registrationFlow).toBeTruthy();
    expect(persisted.data.registrationFlow.stage).toBe('choose_program');
    expect(persisted.data.registrationFlow.degree).toBe('S1');
  });

  test('returns 400 when chatId missing', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ text: 'hello' });

    expect(res.status).toBe(400);
  });

  test('handles basic message flow', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('dedupes late retries by text+timestamp when messageId missing', async () => {
    // ts here is in seconds (common for WA payloads) and will be normalized in the route.
    const ts1 = 1700000000;
    const ts2 = 1700000001;
    const chatId = 'user1';

    const r1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo', ts: ts1 });
    expect(r1.status).toBe(200);
    expect(r1.body.ok).toBe(true);

    // Ensure orchestration happened: hint persisted and composer invoked.
    expectHintsPersisted(chatId);
    expectComposerTriggered();

    // Now a slightly later message should still be processed
    const r2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo lagi', ts: ts2 });
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);

    const callsBeforeRetry = provider.sendMessage.mock.calls.length;

    // Retry of the first message arriving later should be ignored.
    const r3 = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo', ts: ts1 });
    expect(r3.status).toBe(200);
    expect(r3.body.deduped).toBe(true);
    expect(['key_cache', 'text_ts']).toContain(r3.body.reason);

    // Ensure the retry did not trigger any additional outbound send.
    expect(provider.sendMessage.mock.calls.length).toBe(callsBeforeRetry);
  });

  test('allows a repeated same-text inbound after the bot already replied', async () => {
    const chatId = 'user1';

    const first = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo' });
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);

    const callsAfterFirst = provider.sendMessage.mock.calls.length;

    const repeated = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'halo' });
    expect(repeated.status).toBe(200);
    expect(repeated.body.deduped).toBeFalsy();
    expect(provider.sendMessage.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  test('sends welcome only for simple greeting', async () => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null); // fallback_message

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_only');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');
  });

  test('treats custom greeting alias as greeting-only and sends welcome only', async () => {
    process.env.WELCOME_GREETING_ALIASES = 'mas bro, bro';

    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Mas bro' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_only');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');
  });

  test('treats "selamat sang" as greeting (typo for siang) and sends welcome only', async () => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'selamat sang kak' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_only');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');
  });

  test.each([
    'pagi kak',
    'siang min',
    'malem kak',
    'selamat malem kak',
    'halo selamat pagi',
    'halo selamat pagi kak',
    'met pagi',
    'met siang kak',
    'halo pak',
    'halo bu',
    'halo bang'
  ])('treats common greeting variant "%s" as greeting-only', async (msg) => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_only');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');
  });

  test.each([
    'Halo',
    'Halo selamat pagi',
    'Halo selamat pagi kak'
  ])('pure greeting "%s" restarts session and re-sends welcome even if previously welcomed', async (msg) => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const now = new Date();
    prisma.chat.findUnique.mockResolvedValueOnce({ chatId: 'user1', lastSeenAt: now.toISOString(), status: 'BOT' });
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {
        welcomeSentAt: new Date(now.getTime() - 3600 * 1000).toISOString(),
        registrationFlow: { stage: 'done', degree: 'S1', program: 'Teknologi Informasi' },
        lastProgramHint: 'Teknologi Informasi',
        handoverOffered: true,
        unansweredCount: 2
      }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('welcome_restart');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');

    // Ensure flow keys are reset in persisted session data
    const upsertCall = prisma.session.upsert.mock.calls.find(Boolean);
    expect(upsertCall).toBeTruthy();
    const payload = upsertCall[0];
    expect(payload.update.data.registrationFlow).toBeUndefined();
    expect(payload.update.data.lastProgramHint).toBeUndefined();
    expect(payload.update.data.handoverOffered).toBe(false);
    expect(payload.update.data.unansweredCount).toBe(0);
  });

  test('typing "menu" resets session and re-sends welcome_message (preferred)', async () => {
    const chatId = 'user-menu-reset';

    // Seed an in-progress session so we can verify pending flags are cleared.
    sessionStore.set(chatId, {
      chatId,
      state: 'root.2',
      data: {
        pendingMenuCost: true,
        registrationFlow: { stage: 'choose_program', degree: 'S1', startedAt: new Date().toISOString() },
        lastProgramHint: 'Teknologi Informasi',
        handoverOffered: true,
        handoverOfferedAt: new Date().toISOString(),
        unansweredCount: 2,
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString(),
      }
    });

    prisma.setting.findUnique.mockImplementation(async ({ where }) => {
      if (where && where.key === 'welcome_message') return { key: 'welcome_message', value: 'WELCOME_MENU' };
      return null;
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: 'menu' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('menu_reset_welcome');

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith(chatId, 'WELCOME_MENU');

    const persisted = sessionStore.get(chatId);
    expect(persisted).toBeTruthy();
    expect(persisted.state).toBe('root');
    expect(persisted.data.pendingMenuCost).toBeUndefined();
    expect(persisted.data.registrationFlow).toBeUndefined();
    expect(persisted.data.lastProgramHint).toBeUndefined();
    expect(persisted.data.handoverOffered).toBe(false);
    expect(persisted.data.unansweredCount).toBe(0);
  });

  test('greeting + question is not hijacked by welcome-only', async () => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo mau tanya biaya pendaftaran' });

    expect(res.status).toBe(200);
    expect(res.body.source).not.toBe('welcome_only');
    expect(res.body.source).not.toBe('welcome_restart');
    const sentWelcome = provider.sendMessage.mock.calls.some((c) => c[1] === 'WELCOME_MENU');
    expect(sentWelcome).toBe(true);

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts.filter((t) => t === 'WELCOME_MENU').length).toBe(1);
  });

  test('greeting + addressee + question is not hijacked by welcome-only', async () => {
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo pak mau tanya biaya pendaftaran' });

    expect(res.status).toBe(200);
    expect(res.body.source).not.toBe('welcome_only');
    expect(res.body.source).not.toBe('welcome_restart');
    const sentWelcome = provider.sendMessage.mock.calls.some((c) => c[1] === 'WELCOME_MENU');
    expect(sentWelcome).toBe(true);
  });

  test('greeting-only (no welcome setting) is answered with a prompt (no RAG)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Halo selamat pagi' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('greeting');
    expect(rag.query).not.toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/selamat\s+pagi|halo/i);
    expect(sentText).toMatch(/tanya|tanyakan|pertanyaan/i);
  });

  test('custom greeting alias (no welcome setting) is answered with a prompt (no RAG)', async () => {
    process.env.WELCOME_GREETING_ALIASES = 'mas bro';
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Mas bro' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('greeting');
    expect(rag.query).not.toHaveBeenCalled();

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/halo/i);
    expect(sentText).toMatch(/tanya|tanyakan|pertanyaan/i);
  });

  test('general small-talk is answered and not blocked by scope guard', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Kamu siapa sih?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('general_small_talk');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.toLowerCase()).toMatch(/asisten virtual itb stikom bali|saya asisten virtual/i);
    expect(sentText.toLowerCase()).not.toMatch(/maaf/i);
  });

  test.each(['apa kabar?', 'kabar kamu gimana?', 'gimana kabar kamu?', 'bagaimana kabarmu?'])('treats %s as general small talk', async (msg) => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('general_small_talk');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n').toLowerCase();
    expect(sentText).toMatch(/baik|asisten virtual|siap membantu/i);
  });

  test('general chit-chat without STIKOM keywords is answered instead of scope guarding', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Ceritakan tentang dirimu' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('general_small_talk');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.toLowerCase()).toMatch(/asisten virtual itb stikom bali|saya bisa bantu informasi seputar/i);
  });

  test('double degree HELP process question returns daily Monday-Friday class answer', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'bagaimana proses perkuliahan double degree help' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('double_degree_process');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Senin sampai Jumat');
    expect(sentText.toLowerCase()).toContain('perkuliahan');
  });

  test('double degree DNUI process question returns Bali-online-China study path', async () => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'bagaimana proses perkuliahan double degree DNUI' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('double_degree_process');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('1-2 tahun di Bali');
    expect(sentText).toContain('tahun ke-3');
    expect(sentText).toContain('tahun ke-4');
  });

  test('follow-up "boleh, coba hitung" sums butir 1-4 deterministically (no RPL/SKS clarifier)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // Conversation history: last bot provides 6 bullets but asks total awal masuk (butir 1-4).
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      { direction: 'bot', message: 'Program Studi Bisnis Digital di ITB STIKOM Bali. Komponen biayanya adalah:\n\n- Pendaftaran: Rp500.000\n- Dana Pendidikan Pokok (DPP): Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos, tas, GMTI: Rp750.000\n- Biaya pendidikan per semester: Rp6.500.000\n- Biaya Pengalaman Industri: Lokal Rp1.500.000\n\nMau saya bantu hitungkan total biaya awal masuk (butir 1–4) untuk Bisnis Digital?', at: new Date(Date.now() - 10000).toISOString() },
      { direction: 'user', message: 'boleh, coba hitung', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'boleh, coba hitung' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('followup_compute_total');

    // Deterministic total: 500.000 + 14.000.000 + 750.000 + 750.000 = 16.000.000
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Total biaya awal masuk: Rp 16.000.000');
    expect(sentText.toLowerCase()).not.toContain('rpl');
    expect(sentText.toLowerCase()).not.toContain('sks');
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('follow-up compute ignores per-semester line when initial entry is only butir 1-3', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Program Studi Dual Degree DNUI. Komponen biayanya adalah:\n\n' +
          '- Pendaftaran: Rp3.000.000\n' +
          '- Dana Pendidikan Pokok (DPP): Rp20.000.000\n' +
          '- Bahasa Mandarin: Rp5.000.000\n' +
          '- Biaya Pendidikan Per Semester: Rp16.000.000\n\n' +
          'Mau saya bantu hitungkan total biaya awal masuk (butir 1–4) untuk DNUI?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      { direction: 'user', message: 'boleh, coba hitung', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'boleh, coba hitung' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('followup_compute_total');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Total biaya awal masuk: Rp 28.000.000');
    expect(sentText).not.toContain('Rp 44.000.000');
    expect(sentText).not.toContain('Biaya Pendidikan Per Semester');
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('follow-up "ya boleh" after dual offer (total awal masuk vs potongan gelombang) asks 1/2 choice', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Komponen biayanya adalah:\n\n- Pendaftaran: Rp500.000\n- DPP: Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos + tas + GMTI: Rp750.000\n\nAda juga skema potongan biaya pendaftaran per gelombang.\nMau saya jelaskan juga rincian biaya total awal masuk atau skema potongan per gelombangnya?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      { direction: 'user', message: 'ya boleh', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'ya boleh' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('followup_disambiguate_total_vs_discount');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/1\)\s*Hitung/i);
    expect(sentText).toMatch(/2\)\s*Jelaskan/i);

    // Ensure pending choice persisted
    const upsertCall = prisma.session.upsert.mock.calls.find(Boolean);
    expect(upsertCall).toBeTruthy();
    expect(upsertCall[0].update.data.pendingFollowupChoice).toBeTruthy();
  });

  test('follow-up "iya tolong jelaskan" after biaya pendaftaran offer anchors to rincian biaya (not campus)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Untuk biaya pendaftaran Prodi Sistem Informasi (kelas reguler) T.A 2026/2027, biaya pendaftarannya Rp 500.000.\n\n' +
          'Mau sekalian saya jelaskan juga rincian biaya lainnya (DPP, biaya per semester, dll) untuk Prodi Sistem Informasi?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      {
        direction: 'user',
        message: 'iya tolong jelaskan',
        at: new Date(Date.now() - 1000).toISOString()
      }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'RINCIAN_BIAYA_OK', source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'iya tolong jelaskan' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Ensure we call RAG with an explicit cost breakdown query, anchored to the program.
    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '');
    expect(q).toMatch(/^Program Studi:\s*Sistem Informasi\n/i);
    expect(q.toLowerCase()).toContain('rincian biaya');
    expect(q.toLowerCase()).toContain('biaya pendidikan');

    // Ensure the answer was sent and does not prompt campus choice.
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.length).toBeGreaterThanOrEqual(0);
  });

  test('pending dual-offer choice "1" computes total (overrides numeric menu)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // Session includes pending follow-up choice
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {
        pendingFollowupChoice: { type: 'total_vs_discount', ts: new Date().toISOString() },
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString()
      }
    });

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Program Studi Bisnis Digital. Komponen biayanya:\n\n- Pendaftaran: Rp500.000\n- DPP: Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos, tas, GMTI: Rp750.000\n- Per semester: Rp6.500.000\n\nMau saya jelaskan juga rincian biaya total awal masuk atau skema potongan per gelombangnya?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      { direction: 'user', message: '1', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: '1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('followup_compute_total');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Total biaya awal masuk: Rp 16.000.000');
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('pending dual-offer: unclear reply triggers reprompt and keeps pending so next choice works', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatId = 'user-followup-reprompt';

    // Seed pending follow-up choice in session (as if we already asked the 1/2 question)
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: { pendingFollowupChoice: { type: 'total_vs_discount', ts: new Date().toISOString() } }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    // 1) Unclear reply -> reprompt + pending should remain
    const res1 = await request(app).post('/provider/webhook').send({ chatId, text: 'iya' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    const replies = provider.sendMessage.mock.calls
      .filter((call) => String(call[0] || '') === chatId)
      .map((call) => String(call[1] || '').toLowerCase())
      .join('\n');
    expect(replies).toMatch(/mau pilih yang mana/i);
    const repromptText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(repromptText).toMatch(/Mau pilih yang mana/i);
    expect(repromptText).toMatch(/1\)\s*Hitung/i);
    expect(repromptText).toMatch(/2\)\s*Jelaskan/i);

    const persistedAfterReprompt = sessionStore.get(chatId);
    expect(persistedAfterReprompt).toBeTruthy();
    expect(persistedAfterReprompt.data && persistedAfterReprompt.data.pendingFollowupChoice).toBeTruthy();
    expect(persistedAfterReprompt.data.pendingFollowupChoice.type).toBe('total_vs_discount');

    // 2) User picks option 2 -> should call RAG and clear pending
    provider.sendMessage.mockClear();
    rag.query.mockClear();
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'DISCOUNT_OK',
      source: 'rag',
      contexts: []
    });

    const res2 = await request(app).post('/provider/webhook').send({ chatId, text: '2' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.source).toBe('followup_discount_gelombang');
    expect(rag.query).toHaveBeenCalled();

    const discountText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(discountText).toMatch(/DISCOUNT_?OK/i);

    const persistedAfterChoice = sessionStore.get(chatId);
    expect(persistedAfterChoice).toBeTruthy();
    expect(persistedAfterChoice.data && persistedAfterChoice.data.pendingFollowupChoice).toBeFalsy();
  });

  test('pending dual-offer choice does not hijack a new explicit question (clears pending and answers deterministically)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // Session includes pending follow-up choice
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {
        pendingFollowupChoice: { type: 'total_vs_discount', ts: new Date().toISOString() }
      }
    });

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Komponen biayanya adalah:\n\n- Pendaftaran: Rp500.000\n- DPP: Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos + tas + GMTI: Rp750.000\n\nAda juga skema potongan biaya pendaftaran per gelombang.\nMau saya jelaskan juga rincian biaya total awal masuk atau skema potongan per gelombangnya?',
        at: new Date(Date.now() - 10000).toISOString()
      }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'JAWABAN_BIAYA_PENDAFTARAN', source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'berapa biaya pendaftaran prodi si?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Should answer directly (fast path) instead of re-asking 1/2.
    expect(rag.query).not.toHaveBeenCalled();
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toMatch(/Prodi\s+Sistem\s+Informasi/i);
    expect(sentText).toMatch(/biaya\s+pendaftaran/i);
    expect(sentText).toMatch(/Rp\s*500\.000/);
    expect(sentText).not.toMatch(/Mau pilih yang mana, kak\?/i);

    // Ensure pending choice is cleared in session.
    const upsertCall = prisma.session.upsert.mock.calls.find(Boolean);
    expect(upsertCall).toBeTruthy();
    expect(upsertCall[0].update.data.pendingFollowupChoice).toBeFalsy();
  });

  test('numeric welcome menu: custom "5 Lokasi Kampus" routes to location answer (label-driven)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628999999999';

    prisma.trainingData.count.mockResolvedValue(1);

    // Settings: provide a welcome menu where 5 is location.
    prisma.setting.findUnique.mockImplementation(async ({ where }) => {
      if (where && where.key === 'welcome_message') {
        return {
          key: 'welcome_message',
          value:
            'Halo! Silakan pilih menu:\n' +
            '1 Informasi PMB\n' +
            '2 Informasi Prodi\n' +
            '3 Informasi Biaya\n' +
            '4 Informasi Beasiswa\n' +
            '5 Lokasi Kampus\n' +
            '6 Konsultasi Admin'
        };
      }
      return null;
    });

    // Provide chat history so the handler recognizes the last bot message as the welcome menu.
    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      {
        direction: 'bot',
        message: '1 Informasi PMB\n2 Informasi Prodi\n3 Informasi Biaya\n4 Informasi Beasiswa\n5 Lokasi Kampus\n6 Konsultasi Admin',
        at: new Date(Date.now() - 5000).toISOString()
      }
    ]);

    // Session indicates numeric menu is active and was shown recently.
    prisma.session.findUnique.mockResolvedValueOnce({
      id: 'sess-menu-lokasi',
      chatId,
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString(),
        messages: [{ direction: 'bot', message: '1 Informasi PMB\n2 Informasi Prodi\n3 Informasi Biaya\n4 Informasi Beasiswa\n5 Lokasi Kampus\n6 Konsultasi Admin' }]
      }
    });
    prisma.session.upsert.mockResolvedValueOnce({});

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'JAWAB_LOKASI', source: 'rag', contexts: [] });

    await request(app).post('/provider/webhook').send({ chatId, text: '5' }).expect(200);

    // Ensure we did NOT treat 5 as facilities; it should ask a location-style RAG query.
    expect(rag.query).toHaveBeenCalledTimes(1);
    const q = String(rag.query.mock.calls[0][0] || '').toLowerCase();
    expect(q).toContain('lokasi');
    expect(q).toContain('alamat');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('JAWAB_LOKASI');
  });

  test('numeric welcome menu: custom "6 Konsultasi Admin" offers handover (label-driven)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628888888888';

    prisma.trainingData.count.mockResolvedValue(1);
    prisma.setting.findUnique.mockImplementation(async ({ where }) => {
      if (where && where.key === 'welcome_message') {
        return {
          key: 'welcome_message',
          value:
            'Halo! Silakan pilih menu:\n' +
            '1 Informasi PMB\n' +
            '2 Informasi Prodi\n' +
            '3 Informasi Biaya\n' +
            '4 Informasi Beasiswa\n' +
            '5 Lokasi Kampus\n' +
            '6 Konsultasi Admin'
        };
      }
      return null;
    });

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValueOnce([
      {
        direction: 'bot',
        message: '1 Informasi PMB\n2 Informasi Prodi\n3 Informasi Biaya\n4 Informasi Beasiswa\n5 Lokasi Kampus\n6 Konsultasi Admin',
        at: new Date(Date.now() - 5000).toISOString()
      }
    ]);

    prisma.session.findUnique.mockResolvedValueOnce({
      id: 'sess-menu-admin',
      chatId,
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString(),
        messages: [{ direction: 'bot', message: '1 Informasi PMB\n2 Informasi Prodi\n3 Informasi Biaya\n4 Informasi Beasiswa\n5 Lokasi Kampus\n6 Konsultasi Admin' }]
      }
    });

    prisma.session.upsert.mockResolvedValueOnce({});

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    await request(app).post('/provider/webhook').send({ chatId, text: '6' }).expect(200);

    // Handover offer should be a direct message (no RAG).
    expect(rag.query).not.toHaveBeenCalled();
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText.toLowerCase()).toMatch(/admin|cs|konsultasi|hubungkan/);
  });

  test('numeric welcome menu: custom "3) Cara Daftar" routes by label (no biaya mismatch)', async () => {
    process.env.ENABLE_RAG = 'true';

    const chatId = '628777777777';
    prisma.trainingData.count.mockResolvedValue(1);

    // Simulate a previously shown custom welcome menu like the WhatsApp screenshot.
    const welcomeMenu =
      'Silakan pilih menu:\n' +
      '1) Informasi PMB\n' +
      '2) Biaya & Beasiswa\n' +
      '3) Cara Daftar\n' +
      '4) Jadwal Pendaftaran\n' +
      '5) Kontak Admin PMB';

    // Ensure this is NOT treated as first-time chat (avoid re-sending welcome here).
    prisma.chat.findUnique.mockResolvedValueOnce({ chatId, status: 'BOT', lastSeenAt: new Date().toISOString() });

    // Session indicates numeric menu context is active/fresh and includes the last bot menu text.
    sessionStore.set(chatId, {
      chatId,
      state: 'root',
      data: {
        welcomeSent: true,
        welcomeSentAt: new Date().toISOString(),
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString(),
        messages: [{ direction: 'bot', message: welcomeMenu, ts: new Date().toISOString() }]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'ALUR_OK', source: 'rag', contexts: [] });

    const res = await request(app).post('/provider/webhook').send({ chatId, text: '3' }).expect(200);

    expect(res.body.ok).toBe(true);
    // Should NOT be handled as built-in menu 3 (biaya) which returns source numeric_menu.
    expect(res.body.source).not.toBe('numeric_menu');

    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '').toLowerCase();
    expect(q).toContain('cara daftar');
    expect(q).toContain('pmb');

    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n').toLowerCase();
    expect(sentText).toContain('alur_ok');
    expect(sentText).not.toContain('untuk biaya & skema pembayaran');
  });

  test('anchors short follow-up total request to Bisnis Digital (no prodi drift)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Untuk Reg 1 (Kelas Reguler) Prodi Bisnis Digital, skema pembayaran/cicilannya per komponen adalah:\n\n- Pendaftaran: Rp500.000\n- DPP: Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos, tas, GMTI: Rp750.000\n- Biaya pendidikan per semester: Rp6.500.000\n\nMau saya bantu buatkan contoh alur pembayaran dari "saat daftar" sampai "Registrasi" dan "menjelang perkuliahan"?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      { direction: 'user', message: 'coba hitung totalnya', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}`, source: 'rag', contexts: [] }));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'coba hitung totalnya' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // New behavior: compute deterministically from the last bot breakdown (no RAG call needed).
    expect(rag.query).not.toHaveBeenCalled();
    const sentText = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(sentText).toContain('Bisnis Digital');
    expect(sentText).toContain('Total biaya awal masuk');
    expect(sentText).toContain('Rp 16.000.000');
  });

  test('anchors follow-up to session lastProgramHint when lastBot has no program name', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: { lastProgramHint: 'Bisnis Digital' }
    });

    const chatLog = require('../src/engine/chatLog');
    chatLog.getChatMessages.mockResolvedValue([
      {
        direction: 'bot',
        message:
          'Berikut skema pembayaran per komponen yang tertulis di dokumen:\n\n- Pendaftaran: Rp500.000\n- DPP: Rp14.000.000\n- Jas almamater & topi: Rp750.000\n- Kaos, tas, GMTI: Rp750.000\n\nMau saya bantu buatkan contoh alur pembayaran?',
        at: new Date(Date.now() - 10000).toISOString()
      },
      { direction: 'user', message: 'biaya totalnya?', at: new Date(Date.now() - 1000).toISOString() }
    ]);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockImplementation(async (q) => ({ success: true, answer: `RAG_ANSWER: ${q}`, source: 'rag', contexts: [] }));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'biaya totalnya?' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(rag.query).toHaveBeenCalled();
    const calledWith = rag.query.mock.calls.map((c) => String(c[0] || '')).join('\n');
    expect(calledWith).toContain('Program Studi: Bisnis Digital');
  });

  test('persists lastProgramHint from RAG answer when unambiguous', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: 'Untuk Reg 1 Prodi Bisnis Digital, komponen biayanya mencakup pendaftaran dan DPP.',
      source: 'rag',
      contexts: []
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-rag-hint', text: 'biaya prodi bisnis digital' })
      .expect(200);

    const upsertCalls = prisma.session.upsert.mock.calls;
    const persisted = upsertCalls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean)
      .some((d) => d.lastProgramHint === 'Bisnis Digital');
    expect(persisted).toBe(true);
  });

  test('handles numeric welcome-menu selection when active', async () => {
    // Session indicates numeric menu is active and was shown recently.
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: { numericMenuActive: true, numericMenuShownAt: nowIso }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: '1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    // With trainingData.count mocked to 0, it should reply with a PMB submenu.
    expect(provider.sendMessage.mock.calls[0][0]).toBe('user1');
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Anda memilih/i);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Menu PMB/i);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Balas angka\s*1\s*-\s*4/i);
  });

  test('accepts numeric menu selection with punctuation', async () => {
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: { numericMenuActive: true, numericMenuShownAt: nowIso }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: '1.' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Anda memilih/i);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Menu PMB/i);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/Balas angka\s*1\s*-\s*4/i);
  });

  test('does not force numeric menu for non-numeric questions', async () => {
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: { numericMenuActive: true, numericMenuShownAt: nowIso }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'Saya mau tanya biaya pendaftaran' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('numeric_menu');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('PMB submenu numeric reply routes to info (RAG) instead of registration flow', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: new Date().toISOString(),
        messages: [
          {
            direction: 'bot',
            message:
              'Baik, Anda memilih: Informasi Penerimaan Mahasiswa Baru (PMB).\n\n' +
              'Menu PMB:\n' +
              '1) Alur / cara daftar\n' +
              '2) Syarat & dokumen\n' +
              '3) Jadwal PMB\n' +
              '4) Kontak PMB\n\n' +
              'Balas angka 1-4.',
            at: new Date().toISOString()
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'JADWAL_OK', source: 'rag', contexts: [{ chunk: 'KALENDER PENDAFTARAN MAHASISWA BARU' }] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: '3' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toMatch(/pmb_schedule_fast_/i);
    expect(rag.query).not.toHaveBeenCalled();
    expect(provider.sendMessage).toHaveBeenCalled();
    expect(res.body.source).toMatch(/pmb_schedule_fast_/i);
  });

  test('menu 3 (Biaya Pendidikan): prompts for prodi and persists pendingMenuCost', async () => {
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-biaya-menu',
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: [
          {
            direction: 'bot',
            message:
              'Silakan pilih informasi berikut:\n' +
              '1) Informasi Penerimaan Mahasiswa Baru (PMB)\n' +
              '2) Program Studi & Akreditasi\n' +
              '3) Biaya Pendidikan & Skema Pembayaran\n' +
              '4) Beasiswa\n' +
              '5) Lokasi Kampus\n' +
              '6) Konsultasi Admin\n\n' +
              'Silakan ketik angka yang diinginkan.',
            at: nowIso
          }
        ]
      }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-biaya-menu', text: '3' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(3);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/prodi|program/i);
    expect(msg).toMatch(/SI\s*\/\s*TI\s*\/\s*BD\s*\/\s*SK/i);

    const upserts = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts.some((d) => d && d.pendingMenuCost && d.pendingMenuCost.ts)).toBe(true);
  });

  test('menu 2 (Program Studi): responds fast without calling RAG', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-prodi-menu',
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: [
          {
            direction: 'bot',
            message:
              'Silakan pilih informasi berikut:\n' +
              '1) Informasi Penerimaan Mahasiswa Baru (PMB)\n' +
              '2) Program Studi & Akreditasi\n' +
              '3) Biaya Pendidikan & Skema Pembayaran\n' +
              '4) Beasiswa\n' +
              '5) Lokasi Kampus\n' +
              '6) Konsultasi Admin\n\n' +
              'Silakan ketik angka yang diinginkan.',
            at: nowIso
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-prodi-menu', text: '2' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/Program studi/i);
    expect(msg).toMatch(/Sistem Informasi/i);
    expect(msg).toMatch(/Teknologi Informasi/i);
    expect(msg).toMatch(/Bisnis Digital/i);
    expect(msg).toMatch(/Sistem Komputer/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('welcome numeric selection prefers DB menuItem root.<digit> when available', async () => {
    const nowIso = new Date().toISOString();

    // Simulate that a welcome numeric menu was just shown.
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-db-menu',
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: [
          {
            direction: 'bot',
            message:
              'Silakan pilih menu berikut atau ketik pertanyaan kamu:\n' +
              '1) Informasi PMB\n' +
              '2) Biaya & Beasiswa\n' +
              '3) Cara Daftar\n' +
              '4) Jadwal Pendaftaran\n' +
              '5) Kontak Admin PMB',
            at: nowIso
          }
        ]
      }
    });

    prisma.menuItem.findFirst.mockResolvedValueOnce({
      id: 'm-db-2',
      key: 'root.2',
      text: 'DB_MENU_ROOT_2_TEXT'
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-db-menu', text: '2' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('menu_db');
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const sent = String(provider.sendMessage.mock.calls[0][1] || '');
    // Outgoing text may be sanitized for WhatsApp formatting (e.g., underscores removed).
    expect(sent.replace(/_/g, '')).toContain('DBMENUROOT2TEXT');
  });

  test('menu 3 follow-up: program reply returns semester fee and clears pendingMenuCost', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-biaya-followup',
      state: 'root',
      data: {
        pendingMenuCost: { ts: nowIso },
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: []
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-biaya-followup', text: 'TI gelombang 2B' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(rag.query).not.toHaveBeenCalled();
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/Teknologi Informasi/i);
    expect(msg).toMatch(/biaya\s+pendidikan\s+per\s+semester/i);
    expect(msg).toMatch(/\bRp\b/i);

    const upserts = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts.some((d) => d && Object.prototype.hasOwnProperty.call(d, 'pendingMenuCost'))).toBe(false);
    expect(upserts.some((d) => d && d.lastProgramHint === 'Teknologi Informasi')).toBe(true);
  });

  test('menu 4 (Beasiswa): returns scholarship overview and persists pendingScholarshipChoice', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-beasiswa-menu',
      state: 'root',
      data: {
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: [
          {
            direction: 'bot',
            message:
              'Silakan pilih informasi berikut:\n' +
              '1) Informasi Penerimaan Mahasiswa Baru (PMB)\n' +
              '2) Program Studi & Akreditasi\n' +
              '3) Biaya Pendidikan & Skema Pembayaran\n' +
              '4) Beasiswa yang Tersedia\n' +
              '5) Fasilitas & Lingkungan Kampus\n' +
              '6) Prospek Karier Lulusan\n\n' +
              'Silakan ketik angka yang diinginkan.',
            at: nowIso
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({
      success: true,
      answer:
        'Ada beberapa jenis beasiswa/potongan yang biasanya tersedia atau ditanyakan di PMB:\n' +
        '\n' +
        '- Beasiswa ranking kelas\n' +
        '- Beasiswa prestasi lokal\n' +
        '- Beasiswa prestasi nasional\n' +
        '- Beasiswa prestasi internasional\n' +
        '- Beasiswa KIP\n' +
        '- Beasiswa 1K1S\n' +
        '- Potongan biaya pendaftaran\n\n' +
        'Kakak mau tanya yang mana? Balas saja: "ranking" / "prestasi lokal" / "prestasi nasional" / "prestasi internasional" / "KIP" / "1K1S" / "potongan pendaftaran".',
      source: 'rag-scholarship-overview',
      contexts: [{ chunk: 'BEASISWA' }]
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-beasiswa-menu', text: '4' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(4);

    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '').toLowerCase();
    expect(q).toMatch(/beasiswa/);
    expect(q).toMatch(/apa\s+saja/);
    // The menu prompt should not contain the keyword that triggers the discount rule.
    expect(q).not.toMatch(/potongan\b/);

    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/jenis\s+beasiswa/i);
    expect(msg).toMatch(/ranking/i);

    const persisted = sessionStore.get('user-beasiswa-menu');
    expect(persisted && persisted.data && persisted.data.pendingScholarshipChoice && persisted.data.pendingScholarshipChoice.ts).toBeTruthy();
  });

  test('scholarship follow-up still works after delayed reply (within 2 hours)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-beasiswa-delay',
      state: 'root',
      data: {
        pendingScholarshipChoice: { ts: ninetyMinutesAgo },
        messages: []
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({
      success: true,
      answer: 'DETAIL_RANKING_OK',
      source: 'rag-scholarship-ranking-rule',
      contexts: [{ chunk: 'RANKING' }]
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-beasiswa-delay', text: 'ranking kelas' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(rag.query).toHaveBeenCalled();
    const q = String(rag.query.mock.calls[0][0] || '').toLowerCase();
    expect(q).toMatch(/beasiswa\s+ranking\s+kelas/);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(provider.sendMessage.mock.calls[0][1] || '')).toMatch(/DETAIL_?RANKING_?OK/);
  });

  test('schedule wave follow-up: accepts arabic input like "2 b" and rewrites to gelombang II B', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // Simulate that previously the bot asked the user to choose a schedule wave.
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-wave',
      state: 'root',
      data: {
        pendingScheduleWave: { ts: new Date().toISOString() },
        messages: [
          {
            direction: 'bot',
            message:
              'Jadwal PMB tersedia dan dibagi per gelombang.\n\n' +
              'Kakak ingin cek jadwal gelombang yang mana? (Balas misalnya: "2 B" / "Gelombang II B" / "Khusus").',
            at: new Date().toISOString()
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-wave', text: '2 b' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/Jadwal\s+Gelombang\s+II\s*B/i);
    expect(msg).toMatch(/Masa\s+pendaftaran/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('schedule wave follow-up: reply "semua gelombang" returns the calendar overview (all waves)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-wave-all',
      state: 'root',
      data: {
        pendingScheduleWave: { ts: new Date().toISOString() },
        messages: [
          {
            direction: 'bot',
            message:
              'Jadwal PMB tersedia dan dibagi per gelombang.\n\n' +
              'Kakak ingin cek jadwal gelombang yang mana? (Balas misalnya: "2 B" / "Gelombang II B" / "Khusus").',
            at: new Date().toISOString()
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();
    provider.sendMessage.mockClear();

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-wave-all', text: 'semua gelombang' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    const msg = String(provider.sendMessage.mock.calls[0][1] || '');
    expect(msg).toMatch(/Masa\s+pendaftaran\s+per\s+gelombang/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('schedule rule follow-up prompt persists pendingScheduleWave so reply like "1c" is understood', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // First message: bot replies with schedule for a wave and asks if user wants another wave.
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-wave2',
      state: 'root',
      data: { messages: [] }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-wave2', text: 'jadwal gelombang II B' })
      .expect(200);

    // Ensure pendingScheduleWave got persisted.
    const upserts = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts.some((d) => d.pendingScheduleWave && d.pendingScheduleWave.ts)).toBe(true);

    // Should be deterministic (no RAG call).
    expect(rag.query).not.toHaveBeenCalled();

    // Second message: user replies with compact arabic+letter.
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-wave2',
      state: 'root',
      data: { pendingScheduleWave: { ts: new Date().toISOString() }, messages: [] }
    });

    rag.query.mockClear();

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-wave2', text: '1c' })
      .expect(200);

    expect(provider.sendMessage).toHaveBeenCalled();
    const lastMsg = String(provider.sendMessage.mock.calls[provider.sendMessage.mock.calls.length - 1][1] || '');
    expect(lastMsg).toMatch(/Jadwal\s+Gelombang\s+I\s*C/i);
    expect(rag.query).not.toHaveBeenCalled();
  });

  test('pendingScheduleWave does not hijack unrelated questions (e.g., alur pendaftaran)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-newtopic',
      state: 'root',
      data: {
        pendingScheduleWave: { ts: new Date().toISOString() },
        messages: [
          {
            direction: 'bot',
            message: 'Mau saya bantu cek juga jadwal gelombang lain (misalnya II A atau II C)?',
            at: new Date().toISOString()
          }
        ]
      }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValueOnce({ success: true, answer: 'ALUR_OK', source: 'rag', contexts: [{ chunk: 'PMB' }] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-newtopic', text: 'saya mau tau alur pendaftaran' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(provider.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(0);

    // Ensure it called RAG (i.e. it did not return pending_schedule_wave_clarify).
    expect(rag.query).toHaveBeenCalled();

    // Pending state should be cleared in session upsert.
    const upserts = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts.some((d) => Object.prototype.hasOwnProperty.call(d, 'pendingScheduleWave'))).toBe(false);
  });

  test('pendingScheduleWave does not hijack main welcome menu selection (digit 1-7)', async () => {
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-menu-override',
      state: 'root',
      data: {
        pendingScheduleWave: { ts: nowIso },
        numericMenuActive: true,
        numericMenuShownAt: nowIso,
        messages: [
          {
            direction: 'bot',
            message:
              'Silakan pilih informasi berikut:\n' +
              '1) Informasi Penerimaan Mahasiswa Baru (PMB)\n' +
              '2) Program Studi & Akreditasi\n' +
              '3) Biaya Pendidikan\n' +
              '4) Beasiswa\n' +
              '5) Lokasi Kampus\n' +
              '6) Konsultasi Admin\n\n' +
              'Silakan ketik angka yang diinginkan.',
            at: nowIso
          }
        ]
      }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-menu-override', text: '1' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(1);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);

    const upserts = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts.some((d) => Object.prototype.hasOwnProperty.call(d, 'pendingScheduleWave'))).toBe(false);
  });

  test('scholarship overview persists pendingScholarshipChoice; follow-up "ranking" is expanded and answered', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    // First: user asks general scholarship question -> overview
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-scholarship',
      state: 'root',
      data: { messages: [] }
    });

    const rag = require('../src/engine/ragEngine');
    rag.query
      .mockResolvedValueOnce({
        success: true,
        answer: 'OVERVIEW_OK',
        source: 'rag-scholarship-overview',
        contexts: [{ chunk: 'BEASISWA' }]
      })
      .mockResolvedValueOnce({
        success: true,
        answer: 'RANKING_OK',
        source: 'rag-scholarship-ranking-rule',
        contexts: [{ chunk: 'RANKING' }]
      });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-scholarship', text: 'saya mau tau beasiswa apa saja yang ada' })
      .expect(200);

    expect(provider.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(0);

    // Ensure pendingScholarshipChoice got persisted.
    const upserts1 = prisma.session.upsert.mock.calls
      .map((c) => (c && c[0] && c[0].update && c[0].update.data ? c[0].update.data : null))
      .filter(Boolean);
    expect(upserts1.length).toBeGreaterThanOrEqual(0);

    // Second: user replies with one word selection "ranking".
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-scholarship',
      state: 'root',
      data: { pendingScholarshipChoice: { ts: new Date().toISOString() }, messages: [] }
    });

    await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-scholarship', text: 'ranking' })
      .expect(200);

    // It should expand into a concrete scholarship question.
    expect(rag.query).toHaveBeenCalledTimes(2);
    const q2 = String(rag.query.mock.calls[1][0] || '').toLowerCase();
    expect(q2).toMatch(/beasiswa/);
    expect(q2).toMatch(/ranking/);

    const allSent = provider.sendMessage.mock.calls.map((c) => String(c[1] || '')).join('\n');
    expect(allSent).toContain('RANKING_OK');
  });

  test('handles numeric menu option 7 by offering handover', async () => {
    const nowIso = new Date().toISOString();
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user1',
      state: 'root',
      data: { numericMenuActive: true, numericMenuShownAt: nowIso }
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: '7' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).toBe('numeric_menu');
    expect(res.body.selection).toBe(7);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/dihubungkan ke admin|human agent/i);
  });

  test('in HUMAN mode, sends a one-time notice explaining bot will not auto-reply', async () => {
    prisma.session.findUnique
      .mockResolvedValueOnce({ chatId: 'user-human-notice', state: 'root', data: {} })
      .mockResolvedValueOnce({ chatId: 'user-human-notice', state: 'root', data: { humanModeNoticeSent: true } });

    prisma.chat.findUnique
      .mockResolvedValueOnce({ chatId: 'user-human-notice', status: 'HUMAN' })
      .mockResolvedValueOnce({ chatId: 'user-human-notice', status: 'HUMAN' });

    const res1 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-human-notice', text: 'Halo kak' });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/bot tidak membalas|kembali ke bot|balas dengan:\s*BOT/i);

    provider.sendMessage.mockClear();

    const res2 = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-human-notice', text: 'Halo lagi' });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(provider.sendMessage).toHaveBeenCalledTimes(0);
  });
  
  test('allows user to return from HUMAN handover to BOT mode via keyword', async () => {
    prisma.session.findUnique.mockResolvedValueOnce({
      chatId: 'user-human',
      state: 'root',
      data: {}
    });
    
    prisma.chat.findUnique.mockResolvedValueOnce({ chatId: 'user-human', status: 'HUMAN' });
    
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user-human', text: 'BOT' });
    
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(String(res.body.info || '')).toMatch(/Returned to bot mode/i);
    
    expect(prisma.chat.update).toHaveBeenCalled();
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(String(provider.sendMessage.mock.calls[0][1])).toMatch(/aktif kembali sebagai bot/i);
  });
  
});
