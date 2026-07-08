const express = require('express');
const request = require('supertest');
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

describe('Production Runtime Test - Fee Queries', () => {
  let providerRouterFactory;
  let provider;
  let sessionStore;

  const queries = [
    { query: 'berapa biaya TI gelombang 2C', chatId: 'test_ti_2c' },
    { query: 'berapa biaya SI gelombang 2C', chatId: 'test_si_2c' },
    { query: 'berapa biaya MI gelombang 2C', chatId: 'test_mi_2c' },
    { query: 'berapa biaya DNUI gelombang 2C', chatId: 'test_dnui_2c' },
    { query: 'berapa biaya HELP gelombang 2C', chatId: 'test_help_2c' },
    { query: 'berapa biaya UTB gelombang 2C', chatId: 'test_utb_2c' }
  ];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    process.env.NODE_ENV = 'test';
    process.env.FORCE_BUNDLED_INDEX = 'true';
    delete process.env.BOT_INTRO_MESSAGE;
    delete process.env.BOT_NAME;
    delete process.env.BOT_DISPLAY_NAME;

    sessionStore = new Map();

    provider = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    providerRouterFactory = require('../src/routes/provider');
    const prisma = require('../src/db');

    // Make mocked Prisma session behave statefully
    prisma.session.findUnique.mockImplementation(async ({ where }) => {
      const { chatId } = where;
      return sessionStore.get(chatId) || null;
    });

    prisma.session.upsert.mockImplementation(async ({ where, create, update }) => {
      const { chatId } = where;
      const existing = sessionStore.get(chatId) || { chatId, state: 'start', data: {} };
      const merged = { ...existing, ...update, chatId };
      sessionStore.set(chatId, merged);
      return merged;
    });
  });

  test('Query 1: berapa biaya TI gelombang 2C', async () => {
    const { query, chatId } = queries[0];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 1: berapa biaya TI gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  test('Query 2: berapa biaya SI gelombang 2C', async () => {
    const { query, chatId } = queries[1];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 2: berapa biaya SI gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  test('Query 3: berapa biaya MI gelombang 2C', async () => {
    const { query, chatId } = queries[2];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 3: berapa biaya MI gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  test('Query 4: berapa biaya DNUI gelombang 2C', async () => {
    const { query, chatId } = queries[3];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 4: berapa biaya DNUI gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  test('Query 5: berapa biaya HELP gelombang 2C', async () => {
    const { query, chatId } = queries[4];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 5: berapa biaya HELP gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  test('Query 6: berapa biaya UTB gelombang 2C', async () => {
    const { query, chatId } = queries[5];

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: query });

    console.log('\n═════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 6: berapa biaya UTB gelombang 2C');
    console.log('═════════════════════════════════════════════════════════════════════════');
    console.log('\n→ RESPONSE BODY:');
    console.log(JSON.stringify(res.body, null, 2));
    
    if (res.body && res.body.route) {
      console.log('\n→ ROUTE:', res.body.route);
      console.log('→ SOURCE FILE:', res.body.sourceFile || 'N/A');
      
      if (res.body.feeStruct) {
        console.log('\n→ FEE STRUCTURE (JSON):');
        console.log(JSON.stringify(res.body.feeStruct, null, 2));
      }

      if (res.body.text) {
        console.log('\n→ FINAL WA MESSAGE:');
        console.log('─'.repeat(75));
        console.log(res.body.text);
        console.log('─'.repeat(75));
      }
    }

    expect(res.status).toBe(200);
  });

  afterAll(() => {
    console.log('\n' + '═'.repeat(75));
    console.log('END OF PRODUCTION RUNTIME TEST');
    console.log('═'.repeat(75));
  });
});
