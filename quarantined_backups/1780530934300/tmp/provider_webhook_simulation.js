process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'true';
process.env.ENABLE_AI = 'true';
process.env.NODE_ENV = 'production';
process.env.PROVIDER_WEBHOOK_TOKEN = 'test-provider-token-12345';
process.env.BOT_REPLY_TIMEOUT_MS = '20000';
process.env.OPENAI_TIMEOUT_MS = '20000';
process.env.RAG_MIN_SCORE = '0.0';
process.env.RAG_STRICT_MODE = 'false';
process.env.OUTBOUND_DEBUG = 'false';
process.env.COMPOSER_DEBUG = 'false';
process.env.RAG_DEBUG_LOGS = 'true';
process.env.RAG_DEBUG_CHUNK_SCORING = 'false';
process.env.RAG_DEBUG_INTENT_FILTERING = 'false';
process.env.WHATSAPP_STRIP_META_SOURCES = 'true';

const express = require('express');
const providerRouteFactory = require('../src/routes/provider');

const app = express();
app.use(express.json());

const sentMessages = {};
const provider = {
  async sendMessage(chatId, text) {
    if (!sentMessages[chatId]) sentMessages[chatId] = [];
    sentMessages[chatId].push({ type: 'text', text: String(text || '').trim(), ts: new Date().toISOString() });
    return true;
  },
  async sendImage(chatId, url, caption) {
    if (!sentMessages[chatId]) sentMessages[chatId] = [];
    sentMessages[chatId].push({ type: 'image', text: String(caption || '').trim(), url, ts: new Date().toISOString() });
    return true;
  }
};

app.use('/provider', providerRouteFactory(provider));

const server = app.listen(0);
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

const debugEvents = [];
const originalConsoleLog = console.log;
console.log = (...args) => {
  try {
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (text.includes('[Provider] RAG selection debug')) {
      const idx = text.indexOf('[Provider] RAG selection debug');
      const jsonPart = text.slice(idx + '[Provider] RAG selection debug'.length).trim();
      if (jsonPart) {
        try {
          const parsed = JSON.parse(jsonPart);
          debugEvents.push(parsed);
        } catch (e) {
          // ignore parse error
        }
      }
    }
  } catch (e) {
    // ignore
  }
  originalConsoleLog(...args);
};

async function sendProviderRequest(chatId, text, messageId) {
  const payload = { chatId, text, id: messageId, timestamp: Date.now() };
  const response = await fetch(`${baseUrl}/provider/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.PROVIDER_WEBHOOK_TOKEN}`,
      'x-webhook-token': process.env.PROVIDER_WEBHOOK_TOKEN
    },
    body: JSON.stringify(payload)
  });
  const bodyText = await response.text();
  let body = null;
  try { body = JSON.parse(bodyText); } catch { body = bodyText; }
  return { status: response.status, body };
}

const questions = [
  'Apa itu Teknologi Informasi?',
  'Apa itu Sistem Informasi?',
  'Apa itu Sistem Komputer?',
  'Apa itu Bisnis Digital?',
  'Apa itu Manajemen Informasi?',
  'Prospek kerja TI',
  'Prospek kerja SI',
  'Prospek kerja SK',
  'Prospek kerja BD',
  'Prospek kerja MI',
  'Mata kuliah TI',
  'Mata kuliah SI',
  'Mata kuliah SK',
  'Mata kuliah BD',
  'Mata kuliah MI',
  'Berapa biaya TI?',
  'Berapa biaya SI?',
  'Apa perbedaan TI dan SI?',
  'Double Degree Nasional',
  'Double Degree Internasional'
];

(async () => {
  const chatId = `628123456780012345-test-${Date.now()}`;
  const results = [];
  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i];
    const messageId = `msg-${i + 1}-${Date.now()}`;
    sentMessages[chatId] = [];
    const beforeDebugCount = debugEvents.length;
    const result = await sendProviderRequest(chatId, question, messageId);
    // Wait a moment to let any delayed outbound send finish if needed.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const sent = sentMessages[chatId] || [];
    const debugForRequest = debugEvents.slice(beforeDebugCount);
    const lastDebug = debugForRequest.length ? debugForRequest[debugForRequest.length - 1] : null;
    results.push({
      question,
      status: result.status,
      body: result.body,
      ragDebug: lastDebug,
      outbound: sent
    });
  }
  console.log('--- SIMULATION RESULTS ---');
  for (const item of results) {
    console.log('QUESTION:', item.question);
    console.log('STATUS:', item.status);
    if (item.ragDebug) {
      console.log('RAG_QUERY_AFTER_REWRITE:', item.ragDebug.query);
      console.log('QUERY_ENTITIES:', JSON.stringify(item.ragDebug.queryEntities, null, 2));
      console.log('TOP_CONTEXTS:', JSON.stringify(item.ragDebug.selectedChunks || item.ragDebug.selectedChunkCount || [], null, 2));
      console.log('RAG_SOURCE:', item.ragDebug.ragSource);
      console.log('RAG_SUCCESS:', item.ragDebug.ragSuccess);
      console.log('SOURCE_FILES:', JSON.stringify(item.ragDebug.sourceFiles, null, 2));
    }
    const textList = (item.outbound || []).map((x, idx) => `  [${idx + 1}] (${x.type}) ${x.text}`);
    console.log('OUTBOUND_MESSAGES:\n' + textList.join('\n'));
    console.log('---');
  }
  server.close();
})();
