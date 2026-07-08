const rag = require('../src/engine/ragEngine.js');

async function test() {
  try {
    const response = await rag.query('Apa itu Sistem Informasi', 8, { returnDebug: true });
    console.log('=== RESPONSE STRUCTURE ===');
    console.log('Keys:', Object.keys(response));
    console.log('Debug keys:', response.debug ? Object.keys(response.debug) : 'no debug');
    console.log('\n=== DEBUG CONTENT ===');
    console.log(JSON.stringify(response.debug, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
