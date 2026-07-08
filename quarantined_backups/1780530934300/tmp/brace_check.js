const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'routes', 'provider.js');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
let inSingle = false, inDouble = false, inBack = false, inLineComment = false, inBlockComment = false;
let depth = 0;
let startLine = -1;
for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  if (startLine === -1 && line.includes('module.exports = function')) startLine = li + 1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';
    if (inLineComment) break;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBack) {
      if (ch === '/' && next === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === '"') { inDouble = true; continue; }
      if (ch === "'") { inSingle = true; continue; }
      if (ch === '`') { inBack = true; continue; }
    } else if (inSingle) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inSingle = false;
    } else if (inDouble) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inDouble = false;
    } else if (inBack) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') inBack = false;
    }
    if (startLine >= 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0 && li < lines.length - 1) {
        console.log('ZERO at', li + 1, 'line=', line);
        process.exit(0);
      }
      if (depth < 0) {
        console.log('NEGATIVE at', li + 1, 'line=', line);
        process.exit(0);
      }
    }
  }
  inLineComment = false;
}
console.log('final depth', depth, 'startLine', startLine);
