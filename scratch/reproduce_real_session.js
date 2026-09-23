const express = require('express');
const request = require('supertest');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'false';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.SEMANTIC_RAG_ONLY = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.SEMANTIC_RAG_FAKE_CLIENT_FOR_REGRESSION = 'true';
process.env.OPENAI_SEMANTIC_RAG_TIMEOUT_MS = '100';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.RAG_MIN_SCORE = '0.0';
process.env.BOT_REPLY_TIMEOUT_MS = '5000';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_AUDIT_LOGGING = 'false';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';

const providerRouterFactory = require('../src/routes/provider');
const prisma = require('../src/db');
const { buildCanonicalQueryUnderstanding } = require('../src/engine/queryUnderstanding');
const { resolveContextAuthority } = require('../src/engine/contextAuthority');

function buildApp() {
  const sent = [];
  const provider = {
    sendMessage: async (chatId, text, meta) => {
      sent.push({ chatId, text: String(text || ''), meta: meta || {} });
    },
    sendImage: async () => {}
  };
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
  return { app, provider, sent };
}

async function ask(ctx, chatId, text) {
  const before = ctx.sent.length;
  const res = await request(ctx.app)
    .post('/provider/webhook')
    .send({ chatId, text, ts: Date.now() });
  const newMessages = ctx.sent.slice(before).map((m) => m.text).join('\n');
  const lastMeta = ctx.sent.length > before ? ctx.sent[ctx.sent.length - 1].meta : {};
  return { res, text: newMessages, meta: lastMeta };
}

const turns = [
  // PMB
  'Penerimaan Mahasiswa Baru sekarang sudah masuk gelombang ke berapa?',
  'Sampai saat ini berapa jumlah mahasiswa baru di STIKOM Bali?',
  'Mahasiswa yang sekarang ini kuliah di stikom bali ada berapa ya?',
  // LinkedIn Learning
  'Iya boleh saya dapat info tentang program LinkedIn Learning Stikom Bali ya?',
  'Yang saya maksud LinkedIn Learning di Career Centernya Stikom Bali',
  // Double Degree
  'Kalau program kerja double degree dengan Essex University UK apakah ada informasi ya?',
  'Kalau Double Degree dengan UTB itu seperti apa ya?',
  'Memang kalau Double Degree DNUI dan HELP seperti apa ya?',
  'Gelar yang didapatkan dari DNUI dan HELP itu Sarjana apa?',
  'Kalau untuk biaya, double degree itu biayanya berapa ya?',
  'Yang DNUI',
  'Biayanya berapa?',
  'Kalau untuk Help berapa?',
  'Biayanya berapa?',
  'Saya menanyakan yang Double Degree Help',
  'Biayanya berapa?',
  // Career Outcomes
  'Kalau saya mengambil jurusan Bisnis Digital, itu nanti perkiraannya saya bisa bekerja menjadi apa?',
  'Jurusan Sistem Informasi kenapa menjadi alternatif?',
  'Kalau jurusan sistem informasi, nanti tamatnya bisa bekerja menjadi apa ya?',
  'Kalau jurusan Teknologi Informasi?',
  'Maksud saya tamatnya menjadi apa?',
  'Kalau jurusan Teknologi Informasi, nanti setelah tamat bisa bekerja sebagai apa?'
];

async function run() {
  const chatId = 'continuous-test-session-' + Date.now();
  const ctx = buildApp();
  console.log('=== STARTING CONTINUOUS SESSION TEST WITH CHAT ID:', chatId, '===\n');

  const traceOutput = [];

  for (let i = 0; i < turns.length; i++) {
    const q = turns[i];
    
    // Inspect session BEFORE turn
    const sessionBefore = await prisma.session.findUnique({ where: { chatId } });
    const sessionDataBefore = (sessionBefore && sessionBefore.data) || {};

    const { res, text, meta } = await ask(ctx, chatId, q);

    // Inspect session AFTER turn
    const sessionAfter = await prisma.session.findUnique({ where: { chatId } });
    const sessionDataAfter = (sessionAfter && sessionAfter.data) || {};

    const traceItem = {
      turn: i + 1,
      RAW_QUERY: q,
      SOURCE: meta.source || meta.sourceType || 'unknown',
      ACTIVE_PROGRAM_BEFORE: sessionDataBefore.lastProgramHint || null,
      ACTIVE_PROGRAM_AFTER: sessionDataAfter.lastProgramHint || null,
      CONVERSATION_STATE_BEFORE: sessionDataBefore.conversationState || null,
      CONVERSATION_STATE_AFTER: sessionDataAfter.conversationState || null,
      LAST_CONTRACT_BEFORE: sessionDataBefore.lastSemanticContract || null,
      LAST_CONTRACT_AFTER: sessionDataAfter.lastSemanticContract || null,
      META: meta,
      FINAL_ANSWER: text
    };

    traceOutput.push(traceItem);

    console.log(`================================================================`);
    console.log(`TURN ${i + 1}: "${q}"`);
    console.log(`  Source: ${meta.source || 'unknown'}`);
    console.log(`  lastProgramHint BEFORE: ${sessionDataBefore.lastProgramHint} -> AFTER: ${sessionDataAfter.lastProgramHint}`);
    console.log(`  Domain AFTER: ${sessionDataAfter.lastSemanticContract && sessionDataAfter.lastSemanticContract.domain}`);
    console.log(`  Answer Preview:\n${text.split('\n').slice(0, 4).join('\n')}`);
  }

  fs.writeFileSync('scratch/reproduce_real_session_results.json', JSON.stringify(traceOutput, null, 2));
  console.log('\nWROTE scratch/reproduce_real_session_results.json');
}

run().catch(console.error);
