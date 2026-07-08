const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('src/routes/provider.js', 'utf8');
const tokenizer = acorn.tokenizer(text, { ecmaVersion: 2022, locations: true });
let depth = 0;
let tok;
try {
  while ((tok = tokenizer.getToken()).type.label !== 'eof') {
    if (tok.type.label === '{') depth++;
    if (tok.type.label === '}') {
      depth--;
      if (depth < 0) {
        console.log('NEGATIVE', tok.loc.start.line, tok.loc.start.column);
        process.exit(1);
      }
    }
  }
  console.log('END', depth);
} catch (e) {
  console.error('ERROR', e.message);
  if (e.loc) console.error('LOC', e.loc.line, e.loc.column);
  process.exit(1);
}
