/* eslint-disable no-console */

require('dotenv').config({ path: '.env.production' });

const { PrismaClient } = require('@prisma/client');

function summarizeError(err) {
  return {
    name: err?.name,
    code: err?.code,
    message: String(err?.message || ''),
    meta: err?.meta,
  };
}

(async () => {
  const prisma = new PrismaClient();

  try {
    await prisma.trainingData.create({
      data: {
        filename: 'fk-test.txt',
        content: 'hi',
        source: 'upload',
        active: true,
        uploadedById: 'nonexistent_admin_id',
      },
    });

    console.log('Unexpected: insert succeeded');
  } catch (err) {
    console.log(JSON.stringify(summarizeError(err), null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
