const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

(async ()=>{
  try{
    const rows = await prisma.trainingData.findMany({
      where: { filename: { contains: 'kalender', mode: 'insensitive' } },
      select: { id: true, filename: true, storedFilename: true, uploadedById: true, createdAt: true }
    });

    if (!rows || rows.length === 0) {
      console.log('NO_ROWS_FOUND');
      await prisma.$disconnect();
      process.exit(0);
    }

    const results = rows.map(r => {
      const sf = r.storedFilename || null;
      let exists = false;
      if (sf) {
        const p = path.isAbsolute(sf) ? sf : path.join(process.cwd(), sf);
        exists = fs.existsSync(p);
      }
      return { id: r.id, filename: r.filename, storedFilename: sf, fileExists: exists, createdAt: r.createdAt, uploadedById: r.uploadedById };
    });

    console.log(JSON.stringify(results, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  }catch(err){
    console.error('ERROR', err && err.message ? err.message : String(err));
    try{ await prisma.$disconnect(); }catch(e){}
    process.exit(2);
  }
})();
