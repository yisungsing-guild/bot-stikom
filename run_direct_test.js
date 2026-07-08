#!/usr/bin/env node
/**
 * Direct Production Runtime Invocation
 * Executes fee queries directly against the provider without Jest
 */

const path = require('path');
const fs = require('fs');

// Setup minimal environment
process.env.NODE_ENV = 'test';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.ENABLE_RAG = 'false';

// Mock Prisma before requiring provider
const mockDb = {
  chat: {
    findUnique: async () => null,
    upsert: async (opts) => ({ chatId: opts.where.chatId, status: 'BOT' }),
    update: async () => ({})
  },
  keywordReply: { findMany: async () => [] },
  setting: { findUnique: async () => null },
  trainingData: { count: async () => 0, findFirst: async () => null },
  session: {
    findUnique: async ({ where }) => null,
    upsert: async ({ where }) => ({ chatId: where.chatId, state: 'root', data: {} })
  },
  menuItem: { findFirst: async () => null, findMany: async () => [] }
};

// Create __mocks__ directory if it doesn't exist
const mocksDir = path.join(__dirname, 'src', '__mocks__');
if (!fs.existsSync(mocksDir)) {
  fs.mkdirSync(mocksDir, { recursive: true });
}

// Create mock modules
fs.writeFileSync(path.join(__dirname, 'src', '__mocks__', 'db.js'), `module.exports = ${JSON.stringify(mockDb).replace(/: async/g, ':')};`);

// Now require the provider
const providerFactory = require('./src/routes/provider');

// Mock provider transport
const mockProvider = {
  sendMessage: async (chatId, text) => {
    console.log(`[SENT TO ${chatId}]:\n${text}\n`);
  }
};

// Test queries
const queries = [
  { program: 'TI', gelombang: '2C', text: 'berapa biaya TI gelombang 2C' },
  { program: 'SI', gelombang: '2C', text: 'berapa biaya SI gelombang 2C' },
  { program: 'MI', gelombang: '2C', text: 'berapa biaya MI gelombang 2C' },
  { program: 'DNUI', gelombang: '2C', text: 'berapa biaya DNUI gelombang 2C' },
  { program: 'HELP', gelombang: '2C', text: 'berapa biaya HELP gelombang 2C' },
  { program: 'UTB', gelombang: '2C', text: 'berapa biaya UTB gelombang 2C' }
];

console.log('═════════════════════════════════════════════════════════════════════════');
console.log('PRODUCTION RUNTIME EXECUTION - Direct Provider Invocation');
console.log('═════════════════════════════════════════════════════════════════════════\n');

// Simulate webhook requests
(async () => {
  const router = providerFactory(mockProvider);
  
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const chatId = `test_${q.program}_${q.gelombang}`;

    console.log(`\n${'═'.repeat(75)}`);
    console.log(`QUERY ${i + 1}: ${q.text}`);
    console.log(`Program: ${q.program}, Gelombang: ${q.gelombang}`);
    console.log('═'.repeat(75));

    // Mock Express request/response
    const tokenValue = process.env.PROVIDER_WEBHOOK_TOKEN || '';
    const authHeader = tokenValue ? `Bearer ${tokenValue}` : '';
    const req = {
      method: 'POST',
      body: { chatId, text: q.text },
      headers: authHeader ? { authorization: authHeader } : {},
      get: (name) => authHeader || ''
    };

    let responseData = null;
    const res = {
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      send: (data) => {
        responseData = data;
        console.log('\n→ RESPONSE:', JSON.stringify(data, null, 2));
      },
      json: (data) => {
        responseData = data;
        console.log('\n→ RESPONSE:', JSON.stringify(data, null, 2));
      },
      setHeader: () => {},
      getHeader: () => ''
    };

    try {
      // Find the webhook handler
      const layer = router.stack.find(l => l.route && l.route.path === '/webhook' && l.route.methods.post);
      
      if (!layer || !layer.route || !layer.route.stack) {
        console.log('❌ Could not find webhook handler in router');
        continue;
      }

      // Get POST handler
      const handler = layer.route.stack.find(m => m.method === 'post' || m.handle.length > 0);
      
      if (!handler || !handler.handle) {
        console.log('❌ Could not find POST handler');
        continue;
      }

      // Call the handler (it's async). Provide a no-op next() so Express middleware works.
      const promise = handler.handle(req, res, () => {});
      
      if (promise && typeof promise.then === 'function') {
        await promise;
      }

      // Display results
      if (responseData) {
        console.log('\n→ ROUTE:', responseData.route || responseData.source || 'N/A');
        console.log('→ SOURCE:', responseData.source || 'N/A');
        
        if (responseData.feeStruct) {
          console.log('\n→ FEE STRUCTURE (JSON):');
          console.log(JSON.stringify(responseData.feeStruct, null, 2));
        }
      }

      console.log('\n✓ Query completed');
    } catch (error) {
      console.log('❌ ERROR:', error.message);
      if (error.stack) {
        console.log(error.stack.split('\n').slice(0, 5).join('\n'));
      }
    }
  }

  console.log('\n' + '═'.repeat(75));
  console.log('END OF PRODUCTION RUNTIME EXECUTION');
  console.log('═'.repeat(75));
  process.exit(0);
})().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
