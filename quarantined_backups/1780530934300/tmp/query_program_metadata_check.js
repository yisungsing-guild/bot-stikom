const fs = require('fs');
const rag = require('../src/engine/ragEngine');

const index = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8'));
const byId = new Map(index.map((it) => [it.id, it]));

async function run() {
  const queries = ['apa itu SI', 'apa itu TI', 'apa itu BD', 'apa itu SK'];
  const out = {};

  for (const q of queries) {
    const res = await rag.query(q, 10, { answerQuestion: q, minScore: 0 });
    const contexts = Array.isArray(res && res.contexts) ? res.contexts : [];
    out[q] = {
      source: res && res.source ? res.source : null,
      contexts: contexts.map((c, i) => {
        const full = byId.get(c.id) || {};
        return {
          rank: i + 1,
          id: c.id || null,
          filename: c.filename || null,
          score: typeof c.score === 'number' ? c.score : null,
          program: full.program || null,
          programAliases: Array.isArray(full.programAliases) ? full.programAliases : [],
          snippet: String(c.chunk || '').replace(/\s+/g, ' ').trim().slice(0, 200)
        };
      })
    };
  }

  console.log(JSON.stringify(out, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
