const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const destDir = path.join(ROOT, 'quarantined_backups', String(Date.now()));
fs.mkdirSync(destDir, { recursive: true });

const patterns = [
  '**/*.bak',
  '**/*.bak2',
  'src/data/*.bak*',
  'tmp/**',
  'temp_*',
  'temp-*.json',
  'backups/**',
  'e2e-provider-output.txt',
  'jest-output.json',
  'temp_*.txt'
];

const glob = require('glob');

function moveMatched(pattern) {
  const matches = glob.sync(pattern, { cwd: ROOT, dot: true, nodir: false, absolute: true });
  for (const m of matches) {
    const rel = path.relative(ROOT, m);
    const target = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.renameSync(m, target);
      console.log('[archive_artifacts] Moved', rel, '→', path.relative(ROOT, target));
    } catch (err) {
      console.warn('[archive_artifacts] Failed to move', rel, err.message);
    }
  }
}

(async function main(){
  console.log('[archive_artifacts] Archiving artifacts to', destDir);
  for (const p of patterns) moveMatched(p);
  console.log('[archive_artifacts] Done. Review quarantined files in', destDir);
})();
