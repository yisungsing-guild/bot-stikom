const fs = require('fs');
const rag = require('../src/engine/ragEngine');
const index = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8'));
const byId = new Map(index.map((it) => [it.id, it]));
const queries = ['apa itu SI', 'apa itu TI', 'apa itu BD', 'apa itu SK'];

(async () => {
  for (const q of queries) {
    const res = await rag.query(q, 10, { answerQuestion: q, minScore: 0 });
    const contexts = Array.isArray(res && res.contexts) ? res.contexts : [];
    console.log(`QUERY: ${q}`);
    for (let i = 0; i < contexts.length; i++) {
      const c = contexts[i];
      const full = byId.get(c.id) || {};
      console.log(`${i+1}. filename=${c.filename || full.filename || null} program=${full.program || null} score=${typeof c.score === 'number' ? c.score : null} rank=${i+1}`);
    }
    console.log('---');
  }
})();
