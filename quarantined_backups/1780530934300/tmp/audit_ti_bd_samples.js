const fs = require('fs');
const rag = require('../src/engine/ragEngine');
const idx = JSON.parse(fs.readFileSync(rag.getIndexPath(), 'utf8'));
function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function first200(s) {
  return norm(s).slice(0, 200);
}
function findRows(pattern, limit) {
  const rows = [];
  for (let i = 0; i < idx.length; i++) {
    const it = idx[i];
    const chunk = String(it.chunk || '');
    if (!pattern.test(chunk)) continue;
    rows.push({
      index: i,
      id: it.id,
      filename: it.filename || null,
      program: it.program || null,
      normalized: rag.normalizeProgramLabel(chunk),
      chunk: first200(chunk)
    });
    if (rows.length >= limit) break;
  }
  return rows;
}
const result = {
  ti: findRows(/Teknologi Informasi/i, 10),
  bd: findRows(/Bisnis Digital/i, 10)
};
console.log(JSON.stringify(result, null, 2));
