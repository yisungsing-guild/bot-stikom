const fs = require('fs');
const p = 'tmp/rp250_audit_output.json';
let buf = fs.readFileSync(p);
let raw;
// detect common BOMs / encodings
if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
  raw = buf.toString('utf8', 3);
} else if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
  raw = buf.toString('utf16le', 2);
} else {
  try { raw = buf.toString('utf8'); } catch (e) { raw = buf.toString('latin1'); }
}
try{
  const data = JSON.parse(raw);
  const items = data.items || [];
  const filtered = items.filter(it => {
    const trainingId = it.trainingId || (it.rawObject && it.rawObject.trainingId) || null;
    const source = it.source || (it.rawObject && it.rawObject.source) || null;
    const filename = it.filename || (it.rawObject && it.rawObject.filename) || null;
    const sourceFile = it.sourceFile || (it.rawObject && it.rawObject.sourceFile) || null;
    return trainingId && source === 'upload' && (filename === null || filename === undefined) && (sourceFile === null || sourceFile === undefined);
  });
  const byTraining = {};
  for (const it of filtered) {
    const trainingId = it.trainingId || (it.rawObject && it.rawObject.trainingId) || null;
    if (!byTraining[trainingId]) byTraining[trainingId] = [];
    byTraining[trainingId].push({
      file: it.file,
      sourceType: it.sourceType,
      chunkId: it.chunkId,
      trainingId: trainingId,
      source: it.source || (it.rawObject && it.rawObject.source) || null,
      filename: it.filename || (it.rawObject && it.rawObject.filename) || null,
      sourceFile: it.sourceFile || (it.rawObject && it.rawObject.sourceFile) || null,
      docCategory: it.docCategory || (it.rawObject && it.rawObject.docCategory) || null,
      before: (it.before||'').slice(-120),
      value: it.value,
      after: (it.after||'').slice(0,120)
    });
  }
  console.log(JSON.stringify({count: filtered.length, byTraining}, null, 2));
} catch (e) {
  console.error('ERR', e && e.message);
  process.exit(2);
}
