// Check training data state in the database
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTraining() {
  try {
    const totalCount = await prisma.trainingData.count();
    const activeCount = await prisma.trainingData.count({ where: { active: true } });
    
    console.log('Training Data Status:');
    console.log('  Total:', totalCount);
    console.log('  Active:', activeCount);
    
    // Get sample of inactive training
    const inactiveCount = totalCount - activeCount;
    console.log('  Inactive:', inactiveCount);
    
    if (inactiveCount > 0) {
      const sample = await prisma.trainingData.findMany({ where: { active: false }, take: 3 });
      console.log('\nSample Inactive Training Rows:');
      for (const row of sample) {
        console.log(`  - ID: ${row.id}, Source: ${row.source}, Active: ${row.active}`);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkTraining();
