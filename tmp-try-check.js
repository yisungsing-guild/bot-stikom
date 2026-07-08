const fs = require('fs');
const text = fs.readFileSync('src/routes/provider.js','utf8');
const lines = text.split(/\r?\n/);
const snippet = lines.slice(788,1093).join('\n');
let code = snippet.replace(/\/\*[\s\S]*?\*\//g, '');
code = code.replace(/\/\/.*$/gm, '');
code = code.replace(/'(?:\\.|[^'\\])*'/g, '"');
code = code.replace(/\"(?:\\.|[^\"\\])*\"/g, '"');
code = code.replace(/`(?:\\.|[^`\\])*`/g, '"');
let brace = 0;
let tryStack = [];
const linesArr = code.split(/\n/);
for (let i = 0; i < linesArr.length; i++) {
  const line = linesArr[i];
  const idx = i + 789;
  if (/\btry\b/.test(line)) {
    tryStack.push(idx);
  }
  if (/\}\s*catch\s*\(/.test(line)) {
    const tryLine = tryStack.pop();
    console.log('catch at', idx, 'pop try at', tryLine, 'brace before', brace, 'line:', line.trim());
  }
  for (const ch of line) {
    if (ch === '{') brace++;
    if (ch === '}') brace--;
  }
}
console.log('final brace', brace, 'tryStack', tryStack);
