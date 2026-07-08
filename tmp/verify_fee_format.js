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
const sent = [];

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
  sendMessage: async (chatId, text) => { sent.push({ chatId, text }); },
  sendImage: async () => {}
}));

(async () => {
  const q = process.argv[2] || 'berapa biaya pendaftaran prodi si gelombang 1A?';
  const res = await request(app).post('/provider/webhook').send({ chatId: 'verify-user', text: q });
  const output = {
    status: res.status,
    body: res.body,
    sent: sent.map((m) => ({ chatId: m.chatId, text: m.text }))
  };
  const fs = require('fs');
  fs.writeFileSync('tmp/verify_fee_format_result.json', JSON.stringify(output, null, 2), 'utf8');
  console.log('Wrote tmp/verify_fee_format_result.json');
})();
