/*
  Check PMB question coverage by simulating /provider/webhook locally.

  - Does NOT hit real DB (mocks prisma).
  - Does NOT hit OpenAI (clears OPENAI_API_KEY).
  - Does NOT do web-search fallback (mocked to disabled).

  Usage:
    node scripts/check_pmb_questions.js
*/

const express = require('express');
const request = require('supertest');
const path = require('path');

function injectMock(resolvablePath, exportsObj) {
  const resolved = require.resolve(resolvablePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj
  };
}

// Ensure we don't call external services.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ENABLE_RAG = process.env.ENABLE_RAG || 'true';
process.env.DISABLE_KEYWORD_RULES = process.env.DISABLE_KEYWORD_RULES || 'true';
process.env.OPENAI_API_KEY = '';

// Simple stateful stores so multi-request follow-ups behave like production.
const sessionStore = new Map(); // chatId -> { chatId, state, data }
const chatStore = new Map(); // chatId -> [{ direction, message, at }]

const prismaMock = {
  chat: {
    findUnique: async () => null,
    upsert: async ({ where }) => ({ chatId: where && where.chatId ? String(where.chatId) : 'unknown', status: 'BOT' }),
    update: async () => ({})
  },
  keywordReply: {
    findMany: async () => []
  },
  setting: {
    findUnique: async () => null
  },
  trainingData: {
    count: async () => 0,
    findFirst: async () => null,
    findMany: async () => []
  },
  session: {
    findUnique: async ({ where }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      return chatId ? (sessionStore.get(chatId) || null) : null;
    },
    upsert: async ({ where, create, update }) => {
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
    },
    update: async ({ where, data }) => {
      const chatId = where && where.chatId ? String(where.chatId) : '';
      const existing = chatId ? (sessionStore.get(chatId) || { chatId, state: 'root', data: {} }) : null;
      if (!existing) return {};
      const next = { ...existing, ...(data || {}) };
      sessionStore.set(chatId, next);
      return next;
    }
  },
  menuItem: {
    findFirst: async () => null,
    findMany: async () => []
  },
  ragEvalItem: {
    upsert: async () => ({})
  }
};

const chatLogMock = {
  appendChatMessage: async (chatId, direction, message) => {
    const id = String(chatId || '');
    if (!id) return;
    const arr = chatStore.get(id) || [];
    arr.push({ direction, message: String(message || ''), at: new Date().toISOString() });
    chatStore.set(id, arr);
  },
  getChatMessages: async (chatId) => {
    const id = String(chatId || '');
    return id ? (chatStore.get(id) || []) : [];
  }
};

const webSearchFallbackMock = {
  webSearchFallbackAnswer: async () => ({ ok: false, reason: 'disabled_in_check_script' })
};

// Inject mocks before loading the provider router.
injectMock(path.join(__dirname, '..', 'src', 'db'), prismaMock);
injectMock(path.join(__dirname, '..', 'src', 'engine', 'chatLog'), chatLogMock);
injectMock(path.join(__dirname, '..', 'src', 'engine', 'webSearchFallback'), webSearchFallbackMock);

const providerRouterFactory = require(path.join(__dirname, '..', 'src', 'routes', 'provider'));

const questions = [
  'Tentang jurusan apa saja yang ada di STIKOM Bali',
  'Menanyakan tentang seperti apa itu program Dual Degree',
  'Apa perbedaan mendasar dari program studi Sistem Informasi dengan Sistem Komputer?',
  'Jurusan apa yang cocok buat anak saya jika anak saya suka sosial media dan sering live di tiktok',
  'Berikan detail tentang masing-masing prodi',
  'apakah tersedia beasiswa ?',
  'Bagaimana cara mengurus Izin Belajar dan Visa Study?',
  'Apakah tersedia organisasi mahasiswa yang bisa mendukung minat mahasiswa di luar dari pembelajaran formal?',
  'Apakah akreditasi dari kampus ITB STIKOM Bali',
  'kalau biaya untuk double degree apakah ada potongan biaya',
  'perlu koreksi terhadap informasi awal, supaya kesan nya singkat dan informatif',
  'Saya Prodi Sistem Informasi, kapan saya mulai kuliah sepester genap tahun akademik 2025/2026?',
  'Apakah ITB STIKOM Bali sudah terakreditasi oleh BAN-PT? Apa peringkat akreditasinya?',
  'Aku pengen tau informasi tentang kuliah tapi jalur RPL'
];

async function main() {
  const app = express();
  app.use(express.json());

  const outLines = [];

  let currentMessages = [];
  const provider = {
    sendMessage: async (_chatId, text) => {
      currentMessages.push(String(text || ''));
    }
  };

  app.use('/provider', providerRouterFactory(provider));

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const chatId = `check-${String(i + 1).padStart(2, '0')}`;

    currentMessages = [];
    const res = await request(app)
      .post('/provider/webhook')
      .send({ chatId, text: q });

    const source = res && res.body && res.body.source ? String(res.body.source) : '(unknown)';
    const ragUsed = res && res.body && typeof res.body.ragUsed === 'boolean' ? res.body.ragUsed : null;

    outLines.push(`\n=== Q${i + 1}: ${q} ===`);
    outLines.push(`source: ${source}${ragUsed === null ? '' : ` | ragUsed: ${ragUsed}`}`);
    if (!currentMessages.length) {
      outLines.push('(no outbound messages)');
      continue;
    }

    for (let j = 0; j < currentMessages.length; j++) {
      const msg = currentMessages[j];
      outLines.push(`\n--- bot message ${j + 1} ---\n${msg}`);
    }
  }

  const outText = outLines.join('\n');
  const outPath = path.join(__dirname, '..', 'tmp', 'check_pmb_questions_output.txt');
  try {
    require('fs').mkdirSync(path.dirname(outPath), { recursive: true });
    require('fs').writeFileSync(outPath, outText, 'utf-8');
  } catch (e) {
    // Non-fatal; still print to stdout.
  }

  console.log(outText);
  console.log(`\n[written] ${outPath}`);
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
