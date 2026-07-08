const fs = require('fs');
const path = require('path');
function extract(src, dest) {
  if (!fs.existsSync(src)) return console.error('missing', src);
  let raw = fs.readFileSync(src, 'utf16le');
  const re = /\{[\s\S]*?\n\}/g;
  const matches = raw.match(re) || [];
  const objs = [];
  for (const m of matches) {
    try {
      objs.push(JSON.parse(m));
    } catch (e) {
      // try to locate JSON by first { to last }
      try {
        const first = m.indexOf('{');
        const last = m.lastIndexOf('}');
        const s2 = m.slice(first, last+1);
        objs.push(JSON.parse(s2));
      } catch (e2) {
        // skip
      }
    }
  }
  fs.writeFileSync(dest, JSON.stringify(objs, null, 2), 'utf8');
  console.log('extracted', objs.length, 'to', dest);
}

const base = path.join(__dirname);
extract(path.join(base, 'audit_before.txt'), path.join(base, 'audit_before_jsons.json'));
extract(path.join(base, 'audit_after.txt'), path.join(base, 'audit_after_jsons.json'));
