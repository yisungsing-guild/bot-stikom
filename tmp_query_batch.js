const engine = require('./src/engine/ragEngine');
const { decorateBotAnswerText } = require('./src/engine/conversationalStyle');
const fs = require('fs');

const queries = [
  'berapa biaya TI gelombang 1A',
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya SK gelombang 1A',
  'berapa biaya MI',
  'berapa biaya S2 SI',
  'berapa biaya DD DNUI',
  'berapa biaya HELP',
  'berapa biaya UTB'
];

async function runOne(q){
  const res = await engine.query(q);
  const pre = res && res.answer ? res.answer : null;
  const final = decorateBotAnswerText(pre, q);
  const feeStruct = res && res.debug && res.debug.feeStruct ? res.debug.feeStruct : null;
  const contexts = (res && res.contexts) ? res.contexts : (res && res.debug && res.debug.topChunks ? res.debug.topChunks : []);
  const rawChunk = (feeStruct && feeStruct.rawChunk) ? feeStruct.rawChunk : (contexts && contexts[0] && contexts[0].chunk ? contexts[0].chunk : null);

  const out = { query: q, feeStruct, rawChunk, preDecorate: pre, final };
  fs.appendFileSync('./tmp_query_batch_outputs.jsonl', JSON.stringify(out)+"\n");
  console.log('Wrote', q);
}

(async ()=>{
  try{
    fs.writeFileSync('./tmp_query_batch_outputs.jsonl','');
    for(const q of queries){
      try{ await runOne(q); } catch(e){ console.error('ERR',q,e && e.message); }
    }
  }catch(e){ console.error('fatal',e && e.stack); }
})();
