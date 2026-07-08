const fs = require('fs');

const p = 'src/routes/provider.js';
let s = fs.readFileSync(p, 'utf8');

const old = "/[^-\u007f\\p{L}\\p{N}\\s]/gu";
const neu = "/[^\\x00-\\x7F\\p{L}\\p{N}\\s]/gu";

const beforeCount = (s.match(new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
if (beforeCount === 0) {
  console.error('[patch-provider-asciiRange] Pattern not found; aborting');
  process.exit(1);
}

s = s.split(old).join(neu);
fs.writeFileSync(p, s, 'utf8');
console.log('[patch-provider-asciiRange] patched', beforeCount, 'occurrences');
