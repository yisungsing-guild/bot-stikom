const { query } = require('../src/engine/ragEngine');
(async()=>{
  const snippets = [
    `Penjelasan Prodi dan Karier Masa Depan\nProdi | Penjelasan prodi | Yang Dipelajari | Cocok Untuk | Peluang Kerja\nSistem Informasi | \"Program Studi Sistem Informasi menghasilkan lulusan yang memiliki ko\"`,
    `an manajemen | \"Business Analyst | System Analyst | IT Consultant | Project Manager | ERP Specialist | Product Manager | Data Analyst\"\nSistem Komputer | \"Program Studi Sistem Komputer menghasilkan lul\"`,
    `knis\" | \"IoT Engineer | Hardware Engineer | Robotics Engineer | Network Engineer | Automation Engineer | Embedded System Engineer\"\nBisnis Digital | \"Program studi ini menjadikan peserta didik memahami\"`
  ];
  for(const s of snippets){
    console.log('--- QUERY ---');
    console.log(s.slice(0,200));
    try{
      const r = await query(s, 10);
      console.log('contexts count=', (r && r.contexts && r.contexts.length));
      if (r && r.contexts) {
        console.log(r.contexts.map((c,i)=>({rank:i+1,filename:c.filename,docCategory:c.docCategory,program:c.program||null,first200:c.chunk?c.chunk.slice(0,200).replace(/\n/g,'\\n'):null,score:c.score||c.semanticScore||null})));    
      } else console.log({res:r});
    }catch(e){
      console.error('QUERY_ERROR', e && e.message ? e.message : String(e));
    }
  }
})();
