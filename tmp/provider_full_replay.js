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

const questions = `Halo
Hai
Selamat pagi
Selamat siang
Selamat malam
Apa kabar?
Kamu siapa?
Kamu bisa bantu apa?
Apa yang bisa kamu lakukan?

Apa itu Sistem Informasi?
Apa itu Teknologi Informasi?
Apa itu Sistem Komputer?
Perbedaan Sistem Informasi dan Teknologi Informasi apa?
Perbedaan Sistem Informasi dan Sistem Komputer apa?
Perbedaan Teknologi Informasi dan Sistem Komputer apa?
Program studi apa saja yang ada di ITB STIKOM Bali?
Program studi mana yang cocok untuk menjadi programmer?
Program studi mana yang cocok untuk menjadi network engineer?
Program studi mana yang cocok untuk UI/UX Designer?

Berapa biaya masuk Sistem Informasi Gelombang 1A?
Berapa biaya masuk Sistem Informasi Gelombang 1B?
Berapa biaya masuk Sistem Informasi Gelombang 2A?
Berapa biaya masuk Sistem Informasi Gelombang 2B?
Berapa biaya masuk Sistem Informasi Gelombang 3?

Rincian biaya Sistem Informasi Gelombang 1A apa saja?
Rincian biaya Sistem Informasi Gelombang 1B apa saja?
Rincian biaya Sistem Informasi Gelombang 2A apa saja?
Rincian biaya Sistem Informasi Gelombang 2B apa saja?
Rincian biaya Sistem Informasi Gelombang 3 apa saja?

Berapa biaya pendaftaran Sistem Informasi Gelombang 1A?
Berapa biaya pendaftaran Sistem Informasi Gelombang 2B?
Berapa DPP Sistem Informasi Gelombang 1B?
Berapa DPP Sistem Informasi Gelombang 2A?
Berapa biaya semester pertama Sistem Informasi Gelombang 2B?
Berapa total biaya awal Sistem Informasi Gelombang 2B?

Berapa biaya masuk Teknologi Informasi Gelombang 1A?
Berapa biaya masuk Teknologi Informasi Gelombang 1B?
Berapa biaya masuk Teknologi Informasi Gelombang 2A?
Berapa biaya masuk Teknologi Informasi Gelombang 2B?
Berapa biaya masuk Teknologi Informasi Gelombang 3?

Rincian biaya Teknologi Informasi Gelombang 1A apa saja?
Rincian biaya Teknologi Informasi Gelombang 1B apa saja?
Rincian biaya Teknologi Informasi Gelombang 2A apa saja?
Rincian biaya Teknologi Informasi Gelombang 2B apa saja?
Rincian biaya Teknologi Informasi Gelombang 3 apa saja?

Berapa biaya pendaftaran Teknologi Informasi Gelombang 1A?
Berapa biaya pendaftaran Teknologi Informasi Gelombang 2B?
Berapa DPP Teknologi Informasi Gelombang 1B?
Berapa DPP Teknologi Informasi Gelombang 2A?
Berapa biaya semester pertama Teknologi Informasi Gelombang 2B?
Berapa total biaya awal Teknologi Informasi Gelombang 2B?

Berapa biaya masuk Sistem Komputer Gelombang 1A?
Berapa biaya masuk Sistem Komputer Gelombang 1B?
Berapa biaya masuk Sistem Komputer Gelombang 2A?
Berapa biaya masuk Sistem Komputer Gelombang 2B?
Berapa biaya masuk Sistem Komputer Gelombang 3?

Rincian biaya Sistem Komputer Gelombang 1A apa saja?
Rincian biaya Sistem Komputer Gelombang 1B apa saja?
Rincian biaya Sistem Komputer Gelombang 2A apa saja?
Rincian biaya Sistem Komputer Gelombang 2B apa saja?
Rincian biaya Sistem Komputer Gelombang 3 apa saja?

Berapa biaya pendaftaran Sistem Komputer Gelombang 1A?
Berapa biaya pendaftaran Sistem Komputer Gelombang 2B?
Berapa DPP Sistem Komputer Gelombang 1B?
Berapa DPP Sistem Komputer Gelombang 2A?
Berapa biaya semester pertama Sistem Komputer Gelombang 2B?
Berapa total biaya awal Sistem Komputer Gelombang 2B?

Berapa biaya Program Double Degree Sistem Informasi Gelombang 1A?
Berapa biaya Program Double Degree Sistem Informasi Gelombang 1B?
Berapa biaya Program Double Degree Sistem Informasi Gelombang 2A?
Berapa biaya Program Double Degree Sistem Informasi Gelombang 2B?
Berapa biaya Program Double Degree Sistem Informasi Gelombang 3?

Berapa biaya Program Double Degree Teknologi Informasi Gelombang 1A?
Berapa biaya Program Double Degree Teknologi Informasi Gelombang 1B?
Berapa biaya Program Double Degree Teknologi Informasi Gelombang 2A?
Berapa biaya Program Double Degree Teknologi Informasi Gelombang 2B?
Berapa biaya Program Double Degree Teknologi Informasi Gelombang 3?

Apa saja rincian biaya Program Double Degree?
Apakah biaya Double Degree lebih mahal dari reguler?
Berapa tambahan biaya Double Degree?
Apakah Double Degree memiliki biaya pendaftaran yang berbeda?
Apakah DPP Double Degree berbeda dengan reguler?
Apakah ada potongan biaya Double Degree?

Kalau saya memilih Sistem Informasi Gelombang 2B total bayarnya berapa?
Kalau masuk Teknologi Informasi Gelombang 1A harus bayar apa saja?
Kalau memilih Sistem Komputer Gelombang 3 rincian pembayarannya bagaimana?
Total biaya awal masuk SI Gelombang 1B berapa?
Biaya registrasi ulang TI Gelombang 2A berapa?
Biaya awal SK Gelombang 2B terdiri dari apa saja?
Berapa total pembayaran pertama Double Degree?
Double Degree SI Gelombang 2B totalnya berapa?
Double Degree TI Gelombang 1A rincian biayanya apa saja?
Bandingkan biaya SI reguler dengan SI Double Degree Gelombang 2B.
Bandingkan biaya TI Gelombang 1A dan Gelombang 2B.
Bandingkan biaya SI dan TI Gelombang 2A.
Program studi mana yang biaya masuknya paling murah?
Program studi mana yang biaya masuknya paling mahal?

Bagaimana cara daftar?
Apa syarat pendaftaran?
Dokumen apa saja yang diperlukan?
Bagaimana alur pendaftaran mahasiswa baru?
Apakah bisa daftar secara online?
Apakah bisa daftar langsung ke kampus?

Ada beasiswa?
Apa itu KIP Kuliah?
Bagaimana cara mendapatkan KIP Kuliah?
Apa itu Beasiswa 1K1S?
Apa itu RPL?

Jadwal PMB sekarang bagaimana?
Gelombang 2B masih buka?
Kapan pendaftaran ditutup?
Apakah masih menerima mahasiswa baru?
Kapan tes masuk dilaksanakan?

Apa itu UKM KSL?
Kegiatan UKM KSL apa saja?
Program kerja UKM KSL apa?
Visi misi UKM KSL apa?
Siapa pembina UKM KSL?
Apa manfaat bergabung dengan UKM KSL?

Apa itu UKM VOS?
Apa kegiatan UKM VOS?
Apa program kerja UKM VOS?
Apa itu JCOS?
JCOS bergerak di bidang apa?
Apa kegiatan JCOS?

KSL itu apa?
VOS itu apa?
JCOS itu apa?
CDC itu apa?
BAAK itu apa?

Apa sejarah ITB STIKOM Bali?
Apa visi kampus?
Apa misi kampus?
Apa keunggulan kampus?
Apa akreditasi kampus?
Di mana lokasi kampus?

Fasilitas laboratorium apa saja?
Apakah ada perpustakaan digital?
Kampus memiliki fasilitas apa?
Ada laboratorium jaringan?
Apakah tersedia WiFi?
Apakah ada ruang multimedia?

Apa itu Career Center?
Career Center membantu apa?
Layanan kemahasiswaan apa saja?
Apa layanan akademik yang tersedia?
Apa layanan administrasi kampus?

Kampus bekerja sama dengan perusahaan apa saja?
Apakah ada kerja sama luar negeri?
Apakah ada program magang?
Apakah ada pertukaran mahasiswa?

Apa isi dokumen Profil UKM KSL?
Ceritakan isi Profil UKM KSL.
Ringkas Profil UKM KSL.
Apa informasi penting dari Profil UKM KSL?
Profil UKM KSL membahas apa?

Organisasi mahasiswa Linux itu apa?
Komunitas Linux di kampus ada?
Unit mahasiswa Linux namanya apa?
Apakah ada UKM yang fokus Open Source?

Berapa biaya masuk?
SI

Apa UKM yang bergerak di Linux?
Apa saja kegiatannya?

Bagaimana cara daftar?
Kalau jalur KIP bagaimana?

ksllllllll
....
???

Siapa Presiden Indonesia?
Harga Bitcoin hari ini berapa?
Cuaca di Jepang bagaimana?
Resep nasi goreng bagaimana?
Siapa Cristiano Ronaldo?`
  .split(/\r?\n/)
  .map(s => s.trim())
  .filter(Boolean);

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
    const arr = chatStore.get(chatId) || [];
    arr.push({ direction, message: String(message || '') });
    chatStore.set(chatId, arr);
  };
  chatLog.getChatMessages = async (chatId) => chatStore.get(chatId) || [];

  const provider = { sendMessage: jestMockSendMessage(), sendImage: async () => {} };
  const app = express();
  app.use(express.json());
  app.use('/provider', require('../src/routes/provider')(provider));

  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    provider.sendMessage.mockClear();
    const chatId = 'batch-user-' + i;
    let body = null;
    let status = null;
    let err = null;
    try {
      const res = await request(app).post('/provider/webhook').send({ chatId, text: q });
      status = res.status;
      body = res.body;
    } catch (e) {
      err = e && e.stack ? e.stack : String(e);
    }
    const sent = provider.sendMessage.mock.calls.map(c => String(c[1] || '')).filter(Boolean);
    results.push({ user: q, bot: sent.join('\n---\n') || '[NO MESSAGE SENT]', status, source: body && body.source, err });
  }

  const out = results.map(r => `user:\n${r.user}\n\nbot:\n${r.bot}\n`).join('\n---\n');
  const outPath = path.join('tmp', 'provider_full_replay_user_bot.txt');
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(outPath, out, 'utf8');
  fs.writeFileSync(path.join('tmp', 'provider_full_replay_user_bot.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('COUNT=' + results.length);
  console.log('NO_MESSAGE=' + results.filter(r => r.bot === '[NO MESSAGE SENT]').length);
  console.log('OUT=' + outPath);
  console.log(out.slice(0, 12000));
})().catch(e => { console.error(e); process.exit(1); });

