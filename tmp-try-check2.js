const fs = require('fs');
const text = fs.readFileSync('src/routes/provider.js','utf8');
const lines = text.split(/\r?\n/);
const snippet = lines.slice(788,1094).join('\n');
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
  const lineNo = i + 789;
  if (/\btry\b/.test(line)) {
    tryStack.push({line: lineNo, braceAtStart: brace});
    console.log('push try', lineNo, 'braceAtStart', brace);
  }
  if (/\}\s*catch\s*\(/.test(line)) {
    const lastTry = tryStack[tryStack.length - 1];
    console.log('catch at', lineNo, 'current brace', brace, 'lastTry', lastTry);
    tryStack.pop();
  }
  for (const ch of line) {
    if (ch === '{') brace++;
    if (ch === '}') brace--;
  }
}
console.log('final brace', brace);
console.log('remaining tryStack', JSON.stringify(tryStack));
