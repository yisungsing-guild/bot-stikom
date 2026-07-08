const express = require('express');
const request = require('supertest');
const prisma = require('../src/db');
const chatLog = require('../src/engine/chatLog');

process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.RAG_MIN_SCORE = '0.0';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.BOT_FAIL_HANDOVER_THRESHOLD = '3';

const sessionStore = new Map();
const chatStore = new Map();
const results = [];

prisma.chat = { findUnique: async () => null, upsert: async () => ({ chatId: 'u1', status: 'BOT' }), update: async () => ({}) };
prisma.keywordReply = { findMany: async () => [] };
prisma.setting = { findUnique: async () => null };
prisma.trainingData = { count: async () => 1, findFirst: async () => null };
prisma.menuItem = { findFirst: async () => null, findMany: async () => [] };
prisma.session = {
  findUnique: async ({ where }) => {
    const chatId = where && where.chatId ? String(where.chatId) : '';
    return chatId ? (sessionStore.get(chatId) || null) : null;
  },
  upsert: async ({ where, create, update }) => {
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
const app = express();
app.use(express.json());
app.use('/provider', providerRouterFactory({
  sendMessage: async (chatId, text) => { results[results.length - 1].sent.push({ chatId, text }); },
  sendImage: async () => {}
}));

const queries = [
  'prodi apa saja yang ada di stikom bali?',
  'berapa biaya pendaftaran prodi si gelombang 1A?',
  'berapa biaya dpp si gelombang 1A?',
  'berapa total biaya kuliah si gelombang 1A?',
  'jadwal pendaftaran si gelombang 1A',
  'apa syarat masuk prodi si?',
  'apakah ada beasiswa untuk si?',
  'berapa biaya pendaftaran prodi bisnis digital gelombang 2?',
  'lokasi kampus stikom bali?',
  'berapa biaya kuliah per semester di teknologi informasi?'
];

(async () => {
  for (let idx = 0; idx < queries.length; idx += 1) {
    const query = queries[idx];
    sessionStore.clear();
    chatStore.clear();
    results.push({ query, status: null, body: null, sent: [], logs: [] });

    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId: `verify-user-${idx + 1}`, text: query });

    results[idx].status = res.status;
    results[idx].body = res.body;
  }

  const fs = require('fs');
  fs.writeFileSync('tmp/verify_provider_queries_result.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote tmp/verify_provider_queries_result.json');
  console.log('Summary:');
  results.forEach((item, index) => {
    console.log(`${index + 1}. ${item.query} -> status ${item.status}, sent ${item.sent.length}`);
  });
})();
