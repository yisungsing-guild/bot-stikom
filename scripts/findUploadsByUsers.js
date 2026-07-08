const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const cwd = process.cwd();
if (fs.existsSync(path.join(cwd, '.env.production.local'))) dotenv.config({ path: '.env.production.local' });
else if (fs.existsSync(path.join(cwd, '.env.production'))) dotenv.config({ path: '.env.production' });
else dotenv.config({ path: '.env' });

(async () => {
  try {
    const db = require('../src/db');
    const users = ['akademik','ui','kerjasama','keuangan','direktur','pmb'];
    for (const u of users) {
      try {
        const rows = await db.trainingData.findMany({
          where: { uploadedBy: { is: { username: u } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: { id: true, filename: true, divisionKey: true, source: true, uploadedBy: { select: { username: true, role: true, displayName: true } }, createdAt: true }
        }).catch(() => null);
        const count = Array.isArray(rows) ? rows.length : 0;
        console.log(`USER ${u}: ${count}`);
        if (Array.isArray(rows) && rows.length > 0) {
          rows.slice(0,10).forEach(r => console.log(JSON.stringify(r)));
        }
      } catch (e) {
        console.error(`Error for user ${u}:`, e && e.message ? e.message : String(e));
      }
    }

    // Also check adminAuditLog entries by username
    try {
      const logs = await db.adminAuditLog.findMany({ where: { username: { in: users } }, orderBy: { createdAt: 'desc' }, take: 200 });
      console.log('Audit logs for users count:', logs.length);
      logs.slice(0,20).forEach(l => console.log(JSON.stringify({id: l.id, username: l.username, action: l.action, details: l.details, createdAt: l.createdAt})));
    } catch (e) {
      console.error('Audit log query error:', e && e.message ? e.message : String(e));
    }

    await db.$disconnect();
  } catch (e) {
    console.error('Unexpected:', e && e.message ? e.message : String(e));
    try { const db = require('../src/db'); await db.$disconnect(); } catch(_){}
  }
})();
