const express = require('express');
const request = require('supertest');

// Mock DB and engines to avoid hitting real database or OpenAI
jest.mock('../src/db', () => ({
  chat: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({ chatId: 'user1', status: 'BOT' }),
    update: jest.fn().mockResolvedValue({})
  },
  setting: {
    findUnique: jest.fn().mockResolvedValue(null)
  },
  trainingData: {
    count: jest.fn().mockResolvedValue(0)
  },
  session: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({})
  },
  menuItem: {
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

describe('Message examples (real WA phrasing)', () => {
  let app;
  let provider;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    provider = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    providerRouterFactory = require('../src/routes/provider');
    prisma = require('../src/db');

    app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    // Default: show welcome menu
    prisma.setting.findUnique
      .mockResolvedValueOnce({ key: 'welcome_message', value: 'WELCOME_MENU' })
      .mockResolvedValueOnce(null);
  });

  test.each([
    'Halo',
    'halo pak',
    'halo bu',
    'halo bang',
    'haloo',
    'halooo kak',
    'pgi min',
    'pg kak',
    'siank kak',
    'mlm kak',
    'malem kak',
    'selamat sang kak',
    'assalamualaikum',
    'assalamu alaikum min',
    'met pagi',
    'met siang kak'
  ])('greeting-only "%s" -> welcome_only', async (msg) => {
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(['welcome_only', 'welcome_restart']).toContain(res.body.source);
    expect(provider.sendMessage).toHaveBeenCalledTimes(1);
    expect(provider.sendMessage).toHaveBeenCalledWith('user1', 'WELCOME_MENU');
  });

  test.each([
    'pgi min mau tanya biaya pendaftaran',
    'siank kak mau tanya gelombang apa aja',
    'malem kak mau tanya jadwal gel 2b kapan'
  ])('greeting + question "%s" -> welcome + answer (2 messages)', async (msg) => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: 'MAIN_ANSWER', source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('welcome_only');
    expect(res.body.source).not.toBe('welcome_restart');

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts[0]).toBe('WELCOME_MENU');

    const joined = sentTexts.join('\n');
    // Schedule queries are handled deterministically from bundled training (fast-path)
    if (/\bjadwal\b/i.test(msg) && /\b(gelombang|gel\.?|gbg)\b/i.test(msg)) {
      expect(joined).toMatch(/Jadwal\s+Gelombang/i);
      expect(rag.query).not.toHaveBeenCalled();
    } else if (/(biaya|uang|\brp\b)/i.test(msg) && /\b(pendaftaran|daftar|registrasi)\b/i.test(msg)) {
      expect(joined).toMatch(/Biaya\s+pendaftaran/i);
      expect(rag.query).not.toHaveBeenCalled();
    } else {
      expect(joined).toContain('MAIN_ANSWER');
      expect(rag.query).toHaveBeenCalled();
    }
  });

  test('wave-list question uses wave-list answer (no guessing)', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: 'Gelombang PMB yang tersedia: I A, I B, II A.\n\nKakak mau cek gelombang yang mana?',
      source: 'rag-wave-list',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'gelombang apa aja sih?' });

    expect(res.status).toBe(200);
    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts[0]).toBe('WELCOME_MENU');
    expect(sentTexts.join('\n')).toMatch(/Gelombang PMB/i);
    expect(sentTexts.join('\n')).not.toMatch(/Anda ingin informasi apa untuk gelombang/i);
  });

  test.each([
    'biaya daftar brp?',
    'biaya pendaftaran brp ya min?',
    'syarat pendaftaran apa aja?',
    'dokumen yang dibutuhin apa aja?',
    'kontak pmb dong',
    'nomor wa pmb brp?'
  ])('common question "%s" -> welcome + answer', async (msg) => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: `RAG_ANSWER: ${msg}`, source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.source).not.toBe('welcome_only');
    expect(res.body.source).not.toBe('welcome_restart');

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts[0]).toBe('WELCOME_MENU');

    const joined = sentTexts.join('\n');
    const isRegistrationFeeQuestion = /(biaya|uang|\brp\b)/i.test(msg) && /\b(pendaftaran|daftar|registrasi)\b/i.test(msg);
    if (isRegistrationFeeQuestion) {
      expect(joined).toMatch(/Biaya\s+pendaftaran/i);
      expect(rag.query).not.toHaveBeenCalled();
    } else {
      expect(joined).toContain(`RAG_ANSWER: ${msg}`);
      expect(rag.query).toHaveBeenCalled();
    }
  });

  test.each([
    'jadwal pmb',
    'jadwal pendaftaran sampai kapan?',
    'jadwal pendaftaran',
    'jadwal gelombang 2b'
  ])('schedule question "%s" -> welcome + deterministic calendar answer', async (msg) => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: `RAG_ANSWER: ${msg}`, source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts[0]).toBe('WELCOME_MENU');

    const joined = sentTexts.join('\n');

    // If user asks a specific wave, the fast-path returns a detailed answer.
    // Otherwise it returns an overview/calendar listing.
    if (/\bgelombang\b/i.test(msg) && /([0-9]{1,2}|[ivx]{1,6})[a-c]/i.test(msg.replace(/\s+/g, ''))) {
      expect(joined).toMatch(/Jadwal\s+Gelombang/i);
      expect(joined).toMatch(/Masa\s+pendaftaran/i);
      expect(joined).toMatch(/Testing/i);
    } else {
      expect(joined).toMatch(/Kalender\s+pendaftaran\s+PMB/i);
      expect(joined).toMatch(/Masa\s+pendaftaran\s+per\s+gelombang/i);
    }

    // Ensure we didn't call RAG when calendar fast-path is available.
    expect(rag.query).not.toHaveBeenCalled();
  });

  test.each([
    'ada jurusan apa aja?',
    'stikom ada jurusan apa?',
    'prodi nya apa aja min?',
    'apa saja prodi yang ada di stikom?'
  ])('program list question "%s" -> welcome + deterministic program list', async (msg) => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({ success: true, answer: `RAG_ANSWER: ${msg}`, source: 'rag', contexts: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: msg });

    expect(res.status).toBe(200);

    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts.length).toBeGreaterThanOrEqual(2);
    expect(sentTexts[0]).toBe('WELCOME_MENU');

    const joined = sentTexts.join('\n');
    expect(joined).toMatch(/Program studi/i);
    // Ensure bundled index-derived programs appear (avoid omitting MI and Pascasarjana).
    expect(joined).toMatch(/Manajemen\s+Informatika/i);
    expect(joined).toMatch(/Pascasarjana/i);
    expect(joined).not.toMatch(/tidak\s+terlihat|tidak\s+j?elas/i);
  });

  test('specific wave without intent triggers clarify-wave prompt', async () => {
    process.env.ENABLE_RAG = 'true';
    prisma.trainingData.count.mockResolvedValue(1);

    const rag = require('../src/engine/ragEngine');
    rag.query.mockResolvedValue({
      success: true,
      answer: 'Anda ingin informasi apa untuk gelombang 3 a?\n\n- Jadwal\n- Potongan\n- Biaya',
      source: 'rag-clarify-wave',
      contexts: []
    });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: 'user1', text: 'gelombang 3a' });

    expect(res.status).toBe(200);
    const sentTexts = provider.sendMessage.mock.calls.map((c) => String(c[1] || ''));
    expect(sentTexts[0]).toBe('WELCOME_MENU');
    expect(sentTexts.join('\n')).toMatch(/Anda ingin informasi apa/i);
  });
});
