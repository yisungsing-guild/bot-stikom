const fs = require('fs');
const path = require('path');

function parseFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error('Source not found', src);
    return;
  }
  // Try utf8 first, then utf16le
  let raw = null;
  try { raw = fs.readFileSync(src, 'utf8'); } catch (e) { raw = null; }
  if (!raw || raw.indexOf('{') === -1) {
    try { raw = fs.readFileSync(src, 'utf16le'); } catch (e) { raw = fs.readFileSync(src, 'latin1'); }
  }
  const objs = [];
  const re = /\{[\s\S]*?\n\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const s = m[0];
    try {
      const j = JSON.parse(s);
      objs.push(j);
    } catch (e) {
      // ignore parse errors
    }
  }
  fs.writeFileSync(dest, JSON.stringify(objs, null, 2), 'utf8');
  console.log('Wrote', dest, 'entries:', objs.length);
}

const base = path.join(__dirname);
parseFile(path.join(base, 'audit_before.txt'), path.join(base, 'audit_before_parsed.json'));
parseFile(path.join(base, 'audit_after.txt'), path.join(base, 'audit_after_parsed.json'));
