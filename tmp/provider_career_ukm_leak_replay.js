const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

process.env.ENABLE_RAG = 'true';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.WHATSAPP_STRIP_MARKDOWN = process.env.WHATSAPP_STRIP_MARKDOWN || 'false';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
process.env.SEMANTIC_RAG_TODAY_YMD = '2026-07-26';
process.env.BOT_NATURAL_ANSWER_FRAME = 'true';

const questions = [
  'Hallo',
  'Saya ingin tahu berapa ya biaya kuliah untuk Double Degree Help University',
  'Boleh saya tahu apa saja yang disediakan layanannya di Career Center',
  'Katanya ada program pengembangan career bekerja sama dengan LinkedIn, itu seperti apa ya programnya?',
  'Oh belum punya informasinya ya. Kalau dalam pengembangan softskill, apa saja yang dilakukan oleh Career Center?',
  'Kalau terkait softskill mahasiswa, apa saja yang dilakukan pengembangannya oleh Career Center?',
  'Kok sama terus jawabannya, kalau sama terus seperti ini, dijawab saja tidak mempunyai informasi lengkap tentang apa yang ditanyakan ya',
  'Oke baik, kalau program GCCP itu apa ya?',
  'Kalau program BCCP itu apa ya?',
  'Baik BCCP tidak ada informasinya, apakah karena itu hanya untuk orang asing?',
  'Baik, kalau mahasiswa ingin meningkatkan kemampuan bahasanya, apakah stikom mempunyai fasilitas untuk itu ya?',
  'Wuhi ini apa ya? ini template PKS ya?',
  'Ini aneh jawabannya, saya menanyakan tentang fasilitas belajar bahasa',
  'Apa itu UKM KSL?',
  'Kegiatan UKM KSL apa saja?',
  'Program kerja UKM KSL apa?',
  'Siapa pembina UKM KSL?',
  'Apa UKM yang bergerak di Linux?',
  'Apa saja kegiatannya?',
  'Tampilkan isi Pasal 13 ADDENDUM dari dokumen PKS',
  'Nama Mitra dan alamat PIHAK KEDUA itu apa?'
];

function jestMockSendMessage() {
  const calls = [];
  const fn = async (chatId, message, options) => {
    calls.push([chatId, message, options]);
    return undefined;
  };
  fn.mock = { calls };
  fn.mockClear = () => { calls.length = 0; };
  return fn;
}

(async () => {
  const sessionStore = new Map();
  const chatStore = new Map();
  const prisma = require('../src/db');
  prisma.chat = { findUnique: async () => null, upsert: async ({ where }) => ({ chatId: where.chatId, status: 'BOT' }) };
  prisma.keywordReply = { findMany: async () => [] };
  prisma.setting = { findUnique: async () => null };
  prisma.trainingData = { count: async () => 0, findFirst: async () => null, findMany: async () => [] };
  prisma.menuItem = { findFirst: async () => null, findMany: async () => [] };
  prisma.session = {
    findUnique: async ({ where }) => sessionStore.get(String(where.chatId)) || null,
    upsert: async ({ where, create, update }) => {
      const chatId = String(where.chatId);
      const existing = sessionStore.get(chatId) || { ...(create || { chatId, state: 'root', data: {} }) };
      const next = { ...existing, ...(update || {}) };
      if (!next.chatId) next.chatId = chatId;
      sessionStore.set(chatId, next);
      return next;
    }
  };
  const chatLog = require('../src/engine/chatLog');
  chatLog.appendChatMessage = async (chatId, direction, message) => {
    const key = String(chatId);
    const entry = { direction, message: String(message || '') };
    const arr = chatStore.get(key) || [];
    arr.push(entry);
    chatStore.set(key, arr);
    const existing = sessionStore.get(key) || { chatId: key, state: 'root', data: {} };
    const data = existing.data && typeof existing.data === 'object' ? existing.data : {};
    const messages = Array.isArray(data.messages) ? data.messages.slice(-20) : [];
    messages.push(entry);
    sessionStore.set(key, { ...existing, data: { ...data, messages } });
  };
  chatLog.getChatMessages = async (chatId) => chatStore.get(chatId) || [];

  const provider = { sendMessage: jestMockSendMessage(), sendImage: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/provider', require('../src/routes/provider')(provider));

  const results = [];
  const leakRe = /PIHAK|Pasal|ADDENDUM|Nama Mitra|Perjanjian Kerja Sama|Jalan Raya Puputan|E\s*-\s*mail:::|FAQ PROGRAM/i;
  const chatId = 'career-ukm-leak-session';
  for (const q of questions) {
    provider.sendMessage.mockClear();
    let status = null;
    let body = null;
    let err = null;
    try {
      const res = await request(app).post('/provider/webhook').send({ chatId, text: q });
      status = res.status;
      body = res.body;
    } catch (e) {
      err = e && e.stack ? e.stack : String(e);
    }
    const sent = provider.sendMessage.mock.calls.map(c => String(c[1] || '')).filter(Boolean);
    const bot = sent.join('\n---\n') || '[NO MESSAGE SENT]';
    results.push({ user: q, bot, status, source: body && body.source, leak: leakRe.test(bot), err });
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(path.join('tmp', 'provider_career_ukm_leak_replay_user_bot.json'), JSON.stringify(results, null, 2), 'utf8');
  const out = results.map(r => `user:\n${r.user}\n\nbot:\n${r.bot}\n`).join('\n---\n');
  fs.writeFileSync(path.join('tmp', 'provider_career_ukm_leak_replay_user_bot.txt'), out, 'utf8');
  console.log('COUNT=' + results.length);
  console.log('LEAKS=' + results.filter(r => r.leak).length);
  console.log('NO_MESSAGE=' + results.filter(r => r.bot === '[NO MESSAGE SENT]').length);
  console.log(out);
})().catch(e => { console.error(e); process.exit(1); });

