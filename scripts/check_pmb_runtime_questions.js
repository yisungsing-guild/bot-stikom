/*
  Production-safe PMB runtime smoke test.

  This simulates /provider/webhook using only production dependencies.
  It does not require supertest and does not send real WhatsApp messages.

  Usage:
    node scripts/check_pmb_runtime_questions.js
*/

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

function injectMock(resolvablePath, exportsObj) {
  const resolved = require.resolve(resolvablePath);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj
  };
}

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ENABLE_RAG = process.env.ENABLE_RAG || 'true';
process.env.DISABLE_KEYWORD_RULES = process.env.DISABLE_KEYWORD_RULES || 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS || 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = process.env.SEMANTIC_RAG_RESULT_CACHE_MS || '0';
process.env.OPENAI_API_KEY = '';

const sessionStore = new Map();
const chatStore = new Map();

const prismaMock = {
  chat: {
    findUnique: async () => null,
    upsert: async ({ where }) => ({ chatId: where && where.chatId ? String(where.chatId) : 'unknown', status: 'BOT' }),
    update: async () => ({})
  },
  keywordReply: { findMany: async () => [] },
  setting: { findUnique: async () => null },
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
  menuItem: { findFirst: async () => null, findMany: async () => [] },
  ragEvalItem: { upsert: async () => ({}) }
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

injectMock(path.join(__dirname, '..', 'src', 'db'), prismaMock);
injectMock(path.join(__dirname, '..', 'src', 'engine', 'chatLog'), chatLogMock);
injectMock(path.join(__dirname, '..', 'src', 'engine', 'webSearchFallback'), {
  webSearchFallbackAnswer: async () => ({ ok: false, reason: 'disabled_in_runtime_check' })
});

const providerRouterFactory = require(path.join(__dirname, '..', 'src', 'routes', 'provider'));

const defaultQuestions = [
  'hallo',
  'selamat siang',
  'apa saja prodi yg ada di stikom?',
  'apa saja syarat untuk mendaftar di program studi d3 manajemen informatika?',
  'Tentang jurusan apa saja yang ada di STIKOM Bali',
  'Menanyakan tentang seperti apa itu program Dual Degree',
  'Apa perbedaan mendasar dari program studi Sistem Informasi dengan Sistem Komputer?',
  'Jurusan apa yang cocok buat anak saya jika anak saya suka sosial media dan sering live di tiktok',
  'Berikan detail tentang masing-masing prodi',
  'apakah tersedia beasiswa ?',
  'Pertanyaan terkait beasiswa SKSS',
  'Bagaimana cara mengurus Izin Belajar dan Visa Study?',
  'Apakah tersedia organisasi mahasiswa yang bisa mendukung minat mahasiswa di luar dari pembelajaran formal?',
  'Apakah akreditasi dari kampus ITB STIKOM Bali',
  'kalau biaya untuk double degree apakah ada potongan biaya',
  'Program Dual Degree DNUI apa harus ke China?',
  'di STIKOM Bali ada program internasional apa saja',
  'Berapa rincian biayanya ?',
  'dikampus ada program apa aja, dan akreditasinya gimana?',
  'belajar di jurusannya gimana kak? apa aja yang dipelajarin?',
  'jurusan di stikom ada apa aj kak? yang dipelajarin apa saja?',
  'program beasiswanya gimana kak?',
  'Aku pengen tau informasi tentang kuliah tapi jalur RPL',
  'Saya berasal dari SMK bidang komputer, prodi apa yang paling cocok untuk saya?',
  'Ada berapa jumlah kampus ITB STIKOM Bali?',
  'Berapa total SKS yang harus saya tempuh untuk bisa lulus di Program Studi S1-Bisnis Digital?',
  'perlu koreksi terhadap informasi awal, supaya kesan nya singkat dan informatif'
];

function makeRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/provider/webhook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
        } catch (_) {
          resolve({ status: res.statusCode, body: { raw: text } });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const sameChat = args.includes('--same-chat');
  const questions = args.filter((arg) => arg !== '--same-chat').length ? args.filter((arg) => arg !== '--same-chat') : defaultQuestions;
  const sent = [];
  const provider = {
    sendMessage: async (chatId, text) => {
      sent.push({ chatId: String(chatId || ''), text: String(text || '') });
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  const outLines = [];
  try {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const chatId = sameChat ? 'runtime-check-same-chat' : `runtime-check-${String(i + 1).padStart(2, '0')}`;
      const before = sent.length;
      const res = await makeRequest(port, { chatId, text: q });
      const messages = sent.slice(before).filter((m) => m.chatId === chatId).map((m) => m.text);
      const source = res.body && res.body.source ? String(res.body.source) : '(unknown)';
      const ragUsed = res.body && typeof res.body.ragUsed === 'boolean' ? ` | ragUsed: ${res.body.ragUsed}` : '';
      outLines.push(`\n=== Q${i + 1}: ${q} ===`);
      outLines.push(`status: ${res.status} | source: ${source}${ragUsed}`);
      if (!messages.length) outLines.push('(no outbound messages)');
      for (let j = 0; j < messages.length; j++) {
        outLines.push(`\n--- bot message ${j + 1} ---\n${messages[j]}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const outText = outLines.join('\n');
  const outPath = path.join(__dirname, '..', 'tmp', 'check_pmb_runtime_questions_output.txt');
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, outText, 'utf8');
  } catch (_) {}
  console.log(outText);
  console.log(`\n[written] ${outPath}`);
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});