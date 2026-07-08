const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

function ts(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

(async ()=>{
  try{
    const CWD = process.cwd();
    const backupsRoot = path.join(CWD, 'backups');
    if (!fs.existsSync(backupsRoot)) fs.mkdirSync(backupsRoot, { recursive: true });

    // pick latest backup dir if exists
    const dirs = fs.readdirSync(backupsRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ name: d.name, full: path.join(backupsRoot, d.name), mtime: fs.statSync(path.join(backupsRoot, d.name)).mtimeMs }));
    const latest = dirs.sort((a,b) => b.mtime - a.mtime)[0];
    const outDir = latest ? latest.full : path.join(backupsRoot, `export-${ts()}`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    console.log('EXPORT_DIR:' + outDir);

    // Use raw SQL to avoid schema mismatch (we updated prisma schema but DB may not have column yet)
    const training = await prisma.$queryRawUnsafe('SELECT id, filename, content, source, "divisionKey", active, "uploadedById", "createdAt", "updatedAt" FROM "TrainingData"');
    fs.writeFileSync(path.join(outDir, 'trainingData.json'), JSON.stringify({ count: (training && training.length) || 0, rows: training || [] }, null, 2), 'utf8');
    console.log('EXPORTED: trainingData.json ->', (training && training.length) || 0, 'rows');

    const users = await prisma.$queryRawUnsafe('SELECT id, username, "displayName", role, "passwordHash", "createdAt", "updatedAt" FROM "AdminUser"');
    fs.writeFileSync(path.join(outDir, 'adminUsers.json'), JSON.stringify({ count: (users && users.length) || 0, rows: users || [] }, null, 2), 'utf8');
    console.log('EXPORTED: adminUsers.json ->', (users && users.length) || 0, 'rows');

    const audit = await prisma.$queryRawUnsafe('SELECT id, "adminId", username, action, resource, details, ip, "createdAt" FROM "AdminAuditLog" ORDER BY "createdAt" DESC LIMIT 1000');
    fs.writeFileSync(path.join(outDir, 'adminAuditLog.latest-1000.json'), JSON.stringify({ count: (audit && audit.length) || 0, rows: audit || [] }, null, 2), 'utf8');
    console.log('EXPORTED: adminAuditLog.latest-1000.json ->', (audit && audit.length) || 0, 'rows');

    // summary
    const summary = {
      exportedAt: (new Date()).toISOString(),
      trainingCount: training.length,
      adminUserCount: users.length,
      auditSample: audit.length,
    };
    fs.writeFileSync(path.join(outDir, 'export-manifest.json'), JSON.stringify(summary, null, 2), 'utf8');

    await prisma.$disconnect();
    console.log('EXPORT_DONE');
    process.exit(0);
  }catch(err){
    console.error('EXPORT_ERROR', err && err.message ? err.message : String(err));
    try{ await prisma.$disconnect(); }catch(e){}
    process.exit(2);
  }
})();
