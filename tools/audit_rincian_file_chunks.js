/*
Audit chunks for a given PDF filename inside the rag index.
Outputs tools/audit_rincian_file_chunks.json
Usage: node tools/audit_rincian_file_chunks.js "rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf"
*/
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const targetFilename = args[0] || 'rincian Biaya SI,TI dan BD Tahun Ajaran 2026-2027.pdf';
const outPath = path.join(process.cwd(), 'tools', 'audit_rincian_file_chunks.json');

function findIndexPath() {
  const candidates = [
    path.join(process.cwd(), 'src', 'data', 'rag_index.json'),
    path.join(process.cwd(), 'data', 'rag_index.json'),
    path.join(process.cwd(), 'src', 'data', 'rag_index.json')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch(e){}
  }
  throw new Error('rag_index.json not found in expected locations');
}

const indexPath = findIndexPath();
const raw = fs.readFileSync(indexPath, 'utf8');
let items;
try { items = JSON.parse(raw); } catch (e) { console.error('Failed to parse index JSON:', e); process.exit(2); }

const filenameLower = String(targetFilename || '').toLowerCase();
const fileChunks = (Array.isArray(items) ? items : []).filter(it => {
  try {
    const fname = String(it.filename || it.sourceFile || '').toLowerCase();
    return fname === filenameLower || fname.includes(filenameLower);
  } catch (e) { return false; }
});

// If exact match not found, try substring match by loose compare
if (fileChunks.length === 0) {
  for (const it of (Array.isArray(items) ? items : [])) {
    const fname = String(it.filename || it.sourceFile || '').toLowerCase();
    if (fname && fname.includes('rincian biaya si,ti') && fname.includes('2026')) fileChunks.push(it);
  }
}

const reGelombang = /\bgelombang\b/i;
const re1A = /\b(?:1A|1\s*A|I\s*A|IA)\b/i;
const rePendaftaran = /\bpendaftaran\b/i;
const reDPP = /\b(?:dana\s+pendidikan\s+pokok|dpp)\b/i;
const reGelombang1A = new RegExp('\\bgelombang\\b[\\s\\S]{0,80}(' + '(?:1A|1\\s*A|I\\s*A|IA)' + ')', 'i');

const results = [];
let concatenated = '';
for (const it of fileChunks) {
  const chunk = String(it.chunk || '');
  concatenated += chunk + '\n\n';
  const containsGelombang = reGelombang.test(chunk);
  const contains1A = re1A.test(chunk);
  const containsPendaftaran = rePendaftaran.test(chunk);
  const containsDPP = reDPP.test(chunk);
  const containsGelombang1A = reGelombang1A.test(chunk);

  results.push({
    id: it.id || null,
    trainingId: it.trainingId || null,
    filename: it.filename || it.sourceFile || null,
    sectionTitle: it.sectionTitle || null,
    chunkType: it.chunkType || null,
    pageNumber: it.pageNumber || null,
    chunkPreview: chunk.substring(0, 800),
    contains: {
      gelombang: !!containsGelombang,
      "1A_literal_or_variants": !!contains1A,
      pendaftaran: !!containsPendaftaran,
      dpp: !!containsDPP,
      gelombang_1A_co_located: !!containsGelombang1A
    }
  });
}

// file-level search for gelombang + 1A
const fileHas1A = re1A.test(concatenated);
const fileHasGelombang = reGelombang.test(concatenated);
let fileGelombang1AMatch = null;
const m = reGelombang1A.exec(concatenated);
if (m) {
  const idx = m.index || 0;
  const snippet = concatenated.substring(Math.max(0, idx - 120), Math.min(concatenated.length, (idx + 120)));
  fileGelombang1AMatch = snippet;
}

const out = {
  targetFilename,
  indexPath,
  totalChunksForFile: fileChunks.length,
  fileHas: { gelombang: !!fileHasGelombang, '1A_literal_or_variants': !!fileHas1A },
  gelombang1a_snippet: fileGelombang1AMatch,
  chunks: results
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath);
