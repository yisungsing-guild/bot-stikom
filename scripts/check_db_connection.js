(async function(){
  try{
    require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env.local' });
    const prisma = require('../src/db');
    const res = await prisma.$queryRawUnsafe('select 1 as v');
    console.log('DB_OK', JSON.stringify(res));
    await prisma.$disconnect();
  }catch(e){
    console.error('DB_ERR', e && e.message ? e.message : String(e));
    process.exit(2);
  }
})();
