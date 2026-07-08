const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const cwd = process.cwd();
if (fs.existsSync(path.join(cwd, '.env.production.local'))) dotenv.config({ path: '.env.production.local' });
else if (fs.existsSync(path.join(cwd, '.env.production'))) dotenv.config({ path: '.env.production' });
else dotenv.config({ path: '.env' });

(async () => {
  try {
    const db = require('../src/db');
    const total = await db.trainingData.count().catch(() => null);
    console.log('trainingData total:', total);

    const recent = await db.trainingData.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        filename: true,
        divisionKey: true,
        source: true,
        uploadedBy: { select: { username: true, role: true, displayName: true } },
        createdAt: true
      }
    }).catch(() => null);

    if (Array.isArray(recent)) {
      console.log('recent trainingData sample:', JSON.stringify(recent, null, 2));
    } else {
      console.log('recent trainingData sample: null (possible schema mismatch)');
    }

    await db.$disconnect();
  } catch (e) {
    console.error('Error checking training counts:', e && e.message ? e.message : String(e));
    try { const db = require('../src/db'); await db.$disconnect(); } catch(_){}
  }
})();
