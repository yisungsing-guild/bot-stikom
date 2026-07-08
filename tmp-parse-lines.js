const fs = require('fs');
const acorn = require('acorn');
const lines = fs.readFileSync('src/routes/provider.js','utf8').split(/\r?\n/);
const start = 788;
for (let end = start + 1; end <= 1092; end++) {
  const snippet = lines.slice(start, end).join('\n');
  const wrapped = `async function tmp(){\n${snippet}\n} catch (e) { throw e }`;
  try {
    acorn.parse(wrapped, { ecmaVersion: 'latest', sourceType: 'module' });
    console.log('valid at', end, 'actual line', end + 1);
    break;
  } catch (e) {
    // if still invalid, continue
  }
}
