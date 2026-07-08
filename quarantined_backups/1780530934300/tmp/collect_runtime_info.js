const fs = require('fs');
const path = require('path');
process.env.PROVIDER_WEBHOOK_TOKEN = process.env.PROVIDER_WEBHOOK_TOKEN || '';
console.log('NODE_ENV', process.env.NODE_ENV || '');

function statSafe(p) {
  try { const st = fs.statSync(p); return { path: p, mtime: st.mtime.toISOString(), size: st.size }; } catch (e) { return { path: p, error: String(e.message) }; }
}

// Files to check (resolve from workspace root)
const providerPath = path.resolve(__dirname, '..', 'src', 'routes', 'provider.js');
const ragEnginePath = path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine.js');
console.log('\n-- File timestamps --');
console.log('provider.js:', statSafe(providerPath));
console.log('ragEngine.js:', statSafe(ragEnginePath));

// RAG index path resolution (from env or default in ragEngine)
let ragIndexPath = process.env.RAG_INDEX_PATH || null;
let ragDataDir = process.env.RAG_DATA_DIR || null;
if (!ragIndexPath) {
  // try reading ragEngine's INDEX_PATH by requiring it and calling getIndexPath if exists
  try {
    const r = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine.js'));
    if (typeof r.getIndexPath === 'function') {
      ragIndexPath = r.getIndexPath();
    }
  } catch (e) {
    // ignore
  }
}
if (!ragIndexPath) {
  // fallback to data/rag_index.json
  ragIndexPath = path.join(__dirname, 'data', 'rag_index.json');
}
console.log('\n-- RAG index --');
console.log('RAG_INDEX_PATH (env):', process.env.RAG_INDEX_PATH || '');
console.log('RAG_DATA_DIR (env):', process.env.RAG_DATA_DIR || '');
console.log('Resolved INDEX_PATH:', ragIndexPath);
console.log('INDEX stat:', statSafe(ragIndexPath));

// Env flags
console.log('\n-- Env flags --');
console.log('OPENAI_API_KEY set?', !!process.env.OPENAI_API_KEY);
console.log('RAG_INDEX_PATH:', process.env.RAG_INDEX_PATH || '');
console.log('RAG_DATA_DIR:', process.env.RAG_DATA_DIR || '');

// Now run provider router flow for queries
console.log('\n-- Provider webhook runs --');
const providerFactory = require(path.resolve(__dirname, '..', 'src', 'routes', 'provider'));
const ragEngine = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine'));

// wrap ragEngine.query to capture return values
const originalQuery = ragEngine.query;
const ragLog = [];
ragEngine.query = async function(q, topK, opts) {
  const res = await originalQuery.call(this, q, topK, opts);
  ragLog.push({ question: q, source: res && res.source, success: res && res.success, confidenceScore: res && res.confidenceScore, answerSnippet: typeof res.answer === 'string' ? res.answer.slice(0,200) : null, _full: res });
  return res;
};

const sentRecords = [];
const fakeProvider = {
  sendMessage: async (chatId, text) => { sentRecords.push({ chatId, text, type: 'text' }); return { ok: true }; },
  sendImage: async (chatId, url, caption) => { sentRecords.push({ chatId, url, caption, type: 'image' }); return { ok: true }; }
};

const router = providerFactory(fakeProvider);

async function callQuery(id, text) {
  const req = { method: 'POST', url: '/webhook', originalUrl: '/webhook', body: { chatId: `test-${id}`, text, whatsappMessageId: `msg-${id}`, ts: Date.now() }, headers: { authorization: '' }, query: {} };
  let finished = false;
  let resolveCb = null;
  const res = {
    status(code) { this.statusCode = code; return this; },
    send(obj) { finished = true; if (resolveCb) resolveCb(); return obj; },
    json(obj) { return this.send(obj); }
  };
  await new Promise((resolve, reject) => {
    resolveCb = resolve;
    router(req, res, (err) => { if (err) return reject(err); if (!finished) resolve(); });
  });
  // capture last messages for the chat
  const msgs = sentRecords.filter(s => s.chatId === `test-${id}`).map(s => s.text || (s.caption || ''));
  // get last rag log entry for this question if any
  const ragEntry = ragLog.slice(-1)[0] || null;
  return { id, text, rag: ragEntry, outbound: msgs.slice(-2) };
}

(async () => {
  const queries = [
    { id: 'a', text: 'apa itu SI?' },
    { id: 'b', text: 'di SI belajar apa?' },
    { id: 'c', text: 'lulusan TI bekerja dimana?' }
  ];
  const results = [];
  for (const q of queries) {
    try {
      const r = await callQuery(q.id, q.text);
      results.push(r);
      console.log('\nRESULT', q.id, JSON.stringify({ originalQuery: q.text, ragSource: r.rag && r.rag.source, outbound: r.outbound }, null, 2));
    } catch (e) {
      console.error('ERR', q.id, String(e && e.stack ? e.stack : e));
    }
  }

  console.log('\n=== RAG LOG SUMMARY ===');
  console.log(JSON.stringify(ragLog, null, 2));

  // Also print the last sentRecords lines for manual inspection
  console.log('\n=== SENT RECORDS ===');
  console.log(JSON.stringify(sentRecords.slice(-20), null, 2));

})();