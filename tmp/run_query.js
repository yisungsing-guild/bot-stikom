const path = require('path');
const rag = require(path.resolve(__dirname, '..', 'src', 'engine', 'ragEngine.js'));

(async () => {
  try {
    const question = 'rincian biaya SI gelombang 1A';
    console.log('USER_QUESTION:' , question);
    const res = await rag.query(question, 5, { debug: true });
    console.log('\n--- BOT RESPONSE OBJECT ---\n');
    console.log(JSON.stringify(res, null, 2));
    console.log('\n--- BOT FORMATTED ANSWER ---\n');
    console.log(String(res && res.answer || ''));
  } catch (e) {
    console.error('Error running query:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
