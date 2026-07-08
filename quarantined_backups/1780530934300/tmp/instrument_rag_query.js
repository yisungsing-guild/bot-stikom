const rag = require('../src/engine/ragEngine');

async function run(){
  const q = 'apa itu SI?';
  const ragRes = await rag.query(q, 10, { answerQuestion: q, minScore: 0 });
  const selectedRoute = ragRes && ragRes.source ? ragRes.source : null;
  const topChunks = Array.isArray(ragRes && ragRes.contexts) ? ragRes.contexts.slice(0,10).map((c,i)=>({rank:i+1, id:c.id||null, filename:c.filename||null, score: typeof c.score==='number'?c.score:null, snippet: (c.chunk||'').replace(/\s+/g,' ').trim().slice(0,300)})) : [];
  console.log(JSON.stringify({ query: q, selectedRoute, retrievalQuery: q, topChunks }, null, 2));
}
run().catch(e=>{ console.error(e); process.exit(1); });
