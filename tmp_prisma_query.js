const prisma = require('./src/db');
(async () => {
  try {
    const rows = await prisma.trainingData.findMany({
      where: { storedFilename: { not: null } },
      select: { id: true, filename: true, storedFilename: true, source: true, ragIngestStatus: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error('ERR', e && e.message ? e.message : e);
  } finally {
    await prisma.$disconnect();
  }
})();
