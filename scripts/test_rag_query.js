const rag = require('../src/engine/ragEngine');

const queries = [
  'Apa itu TI',
  'Apa itu SI',
  'TI belajar apa saja',
  'SI belajar apa saja',
  'Prospek kerja TI'
];

(async () => {
  process.env.RAG_DEBUG_CHUNK_SCORING = 'true';
  for (const q of queries) {
    try {
      console.log('\n=== QUERY:', q, '===');
      const res = await rag.query(q, 20, { strict: false });
      console.log('success:', !!res);
      if (res && res.debug) console.log('debug:', JSON.stringify(res.debug).slice(0,1000));
      if (res && res.contexts) {
        console.log('contexts count:', res.contexts.length);
        res.contexts.slice(0,10).forEach((c, i) => {
          console.log(`${i+1}. id:${c.id || 'N/A'} file:${c.filename || c.trainingId || 'N/A'} score:${c.score || 'N/A'}`);
        });
      } else if (res && res.contexts === undefined) {
        console.log('No contexts returned (possibly deterministic answer)');
      }
    } catch (e) {
      console.error('failed', e && e.message);
    }
  }
})();
