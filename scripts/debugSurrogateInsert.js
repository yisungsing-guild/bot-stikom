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
    const bad = 'A\uD800B'; // unpaired surrogate
    await prisma.trainingData.create({
      data: {
        filename: 'surrogate-test.txt',
        content: bad,
        source: 'manual',
        active: true,
      },
      select: { id: true },
    });
    console.log('Insert succeeded (surrogate accepted by driver/DB)');
  } catch (err) {
    try {
      console.log(JSON.stringify(pick(err), null, 2));
    } catch {
      console.log('Error (non-serializable):', err && err.message ? String(err.message) : String(err));
    }
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore
    }
  }
})();
