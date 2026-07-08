const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('src/routes/provider.js', 'utf8');
const tokenizer = acorn.tokenizer(text, { ecmaVersion: 2022, locations: true, sourceType: 'script' });
let depth = 0;
while (true) {
  const token = tokenizer.getToken();
  if (token.type.label === 'eof') break;
  if (token.type.label === '{') {
    depth++;
  } else if (token.type.label === '}') {
    depth--;
    if (depth < 0) {
      console.log(JSON.stringify({ negativeAt: token.loc.start, token: token.type.label }, null, 2));
      process.exit(0);
    }
  }
}
console.log(JSON.stringify({ finalDepth: depth }, null, 2));
