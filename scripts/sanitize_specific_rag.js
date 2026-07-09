const { getRagIndexPath } = require('../src/utils/ragPaths');
const fs = require('fs');
const path = require('path');
const filePath = getRagIndexPath();
const backupPath = filePath + '.bak2';
if (!fs.existsSync(filePath)) {
  console.error('rag_index.json not found at', filePath);
  process.exit(2);
}
console.log('Reading', filePath);
let s = fs.readFileSync(filePath, 'utf8');
fs.writeFileSync(backupPath, s, 'utf8');
console.log('Backup written to', backupPath);
const replacements = [
  // robust patterns allowing newlines or non-word separators between tokens
  {re: /SMK\W{0,50}?TI\W{0,50}?Bali\W{0,50}?Global/gi, to: 'Silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus'},
  {re: /SMK\W{0,50}?Pandawa\W{0,50}?Bali\W{0,50}?Global/gi, to: 'Silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus'},
  {re: /SMK\s*TI/gi, to: 'SMK (hubungi PMB untuk detail)'},
  {re: /SMK\s*Pandawa/gi, to: 'SMK (hubungi PMB untuk detail)'},
  {re: /sekolah\W{0,50}?tertentu/gi, to: 'Silakan hubungi PMB untuk informasi sekolah yang mendapatkan potongan atau beasiswa khusus'},
  {re: /ΓÇó/g, to: '-'},
  {re: /ΓÇ—/g, to: '-'},
  {re: /ΓÇª/g, to: '...'},
  {re: /ΓÇ£/g, to: '"'},
  {re: /ΓÇ¥/g, to: '"'},
  {re: /ΓÇÿ/g, to: "'"},
  {re: /ΓÇÖ/g, to: "'"}
];
let count = 0;
for (const r of replacements) {
  const matches = s.match(r.re);
  if (matches) count += matches.length;
  s = s.replace(r.re, r.to);
}
fs.writeFileSync(filePath, s, 'utf8');
console.log('Sanitized file written. Total replacements approx:', count);
console.log('Done.');
