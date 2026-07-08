const path = require('path');
process.env.NODE_ENV = 'test';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
const dbPath = path.resolve(__dirname, '..', 'src', 'db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { session: { findUnique: async () => null, upsert: async () => null, update: async () => null, create: async () => null }, chat: { upsert: async () => null, update: async () => null }, setting: { findUnique: async () => null }, trainingData: { count: async () => 0, findMany: async () => [], findFirst: async () => null }, ragEvalItem: { upsert: async () => null }, menuItem: { findFirst: async () => null } } };
const providerFactory = require(path.resolve(__dirname, '..', 'src', 'routes', 'provider'));
const fakeProvider = { sendMessage: async (chatId, text) => { console.log('SEND MESSAGE', chatId, text); return { ok: true }; }, sendImage: async (chatId, url, caption) => { console.log('SEND IMAGE', chatId, url, caption); return { ok: true }; } };
const router = providerFactory(fakeProvider);
console.log('ROUTER LAYERS', router.stack.map((layer) => ({ name: layer.name, path: layer.route ? layer.route.path : null, methods: layer.route ? layer.route.methods : null })));
const req = {
  method: 'POST',
  url: '/webhook',
  originalUrl: '/webhook',
  body: { chatId: 'test-chat', text: 'apa itu SI?', whatsappMessageId: 'msg-123', ts: Date.now() },
  headers: { authorization: '' },
  query: {}
};
let resSent = null;
const res = {
  status(code) { this.statusCode = code; return this; },
  send(obj) { resSent = obj; return obj; },
  json(obj) { return this.send(obj); }
};
(async () => {
  try {
    await new Promise((resolve, reject) => {
      router(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    console.log('RESULT', resSent);
  } catch (e) {
    console.error('HANDLER ERROR', e);
  }
})();