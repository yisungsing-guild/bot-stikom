const fs = require('fs').promises;
const path = require('path');

async function copyRecursive(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  try {
    const projectRoot = path.join(__dirname, '..');
    const uploadsDir = path.join(projectRoot, 'uploads');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.join(projectRoot, 'backups', `uploads-backup-${timestamp}`);

    console.log('Backing up', uploadsDir, 'to', backupDir);

    // Ensure uploads exists
    try {
      await fs.access(uploadsDir);
    } catch (e) {
      console.error('Uploads directory not found:', uploadsDir);
      process.exit(1);
    }

    await copyRecursive(uploadsDir, backupDir);
    console.log('Backup completed:', backupDir);
  } catch (err) {
    console.error('Error during backup:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}
