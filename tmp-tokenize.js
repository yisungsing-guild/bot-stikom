const fs = require('fs');
const acorn = require('acorn');
const text = fs.readFileSync('src/routes/provider.js','utf8');
const lines = text.split(/\r?\n/);
const snippet = lines.slice(1042,1092).join('\n');
const tokenizer = acorn.tokenizer(snippet, {ecmaVersion:'latest', locations:true, sourceType:'module'});
let tok;
while((tok = tokenizer.getToken()).type.label !== '$end') {
  console.log(tok.loc.line, tok.type.label, tok.value ? JSON.stringify(tok.value) : '');
}
