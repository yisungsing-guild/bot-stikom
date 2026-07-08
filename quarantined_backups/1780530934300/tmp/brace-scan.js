const fs = require('fs');
const text = fs.readFileSync('src/routes/provider.js', 'utf8');
let line = 1;
let col = 0;
let depth = 0;
let state = 'code';
let esc = false;
let templateStart = null;
let templateExprDepth = 0;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  const next = text[i + 1];
  if (ch === '\n') {
    line++;
    col = 0;
    if (state === 'linecomment') state = 'code';
    continue;
  }
  col++;
  if (state === 'code') {
    if (ch === '/' && next === '/') {
      state = 'linecomment';
      i++;
      col++;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'blockcomment';
      i++;
      col++;
      continue;
    }
    if (ch === '"') {
      state = 'double';
      continue;
    }
    if (ch === "'") {
      state = 'single';
      continue;
    }
    if (ch === '`') {
      state = 'template';
      templateStart = { line, col };
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  } else if (state === 'template') {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '`') {
      state = 'code';
      templateStart = null;
      continue;
    }
    if (ch === '$' && next === '{') {
      state = 'templateExpr';
      templateExprDepth = 1;
      i++;
      col++;
      continue;
    }
  } else if (state === 'single') {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === "'") state = 'code';
  } else if (state === 'double') {
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') state = 'code';
  } else if (state === 'templateExpr') {
    if (ch === '/' && next === '/') {
      state = 'linecomment';
      i++;
      col++;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'blockcomment';
      i++;
      col++;
      continue;
    }
    if (ch === '"') {
      state = 'double';
      continue;
    }
    if (ch === "'") {
      state = 'single';
      continue;
    }
    if (ch === '`') {
      state = 'template';
      templateStart = { line, col };
      continue;
    }
    if (ch === '{') templateExprDepth++;
    else if (ch === '}') {
      templateExprDepth--;
      if (templateExprDepth === 0) state = 'template';
    }
  } else if (state === 'blockcomment') {
    if (ch === '*' && next === '/') {
      state = 'code';
      i++;
      col++;
    }
  }
}
console.log(JSON.stringify({ depth, state, templateStart }, null, 2));
