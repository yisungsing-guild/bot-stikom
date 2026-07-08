const express = require('express');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn() }));

jest.mock('../src/db', () => ({
  chat: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn().mockResolvedValue({})
  },
  keywordReply: { findMany: jest.fn().mockResolvedValue([]) },
  setting: { findUnique: jest.fn().mockResolvedValue(null) },
  trainingData: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
  session: { findUnique: jest.fn(), upsert: jest.fn() },
  menuItem: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }
}));

jest.mock('../src/engine/chatLog', () => ({
  appendChatMessage: jest.fn().mockResolvedValue(undefined),
  getChatMessages: jest.fn().mockResolvedValue([])
}));

jest.mock('../src/engine/webSearchFallback', () => ({
  webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'uat_no_web' })
}));

// Keep provider orchestration deterministic while leaving ragEngine real.
jest.mock('../src/engine/composer', () => ({
  composeResponse: jest.fn(async (payload) => {
    const raw = payload?.ruleReply?.text
      || payload?.rag?.answer
      || (Array.isArray(payload?.retrievals) && (payload.retrievals[0]?.excerpt || payload.retrievals[0]?.text))
      || payload?.answer
      || 'MOCK COMPOSER EMPTY';
    return { finalText: String(raw).trim(), confidence: 0.99, strategy: ['pass-through'], meta: { reasoningContext: {} } };
  })
}));

const providerRouterFactory = require('../src/routes/provider');
const fonnteWebhookRouter = require('../src/routes/fonnteWebhook');
const prisma = require('../src/db');
const chatLog = require('../src/engine/chatLog');

jest.setTimeout(120000);

describe('Provider real UAT via Fonnte webhook (no ragEngine mock)', () => {
  let app;
  let provider;
  let sessionStore;
  let chatStore;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FORCE_BUNDLED_INDEX = 'true';
    process.env.FONNTE_WEBHOOK_REQUIRE_TOKEN = 'false';
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.PROVIDER_WEBHOOK_TOKEN;
    sessionStore = new Map();
    chatStore = new Map();
    provider = { sendMessage: jest.fn().mockResolvedValue(undefined), sendImage: jest.fn().mockResolvedValue(undefined) };

    prisma.chat.findUnique.mockImplementation(async ({ where }) => ({ chatId: String(where?.chatId || 'uat'), status: 'BOT', lastSeenAt: new Date().toISOString() }));
    prisma.chat.upsert.mockImplementation(async ({ where, create, update }) => ({ ...(create || {}), ...(update || {}), chatId: String(where?.chatId || create?.chatId || 'uat'), status: 'BOT' }));
    prisma.session.findUnique.mockImplementation(async ({ where }) => sessionStore.get(String(where?.chatId || '')) || null);
    prisma.session.upsert.mockImplementation(async ({ where, create, update }) => {
      const chatId = String(where?.chatId || create?.chatId || '');
      const existing = sessionStore.get(chatId) || { chatId, state: 'root', data: { welcomeSent: true, introSent: true } };
      const next = { ...existing };
      if (update && Object.prototype.hasOwnProperty.call(update, 'state')) next.state = update.state;
      if (update && Object.prototype.hasOwnProperty.call(update, 'data')) next.data = update.data;
      sessionStore.set(chatId, next);
      return next;
    });
    chatLog.appendChatMessage.mockImplementation(async (chatId, direction, message) => {
      const arr = chatStore.get(String(chatId)) || [];
      arr.push({ direction, message: String(message || '') });
      chatStore.set(String(chatId), arr);
    });
    chatLog.getChatMessages.mockImplementation(async (chatId) => chatStore.get(String(chatId)) || []);

    app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));
    app.use('/fonnte', fonnteWebhookRouter);

    axios.post.mockImplementation(async (_url, inbound) => {
      return request(app).post('/provider/webhook').send(inbound);
    });
  });

  async function sendFonnte(text, suffix = '') {
    const chatId = `6281000${Date.now()}${Math.floor(Math.random()*1000)}${suffix}`.replace(/\D/g, '');
    sessionStore.set(chatId, { chatId, state: 'root', data: { welcomeSent: true, introSent: true } });
    const before = provider.sendMessage.mock.calls.length;
    await request(app).post('/fonnte/webhook').send({ sender: chatId, message: text, id: `mid-${chatId}` }).expect(200);
    const started = Date.now();
    while (provider.sendMessage.mock.calls.length <= before && Date.now() - started < 8000) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const calls = provider.sendMessage.mock.calls.slice(before).filter(c => String(c[0]) === chatId);
    return calls.map(c => String(c[1] || '')).join('\n---\n');
  }

  test.each(['halo','hai','hi','hello','permisi','selamat pagi','selamat siang','selamat sore','selamat malam'])('Greeting alias %s returns the same greeting', async (text) => {
    const answer = await sendFonnte(text, 'greet');
    expect(answer).toContain('Halo Kak');
    expect(answer).toContain('ITB STIKOM Bali');
    expect(answer).not.toMatch(/belum menemukan detail|Ditemukan beberapa data berbeda/i);
  });

  test.each(['apa itu pmb','tentang pmb','informasi pmb'])('PMB info %s is not routed to fee', async (text) => {
    const answer = await sendFonnte(text, 'pmb');
    expect(answer).toMatch(/PMB|Penerimaan Mahasiswa Baru/i);
    expect(answer).toMatch(/Jalur Pendaftaran/i);
    expect(answer).toMatch(/Program Studi/i);
    expect(answer).toMatch(/Jadwal/i);
    expect(answer).not.toMatch(/^Baik Kak, berikut penjelasan mengenai biaya kuliah/i);
  });

  test.each(['cara daftar','jadwal pmb'])('PMB subtopic %s returns PMB guidance', async (text) => {
    const answer = await sendFonnte(text, 'pmbsub');
    expect(answer).toMatch(/daftar|jadwal|PMB|gelombang|pendaftaran/i);
    expect(answer).not.toMatch(/Ditemukan beberapa data berbeda/i);
  });

  test.each([
    ['apa itu TI', /Teknologi Informasi[\s\S]*Definisi[\s\S]*Kompetensi[\s\S]*Lama studi[\s\S]*Gelar[\s\S]*Prospek kerja[\s\S]*Bidang pekerjaan[\s\S]*Akreditasi/i],
    ['apa itu SI', /Sistem Informasi[\s\S]*Definisi[\s\S]*Kompetensi[\s\S]*Prospek kerja/i],
    ['apa itu SK', /Sistem Komputer[\s\S]*(embedded|IoT|perangkat keras)/i],
    ['apa itu BD', /Bisnis Digital[\s\S]*(digital marketing|e-commerce|bisnis digital)/i],
    ['apa itu MI', /Manajemen Informatika[\s\S]*(D3|diploma|aplikasi)/i]
  ])('Program profile %s is deterministic and complete', async (text, pattern) => {
    const answer = await sendFonnte(text, 'program');
    expect(answer).toMatch(pattern);
    expect(answer).not.toMatch(/Satuan Kredit Semester|Ditemukan beberapa data berbeda/i);
  });

  test.each(['biaya TI','biaya SI','biaya SK','biaya BD','biaya MI'])('Fee summary %s returns fee answer', async (text) => {
    const answer = await sendFonnte(text, 'fee');
    expect(answer).toMatch(/Program Studi|Biaya|DPP|Rp/i);
    expect(answer).not.toMatch(/Ditemukan beberapa data berbeda/i);
  });

  test('Rincian biaya all S1/D3 core combinations return normalized format', async () => {
    const programs = ['TI','SI','SK','BD','MI'];
    const waves = ['1A','1B','1C','2A','2B','2C','3A','3B','3C','4A','4B','4C'];
    const failures = [];
    for (const program of programs) {
      for (const wave of waves) {
        const answer = await sendFonnte(`rincian biaya ${program} gelombang ${wave}`, `detail${program}${wave}`);
        try {
          expect(answer).toMatch(/Program Studi\s*:/i);
          expect(answer).toMatch(/Gelombang\s*:/i);
          expect(answer).toMatch(/Tahun\s*:/i);
          expect(answer).toMatch(/Biaya Pendaftaran[\s\S]*Biaya Pendaftaran[\s\S]*Total Pendaftaran/i);
          expect(answer).toMatch(/DPP/i);
          expect(answer).toMatch(/Perlengkapan/i);
          expect(answer).toMatch(/Total Awal Masuk/i);
          expect(answer).not.toMatch(/Formulir|Total Pendaftaran:\s*Rp\s*0/i);
          expect(answer).not.toMatch(/Ditemukan beberapa data berbeda/i);
        } catch (e) {
          failures.push(`${program} ${wave}: ${String(e.message).split('\n')[0]}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('Context switching PMB -> TI -> biaya -> prospek -> SI -> biaya -> jadwal -> PMB', async () => {
    const chatId = `6281999${Date.now()}`;
    sessionStore.set(chatId, { chatId, state: 'root', data: { welcomeSent: true, introSent: true } });
    const turns = ['PMB','TI','biaya','prospek','SI','biaya','jadwal','PMB'];
    const outputs = [];
    for (const [i, text] of turns.entries()) {
      const before = provider.sendMessage.mock.calls.length;
      await request(app).post('/fonnte/webhook').send({ sender: chatId, message: text, id: `ctx-${i}-${chatId}` }).expect(200);
      const started = Date.now();
      while (provider.sendMessage.mock.calls.length <= before && Date.now() - started < 8000) await new Promise(r => setTimeout(r, 50));
      outputs.push(provider.sendMessage.mock.calls.slice(before).filter(c => String(c[0]) === chatId).map(c => String(c[1] || '')).join('\n'));
    }
    const joined = outputs.join('\n---\n');
    expect(joined).toMatch(/PMB|Penerimaan Mahasiswa Baru/i);
    expect(joined).toMatch(/Teknologi Informasi/i);
    expect(joined).toMatch(/Sistem Informasi/i);
    expect(joined).toMatch(/biaya|DPP|Rp/i);
    expect(joined).toMatch(/jadwal|gelombang/i);
    expect(joined).not.toMatch(/Ditemukan beberapa data berbeda/i);
  });

  test.each(['apa itu','bagaimana','jadwal','biaya','berapa biayanya'])('Ambiguous prompt %s does not expose resolver internals', async (text) => {
    const answer = await sendFonnte(text, 'amb');
    expect(answer).not.toMatch(/Ditemukan beberapa data berbeda|Satuan Kredit Semester/i);
    expect(answer.length).toBeGreaterThan(0);
  });
});
