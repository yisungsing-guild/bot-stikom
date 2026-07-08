const fs = require('fs');
const path = require('path');
const fp = path.join(__dirname, 'backups', 'backup-20260424-145106', 'trainingData.json');
if (!fs.existsSync(fp)) {
  console.error('Backup trainingData.json not found:', fp);
  process.exit(1);
}
const raw = fs.readFileSync(fp, 'utf8');
const obj = JSON.parse(raw);
const rows = Array.isArray(obj.rows) ? obj.rows : [];
const miRows = rows.filter(r => {
  const file = String(r.filename || r.source || '').toLowerCase();
  const content = String(r.content || '').toLowerCase();
  return file.includes('manajemen') || file.includes('mi') || content.includes('manajemen informatika') || content.includes('program studi manajemen informatika');
});
console.log('MI-related rows count:', miRows.length);
const byFile = new Map();
for (const r of miRows) {
  const file = r.filename || r.source || 'N/A';
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(r);
}
for (const [file, items] of byFile.entries()) {
  console.log('FILE:', file, 'count:', items.length, 'source:', items[0].source || 'N/A');
}
