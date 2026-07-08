/* eslint-disable no-console */

require('dotenv').config({ path: '.env.production' });

const { PrismaClient } = require('@prisma/client');

function pick(err) {
  return {
    name: err?.name,
    code: err?.code,
    message: String(err?.message || '').slice(0, 800),
    meta: err?.meta,
  };
}

(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.trainingData.create({
      data: {
        filename: 'no-active-test.txt',
        content: 'hello',
        source: 'upload',
        // intentionally omit `active`
        uploadedById: null,
        divisionKey: null,
      },
      select: { id: true },
    });
    console.log('Insert succeeded (DB has default for active)');
  } catch (err) {
    console.log(JSON.stringify(pick(err), null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
