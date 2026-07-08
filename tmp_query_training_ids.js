const prisma = require('./src/db');
(async () => {
  const ids = ['adf4dce8-718f-4b93-a45e-503a97fd4b36','eee828da-6ee4-4591-a9a8-18fa2e73c822','15995f66-7b49-4954-93c3-6616b62f0dc5','762c5ebc-bfde-48d3-a314-85a17bc931ee','66bcaec6-88a7-4ac2-8ae4-660bd3084393','865ee469-8ded-4753-896f-a70d827ccf1d'];
  for (const id of ids) {
    const row = await prisma.trainingData.findUnique({ where: { id } });
    console.log('ID', id, 'found', !!row);
    if (row) {
      console.log(' filename:', row.filename, 'source:', row.source, 'divisionKey:', row.divisionKey, 'createdAt:', row.createdAt, 'content length:', (row.content||'').length);
    }
  }
  await prisma.$disconnect();
})();
