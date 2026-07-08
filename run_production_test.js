#!/usr/bin/env node
/**
 * Production Runtime Test - Direct Supertest-based Testing
 */

const express = require('express');
const request = require('supertest');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';

// Setup mocks before requiring provider
jest.mock('./src/db', () => ({
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

jest.mock('./src/engine/chatLog', () => ({
  appendChatMessage: jest.fn().mockResolvedValue(undefined),
  getChatMessages: jest.fn().mockResolvedValue([])
}));

jest.mock('./src/engine/ragEngine', () => ({
  query: jest.fn().mockResolvedValue({ success: true, answer: null, source: 'rag-no-match', contexts: [] })
}));

jest.mock('./src/engine/webSearchFallback', () => ({
  webSearchFallbackAnswer: jest.fn().mockResolvedValue({ ok: false, reason: 'mock_default' })
}));

const providerRouterFactory = require('./src/routes/provider');

// Test queries
const queries = [
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya MI gelombang 2C',
  'berapa biaya DNUI gelombang 2C',
  'berapa biaya HELP gelombang 2C',
  'berapa biaya UTB gelombang 2C'
];

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('PRODUCTION RUNTIME TEST - WhatsApp Fee Queries');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// Simple in-memory session store
const sessionStore = new Map();

// Mock provider
const provider = {
  sendMessage: jest.fn().mockResolvedValue(undefined)
};

// Run tests
async function runTests() {
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    const chatId = `test_${i + 1}`;

    console.log(`\n${'═'.repeat(75)}`);
    console.log(`QUERY ${i + 1}: ${query}`);
    console.log('═'.repeat(75));

    const app = express();
    app.use(express.json());
    app.use('/provider', providerRouterFactory(provider));

    try {
      const res = await request(app)
        .post('/provider/webhook')
        .send({ chatId, text: query });

      console.log('\n→ STATUS:', res.status);
      console.log('→ BODY:', JSON.stringify(res.body, null, 2));

      if (res.body) {
        console.log('\n→ ROUTE:', res.body.route || 'N/A');
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
    } catch (error) {
      console.log('❌ ERROR:', error.message);
      console.log(error.stack);
    }
  }

  console.log('\n' + '═'.repeat(75));
  console.log('END OF PRODUCTION TEST');
  console.log('═'.repeat(75));
  process.exit(0);
}

runTests();
