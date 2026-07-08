const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: true });

const print = console.log.bind(console);
console.log = () => {};
console.warn = () => {};

process.env.NODE_ENV = 'test';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.SEMANTIC_RAG_ONLY = 'true';
process.env.BOT_INTRO_ENABLED = 'false';
process.env.BOT_REPLY_TIMEOUT_MS = '90000';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.ENABLE_RAG = 'true';

const express = require('express');
const request = require('supertest');

const prisma = require('../src/db');
const chatLog = require('../src/engine/chatLog');

const chats = new Map();
const sessions = new Map();
const messagesByChat = new Map();

function nowRecord(extra = {}) {
  const now = new Date();
  return {
    id: extra.id || `mock-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    ...extra
  };
}

prisma.chat = {
  findUnique: async ({ where }) => chats.get(where.phone) || null,
  upsert: async ({ where, create, update }) => {
    const existing = chats.get(where.phone);
    const record = existing ? { ...existing, ...update, updatedAt: new Date() } : nowRecord(create);
    chats.set(where.phone, record);
    return record;
  },
  update: async ({ where, data }) => {
    const existing = chats.get(where.phone) || nowRecord({ phone: where.phone });
    const record = { ...existing, ...data, updatedAt: new Date() };
    chats.set(where.phone, record);
    return record;
  }
};

prisma.session = {
  findUnique: async ({ where }) => sessions.get(where.chatId) || null,
  create: async ({ data }) => {
    const record = nowRecord(data);
    sessions.set(data.chatId, record);
    return record;
  },
  upsert: async ({ where, create, update }) => {
    const existing = sessions.get(where.chatId);
    const record = existing ? { ...existing, ...update, updatedAt: new Date() } : nowRecord(create);
    sessions.set(where.chatId, record);
    return record;
  },
  update: async ({ where, data }) => {
    const existing = sessions.get(where.chatId) || nowRecord({ chatId: where.chatId });
    const record = { ...existing, ...data, updatedAt: new Date() };
    sessions.set(where.chatId, record);
    return record;
  },
  deleteMany: async () => ({ count: 0 })
};

prisma.trainingData = {
  count: async () => 1
};

prisma.keywordReply = {
  findMany: async () => []
};

prisma.menuItem = {
  findFirst: async () => null,
  findMany: async () => []
};

prisma.setting = {
  findUnique: async ({ where }) => {
    if (where.key === 'welcome_message') return null;
    if (where.key === 'bot_inactive') return null;
    if (where.key === 'fallback_message') {
      return {
        key: 'fallback_message',
        value: 'Maaf, data yang Anda minta tidak tersedia pada sumber yang kami miliki.'
      };
    }
    return null;
  }
};

chatLog.appendChatMessage = async () => null;
chatLog.getChatMessages = async () => [];

const providerRouterFactory = require('../src/routes/provider');

const provider = {
  sendMessage: async (chatId, message, meta = {}) => {
    if (messagesByChat.has(chatId)) {
      messagesByChat.get(chatId).push(String(message));
    }
    return { ok: true };
  },
  sendImage: async () => ({ ok: true })
};

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/provider', providerRouterFactory(provider));

const defaultQuestions = [
  'apa itu si',
  'apa itu ti',
  'apa itu sk',
  'apa itu bd',
  'apa itu mi',
  'apakah ada beasiswa?',
  'rincian biaya si gelombang 2B?',
  'rincian biaya ti gelombang 1A?',
  'rincian biaya sk gelombang 3B?',
  'rincian biaya bd gelombang 4A?',
  'apakah ada program double degree di stikom?',
  'apakah ada program double degree internasional?',
  'apakah ada program double degree nasional?',
  'prospek kerja si?',
  'prospek kerja sk?',
  'prospek kerja ti?',
  'prospek kerja mi?',
  'prospek kerja bd?',
  'biaya termurah dari semua prodi apa?',
  'biaya s1 termurah apa?',
  's1 bisnis digital apakah lebih murah dari prodi yang lain?'
];

const questions = process.env.PROBE_QUESTIONS_JSON
  ? JSON.parse(process.env.PROBE_QUESTIONS_JSON)
  : defaultQuestions;

function webhookPayload(phone, text) {
  return {
    chatId: phone,
    device: 'probe-device',
    sender: phone,
    from: phone,
    name: 'Probe User',
    text,
    message: text,
    body: text,
    isGroup: false
  };
}

(async () => {
  const results = [];
  for (let i = 0; i < questions.length; i += 1) {
    const id = `q${i + 1}`;
    const phone = `628500000${String(i + 1).padStart(3, '0')}`;
    messagesByChat.set(phone, []);

    const response = await request(app)
      .post('/provider/webhook')
      .send(webhookPayload(phone, questions[i]))
      .set('Content-Type', 'application/json');

    results.push({
      no: i + 1,
      question: questions[i],
      status: response.status,
      messages: messagesByChat.get(phone)
    });
  }

  const outPath = path.resolve(__dirname, 'semantic_provider_21_results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  for (const item of results) {
    const answer = item.messages[item.messages.length - 1] || '(tidak ada pesan terkirim)';
    print(`\n${item.no}. ${item.question}\n${answer}`);
  }
})();
