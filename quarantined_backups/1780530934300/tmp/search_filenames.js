const fs = require('fs');
const path = require('path');
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}
const root = path.resolve(__dirname, '..');
const matches = walk(root).filter(p => /manajemen|Manajemen|MI|mi/.test(path.basename(p)));
matches.sort().forEach(p => console.log(p));
console.log('count', matches.length);
