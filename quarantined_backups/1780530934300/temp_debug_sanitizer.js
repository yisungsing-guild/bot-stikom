const fs = require('fs');
const input = fs.readFileSync('temp_sanitizer_input.txt','utf8');
let text = String(input || '');
text = text.replace(/\r\n/g, '\n');
// simplified pre-processing mirroring sanitizeWhatsappText up to lines array
text = text.replace(/\u00A0/g, ' ');
text = text.replace(/^\s*\*\s+/gm, '- ');
text = text.replace(/^\s*[-•]\s*\*\s+/gm, '- ');
text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');
text = text.replace(/^\s{0,3}#{1,6}(?=\d|\()/gm, '');
text = text.replace(/^\s*>\s?/gm, '');
text = text.replace(/!\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2');
text = text.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2');
text = text.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, inner) => String(inner || '').trim());
text = text.replace(/`([^`\n]+)`/g, '$1');

// ... skipping many steps for brevity; replicate the trimming per-line whitespace early
const lines = text.split('\n');
for (let i = 0; i < lines.length; i++) {
  let line = String(lines[i] || '').replace(/[\t ]+$/g, '').trimStart();
  const wrapped = line.match(/^\*{1,3}([^*\n]{1,160})\*{1,3}\s*$/);
  if (wrapped) {
    line = String(wrapped[1] || '').trim();
  }
  line = line.replace(/^\*{1,3}([^*\n]{1,80})\*{1,3}(\s+|$)/, (_, inner, tail) => {
    const label = String(inner || '').trim();
    const rest = String(tail || '');
    return `${label}${rest}`;
  });
  lines[i] = line;
}

console.log('LINES BEFORE BULK NORMALIZATION:');
lines.forEach((l, idx) => console.log(idx, JSON.stringify(l)));

// Normalize bullet symbols
for (let i = 0; i < lines.length; i++) {
  lines[i] = lines[i]
    .replace(/^\s*[•·▪▫◦‣⁃]\s+/g, '- ')
    .replace(/^\s*–\s+/g, '- ')
    .replace(/^\s*-{2,}\s+/g, '- ');
  lines[i] = lines[i].replace(/^\s*-([^\s])/g, '- $1');
  lines[i] = lines[i].replace(/^\s+-\s+/g, '- ');
  lines[i] = lines[i].replace(/^\s*(\d+)[.)]\s*/g, '$1) ');
}

console.log('\nLINES AFTER BULLET NORMALIZATION:');
lines.forEach((l, idx) => console.log(idx, JSON.stringify(l)));

const isHeader = (line) => /^\s*(?:\d+\)\s+)?[A-Za-zÀ-ÿ0-9].{0,80}:\s*$/.test(line) || /^\s*\d+\)\s+/.test(line);
const isList = (line) => /^\s*(?:-|\d+\))\s+/.test(line);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const prev = i > 0 ? lines[i-1] : null;
  // find next non-empty
  let nextNonEmpty = '';
  for (let j = i+1; j < lines.length; j++) {
    const candidate = String(lines[j] || '').trim();
    if (candidate) { nextNonEmpty = candidate; break; }
  }
  const nextIsList = /^\s*(?:-|\d+\))\s+/.test(nextNonEmpty);
  console.log(`\nLine ${i}: ${JSON.stringify(line)}`);
  console.log('  prev:', JSON.stringify(prev));
  console.log('  isHeader:', isHeader(line));
  console.log('  nextNonEmpty:', JSON.stringify(nextNonEmpty));
  console.log('  nextIsList:', nextIsList);
}
