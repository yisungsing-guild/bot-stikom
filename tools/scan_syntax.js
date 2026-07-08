const fs = require('fs');
const s = fs.readFileSync('src/engine/ragEngine.js', 'utf8');
let line = 1, col = 0;
let state = 'normal';
let quote = null;
let stack = [];
let paren = [];
let bracket = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  const nxt = s[i + 1] || '';
  if (ch === '\n') {
    line++; col = 0;
    if (state === 'linecomment') state = 'normal';
    continue;
  }
  col++;
  if (state === 'normal') {
    if (ch === '/' && nxt === '*') { state = 'blockcomment'; i++; col++; continue; }
    if (ch === '/' && nxt === '/') { state = 'linecomment'; i++; col++; continue; }
    if (ch === '"' || ch === "'") { state = 'string'; quote = ch; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === '(') { paren.push({line, col}); continue; }
    if (ch === ')') { if (paren.length === 0) { console.error('unmatched ) at', line, col); process.exit(1);} paren.pop(); continue; }
    if (ch === '{') { stack.push({line, col}); continue; }
    if (ch === '}') { if (stack.length === 0) { console.error('unmatched } at', line, col); process.exit(1);} stack.pop(); continue; }
    if (ch === '[') { bracket.push({line, col}); continue; }
    if (ch === ']') { if (bracket.length === 0) { console.error('unmatched ] at', line, col); process.exit(1);} bracket.pop(); continue; }
  } else if (state === 'string') {
    if (ch === quote && s[i-1] !== '\\') { state = 'normal'; quote = null; }
    continue;
  } else if (state === 'template') {
    if (ch === '`' && s[i-1] !== '\\') { state = 'normal'; }
    continue;
  } else if (state === 'blockcomment') {
    if (ch === '*' && nxt === '/') { state = 'normal'; i++; col++; }
    continue;
  } else if (state === 'linecomment') {
    continue;
  }
}
console.log('state', state);
console.log('open braces', stack.length, stack.slice(-3));
console.log('open paren', paren.length, paren.slice(-3));
console.log('open brackets', bracket.length, bracket.slice(-3));
console.log('last 50 lines:');
const lines = s.split(/\r?\n/);
console.log(lines.slice(-50).join('\n'));
