const fs = require('fs');
const acorn = require('acorn');
const lines = fs.readFileSync('src/routes/provider.js','utf8').split(/\r?\n/);
const start = 788;
const ends = [820, 860, 900, 940, 980, 1020, 1060, 1092];
for (const end of ends) {
  const snippet = lines.slice(start, end).join('\n');
  const wrapped = `async function tmp(){\n${snippet}\n} catch (e) { throw e }`;
  try {
    acorn.parse(wrapped, { ecmaVersion: 'latest', sourceType: 'module' });
    console.log('ok end', end);
  } catch (e) {
    console.log('fail end', end, 'msg', e.message, 'loc', e.loc);
  }
}
