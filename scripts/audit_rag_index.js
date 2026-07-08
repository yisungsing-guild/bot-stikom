const fs = require('fs');
const path = require('path');
const idxPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const outPath = path.join(__dirname, '..', 'temp-audit-results.json');
const raw = fs.readFileSync(idxPath, 'utf8');
let arr = [];
try { arr = JSON.parse(raw); } catch (e) { console.error('JSON parse error', e); process.exit(2); }
const phrases = [
  'Teknologi Informasi adalah',
  'Sistem Informasi adalah',
  'Bisnis Digital adalah',
  'Program Studi Teknologi Informasi',
  'Program Studi Sistem Informasi',
  'Program Studi Bisnis Digital'
];
const filenameKeywords = [
  'prodi',
  'program studi',
  'teknologi informasi',
  'sistem informasi',
  'bisnis digital',
  'kurikulum',
  'mata kuliah'
];
function ciIncludes(hay, needle) { if(!hay) return false; return hay.toLowerCase().includes(needle.toLowerCase()); }
const phraseMatches = [];
for (const e of arr) {
  const chunk = (e.chunk || '') + '';
  for (const p of phrases) {
    if (chunk.toLowerCase().includes(p.toLowerCase())) {
      phraseMatches.push({ id: e.id, filename: e.filename||e.file||null, docCategory: e.docCategory||e.category||null, chunk: chunk.slice(0,500), phrase: p });
      break;
    }
  }
}
// filename keyword search within filename and also within chunk if filename missing
const filesFound = {};
const fileChunkCounts = {};
for (const e of arr) {
  const fname = e.filename||e.file||null;
  if (fname) {
    for (const k of filenameKeywords) {
      if (fname.toLowerCase().includes(k)) {
        filesFound[fname] = filesFound[fname] || { filename: fname, count: 0 };
        filesFound[fname].count++;
        break;
      }
    }
  }
  // count per file (group by filename)
  const key = fname || 'N/A';
  fileChunkCounts[key] = (fileChunkCounts[key]||0) + 1;
}
// also search chunks that contain filename keywords (in content)
const chunksContainingKeywords = [];
for (const e of arr) {
  const chunk = (e.chunk || '') + '';
  for (const k of filenameKeywords) {
    if (chunk.toLowerCase().includes(k)) {
      chunksContainingKeywords.push({ id: e.id, filename: e.filename||e.file||null, docCategory: e.docCategory||e.category||null, chunk: chunk.slice(0,500), keyword: k });
      break;
    }
  }
}
// build counts per file
const countsPerFile = Object.entries(fileChunkCounts).map(([filename, count])=>({ filename, count }));
const out = { phraseMatches, filesFound: Object.values(filesFound), chunksContainingKeywords, countsPerFile };
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath);
