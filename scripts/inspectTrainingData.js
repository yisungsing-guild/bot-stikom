const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const ids = process.argv.slice(2).filter(Boolean);
    if (ids.length === 0) {
      console.log('Usage: node scripts/inspectTrainingData.js <trainingId...>');
      process.exit(2);
    }

    const keywords = [
      'potongan',
      'diskon',
      'beasiswa',
      'prestasi',
      'juara',
      'nasional',
      'regional',
      'internasional',
      '%',
      'rp',
      'rupiah'
    ];

    for (const id of ids) {
      const row = await prisma.trainingData.findUnique({ where: { id } });
      console.log(`\n=== ${id} ===`);
      if (!row) {
        console.log('NOT FOUND');
        continue;
      }

      const content = row.content || '';
      const lower = content.toLowerCase();
      console.log('filename:', row.filename);
      console.log('source:', row.source, 'active:', row.active);
      console.log('content length:', content.length);
      for (const k of keywords) {
        const idx = lower.indexOf(k);
        console.log(`${k}:`, idx >= 0 ? `FOUND@${idx}` : '--');
      }

      const around = (needle) => {
        const i = lower.indexOf(needle);
        if (i < 0) return null;
        return content.substring(Math.max(0, i - 200), Math.min(content.length, i + 600));
      };

      const snippets = [
        around('potongan'),
        around('beasiswa'),
        around('nasional'),
        around('internasional'),
        around('prestasi'),
        around('juara')
      ].filter(Boolean);

      if (snippets.length > 0) {
        console.log('\n--- snippets ---');
        for (const s of snippets.slice(0, 3)) {
          console.log(s);
          console.log('---');
        }
        console.log('--- end ---');
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
