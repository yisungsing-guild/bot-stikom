const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, 'src', 'data', 'rag_index.json');
const raw = fs.readFileSync(p, 'utf8');
const norm = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');

const rowRegex = /(?:^|\n)\s*(KHUSUS|SISIPAN\s*[0-9]{1,2}|[IVX]{1,6}\s*[A-C])\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^\n]*?s\s*\/\s*d[^\n]*)/gi;
let m; const keys = [];
while ((m = rowRegex.exec(norm)) !== null) {
  const key = String(m[1] || '').trim();
  keys.push(key);
}
console.log('Found keys (strict regex):', keys.slice(0,50));

// fallback regex
const altRowRegex = /(?:^|\n)\s*(KHUSUS|SISIPAN\s*[0-9]{1,2}|[IVX]{1,6}\s*[A-C])\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^\n]+)/gi;
let n; const altKeys = [];
while ((n = altRowRegex.exec(norm)) !== null) {
  const key = String(n[1] || '').trim();
  altKeys.push(key);
}
console.log('Found keys (fallback regex):', altKeys.slice(0,50));

// Check for II C and II A etc
['II A','II B','II C','III C','2C','2 C'].forEach(k => {
  console.log(k, 'strict:', keys.includes(k), 'fallback:', altKeys.includes(k));
});
