const fs = require('fs');
const path = require('path');
const { getRagIndexPath, getRagMergedIndexPath, resolveFromProjectRoot } = require('../src/utils/ragPaths');
const activePath = getRagIndexPath();
const backupPath = process.env.RAG_MERGE_BACKUP_PATH ? resolveFromProjectRoot(process.env.RAG_MERGE_BACKUP_PATH) : path.resolve(__dirname, '..', 'quarantined_backups', '1780530934300', 'src', 'data', 'rag_index.json.bak');
const outPath = getRagMergedIndexPath();

function load(p) {
  try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch(e){ console.error('ERR load',p,e.message); process.exit(2);} }

const active = load(activePath);
const backup = load(backupPath);

const byId = new Map();
const byFilename = new Map();

for (const e of active) {
  if (e.id) byId.set(e.id, e);
  if (e.filename) byFilename.set(e.filename, e);
}

const added = [];
for (const e of backup) {
  if (!e) continue;
  if (e.id && byId.has(e.id)) continue;
  if (e.filename && byFilename.has(e.filename)) continue;
  // otherwise add
  const newId = e.id || ('bak-'+Math.random().toString(36).slice(2,10));
  const copy = Object.assign({}, e, { id: newId });
  if (copy.filename) byFilename.set(copy.filename, copy);
  if (copy.id) byId.set(copy.id, copy);
  added.push(copy);
}

const merged = active.concat(added);
fs.writeFileSync(outPath, JSON.stringify(merged,null,2), 'utf8');
console.log('activeCount', active.length);
console.log('backupCount', backup.length);
console.log('addedCount', added.length);
console.log('mergedCount', merged.length);
console.log('addedFiles:', added.filter(x=>x.filename).map(x=>x.filename));

// check presence of target PDFs
const targets = [
  'rincian Biaya SI, TI dan BD Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya D3 Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya SK Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya UTB Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya DNUI Tahun Ajaran 2026-2027.pdf',
  'rincian Biaya HELP Tahun Ajaran 2026-2027.pdf'
];
const foundTargets = {};
for (const t of targets) foundTargets[t]=false;
for (const e of merged) {
  if (!e) continue;
  for (const t of targets) {
    if ((e.filename && e.filename.includes(t)) || (e.chunk && e.chunk.includes(t))) foundTargets[t]=true;
  }
}
console.log('foundTargets', foundTargets);
console.log('done');
