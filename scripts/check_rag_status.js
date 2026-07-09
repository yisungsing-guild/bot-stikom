(async ()=>{
  try{
    const path = require('path');
    const fs = require('fs');
    const rag = require(path.join(__dirname, '..', 'src','engine','ragEngine'));
    const prisma = (()=>{try{return require(path.join(__dirname,'..','src','db'));}catch(e){return null;}})();

    const indexPath = rag.getIndexPath();
    console.log('indexPath=', indexPath);

    let index = [];
    try{ index = await rag.loadIndex(); } catch(e){ console.error('loadIndex failed', e && e.message); index = []; }
    console.log('indexCount=', Array.isArray(index)? index.length : 0);
    const sampleFiles = Array.from(new Set((index||[]).map(i=> i && i.filename ? i.filename : null).filter(Boolean))).slice(0,20);
    console.log('sampleFiles=', sampleFiles.slice(0,10));

    try{
      const stat = fs.statSync(indexPath);
      console.log('indexSizeBytes=', stat.size);
    }catch(e){ console.log('index file stat failed:', e && e.message); }

    if(prisma && prisma.trainingData && typeof prisma.trainingData.count === 'function'){
      try{
        const total = await prisma.trainingData.count();
        const active = await prisma.trainingData.count({ where: { active: true } });
        console.log('trainingTotal=', total, 'trainingActive=', active);
      }catch(e){ console.log('prisma count failed:', e && e.message); }
    } else {
      console.log('prisma trainingData.count not available; skipping DB counts');
    }

    // Check a few retrieval signals for fee/accreditation/double-degree
    const hasTuitionChunks = (index||[]).some(it => (it && it.metadata && String(it.metadata.category||'').toLowerCase().includes('tuition')) || (it && it.filename && /rincian Biaya/i.test(it.filename)));
    console.log('hasTuitionChunks=', !!hasTuitionChunks);
    const hasAccredChunks = (index||[]).some(it=> (it && it.metadata && String(it.metadata.category||'').toLowerCase().includes('accredit')) || (it && it.chunk && /akreditasi/i.test(it.chunk)));
    console.log('hasAccreditationChunks=', !!hasAccredChunks);
    const hasDoubleDegree = (index||[]).some(it => (it && it.metadata && String(it.metadata.category||'').toLowerCase().includes('double')) || (it && it.filename && /double_degree/i.test(it.filename)) || (it && it.chunk && /double degree|double-degree|dual degree|dnui|utb/i.test(it.chunk)));
    console.log('hasDoubleDegreeChunks=', !!hasDoubleDegree);

  }catch(e){
    console.error('ERROR', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
