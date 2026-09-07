process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.PROVIDER_TOKEN = '';
process.env.FORCE_BUNDLED_INDEX = 'true';

const express = require('express');
const request = require('supertest');

describe('Session Anaphora & Program Context Bridge Matrix', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;
  let traces = [];
  let providerRouterFactory;
  let prisma;
  let chatLog;
  let msgCounter = 1;

  beforeEach(() => {
    jest.setTimeout(60000);
    process.env.PROVIDER_WEBHOOK_TOKEN = '';
    process.env.PROVIDER_TOKEN = '';
    process.env.FORCE_BUNDLED_INDEX = 'true';
    jest.resetModules();

    sessionStore = new Map();
    chatStore = new Map();
    traces = [];
    msgCounter = 1;

    prisma = require('../src/db');
    prisma.session = {
      findUnique: jest.fn(async ({ where }) => {
        const id = where && where.chatId ? String(where.chatId) : '';
        return id ? (sessionStore.get(id) || null) : null;
      }),
      upsert: jest.fn(async ({ where, update, create }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        if (!chatId) return {};
        const prev = sessionStore.get(chatId) || { chatId, state: 'root', data: {} };
        const mergedData = { ...(prev.data || {}), ...((update && update.data) || (create && create.data) || {}) };
        const saved = { chatId, state: (update && update.state) || (create && create.state) || prev.state || 'root', data: mergedData };
        sessionStore.set(chatId, saved);
        return saved;
      }),
      update: jest.fn(async ({ where, data }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        const prev = sessionStore.get(chatId) || { chatId, state: 'root', data: {} };
        const saved = { chatId, state: prev.state, data: { ...(prev.data || {}), ...(data || {}) } };
        sessionStore.set(chatId, saved);
        return saved;
      })
    };

    prisma.chat = {
      findUnique: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }),
      upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }),
      update: jest.fn().mockResolvedValue({})
    };

    prisma.setting = {
      findUnique: jest.fn().mockResolvedValue(null)
    };

    prisma.keywordReply = {
      findMany: jest.fn().mockResolvedValue([])
    };

    prisma.trainingData = {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    };

    prisma.menuItem = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    };

    chatLog = require('../src/engine/chatLog');
    chatLog.appendChatMessage = jest.fn(async (chatId, direction, message) => {
      const arr = chatStore.get(chatId) || [];
      arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
      chatStore.set(chatId, arr);
    });
    chatLog.getChatMessages = jest.fn(async (chatId) => {
      return chatStore.get(chatId) || [];
    });

    provider = {
      sendMessage: jest.fn().mockResolvedValue({ ok: true })
    };

    providerRouterFactory = require('../src/routes/provider');
    app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));
  });

  async function executeTurn(chatId, text) {
    const sessionBefore = JSON.parse(JSON.stringify(sessionStore.get(chatId) || {}));
    const messageId = `msg-${chatId}-${msgCounter++}-${Date.now()}`;
    const res = await request(app).post('/provider/webhook').send({ chatId, text, messageId, inboundTs: Date.now() });
    const sessionAfter = JSON.parse(JSON.stringify(sessionStore.get(chatId) || {}));
    const lastSendCall = provider.sendMessage.mock.calls[provider.sendMessage.mock.calls.length - 1];
    const replyText = lastSendCall ? lastSendCall[1] : (res.body && res.body.message ? res.body.message : '');

    const trace = {
      query: text,
      status: res.status,
      sessionBefore: sessionBefore.data,
      sessionAfter: sessionAfter.data,
      replyText: String(replyText || ''),
      resBody: res.body
    };
    traces.push(trace);
    return trace;
  }

  test('Multi-turn positive matrix & negative controls', async () => {
    console.log('=== MULTI-TURN POSITIVE MATRIX ===');
    
    // 1. TI -> mata kuliahnya apa?
    console.log('\n--- 1. TI -> mata kuliahnya apa? ---');
    let t1 = await executeTurn('user-ti-mk', 'Teknologi Informasi');
    console.log('Turn 1.1 (TI):', t1.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t1.sessionAfter && t1.sessionAfter.lastProgramHint);
    let t2 = await executeTurn('user-ti-mk', 'mata kuliahnya apa?');
    console.log('Turn 1.2 (mata kuliahnya apa?):', t2.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t2.sessionAfter && t2.sessionAfter.lastProgramHint);
    expect(t2.replyText).toMatch(/Teknologi Informasi/i);
    expect(t2.replyText).toMatch(/mata kuliah|kurikulum|pemrograman|jaringan|software|struktur data/i);

    // 2. TI -> prospek kerjanya apa?
    console.log('\n--- 2. TI -> prospek kerjanya apa? ---');
    let t3 = await executeTurn('user-ti-prospek', 'Prodi TI');
    console.log('Turn 2.1 (Prodi TI):', t3.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t3.sessionAfter && t3.sessionAfter.lastProgramHint);
    let t4 = await executeTurn('user-ti-prospek', 'prospek kerjanya apa?');
    console.log('Turn 2.2 (prospek kerjanya apa?):', t4.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t4.sessionAfter && t4.sessionAfter.lastProgramHint);
    expect(t4.replyText).toMatch(/Teknologi Informasi/i);
    expect(t4.replyText).toMatch(/prospek|karier|lulusan|software|engineer/i);

    // 3. TI -> gampang dipelajari?
    console.log('\n--- 3. TI -> gampang dipelajari? ---');
    let t5 = await executeTurn('user-ti-gampang', 'Teknologi Informasi');
    console.log('Turn 3.1 (TI):', t5.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t5.sessionAfter && t5.sessionAfter.lastProgramHint);
    let t6 = await executeTurn('user-ti-gampang', 'gampang dipelajari?');
    console.log('Turn 3.2 (gampang dipelajari?):', t6.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t6.sessionAfter && t6.sessionAfter.lastProgramHint);
    expect(t6.replyText).toMatch(/Teknologi Informasi/i);

    // 4. SI -> kerjanya nanti jadi apa?
    console.log('\n--- 4. SI -> kerjanya nanti jadi apa? ---');
    let t7 = await executeTurn('user-si-kerja', 'Sistem Informasi');
    console.log('Turn 4.1 (SI):', t7.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t7.sessionAfter && t7.sessionAfter.lastProgramHint);
    let t8 = await executeTurn('user-si-kerja', 'kerjanya nanti jadi apa?');
    console.log('Turn 4.2 (kerjanya nanti jadi apa?):', t8.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t8.sessionAfter && t8.sessionAfter.lastProgramHint);
    expect(t8.replyText).toMatch(/Sistem Informasi/i);
    expect(t8.replyText).toMatch(/prospek|karier|lulusan|analyst|konsultan|pengembang/i);

    // 5. BD -> mata kuliahnya apa?
    console.log('\n--- 5. BD -> mata kuliahnya apa? ---');
    let t9 = await executeTurn('user-bd-mk', 'Bisnis Digital');
    console.log('Turn 5.1 (BD):', t9.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t9.sessionAfter && t9.sessionAfter.lastProgramHint);
    let t10 = await executeTurn('user-bd-mk', 'mata kuliahnya apa?');
    console.log('Turn 5.2 (mata kuliahnya apa?):', t10.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', t10.sessionAfter && t10.sessionAfter.lastProgramHint);
    expect(t10.replyText).toMatch(/Bisnis Digital/i);
    expect(t10.replyText).toMatch(/mata kuliah|kurikulum|e-commerce|marketing|bisnis/i);

    console.log('\n=== NEGATIVE CONTROLS ===');
    // NC1: TI -> biaya SI berapa? -> explicit SI must override inherited TI
    console.log('\n--- NC1: TI -> biaya SI berapa? ---');
    let nc1_1 = await executeTurn('user-nc1', 'Teknologi Informasi');
    let nc1_2 = await executeTurn('user-nc1', 'biaya SI berapa?');
    console.log('NC1 (biaya SI berapa?):', nc1_2.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', nc1_2.sessionAfter && nc1_2.sessionAfter.lastProgramHint);
    expect(nc1_2.replyText).toMatch(/Sistem Informasi/i);
    expect(nc1_2.replyText).not.toMatch(/Teknologi Informasi/i);

    // NC2: TI -> info beasiswa -> scholarship must override TI
    console.log('\n--- NC2: TI -> info beasiswa ---');
    let nc2_1 = await executeTurn('user-nc2', 'Teknologi Informasi');
    let nc2_2 = await executeTurn('user-nc2', 'info beasiswa');
    console.log('NC2 (info beasiswa):', nc2_2.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', nc2_2.sessionAfter && nc2_2.sessionAfter.lastProgramHint);
    expect(nc2_2.replyText).toMatch(/beasiswa|kip|potongan/i);

    // NC3: TI -> jadwal PMB kapan? -> PMB must override TI
    console.log('\n--- NC3: TI -> jadwal PMB kapan? ---');
    let nc3_1 = await executeTurn('user-nc3', 'Teknologi Informasi');
    let nc3_2 = await executeTurn('user-nc3', 'jadwal PMB kapan?');
    console.log('NC3 (jadwal PMB kapan?):', nc3_2.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', nc3_2.sessionAfter && nc3_2.sessionAfter.lastProgramHint);
    expect(nc3_2.replyText).toMatch(/gelombang|jadwal|pendaftaran/i);

    // NC4: stale TI context + vague gimana? -> must clarify, not resurrect TI
    console.log('\n--- NC4: stale TI + gimana? ---');
    const staleTs = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    sessionStore.set('user-nc4', {
      chatId: 'user-nc4',
      state: 'root',
      data: {
        lastProgramHint: 'Teknologi Informasi',
        lastProgramHintAt: staleTs,
        activeProgramContext: { program: 'Teknologi Informasi', ts: staleTs }
      }
    });
    let nc4 = await executeTurn('user-nc4', 'gimana?');
    console.log('NC4 (stale TI + gimana?):', nc4.replyText.slice(0, 100).replace(/\n/g, ' '), '| ProgramHint:', nc4.sessionAfter && nc4.sessionAfter.lastProgramHint);
    expect(nc4.replyText).toMatch(/bantu|jelaskan|tanyakan|spesifik|kurang jelas/i);
    expect(nc4.replyText).not.toMatch(/Kurikulum Prodi Teknologi Informasi/i);
  }, 60000);
});
