const fs = require('fs');
const input = fs.readFileSync('temp_sanitizer_input.txt','utf8');
let text = String(input || '');
text = text.replace(/\r\n/g, '\n');
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

for (let i = 0; i < lines.length; i++) {
  lines[i] = lines[i]
    .replace(/^\s*[•·▪▫◦‣⁃]\s+/g, '- ')
    .replace(/^\s*–\s+/g, '- ')
    .replace(/^\s*-{2,}\s+/g, '- ');
  lines[i] = lines[i].replace(/^\s*-([^\s])/g, '- $1');
  lines[i] = lines[i].replace(/^\s+-\s+/g, '- ');
  lines[i] = lines[i].replace(/^\s*(\d+)[.)]\s*/g, '$1) ');
}

const isRomanWaveLabelBullet = (line) => {
  const m = String(line || '').match(/^\s*-\s*(?:Gelombang\s+)?([IVX]{1,5})\s*([A-Z])\s*$/i);
  if (!m) return null;
  const roman = String(m[1] || '').toUpperCase();
  const letter = String(m[2] || '').toUpperCase();
  if (!/^[A-D]$/.test(letter)) return null;
  return { roman, letter };
};
const looksLikeDetailBullet = (line) => /^\s*-\s+.{1,120}:\s*\S+/.test(String(line || ''));

for (let i = 0; i < lines.length; i++) {
  const label = isRomanWaveLabelBullet(lines[i]);
  if (!label) continue;
  let detailHits = 0;
  let scanned = 0;
  for (let j = i + 1; j < lines.length && scanned < 8; j++) {
    const candidate = String(lines[j] || '').trim();
    if (!candidate) continue;
    scanned++;
    if (looksLikeDetailBullet(candidate)) detailHits++;
    if (isRomanWaveLabelBullet(candidate)) break;
  }
  if (detailHits >= 2) {
    lines[i] = `${label.roman} ${label.letter}:`;
  }
}

const maxEmphasisPairs = parseInt(process.env.WHATSAPP_MAX_ASTERISK_EMPHASIS || '6', 10);
const emphasisMatches = text.match(/\*[^*\n]{1,80}\*/g) || [];
const asteriskCount = (text.match(/\*/g) || []).length;
const excessive = emphasisMatches.length > maxEmphasisPairs || asteriskCount > 24;

const stripAsterisksInLine = (line) => {
  let out = String(line || '');
  for (let i = 0; i < 3; i++) {
    out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    out = out.replace(/\*([^*\n]+)\*/g, '$1');
  }
  out = out.replace(/\*/g, '');
  return out;
};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const isListLine = /^\s*(?:[-•]|\d+[.)])\s+/.test(line);
  if (isListLine) {
    lines[i] = stripAsterisksInLine(line);
  } else if (excessive) {
    lines[i] = stripAsterisksInLine(line);
  }
}

let keptBoldPairs = 0;
const looksLikeEmailOrUrl = (s) => {
  const v = String(s || '').trim();
  if (!v) return false;
  if (/https?:\/\//i.test(v)) return true;
  if (/\bwww\./i.test(v)) return true;
  if (/\S+@\S+\.[A-Za-z]{2,}/.test(v)) return true;
  return false;
};

const normalizeInlineAsteriskEmphasis = (line) => {
  let out = String(line || '');
  out = out.replace(/\*\*\*([^*\n]{1,160})\*\*\*/g, (_, inner) => {
    const content = String(inner || '').trim();
    if (!content) return '';
    if (looksLikeEmailOrUrl(content)) return content;
    if (keptBoldPairs >= 2) return content;
    keptBoldPairs++;
    return `*${content}*`;
  });
  out = out.replace(/\*\*([^*\n]{1,160})\*\*/g, (_, inner) => {
    const content = String(inner || '').trim();
    if (!content) return '';
    if (looksLikeEmailOrUrl(content)) return content;
    if (keptBoldPairs >= 2) return content;
    keptBoldPairs++;
    return `*${content}*`;
  });
  out = out.replace(/\*([^*\n]{1,160})\*/g, (_, inner) => {
    const content = String(inner || '').trim();
    if (!content) return '';
    if (looksLikeEmailOrUrl(content)) return content;
    if (keptBoldPairs >= 2) return content;
    keptBoldPairs++;
    return `*${content}*`;
  });
  out = out.replace(/\*/g, '');
  return out;
};

for (let i = 0; i < lines.length; i++) {
  const isListLine = /^\s*(?:[-•]|\d+[.)])\s+/.test(lines[i]);
  if (isListLine) continue;
  if (excessive) continue;
  lines[i] = normalizeInlineAsteriskEmphasis(lines[i]);
}

// Add a blank line before section-like headers and before list blocks for readability.
const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const prev = out.length > 0 ? out[out.length - 1] : '';
  const isHeader = /^\s*(?:\d+\)\s+)?[A-Za-zÀ-ÿ0-9].{0,80}:\s*$/.test(line) || /^\s*\d+\)\s+/.test(line);
  const isList = /^\s*(?:-|\d+\))\s+/.test(line);

  let nextNonEmpty = '';
  for (let j = i + 1; j < lines.length; j++) {
    const candidate = String(lines[j] || '').trim();
    if (candidate) { nextNonEmpty = candidate; break; }
  }
  const nextIsList = /^\s*(?:-|\d+\))\s+/.test(nextNonEmpty);
  const nextIsParagraph = nextNonEmpty && !nextIsList;

  if (line && ((isHeader && prev) || (isList && prev && !/^\s*$/.test(prev) && !/^\s*(?:-|\d+\))\s+/.test(prev)))) {
    out.push('');
  }

  out.push(line);

  if (line && isHeader && nextIsList) {
    const justPushed = out.length > 0 ? out[out.length - 1] : '';
    const alreadyBlankAfter = (out.length >= 2 && /^\s*$/.test(out[out.length - 1]) && justPushed === '');
    if (!alreadyBlankAfter) out.push('');
  }

  if (line && isList && nextIsParagraph) {
    const last = out.length > 0 ? out[out.length - 1] : '';
    if (last && !/^\s*$/.test(last)) out.push('');
  }
}

const finalText = out.join('\n');
console.log('\nFINAL OUT:');
console.log(finalText.split('\n').map((l,i)=>`${i}:${JSON.stringify(l)}`).join('\n'));
console.log('\nJOINED TEXT:\n');
console.log(finalText);
