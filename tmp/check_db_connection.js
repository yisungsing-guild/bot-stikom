require('dotenv').config();
const prisma = require('../src/db');
(async () => {
  try {
    const hasUrl = !!process.env.DATABASE_URL;
    const n = await prisma.trainingData.count();
    console.log(JSON.stringify({ hasDatabaseUrl: hasUrl, reachable: true, trainingDataCount: n }));
  } catch (e) {
    console.log(JSON.stringify({ hasDatabaseUrl: !!process.env.DATABASE_URL, reachable: false, error: e.code || e.name || 'Error' }));
  } finally {
    if (prisma.$disconnect) await prisma.$disconnect();
  }
})();
