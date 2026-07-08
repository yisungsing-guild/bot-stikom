// Load production env file so fallback contacts from `.env.production` are applied
require('dotenv').config({ path: '.env.production' });

(async () => {
  try {
    const { AIReplyEngine } = require('../src/engine/aiEngine');
    const engine = new AIReplyEngine('dummy-key-for-test');

    const question = 'Saya Prodi Sistem Informasi, kapan saya mulai kuliah semester genap tahun akademik 2025/2026?';
    const result = await engine.getRagAnswer(question, '', 'SEMI', '');

    console.log('=== Fallback test result ===');
    console.log(result.reply);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
})();
