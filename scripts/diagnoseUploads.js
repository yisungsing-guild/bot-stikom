const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const cwd = process.cwd();
const prodLocal = path.join(cwd, '.env.production.local');
const prod = path.join(cwd, '.env.production');
let used = null;
if (fs.existsSync(prodLocal)) {
  dotenv.config({ path: '.env.production.local' });
  used = '.env.production.local';
} else if (fs.existsSync(prod)) {
  dotenv.config({ path: '.env.production' });
  used = '.env.production';
} else {
  dotenv.config({ path: '.env' });
  used = '.env';
}

function redactDatabaseUrl(u) {
  if (!u) return '(unset)';
  return String(u).replace(/:[^:@]+@/, ':<redacted>@');
}

console.log('dotenv_used=', used);
console.log('DATABASE_URL=', redactDatabaseUrl(process.env.DATABASE_URL || null));

function listDir(dir) {
  try {
    const files = fs.readdirSync(dir);
    console.log(`DIR ${path.relative(cwd, dir)} exists, count=${files.length}`);
    files.slice(0, 200).forEach(f => console.log('  -', f));
  } catch (e) {
    console.log(`DIR ${path.relative(cwd, dir)} missing`);
  }
}

const uploadsRoot = path.join(cwd, 'uploads');
listDir(uploadsRoot);
listDir(path.join(uploadsRoot, 'validation'));
listDir(path.join(uploadsRoot, 'public-media'));

// Try DB queries via Prisma
try {
  const prisma = require('../src/db');
  (async () => {
    try {
      console.log('Attempting DB connectivity test (SELECT 1)');
      try {
        // Basic raw query to test connection
        await prisma.$queryRaw`SELECT 1`;
        console.log('DB connectivity: OK (SELECT 1 returned)');
      } catch (e) {
        console.error('DB connectivity test failed:', e && e.message ? e.message : String(e));
        try { await prisma.$disconnect(); } catch(_){}
        return process.exit(0);
      }

      // Query trainingData for common division keys
      const keys = ['akademik','keuangan','kerjasama','international','pmb','ui'];
      try {
        const rows = await prisma.trainingData.findMany({
          where: { divisionKey: { in: keys } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            filename: true,
            divisionKey: true,
            source: true,
            uploadedBy: { select: { id: true, username: true, role: true, displayName: true } },
            createdAt: true
          }
        });
        console.log('TRAINING rows:', rows.length);
        rows.slice(0,50).forEach(r => console.log(JSON.stringify(r)));
      } catch (e) {
        console.error('TRAINING query failed:', e && e.message ? e.message : String(e));
      }

      // Query audit logs for validation uploads
      try {
        const logs = await prisma.adminAuditLog.findMany({
          where: { action: 'upload_validation_file' },
          orderBy: { createdAt: 'desc' },
          take: 100
        });
        console.log('UPLOAD_VALIDATION logs:', logs.length);
        logs.slice(0,50).forEach(l => console.log(JSON.stringify({id: l.id, username: l.username, createdAt: l.createdAt, details: l.details ? { filename: l.details.filename, originalname: l.details.originalname } : null })));
      } catch (e) {
        console.error('AUDIT query failed:', e && e.message ? e.message : String(e));
      }

    } catch (err) {
      console.error('Unexpected diag error:', err && err.message ? err.message : String(err));
    } finally {
      try { await prisma.$disconnect(); } catch (_) {}
      process.exit(0);
    }
  })();
} catch (e) {
  console.error('Prisma client load failed:', e && e.message ? e.message : String(e));
  process.exit(0);
}
