const prisma = require('./src/db');

(async () => {
  try {
    await prisma.$connect();
    const row = await prisma.trainingData.create({
      data: {
        filename: 'test-upload-check.txt',
        content: 'hello',
        source: 'upload',
        active: true,
      },
    });
    console.log('created', row.id);
    await prisma.trainingData.delete({ where: { id: row.id } });
  } catch (e) {
    console.error('ERR', e && e.code, e && e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
