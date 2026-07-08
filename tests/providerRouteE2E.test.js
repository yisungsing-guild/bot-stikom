const express = require('express');
const request = require('supertest');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.RAG_MIN_SCORE = '0.0';
process.env.BOT_REPLY_TIMEOUT_MS = '20000';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_AUDIT_LOGGING = 'false';
process.env.PROVIDER_WEBHOOK_TOKEN = '';

const mockSessionStore = new Map();
const mockChatStore = new Map();
const mockChatLogStore = new Map();
const mockSentMessages = new Map();

jest.mock('../src/db', () => {
  const mockSessionStoreLocal = mockSessionStore;
  const mockChatStoreLocal = mockChatStore;

  return {
    chat: {
      findUnique: jest.fn(async ({ where }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        return chatId ? (mockChatStoreLocal.get(chatId) || null) : null;
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        if (!chatId) return null;
        const existing = mockChatStoreLocal.get(chatId) || null;
        const next = existing ? { ...existing } : (create ? { ...create } : { chatId, lastSeenAt: new Date().toISOString() });
        if (update) {
          if (Object.prototype.hasOwnProperty.call(update, 'lastSeenAt')) next.lastSeenAt = update.lastSeenAt;
          if (Object.prototype.hasOwnProperty.call(update, 'status')) next.status = update.status;
        }
        if (!next.chatId) next.chatId = chatId;
        mockChatStoreLocal.set(chatId, next);
        return next;
      }),
      update: jest.fn(async ({ where, data }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        const existing = mockChatStoreLocal.get(chatId) || { chatId, lastSeenAt: new Date().toISOString() };
        const next = { ...existing, ...(data || {}) };
        mockChatStoreLocal.set(chatId, next);
        return next;
      })
    },
    session: {
      findUnique: jest.fn(async ({ where }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        return chatId ? (mockSessionStoreLocal.get(chatId) || null) : null;
      }),
      upsert: jest.fn(async ({ where, create, update }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        if (!chatId) return null;
        const existing = mockSessionStoreLocal.get(chatId) || null;
        const base = existing || (create ? { ...create } : { chatId, state: 'root', data: {} });
        const next = { ...base };
        if (update) {
          if (Object.prototype.hasOwnProperty.call(update, 'state')) next.state = update.state;
          if (Object.prototype.hasOwnProperty.call(update, 'data')) next.data = update.data;
        }
        if (!next.chatId) next.chatId = chatId;
        mockSessionStoreLocal.set(chatId, next);
        return next;
      }),
      update: jest.fn(async ({ where, data }) => {
        const chatId = where && where.chatId ? String(where.chatId) : '';
        const existing = mockSessionStoreLocal.get(chatId) || { chatId, state: 'root', data: {} };
        const next = { ...existing, ...(data || {}) };
        mockSessionStoreLocal.set(chatId, next);
        return next;
      }),
      create: jest.fn(async ({ data }) => {
        const chatId = data && data.chatId ? String(data.chatId) : '';
        const next = { ...data };
        mockSessionStore.set(chatId, next);
        return next;
      })
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
    menuItem: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    }
  };
});

jest.mock('../src/engine/chatLog', () => ({
  appendChatMessage: jest.fn(async (chatId, direction, message) => {
    const id = String(chatId || '');
    if (!id) return;
    const arr = mockChatLogStore.get(id) || [];
    arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
    mockChatLogStore.set(id, arr);
  }),
  getChatMessages: jest.fn(async (chatId) => {
    const id = String(chatId || '');
    return id ? (mockChatLogStore.get(id) || []) : [];
  })
}));

jest.mock('../src/engine/webSearchFallback', () => ({
  webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock' })
}));

jest.mock('../src/engine/replyEngine', () => ({
  findReplyByRules: jest.fn().mockResolvedValue(null)
}));

jest.mock('../src/engine/fsm', () => ({
  handleFSM: jest.fn().mockResolvedValue(null),
  upsertSession: jest.fn().mockResolvedValue(null)
}));

let providerRouterFactory;
let prisma;
let provider;
let app;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockSessionStore.clear();
  mockChatStore.clear();
  mockChatLogStore.clear();
  mockSentMessages.clear();

  provider = {
    sendMessage: jest.fn(async (chatId, text) => {
      const id = String(chatId || '');
      if (!id) return;
      const arr = mockSentMessages.get(id) || [];
      arr.push(String(text || ''));
      mockSentMessages.set(id, arr);
    }),
    sendImage: jest.fn(async (chatId, url, caption) => {
      const id = String(chatId || '');
      if (!id) return;
      const arr = mockSentMessages.get(id) || [];
      arr.push(`[IMAGE] ${String(caption || '')} -> ${String(url || '')}`);
      mockSentMessages.set(id, arr);
    })
  };

  providerRouterFactory = require('../src/routes/provider');
  prisma = require('../src/db');

  app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
});

describe('Provider route E2E simulation', () => {
  test('should execute provider webhook path for representative queries', async () => {
    const queries = [
      { chatId: 'e2e-01', text: 'Apa itu Teknologi Informasi?' },
      { chatId: 'e2e-02', text: 'Apa itu Sistem Informasi?' },
      { chatId: 'e2e-03', text: 'Prospek kerja Teknologi Informasi' },
      { chatId: 'e2e-04', text: 'Prospek kerja Sistem Informasi' },
      { chatId: 'e2e-05', text: 'Apa perbedaan TI dan SI?' },
      { chatId: 'e2e-01', text: 'Bagaimana prospek kerjanya?' }
    ];

    const results = [];

    for (const item of queries) {
      const response = await request(app)
        .post('/provider/webhook')
        .send({ chatId: item.chatId, text: item.text, ts: Date.now() });

      const messages = mockSentMessages.get(item.chatId) || [];
      const lastMessage = messages.length ? messages[messages.length - 1] : null;
      results.push({
        chatId: item.chatId,
        query: item.text,
        status: response.status,
        responseBody: response.body,
        sentMessages: messages,
        lastMessage
      });
      console.log('---');
      console.log('query:', item.text);
      console.log('status:', response.status);
      console.log('sent:', messages.slice(-2).join(' | '));
      console.log('body:', JSON.stringify(response.body));
    }

    fs.writeFileSync('tmp/e2e_provider_route_results.json', JSON.stringify(results, null, 2), 'utf8');

    const allOk = results.every((item) => item.status === 200);
    expect(allOk).toBe(true);
    expect(results.some((item) => item.lastMessage && item.lastMessage.length > 0)).toBe(true);
  }, 30000);
});
