const fs = require('fs');
const { query } = require('./src/engine/ragEngine');
(async ()=>{
  const queries = ['berapa biaya TI gelombang 2C?','berapa biaya SI gelombang 2C?','berapa biaya MM gelombang 2C?','berapa biaya SK gelombang 1A?'];
  for(let i=0;i<queries.length;i++){
    const q = queries[i];
    try{
      const res = await query(q, null, {});
      fs.writeFileSync(`result_q${i+1}.json`, JSON.stringify({query:q, result: res}, null, 2), 'utf8');
      console.log('wrote result_q'+(i+1)+'.json');
    }catch(e){
      fs.writeFileSync(`result_q${i+1}.json`, JSON.stringify({query:q, error: String(e)}, null,2), 'utf8');
      console.error('error for', q, e && e.stack);
    }
  }
})();
