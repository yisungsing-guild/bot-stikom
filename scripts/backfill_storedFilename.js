const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');
const { sanitizeFilename } = require('../src/middleware/uploadSecurity');

function ts(){
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function findCandidatesFor(basename){
  const uploadsDirs = [
    path.join(process.cwd(),'uploads'),
    path.join(process.cwd(),'uploads','public-media'),
    path.join(process.cwd(),'uploads','training'),
  ];
  const candidates = [];
  for (const d of uploadsDirs){
    if (!fs.existsSync(d)) continue;
    const files = fs.readdirSync(d).filter(f => fs.statSync(path.join(d,f)).isFile());
    for (const f of files){
      const candidateName = path.basename(f, path.extname(f)).toLowerCase();
      const b = basename.toLowerCase();
      // prefer startsWith '<sanitizedBase>-' (multer naming), fall back to includes
      if (candidateName.startsWith(b + '-') || candidateName === b || candidateName.includes(b)){
        candidates.push({dir: d, file: f, full: path.join(d,f), mtime: fs.statSync(path.join(d,f)).mtimeMs});
      }
    }
  }
  return candidates.sort((a,b)=>b.mtime-a.mtime);
}

(async ()=>{
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const dryRun = !apply;
  console.log('BACKFILL_MODE:' + (apply ? 'APPLY' : 'DRY-RUN'));

  try{
    const rows = await prisma.trainingData.findMany({ where: { storedFilename: null } });
    console.log('ROWS_TO_CHECK:', rows.length);
    const updates = [];
    for (const r of rows){
      const orig = r.filename || '';
      const sanitized = sanitizeFilename(orig || '');
      const ext = path.extname(sanitized) || path.extname(orig || '');
      const base = path.basename(sanitized, ext);
      if (!base){
        updates.push({ id: r.id, found: false, reason: 'no-filename' });
        continue;
      }
      const candidates = await findCandidatesFor(base);
      if (candidates.length === 0){
        updates.push({ id: r.id, found: false, reason: 'no-candidate' });
        continue;
      }
      const chosen = candidates[0];
      updates.push({ id: r.id, found: true, chosen: path.relative(process.cwd(), chosen.full) });
    }

    // summary
    const toApply = updates.filter(u=>u.found);
    console.log('\nDRY_SUMMARY: total=', updates.length, 'matched=', toApply.length);
    toApply.slice(0,50).forEach(u=> console.log('  >', u.id, '->', u.chosen));

    if (apply){
      console.log('\nAPPLYING_UPDATES:', toApply.length);
      for (const u of toApply){
        const p = u.chosen;
        // store path relative to project (keep forward slashes)
        const storedFilename = p.replace(/\\/g,'/');
        try{
          await prisma.trainingData.update({ where: { id: u.id }, data: { storedFilename } });
          console.log('UPDATED:', u.id, '=>', storedFilename);
        }catch(err){
          console.error('UPDATE_ERROR', u.id, err && err.message ? err.message : String(err));
        }
      }
      console.log('APPLY_DONE');
    }else{
      console.log('\nDry-run complete. To apply updates run:');
      console.log('  node scripts/backfill_storedFilename.js --apply');
    }

    await prisma.$disconnect();
    process.exit(0);
  }catch(err){
    console.error('BACKFILL_ERROR', err && err.message ? err.message : String(err));
    try{ await prisma.$disconnect(); }catch(e){}
    process.exit(2);
  }
})();
