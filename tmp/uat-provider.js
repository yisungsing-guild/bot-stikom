const path = require('path');
const fs = require('fs');
const express = require('express');
const supertest = require('supertest');

const workspaceRoot = path.resolve(__dirname, '..');

process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_DEBUG_LOGS = 'true';
process.env.FORCE_REPLY_DECORATION_TEST = 'true';
process.env.BOT_REPLY_TIMEOUT_MS = '1000';
process.env.BOT_REPLY_TIMEOUT_BEHAVIOR = 'soft';
process.env.NODE_ENV = 'test';

// Fake Prisma proxy for minimal DB operations used by provider route.
const createAsyncProxy = () => new Proxy({}, {
  get(target, prop) {
    if (prop === 'then') return undefined;
    if (!target[prop]) {
      target[prop] = createAsyncProxy();
    }
    return target[prop];
  }
});

const makeAsyncFn = () => async () => null;
const fakePrismaModel = new Proxy({}, {
  get(target, prop) {
    if (!target[prop]) {
      target[prop] = makeAsyncFn();
    }
    return target[prop];
  }
});

const fakeDb = new Proxy({}, {
  get(target, prop) {
    if (!target[prop]) target[prop] = fakePrismaModel;
    return target[prop];
  }
});

// Pre-load fake modules into require cache before loading provider route.
const modPath = path.resolve(workspaceRoot, 'src', 'db.js');
require.cache[require.resolve(modPath)] = {
  id: modPath,
  filename: modPath,
  loaded: true,
  exports: fakeDb,
};

const chatLogPath = path.resolve(workspaceRoot, 'src', 'engine', 'chatLog.js');
require.cache[require.resolve(chatLogPath)] = {
  id: chatLogPath,
  filename: chatLogPath,
  loaded: true,
  exports: {
    appendChatMessage: async () => null,
    appendChatMessageBestEffort: async () => null,
    getChatMessages: async () => []
  }
};

const providerRouteFactory = require(path.resolve(workspaceRoot, 'src', 'routes', 'provider.js'));

async function run() {
  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouteFactory({
    sendMessage: async (chatId, message) => {
      return { ok: true, chatId, message };
    },
    getLatestMessage: async () => null
  }));

  const request = supertest(app);

  const queries = [
    'Apa syarat beasiswa KIP di STIKOM Bali?',
    'Bagaimana cara daftar beasiswa KIP?','Kapan pendaftaran beasiswa KIP dibuka?',
    'Apa saja persyaratan beasiswa 1K1S?', 'Bagaimana proses seleksi 1K1S?', 'Apakah beasiswa 1K1S tersedia untuk TI?',
    'Apa syarat beasiswa prestasi?', 'Bagaimana mengajukan beasiswa prestasi?', 'Berapa besar potongan beasiswa prestasi?',
    'Coba jelaskan beasiswa yayasan yang ada di STIKOM Bali.', 'Apa saja kriteria beasiswa yayasan?', 'Bagaimana mendaftar beasiswa yayasan?',
    'Berapa biaya masuk TI?', 'Berapa biaya kuliah Sistem Informasi per semester?', 'Biaya Bisnis Digital berapa?',
    'Berapa biaya Sistem Komputer di ITB STIKOM Bali?', 'Berapa DPP untuk TI?', 'Berapa biaya pendaftaran untuk SI?',
    'Bandingkan TI dan SI.', 'Apa bedanya TI dengan Sistem Komputer?', 'Mana yang lebih cocok untuk yang suka bisnis, TI atau Bisnis Digital?',
    'Jurusan apa yang cocok untuk saya yang suka coding?', 'Saya ingin jadi data analyst, prodi apa yang cocok?',
    'Bagaimana cara daftar PMB?', 'Apa persyaratan pendaftaran?', 'Dokumen apa saja yang harus disiapkan untuk daftar?',
    'Kapan tanggal pendaftaran gelombang 1?', 'Apa saja gelombang pendaftaran?', 'Kapan deadline pendaftaran terakhir?',
    'Apakah semua prodi di STIKOM Bali terakreditasi?', 'Bagaimana akreditasi TI?', 'Apa perbedaan akreditasi SI dengan TI?',
    'Apa fasilitas kampus yang tersedia?', 'Apakah ada laboratorium komputer di kampus?', 'Bagaimana akses kantin dan fasilitas olahraga?',
    'Di mana lokasi kampus ITB STIKOM Bali?', 'Bagaimana cara menuju kampus dengan transportasi umum?',
    'Bagaimana prospek kerja lulusan TI?', 'Apa prospek kerja Sistem Informasi?', 'Apa peluang karier bagi lulusannya?'
  ];

  const results = [];

  for (const query of queries) {
    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      originalConsoleLog.apply(console, args);
    };
    global.__provider_route_debug_events = [];
    try {
      const res = await request.post('/provider/webhook').send({ chatId: 'uat-test', text: query });
      results.push({ query, status: res.status, body: res.body, logs: [...logs], debugEvents: [...(global.__provider_route_debug_events || [])] });
    } catch (err) {
      results.push({ query, error: String(err), logs: [...logs], debugEvents: [...(global.__provider_route_debug_events || [])] });
    }
    console.log = originalConsoleLog;
  }

  const output = { env: { ENABLE_RAG: process.env.ENABLE_RAG, FORCE_BUNDLED_INDEX: process.env.FORCE_BUNDLED_INDEX, RAG_DEBUG_LOGS: process.env.RAG_DEBUG_LOGS }, results };
  const outPath = path.resolve(workspaceRoot, 'tmp', 'uat-provider-output.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log('WROTE', outPath);
}

run().catch(err => {
  console.error('ERROR', err);
  process.exit(1);
});
