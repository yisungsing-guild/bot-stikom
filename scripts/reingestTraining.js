require('dotenv').config();

const prisma = require('../src/db');
const { ingestTrainingData } = require('../src/engine/ragEngine');

async function main() {
  const trainingId = process.argv[2];
  if (!trainingId) {
    console.log('Usage: node scripts/reingestTraining.js <trainingId>');
    process.exit(2);
  }

  const training = await prisma.trainingData.findUnique({ where: { id: trainingId } });
  if (!training) {
    console.error('TrainingData not found:', trainingId);
    process.exit(1);
  }

  console.log('Re-ingesting:', trainingId, 'filename=', training.filename, 'len=', training.content.length);
  const result = await ingestTrainingData(trainingId, training.content, training.source, {
    divisionKey: training.divisionKey || null,
    filename: training.filename,
    uploadedById: training.uploadedById || null
  });
  console.log('Result:', result);
  process.exit(result && result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
