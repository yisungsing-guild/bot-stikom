const prisma = require('./src/db');
(async () => {
  const terms = ['Manajemen', 'Informatika', 'kurikulum', 'mata kuliah', 'semester'];
  const filenameRows = await prisma.trainingData.findMany({
    where: {
      OR: terms.map(term => ({ filename: { contains: term, mode: 'insensitive' } }))
    },
    select: { id: true, filename: true, source: true, divisionKey: true, createdAt: true },
    take: 200
  });
  console.log('filename term rows', filenameRows.length);
  filenameRows.forEach(r => console.log('ID', r.id, 'filename', r.filename, 'source', r.source, 'divisionKey', r.divisionKey, 'createdAt', r.createdAt));

  const contentRows = await prisma.trainingData.findMany({
    where: {
      content: { contains: 'Manajemen Informatika', mode: 'insensitive' }
    },
    select: { id: true, filename: true, source: true, divisionKey: true, createdAt: true },
    take: 200
  });
  console.log('content phrase rows', contentRows.length);
  contentRows.forEach(r => console.log('ID', r.id, 'filename', r.filename, 'source', r.source, 'divisionKey', r.divisionKey, 'createdAt', r.createdAt));
  await prisma.$disconnect();
})();
