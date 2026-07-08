require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log('[Reset] Deleting all trainingData rows...');
    const result = await prisma.trainingData.deleteMany({});
    console.log(`[Reset] Deleted ${result.count} trainingData rows.`);
  } catch (err) {
    console.error('[Reset] Error while deleting trainingData:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
