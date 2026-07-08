const rag = require('./src/engine/ragEngine');
(async () => {
  try {
    const res = await rag.query('apa itu si');
    console.log('QUERY RESULT:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  }
})();