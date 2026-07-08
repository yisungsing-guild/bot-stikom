(async()=>{
  try{
    const path = require('path');
    const rag = require(path.join(__dirname,'..','src','engine','ragEngine'));

    const queries = [
      'berapa rincian biaya Sistem Informasi',
      'apa akreditasi program Sistem Informasi',
      'apakah ada double degree untuk Sistem Informasi',
      'berapa rincian biaya bisnis digital gelombang 1',
      'rincian Biaya SK gelombang 3A'
    ];

    for(const q of queries){
      try{
        console.log('\n=== QUERY =>', q);
        const res = await rag.query(q, 5, { includeGlobal: true, answerQuestion: q });
        console.log(JSON.stringify(res, null, 2).slice(0, 4000));
      }catch(e){
        console.error('QUERY ERROR', e && e.message ? e.message : e);
      }
    }
  }catch(e){
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
