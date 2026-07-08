const path = require('path');
const express = require('express');
const supertest = require('supertest');

const root = path.resolve(process.cwd());
const resolvedDb = require.resolve(path.join(root, 'src', 'db.js'));
const resolvedChatLog = require.resolve(path.join(root, 'src', 'engine', 'chatLog.js'));
const resolvedFsm = require.resolve(path.join(root, 'src', 'engine', 'fsm.js'));
const resolvedReplyEngine = require.resolve(path.join(root, 'src', 'engine', 'replyEngine.js'));
const resolvedAnalytics = require.resolve(path.join(root, 'src', 'engine', 'analyticsEngine.js'));
const resolvedWebSearch = require.resolve(path.join(root, 'src', 'engine', 'webSearchFallback.js'));
const resolvedTelegram = require.resolve(path.join(root, 'src', 'utils', 'telegram.js'));

const makeAsyncFn = () => async () => undefined;
const makeProxy = () => new Proxy({}, {
  get(target, prop) {
    if (!target[prop]) target[prop] = makeAsyncFn();
    return target[prop];
  }
});
const fakePrisma = new Proxy({}, {
  get(target, prop) {
    if (!target[prop]) target[prop] = makeProxy();
    return target[prop];
  }
});
const fakeChatLog = {
  appendChatMessage: async () => undefined,
  getChatMessages: async () => []
};
const fakeFsm = {
  handleFSM: async () => null,
  upsertSession: async () => undefined
};
const fakeReplyEngine = {
  findReplyByRules: async () => null
};
const fakeAnalytics = {
  AnalyticsEngine: class {
    constructor() {}
  }
};
const fakeWebSearch = {
  webSearchFallbackAnswer: async () => ({ ok: false, reason: 'mock' })
};
const fakeTelegram = {
  sendTelegramMessage: async () => undefined
};

require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: fakePrisma };
require.cache[resolvedChatLog] = { id: resolvedChatLog, filename: resolvedChatLog, loaded: true, exports: fakeChatLog };
require.cache[resolvedFsm] = { id: resolvedFsm, filename: resolvedFsm, loaded: true, exports: fakeFsm };
require.cache[resolvedReplyEngine] = { id: resolvedReplyEngine, filename: resolvedReplyEngine, loaded: true, exports: fakeReplyEngine };
require.cache[resolvedAnalytics] = { id: resolvedAnalytics, filename: resolvedAnalytics, loaded: true, exports: fakeAnalytics };
require.cache[resolvedWebSearch] = { id: resolvedWebSearch, filename: resolvedWebSearch, loaded: true, exports: fakeWebSearch };
require.cache[resolvedTelegram] = { id: resolvedTelegram, filename: resolvedTelegram, loaded: true, exports: fakeTelegram };

const providerRoute = require(path.join(root, 'src', 'routes', 'provider.js'))({
  sendMessage: async (chatId, message) => {
    console.log('PROVIDER_SEND_MESSAGE', JSON.stringify({ chatId, messagePreview: String(message || '').slice(0, 200) }));
    return { ok: true };
  },
  getLatestMessage: async () => null
});

const app = express();
app.use(express.json());
app.use('/provider', providerRoute);
const request = supertest(app);

const queries = [
  'Apa itu beasiswa 1K1S?',
  'Apa itu beasiswa KIP?',
  'Saya suka coding cocok jurusan apa?',
  'Berapa biaya TI?'
];

(async () => {
  for (const q of queries) {
    console.log('\n=== QUERY: ' + q + ' ===');
    try {
      const res = await request.post('/provider/webhook').send({ chatId: 'test-1', text: q });
      console.log('STATUS', res.status);
      console.log('BODY', JSON.stringify(res.body, null, 2));
    } catch (err) {
      console.error('ERROR', err && err.message ? err.message : err);
    }
  }
})();
