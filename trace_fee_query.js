const { query } = require('./src/engine/ragEngine');

// Suppress embeddings output
const originalLog = console.log;
console.log = function(...args) {
  const msg = args[0];
  if (typeof msg === 'string') {
    // Only log TRACE lines and final results
    if (msg.includes('[TRACE_') || msg.includes('answer') || msg.includes('source:')) {
      originalLog.apply(console, args);
    }
  }
};

async function testQuery() {
  try {
    console.log('=== RUNNING QUERY: berapa biaya TI gelombang 2C? ===\n');
    
    const result = await query('berapa biaya TI gelombang 2C?', null, {});
    
    console.log('\n=== FINAL RESULT ===');
    console.log('Source:', result.source);
    console.log('Answer:', result.answer.substring(0, 200) + '...');
    console.log('Debug:', JSON.stringify(result.debug, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testQuery();
