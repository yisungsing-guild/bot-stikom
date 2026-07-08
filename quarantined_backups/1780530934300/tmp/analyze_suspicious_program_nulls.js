const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

const indexPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const keywords = [/program studi/i, /prodi/i, /jurusan/i, /sistem informasi/i, /teknologi informasi/i, /bisnis digital/i, /sistem komputer/i];

function hasKeyword(text) {
  return keywords.some((re) => re.test(text));
}

function classifyItem(item) {
  const chunk = String(item.chunk || '');
  const lower = chunk.toLowerCase();
  const normalize = rag.normalizeProgramLabel(chunk);
  let cause = null;
  const badOcr = /[^\x00-\x7f]|\ufffd|Ã|�|�|�/.test(chunk) || /(stikombali|itb stikom bali|stikom bali)/i.test(chunk) && /\b[shtl][a-z]{0,2}\b/.test(chunk);
  const brokenSpacing = /[A-Za-z] [A-Za-z]|\bSistem\s*Informasi\b|\bTeknologi\s*Informasi\b|\bBisnis\s*Digital\b|\bSistem\s*Komputer\b/.test(chunk) && /\n/.test(chunk);
  const splitAcrossLines = /(program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer)/i.test(chunk) && /\n/.test(chunk);
  const onlyFilename = false;
  const falsePositive = /(program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer)/i.test(chunk) && !/program studi\s+[A-Za-z0-9]|prodi\s+[A-Za-z0-9]|jurusan\s+[A-Za-z0-9]/i.test(chunk) && !/sistem informasi|teknologi informasi|bisnis digital|sistem komputer/i.test(chunk);

  if (badOcr) cause = 'OCR corruption';
  if (!cause && splitAcrossLines) cause = 'Program name split across lines';
  if (!cause && brokenSpacing) cause = 'Broken spacing / line breaks';
  if (!cause && falsePositive) cause = 'False positive keyword';
  if (!cause) cause = 'Regex coverage lacking or pattern mismatch';
  return cause;
}

const suspicious = index.filter((item) => !item.program && item.chunk && hasKeyword(item.chunk));
const results = suspicious.map((item) => {
  const chunk = String(item.chunk || '');
  const normalized = rag.normalizeProgramLabel(chunk);
  return {
    id: item.id,
    filename: item.filename || item.sourceFile || 'UNKNOWN',
    normalize: normalized,
    chunkPreview: chunk.slice(0, 500).replace(/\r?\n/g, '\\n'),
    cause: classifyItem(item),
  };
});

const grouped = results.reduce((acc, item) => {
  acc[item.cause] = acc[item.cause] || [];
  acc[item.cause].push(item);
  return acc;
}, {});

const lines = [];
lines.push(`suspicious_count=${results.length}`);
for (const [cause, items] of Object.entries(grouped)) {
  lines.push(`CATEGORY: ${cause} count=${items.length}`);
  items.slice(0, 3).forEach((it) => {
    lines.push(`  example: id=${it.id} filename=${it.filename} normalize=${it.normalize}`);
  });
}
lines.push('');
results.forEach((item, idx) => {
  lines.push(`--- ${idx+1}`);
  lines.push(`id=${item.id}`);
  lines.push(`filename=${item.filename}`);
  lines.push(`normalizeProgramLabel=${item.normalize}`);
  lines.push(`chunkPreview=${item.chunkPreview}`);
  lines.push(`cause=${item.cause}`);
});
fs.writeFileSync(path.join(__dirname, 'analyze_suspicious_program_nulls.txt'), lines.join('\n'), 'utf8');
console.log('Written tmp/analyze_suspicious_program_nulls.txt');
