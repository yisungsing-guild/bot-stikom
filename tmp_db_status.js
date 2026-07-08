require('dotenv').config({ path: '.env.local', override: true });
const prisma = require('./src/db');

(async () => {
  try {
    const totalActive = await prisma.trainingData.count({ where: { active: true } });
    const totalUpload = await prisma.trainingData.count({ where: { active: true, source: 'upload' } });
    const sample = await prisma.trainingData.findFirst({ where: { active: true }, select: { id: true, filename: true, source: true, divisionKey: true, createdAt: true } });
    const totalUploadSample = await prisma.trainingData.findFirst({ where: { active: true, source: 'upload' }, select: { id: true, filename: true, source: true, divisionKey: true, createdAt: true } });
    console.log(JSON.stringify({ totalActive, totalUpload, sample, totalUploadSample }, null, 2));
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
