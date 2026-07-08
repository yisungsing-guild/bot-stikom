const fs = require('fs');

const raw = fs.readFileSync('src/data/rag_index.json', 'utf8');
let corpus = null;
try {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    corpus = parsed
      .map((x) => (x && typeof x.chunk === 'string') ? x.chunk : ((x && typeof x.content === 'string') ? x.content : ''))
      .filter(Boolean)
      .join('\n\n');
  }
} catch {
  corpus = null;
}

const norm = corpus || raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');

function takeAround(markerRe, window = 200000, stopAfterRe = null) {
  const m = markerRe.exec(norm);
  if (!m) return null;
  const start = Math.max(0, m.index);
  let end = Math.min(norm.length, start + window);
  if (stopAfterRe) {
    const tail = norm.slice(start + m[0].length);
    const stopM = stopAfterRe.exec(tail);
    if (stopM && stopM.index >= 0) {
      end = Math.min(end, start + m[0].length + stopM.index);
    }
  }
  return { slice: norm.slice(start, end), start, end, markerLen: m[0].length };
}

function inspect(label, markerRe, window, stopAfterRe) {
  const res = takeAround(markerRe, window, stopAfterRe);
  console.log('\n===', label, '===');
  console.log('found:', !!res, res ? `len=${res.slice.length} markerLen=${res.markerLen}` : '');
  if (!res) return;
  const idxDpp = res.slice.search(/Dana\s+Pendidikan\s+Pokok/i);
  const idxBp = res.slice.search(/Biaya\s*Pendidikan/i);
  console.log('idx Dana Pendidikan Pokok:', idxDpp);
  console.log('idx Biaya Pendidikan:', idxBp);
  if (idxDpp >= 0) {
    console.log('--- snippet around DPP ---');
    console.log(res.slice.slice(Math.max(0, idxDpp - 200), idxDpp + 800));
  } else {
    console.log('--- first 1200 chars ---');
    console.log(res.slice.slice(0, 1200));
  }
}

inspect('HELP (with stopAfter=DUAL DEGREE)', /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i, 200000, /DUAL\s*DEGREE/i);
inspect('HELP (no stopAfter)', /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i, 200000, null);
inspect('DNUI (with stopAfter=DUAL DEGREE)', /DUAL\s*DEGREE[\s\S]{0,1200}(?:DALIAN\s+NEUSOFT[\s\S]{0,1200}\bDNUI\b|\bDNUI\b)/i, 200000, /DUAL\s*DEGREE/i);
inspect('DNUI (no stopAfter)', /DUAL\s*DEGREE[\s\S]{0,1200}(?:DALIAN\s+NEUSOFT[\s\S]{0,1200}\bDNUI\b|\bDNUI\b)/i, 200000, null);
