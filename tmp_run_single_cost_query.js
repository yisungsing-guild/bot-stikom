const rag = require('./src/engine/ragEngine');
const fs = require('fs');

(async ()=>{
  const question = 'berapa biaya TI gelombang 2C';
  const queryEntities = { intent: 'COST', program: 'TI', wave: '2C', academicYear: '2025' };
  const index = JSON.parse(fs.readFileSync(rag.getIndexPath(),'utf8'));
  const qEmb = await rag.computeEmbedding(question);
  const res = tryCall();
  function tryCall(){
    try{
      const r = rag.tryStructuredExactCostAnswer(question, queryEntities, index, 20, qEmb);
      console.log(JSON.stringify(r, null, 2));
      return r;
    }catch(e){
      console.error('ERR', e && e.stack ? e.stack : e);
      return null;
    }
  }
})();
