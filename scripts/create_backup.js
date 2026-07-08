const fs = require('fs');
const path = require('path');

function pad(n){ return String(n).padStart(2,'0') }
function ts(){
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

(async function(){
  try{
    const CWD = process.cwd();
    const t = ts();
    const backupDir = path.join(CWD, 'backups', `backup-${t}`);
    fs.mkdirSync(backupDir, { recursive: true });

    const uploadsSrc = path.join(CWD, 'uploads');
    const uploadsDest = path.join(backupDir, 'uploads');

    if (fs.existsSync(uploadsSrc)){
      // Node 16+ has fs.cpSync
      try{
        fs.cpSync(uploadsSrc, uploadsDest, { recursive: true });
        console.log('COPIED_UPLOADS');
      }catch(e){
        // fallback: copy top-level files
        console.warn('Failed to cp uploads recursively:', e.message);
      }
    } else {
      console.log('NO_UPLOADS_DIR');
    }

    const envFiles = ['.env.production', '.env.production.local', '.env'];
    for (const f of envFiles){
      const src = path.join(CWD, f);
      if (fs.existsSync(src)){
        try { fs.copyFileSync(src, path.join(backupDir, f)); console.log('COPIED:'+f); } catch(e){ console.warn('COPY_FAIL:'+f, e.message); }
      }
    }

    // Write a simple manifest
    const manifest = {
      createdAt: (new Date()).toISOString(),
      backupDir: backupDir,
    };
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    console.log('BACKUP_DONE:'+backupDir);
    process.exit(0);
  }catch(err){
    console.error('BACKUP_ERROR', err && err.message ? err.message : String(err));
    process.exit(2);
  }
})();
