const path = require('path');
process.env.NODE_ENV = 'test';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
// Avoid OpenAI external call; rely on deterministic / structured RAG rules.
process.env.OPENAI_API_KEY = '';

const dbPath = path.resolve(__dirname, '..', 'src', 'db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    session: { findUnique: async () => null, upsert: async () => null, update: async () => null, create: async () => null },
    chat: { upsert: async () => null, update: async () => null },
    setting: { findUnique: async () => null },
    trainingData: { count: async () => 0, findMany: async () => [], findFirst: async () => null },
    ragEvalItem: { upsert: async () => null },
    menuItem: { findFirst: async () => null }
  }
};

const ragEnginePath = path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine.js');
const ragEngine = require(ragEnginePath);
const originalRagQuery = ragEngine.query;
let queryCounter = 0;
const queryLog = [];
ragEngine.query = async function (question, topK, options) {
  queryCounter += 1;
  const result = await originalRagQuery.call(this, question, topK, options);
  queryLog.push({ queryId: queryCounter, question, source: result && result.source, success: result && result.success, confidenceScore: result && result.confidenceScore, answerSnippet: typeof result.answer === 'string' ? result.answer.slice(0, 120).replace(/\n/g, ' ') : null });
  return result;
};

const providerFactory = require(path.resolve(__dirname, '..', 'src', 'routes', 'provider'));
const fakeProvider = {
  sendMessage: async (chatId, text) => {
    console.log(`SEND MESSAGE [${chatId}]`, text);
    return { ok: true };
  },
  sendImage: async (chatId, url, caption) => {
    console.log(`SEND IMAGE [${chatId}] ${url} ${caption}`);
    return { ok: true };
  }
};

const router = providerFactory(fakeProvider);
const queries = [
  { text: 'prodi apa saja yang ada di stikom?', id: 'q1' },
  { text: 'di sistem informasi belajar apa saja?', id: 'q2' },
  { text: 'prospek kerja TI bagaimana?', id: 'q3' },
  { text: 'berapa biaya SI?', id: 'q4' },
  { text: 'syarat pendaftaran apa saja?', id: 'q5' },
  { text: 'masih buka pendaftaran?', id: 'q6' },
  { text: 'berapa biaya pendaftaran prodi sistem informasi', id: 'q7' },
  { text: 'apa bedanya Sistem Informasi dan Sistem Komputer?', id: 'q8' }
];

async function sendRequest({ id, text }) {
  console.log('\n=== REQUEST', id, text);
  const req = {
    method: 'POST',
    url: '/webhook',
    originalUrl: '/webhook',
    body: { chatId: `test-chat-${id}`, text, whatsappMessageId: `msg-${id}`, ts: Date.now() },
    headers: { authorization: '' },
    query: {}
  };
  let resSent = null;
  let finished = false;
  let resolveCallback = null;
  const res = {
    status(code) { this.statusCode = code; return this; },
    send(obj) {
      if (!finished) {
        resSent = obj;
        finished = true;
        if (typeof resolveCallback === 'function') resolveCallback();
      }
      return obj;
    },
    json(obj) { return this.send(obj); }
  };
  await new Promise((resolve, reject) => {
    resolveCallback = resolve;
    router(req, res, (err) => {
      if (err) reject(err);
      else if (!finished) resolve();
    });
  });
  console.log('RES SEND', resSent);
}

(async () => {
  for (const q of queries) {
    try {
      await sendRequest(q);
    } catch (err) {
      console.error('REQUEST ERROR', q.id, err && err.stack ? err.stack : err);
    }
  }
  console.log('\n=== RAG QUERY LOG ===');
  for (const entry of queryLog) {
    console.log(entry);
  }
})();